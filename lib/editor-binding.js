'use strict';

const { TextOperation, diff, fromChanges, withPrefix, stripPrefix, isRetain, isInsert } = require('./ot');
const { normalizeEol, dominantEol } = require('./common');

// The shared text keeps the file's line endings, but a VS Code document holds one line ending only and turns
// every line break it is given, a lone CR included, into its own. Each editor therefore works on a view of the
// shared text with its own line endings: ops are translated between the two, and a change of line endings
// alone is never a user edit. Without this, two editors with different line endings rewrote each other's
// line breaks forever, and lone CRs became blank lines.
function viewOf(text, eol) {
  return /[\r\n]/.test(text) ? text.replace(/\r\n|\r|\n/g, eol) : text;
}

function isView(text, eol) {
  return eol === '\n' ? !text.includes('\r') : !/\r(?!\n)|(?:^|[^\r])\n/.test(text);
}

// Edits that reach the editor asynchronously race with the user's typing. VS Code rejects an edit whose
// document version moved on in the meantime, so: every editor change that is not the echo of our own edit
// is a user edit; ops still waiting for the editor are transformed against it and re-sent later.
//
// adapter: { getText(), isDirty(), eol(), applyEdits([{start, end, text}]) -> Promise<boolean>, save() -> Promise<boolean> }
class EditorBinding {
  constructor(entry, adapter, core) {
    this.e = entry;
    this.a = adapter;
    this.core = core;
    this.shadow = adapter.getText(); // editor text as of the last change event we processed
    this.bom = entry.text.startsWith('﻿') && !this.shadow.startsWith('﻿') ? '﻿' : '';
    this.toEditor = null; // op on shadow: known to the OT layer, not yet in the editor
    this.inflight = null;
    this.disposed = false;
    this.retries = 0;
    this.saveTimer = null;
    this.listeners = [];
    const target = this._target();
    if (this.shadow !== target) {
      this.toEditor = diff(this.shadow, target);
      this.flush();
    } else if (!adapter.isDirty()) {
      entry.diskText = entry.text;
    }
  }

  onApplied(fn) {
    this.listeners.push(fn);
  }

  _applied(op) {
    for (const fn of this.listeners) fn(op);
  }

  toShared(op) {
    return this.bom ? withPrefix(op, 1) : op;
  }

  _shared() {
    return this.e.text.slice(this.bom.length);
  }

  // What the editor must show: the shared text with the editor's line endings.
  _target() {
    return viewOf(this._shared(), this.a.eol());
  }

  idle() {
    return !this.inflight && !this.toEditor;
  }

  expectsReload() {
    return this.idle() && !this.a.isDirty();
  }

  // sharedOp turned oldText into entry.text; it must now reach the editor.
  enqueue(sharedOp, oldText) {
    if (this.disposed) return;
    const oldBom = this.bom;
    let op = sharedOp;
    if (this.bom) {
      // The editor shows the text without its BOM (VS Code keeps the BOM as the file encoding).
      if (this.e.text.startsWith('﻿')) op = stripPrefix(sharedOp, 1) || diff(oldText.slice(1), this.e.text.slice(1));
      else {
        op = diff(oldText.slice(1), this.e.text);
        this.bom = '';
      }
    }
    const eol = this.a.eol();
    if (!isView(oldText.slice(oldBom.length), eol) || !isView(this._shared(), eol)) {
      // The op is in the shared text's line endings: what the editor still needs is recomputed in its view,
      // from the editor text once the edit in flight (if VS Code takes it) has landed.
      const inf = this.inflight;
      const base = inf && !inf.stale ? inf.expected : this.shadow;
      const target = this._target();
      this.toEditor = base === target ? null : diff(base, target);
      this.flush();
      return;
    }
    this.toEditor = this.toEditor ? this.toEditor.compose(op) : op;
    this.flush();
  }

  flush() {
    if (this.disposed || this.inflight || !this.toEditor) return;
    if (this.a.getText() !== this.shadow) {
      this.hardReset();
      return;
    }
    const op = this.toEditor;
    this.toEditor = null;
    if (op.isNoop()) return;
    const eol = this.a.eol();
    const edits = opToEdits(op).map((ed) => ({ ...ed, text: normalizeEol(ed.text, eol) }));
    const inf = { op, edits, expected: applyEdits(this.shadow, edits), echoed: false, stale: false, timer: null };
    this.inflight = inf;
    let p;
    try {
      p = Promise.resolve(this.a.applyEdits(edits));
    } catch {
      p = Promise.resolve(false);
    }
    p.then((ok) => setTimeout(() => this._settled(inf, ok), 0), () => setTimeout(() => this._settled(inf, false), 0));
  }

  onDocChange(changes, newText) {
    if (this.disposed) return;
    const inf = this.inflight;
    if (inf && !inf.echoed && !inf.stale && (newText === inf.expected || sameChanges(changes, inf.edits))) {
      inf.echoed = true;
      clearTimeout(inf.timer);
      this.inflight = null;
      this.retries = 0;
      this.shadow = inf.expected; // the editor's own text: VS Code wrote the edits with its line endings
      this._applied(inf.op);
      if (newText !== this.shadow && !this._eolOnly(newText, null)) this._userEdit(diff(this.shadow, newText), newText, 'editor');
      this._afterChange();
      this.flush();
      return;
    }
    if (this._eolOnly(newText, inf)) return;
    let op = fromChanges(this.shadow, changes);
    if (!op || op.baseLength !== this.shadow.length || op.apply(this.shadow) !== newText) op = diff(this.shadow, newText);
    // TextDocument.isDirty is not yet updated inside the change event, so a reload from disk (AI or another
    // tool wrote the file) is recognised by the editor now matching the file on disk.
    const onDisk = this.core.diskMatch(this.e, this.bom + newText);
    if (onDisk !== null) {
      this.e.diskText = onDisk;
      this.e.pendingExternal = null; // VS Code's reload has brought the external change in
    }
    this._userEdit(op, newText, onDisk !== null ? 'disk' : 'editor');
    this._afterChange();
  }

  // Only the line endings changed ("Change End of Line Sequence", a reload that adopted the file's line endings,
  // VS Code writing our edit with its own): the shared text keeps its own, so there is nothing to send.
  _eolOnly(newText, inf) {
    if (newText === this.shadow || viewOf(newText, '\n') !== viewOf(this.shadow, '\n')) return false;
    this.shadow = newText;
    if (inf && !inf.echoed) inf.stale = true;
    // What the editor still lacks (an edit in flight is now stale) is pending at once, so a user edit right
    // after this is transformed against it instead of overwriting it.
    const target = this._target();
    this.toEditor = target === newText ? null : diff(newText, target);
    this.flush();
    return true;
  }

  _userEdit(op, newText, src) {
    let pending = null;
    const inf = this.inflight;
    if (inf && !inf.echoed && !inf.stale) {
      pending = inf.op;
      inf.stale = true; // the user's edit came first, so VS Code will reject ours
    }
    if (this.toEditor) pending = pending ? pending.compose(this.toEditor) : this.toEditor;
    const eol = this.a.eol();
    const shared = this._shared();
    // The view path also when the editor's line endings changed since shadow (a reload, "Change End of Line
    // Sequence"): op is then based on text in the old line endings and cannot go to the shared text as is.
    if (!isView(shared, eol) || !isView(this.shadow, eol)) {
      this._userEditInView(op, newText, src, pending, shared, eol);
      return;
    }
    let mine = op;
    if (pending) {
      const [m2, p2] = TextOperation.transform(op, pending);
      mine = m2;
      this.toEditor = p2.isNoop() ? null : p2;
    }
    this.shadow = newText;
    this._applied(op);
    this.core.localOp(this.e, this.toShared(mine), src);
  }

  // The editor's line endings differ from the shared text's: the edit is taken over in the shared text's line
  // endings, and whatever the editor still lacks is recomputed in its view.
  _userEditInView(op, newText, src, pending, shared, eol) {
    let after = newText;
    if (pending) {
      const before = pending.baseLength === this.shadow.length ? pending.apply(this.shadow) : null;
      // before is in shadow's line endings, which may be the editor's old ones.
      if (before !== null && viewOf(before, eol) === viewOf(shared, eol) && op.baseLength === this.shadow.length) {
        after = TextOperation.transform(op, pending)[0].apply(before);
      }
    }
    const sharedEol = /[\r\n]/.test(shared) ? dominantEol(shared) : eol;
    const sharedOp = diff(shared, viewOf(after, sharedEol));
    this.shadow = newText;
    this._applied(op);
    if (!sharedOp.isNoop()) this.core.localOp(this.e, this.toShared(sharedOp), src);
    const target = this._target();
    this.toEditor = target === newText ? null : diff(newText, target);
  }

  _afterChange() {
    if (!this.core.autoSave) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this._autoSave(), 400);
  }

  _autoSave() {
    if (this.disposed || !this.a.isDirty()) return;
    // An external change VS Code will not reload into a dirty editor must be merged before saving over it.
    if (this.e.pendingExternal) this.core.applyPendingExternal(this.e);
    if (!this.idle()) {
      this.saveTimer = setTimeout(() => this._autoSave(), 200);
      return;
    }
    if (this.e.saveFailed) {
      this.core.writeEditorFallback(this.e);
      return;
    }
    const fail = () => {
      this.e.saving = 0;
      if (this.disposed) return;
      this.e.saveFailed = true;
      this.core.writeEditorFallback(this.e);
    };
    Promise.resolve(this.a.save()).then((ok) => {
      if (!ok) fail();
    }, fail);
  }

  onWillSave() {
    this.e.saving = Date.now();
  }

  onSaved() {
    this.e.saving = 0;
    this.e.saveFailed = false;
    // Read what was written: edits that reached the editor while the save ran are not in the file.
    const onDisk = this.core.readDisk(this.e);
    this.e.diskText = onDisk !== null ? onDisk : this.bom + this.a.getText();
    if (this.e.pendingExternal) this.core.applyPendingExternal(this.e);
  }

  _settled(inf, ok) {
    if (this.disposed || this.inflight !== inf) return;
    if (inf.stale) {
      this.inflight = null;
      if (ok) this.hardReset();
      else this.flush();
      return;
    }
    if (ok) {
      // Applied, but the change event has not arrived yet: give it a moment.
      inf.timer = setTimeout(() => {
        if (this.inflight === inf && !inf.echoed) this.hardReset();
      }, 1000);
      return;
    }
    this.inflight = null;
    this.toEditor = this.toEditor ? inf.op.compose(this.toEditor) : inf.op;
    if (++this.retries > 50) {
      this.hardReset();
      return;
    }
    setTimeout(() => this.flush(), 30);
  }

  // Make the editor show entry.text, trusting shadow as the editor's content.
  reset() {
    if (this.disposed) return;
    if (this.inflight) {
      setTimeout(() => this.reset(), 50);
      return;
    }
    const target = this._target();
    this.toEditor = this.shadow === target ? null : diff(this.shadow, target);
    this.flush();
  }

  // Last resort when our model of the editor is off: re-read the editor and overwrite it with entry.text.
  hardReset() {
    if (this.disposed) return;
    if (this.inflight) clearTimeout(this.inflight.timer);
    this.inflight = null;
    this.retries = 0;
    this.core.log(`[CẢNH BÁO] ${this.e.rel}: editor lệch → ghi lại theo bản trên hub`);
    this.shadow = this.a.getText();
    const target = this._target();
    this.toEditor = this.shadow === target ? null : diff(this.shadow, target);
    this.flush();
  }

  verify() {
    if (this.disposed || !this.idle()) return;
    if (this.a.getText() !== this.shadow) this.hardReset();
    else if (this.shadow !== this._target()) this.reset();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.saveTimer);
    if (this.inflight) clearTimeout(this.inflight.timer);
  }
}

function opToEdits(op) {
  const edits = [];
  let pos = 0;
  let cur = null;
  for (const o of op.ops) {
    if (isRetain(o)) {
      if (cur) edits.push(cur);
      cur = null;
      pos += o;
    } else if (isInsert(o)) {
      cur = cur || { start: pos, end: pos, text: '' };
      cur.text += o;
    } else {
      cur = cur || { start: pos, end: pos, text: '' };
      cur.end -= o;
      pos -= o;
    }
  }
  if (cur) edits.push(cur);
  return edits;
}

function applyEdits(text, edits) {
  const parts = [];
  let pos = 0;
  for (const ed of edits) {
    parts.push(text.slice(pos, ed.start), ed.text);
    pos = ed.end;
  }
  parts.push(text.slice(pos));
  return parts.join('');
}

function sameChanges(changes, edits) {
  if (!changes || changes.length !== edits.length) return false;
  const sorted = [...changes].sort((x, y) => x.rangeOffset - y.rangeOffset);
  const lf = (t) => t.replace(/\r\n/g, '\n');
  return sorted.every((c, i) => c.rangeOffset === edits[i].start
    && c.rangeLength === edits[i].end - edits[i].start
    && lf(c.text) === lf(edits[i].text));
}

module.exports = { EditorBinding, opToEdits, applyEdits, normalizeEol };
