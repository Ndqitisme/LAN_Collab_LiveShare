'use strict';

// lib/diagnostics.js step by step with a fake network (env), plus the real TLS path against a Node tls server with
// a certificate made here, and the client core driven through the same socket factory.
// Run: node test/diagnostics.test.js
const assert = require('assert');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');
const D = require('../lib/diagnostics');
const { LineSocket } = require('../lib/common');
const { CollabClient } = require('../lib/client-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lan-collab-diag-'));
const PROBE_OK = { t: 'probe_result', proto_ok: true, project_ok: true, token_ok: true, account_ok: true, projects: ['Demo'], hubId: 'H1', hubName: 'stub', instanceId: 'I1', hubMin: 1, hubMax: 2 };

// ------------------------------------------------------------------ fake network

class FakeSocket extends EventEmitter {
  constructor(onHello) {
    super();
    this.destroyed = false;
    this.writable = true;
    this.onHello = onHello;
  }

  setEncoding() {}

  setNoDelay() {}

  setKeepAlive() {}

  write(line) {
    const hello = JSON.parse(line);
    if (this.onHello) setImmediate(() => this.emit('data', `${JSON.stringify(this.onHello(hello))}\n`));
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.writable = false;
    setImmediate(() => this.emit('close'));
  }
}

// plan: {'host:port': {after, error, hang, reply(hello)}}. Records every socket it hands out.
function fakeNet(plan) {
  const sockets = [];
  return {
    sockets,
    createConnection({ host, port }) {
      const p = plan[`${host}:${port}`] || { error: 'ECONNREFUSED' };
      const sock = new FakeSocket(p.reply);
      sock.host = host;
      sockets.push(sock);
      setTimeout(() => {
        if (sock.destroyed || p.hang) return;
        if (p.error) sock.emit('error', Object.assign(new Error(`connect ${p.error} ${host}:${port}`), { code: p.error }));
        else sock.emit('connect');
      }, p.after || 0);
      return sock;
    },
  };
}

// answer(addr) -> {from, port, instanceId, after?} or null: the hub that replies to a datagram sent to addr.
function fakeDgram(answer) {
  const sent = [];
  return {
    sent,
    createSocket() {
      const s = new EventEmitter();
      s.bind = (port, cb) => setImmediate(cb);
      s.setBroadcast = () => {};
      s.close = () => {};
      s.send = (msg, port, addr, cb) => {
        sent.push({ addr, port, msg: JSON.parse(msg.toString()) });
        cb();
        const r = answer(addr);
        if (r) setTimeout(() => s.emit('message', Buffer.from(JSON.stringify({ t: 'lanhub_here', v: 2, instanceId: r.instanceId, hubName: 'stub', port: r.port, tls: false, projects: ['Demo'] })), { address: r.from, port: 8201 }), r.after || 5);
      };
      return s;
    },
  };
}

const IFACES = () => ({ eth0: [{ family: 'IPv4', address: '192.168.5.20', netmask: '255.255.255.0', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }] });
const FAST = { connectTimeoutMs: 150, discoveryWaitMs: 150, probeTimeoutMs: 300, interfaces: IFACES };

function target(over = {}) {
  return { folder: tmp(), project: 'Demo', port: 8200, addresses: ['10.0.0.1', '10.0.0.2'], lastGood: null, instanceId: 'I1', tlsFingerprint: null, token: 'sekret', name: 'tester', account: null, ...over };
}

async function collect(t, env) {
  const out = [];
  for await (const r of D.runChecks(t, env)) out.push(r);
  assert.deepStrictEqual(out.map((r) => r.step), D.STEPS, 'one result per step, in order');
  for (const r of out) {
    assert.ok(['ok', 'fixed', 'failed', 'skipped'].includes(r.status), `${r.step}: status ${r.status}`);
    if (r.status === 'failed') assert.ok(r.code && r.remedy && r.remedy.text, `${r.step}: a failure carries a code and guidance`);
  }
  return Object.fromEntries(out.map((r) => [r.step, r]));
}

const statuses = (by) => D.STEPS.map((s) => by[s].status).join(' ');

// ------------------------------------------------------------------ self-signed certificate (ASN.1 DER by hand)

function der(tag, content) {
  const n = content.length;
  let len;
  if (n < 128) len = Buffer.from([n]);
  else {
    const hex = n.toString(16);
    const b = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
    len = Buffer.concat([Buffer.from([0x80 | b.length]), b]);
  }
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const seq = (...items) => der(0x30, Buffer.concat(items));
const oid = (s) => {
  const [a, b, ...rest] = s.split('.').map(Number);
  const bytes = [40 * a + b];
  for (let v of rest) {
    const chunk = [v & 0x7f];
    for (v >>= 7; v; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
};
const utcTime = (d) => der(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));

function selfSigned(cn) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const alg = seq(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const name = seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn)))));
  const now = Date.now();
  const tbs = seq(der(0x02, Buffer.from([1])), alg, name, seq(utcTime(new Date(now - 864e5)), utcTime(new Date(now + 864e5))), name, publicKey.export({ type: 'spki', format: 'der' }));
  const cert = seq(tbs, alg, der(0x03, Buffer.concat([Buffer.from([0]), crypto.sign('sha256', tbs, privateKey)])));
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fingerprint: crypto.createHash('sha256').update(cert).digest('hex'),
  };
}

// A protocol 2 stub over TLS: answers a probe with PROBE_OK and a join with an empty welcome. Counts messages.
function tlsHub(cred) {
  return new Promise((resolve) => {
    const hub = { messages: [] };
    hub.server = tls.createServer({ key: cred.key, cert: cred.cert }, (sock) => {
      const ls = new LineSocket(sock);
      ls.on('error', () => {});
      ls.on('message', (m) => {
        hub.messages.push(m);
        if (m.t !== 'hello') return;
        if (m.probe) ls.send(PROBE_OK);
        else {
          ls.send({ t: 'welcome', id: 'm1', color: '#112233', hubId: 'H1', session: 's1', project: 'Demo', files: {}, applied: {}, users: [], activity: [], features: ['tls'], key: 'k', exclude: [], chat: [], proto: 2, instanceId: 'I1', hubName: 'stub', hubVersion: 'test' });
        }
      });
    });
    hub.server.listen(0, '127.0.0.1', () => {
      hub.port = hub.server.address().port;
      resolve(hub);
    });
  });
}

// ------------------------------------------------------------------ cases

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('backoff is 1, 2, 5, 10, then 30 s with up to 20 percent jitter', () => {
  const base = [1000, 2000, 5000, 10000, 30000, 30000, 30000];
  base.forEach((b, n) => {
    assert.strictEqual(D.backoffDelay(n, () => 0), b);
    assert.strictEqual(D.backoffDelay(n, () => 0.999999), Math.round(b * 1.2));
    const d = D.backoffDelay(n);
    assert.ok(d >= b && d <= b * 1.2, `attempt ${n}: ${d}`);
  });
});

test('error codes map to refused, timeout and unreachable', () => {
  assert.strictEqual(D.networkCode({ code: 'ECONNREFUSED' }), 'refused');
  assert.strictEqual(D.networkCode({ code: 'ETIMEDOUT' }), 'timeout');
  assert.strictEqual(D.networkCode({ code: 'EHOSTUNREACH' }), 'unreachable');
  assert.strictEqual(D.networkCode({ code: 'ENETUNREACH' }), 'unreachable');
  assert.strictEqual(D.networkCode({ code: 'ECONNRESET' }), 'failed');
});

test('step 1: no folder, then a folder without a hub', async () => {
  let by = await collect({ folder: null }, FAST);
  assert.strictEqual(statuses(by), 'failed skipped skipped skipped skipped skipped skipped skipped');
  assert.strictEqual(by.config.code, 'no_folder');
  by = await collect({ folder: tmp() }, FAST);
  assert.strictEqual(by.config.code, 'unbound');
  assert.deepStrictEqual(by.config.remedy.actions, ['join', 'open_settings']);
});

test('all steps pass; the second address answers first and wins, the first is closed', async () => {
  const net = fakeNet({ '10.0.0.1:8200': { after: 60, reply: () => PROBE_OK }, '10.0.0.2:8200': { after: 5, reply: () => PROBE_OK } });
  const by = await collect(target(), { ...FAST, net });
  assert.strictEqual(statuses(by), 'ok ok skipped ok skipped ok ok ok');
  assert.strictEqual(by.addresses.data.host, '10.0.0.2');
  assert.strictEqual(by.rtt.data.source, 'probe');
  await sleep(100);
  assert.ok(net.sockets.every((s) => s.destroyed), 'the loser and the probe socket are closed');
});

test('lastGood is tried with the invite addresses and a live RTT is reported as is', async () => {
  const net = fakeNet({ '10.9.9.9:8200': { reply: () => PROBE_OK } });
  const by = await collect(target({ lastGood: '10.9.9.9', rtt: 4 }), { ...FAST, net });
  assert.strictEqual(by.addresses.data.host, '10.9.9.9');
  assert.deepStrictEqual(by.rtt.data, { ms: 4, source: 'live' });
});

for (const [error, code] of [['ECONNREFUSED', 'refused'], ['EHOSTUNREACH', 'unreachable'], [null, 'timeout']]) {
  test(`steps 2 to 4 fail as ${code} without an instanceId`, async () => {
    const p = error ? { error } : { hang: true };
    const net = fakeNet({ '10.0.0.1:8200': p, '10.0.0.2:8200': p });
    const by = await collect(target({ instanceId: null }), { ...FAST, net });
    assert.strictEqual(statuses(by), 'ok failed skipped failed skipped skipped skipped skipped');
    assert.strictEqual(by.addresses.code, code);
    assert.strictEqual(by.discovery.code, 'no_instance');
    assert.strictEqual(by.network.code, code);
    assert.deepStrictEqual(by.network.data.failures.map((f) => f.code), [code, code]);
    assert.deepStrictEqual(by.network.remedy.actions, ['reconnect']);
  });
}

test('a refusal outranks a timeout when the addresses disagree', async () => {
  const net = fakeNet({ '10.0.0.1:8200': { hang: true }, '10.0.0.2:8200': { error: 'ECONNREFUSED' } });
  await assert.rejects(D.resolve(target({ instanceId: null }), { ...FAST, net }), (e) => e.code === 'refused' && e.data.host === '10.0.0.1');
});

test('the hub stopped: steps 2 and 3 fail and step 4 says refused with its guidance', async () => {
  const net = fakeNet({});
  const udp = fakeDgram(() => null);
  const by = await collect(target(), { ...FAST, net, dgram: udp });
  assert.strictEqual(statuses(by), 'ok failed failed failed skipped skipped skipped skipped');
  assert.strictEqual(by.discovery.code, 'not_found');
  assert.strictEqual(by.network.code, 'refused');
  assert.ok(by.network.remedy.text.startsWith('LAN Hub chưa chạy hoặc sai cổng.'), by.network.remedy.text);
  assert.deepStrictEqual(udp.sent.map((s) => s.addr), ['192.168.5.255', '10.0.0.1', '10.0.0.2'], 'every interface broadcast plus the known addresses');
  assert.deepStrictEqual(udp.sent[0].msg, { t: 'lanhub_discover', v: 2 });
});

test('step 3 rediscovers the hub at a new address, ignoring another hub, and marks it fixed', async () => {
  const net = fakeNet({ '192.168.5.40:9300': { reply: () => PROBE_OK }, '192.168.5.66:8200': { reply: () => PROBE_OK } });
  const udp = fakeDgram((addr) => (addr === '192.168.5.255' ? { from: '192.168.5.40', port: 9300, instanceId: 'I1' } : addr === '10.0.0.1' ? { from: '192.168.5.66', port: 8200, instanceId: 'OTHER' } : null));
  const by = await collect(target(), { ...FAST, net, dgram: udp });
  assert.strictEqual(statuses(by), 'ok failed fixed ok skipped ok ok ok');
  assert.strictEqual(by.discovery.data.host, '192.168.5.40');
  assert.strictEqual(by.discovery.data.port, 9300);
  const won = await D.resolve(target(), { ...FAST, net, dgram: udp });
  assert.deepStrictEqual([won.via, won.host, won.port], ['discovery', '192.168.5.40', 9300]);
  won.socket.destroy();
});

test('replies from several addresses of one hub are all tried, so a first reply from a closed address does not win', async () => {
  const net = fakeNet({ '192.168.5.20:9300': { reply: () => PROBE_OK } });
  const udp = fakeDgram((addr) => (addr === '10.0.0.1' ? { from: '127.0.0.1', port: 9300, instanceId: 'I1', after: 1 } : addr === '192.168.5.255' ? { from: '192.168.5.20', port: 9300, instanceId: 'I1', after: 30 } : null));
  const won = await D.resolve(target(), { ...FAST, net, dgram: udp });
  assert.deepStrictEqual([won.via, won.host, won.port], ['discovery', '192.168.5.20', 9300]);
  won.socket.destroy();
});

test('resolve() skips rediscovery without an instanceId and reports that it ran when it did', async () => {
  const udp = fakeDgram(() => null);
  await assert.rejects(D.resolve(target({ instanceId: null }), { ...FAST, net: fakeNet({}), dgram: udp }), (e) => e.code === 'refused' && !e.data.discovery);
  assert.strictEqual(udp.sent.length, 0);
  await assert.rejects(D.resolve(target(), { ...FAST, net: fakeNet({}), dgram: udp }), (e) => e.code === 'refused' && e.data.discovery.found === false);
});

const probeCases = [
  [{ ...PROBE_OK, proto_ok: false, project_ok: null, token_ok: null, account_ok: null, hubMin: 3, hubMax: 3 }, 'protocol_version', ['update_extension']],
  [{ ...PROBE_OK, project_ok: false, token_ok: null, account_ok: null, projects: ['Demo', 'Web'] }, 'project_unknown', ['choose_project', 'paste_invite']],
  [{ ...PROBE_OK, token_ok: false, account_ok: null }, 'token_invalid', ['paste_invite', 'enter_token']],
  [{ ...PROBE_OK, account_ok: false, account_error: { code: 'account_denied', data: { account: 'github:x', entry: 'github:x' } } }, 'account_denied', ['copy_entry', 'switch_account']],
  [{ ...PROBE_OK, account_ok: false }, 'account_required', ['sign_in']],
  [{ t: 'error', code: 'tls_required', data: {} }, 'tls_required', ['reconnect']],
];
for (const [reply, code, actions] of probeCases) {
  test(`step 6 maps the probe answer to ${code}`, async () => {
    const net = fakeNet({ '10.0.0.1:8200': { reply: () => reply } });
    const by = await collect(target({ addresses: ['10.0.0.1'] }), { ...FAST, net });
    assert.strictEqual(statuses(by), 'ok ok skipped ok skipped failed skipped skipped');
    assert.strictEqual(by.handshake.code, code);
    assert.deepStrictEqual(by.handshake.remedy.actions, actions);
    if (code === 'project_unknown') assert.ok(by.handshake.remedy.text.includes('"Web"'), 'the hub projects are listed');
    if (code === 'account_denied') assert.ok(by.handshake.remedy.text.includes('github:x'), 'the line for the administrator is shown');
  });
}

test('step 6 sends the token, project and account in a probe hello', async () => {
  let seen = null;
  const net = fakeNet({ '10.0.0.1:8200': { reply: (h) => { seen = h; return PROBE_OK; } } });
  await collect(target({ addresses: ['10.0.0.1'], account: { provider: 'github', label: 'q' } }), { ...FAST, net });
  assert.deepStrictEqual(seen, { t: 'hello', probe: true, proto: 2, project: 'Demo', token: 'sekret', name: 'tester', account: { provider: 'github', label: 'q' } });
});

test('step 6 fails with no_reply when the port answers but never speaks', async () => {
  const net = fakeNet({ '10.0.0.1:8200': {} });
  const by = await collect(target({ addresses: ['10.0.0.1'] }), { ...FAST, net });
  assert.strictEqual(by.handshake.code, 'no_reply');
});

test('step 7: a read-only folder, then a folder that is another hub project', async () => {
  const net = fakeNet({ '10.0.0.1:8200': { reply: () => PROBE_OK } });
  const readOnly = { writeFileSync: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); }, rmSync: () => {} };
  let by = await collect(target({ addresses: ['10.0.0.1'] }), { ...FAST, net, fs: readOnly });
  assert.strictEqual(by.folder.code, 'folder_readonly');
  const folder = tmp();
  fs.mkdirSync(path.join(folder, '.lan-collab'));
  fs.writeFileSync(path.join(folder, '.lan-collab', 'hub.json'), JSON.stringify({ id: 'OTHER-HUB' }));
  by = await collect(target({ addresses: ['10.0.0.1'], folder }), { ...FAST, net });
  assert.strictEqual(by.folder.code, 'folder_other_project');
  assert.deepStrictEqual(fs.readdirSync(folder), ['.lan-collab'], 'the write probe leaves nothing behind');
  fs.writeFileSync(path.join(folder, '.lan-collab', 'hub.json'), JSON.stringify({ id: 'H1' }));
  by = await collect(target({ addresses: ['10.0.0.1'], folder }), { ...FAST, net });
  assert.strictEqual(by.folder.status, 'ok', 'the same hub id is that project');
});

test('TLS: a pinned certificate passes every step over a real tls socket', async () => {
  const cred = selfSigned('lanhub-test');
  const hub = await tlsHub(cred);
  try {
    const by = await collect(target({ addresses: ['127.0.0.1'], port: hub.port, tlsFingerprint: cred.fingerprint }), {});
    assert.strictEqual(statuses(by), 'ok ok skipped ok ok ok ok ok');
    assert.strictEqual(by.handshake.data.hubName, 'stub');
  } finally {
    hub.server.close();
  }
});

test('TLS: a different certificate stops at step 5, skips rediscovery and sends no hello', async () => {
  const cred = selfSigned('lanhub-test');
  const hub = await tlsHub(cred);
  const udp = fakeDgram(() => ({ from: '127.0.0.1', port: hub.port, instanceId: 'I1' }));
  try {
    const wrong = 'ab'.repeat(32);
    const t = target({ addresses: ['127.0.0.1'], port: hub.port, tlsFingerprint: wrong });
    const by = await collect(t, { dgram: udp });
    assert.strictEqual(statuses(by), 'ok ok skipped ok failed skipped skipped skipped');
    assert.strictEqual(by.tls.code, 'tls_mismatch');
    assert.strictEqual(by.tls.data.fingerprint, cred.fingerprint);
    assert.deepStrictEqual(by.tls.remedy.actions, ['paste_invite']);
    await assert.rejects(D.resolve(t, { dgram: udp }), (e) => e.code === 'tls_mismatch' && e.fatal);
    assert.strictEqual(udp.sent.length, 0, 'a mismatch never falls back to rediscovery');
    await sleep(100);
    assert.strictEqual(hub.messages.length, 0, 'nothing, the token least of all, reached the hub');
  } finally {
    hub.server.close();
  }
});

test('client core: plain TCP and TLS share the socket factory; the core reaches live over TLS', async () => {
  const cred = selfSigned('lanhub-test');
  const hub = await tlsHub(cred);
  const events = [];
  const c = new CollabClient({
    root: tmp(), host: '127.0.0.1', port: hub.port, project: 'Demo', token: 'sekret', name: 'tls', uid: 'u1',
    openSocket: () => D.resolve({ addresses: ['127.0.0.1'], port: hub.port, tlsFingerprint: cred.fingerprint, instanceId: 'I1' }),
  });
  c.on('connection', (e) => events.push(e));
  try {
    c.connect();
    for (let i = 0; i < 100 && !c.ready; i++) await sleep(20);
    assert.ok(c.ready, 'live over TLS');
    assert.deepStrictEqual(events.map((e) => e.type), ['ATTEMPT', 'SOCKET_OPEN', 'WELCOME', 'SYNCED']);
    assert.strictEqual(events[2].instanceId, 'I1', 'WELCOME carries the instanceId for the joins record');
    assert.strictEqual(hub.messages[0].token, 'sekret');
  } finally {
    c.disconnect();
    hub.server.close();
  }
});

test('client core: a failing factory retries on the injected schedule; tls_mismatch stops without retry', async () => {
  const delays = [];
  const events = [];
  let calls = 0;
  const c = new CollabClient({
    root: tmp(), host: '10.0.0.1', port: 8200, project: 'Demo', name: 'x', uid: 'u2',
    retryDelay: (n) => {
      delays.push(n);
      return 10;
    },
    openSocket: () => {
      calls += 1;
      return Promise.reject(calls < 3 ? new D.DiagError('refused', { host: '10.0.0.1', port: 8200 }) : new D.DiagError('tls_mismatch', { host: '10.0.0.1', port: 8200 }));
    },
  });
  c.on('connection', (e) => events.push(e));
  c.connect();
  await sleep(150);
  c.disconnect();
  assert.deepStrictEqual(delays, [0, 1], 'attempt numbers grow while the hub stays unreachable');
  assert.deepStrictEqual(events.map((e) => e.type), ['ATTEMPT', 'SOCKET_CLOSED', 'ATTEMPT', 'SOCKET_CLOSED', 'ATTEMPT', 'HUB_ERROR']);
  assert.strictEqual(events[5].code, 'tls_mismatch');
  assert.strictEqual(calls, 3, 'no retry after tls_mismatch');
});

test('client core: a folder holding another hub project refuses before syncing anything', async () => {
  const cred = selfSigned('lanhub-test');
  const hub = await tlsHub(cred);
  const root = tmp();
  fs.mkdirSync(path.join(root, '.lan-collab'));
  fs.writeFileSync(path.join(root, '.lan-collab', 'hub.json'), JSON.stringify({ id: 'OTHER-HUB' }));
  const events = [];
  let asked = false;
  const c = new CollabClient({
    root, host: '127.0.0.1', port: hub.port, project: 'Demo', name: 'x', uid: 'u3', confirmSync: async () => { asked = true; return true; },
    openSocket: () => D.resolve({ addresses: ['127.0.0.1'], port: hub.port, tlsFingerprint: cred.fingerprint }),
  });
  c.on('connection', (e) => events.push(e));
  try {
    c.connect();
    for (let i = 0; i < 100 && !events.some((e) => e.type === 'HUB_ERROR'); i++) await sleep(20);
    assert.deepStrictEqual(events.map((e) => e.type), ['ATTEMPT', 'SOCKET_OPEN', 'HUB_ERROR']);
    assert.strictEqual(events[2].code, 'folder_other_project');
    assert.strictEqual(c.ready, false);
    assert.strictEqual(asked, false);
  } finally {
    c.disconnect();
    hub.server.close();
  }
});

test('client core: rejected keeps the connection and is not a connection event', async () => {
  const c = new CollabClient({ root: tmp(), host: 'h', port: 1, project: 'Demo', name: 'x', uid: 'u4' });
  const events = [];
  c.on('connection', (e) => events.push(e));
  c.closed = false;
  c._dispatch({ t: 'rejected', code: 'role_denied', path: 'a.txt' });
  assert.strictEqual(c.closed, false);
  assert.deepStrictEqual(events, []);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL ${name}\n${e.stack}`);
    }
  }
  if (failed) {
    console.log(`diagnostics: ${failed} of ${cases.length} failed`);
    process.exit(1);
  }
  console.log(`diagnostics: OK (${cases.length} cases)`);
  process.exit(0);
})();
