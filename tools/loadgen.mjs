// Load generator: starts a hub (LANHUB_CMD or the Node hub) on a temp folder, connects N raw protocol clients,
// creates one text file and has every client insert into it at a fixed rate. Prints one JSON line.
// Usage: node tools/loadgen.mjs [--clients 10] [--rate 20] [--seconds 30] [--seed 1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
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
  const out = { clients: 10, rate: 20, seconds: 30, seed: 1 };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(clients|rate|seconds|seed)$/.exec(argv[i]);
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
const fail = (msg) => {
  console.error(`loadgen: ${msg}`);
  process.exit(1);
};

// One member that waits for the ack of its op before sending the next, so it only needs the document length.
class Client {
  constructor(index, port) {
    this.index = index;
    this.seq = 0;
    this.rev = null;
    this.len = 0;
    this.pending = null;
    this.sent = 0;
    this.acked = 0;
    this.ls = new C.LineSocket(net.createConnection({ host: '127.0.0.1', port }));
    this.ls.sock.setNoDelay(true);
    this.ls.on('error', (e) => fail(`client ${index}: ${e.message}`));
    this.ls.on('close', () => this.closing || fail(`client ${index}: hub closed the connection`));
    this.welcomed = new Promise((resolve) => {
      this.ls.on('message', (m) => (m.t === 'welcome' ? resolve() : this.onMessage(m)));
    });
    this.ls.sock.on('connect', () => this.ls.send({ t: 'hello', proto: C.PROTO, project: 'loadgen', name: `load${index}`, uid: `load${index}` }));
  }

  onMessage(m) {
    if (m.path !== FILE) return;
    if (m.t === 'file') {
      this.rev = m.rev;
      this.len = m.text.length;
    } else if (m.t === 'op') {
      const op = TextOperation.fromJSON(m.op);
      this.len += op.targetLength - op.baseLength;
      this.rev = m.rev + 1;
      const now = performance.now();
      for (const part of m.op) if (typeof part === 'string' && sentAt.has(part)) fanout.push(now - sentAt.get(part));
    } else if (m.t === 'ack') {
      ackRtt.push(performance.now() - sentAt.get(this.pending));
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
const hub = await startHubProcess({ root, project: 'loadgen' });
const clients = [];
for (let i = 0; i < args.clients; i++) clients.push(new Client(i, hub.port));
await Promise.all(clients.map((c) => c.welcomed));
clients[0].ls.send({ t: 'create', path: FILE, kind: 'text', text: '' });
const ready = Date.now() + 5000;
while (clients.some((c) => c.rev === null)) {
  if (Date.now() > ready) fail(`${FILE} did not reach every client`);
  await sleep(10);
}

const t0 = performance.now();
// Spread the clients over one interval so the hub sees a steady stream rather than bursts.
clients.forEach((c, i) => (c.due = t0 + (INTERVAL * i) / args.clients));
const driver = setInterval(() => {
  const now = performance.now();
  for (const c of clients) c.tick(now);
}, 2);
await sleep(args.seconds * 1000);
clearInterval(driver);
const drainEnd = Date.now() + DRAIN_MS;
while (Date.now() < drainEnd && (clients.some((c) => c.pending) || fanout.length < ackRtt.length * (args.clients - 1))) await sleep(10);

const hubRssMb = rssMb(hub.pid);
for (const c of clients) {
  c.closing = true;
  c.ls.close();
}
await hub.stop();
fs.rmSync(root, { recursive: true, force: true });

ackRtt.sort((a, b) => a - b);
fanout.sort((a, b) => a - b);
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
}));
process.exit(sent === acked ? 0 : 1);
