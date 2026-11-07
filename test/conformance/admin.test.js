'use strict';

// The admin channel (docs/protocol.md section 13.3), for a hub that lists admin in welcome.features: a first
// message admin_hello with the admin token opens an admin session that carries admin_call and admin_result
// messages with ids. A wrong token is answered after 1 s, five wrong tokens from one address within a minute
// block it, plain TCP is refused from any address but loopback, and edits from a session land in lanhub.toml.
// Skipped when the hub does not list admin (the Node hub has no admin channel).
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { test, after } = require('node:test');
const { startHubProcess, probeWelcome } = require('../support/hub-process');

const TOKEN = 'admin-token-for-tests-0123';
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-admin-${n}-`));
const hubs = [];
after(async () => {
  for (const h of hubs) await h.stop().catch(() => {});
});

async function start(opts) {
  const hub = await startHubProcess(opts);
  hubs.push(hub);
  return hub;
}

// An IPv4 address of this machine other than loopback: a connection to it comes from that address too.
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

// One admin connection: send(obj), next() resolves to the next message, closed resolves on close.
function adminSocket(sock) {
  const queue = [];
  const waiters = [];
  let buf = '';
  let ended = false;
  const deliver = (m) => {
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  };
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) deliver(JSON.parse(line));
    }
  });
  sock.on('error', () => {});
  const closed = new Promise((resolve) =>
    sock.on('close', () => {
      ended = true;
      while (waiters.length) waiters.shift()(null);
      resolve();
    }),
  );
  let nextId = 1;
  return {
    sock,
    closed,
    send: (m) => sock.write(`${JSON.stringify(m)}\n`),
    next(ms = 5000) {
      if (queue.length) return Promise.resolve(queue.shift());
      if (ended) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no admin message within the time')), ms);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      });
    },
    // One admin_call; resolves to its admin_result.
    async call(method, params = {}) {
      const id = nextId++;
      this.send({ t: 'admin_call', id, method, params });
      const m = await this.next(10000);
      assert.strictEqual(m && m.t, 'admin_result', JSON.stringify(m));
      assert.strictEqual(m.id, id);
      return m;
    },
    close: () => sock.destroy(),
  };
}

function connectPlain(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    sock.once('connect', () => resolve(adminSocket(sock)));
    sock.once('error', reject);
  });
}

function connectTls(port, host, fingerprint) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false });
    sock.once('error', reject);
    sock.once('secureConnect', () => {
      const raw = sock.getPeerCertificate().raw;
      const got = crypto.createHash('sha256').update(raw).digest('hex');
      if (got !== fingerprint) {
        sock.destroy();
        return reject(new Error(`fingerprint ${got}`));
      }
      resolve(adminSocket(sock));
    });
  });
}

async function hello(port, token, host) {
  const a = await connectPlain(port, host);
  a.send({ t: 'admin_hello', token });
  return a;
}

let supported = null;
async function adminSupported() {
  if (supported !== null) return supported;
  const root = tmp('probe');
  const hub = await start({ root, project: 'Demo' });
  const w = await probeWelcome(hub.port, { project: 'Demo' });
  supported = w.features.includes('admin');
  return supported;
}

const SKIP = 'the hub does not list admin in welcome.features';

test('a correct token opens a session; wrong token, disabled channel and unknown calls are coded', async (t) => {
  if (!(await adminSupported())) return t.skip(SKIP);
  const off = await start({ root: tmp('off'), project: 'Demo' });
  const d = await hello(off.port, TOKEN);
  assert.deepStrictEqual(await d.next(), { t: 'admin_refused', code: 'disabled' });
  await d.closed;

  const hub = await start({ root: tmp('on'), project: 'Demo', args: ['--admin-token', TOKEN] });
  const a = await hello(hub.port, TOKEN);
  const w = await a.next();
  assert.strictEqual(w.t, 'admin_welcome');
  assert.ok(typeof w.hubName === 'string' && /^lanhub /.test(w.hubVersion) && w.instanceId);
  assert.strictEqual(w.configPath, null, 'flag mode has no file to edit');
  const bad = await a.call('no_such_method');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error.code, 'badRequest');
  a.close();

  const started = Date.now();
  const b = await hello(hub.port, 'wrong-token-wrong-token');
  assert.deepStrictEqual(await b.next(), { t: 'admin_refused', code: 'token_invalid' });
  assert.ok(Date.now() - started >= 900, 'a wrong token is answered after about 1 s');
  await b.closed;
  assert.ok(hub.logs().some((l) => /sai token quản trị/.test(l)));
  assert.ok(!hub.logs().some((l) => l.includes(TOKEN)), 'the token is never logged');
});

test('each AdminApi call answers over the session', async (t) => {
  if (!(await adminSupported())) return t.skip(SKIP);
  const hub = await start({ root: tmp('api'), project: 'Demo', token: 'member-token', args: ['--admin-token', TOKEN] });
  const a = await hello(hub.port, TOKEN);
  assert.strictEqual((await a.next()).t, 'admin_welcome');

  const list = await a.call('list_projects');
  assert.strictEqual(list.ok, true);
  assert.deepStrictEqual(
    list.value.map((p) => [p.name, p.state, p.token]),
    [['Demo', 'running', 'member-token']],
  );
  const status = await a.call('project_status', { name: 'demo' });
  assert.strictEqual(status.value.name, 'Demo');
  assert.strictEqual((await a.call('project_status', { name: 'nope' })).value, null);
  assert.deepStrictEqual((await a.call('clients', { name: 'Demo' })).value, []);
  const unknown = await a.call('clients', { name: 'nope' });
  assert.deepStrictEqual([unknown.ok, unknown.error.code, unknown.error.params.name], [false, 'unknownProject', 'nope']);
  const logs = await a.call('logs', { after: 0, limit: 5 });
  assert.ok(Array.isArray(logs.value) && logs.value.length > 0 && logs.value.every((r) => r.seq && r.msg));
  const settings = await a.call('hub_settings');
  assert.strictEqual(settings.value.fingerprint, null);
  const invites = await a.call('invite_codes');
  assert.ok(invites.value.every((i) => i.name === 'Demo' && i.code.startsWith('LC3-')));

  const rotated = await a.call('rotate_token', { name: 'Demo' });
  assert.ok(rotated.ok && /^[0-9a-f]{32}$/.test(rotated.value));
  await assert.rejects(probeWelcome(hub.port, { project: 'Demo', token: 'member-token' }), /token_invalid/);
  const w = await probeWelcome(hub.port, { project: 'Demo', token: rotated.value });
  assert.ok(w.features.includes('admin'));

  const edit = await a.call('add_project', { input: { name: 'X', root: hub.root, enabled: true, advertise: true } });
  assert.deepStrictEqual([edit.ok, edit.error.code], [false, 'configReadOnly']);
  const apply = await a.call('apply_config', { config: { hub: { name: null, bind: '127.0.0.1', port: 0, discovery: false, discovery_port: 8201, public_address: [], tls: { enabled: false, cert: null, key: null } }, projects: [] } });
  assert.ok(apply.ok, JSON.stringify(apply));
  assert.deepStrictEqual(
    apply.value.events.map((e) => [e.project, e.kind]),
    [['Demo', 'stopped']],
  );
  assert.deepStrictEqual((await a.call('list_projects')).value, []);
  a.close();
});

test('five wrong tokens within a minute block the address before any token check', async (t) => {
  if (!(await adminSupported())) return t.skip(SKIP);
  const hub = await start({ root: tmp('limit'), project: 'Demo', args: ['--admin-token', TOKEN] });
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push(hello(hub.port, `wrong-${i}-wrong-wrong-wrong`).then((a) => a.next()));
  for (const m of await Promise.all(tries)) assert.deepStrictEqual(m, { t: 'admin_refused', code: 'token_invalid' });

  const started = Date.now();
  const blocked = await hello(hub.port, TOKEN);
  const m = await blocked.next();
  assert.strictEqual(m.code, 'rate_limited', 'even the right token is refused while blocked');
  assert.ok(m.retryAfterMs > 4 * 60 * 1000 && m.retryAfterMs <= 5 * 60 * 1000, String(m.retryAfterMs));
  assert.ok(Date.now() - started < 900, 'refused at once, without the wrong-token delay');
  assert.ok(hub.logs().some((l) => /Chặn quản trị từ 127\.0\.0\.1/.test(l)), hub.logs().join('\n'));
});

test('plain TCP is refused from an address other than loopback; TLS from there opens the session', async (t) => {
  if (!(await adminSupported())) return t.skip(SKIP);
  const lan = lanAddress();
  if (!lan) return t.skip('this machine has no IPv4 address besides loopback');
  const hub = await start({ root: tmp('plain'), project: 'Demo', args: ['--admin-token', TOKEN] });
  const a = await hello(hub.port, TOKEN, lan);
  assert.deepStrictEqual(await a.next(), { t: 'admin_refused', code: 'tls_required' });
  await a.closed;
  assert.ok(hub.logs().some((l) => new RegExp(`quản trị từ ${lan.replace(/\./g, '\\.')}: kết nối không mã hoá`).test(l)));

  const secure = await start({ root: tmp('tls'), project: 'Demo', args: ['--tls', '--admin-token', TOKEN] });
  const line = secure.logs().find((l) => /TLS fingerprint SHA256 /.test(l));
  const fingerprint = /([0-9a-f]{64})$/.exec(line)[1];
  const s = await connectTls(secure.port, lan, fingerprint);
  s.send({ t: 'admin_hello', token: TOKEN });
  assert.strictEqual((await s.next()).t, 'admin_welcome');
  assert.strictEqual((await s.call('hub_settings')).value.fingerprint, fingerprint);
  s.close();
});

test('project CRUD over the session writes the hub lanhub.toml', async (t) => {
  if (!(await adminSupported())) return t.skip(SKIP);
  const dir = tmp('crud');
  const config = path.join(dir, 'lanhub.toml');
  const first = path.join(dir, 'first');
  const second = path.join(dir, 'second');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  fs.writeFileSync(
    config,
    `# kept\n[hub]\nbind = "127.0.0.1"\n\n[hub.admin]\nremote = true\ntoken = "${TOKEN}"\n\n[[project]]\nname = "First"\nroot = '${first}'\n`,
  );
  const hub = await start({ config });
  const a = await hello(hub.port, TOKEN);
  const w = await a.next();
  assert.strictEqual(path.resolve(w.configPath), path.resolve(config));

  const added = await a.call('add_project', { input: { name: 'Second', root: second, enabled: true, advertise: false } });
  assert.ok(added.ok, JSON.stringify(added));
  let text = fs.readFileSync(config, 'utf8');
  assert.ok(text.startsWith('# kept\n') && /name = "Second"/.test(text) && /\[hub\.admin\]/.test(text), text);
  const token = (await a.call('project_status', { name: 'Second' })).value.token;
  assert.ok(text.includes(token), 'the new project token is in the file');
  await probeWelcome(hub.port, { project: 'Second', token });

  const missing = await a.call('add_project', { input: { name: 'Third', root: path.join(dir, 'nope'), enabled: true, advertise: true } });
  assert.deepStrictEqual([missing.error.code, missing.error.field], ['rootMissing', 'root']);

  const renamed = await a.call('update_project', { original: 'second', input: { name: 'Renamed', root: second, enabled: true, advertise: true } });
  assert.ok(renamed.ok, JSON.stringify(renamed));
  assert.deepStrictEqual((await a.call('list_projects')).value.map((p) => p.name), ['First', 'Renamed']);
  assert.ok((await a.call('set_project_enabled', { name: 'Renamed', enabled: false })).ok);
  assert.strictEqual((await a.call('project_status', { name: 'Renamed' })).value.state, 'disabled');
  assert.match(fs.readFileSync(config, 'utf8'), /enabled = false/);

  const rotated = await a.call('rotate_token', { name: 'First' });
  assert.ok(fs.readFileSync(config, 'utf8').includes(rotated.value), 'a rotation is saved to the file');

  assert.ok((await a.call('remove_project', { name: 'Renamed' })).ok);
  text = fs.readFileSync(config, 'utf8');
  assert.ok(!/Renamed/.test(text) && /\[hub\.admin\]/.test(text), text);
  assert.deepStrictEqual((await a.call('list_projects')).value.map((p) => p.name), ['First']);
  a.close();
});
