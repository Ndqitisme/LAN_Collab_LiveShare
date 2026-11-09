'use strict';

// A tool outside the editor (an AI assistant, a script, git) rewrites a CRLF file with LF line endings while the
// file is open in VS Code on that machine and on a teammate's. VS Code reloads the clean editor with LF; the
// teammate's editor stays CRLF. The two editors must not rewrite each other's line breaks: before the fix they
// did so endlessly, and the lone CRs VS Code turned into line breaks left a file of interleaved versions and blank
// lines.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, after } = require('node:test');
const { CollabClient } = require('../../lib/client-core');
const { EditorBinding } = require('../../lib/editor-binding');
const { diff } = require('../../lib/ot');
const { startHubProcess } = require('../support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-eol-${n}-`));
const norm = (t, eol) => t.replace(/\r\n|\r|\n/g, eol);

// VS Code TextModel: CRLF when more than half of the line breaks carry a CR; every break is then normalised.
function modelEol(t, fallback) {
  const crlf = (t.match(/\r\n/g) || []).length;
  const all = (t.match(/\r\n|\r|\n/g) || []).length;
  if (!all) return fallback;
  return crlf + (t.match(/\r(?!\n)/g) || []).length > all / 2 ? '\r\n' : '\n';
}

// A VS Code document: inserted text takes the document's line endings (a lone CR included), a clean document
// reloads when its file changes, a dirty one does not.
class Doc {
  constructor(file) {
    this.file = file;
    const raw = fs.readFileSync(file, 'utf8');
    this.eol = modelEol(raw, '\r\n');
    this.text = norm(raw, this.eol);
    this.loaded = raw;
    this.dirty = false;
    this.changes = 0;
    this.binding = null;
  }

  adapter() {
    return {
      getText: () => this.text,
      isDirty: () => this.dirty,
      eol: () => this.eol,
      applyEdits: (edits) => new Promise((resolve) => setTimeout(() => {
        let t = this.text;
        const changes = [];
        for (const ed of [...edits].sort((a, b) => b.start - a.start)) {
          const text = norm(ed.text, this.eol);
          changes.push({ rangeOffset: ed.start, rangeLength: ed.end - ed.start, text });
          t = t.slice(0, ed.start) + text + t.slice(ed.end);
        }
        this.text = t;
        this.dirty = true;
        this.changes += 1;
        this.binding.onDocChange(changes, t);
        resolve(true);
      }, 2)),
      save: () => new Promise((resolve) => setTimeout(() => {
        if (fs.readFileSync(this.file, 'utf8') !== this.loaded) {
          resolve(false); // the file on disk is newer
          return;
        }
        this.binding.onWillSave();
        fs.writeFileSync(this.file, this.text);
        this.loaded = this.text;
        this.dirty = false;
        this.binding.core.onDiskEvent(this.file);
        this.binding.onSaved();
        resolve(true);
      }, 1)),
    };
  }

  fileChanged() {
    const raw = fs.readFileSync(this.file, 'utf8');
    if (raw === this.loaded || this.dirty) return;
    this.loaded = raw;
    const old = this.text;
    this.eol = modelEol(raw, this.eol);
    this.text = norm(raw, this.eol);
    if (this.text !== old) {
      this.changes += 1;
      this.binding.onDocChange([{ rangeOffset: 0, rangeLength: old.length, text: this.text }], this.text);
    }
  }
}

const cleanup = [];
after(async () => {
  for (const f of cleanup.reverse()) await f();
});

async function until(cond, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

test('an LF rewrite of an open CRLF file reaches every editor once and keeps the file CRLF', async () => {
  const hubRoot = tmp('hub');
  const oldText = Array.from({ length: 81 }, (_, i) => `old_${i} = ${i}`).join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(hubRoot, 'PD.py'), oldText);
  const hub = await startHubProcess({ root: hubRoot, project: 'Demo', token: 'tk' });
  cleanup.push(() => hub.stop());
  const member = (name) => {
    const store = new Map();
    const c = new CollabClient({ root: tmp(name), host: '127.0.0.1', port: hub.port, token: 'tk', project: 'Demo', name, uid: name,
      retryMs: 40, log: () => {}, state: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) } });
    c.connect();
    cleanup.push(() => c.disconnect());
    return c;
  };
  const ai = member('ai');
  const mate = member('mate');
  await until(() => [ai, mate].every((c) => c.ready && c.loading.size === 0 && c.entries.has('PD.py')), 'both members ready');
  const open = (c) => {
    const doc = new Doc(c.abs('PD.py'));
    const e = c.entries.get('PD.py');
    doc.binding = new EditorBinding(e, doc.adapter(), c);
    c.attach(e, doc.binding);
    return { doc, e };
  };
  const a = open(ai);
  const m = open(mate);

  const newText = Array.from({ length: 458 }, (_, i) => (i % 7 === 3 ? '' : `new_${i} = ${i * 2}`)).join('\n') + '\n';
  fs.writeFileSync(ai.abs('PD.py'), newText);
  ai.onDiskEvent(ai.abs('PD.py'));
  setTimeout(() => a.doc.fileChanged(), 60); // VS Code's own watcher reloads the clean editor

  const want = norm(newText, '\r\n');
  await until(() => m.e.text === want && a.e.text === want && m.doc.text === want, 'the rewrite on every copy');
  await sleep(2500); // past the binding's retry and reload waits: an echo loop would show up here
  assert.strictEqual(a.e.text, want, 'the shared text keeps the file CRLF');
  assert.strictEqual(m.e.text, want);
  assert.strictEqual(a.doc.text, newText, 'the reloaded editor shows the rewrite with its own LF');
  assert.strictEqual(m.doc.text, want);
  assert.ok(m.doc.changes <= 2, `the teammate's editor changed ${m.doc.changes} times, an echo loop`);
  assert.ok(!/\r(?!\n)/.test(a.e.text), 'no lone CR in the shared text');
});

// A VS Code document whose edits from the extension wait until release() and are refused when the document
// moved on meanwhile, so an edit can be in flight while the editor reloads or the user types.
class HeldDoc {
  constructor(text, eol) {
    this.text = norm(text, eol);
    this.eol = eol;
    this.version = 1;
    this.queue = [];
  }

  adapter() {
    return {
      getText: () => this.text,
      isDirty: () => false,
      eol: () => this.eol,
      save: async () => true,
      applyEdits: (edits) => new Promise((resolve) => this.queue.push({ edits, v: this.version, resolve })),
    };
  }

  async drain() {
    for (let round = 0; round < 3; round++) {
      await sleep(10);
      while (this.queue.length) {
        const q = this.queue.shift();
        if (q.v !== this.version) {
          q.resolve(false);
          continue;
        }
        let t = this.text;
        const changes = [];
        for (const ed of [...q.edits].sort((a, b) => b.start - a.start)) {
          const text = norm(ed.text, this.eol);
          changes.push({ rangeOffset: ed.start, rangeLength: ed.end - ed.start, text });
          t = t.slice(0, ed.start) + text + t.slice(ed.end);
        }
        this.text = t;
        this.version += 1;
        this.binding.onDocChange(changes, t);
        q.resolve(true);
        await sleep(5);
      }
      await sleep(120);
    }
  }

  type(at, s) {
    const text = norm(s, this.eol);
    this.text = this.text.slice(0, at) + text + this.text.slice(at);
    this.version += 1;
    this.binding.onDocChange([{ rangeOffset: at, rangeLength: 0, text }], this.text);
  }

  reload(raw, eol) {
    const old = this.text;
    this.eol = eol;
    this.text = norm(raw, eol);
    this.version += 1;
    this.binding.onDocChange([{ rangeOffset: 0, rangeLength: old.length, text: this.text }], this.text);
  }
}

function bound(shared, editorText, eol) {
  const disk = { raw: null };
  const e = { text: shared, rel: 'f.txt', diskText: null, pendingExternal: null };
  const core = {
    autoSave: false,
    log: () => {},
    diskMatch: () => disk.raw,
    localOp(entry, op) {
      entry.text = op.apply(entry.text);
    },
  };
  const doc = new HeldDoc(editorText, eol);
  doc.binding = new EditorBinding(e, doc.adapter(), core);
  const remote = (f) => {
    const old = e.text;
    e.text = f(old);
    doc.binding.enqueue(diff(old, e.text), old);
  };
  return { e, doc, disk, remote };
}

test('line endings that switch while an edit is in flight keep every edit and every member text', async () => {
  // The editor switches to the shared text's CRLF on a reload that also adds a line.
  let s = bound('a\r\nb\r\n', 'a\nb\n', '\n');
  s.disk.raw = 'a\r\nb\r\nc\r\n';
  s.doc.reload(s.disk.raw, '\r\n');
  await s.doc.drain();
  assert.strictEqual(s.e.text, 'a\r\nb\r\nc\r\n');
  assert.strictEqual(s.doc.text, s.e.text);

  // A teammate's edit is in flight when an LF rewrite reloads the editor.
  s = bound('one\r\ntwo\r\n', 'one\r\ntwo\r\n', '\r\n');
  s.remote((t) => t.replace('two', 'two TEAMMATE'));
  await sleep(5);
  s.disk.raw = 'one AI\ntwo\n';
  s.doc.reload(s.disk.raw, '\n');
  await s.doc.drain();
  assert.ok(s.e.text.includes('one AI') && s.e.text.includes('TEAMMATE'), JSON.stringify(s.e.text));
  assert.ok(!/(^|[^\r])\n/.test(s.e.text), 'the shared text stays CRLF');
  assert.strictEqual(s.doc.text, norm(s.e.text, '\n'));

  // A reload changes only the line endings while a teammate's edit is in flight, then the user types.
  for (const [from, to] of [['\r\n', '\n'], ['\n', '\r\n']]) {
    s = bound('one\r\ntwo\r\n', norm('one\r\ntwo\r\n', from), from);
    await sleep(5);
    s.remote((t) => t.replace('two', 'two TEAMMATE'));
    await sleep(5);
    s.disk.raw = norm('one\ntwo\n', to);
    s.doc.reload(s.disk.raw, to);
    s.disk.raw = null;
    s.doc.type(0, 'X');
    await s.doc.drain();
    assert.strictEqual(s.e.text, 'Xone\r\ntwo TEAMMATE\r\n', `${JSON.stringify(from)} to ${JSON.stringify(to)}`);
    assert.strictEqual(s.doc.text, norm(s.e.text, to));
  }
});
