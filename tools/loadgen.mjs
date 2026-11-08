// Load generator: starts a hub (LANHUB_CMD or the Node hub) on a temp folder, connects N raw protocol clients,
// creates one text file and has every client insert into it at a fixed rate. Prints one JSON line.
// --chat N also sends N chat messages per second in total, round robin over the clients, and reports the time
// from send to receipt over every member (the sender included).
// --projects N (N > 1, lanhub with the multi-project feature) serves N projects from a lanhub.toml on one port,
// with --clients members in each, and adds per-project ackRtt and fanout percentiles under "projects".
// --port P --project NAME drives one project of a hub that is already running (started by the caller), so several
// loadgen processes can load one multi-project hub without sharing one event loop; hubRssMb is then null.
// --tls (lanhub from A6) starts the hub with --tls and connects every client over TLS pinned to the fingerprint the
// hub logs; with --port, --tls <fingerprint> pins the given one. The output then has "tls": true.
// Usage: node tools/loadgen.mjs [--clients 10] [--rate 20] [--seconds 30] [--seed 1] [--chat 0] [--projects 1]
//        [--port P --project NAME] [--tls [fingerprint]]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../lib/common');
const { TextOperation } = require('../lib/ot');
const { startHubProcess } = require('../test/support/hub-process');

const FILE = 'loadgen.txt';
const DRAIN_MS = 5000;

function parseArgs(argv) {
  const out = { clients: 10, rate: 20, seconds: 30, seed: 1, chat: 0, projects: 1, port: 0, project: 'loadgen', tls: false, fingerprint: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') {
      out.project = argv[++i];
      continue;
    }
    if (argv[i] === '--tls') {
      out.tls = true;
      if (/^[0-9a-f]{64}$/.test(argv[i + 1] || '')) out.fingerprint = argv[++i];
      continue;
    }
    const m = /^--(clients|rate|seconds|seed|chat|projects|port)$/.exec(argv[i]);
    if (!m) throw new Error(`unknown argument ${argv[i]}`);
    out[m[1]] = Number(argv[++i]);
    if (!(out[m[1]] > 0)) throw new Error(`--${m[1]} needs a positive number`);
  }
  return out;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const v = sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return Math.round(v * 100) / 100;
}

function rssMb(pid) {
  if (process.platform === 'win32') {
    // "Image","PID","Session","Session#","Mem Usage" with the working set as e.g. "45,123 K"
    const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const kb = Number(row.trim().split('","').pop().replace(/[^\d]/g, ''));
    return Math.round((kb / 1024) * 10) / 10;
  }
  const kb = Number(/VmRSS:\s*(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]);
  return Math.round((kb / 1024) * 10) / 10;
}

const args = parseArgs(process.argv.slice(2));
const INTERVAL = 1000 / args.rate;
const random = rng(args.seed);
const sentAt = new Map(); // insert marker -> send time, shared by all clients since they live in this process
const ackRtt = [];
const fanout = [];
const chatSentAt = new Map(); // chat text -> send time
const chatLatency = [];
const fail = (msg) => {
  console.error(`loadgen: ${msg}`);
  process.exit(1);
};

// One member that waits for the ack of its op before sending the next, so it only needs the document length.
class Client {
  constructor(index, port, project, fingerprint) {
    this.index = index;
    this.project = project;
    this.seq = 0;
    this.rev = null;
    this.len = 0;
    this.pending = null;
    this.sent = 0;
    this.acked = 0;
    const sock = fingerprint
      ? tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false })
      : net.createConnection({ host: '127.0.0.1', port });
    this.ls = new C.LineSocket(sock);
    this.ls.sock.setNoDelay(true);
    this.ls.on('error', (e) => fail(`client ${index}: ${e.message}`));
    this.ls.on('close', () => this.closing || fail(`client ${index}: hub closed the connection`));
    this.welcomed = new Promise((resolve) => {
      this.ls.on('message', (m) => (m.t === 'welcome' ? resolve() : this.onMessage(m)));
    });
    this.ls.sock.on(fingerprint ? 'secureConnect' : 'connect', () => {
      if (fingerprint) {
        const got = crypto.createHash('sha256').update(sock.getPeerCertificate().raw).digest('hex');
        if (got !== fingerprint) fail(`client ${index}: certificate fingerprint ${got}, expected ${fingerprint}`);
      }
      this.ls.send({ t: 'hello', proto: C.PROTO_V2, project: project.name, name: `load${index}`, uid: `load${index}` });
    });
  }

  onMessage(m) {
    if (m.t === 'chat') {
      if (chatSentAt.has(m.msg.text)) chatLatency.push(performance.now() - chatSentAt.get(m.msg.text));
      return;
    }
    // history_changed (feature history) also names the file; it is not an answer to an op.
    if (m.path !== FILE || m.t === 'history_changed') return;
    if (m.t === 'file') {
      this.rev = m.rev;
      this.len = m.text.length;
    } else if (m.t === 'op') {
      const op = TextOperation.fromJSON(m.op);
      this.len += op.targetLength - op.baseLength;
      this.rev = m.rev + 1;
      const now = performance.now();
      for (const part of m.op) {
        if (typeof part !== 'string' || !sentAt.has(part)) continue;
        fanout.push(now - sentAt.get(part));
        this.project.fanout.push(now - sentAt.get(part));
      }
    } else if (m.t === 'ack') {
      const rtt = performance.now() - sentAt.get(this.pending);
      ackRtt.push(rtt);
      this.project.ackRtt.push(rtt);
      this.len += this.pending.length;
      this.rev = m.rev;
      this.pending = null;
      this.acked += 1;
    } else {
      fail(`client ${this.index}: hub answered "${m.t}" to an op`);
    }
  }

  // Called far more often than the rate; sending on a due time keeps the rate exact on coarse OS timers.
  tick(now) {
    if (this.pending || now < this.due) return;
    this.due = Math.max(this.due + INTERVAL, now);
    const marker = `<${this.index}.${this.seq++}>`;
    const at = Math.floor(random() * (this.len + 1));
    const op = new TextOperation().retain(at).insert(marker).retain(this.len - at);
    this.pending = marker;
    sentAt.set(marker, performance.now());
    this.sent += 1;
    this.ls.send({ t: 'op', path: FILE, rev: this.rev, op: op.toJSON(), seq: this.seq });
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-collab-loadgen-'));
const projects = [];
for (let p = 0; p < args.projects; p++) projects.push({ name: args.projects > 1 ? `loadgen${p + 1}` : args.project, ackRtt: [], fanout: [], clients: [] });
let hub;
if (args.port) {
  hub = { port: args.port, pid: null, stop: async () => {} };
} else if (args.projects > 1) {
  const blocks = projects.map((p) => {
    fs.mkdirSync(path.join(root, p.name));
    return `[[project]]\nname = "${p.name}"\nroot = '${path.join(root, p.name)}'\n`;
  });
  fs.writeFileSync(path.join(root, 'lanhub.toml'), blocks.join('\n'));
  hub = await startHubProcess({ config: path.join(root, 'lanhub.toml') });
} else {
  hub = await startHubProcess({ root, project: 'loadgen', args: args.tls ? ['--tls'] : [] });
}
let fingerprint = args.fingerprint;
if (args.tls && !fingerprint) {
  if (!hub.logs) fail('--tls with --port needs the fingerprint: --tls <hex>');
  const line = hub.logs().find((l) => /TLS fingerprint SHA256 [0-9a-f]{64}/.test(l));
  if (!line) fail('the hub logged no TLS fingerprint (does it accept --tls?)');
  fingerprint = /([0-9a-f]{64})/.exec(line)[1];
}
const clients = [];
for (const p of projects) {
  for (let i = 0; i < args.clients; i++) {
    const c = new Client(clients.length, hub.port, p, fingerprint);
    clients.push(c);
    p.clients.push(c);
  }
}
await Promise.all(clients.map((c) => c.welcomed));
for (const p of projects) p.clients[0].ls.send({ t: 'create', path: FILE, kind: 'text', text: '' });
const ready = Date.now() + 5000;
while (clients.some((c) => c.rev === null)) {
  if (Date.now() > ready) fail(`${FILE} did not reach every client`);
  await sleep(10);
}

const t0 = performance.now();
// Spread the clients over one interval so the hub sees a steady stream rather than bursts.
clients.forEach((c, i) => (c.due = t0 + (INTERVAL * i) / args.clients));
let chatDue = t0;
let chatSent = 0;
const driver = setInterval(() => {
  const now = performance.now();
  for (const c of clients) c.tick(now);
  while (args.chat && now >= chatDue) {
    chatDue += 1000 / args.chat;
    const text = `chat ${chatSent}`;
    chatSentAt.set(text, performance.now());
    clients[chatSent % clients.length].ls.send({ t: 'chat', text });
    chatSent += 1;
  }
}, 2);
await sleep(args.seconds * 1000);
clearInterval(driver);
const drainEnd = Date.now() + DRAIN_MS;
const drained = () => !clients.some((c) => c.pending)
  && projects.every((p) => p.fanout.length >= p.ackRtt.length * (args.clients - 1))
  && chatLatency.length >= chatSent * args.clients;
while (Date.now() < drainEnd && !drained()) await sleep(10);

const hubRssMb = hub.pid ? rssMb(hub.pid) : null;
for (const c of clients) {
  c.closing = true;
  c.ls.close();
}
await hub.stop();
fs.rmSync(root, { recursive: true, force: true });

ackRtt.sort((a, b) => a - b);
fanout.sort((a, b) => a - b);
for (const p of projects) {
  p.ackRtt.sort((a, b) => a - b);
  p.fanout.sort((a, b) => a - b);
}
chatLatency.sort((a, b) => a - b);
const sent = clients.reduce((n, c) => n + c.sent, 0);
const acked = clients.reduce((n, c) => n + c.acked, 0);
console.log(JSON.stringify({
  clients: args.clients,
  rate: args.rate,
  seconds: args.seconds,
  sent,
  acked,
  ackRttP50: percentile(ackRtt, 50),
  ackRttP99: percentile(ackRtt, 99),
  fanoutP50: percentile(fanout, 50),
  fanoutP99: percentile(fanout, 99),
  opsPerSec: Math.round((acked / args.seconds) * 10) / 10,
  hubRssMb,
  ...(fingerprint ? { tls: true } : {}),
  ...(args.projects > 1 ? {
    projects: projects.map((p) => ({
      project: p.name,
      ackRttP50: percentile(p.ackRtt, 50),
      ackRttP99: percentile(p.ackRtt, 99),
      fanoutP99: percentile(p.fanout, 99),
    })),
  } : {}),
  ...(args.chat ? { chatSent, chatReceived: chatLatency.length, chatP50: percentile(chatLatency, 50), chatP99: percentile(chatLatency, 99) } : {}),
}));
process.exit(sent === acked ? 0 : 1);
