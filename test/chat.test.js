'use strict';

// Account allow-list on the hub, chat broadcast, chat history on join and across a hub restart, @mentions.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startHub } = require('../hub/hub');
const { CollabClient } = require('../lib/client-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-chat-${n}-`));

async function waitFor(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(20);
  }
  throw new Error(`Hết giờ chờ: ${what}`);
}

function client(port, name, account) {
  const store = new Map();
  const c = new CollabClient({
    root: tmp(name), host: '127.0.0.1', port, project: 'Demo', name, account, uid: name, retryMs: 50,
    state: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
  });
  c.fatalMsg = null;
  c.on('fatal', (msg, code) => {
    c.fatalMsg = msg;
    c.fatalCode = code;
  });
  c.connect();
  return c;
}

(async () => {
  const root = tmp('hub');
  const history = tmp('hist');
  const allowFile = path.join(tmp('cfg'), 'allowed.txt');
  fs.writeFileSync(allowFile, '# comment\ngithub:Alice\n  bob@corp.com  # any provider\n');
  let hub = await startHub({ root, port: 0, project: 'Demo', history, allowFile, log: () => {} });

  // Allow-list: matching is case-insensitive; with or without provider prefix.
  const alice = client(hub.port, 'alice', { provider: 'github', label: 'alice' });
  const bob = client(hub.port, 'bob', { provider: 'microsoft', label: 'Bob@corp.com' });
  const mallory = client(hub.port, 'mallory', { provider: 'github', label: 'mallory' });
  const anon = client(hub.port, 'anon', null);
  await waitFor(() => alice.ready && bob.ready && mallory.fatalMsg && anon.fatalMsg, 5000, 'vào phòng / bị từ chối');
  assert.strictEqual(mallory.fatalCode, 'account');
  assert.match(mallory.fatalMsg, /github:mallory/);
  assert.strictEqual(anon.fatalCode, 'account');
  assert.ok(!mallory.ready && !anon.ready);
  assert.deepStrictEqual([...alice.users.values()].map((u) => u.account), [{ provider: 'microsoft', label: 'Bob@corp.com' }]);

  // Chat reaches everyone (sender included, in hub order); junk is ignored.
  alice.send({ t: 'chat', text: 42 });
  alice.send({ t: 'chat', text: '   ' });
  assert.ok(alice.sendChat('Vui lòng xem todo/PD1/PD1.py:12'));
  await sleep(50);
  assert.ok(bob.sendChat('@alice Đã nhận, sẽ sửa dòng này'));
  await waitFor(() => alice.chat.length === 2 && bob.chat.length === 2, 3000, 'chat tới cả hai');
  assert.deepStrictEqual(alice.chat.map((m) => m.text), bob.chat.map((m) => m.text));
  assert.strictEqual(alice.chat[0].from, 'alice');
  assert.deepStrictEqual(alice.chat[0].account, { provider: 'github', label: 'alice' });
  assert.ok(alice.mentionsMe(bob.chat[1]));
  assert.ok(!bob.mentionsMe(bob.chat[1]));
  assert.ok(bob.mentionsMe({ text: 'Họp lúc 15:00 @all' }));

  // Editing the allow-list needs no restart; a newcomer gets the history.
  fs.appendFileSync(allowFile, 'carol\n');
  const carol = client(hub.port, 'carol', { provider: 'github', label: 'Carol' });
  await waitFor(() => carol.ready, 3000, 'carol vào phòng');
  assert.deepStrictEqual(carol.chat.map((m) => m.text), alice.chat.map((m) => m.text));

  // History survives a hub restart.
  for (const c of [alice, bob, carol, mallory, anon]) c.disconnect();
  await hub.close();
  hub = await startHub({ root, port: 0, project: 'Demo', history, allowFile, log: () => {} });
  const dave = client(hub.port, 'dave', { provider: 'github', label: 'alice' });
  await waitFor(() => dave.ready, 3000, 'vào lại sau khi hub khởi động lại');
  assert.deepStrictEqual(dave.chat.map((m) => m.text), ['Vui lòng xem todo/PD1/PD1.py:12', '@alice Đã nhận, sẽ sửa dòng này']);

  // No allow-list file: anyone with the token may join, also without an account.
  dave.disconnect();
  await hub.close();
  fs.writeFileSync(allowFile, '# nobody listed\n');
  hub = await startHub({ root, port: 0, project: 'Demo', history, allowFile, log: () => {} });
  const eve = client(hub.port, 'eve', null);
  await waitFor(() => eve.ready, 3000, 'danh sách trống: vào tự do');
  eve.disconnect();
  await hub.close();
  console.log('chat.test.js: OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
