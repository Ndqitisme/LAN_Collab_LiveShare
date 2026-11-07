'use strict';

// lib/history-client.js against a hub with edit-run history (docs/protocol.md section 12): runs of a file and of
// the project, paging with `before`, blob fetch and its cache, `changed` events, and the three ways B7 writes
// history back: a revert sent as one op with src "revert", a deleted file created again from its deletion run,
// and an older blob version put back. Skipped when the hub does not list `history` (the Node hub).
// Run: LANHUB_CMD=<lanhub-cli path> node test/history-client.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CollabClient } = require('../lib/client-core');
const { HistoryClient, revertRun, bufferOf, BLOB_CACHE } = require('../lib/history-client');
const { diff } = require('../lib/ot');
const { startHubProcess } = require('./support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const PNG = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, n, n, n]);
const SEED = {
  'a.py': 'def a():\n    return 1\n',
  'b.py': 'b = 1\n',
  'c.py': 'def c():\n    return 3\n',
  'logo.png': PNG(1),
};

function memory() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v) };
}

const settled = (c) => until(`${c.name} settled`, () => c.ready && c.loading.size === 0 && [...c.entries.values()].every((e) => e.kind !== 'text' || (!e.ot.outstanding && !e.ot.buffer)));
const text = (c, rel) => c.entries.get(rel).text;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-history-client-'));
  const root = path.join(dir, 'root');
  fs.mkdirSync(root);
  for (const [rel, data] of Object.entries(SEED)) fs.writeFileSync(path.join(root, rel), data);
  const hub = await startHubProcess({ root, project: 'P', token: 't' });
  const clients = [];
  const client = (name) => {
    const r = path.join(dir, name);
    fs.mkdirSync(r);
    const c = new CollabClient({ root: r, host: '127.0.0.1', port: hub.port, token: 't', project: 'P', name, uid: `${name}-uid`, state: memory(), retryMs: 200 });
    clients.push(c);
    c.connect();
    return c;
  };
  try {
    const alice = client('alice');
    const bob = client('bob');
    await settled(alice);
    await settled(bob);
    if (!alice.hasHistory()) {
      console.log('history-client.test.js: skipped, the hub does not list history');
      return;
    }
    const history = new HistoryClient(alice);
    const changed = [];
    history.on('changed', (rel) => changed.push(rel));

    // Each turn edits a.py and waits until the other member has it, so the hub sees one author after the other.
    const turn = async (c, other, rel, fn) => {
      const e = c.entries.get(rel);
      c.localOp(e, diff(e.text, fn(e.text)), 'editor');
      await settled(c);
      await until(`${other.name} has ${rel}`, () => text(other, rel) === text(c, rel));
    };
    await turn(alice, bob, 'a.py', (s) => s.replace('return 1', 'return 1  # alice one'));
    await turn(bob, alice, 'a.py', (s) => `${s}\ndef bob():\n    return 2\n`);
    await turn(alice, bob, 'a.py', (s) => `${s}\ndef alice_two():\n    return 3\n`);
    await turn(bob, alice, 'b.py', (s) => `${s}b2 = 2\n`);

    const page = await until('three runs of a.py', async () => {
      const p = await history.list('a.py');
      return p.runs.length === 3 && p;
    });
    assert.deepStrictEqual(page.runs.map((r) => r.author_name), ['alice', 'bob', 'alice'], 'newest first, alternating authors');
    assert.ok(page.runs.every((r) => r.path === 'a.py' && r.kind === 'text' && r.source === 'editor'), 'text runs from the editor');
    assert.strictEqual(page.more, false);
    assert.ok(Number(page.runs[0].id) > Number(page.runs[1].id), 'ids grow');
    const [aliceTwo, bobRun, aliceOne] = page.runs;
    assert.ok(aliceTwo.open && aliceTwo.end_blob === null, 'the newest run stays open: nobody else edited a.py since');
    assert.ok(!bobRun.open && bobRun.end_blob, 'alice editing after bob ended his run');
    assert.strictEqual(history.run(bobRun.id), bobRun, 'listed runs are kept by id');

    // Paging with before.
    const first = await history.list('a.py', null, 2);
    assert.deepStrictEqual(first.runs.map((r) => r.id), [aliceTwo.id, bobRun.id]);
    assert.strictEqual(first.more, true);
    const second = await history.list('a.py', first.runs[1].id, 2);
    assert.deepStrictEqual(second.runs.map((r) => r.id), [aliceOne.id]);
    assert.strictEqual(second.more, false);

    // Project timeline: every file, newest first.
    const project = await history.list(null);
    assert.deepStrictEqual([...new Set(project.runs.map((r) => r.path))].sort(), ['a.py', 'b.py']);
    assert.deepStrictEqual(project.runs.map((r) => Number(r.id)), project.runs.map((r) => Number(r.id)).sort((x, y) => y - x));

    await until('changed events for a.py and b.py', () => changed.includes('a.py') && changed.includes('b.py'), 3000);

    // Blobs: the content at each boundary, cached by hash.
    const before = await history.blob(bobRun.start_blob);
    const after = await history.blob(bobRun.end_blob);
    assert.strictEqual(before.kind, 'text');
    assert.ok(!before.text.includes('def bob') && after.text.includes('def bob') && !after.text.includes('alice_two'), 'start and end of bob\'s run');
    let asked = 0;
    const real = alice.historyBlob.bind(alice);
    alice.historyBlob = (h) => {
      asked += 1;
      return real(h);
    };
    assert.strictEqual(await history.blob(bobRun.end_blob), after, 'second fetch comes from the cache');
    assert.strictEqual(asked, 0);
    for (let i = 0; i < BLOB_CACHE; i++) history.blobs.set(`fake${i}`, { kind: 'text', text: '' });
    assert.strictEqual(history.blobs.size, BLOB_CACHE + 2);
    await history.blob(aliceOne.start_blob);
    assert.strictEqual(asked, 1);
    assert.ok(history.blobs.size <= BLOB_CACHE + 2 && !history.blobs.has(bobRun.start_blob), 'the least recently used entry goes first');
    while (history.blobs.size > BLOB_CACHE) history.blobs.delete(history.blobs.keys().next().value);
    assert.strictEqual(await history.blob('0'.repeat(64)), null, 'missing blob');
    alice.historyBlob = real;

    // Revert bob's run while alice's later run stays. An op still waiting for its ack makes the revert wait.
    const start = (await history.blob(bobRun.start_blob)).text;
    const end = (await history.blob(bobRun.end_blob)).text;
    const opFor = (cur) => diff(cur, revertRun(start, end, cur).text);
    const e = alice.entries.get('a.py');
    alice.localOp(e, diff(e.text, `${e.text}# typing\n`), 'editor');
    assert.strictEqual(alice.revertEdit('a.py', opFor, bobRun.id), 'busy', 'an op in flight makes the revert wait');
    await settled(alice);
    assert.strictEqual(alice.revertEdit('a.py', opFor, bobRun.id), 'applied');
    await settled(alice);
    await until('bob sees the revert', () => text(bob, 'a.py') === text(alice, 'a.py'));
    const reverted = text(bob, 'a.py');
    assert.ok(!reverted.includes('def bob'), 'bob\'s lines are gone');
    assert.ok(reverted.includes('# alice one') && reverted.includes('def alice_two') && reverted.includes('# typing'), 'alice\'s runs stay');
    const revertRunRecord = await until('a revert run', async () => {
      const r = (await history.list('a.py', null, 1)).runs[0];
      return r && r.source === 'revert' && r;
    });
    assert.strictEqual(revertRunRecord.reverts, bobRun.id, 'the run names the run it undoes');
    assert.strictEqual(revertRunRecord.author_name, 'alice');
    assert.strictEqual(alice.revertEdit('a.py', opFor, bobRun.id), 'noop', 'nothing left to undo');
    assert.strictEqual(alice.revertEdit('missing.py', opFor, bobRun.id), 'unavailable');

    // Restore a deleted text file from its deletion run.
    fs.rmSync(path.join(alice.root, 'c.py'));
    alice.onDiskEvent(path.join(alice.root, 'c.py'));
    await until('bob loses c.py', () => !fs.existsSync(path.join(bob.root, 'c.py')));
    const deletion = await until('deletion run', async () => {
      const r = (await history.list('c.py')).runs[0];
      return r && r.source === 'delete' && r;
    });
    assert.strictEqual(deletion.start_blob, deletion.end_blob);
    assert.ok(alice.writeFileVersion('c.py', bufferOf(await history.blob(deletion.end_blob))));
    await until('c.py back on bob\'s disk', () => fs.existsSync(path.join(bob.root, 'c.py')) && fs.readFileSync(path.join(bob.root, 'c.py'), 'utf8') === SEED['c.py']);
    assert.strictEqual(fs.readFileSync(path.join(alice.root, 'c.py'), 'utf8'), SEED['c.py']);

    // Put an older version of a blob file back.
    for (const n of [2, 3]) {
      fs.writeFileSync(path.join(alice.root, 'logo.png'), PNG(n));
      alice.onDiskEvent(path.join(alice.root, 'logo.png'));
      await until(`bob has logo v${n}`, () => fs.readFileSync(path.join(bob.root, 'logo.png')).equals(PNG(n)));
    }
    const blobRuns = await until('two blob runs', async () => {
      const p = await history.list('logo.png');
      return p.runs.length >= 2 && p.runs;
    });
    assert.ok(blobRuns.every((r) => r.kind === 'blob' && r.source === 'disk'));
    const v2Bytes = bufferOf(await history.blob(blobRuns[1].end_blob));
    assert.ok(v2Bytes.equals(PNG(2)), 'the older run ends with version 2');
    assert.ok(bufferOf(await history.blob(blobRuns[1].start_blob)).equals(PNG(1)), 'and starts with version 1');
    assert.ok(alice.writeFileVersion('logo.png', v2Bytes));
    await until('bob has logo v2 again', () => fs.readFileSync(path.join(bob.root, 'logo.png')).equals(PNG(2)));
    await until('a third blob run', async () => (await history.list('logo.png')).runs.length === blobRuns.length + 1);

    // Checkpoints pass through: every member hears the new list, and a list request answers the asker.
    const heard = new Promise((resolve) => bob.once('checkpoints', resolve));
    assert.ok(history.createCheckpoint('trước khi gộp'));
    assert.deepStrictEqual((await heard).map((c) => c.name), ['trước khi gộp']);
    const listed = await history.checkpoints();
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].author_name, 'alice');

    history.dispose();
    console.log('history-client.test.js: OK');
  } finally {
    for (const c of clients) c.disconnect();
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
