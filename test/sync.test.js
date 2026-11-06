'use strict';

// End-to-end: a real hub + 3 clients on temp folders. Simulated VS Code editors (async edits, version
// checks, delayed change events, CRLF normalisation), simulated AI writes to disk, dropped connections.
// After the storm every copy (hub memory, hub disk, each client's view, editors, disks) must be identical.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startHub } = require('../hub/hub');
const { CollabClient } = require('../lib/client-core');
const { EditorBinding, normalizeEol } = require('../lib/editor-binding');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Editors never place a cursor inside a CRLF or a surrogate pair.
function boundary(t, i) {
  const c = t.charCodeAt(i - 1);
  if ((t[i - 1] === '\r' && t[i] === '\n') || (c >= 0xd800 && c <= 0xdbff)) return i - 1;
  return i;
}

// Mimics VS Code: the renderer owns the model; the extension host sees changes later, in order.
class FakeEditor {
  constructor(r, text, eol, file, rel, stats) {
    this.rel = rel;
    this.stats = stats;
    this.r = r;
    this.eol = eol;
    this.file = file;
    this.rText = text;
    this.rVer = 1;
    this.hText = text;
    this.hVer = 1;
    this.hDirty = false;
    this.queue = [];
    this.pumping = false;
    this.binding = null;
  }

  adapter() {
    return {
      getText: () => this.hText,
      isDirty: () => this.hDirty,
      eol: () => this.eol,
      applyEdits: (edits) => this._applyFromExtension(edits),
      save: () => this._save(),
    };
  }

  _push(ev) {
    this.queue.push(ev);
    this._pump();
  }

  _pump() {
    if (this.pumping) return;
    this.pumping = true;
    setTimeout(() => {
      this.pumping = false;
      const ev = this.queue.shift();
      if (ev) this._deliver(ev);
      if (this.queue.length) this._pump();
    }, Math.floor(this.r() * 4));
  }

  _deliver(ev) {
    if (ev.kind === 'willSave') this.binding && this.binding.onWillSave();
    else if (ev.kind === 'saved') {
      this.hDirty = this.hText !== ev.text;
      this.binding && this.binding.onSaved();
    } else {
      this.hText = ev.text;
      this.hVer = ev.ver;
      this.hDirty = true;
      this.binding && this.binding.onDocChange(ev.changes, ev.text);
    }
    if (ev.done) ev.done();
  }

  // A keystroke-ish edit by the person at this machine.
  type() {
    const t = this.rText;
    const at = boundary(t, Math.floor(this.r() * (t.length + 1)));
    const len = this.stats.noDelete ? 0 : boundary(t, Math.min(t.length, at + (this.r() < 0.3 ? Math.floor(this.r() * 4) : 0))) - at;
    const pool = ['a', 'b', 'Đ', ' ', this.eol, '🙂', 'xyz'];
    // A unique trailing char per keystroke: an edit identical to an in-flight remote edit (same offset, same
    // text) is indistinguishable from its echo; real typing virtually never hits that, the random test would.
    this.stats.n = (this.stats.n || 0) + 1;
    const ins = this.r() < 0.85 ? pool[Math.floor(this.r() * pool.length)] + String.fromCharCode(0x4e00 + this.stats.n) : '';
    if (!ins && !len) return;
    this.rText = t.slice(0, at) + ins + t.slice(at + len);
    this.stats.inserted[this.rel] = (this.stats.inserted[this.rel] || 0) + ins.length;
    this.rVer += 1;
    this._push({ changes: [{ rangeOffset: at, rangeLength: len, text: ins }], text: this.rText, ver: this.rVer });
  }

  _applyFromExtension(edits) {
    const atVer = this.hVer;
    return new Promise((resolve) => setTimeout(() => {
      if (this.rVer !== atVer) {
        resolve(false);
        return;
      }
      let t = this.rText;
      const changes = [];
      for (const ed of [...edits].sort((x, y) => y.start - x.start)) {
        const text = normalizeEol(ed.text, this.eol);
        changes.push({ rangeOffset: ed.start, rangeLength: ed.end - ed.start, text });
        t = t.slice(0, ed.start) + text + t.slice(ed.end);
      }
      this.rText = t;
      this.rVer += 1;
      this._push({ changes, text: t, ver: this.rVer, done: () => resolve(true) });
    }, Math.floor(this.r() * 5)));
  }

  _save() {
    return new Promise((resolve) => {
      this._push({ kind: 'willSave' });
      setTimeout(() => {
        const text = this.rText;
        fs.writeFileSync(this.file, this.binding.bom + text);
        this.binding.core.onDiskEvent(this.file); // the file watcher also sees our own save
        this._push({ kind: 'saved', text, done: () => resolve(true) });
      }, Math.floor(this.r() * 3));
    });
  }

  idle() {
    return this.queue.length === 0 && this.rText === this.hText;
  }
}

function mkdtemp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-${name}-`));
}

async function waitFor(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(25);
  }
  throw new Error(`Hết giờ chờ: ${what}`);
}

async function runScenario(seed, noDelete) {
  const r = rng(seed);
  const stats = { noDelete, inserted: {} };
  const hubRoot = mkdtemp('hub');
  fs.writeFileSync(path.join(hubRoot, 'a.py'), 'def main():\n    return 1\n');
  fs.writeFileSync(path.join(hubRoot, 'bom.csv'), '﻿col1,col2\n1,2\n');
  fs.writeFileSync(path.join(hubRoot, 'crlf.py'), 'line1\r\nline2\r\n');
  fs.mkdirSync(path.join(hubRoot, 'todo', 'PD1'), { recursive: true });
  fs.writeFileSync(path.join(hubRoot, 'todo', 'PD1', 'input.csv'), 'x,y\n');
  fs.writeFileSync(path.join(hubRoot, 'data.xlsx'), Buffer.from([0x50, 0x4b, 3, 4, 0, 1, 2]));
  const hub = await startHub({ root: hubRoot, port: 0, project: 'Demo', token: 'tk', history: mkdtemp('hist'), log: () => {} });

  const clients = [];
  for (let i = 0; i < 3; i++) {
    const root = mkdtemp(`c${i}`);
    if (i === 1) fs.writeFileSync(path.join(root, 'a.py'), 'stale local copy\n'); // gets backed up, hub wins
    if (i === 2) fs.writeFileSync(path.join(root, 'only-here.txt'), 'upload me\n');
    const store = new Map();
    const c = new CollabClient({
      root, host: '127.0.0.1', port: hub.port, token: 'tk', project: 'Demo', name: `c${i}`, uid: `uid${i}`,
      retryMs: 40, state: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
      log: (l) => { if (/LỖI|CẢNH BÁO/.test(l)) console.log(`  c${i}: ${l}`); },
    });
    c.editors = new Map();
    clients.push(c);
    c.connect();
  }
  await waitFor(() => clients.every((c) => c.ready && c.loading.size === 0), 5000, 'mọi máy vào phòng');
  await sleep(300);

  const open = (c, rel) => {
    const e = c.entries.get(rel);
    const file = c.abs(rel);
    const docText = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const eol = docText.includes('\r\n') ? '\r\n' : '\n';
    const ed = new FakeEditor(r, docText, eol, file, rel, stats);
    const b = new EditorBinding(e, ed.adapter(), c);
    ed.binding = b;
    c.attach(e, b);
    c.editors.set(rel, ed);
  };
  open(clients[0], 'a.py');
  open(clients[0], 'bom.csv');
  open(clients[0], 'crlf.py');
  open(clients[1], 'a.py');
  open(clients[1], 'crlf.py');
  open(clients[1], 'bom.csv');
  // clients[2] keeps everything on disk only, like a machine where an AI assistant or a script edits files.

  const textFiles = ['a.py', 'bom.csv', 'crlf.py', 'todo/PD1/input.csv'];
  for (let step = 0; step < 400; step++) {
    const c = clients[Math.floor(r() * 3)];
    const k = r();
    if (k < 0.75 && c.editors.size) {
      const eds = [...c.editors.values()];
      eds[Math.floor(r() * eds.length)].type();
    } else if (k < 0.93) {
      const disk = clients[2];
      const rel = textFiles[Math.floor(r() * textFiles.length)];
      const e = disk.entries.get(rel);
      if (e && fs.existsSync(disk.abs(rel))) {
        const cur = fs.readFileSync(disk.abs(rel), 'utf8');
        const safeAt = Math.max(cur.startsWith('﻿') ? 1 : 0, boundary(cur, Math.floor(r() * (cur.length + 1))));
        // Sometimes a bare-LF line, as a tool on Windows often writes even into a CRLF file.
        const ins = r() < 0.3 ? 'AI\n' : 'AI';
        fs.writeFileSync(disk.abs(rel), `${cur.slice(0, safeAt)}${ins}${cur.slice(safeAt)}`);
        stats.inserted[rel] = (stats.inserted[rel] || 0) + (rel === 'crlf.py' ? ins.replace('\n', '\r\n') : ins).length;
        disk.onDiskEvent(disk.abs(rel));
      }
    } else if (k < 0.96) {
      if (c.ls) c.ls.close(); // drop the connection mid-edit
    } else {
      await sleep(Math.floor(r() * 30));
    }
    if (step % 10 === 0) await sleep(Math.floor(r() * 15));
  }

  const quiet = () => clients.every((c) => c.ready && c.loading.size === 0 && c.writeTimers.size === 0 && c.diskTimers.size === 0
    && [...c.entries.values()].every((e) => e.kind !== 'text' || (!e.ot.outstanding && !e.ot.buffer && (!e.binding || e.binding.idle())))
    && [...c.editors.values()].every((ed) => ed.idle()));

  // New file + blob update + delete once the edits have settled (a delete racing an edit is resolved as
  // "the edit wins": the file comes back, so nobody's typing is lost).
  await waitFor(quiet, 15000, 'hệ thống lặng trước bước file');
  fs.writeFileSync(clients[2].abs('todo/PD1/new.py'), 'print("x")\n');
  clients[2].onDiskEvent(clients[2].abs('todo/PD1/new.py'));
  fs.writeFileSync(clients[0].abs('data.xlsx'), Buffer.from([0x50, 0x4b, 3, 4, 9, 9, 9, 9]));
  clients[0].onDiskEvent(clients[0].abs('data.xlsx'));
  fs.rmSync(clients[1].abs('todo/PD1/input.csv'));
  clients[1].onDiskEvent(clients[1].abs('todo/PD1/input.csv'));
  await sleep(300);

  await waitFor(quiet, 15000, 'hệ thống lặng');
  await sleep(800);
  await waitFor(quiet, 15000, 'hệ thống lặng (lần 2)');
  hub.flushAll();

  const problems = [];
  for (const [rel, f] of hub.files) {
    if (f.kind !== 'text') continue;
    const onHubDisk = fs.readFileSync(path.join(hubRoot, rel), 'utf8');
    if (onHubDisk !== f.text) problems.push(`${rel}: đĩa hub khác bộ nhớ hub
    mem=${JSON.stringify(f.text)}
    disk=${JSON.stringify(onHubDisk)}`);
    for (const c of clients) {
      const e = c.entries.get(rel);
      if (!e) {
        problems.push(`${rel}: ${c.name} không có file`);
        continue;
      }
      if (e.text !== f.text) problems.push(`${rel}: ${c.name} lệch hub\n    hub=${JSON.stringify(f.text)}\n    máy=${JSON.stringify(e.text)}`);
      const ed = c.editors.get(rel);
      if (ed && ed.binding.bom + ed.rText !== f.text) problems.push(`${rel}: editor của ${c.name} lệch hub ${JSON.stringify(ed.binding.bom + ed.rText)}`);
      if (!ed && fs.readFileSync(c.abs(rel), "utf8") !== f.text) problems.push(`${rel}: đĩa của ${c.name} lệch hub ${JSON.stringify(fs.readFileSync(c.abs(rel), "utf8"))}`);
    }
  }
  for (const c of clients) {
    if (fs.existsSync(c.abs('todo/PD1/input.csv'))) problems.push(`${c.name}: file đã xoá vẫn còn`);
    if (!fs.existsSync(c.abs('todo/PD1/new.py'))) problems.push(`${c.name}: thiếu file mới new.py`);
    if (!fs.existsSync(c.abs('only-here.txt'))) problems.push(`${c.name}: thiếu only-here.txt`);
    const xl = fs.readFileSync(c.abs('data.xlsx'));
    if (xl.length !== 8) problems.push(`${c.name}: data.xlsx chưa cập nhật`);
  }
  if (noDelete) {
    const initial = { 'a.py': 25, 'bom.csv': 15, 'crlf.py': 14 };
    for (const [rel, n] of Object.entries(initial)) {
      const got = hub.files.get(rel).text.length;
      if (got !== n + (stats.inserted[rel] || 0)) problems.push(`${rel}: mất chữ — dài ${got}, kỳ vọng ${n + (stats.inserted[rel] || 0)}`);
    }
  }
  const bomText = hub.files.get('bom.csv').text;
  if (!bomText.startsWith('﻿')) problems.push('bom.csv mất BOM');
  if (!fs.existsSync(path.join(clients[1].root, '.lan-collab', 'backup'))) problems.push('c1: không có bản sao lưu a.py cũ');

  for (const c of clients) c.disconnect();
  await hub.close();
  return problems;
}

(async () => {
  const seeds = process.argv[2] ? [Number(process.argv[2])] : [1, 2, 3, 4, 101, 102, 103, 104];
  let failed = 0;
  for (const seed of seeds) {
    const t0 = Date.now();
    const problems = await runScenario(seed, seed > 100);
    if (problems.length) {
      failed += 1;
      console.log(`seed ${seed}: LỖI\n  ${problems.join('\n  ')}`);
    } else {
      console.log(`seed ${seed}: OK (${Date.now() - t0} ms)`);
    }
  }
  assert.strictEqual(failed, 0, `${failed} kịch bản lỗi`);
  console.log('sync.test.js: mọi bản sao hội tụ');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
