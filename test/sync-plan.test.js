'use strict';

// The first-sync decision against a real hub: a choice per conflicting file (hub, local, merge), cancel, a folder
// joined with its own files, messages that arrive while the decision is open (they wait for the plan), and files
// this member changes while the decision is open (the plan is rebuilt).
// Run: node test/sync-plan.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CollabClient } = require('../lib/client-core');
const { diff } = require('../lib/ot');
const { startHubProcess } = require('./support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';
const SEED = {
  'a.py': lines(10, (i) => `a${i} = ${i}`),
  'b.py': lines(10, (i) => `b${i} = ${i}`),
  'c.py': lines(10, (i) => `c${i} = ${i}`),
  'd.py': lines(10, (i) => `d${i} = ${i}`),
  'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
};

function memory() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v) };
}

class World {
  async start(name) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), `lc-plan-${name}-`));
    this.root = path.join(this.dir, 'root');
    fs.mkdirSync(this.root);
    for (const [rel, data] of Object.entries(SEED)) fs.writeFileSync(path.join(this.root, rel), data);
    this.hub = await startHubProcess({ root: this.root, project: 'P', token: 't' });
    this.clients = [];
  }

  client(name, state, confirmSync, log = () => {}) {
    const root = path.join(this.dir, name);
    fs.mkdirSync(root, { recursive: true });
    const c = new CollabClient({ root, host: '127.0.0.1', port: this.hub.port, token: 't', project: 'P', name, uid: `${name}-${this.clients.length}`, state, confirmSync, retryMs: 200, log });
    this.clients.push(c);
    c.connect();
    return c;
  }

  async stop() {
    for (const c of this.clients) c.disconnect();
    await this.hub.stop();
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

const settled = (c) => until(`${path.basename(c.root)} settled`, () => c.ready && c.loading.size === 0 && [...c.entries.values()].every((e) => e.kind !== 'text' || (!e.ot.outstanding && !e.ot.buffer)));
const disk = (c, rel) => fs.readFileSync(path.join(c.root, rel), 'utf8');
const view = (c, rel) => c.entries.get(rel).text; // bob edits through localOp, which leaves his disk alone
const hubDisk = (w, rel) => fs.readFileSync(path.join(w.root, rel), 'utf8');

// The hub writes a text file to disk a moment after its last op.
const hubFlushed = (w, rel, ok) => until(`hub disk ${rel}`, () => ok(hubDisk(w, rel)));

function edit(c, rel, fn) {
  const e = c.entries.get(rel);
  c.localOp(e, diff(e.text, fn(e.text)), 'editor');
}

// Alice syncs, then goes offline. The returned function brings her back with a fresh core (a restarted VS Code),
// so a file changed on both sides is a conflict instead of a reconnect merge.
async function aliceOffline(w) {
  const state = memory();
  const first = w.client('alice', state);
  await settled(first);
  await sleep(1200); // known files are saved after 1 s
  first.disconnect();
  await first.baseWriting;
  return (confirmSync) => w.client('alice', state, confirmSync);
}

async function mixedChoices(w) {
  const bob = w.client('bob', memory());
  await settled(bob);
  const back = await aliceOffline(w);
  const alice = path.join(w.dir, 'alice');
  fs.writeFileSync(path.join(alice, 'a.py'), SEED['a.py'].replace('a1 = 1', 'a1 = "alice"'));
  fs.writeFileSync(path.join(alice, 'b.py'), SEED['b.py'].replace('b1 = 1', 'b1 = "alice"'));
  edit(bob, 'a.py', (s) => s.replace('a1 = 1', 'a1 = "bob"'));
  edit(bob, 'b.py', (s) => s.replace('b1 = 1', 'b1 = "bob"'));
  await settled(bob);

  let asked = null;
  let previews = null;
  const c = back(async (info) => {
    asked = info;
    previews = { hubA: await info.hubText('a.py'), hubB: await info.hubText('b.py'), localA: info.localText('a.py') };
    return { 'a.py': 'hub', 'b.py': 'local' };
  });
  await settled(c);
  await settled(bob);
  await hubFlushed(w, 'b.py', (t) => t.includes('alice'));

  assert.deepStrictEqual(asked.conflicts.map((r) => r.path).sort(), ['a.py', 'b.py'], 'one row per conflicting file');
  assert.ok(asked.conflicts.every((r) => r.text && r.mergeable), 'text conflicts with a stored base can be merged');
  assert.ok(previews.hubA.includes('a1 = "bob"') && previews.hubB.includes('b1 = "bob"'), 'preview reads the hub text while the plan waits');
  assert.ok(previews.localA.includes('a1 = "alice"'), 'preview reads this machine\'s text');
  for (const [where, read] of [['alice', (rel) => disk(c, rel)], ['bob', (rel) => view(bob, rel)], ['hub', (rel) => hubDisk(w, rel)]]) {
    assert.ok(read('a.py').includes('a1 = "bob"') && !read('a.py').includes('alice'), `${where}: a.py is the hub version`);
    assert.ok(read('b.py').includes('b1 = "alice"') && !read('b.py').includes('bob'), `${where}: b.py is this machine's version`);
  }
  const backups = path.join(c.root, '.lan-collab', 'backup');
  const stamp = fs.readdirSync(backups)[0];
  assert.ok(fs.readFileSync(path.join(backups, stamp, 'a.py'), 'utf8').includes('a1 = "alice"'), 'the replaced local a.py is backed up');
}

async function mergeConflict(w) {
  const bob = w.client('bob', memory());
  await settled(bob);
  const back = await aliceOffline(w);
  fs.writeFileSync(path.join(w.dir, 'alice', 'c.py'), SEED['c.py'].replace('c2 = 2', 'c2 = "alice"'));
  edit(bob, 'c.py', (s) => s.replace('c9 = 9', 'c9 = "bob"'));
  await settled(bob);

  let merged = null;
  const c = back(async (info) => {
    merged = await info.mergedText('c.py');
    return { 'c.py': 'merge' };
  });
  await settled(c);
  await settled(bob);
  await until('bob sees the merge', () => view(bob, 'c.py').includes('alice'));
  const want = SEED['c.py'].replace('c2 = 2', 'c2 = "alice"').replace('c9 = 9', 'c9 = "bob"');
  assert.strictEqual(merged, want, 'merge preview holds both edits');
  await until('alice writes the merge', () => disk(c, 'c.py') === want, 3000).catch(() => {});
  assert.strictEqual(disk(c, 'c.py'), want, 'alice keeps both edits');
  assert.strictEqual(view(bob, 'c.py'), want, 'bob gets both edits');
  await hubFlushed(w, 'c.py', (t) => t === want);
  assert.strictEqual(hubDisk(w, 'c.py'), want, 'the hub holds both edits');
}

async function cancel(w) {
  const bob = w.client('bob', memory());
  await settled(bob);
  const back = await aliceOffline(w);
  const local = SEED['a.py'].replace('a1 = 1', 'a1 = "alice"');
  fs.writeFileSync(path.join(w.dir, 'alice', 'a.py'), local);
  edit(bob, 'a.py', (s) => s.replace('a1 = 1', 'a1 = "bob"'));
  await settled(bob);

  const events = [];
  const c = back(async () => false);
  c.on('connection', (e) => events.push(e.type));
  await until('cancelled', () => events.includes('SYNC_CANCELLED'));
  await sleep(500);
  assert.ok(c.closed && !c.ready, 'a cancelled core stays stopped and does not retry');
  assert.strictEqual(disk(c, 'a.py'), local, 'no local file changed');
  assert.ok(hubDisk(w, 'a.py').includes('a1 = "bob"') && !hubDisk(w, 'a.py').includes('alice'), 'nothing sent to the hub');
  assert.ok(!fs.existsSync(path.join(c.root, '.lan-collab', 'backup')), 'nothing backed up');
}

async function queuedDuringDecision(w) {
  const bob = w.client('bob', memory());
  await settled(bob);
  const back = await aliceOffline(w);
  fs.writeFileSync(path.join(w.dir, 'alice', 'a.py'), SEED['a.py'].replace('a1 = 1', 'a1 = "alice"'));
  edit(bob, 'a.py', (s) => s.replace('a1 = 1', 'a1 = "bob"'));
  await settled(bob);

  let duringDecision = null;
  const c = back(async () => {
    // Bob keeps typing in another file and in the conflicting one while Alice decides.
    for (let i = 0; i < 5; i++) edit(bob, 'd.py', (s) => s.replace(`d${i + 1} = ${i + 1}`, `d${i + 1} = "bob${i}"`));
    edit(bob, 'a.py', (s) => s.replace('a5 = 5', 'a5 = "bob later"'));
    await settled(bob);
    await sleep(200);
    duringDecision = disk(c, 'd.py');
    return { 'a.py': 'hub' };
  });
  await settled(c);
  await until('alice applies the queued edits', () => disk(c, 'd.py').includes('bob4'));
  await settled(c);
  assert.strictEqual(duringDecision, SEED['d.py'], 'nothing was applied before the plan ran');
  const d = disk(c, 'd.py');
  for (let i = 0; i < 5; i++) assert.ok(d.includes(`d${i + 1} = "bob${i}"`), `edit ${i} of bob kept`);
  await hubFlushed(w, 'd.py', (t) => t === d);
  assert.ok(disk(c, 'a.py').includes('a1 = "bob"') && disk(c, 'a.py').includes('a5 = "bob later"'), 'a.py has every hub edit');
}

// A file saved while the panel is open: the plan read at welcome is stale and must not win.
async function editDuringDecision(w) {
  const bob = w.client('bob', memory());
  await settled(bob);
  const back = await aliceOffline(w);
  const alice = path.join(w.dir, 'alice');
  fs.writeFileSync(path.join(alice, 'a.py'), SEED['a.py'].replace('a1 = 1', 'a1 = "alice"'));
  edit(bob, 'a.py', (s) => s.replace('a1 = 1', 'a1 = "bob"'));
  edit(bob, 'b.py', (s) => s.replace('b9 = 9', 'b9 = "bob"'));
  await settled(bob);

  const asked = [];
  const c = back(async (info) => {
    asked.push(info);
    if (asked.length === 1) {
      // d.py was in sync: saving it makes it a local change. b.py was changed only on the hub: saving it makes a conflict.
      for (const [rel, from, to] of [['d.py', 'd1 = 1', 'd1 = "saved meanwhile"'], ['b.py', 'b2 = 2', 'b2 = "saved meanwhile"']]) {
        fs.writeFileSync(path.join(alice, rel), SEED[rel].replace(from, to));
        c.onDiskEvent(path.join(alice, rel)); // what the VS Code file watcher reports
      }
      await sleep(300);
      return { 'a.py': 'hub' };
    }
    return { 'b.py': 'local' };
  });
  await settled(c);
  await hubFlushed(w, 'd.py', (t) => t.includes('saved meanwhile'));
  await hubFlushed(w, 'b.py', (t) => t.includes('saved meanwhile'));
  assert.strictEqual(asked.length, 2, 'asked again for the file that became a conflict');
  assert.deepStrictEqual(asked[1].conflicts.map((r) => r.path), ['a.py', 'b.py']);
  assert.deepStrictEqual(asked[1].chosen, { 'a.py': 'hub' }, 'the earlier choice is offered again');
  assert.ok(disk(c, 'd.py').includes('saved meanwhile') && view(c, 'd.py').includes('saved meanwhile'), 'the saved edit stays on this machine');
  assert.ok(disk(c, 'a.py').includes('a1 = "bob"'), 'the earlier choice still applies');
}

// A reconnect that needs a decision (6 removals) while this member deletes a file it holds open in memory.
async function deleteDuringDecision(w) {
  const bob = w.client('bob', memory());
  await settled(bob);
  for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(w.dir, 'bob', `rm${i}.txt`), `rm ${i}
`);
  for (let i = 1; i <= 6; i++) bob.onDiskEvent(path.join(w.dir, 'bob', `rm${i}.txt`));
  await until('hub holds rm6.txt', () => fs.existsSync(path.join(w.root, 'rm6.txt')));
  const logs = [];
  let asked = 0;
  const c = w.client('alice', memory(), async () => {
    asked += 1;
    if (asked > 1) return true;
    fs.rmSync(path.join(c.root, 'd.py'));
    c.onDiskEvent(path.join(c.root, 'd.py'));
    await sleep(300); // the watcher's debounce drops the entry
    return true;
  }, (line) => logs.push(line));
  await settled(c);
  await until('alice has rm6.txt', () => fs.existsSync(path.join(c.root, 'rm6.txt')));
  await sleep(1200);
  c.ls.close(); // the link drops
  for (let i = 1; i <= 6; i++) bob.send({ t: 'delete', path: `rm${i}.txt` });
  await until('alice asked about the removals', () => asked === 1);
  await until('alice live again', () => c.ready && c.loading.size === 0);
  await sleep(500);
  assert.ok(!logs.some((l) => l.includes('[LỖI]')), `no failed plan: ${logs.filter((l) => l.includes('[LỖI]')).join(' | ')}`);
  assert.strictEqual(asked, 1, 'asked once');
  assert.ok(!fs.existsSync(path.join(c.root, 'rm1.txt')), 'the removals ran');
}

async function joinNonEmpty(w) {
  const root = path.join(w.dir, 'carol');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'a.py'), 'carol a\n');
  fs.writeFileSync(path.join(root, 'b.py'), 'carol b\n');
  fs.writeFileSync(path.join(root, 'c.py'), SEED['c.py']);
  fs.writeFileSync(path.join(root, 'notes.md'), 'only here\n');
  let asked = null;
  const c = w.client('carol', memory(), async (info) => {
    asked = info;
    return { 'b.py': 'local' };
  });
  await settled(c);
  await hubFlushed(w, 'b.py', (t) => t === 'carol b\n');
  assert.strictEqual(asked.firstTime, true);
  assert.deepStrictEqual(asked.replace.map((r) => r.path).sort(), ['a.py', 'b.py'], 'each differing file is a row');
  assert.deepStrictEqual(asked.conflicts, [], 'nothing counts as a conflict on a first sync');
  assert.deepStrictEqual(asked.upload, ['notes.md']);
  assert.deepStrictEqual(asked.get.sort(), ['d.py', 'logo.png']);
  assert.strictEqual(disk(c, 'a.py'), SEED['a.py'], 'a.py takes the hub version by default');
  assert.strictEqual(disk(c, 'b.py'), 'carol b\n', 'b.py keeps the local version');
  assert.strictEqual(hubDisk(w, 'notes.md'), 'only here\n');
  const stamp = fs.readdirSync(path.join(root, '.lan-collab', 'backup'))[0];
  assert.strictEqual(fs.readFileSync(path.join(root, '.lan-collab', 'backup', stamp, 'a.py'), 'utf8'), 'carol a\n', 'the replaced file is backed up');
}

(async () => {
  for (const [name, run] of [['mixed choices', mixedChoices], ['merge', mergeConflict], ['cancel', cancel], ['queued during decision', queuedDuringDecision], ['join non-empty folder', joinNonEmpty], ['edit during decision', editDuringDecision], ['delete during decision', deleteDuringDecision]]) {
    const w = new World();
    await w.start(name.replace(/\W+/g, '-'));
    try {
      await run(w);
      console.log(`${name}: OK`);
    } finally {
      await w.stop();
    }
  }
  console.log('sync-plan.test.js OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
