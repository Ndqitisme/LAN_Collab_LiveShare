'use strict';

// A client must never wait forever for a file the hub will not store: it adopts the hub's exclude list,
// the hub answers "ignored" for anything it refuses, and against hubs that stay silent the client gives up
// after a timeout.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CollabClient } = require('../../lib/client-core');
const { startHubProcess, probeWelcome } = require('../support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-excl-${n}-`));

async function waitFor(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(20);
  }
  throw new Error(`Hết giờ chờ: ${what}`);
}

function client(port, root, opts = {}) {
  const store = new Map();
  const c = new CollabClient({
    root, host: '127.0.0.1', port, project: 'Demo', name: 'c', uid: `u${Math.random()}`, retryMs: 50,
    state: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }, ...opts,
  });
  c.logs = [];
  c.log = (l) => c.logs.push(l);
  c.connect();
  return c;
}

function seed(root) {
  fs.mkdirSync(path.join(root, 'products', 'P1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'products', 'P1', 'P1.py'), 'x = 1\n');
  fs.writeFileSync(path.join(root, 'products', 'P1', 'output.csv'), 'local run result\n');
}

(async () => {
  const hubRoot = tmp('hub');
  fs.writeFileSync(path.join(hubRoot, 'shared.txt'), 'shared\n');
  const hub = await startHubProcess({ root: hubRoot, project: 'Demo', exclude: ['output.csv'] });

  // 1. The client has no exclude of its own, but learns the hub's list and does not offer output.csv.
  const r1 = tmp('c1');
  seed(r1);
  const c1 = client(hub.port, r1);
  await waitFor(() => c1.ready && c1.loading.size === 0, 5000, 'c1 đồng bộ xong');
  const { files } = await probeWelcome(hub.port, { project: 'Demo' });
  assert.ok(!('products/P1/output.csv' in files), 'hub không được nhận output.csv');
  assert.ok('products/P1/P1.py' in files);
  assert.ok(fs.existsSync(path.join(r1, 'products', 'P1', 'output.csv')), 'output.csv trên máy phải giữ nguyên');
  assert.ok(fs.existsSync(path.join(r1, 'shared.txt')));

  // 2. A file the hub refuses is answered right away instead of being left pending.
  c1.send({ t: 'create', path: 'other/output.csv', kind: 'text', text: 'x' });
  c1.loading.set('other/output.csv', { mode: 'create', since: Date.now() });
  await waitFor(() => !c1.loading.has('other/output.csv'), 2000, 'hub trả lời ignored');
  assert.ok(c1.hubIgnored.has('other/output.csv'));
  assert.ok(c1.logs.some((l) => l.includes('other/output.csv') && l.includes('loại trừ')));
  c1.disconnect();

  // 3. Old hub behaviour (no exclude list, silent drop): the client stops waiting after the timeout.
  const r2 = tmp('c2');
  seed(r2);
  const c2 = client(hub.port, r2, { createTimeoutMs: 300 });
  const dispatch = c2._dispatch.bind(c2);
  c2._dispatch = (m) => {
    if (m.t === 'ignored') return; // simulate a hub that never answers
    if (m.t === 'welcome') delete m.exclude;
    dispatch(m);
  };
  const handleWelcome = c2._on_welcome.bind(c2);
  c2._on_welcome = (w) => {
    delete w.exclude;
    handleWelcome(w);
  };
  await waitFor(() => c2.ready, 5000, 'c2 vào phòng');
  assert.ok(c2.loading.has('products/P1/output.csv'), 'kịch bản cần output.csv đang chờ');
  await waitFor(() => c2.loading.size === 0, 8000, 'c2 hết chờ sau timeout');
  assert.ok(c2.hubIgnored.has('products/P1/output.csv'));
  assert.ok(c2.logs.some((l) => l.includes('products/P1/output.csv') && l.includes('không trả lời')));

  // Not offered again in this session when it changes.
  fs.writeFileSync(path.join(r2, 'products', 'P1', 'output.csv'), 'new run\n');
  c2.onDiskEvent(path.join(r2, 'products', 'P1', 'output.csv'));
  await sleep(400);
  assert.ok(!c2.loading.has('products/P1/output.csv'));
  c2.disconnect();

  await hub.stop();
  console.log('exclude.test.js: OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
