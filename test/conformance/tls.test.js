'use strict';

// TLS on the hub port (docs/protocol.md section 13.1), for a hub that accepts --tls (lanhub from A6); set
// LANHUB_TLS=1 to run it. A client pins the certificate the way lib/diagnostics.js does: the SHA-256 of the DER
// leaf certificate, 64 lowercase hex characters, compared before anything is written. The fingerprint comes from
// the hub log line "TLS fingerprint SHA256 <hex>" and from invite v3 field f.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { test, after } = require('node:test');
const C = require('../../lib/common');
const { startHubProcess } = require('../support/hub-process');

const skip = !process.env.LANHUB_TLS && 'needs a hub that accepts --tls (set LANHUB_TLS=1)';
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-tls-${n}-`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opened = [];
after(() => opened.forEach((close) => close()));

async function until(cond, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function fingerprintFrom(hub) {
  const line = hub.logs().find((l) => /TLS fingerprint SHA256 /.test(l));
  assert.ok(line, `no fingerprint line in:\n${hub.logs().join('\n')}`);
  const fp = /TLS fingerprint SHA256 ([0-9a-f]{64})$/.exec(line);
  assert.ok(fp, line);
  return fp[1];
}

// Resolves to a TLS socket whose peer certificate matches fingerprint, else rejects with code tls_mismatch.
function connectPinned(port, fingerprint) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false });
    sock.on('error', reject);
    sock.once('secureConnect', () => {
      const cert = sock.getPeerCertificate();
      const got = cert && cert.raw ? crypto.createHash('sha256').update(cert.raw).digest('hex') : '';
      if (got === fingerprint) return resolve(sock);
      sock.destroy();
      return reject(Object.assign(new Error(`certificate fingerprint ${got}`), { code: 'tls_mismatch', got }));
    });
  });
}

// A raw protocol member over a pinned TLS socket that keeps every message it receives.
async function member(port, fingerprint, name) {
  const sock = await connectPinned(port, fingerprint);
  opened.push(() => sock.destroy());
  const ls = new C.LineSocket(sock);
  const m = { msgs: [], closed: false, send: (x) => ls.send(x), close: () => sock.destroy() };
  ls.on('message', (x) => m.msgs.push(x));
  ls.on('error', () => {});
  ls.on('close', () => {
    m.closed = true;
  });
  m.find = (pred) => m.msgs.find(pred);
  ls.send({ t: 'hello', proto: 2, project: 'Demo', token: 'tk', name, uid: `uid-${name}` });
  await until(() => m.find((x) => x.t === 'welcome' || x.t === 'error') || m.closed, `${name} welcome`);
  m.welcome = m.find((x) => x.t === 'welcome');
  assert.ok(m.welcome, `welcome expected, got ${JSON.stringify(m.msgs)}`);
  return m;
}

function request(port, secure, raw) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }) : net.createConnection({ host: '127.0.0.1', port });
    let out = '';
    sock.setEncoding('utf8');
    sock.on(secure ? 'secureConnect' : 'connect', () => sock.write(raw));
    sock.on('data', (d) => {
      out += d;
    });
    sock.on('error', reject);
    sock.on('close', () => resolve(out));
  });
}

test('a pinned TLS client joins, syncs an edit, and sees tls in features', { skip }, async () => {
  const hub = await startHubProcess({ root: tmp('sync'), project: 'Demo', token: 'tk', args: ['--tls'] });
  try {
    const fp = fingerprintFrom(hub);
    const a = await member(hub.port, fp, 'alice');
    const b = await member(hub.port, fp, 'bob');
    assert.ok(a.welcome.features.includes('tls'), JSON.stringify(a.welcome.features));
    assert.ok(a.welcome.features.includes('http-diag'));
    a.send({ t: 'create', path: 'n.txt', kind: 'text', text: 'hello' });
    await until(() => b.find((m) => m.t === 'file' && m.path === 'n.txt'), 'bob gets the new file');
    const file = b.find((m) => m.t === 'file' && m.path === 'n.txt');
    assert.strictEqual(file.text, 'hello');
    a.send({ t: 'op', path: 'n.txt', rev: file.rev, op: [5, ' world'], seq: 1 });
    await until(() => a.find((m) => m.t === 'ack' && m.path === 'n.txt'), 'alice gets her ack');
    await until(() => b.find((m) => m.t === 'op' && m.path === 'n.txt'), 'bob gets the op');
    assert.deepStrictEqual(b.find((m) => m.t === 'op' && m.path === 'n.txt').op, [5, ' world']);
    a.close();
    b.close();
  } finally {
    await hub.stop();
  }
});

test('a wrong pin stops the client before it sends anything; the fingerprint survives a restart', { skip }, async () => {
  const root = tmp('pin');
  let hub = await startHubProcess({ root, project: 'Demo', token: 'tk', args: ['--tls'] });
  let fp;
  try {
    fp = fingerprintFrom(hub);
    const wrong = fp.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    await assert.rejects(connectPinned(hub.port, wrong), (e) => e.code === 'tls_mismatch' && e.got === fp);
    await sleep(100);
    assert.ok(!hub.logs().some((l) => /vào phòng/.test(l)), 'nobody joined');
  } finally {
    await hub.stop();
  }
  hub = await startHubProcess({ root, project: 'Demo', token: 'tk', args: ['--tls'] });
  try {
    assert.strictEqual(fingerprintFrom(hub), fp, 'same certificate after a restart');
    (await member(hub.port, fp, 'carol')).close();
  } finally {
    await hub.stop();
  }
});

test('invite v3 carries public_address first and the fingerprint in f', { skip }, async () => {
  const dir = tmp('invite');
  fs.mkdirSync(path.join(dir, 'p'));
  const file = path.join(dir, 'lanhub.toml');
  fs.writeFileSync(file, `[hub]\npublic_address = ["hub.example.com", "203.0.113.5"]\n\n[hub.tls]\nenabled = true\n\n[[project]]\nname = "Demo"\nroot = 'p'\ntoken = "tk"\n`);
  const hub = await startHubProcess({ config: file });
  try {
    const fp = fingerprintFrom(hub);
    const line = hub.logs().find((l) => /Mã mời: LC3-/.test(l));
    assert.ok(line, hub.logs().join('\n'));
    assert.ok(!hub.logs().some((l) => /Mã mời \(/.test(l)), 'no legacy LC- code with TLS on');
    const inv = C.decodeInviteV3(/LC3-[A-Za-z0-9_-]+/.exec(line)[0]);
    assert.deepStrictEqual(inv.hosts.slice(0, 2), ['hub.example.com', '203.0.113.5']);
    assert.strictEqual(inv.fingerprint, fp);
    assert.strictEqual(inv.port, hub.port);
    assert.strictEqual(inv.project, 'Demo');
    assert.ok(fs.existsSync(path.join(dir, 'tls-selfsigned.pem')), 'the certificate sits next to lanhub.toml');
  } finally {
    await hub.stop();
  }
});

test('the diagnosis page answers over https and over plain http on a TLS hub', { skip }, async () => {
  const hub = await startHubProcess({ root: tmp('https'), project: 'Demo', token: 'secret-token-391', args: ['--tls', '--name', 'Hub TLS'] });
  try {
    const fp = fingerprintFrom(hub);
    for (const secure of [true, false]) {
      const res = await request(hub.port, secure, 'GET / HTTP/1.1\r\nHost: x\r\n\r\n');
      assert.match(res, /^HTTP\/1\.1 200 OK\r\n/, `secure=${secure}`);
      assert.match(res, /Content-Type: text\/html; charset=utf-8/);
      assert.ok(res.includes('Hub TLS') && res.includes(fp) && res.includes('Demo'));
      assert.ok(!res.includes('secret-token-391'), 'no token');
    }
  } finally {
    await hub.stop();
  }
});
