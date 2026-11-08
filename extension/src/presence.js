'use strict';

const vscode = require('vscode');
const path = require('path');

// This member's file, selections and debug target, sent to the hub at most every 80 ms.
class Presence {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.send();
    }, 80);
  }

  send() {
    const core = this.app.controller.core;
    if (!core || !core.ready) return;
    const p = { file: null, sel: [], line: 0, debug: null };
    const ed = vscode.window.activeTextEditor;
    if (ed && ed.document.uri.scheme === 'file') {
      const rel = core.relOf(ed.document.uri.fsPath);
      if (rel && core.entries.has(rel)) {
        const b = this.app.editors.bindingOf(ed.document);
        const off = b ? b.bom.length : 0;
        p.file = rel;
        p.sel = ed.selections.map((s) => [ed.document.offsetAt(s.anchor) + off, ed.document.offsetAt(s.active) + off]);
        p.line = ed.selection.active.line + 1;
      }
    }
    const ds = vscode.debug.activeDebugSession;
    if (ds) {
      const program = ds.configuration && ds.configuration.program;
      const rel = typeof program === 'string' && path.isAbsolute(program) ? core.relOf(program) : null;
      p.debug = rel || ds.name;
    }
    core.sendPresence(p);
    this.app.session.update();
  }
}

module.exports = { Presence };
