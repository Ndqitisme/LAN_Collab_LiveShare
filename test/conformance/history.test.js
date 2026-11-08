'use strict';

// Edit-run history (docs/protocol.md section 12, feature `history`): run boundaries (another author, an
// idle gap shortened with --history-idle-ms, a checkpoint, a delete, a hub stop or kill), sources and
// `reverts`, blob runs, history_list paging, history_blob, history_changed (at most one per path per second),
// checkpoints, and retention
// applied from lanhub.toml.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { test } = require('node:test');
const C = require('../../lib/common');
const { TextOperation } = require('../../lib/ot');
const { startHubProcess } = require('../support/hub-process');

const IDLE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-history-${n}-`));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sockets = new Set();

class Member {
  constructor(port, name) {
    this.name = name;
    this.ls = new C.LineSocket(net.createConnection({ host: '127.0.0.1', port }));
    this.ls.on('error', () => {});
    sockets.add(this);
    this.msgs = [];
    this.texts = new Map();
    this.revs = new Map();
    this.pending = null;
    this.closed = false;
    this.waiters = [];
    this.ls.on('close', () => {
      this.closed = true;
      this._wake();
    });
    this.ls.on('message', (m) => this._on(m));
  }

  _wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  _on(m) {
    this.msgs.push(m);
    if (m.t === 'welcome') this.welcome = m;
    if (m.t === 'file' && m.kind === 'text') {
      this.texts.set(m.path, m.text);
      this.revs.set(m.path, m.rev);
    } else if (m.t === 'op') {
      this.texts.set(m.path, TextOperation.fromJSON(m.op).apply(this.texts.get(m.path)));
      this.revs.set(m.path, m.rev + 1);
    } else if (m.t === 'ack' && this.pending && this.pending.path === m.path) {
      this.texts.set(m.path, this.pending.after);
      this.revs.set(m.path, m.rev);
      this.pending = null;
    }
    this._wake();
  }

  // Resolves to the first truthy value of pred().
  until(pred, ms = 5000, what = 'condition') {
    const end = Date.now() + ms;
    return new Promise((resolve, reject) => {
      const check = () => {
        const v = pred();
        if (v) return resolve(v);
        if (this.closed) return reject(new Error(`${this.name}: connection closed waiting for ${what}`));
        if (Date.now() > end) return reject(new Error(`${this.name}: timeout waiting for ${what}`));
        this.waiters.push(check);
        setTimeout(() => this._wake(), Math.max(0, Math.min(100, end - Date.now())));
      };
      check();
    });
  }

  async hello(project = 'Demo') {
    await new Promise((r) => this.ls.sock.once('connect', r));
    this.ls.send({ t: 'hello', proto: C.PROTO_V2, project, name: this.name, uid: this.name });
    await this.until(() => this.welcome, 5000, 'welcome');
  }

  async open(p) {
    this.ls.send({ t: 'get', path: p });
    await this.until(() => this.revs.has(p), 5000, `file ${p}`);
  }

  async edit(p, s, extra = {}) {
    const text = this.texts.get(p);
    this.pending = { path: p, after: text + s };
    const op = new TextOperation().retain(text.length).insert(s);
    this.ls.send({ t: 'op', path: p, rev: this.revs.get(p), op: op.toJSON(), ...extra });
    await this.until(() => !this.pending, 5000, `ack on ${p}`);
  }

  // Sends msg and resolves to the first later message of type t that matches pred.
  ask(msg, t, pred = () => true) {
    const from = this.msgs.length;
    this.ls.send(msg);
    return this.until(() => this.msgs.slice(from).find((m) => m.t === t && pred(m)), 5000, t);
  }

  list(p, extra = {}) {
    const msg = { t: 'history_list', ...extra };
    if (p !== undefined) msg.path = p;
    return this.ask(msg, 'history_runs', (m) => m.path === (p ?? null) && m.before === (extra.before ?? null));
  }

  async blob(sha) {
    return this.ask({ t: 'history_blob', blob: sha }, 'history_blob', (m) => m.blob === sha);
  }

  async blobText(sha) {
    const b = await this.blob(sha);
    assert.strictEqual(b.kind, 'text', `blob ${sha}: ${JSON.stringify(b).slice(0, 200)}`);
    return b.text;
  }

  changed(p) {
    return this.msgs.filter((m) => m.t === 'history_changed' && m.path === p).length;
  }

  close() {
    sockets.delete(this);
    this.ls.close();
  }
}

async function member(port, name, files = [], project = 'Demo') {
  const m = new Member(port, name);
  await m.hello(project);
  for (const f of files) await m.open(f);
  return m;
}

// Waits until b holds the same rev of p as a, so b's next op is not concurrent with a's.
async function synced(a, b, p) {
  await b.until(() => b.revs.get(p) === a.revs.get(p), 5000, `${b.name} at ${a.name}'s rev of ${p}`);
}

// Every blob file on disk decompresses to bytes whose SHA-256 is its name. Returns the set of names.
function checkBlobFiles(historyDir) {
  const dir = path.join(historyDir, 'blobs');
  const names = new Set();
  if (!fs.existsSync(dir)) return names;
  for (const sub of fs.readdirSync(dir)) {
    if (!/^[0-9a-f]{2}$/.test(sub)) continue;
    for (const f of fs.readdirSync(path.join(dir, sub))) {
      const m = /^([0-9a-f]{64})\.zst$/.exec(f);
      assert.ok(m, `unexpected file ${sub}/${f} in blobs`);
      const bytes = zlib.zstdDecompressSync(fs.readFileSync(path.join(dir, sub, f)));
      assert.strictEqual(sha256(bytes), m[1], `blob ${f} holds other bytes`);
      assert.ok(m[1].startsWith(sub));
      names.add(m[1]);
    }
  }
  return names;
}

function referenced(runs) {
  const s = new Set();
  for (const r of runs) {
    if (r.start_blob) s.add(r.start_blob);
    if (r.end_blob) s.add(r.end_blob);
  }
  return s;
}

// Polls history_list until `path` has n runs (retention runs on the history thread after a config change).
async function runsBecome(m, p, n, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const { runs } = await m.list(p);
    if (runs.length === n) return runs;
    if (Date.now() > end) throw new Error(`${p}: ${runs.length} runs, expected ${n}`);
    await sleep(100);
  }
}

test('edit runs are recorded and served over the protocol', async (t) => {
  const root = tmp('root');
  const historyDir = path.join(root, '.lan-collab', 'history');
  const FILES = ['a.py', 'b.py', 'c.py', 'd.py', 'e.py', 'f.py', 'k.py', 'm.py', 'p.txt'];
  for (const f of FILES) fs.writeFileSync(path.join(root, f), 'x\n');
  // Left by the Node hub in the same folder: never touched.
  fs.mkdirSync(path.join(historyDir, 'blobs'), { recursive: true });
  fs.writeFileSync(path.join(historyDir, 'a.py.2026-01-01T00-00-00'), 'node snapshot');
  const start = () => startHubProcess({ root, project: 'Demo', args: ['--history-idle-ms', String(IDLE_MS)] });
  let hub = await start();
  let alice;
  let bob;
  try {
    alice = await member(hub.port, 'alice', FILES);
    bob = await member(hub.port, 'bob', FILES);
    assert.ok(alice.welcome.features.includes('history'));
    assert.ok(fs.existsSync(path.join(historyDir, 'history.db')), 'history.db is in <root>/.lan-collab/history');

    await t.test('two members taking ten turns make ten runs with alternating authors', async () => {
      const ends = [];
      const added = [];
      for (let turn = 0; turn < 10; turn++) {
        const [m, other] = turn % 2 ? [bob, alice] : [alice, bob];
        const a = `${m.name}${turn} é😀`;
        const b = `-${turn}\r\n`;
        await m.edit('a.py', a);
        await m.edit('a.py', b);
        ends.push(m.texts.get('a.py'));
        added.push(a.length + b.length);
        await synced(m, other, 'a.py');
      }
      const { runs, more } = await alice.list('a.py');
      assert.ok(alice.changed('a.py') >= 1, 'the first boundary is announced at once');
      await alice.until(() => alice.changed('a.py') >= 2, 3000, 'the rest of the burst in one history_changed a second later');
      assert.strictEqual(more, false);
      assert.strictEqual(runs.length, 10);
      const chrono = [...runs].reverse();
      for (let i = 0; i < 10; i++) {
        const r = chrono[i];
        const who = i % 2 ? bob : alice;
        assert.strictEqual(typeof r.id, 'string');
        assert.strictEqual(r.path, 'a.py');
        assert.strictEqual(r.author_uid, who.name);
        assert.strictEqual(r.author_name, who.name);
        assert.strictEqual(r.color, who.welcome.color);
        assert.strictEqual(r.source, 'editor');
        assert.strictEqual(r.kind, 'text');
        assert.strictEqual(r.op_count, 2);
        assert.strictEqual(r.chars_added, added[i], `run ${i}: UTF-16 units inserted`);
        assert.strictEqual(r.chars_removed, 0);
        assert.strictEqual(r.reverts, null);
        assert.ok(r.started_at <= r.ended_at);
        if (i > 0) {
          assert.strictEqual(r.start_blob, chrono[i - 1].end_blob, 'a run starts where the previous one ended');
          assert.ok(Number(r.id) > Number(chrono[i - 1].id));
          assert.ok(r.started_at >= chrono[i - 1].ended_at);
        }
        if (i < 9) {
          assert.strictEqual(r.open, false);
          assert.strictEqual(await alice.blobText(r.end_blob), ends[i], `end_blob of run ${i} is the exact text`);
        }
      }
      assert.strictEqual(await alice.blobText(chrono[0].start_blob), 'x\n');
      assert.strictEqual(chrono[9].open, true, 'the current run is listed open');
      assert.strictEqual(chrono[9].end_blob, null);
    });

    await t.test('sources come from op.src and a revert run carries op.reverts', async () => {
      const target = (await alice.list('a.py', { limit: 1 })).runs[0].id;
      await alice.edit('b.py', 'disk\n', { src: 'disk' });
      await alice.edit('b.py', 'merge\n', { src: 'merge' });
      await alice.edit('b.py', 'r1\n', { src: 'revert', reverts: target });
      await alice.edit('b.py', 'r2\n', { src: 'revert', reverts: target });
      await alice.edit('b.py', 'typed\n', { src: 'editor' });
      await alice.edit('b.py', 'odd\n', { src: 'bogus' });
      await alice.edit('b.py', 'nosrc\n');
      const chrono = (await alice.list('b.py')).runs.reverse();
      assert.deepStrictEqual(
        chrono.map((r) => [r.source, r.op_count, r.reverts]),
        [['disk', 1, null], ['merge', 1, null], ['revert', 2, target], ['editor', 3, null]],
      );
    });

    await t.test('an idle gap closes the run and the next edit opens another', async () => {
      await alice.edit('c.py', 'one\n');
      await alice.edit('c.py', 'two\n');
      const before = alice.changed('c.py');
      await alice.until(() => alice.changed('c.py') > before, IDLE_MS + 3000, 'idle close of c.py');
      await alice.edit('c.py', 'three\n');
      const chrono = (await alice.list('c.py')).runs.reverse();
      assert.strictEqual(chrono.length, 2);
      assert.deepStrictEqual(chrono.map((r) => [r.author_uid, r.op_count, r.open]), [['alice', 2, false], ['alice', 1, true]]);
      assert.ok(chrono[1].started_at - chrono[0].ended_at >= IDLE_MS, 'the idle run ended at its last op');
      assert.strictEqual(await alice.blobText(chrono[0].end_blob), 'x\none\ntwo\n');
    });

    await t.test('a checkpoint closes every open run and is listed', async () => {
      await alice.edit('d.py', 'alice d\n');
      await bob.edit('e.py', 'bob e\n');
      const cl = await alice.ask({ t: 'checkpoint_create', name: '  before-refactor  ' }, 'checkpoint_list');
      const cp = cl.checkpoints[cl.checkpoints.length - 1];
      assert.strictEqual(cp.name, 'before-refactor');
      assert.strictEqual(cp.author_uid, 'alice');
      await bob.until(() => bob.msgs.some((m) => m.t === 'checkpoint_list'), 5000, 'checkpoint_list broadcast');
      for (const p of ['d.py', 'e.py', 'c.py']) {
        const [last] = (await alice.list(p, { limit: 1 })).runs;
        assert.strictEqual(last.open, false, `${p} closed by the checkpoint`);
        assert.strictEqual(last.ended_at, cp.created_at, `${p} ended at the checkpoint time`);
        assert.ok(Number(last.id) <= Number(cp.last_run));
      }
      const listed = await bob.ask({ t: 'checkpoint_list' }, 'checkpoint_list');
      assert.deepStrictEqual(listed.checkpoints, cl.checkpoints);
      await alice.edit('d.py', 'after\n');
      const d = (await alice.list('d.py')).runs;
      assert.deepStrictEqual(d.map((r) => [r.author_uid, r.open]), [['alice', true], ['alice', false]], 'same author, new run after the checkpoint');
    });

    await t.test('a delete closes the run and records a delete run that keeps the text', async () => {
      await alice.edit('f.py', 'alice f\n');
      await synced(alice, bob, 'f.py');
      const text = alice.texts.get('f.py');
      bob.ls.send({ t: 'delete', path: 'f.py' });
      await alice.until(() => alice.msgs.some((m) => m.t === 'deleted' && m.path === 'f.py'), 5000, 'deleted');
      const [del, edit] = (await alice.list('f.py')).runs;
      assert.deepStrictEqual([del.source, del.kind, del.author_uid, del.open], ['delete', 'text', 'bob', false]);
      assert.strictEqual(del.end_blob, del.start_blob);
      assert.strictEqual(await alice.blobText(del.end_blob), text);
      assert.strictEqual(del.chars_removed, text.length);
      assert.deepStrictEqual([edit.author_uid, edit.open], ['alice', false]);
      assert.ok(edit.ended_at <= del.started_at);
    });

    await t.test('every create or put of a blob is one closed run from the old to the new bytes', async () => {
      const v1 = Buffer.from([0, 1, 2, 3, 255]);
      const v2 = Buffer.from([0, 9, 8, 7]);
      const v3 = Buffer.from([0, 42]);
      await alice.ask({ t: 'put', path: 'img.bin', b64: v1.toString('base64') }, 'stored', (m) => m.path === 'img.bin');
      await bob.ask({ t: 'put', path: 'img.bin', b64: v2.toString('base64') }, 'stored', (m) => m.path === 'img.bin');
      const [r2, r1] = (await alice.list('img.bin')).runs;
      assert.deepStrictEqual([r1.kind, r1.source, r1.author_uid, r1.open, r1.op_count], ['blob', 'disk', 'alice', false, 1]);
      assert.deepStrictEqual([r1.start_blob, r1.end_blob], [null, sha256(v1)]);
      assert.deepStrictEqual([r2.author_uid, r2.start_blob, r2.end_blob], ['bob', sha256(v1), sha256(v2)]);
      const b = await alice.blob(r2.end_blob);
      assert.deepStrictEqual([b.kind, b.b64], ['blob', v2.toString('base64')]);

      await alice.ask({ t: 'create', path: 'new.png', kind: 'blob', b64: v3.toString('base64') }, 'file', (m) => m.path === 'new.png');
      const [c] = (await alice.list('new.png')).runs;
      assert.deepStrictEqual([c.kind, c.start_blob, c.end_blob], ['blob', null, sha256(v3)]);
      alice.ls.send({ t: 'delete', path: 'new.png' });
      await bob.until(() => bob.msgs.some((m) => m.t === 'deleted' && m.path === 'new.png'), 5000, 'deleted new.png');
      const [del] = (await alice.list('new.png')).runs;
      assert.deepStrictEqual([del.source, del.kind, del.start_blob, del.end_blob], ['delete', 'blob', sha256(v3), sha256(v3)]);

      // A put right after an edit, before the hub wrote the text to disk.
      await alice.edit('p.txt', 'not on disk yet\n');
      await alice.ask({ t: 'put', path: 'p.txt', b64: v1.toString('base64') }, 'stored', (m) => m.path === 'p.txt');
      const [blobRun, textRun] = (await alice.list('p.txt')).runs;
      assert.strictEqual(blobRun.kind, 'blob');
      assert.strictEqual(blobRun.start_blob, textRun.end_blob, 'the blob run starts from the text the hub held');
      assert.strictEqual(await alice.blobText(blobRun.start_blob), 'x\nnot on disk yet\n');
    });

    await t.test('history_list pages by before and limit, per path and project-wide', async () => {
      const all = (await alice.list(undefined, { limit: 200 })).runs;
      assert.ok(all.length > 20);
      const ids = all.map((r) => Number(r.id));
      assert.deepStrictEqual(ids, [...ids].sort((x, y) => y - x), 'newest first');
      const paged = [];
      let before;
      for (;;) {
        const page = await alice.list(undefined, before ? { limit: 7, before } : { limit: 7 });
        assert.ok(page.runs.length <= 7);
        paged.push(...page.runs);
        if (!page.more) break;
        before = page.runs[page.runs.length - 1].id;
      }
      assert.deepStrictEqual(paged.map((r) => r.id), all.map((r) => r.id));
      const p1 = await alice.list('a.py', { limit: 4 });
      const p2 = await alice.list('a.py', { limit: 4, before: p1.runs[3].id });
      const p3 = await alice.list('a.py', { limit: 4, before: p2.runs[3].id });
      assert.deepStrictEqual([p1.more, p2.more, p3.more, p3.runs.length], [true, true, false, 2]);
      assert.deepStrictEqual([...p1.runs, ...p2.runs, ...p3.runs].map((r) => r.id), all.filter((r) => r.path === 'a.py').map((r) => r.id));
    });

    await t.test('history_blob answers missing for an unknown or malformed hash', async () => {
      assert.strictEqual((await alice.blob('0'.repeat(64))).missing, true);
      assert.strictEqual((await alice.blob('../history.db')).missing, true);
    });

    await t.test('a hub stop closes the open run at the stop time; the next edit opens a new run', async () => {
      await alice.edit('k.py', 'before stop\n');
      const text = alice.texts.get('k.py');
      alice.close();
      bob.close();
      await hub.stop();
      hub = await start();
      alice = await member(hub.port, 'alice', ['k.py', 'm.py']);
      const [r] = (await alice.list('k.py')).runs;
      assert.strictEqual(r.open, false);
      assert.strictEqual(await alice.blobText(r.end_blob), text);
      await alice.edit('k.py', 'after\n');
      assert.deepStrictEqual((await alice.list('k.py')).runs.map((x) => x.open), [true, false]);
    });

    await t.test('after a forced kill the restarted hub closes the run left open', async () => {
      await alice.edit('m.py', 'killed mid-run\n');
      await alice.edit('m.py', 'second op\n');
      const text = alice.texts.get('m.py');
      await sleep(800); // the text reaches the disk (flushed 500 ms after an edit), the run is committed
      alice.close();
      await hub.kill();
      hub = await start();
      alice = await member(hub.port, 'alice', ['m.py']);
      const [r] = (await alice.list('m.py')).runs;
      assert.deepStrictEqual([r.open, r.op_count], [false, 2]);
      assert.strictEqual(await alice.blobText(r.end_blob), text);
      await alice.edit('m.py', 'next\n');
      assert.deepStrictEqual((await alice.list('m.py')).runs.map((x) => x.open), [true, false]);
      checkBlobFiles(historyDir);
      assert.ok(fs.existsSync(path.join(historyDir, 'a.py.2026-01-01T00-00-00')), 'Node hub files stay');
    });
  } finally {
    for (const m of sockets) m.close();
    await hub.stop();
  }
});

test('retention from lanhub.toml keeps the newest run of each file and drops unreferenced blobs', async () => {
  const root = tmp('ret');
  const historyDir = path.join(root, '.lan-collab', 'history');
  for (const f of ['r.py', 's.py']) fs.writeFileSync(path.join(root, f), 'x\n');
  fs.mkdirSync(path.join(historyDir, 'blobs'), { recursive: true });
  fs.writeFileSync(path.join(historyDir, 'blobs', 'notes.txt.2026-01-01T00-00-00'), 'node snapshot of blobs/notes.txt');
  const file = path.join(tmp('cfg'), 'lanhub.toml');
  const write = (history) =>
    fs.writeFileSync(file, `[hub]\ndiscovery = false\n\n[[project]]\nname = "Ret"\nroot = '${root}'\n${history}`);
  write('');
  const hub = await startHubProcess({ config: file });
  try {
    const alice = await member(hub.port, 'alice', ['r.py', 's.py'], 'Ret');
    const bob = await member(hub.port, 'bob', ['r.py', 's.py'], 'Ret');
    for (let turn = 0; turn < 3; turn++) {
      const [m, other] = turn % 2 ? [bob, alice] : [alice, bob];
      await m.edit('r.py', `${m.name} ${turn}\n`);
      await synced(m, other, 'r.py');
    }
    const big = [0, 1, 2].map(() => crypto.randomBytes(450 * 1024));
    for (const b of big) await alice.ask({ t: 'put', path: 'big.bin', b64: b.toString('base64') }, 'stored', (m) => m.path === 'big.bin');
    assert.strictEqual((await alice.list('big.bin')).runs.length, 3);

    // Size: about 1.3 MiB of blobs against 1 MiB. The oldest runs go until it fits.
    await sleep(1200); // the burst's trailing history_changed
    const seen = alice.changed('big.bin');
    write('\n[project.history]\nmax_mb = 1\n');
    const bigRuns = await runsBecome(alice, 'big.bin', 1);
    await alice.until(() => alice.changed('big.bin') > seen, 3000, 'history_changed for the pruned runs');
    assert.deepStrictEqual([bigRuns[0].start_blob, bigRuns[0].end_blob], [sha256(big[1]), sha256(big[2])]);
    const rRuns = (await alice.list('r.py')).runs;
    assert.ok(rRuns.length >= 1 && rRuns[0].open, 'the open run stays');

    // Age: keep_days = 0 leaves only the newest run of each file.
    for (let turn = 0; turn < 2; turn++) {
      const [m, other] = turn % 2 ? [bob, alice] : [alice, bob];
      await m.edit('s.py', `${m.name} s${turn}\n`);
      await synced(m, other, 's.py');
    }
    await alice.ask({ t: 'checkpoint_create', name: 'close all' }, 'checkpoint_list');
    assert.strictEqual((await alice.list('s.py')).runs.length, 2);
    write('\n[project.history]\nmax_mb = 1\nkeep_days = 0\n');
    await runsBecome(alice, 's.py', 1);
    const all = (await alice.list(undefined, { limit: 200 })).runs;
    assert.deepStrictEqual(all.map((r) => r.path).sort(), ['big.bin', 'r.py', 's.py']);
    assert.deepStrictEqual(checkBlobFiles(historyDir), referenced(all), 'exactly the referenced blobs are on disk');
    assert.ok(fs.existsSync(path.join(historyDir, 'blobs', 'notes.txt.2026-01-01T00-00-00')), 'Node hub files stay');
  } finally {
    for (const m of sockets) m.close();
    await hub.stop();
  }
});
