'use strict';

const vscode = require('vscode');

// Other members' selections, carets and name labels in visible editors.
class Decorations {
  constructor(app) {
    this.app = app;
    this.types = new Map(); // user id -> decoration types
    this.timer = null;
  }

  typesFor(u) {
    let d = this.types.get(u.id);
    if (d) return d;
    const c = u.color;
    d = {
      sel: vscode.window.createTextEditorDecorationType({ backgroundColor: `${c}33`, borderRadius: '2px' }),
      caretBefore: vscode.window.createTextEditorDecorationType({ borderStyle: 'solid', borderColor: c, borderWidth: '0 0 0 2px' }),
      caretAfter: vscode.window.createTextEditorDecorationType({ borderStyle: 'solid', borderColor: c, borderWidth: '0 2px 0 0' }),
      label: vscode.window.createTextEditorDecorationType({
        after: { contentText: `  ◀ ${u.name}`, color: c, fontStyle: 'italic', margin: '0 0 0 1em' },
      }),
    };
    this.types.set(u.id, d);
    return d;
  }

  dispose(id) {
    const d = this.types.get(id);
    if (!d) return;
    for (const type of Object.values(d)) type.dispose();
    this.types.delete(id);
  }

  disposeAll() {
    for (const id of [...this.types.keys()]) this.dispose(id);
  }

  // Drops the types of members who left.
  prune(users) {
    for (const id of [...this.types.keys()]) if (!users.has(id)) this.dispose(id);
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.render();
    }, 30);
  }

  shiftRemoteCursors(rel, b, op) {
    const core = this.app.controller.core;
    if (!core) return;
    const off = b.bom.length;
    for (const u of core.users.values()) {
      const p = u.presence;
      if (!p || p.file !== rel) continue;
      p.sel = p.sel.map(([a, c]) => [op.transformIndex(Math.max(0, a - off)) + off, op.transformIndex(Math.max(0, c - off)) + off]);
    }
    this.schedule();
  }

  render() {
    const core = this.app.controller.core;
    if (!core) return;
    for (const ed of vscode.window.visibleTextEditors) {
      const rel = ed.document.uri.scheme === 'file' ? core.relOf(ed.document.uri.fsPath) : null;
      const b = this.app.editors.bindingOf(ed.document);
      const off = b ? b.bom.length : 0;
      const len = ed.document.getText().length;
      for (const u of core.users.values()) {
        const d = this.typesFor(u);
        const p = u.presence;
        const sels = [];
        const before = [];
        const after = [];
        const labels = [];
        if (rel && p && p.file === rel) {
          p.sel.forEach(([a, c], i) => {
            const pa = ed.document.positionAt(Math.min(len, Math.max(0, a - off)));
            const pc = ed.document.positionAt(Math.min(len, Math.max(0, c - off)));
            if (!pa.isEqual(pc)) sels.push(new vscode.Range(pa, pc));
            const lineEnd = ed.document.lineAt(pc.line).range.end;
            if (pc.isBefore(lineEnd)) before.push(new vscode.Range(pc, pc.translate(0, 1)));
            else if (pc.character > 0) after.push(new vscode.Range(pc.translate(0, -1), pc));
            if (i === 0) labels.push(new vscode.Range(lineEnd, lineEnd));
          });
        }
        ed.setDecorations(d.sel, sels);
        ed.setDecorations(d.caretBefore, before);
        ed.setDecorations(d.caretAfter, after);
        ed.setDecorations(d.label, labels);
      }
    }
  }
}

module.exports = { Decorations };
