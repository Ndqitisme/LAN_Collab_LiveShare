'use strict';

// Paths and messages that must not be trusted, and sync states that used to lose or duplicate data.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { CollabClient } = require('../../lib/client-core');
const { TextOperation } = require('../../lib/ot');
const C = require('../../lib/common');
const { startHubProcess, probeWelcome } = require('../support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-rob-${n}-`));

async function waitFor(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(20);
  }
  throw new Error(`Hết giờ chờ: ${what}`);
}

function client(port, root, opts = {}) {
  const store = new Map();
  const c = new CollabClient({
    root, host: '127.0.0.1', port, project: 'p', name: 'c', uid: `u${Math.random()}`, retryMs: 50,
    state: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }, log: () => {}, ...opts,
  });
  c.store = store;
  c.connect();
  return c;
}

async function fakeHub() {
  // Answers like a hub, then sends whatever the test asks for.
  const conns = [];
  const srv = net.createServer((s) => {
    const ls = new C.LineSocket(s);
    ls.on('message', (m) => {
      if (m.t !== 'hello') return;
      ls.send({ t: 'welcome', id: 'x', color: '#000', hubId: 'h', session: 's', project: 'p', files: { '../evil.txt': { kind: 'text', rev: 0, hash: 'x' } }, applied: {}, users: [], activity: [], chat: [] });
      conns.push(ls);
    });
  });
  await new Promise((r) => srv.listen(0, r));
  return { port: srv.address().port, conns, close: () => srv.close() };
}

(async () => {
  // 1. Paths from the hub stay inside the project and respect this machine's exclude list.
  {
    const base = tmp('evil');
    const root = path.join(base, 'project');
    fs.mkdirSync(path.join(root, 'out'), { recursive: true });
    fs.writeFileSync(path.join(base, 'victim.txt'), 'outside');
    fs.writeFileSync(path.join(root, 'out', 'output.csv'), 'my own run\n');
    const evil = await fakeHub();
    const c = client(evil.port, root, { exclude: ['output.csv'] });
    await waitFor(() => c.ready && evil.conns.length, 3000, 'vào hub giả');
    const ls = evil.conns[0];
    ls.send({ t: 'file', path: '../planted.bat', kind: 'text', rev: 0, text: 'echo x' });
    ls.send({ t: 'file', path: 'GIT~1/hooks/pre-commit', kind: 'text', rev: 0, text: 'echo x' });
    ls.send({ t: 'deleted', path: '../victim.txt' });
    ls.send({ t: 'file', path: 'out/output.csv', kind: 'text', rev: 0, text: 'their run\n' });
    ls.send({ t: 'deleted', path: 'out/output.csv' });
    await sleep(300);
    assert.ok(!fs.existsSync(path.join(base, 'planted.bat')), 'không được ghi ra ngoài thư mục dự án');
    assert.ok(!fs.existsSync(path.join(base, 'evil.txt')));
    assert.ok(fs.existsSync(path.join(base, 'victim.txt')), 'không được xoá file ngoài dự án');
    assert.ok(!fs.existsSync(path.join(root, 'GIT~1')));
    assert.strictEqual(fs.readFileSync(path.join(root, 'out', 'output.csv'), 'utf8'), 'my own run\n', 'file bị loại trừ trên máy này phải giữ nguyên');
    c.disconnect();
    evil.close();
  }

  // 2. Windows aliases of excluded folders are refused by the hub.
  const hubRoot = tmp('hub');
  fs.writeFileSync(path.join(hubRoot, 'a.txt'), 'hello');
  const hub = await startHubProcess({ root: hubRoot, project: 'p' });
  const hubFiles = async () => (await probeWelcome(hub.port, { project: 'p' })).files;
  {
    const c = client(hub.port, tmp('c1'));
    await waitFor(() => c.ready && c.loading.size === 0, 3000, 'c1 vào phòng');
    const ignored = [];
    const dispatch = c._dispatch.bind(c);
    c._dispatch = (m) => (m.t === 'ignored' ? ignored.push(m.path) : dispatch(m));
    for (const p of ['GIT~1/hooks/pre-commit', '.git./hooks/x', 'a.txt:stream', 'docs/nul']) c.send({ t: 'create', path: p, kind: 'text', text: 'x' });
    await waitFor(() => ignored.length === 4, 2000, 'hub từ chối 4 đường dẫn');
    assert.deepStrictEqual(Object.keys(await hubFiles()), ['a.txt']);
    assert.ok(!fs.existsSync(path.join(hubRoot, '.git')));
    c.disconnect();
  }

  // 3. A connection that has not logged in cannot make the hub buffer more than a small message.
  {
    const s = net.createConnection({ host: '127.0.0.1', port: hub.port });
    s.on('error', () => {});
    const closed = new Promise((r) => s.on('close', r));
    s.write('x'.repeat(256 * 1024));
    await Promise.race([closed, sleep(2000).then(() => assert.fail('hub phải đóng kết nối chưa đăng nhập gửi dòng quá dài'))]);
  }

  // 4. A resync while an op is in flight: the hub already applied the op, it must not be applied twice.
  {
    const c = client(hub.port, tmp('c2'));
    await waitFor(() => c.ready && c.loading.size === 0, 3000, 'c2 vào phòng');
    const e = c.entries.get('a.txt');
    c.localOp(e, new TextOperation().retain(5).insert(' world'), 'editor');
    c._dispatch({ t: 'resync', path: 'a.txt' });
    await waitFor(() => !e.loading && !e.ot.outstanding, 2000, 'resync xong');
    await sleep(200);
    assert.strictEqual(e.text, 'hello world');
    assert.strictEqual((await hubFiles())['a.txt'].hash, C.sha1('hello world'));

    // An op that cannot be transformed on the hub gets an answer (resync), not silence.
    const answers = [];
    const dispatch = c._dispatch.bind(c);
    c._dispatch = (m) => {
      if (m.path === 'a.txt') answers.push(m.t);
      dispatch(m);
    };
    c.send({ t: 'op', path: 'a.txt', rev: 0, op: [99, 'x'], seq: 999 });
    await waitFor(() => answers.includes('resync'), 2000, 'hub trả lời resync');
    c.disconnect();
  }

  // 5. A binary file counts as synced only once the hub confirms it stored that version.
  {
    const root = tmp('c3');
    const c = client(hub.port, root);
    await waitFor(() => c.ready && c.loading.size === 0, 3000, 'c3 vào phòng');
    fs.writeFileSync(path.join(root, 'data.bin'), Buffer.from([0, 1, 2, 3]));
    c.onDiskEvent(path.join(root, 'data.bin'));
    await waitFor(async () => 'data.bin' in (await hubFiles()), 3000, 'hub nhận data.bin');
    const v1 = C.sha1(Buffer.from([0, 1, 2, 3]));
    await waitFor(() => c.entries.get('data.bin').hubHash === v1, 2000, 'hub xác nhận v1');

    const sent = [];
    const send = c.send.bind(c);
    c.send = (m) => (m.t === 'put' ? sent.push(m) : send(m)); // the put is lost on the way
    fs.writeFileSync(path.join(root, 'data.bin'), Buffer.from([9, 9, 9, 9]));
    c.onDiskEvent(path.join(root, 'data.bin'));
    await waitFor(() => sent.length === 1, 2000, 'put v2');
    c._saveSyncedHashes();
    assert.strictEqual(c.syncedHashes['data.bin'], v1, 'v2 chưa được hub xác nhận, không được ghi là đã đồng bộ');
    c.disconnect();
  }

  await hub.stop();
  assert.strictEqual(fs.readFileSync(path.join(hubRoot, 'a.txt'), 'utf8'), 'hello world');
  console.log('robustness.test.js: OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
