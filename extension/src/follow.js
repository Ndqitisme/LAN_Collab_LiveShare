'use strict';

const vscode = require('vscode');
const path = require('path');
const { t } = require('../../lib/i18n');
const { describe } = require('./views/people');

// Following a member, jumping to a member, and the file references chat inserts and opens.
class Follow {
  constructor(app) {
    this.app = app;
    this.following = null; // user id
  }

  set(id) {
    this.following = id;
    this.app.statusBar.render();
    if (id) this.followNow();
  }

  // Called when the member list changes: stop following someone who left.
  onUsers(users) {
    if (this.following && !users.has(this.following)) this.set(null);
  }

  async followNow() {
    const core = this.app.controller.core;
    const u = core && core.users.get(this.following);
    if (u) await this.reveal(u, true);
  }

  async goTo(id) {
    const core = this.app.controller.core;
    const u = core && core.users.get(id);
    if (!u) return;
    if (!u.presence || !u.presence.file) {
      vscode.window.showInformationMessage(t('follow.noFile', { name: u.name }));
      return;
    }
    await this.reveal(u, false);
  }

  async reveal(u, preserveFocus) {
    const p = u.presence;
    const folder = this.app.controller.folder;
    if (!p || !p.file || !folder) return;
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, p.file));
    const active = vscode.window.activeTextEditor;
    const ed = active && active.document.uri.toString() === uri.toString()
      ? active
      : await vscode.window.showTextDocument(uri, { preview: true, preserveFocus });
    const b = this.app.editors.bindingOf(ed.document);
    const off = b ? b.bom.length : 0;
    const caret = p.sel[0] ? p.sel[0][1] : 0;
    const pos = ed.document.positionAt(Math.max(0, caret - off));
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async pick() {
    const { state, core } = this.app.controller;
    if (state.name !== 'live') {
      vscode.window.showWarningMessage(t('connect.notConnected'));
      return;
    }
    const items = [...core.users.values()].map((u) => ({ label: u.name, description: describe(u.presence, u.status), id: u.id }));
    if (!items.length) {
      vscode.window.showInformationMessage(t('follow.nobody'));
      return;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('follow.placeholder') });
    if (pick) this.set(pick.id);
  }

  sendLocation() {
    const core = this.app.controller.core;
    const ed = vscode.window.activeTextEditor || this.app.lastEditor;
    if (!core || !ed || ed.document.isClosed || ed.document.uri.scheme !== 'file') return null;
    const rel = core.relOf(ed.document.uri.fsPath);
    return rel ? `${rel}:${ed.selection.active.line + 1}` : null;
  }

  async openRef(ref, line) {
    const core = this.app.controller.core;
    const folder = this.app.controller.folder;
    const rel = core && core.relOf(path.join(folder.uri.fsPath, ref.replace(/\\/g, '/')));
    if (!rel || !core.entries.has(rel)) {
      vscode.window.showWarningMessage(t('ref.missing', { path: ref }));
      return;
    }
    const ed = await vscode.window.showTextDocument(vscode.Uri.file(path.join(folder.uri.fsPath, rel)), { preview: true });
    const pos = new vscode.Position(Math.max(0, Math.min(line - 1, ed.document.lineCount - 1)), 0);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

module.exports = { Follow };
