'use strict';

// Protocol 2 as docs/protocol.md states it: coded errors and their order, probe_result, the welcome additions,
// structured activity, pong.ts, presence rtt, and the 0.1 messages protocol 1 members still get from a hub that
// accepts them. Every case talks raw NDJSON except the ones about lib/client-core.js rendering.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const { CollabClient } = require('../../lib/client-core');
const { startHubProcess } = require('../support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-v2-${n}-`));

async function until(cond, what, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

let uidN = 0;
// Everything a case opened, closed in after(): a failed assertion must fail the file, not leave it running.
const opened = [];

// A raw protocol client that keeps every line it receives, as text and parsed.
function connect(port, hello) {
  const sock = net.createConnection({ host: '127.0.0.1', port });
  sock.setEncoding('utf8');
  const c = { sock, lines: [], msgs: [], closed: false };
  let buf = '';
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line) continue;
      c.lines.push(line);
      c.msgs.push(JSON.parse(line));
    }
  });
  sock.on('close', () => {
    c.closed = true;
  });
  sock.on('error', () => {});
  c.send = (m) => sock.write(`${JSON.stringify(m)}\n`);
  c.find = (pred) => c.msgs.find(pred);
  c.all = (t) => c.msgs.filter((m) => m.t === t);
  c.close = () => sock.destroy();
  opened.push(c.close);
  const name = hello.name || `m${++uidN}`;
  sock.on('connect', () => c.send({ t: 'hello', proto: 2, project: 'Demo', token: 'tk', name, uid: `u-${name}-${uidN}`, ...hello }));
  return c;
}

// Sends a hello and resolves to the first reply once the hub has closed the connection.
async function refused(port, hello) {
  const c = connect(port, hello);
  await until(() => c.closed, 'the hub to close the connection');
  assert.strictEqual(c.msgs.length, 1, `exactly one reply, got ${JSON.stringify(c.msgs)}`);
  return { m: c.msgs[0], line: c.lines[0] };
}

async function join(port, hello = {}) {
  const c = connect(port, hello);
  await until(() => c.find((m) => m.t === 'welcome' || m.t === 'error') || c.closed, 'welcome');
  const w = c.find((m) => m.t === 'welcome');
  assert.ok(w, `welcome expected, got ${JSON.stringify(c.msgs)}`);
  c.welcome = w;
  return c;
}

function assertCodedError(m, code) {
  assert.strictEqual(m.t, 'error');
  assert.strictEqual(m.code, code);
  assert.ok(m.data && typeof m.data === 'object' && !Array.isArray(m.data), 'error.data is an object');
  assert.ok(!('message' in m), 'a protocol 2 error carries no display text');
}

let open; // hub with a token, no allow list
let gated; // hub with a token and an allow list
let gatedAllow;
let hubMin;

before(async () => {
  gatedAllow = path.join(tmp('cfg'), 'allowed.txt');
  fs.writeFileSync(gatedAllow, 'github:alice\n');
  [open, gated] = await Promise.all([
    startHubProcess({ root: tmp('open'), project: 'Demo', token: 'tk' }),
    startHubProcess({ root: tmp('gated'), project: 'Demo', token: 'tk', allowFile: gatedAllow }),
  ]);
  const { m } = await refused(open.port, { proto: 3 });
  hubMin = m.data && m.data.hubMin;
});

after(async () => {
  for (const close of opened) close();
  await Promise.all([open, gated].filter(Boolean).map((h) => h.stop()));
});

test('protocol_version answers a proto the hub does not speak', async () => {
  const { m } = await refused(open.port, { proto: 3 });
  assertCodedError(m, 'protocol_version');
  assert.strictEqual(m.data.hubMax, 2);
  assert.ok(Number.isInteger(m.data.hubMin) && m.data.hubMin >= 1 && m.data.hubMin <= 2);
});

test('handshake checks proto, then project, then token', async () => {
  assertCodedError((await refused(open.port, { proto: 3, project: 'Nope', token: 'bad' })).m, 'protocol_version');
  const p = (await refused(open.port, { project: 'Nope', token: 'bad' })).m;
  assertCodedError(p, 'project_unknown');
  assert.ok(Array.isArray(p.data.projects) && p.data.projects.includes('Demo'), 'project_unknown lists the hub project');
  const t = (await refused(open.port, { token: 'bad' })).m;
  assertCodedError(t, 'token_invalid');
  assert.deepStrictEqual(t.data, {});
  (await join(open.port, { project: 'demo' })).close(); // project names compare case-insensitively
});

test('account_required and account_denied come after the token check', async () => {
  assertCodedError((await refused(gated.port, { token: 'bad' })).m, 'token_invalid');
  const req = (await refused(gated.port, {})).m;
  assertCodedError(req, 'account_required');
  const den = (await refused(gated.port, { account: { provider: 'github', label: 'mallory' } })).m;
  assertCodedError(den, 'account_denied');
  assert.strictEqual(den.data.account, 'github:mallory');
  assert.strictEqual(den.data.entry, 'github:mallory');
  (await join(gated.port, { account: { provider: 'github', label: 'Alice' } })).close();
});

test('tls_required refuses plain TCP to a TLS hub', { skip: !process.env.LANHUB_TLS && 'needs a hub that accepts --tls (set LANHUB_TLS=1)' }, async () => {
  const hub = await startHubProcess({ root: tmp('tls'), project: 'Demo', token: 'tk', args: ['--tls'] });
  try {
    assertCodedError((await refused(hub.port, {})).m, 'tls_required');
  } finally {
    await hub.stop();
  }
});

test('probe_result reports each step and stops at the first failing one', async () => {
  const watcher = await join(gated.port, { name: 'watcher', account: { provider: 'github', label: 'alice' } });
  const probe = async (hello) => {
    const { m } = await refused(gated.port, { probe: true, ...hello });
    assert.strictEqual(m.t, 'probe_result');
    assert.ok(Array.isArray(m.projects) && m.projects.includes('Demo'));
    assert.strictEqual(typeof m.hubName, 'string');
    assert.strictEqual(m.instanceId, watcher.welcome.instanceId);
    return m;
  };
  let r = await probe({ proto: 3 });
  assert.deepStrictEqual([r.proto_ok, r.project_ok, r.token_ok, r.account_ok], [false, null, null, null]);
  assert.strictEqual(r.hubMax, 2);
  r = await probe({ project: 'Nope' });
  assert.deepStrictEqual([r.proto_ok, r.project_ok, r.token_ok, r.account_ok], [true, false, null, null]);
  assert.strictEqual(r.hubId, null);
  r = await probe({ token: 'bad' });
  assert.deepStrictEqual([r.proto_ok, r.project_ok, r.token_ok, r.account_ok], [true, true, false, null]);
  r = await probe({});
  assert.deepStrictEqual([r.proto_ok, r.project_ok, r.token_ok, r.account_ok], [true, true, true, false]);
  assert.strictEqual(r.account_error.code, 'account_required');
  r = await probe({ account: { provider: 'github', label: 'mallory' } });
  assert.strictEqual(r.account_ok, false);
  assert.strictEqual(r.account_error.code, 'account_denied');
  assert.strictEqual(r.account_error.data.entry, 'github:mallory');
  r = await probe({ account: { provider: 'github', label: 'alice' } });
  assert.deepStrictEqual([r.proto_ok, r.project_ok, r.token_ok, r.account_ok], [true, true, true, true]);
  assert.strictEqual(r.hubId, watcher.welcome.hubId);
  assert.ok(!('account_error' in r));
  await sleep(100);
  assert.ok(!watcher.find((m) => m.t === 'joined'), 'a probe is not a member');
  watcher.close();
});

test('welcome carries proto, instanceId, hubName, hubVersion and features; ids survive a restart', async () => {
  const root = tmp('ids');
  fs.mkdirSync(path.join(root, '.lan-collab'));
  // A folder served by hub 0.1: its hubId must stay, or every client would sync again from scratch.
  fs.writeFileSync(path.join(root, '.lan-collab', 'hub.json'), JSON.stringify({ id: 'hub-0.1-id', created: '2026-01-01T00:00:00.000Z' }));
  let hub = await startHubProcess({ root, project: 'Demo', token: 'tk' });
  try {
    let c = await join(hub.port);
    const w = c.welcome;
    assert.strictEqual(w.proto, 2);
    assert.strictEqual(w.hubId, 'hub-0.1-id');
    assert.ok(typeof w.instanceId === 'string' && w.instanceId && w.instanceId !== w.hubId);
    assert.ok(typeof w.hubName === 'string' && w.hubName);
    assert.ok(typeof w.hubVersion === 'string' && w.hubVersion);
    assert.ok(Array.isArray(w.features) && w.features.includes('chat-image'));
    assert.ok(!w.features.includes('discovery'), 'discovery is off in this hub');
    c.close();
    await hub.stop();
    hub = null;
    hub = await startHubProcess({ root, project: 'Demo', token: 'tk' });
    c = await join(hub.port);
    assert.strictEqual(c.welcome.hubId, 'hub-0.1-id');
    assert.strictEqual(c.welcome.instanceId, w.instanceId);
    c.close();
  } finally {
    if (hub) await hub.stop();
  }
});

test('activity is structured for every kind', async () => {
  const watcher = await join(open.port, { name: 'watcher' });
  const a = await join(open.port, { name: 'ann' });
  const b = await join(open.port, { name: 'ben' });
  const acts = () => watcher.all('activity').map((m) => m.a).filter((x) => x.who !== 'watcher');
  const last = async (kind, who) => {
    await until(() => acts().some((x) => x.kind === kind && x.who === who), `activity ${kind} from ${who}`);
    return acts().filter((x) => x.kind === kind && x.who === who).pop();
  };
  const j = await last('join', 'ann');
  assert.strictEqual(typeof j.addr, 'string');
  a.send({ t: 'create', path: 'act.txt', kind: 'text', text: 'abc' });
  assert.strictEqual((await last('create', 'ann')).path, 'act.txt');
  await until(() => a.find((m) => m.t === 'file' && m.path === 'act.txt'), 'file act.txt');
  a.send({ t: 'op', path: 'act.txt', rev: 0, op: [3, 'd'], seq: 1, src: 'editor' });
  assert.strictEqual((await last('edit', 'ann')).path, 'act.txt');
  b.send({ t: 'op', path: 'act.txt', rev: 1, op: [4, 'e'], seq: 1, src: 'disk' });
  assert.strictEqual((await last('edit_disk', 'ben')).path, 'act.txt');
  a.send({ t: 'presence', p: { file: 'act.txt', sel: [[0, 0]], line: 1, debug: 'main.py' } });
  assert.strictEqual((await last('debug_start', 'ann')).text, 'main.py');
  a.send({ t: 'presence', p: { file: 'act.txt', sel: [[0, 0]], line: 1, debug: null } });
  await last('debug_stop', 'ann');
  a.send({ t: 'status', text: 'đang làm PD1' });
  assert.strictEqual((await last('status_set', 'ann')).text, 'đang làm PD1');
  a.send({ t: 'status', text: '' });
  await last('status_clear', 'ann');
  a.send({ t: 'delete', path: 'act.txt' });
  assert.strictEqual((await last('delete', 'ann')).path, 'act.txt');
  b.close();
  await last('leave', 'ben');
  for (const x of acts()) {
    assert.strictEqual(typeof x.ts, 'number');
    assert.strictEqual(typeof x.color, 'string');
    if (x.kind !== 'debug_start' && x.kind !== 'status_set') assert.ok(!('text' in x), `${x.kind} carries no text`);
  }
  // A newcomer gets the same structured records in welcome.
  const late = await join(open.port, { name: 'late' });
  assert.ok(late.welcome.activity.some((x) => x.kind === 'status_set' && x.who === 'ann' && x.text === 'đang làm PD1'));
  assert.ok(late.welcome.activity.every((x) => typeof x.kind === 'string'));
  for (const c of [watcher, a, late]) c.close();
});

test('op src merge and revert are accepted like editor ops', async () => {
  const a = await join(open.port, { name: 'mia' });
  a.send({ t: 'create', path: 'src.txt', kind: 'text', text: 'x' });
  await until(() => a.find((m) => m.t === 'file' && m.path === 'src.txt'), 'file src.txt');
  a.send({ t: 'op', path: 'src.txt', rev: 0, op: [1, 'm'], seq: 1, src: 'merge' });
  await until(() => a.find((m) => m.t === 'ack' && m.path === 'src.txt' && m.rev === 1), 'ack of the merge op');
  a.send({ t: 'op', path: 'src.txt', rev: 1, op: [2, 'r'], seq: 2, src: 'revert', reverts: 'run-1' });
  await until(() => a.find((m) => m.t === 'ack' && m.path === 'src.txt' && m.rev === 2), 'ack of the revert op');
  await until(() => a.find((m) => m.t === 'activity' && m.a.who === 'mia' && m.a.kind === 'edit'), 'edit activity');
  a.close();
});

test('pong carries the hub clock', async () => {
  const c = await join(open.port);
  const before = Date.now();
  c.send({ t: 'ping' });
  await until(() => c.find((m) => m.t === 'pong'), 'pong');
  const { ts } = c.find((m) => m.t === 'pong');
  assert.ok(Number.isInteger(ts) && Math.abs(ts - before) < 5000, `pong.ts ${ts} near ${before}`);
  c.close();
});

test('presence rtt reaches the other protocol 2 members; an invalid rtt is dropped', async () => {
  const a = await join(open.port, { name: 'rtt-a' });
  const b = await join(open.port, { name: 'rtt-b' });
  const id = a.welcome.id;
  a.send({ t: 'presence', p: { file: 'x.txt', sel: [[1, 1]], line: 1, debug: null, rtt: 12.4 } });
  await until(() => b.find((m) => m.t === 'presence' && m.id === id), 'presence');
  assert.strictEqual(b.find((m) => m.t === 'presence' && m.id === id).p.rtt, 12);
  a.send({ t: 'presence', p: { file: 'y.txt', sel: [], line: 2, debug: null, rtt: -1 } });
  await until(() => b.find((m) => m.t === 'presence' && m.id === id && m.p.file === 'y.txt'), 'second presence');
  assert.ok(!('rtt' in b.find((m) => m.t === 'presence' && m.p.file === 'y.txt').p));
  a.close();
  b.close();
});

test('chat_rejected is coded for protocol 2', async () => {
  const c = await join(open.port);
  c.send({ t: 'chat', text: 'x', image: { mime: 'image/png', b64: '' } });
  await until(() => c.find((m) => m.t === 'chat_rejected'), 'chat_rejected');
  const r = c.find((m) => m.t === 'chat_rejected');
  assert.strictEqual(r.code, 'image_invalid');
  assert.strictEqual(r.data.maxBytes, 4 * 1024 * 1024);
  assert.ok(!('reason' in r));
  c.close();
});

test('protocol 1 hellos: 0.1 messages from a hub that accepts them, a legacy message otherwise', async () => {
  const v1 = (hello) => ({ proto: 1, ...hello });
  if (hubMin === 2) {
    const { m } = await refused(open.port, v1({}));
    assert.strictEqual(m.code, 'protocol_version');
    assert.strictEqual(typeof m.message, 'string', 'a 0.1 client reads only message');
    return;
  }
  assert.strictEqual((await refused(open.port, v1({ token: 'bad' }))).line, '{"t":"error","message":"Sai lanCollab.token.","code":""}');
  assert.strictEqual((await refused(gated.port, v1({}))).m.code, 'account');
  const old = await join(open.port, v1({ name: 'old' }));
  assert.deepStrictEqual(Object.keys(old.welcome), ['t', 'id', 'color', 'hubId', 'session', 'project', 'files', 'applied', 'users', 'activity', 'features', 'key', 'exclude', 'chat']);
  assert.deepStrictEqual(old.welcome.features, ['chat-image']);
  assert.ok(old.welcome.activity.every((x) => typeof x.text === 'string' && !('kind' in x)));
  const neu = await join(open.port, { name: 'neu' });
  neu.send({ t: 'status', text: 'abc' });
  await until(() => old.find((m) => m.t === 'activity' && m.a.who === 'neu' && m.a.text === 'đặt trạng thái: abc'), 'the 0.1 sentence');
  assert.deepStrictEqual(Object.keys(old.find((m) => m.t === 'activity' && m.a.who === 'neu').a), ['ts', 'who', 'color', 'text']);
  // rtt never reaches a 0.1 member, and a repeat that only refreshes rtt is not sent to it.
  for (const rtt of [5, 6, 7]) neu.send({ t: 'presence', p: { file: 'a.txt', sel: [[0, 0]], line: 1, debug: null, rtt } });
  neu.send({ t: 'presence', p: { file: 'b.txt', sel: [[0, 0]], line: 1, debug: null, rtt: 8 } });
  await until(() => old.all('presence').some((m) => m.p.file === 'b.txt'), 'presence b.txt');
  const seen = old.all('presence').filter((m) => m.id === neu.welcome.id);
  assert.deepStrictEqual(seen.map((m) => m.p.file), ['a.txt', 'b.txt']);
  assert.ok(seen.every((m) => !('rtt' in m.p)));
  old.send({ t: 'ping' });
  await until(() => old.find((m) => m.t === 'pong'), 'pong');
  assert.strictEqual(old.lines.find((l) => l.includes('"pong"')), '{"t":"pong"}');
  old.close();
  neu.close();
});

function collab(port, name, extra = {}) {
  const store = new Map();
  const c = new CollabClient({
    root: tmp(name), host: '127.0.0.1', port, project: 'Demo', token: 'tk', name, uid: `cc-${name}`, retryMs: 50, log: () => {},
    state: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }, ...extra,
  });
  c.on('fatal', (msg, code) => {
    c.fatal = { msg, code };
  });
  c.connect();
  opened.push(() => c.disconnect());
  return c;
}

test('lib/client-core.js renders catalog sentences from codes and activity kinds', async () => {
  const bad = collab(open.port, 'cc-bad', { token: 'bad' });
  const lost = collab(open.port, 'cc-lost', { project: 'Nope' });
  await until(() => bad.fatal && lost.fatal, 'both refusals');
  assert.deepStrictEqual(bad.fatal, { msg: 'LAN Hub từ chối token của máy này. Token đã đổi hoặc mã mời đã cũ.', code: 'token_invalid' });
  assert.deepStrictEqual(lost.fatal, { msg: `LAN Hub tại 127.0.0.1:${open.port} không có dự án "Nope". Dự án LAN Hub đang phục vụ: "Demo".`, code: 'project_unknown' });
  const denied = collab(gated.port, 'cc-mallory', { account: { provider: 'github', label: 'mallory' } });
  await until(() => denied.fatal, 'account refusal');
  assert.strictEqual(denied.fatal.code, 'account_denied');
  assert.strictEqual(denied.fatal.msg, 'Tài khoản github:mallory chưa có trong danh sách tài khoản được phép. Gửi dòng github:mallory cho người quản trị LAN Hub.');
  for (const c of [bad, lost, denied]) c.disconnect();

  const cc = collab(open.port, 'cc-view');
  await until(() => cc.ready, 'client ready');
  const raw = await join(open.port, { name: 'rawpeer' });
  raw.send({ t: 'create', path: 'cc.txt', kind: 'text', text: 'a' });
  raw.send({ t: 'status', text: 'review' });
  await until(() => cc.activity.some((x) => x.text === 'đặt trạng thái: review'), 'rendered status');
  const texts = cc.activity.filter((x) => x.who === 'rawpeer').map((x) => x.text);
  assert.deepStrictEqual(texts, ['vào dự án', 'đã tạo cc.txt', 'đặt trạng thái: review']);
  assert.ok(cc.activity.every((x) => typeof x.kind === 'string'), 'the record keeps its kind');
  raw.close();
  cc.disconnect();
});

test('lib/client-core.js reports its RTT in presence every 5 s', async () => {
  const peer = await join(open.port, { name: 'rtt-peer' });
  const cc = collab(open.port, 'cc-rtt');
  await until(() => peer.find((m) => m.t === 'presence' && typeof m.p.rtt === 'number'), 'a presence with rtt', 9000);
  assert.ok(peer.find((m) => m.t === 'presence' && typeof m.p.rtt === 'number').p.rtt >= 0);
  cc.disconnect();
  peer.close();
});
