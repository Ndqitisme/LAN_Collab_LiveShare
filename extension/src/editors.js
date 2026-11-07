'use strict';

const vscode = require('vscode');
const { EditorBinding } = require('../../lib/editor-binding');

// Open text documents bound to the client core's entries, one EditorBinding per document.
class Editors {
  constructor(app) {
    this.app = app;
    this.bindings = new Map(); // document uri -> EditorBinding
  }

  bindingOf(doc) {
    return this.bindings.get(doc.uri.toString());
  }

  bind(doc) {
    const core = this.app.controller.core;
    if (!core || !core.ready || doc.uri.scheme !== 'file') return;
    const key = doc.uri.toString();
    if (this.bindings.has(key)) return;
    const rel = core.relOf(doc.uri.fsPath);
    const e = rel && core.entries.get(rel);
    if (!e || e.kind !== 'text' || e.loading) return;
    if (e.binding) return;
    if (doc.isDirty && doc.getText() !== e.text.replace(/^﻿/, '')) core.backupText(rel, doc.getText());
    const b = new EditorBinding(e, adapterFor(doc), core);
    b.onApplied((op) => this.app.decorations.shiftRemoteCursors(rel, b, op));
    this.bindings.set(key, b);
    core.attach(e, b);
  }

  bindAll() {
    for (const doc of vscode.workspace.textDocuments) this.bind(doc);
  }

  bindRel(rel) {
    const core = this.app.controller.core;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && core.relOf(d.uri.fsPath) === rel);
    if (doc) this.bind(doc);
  }

  unbind(doc) {
    const key = doc.uri.toString();
    const b = this.bindings.get(key);
    if (!b) return;
    this.bindings.delete(key);
    const core = this.app.controller.core;
    if (core) core.detach(b.e);
    else b.dispose();
  }

  unbindRel(rel) {
    for (const [key, b] of this.bindings) {
      if (b.e.rel !== rel) continue;
      b.dispose();
      b.e.binding = null;
      this.bindings.delete(key);
    }
  }

  disposeAll() {
    for (const b of this.bindings.values()) {
      b.dispose();
      b.e.binding = null;
    }
    this.bindings.clear();
  }

  onDocChange(ev) {
    const b = this.bindingOf(ev.document);
    if (!b || ev.contentChanges.length === 0) return;
    const changes = ev.contentChanges.map((c) => ({ rangeOffset: c.rangeOffset, rangeLength: c.rangeLength, text: c.text }));
    b.onDocChange(changes, ev.document.getText());
    this.app.presence.schedule();
  }
}

function adapterFor(doc) {
  return {
    getText: () => doc.getText(),
    isDirty: () => doc.isDirty,
    eol: () => (doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'),
    applyEdits(edits) {
      if (doc.isClosed) return Promise.resolve(false);
      const we = new vscode.WorkspaceEdit();
      for (const ed of edits) we.replace(doc.uri, new vscode.Range(doc.positionAt(ed.start), doc.positionAt(ed.end)), ed.text);
      return vscode.workspace.applyEdit(we);
    },
    save: () => (doc.isClosed ? Promise.resolve(false) : doc.save()),
  };
}

module.exports = { Editors };
