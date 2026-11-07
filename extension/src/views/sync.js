'use strict';

const vscode = require('vscode');
const path = require('path');
const { t, catalogFor } = require('../../../lib/i18n');
const { webviewOptions, webviewHtml } = require('./webview-host');

// Read-only documents for the diff preview: lancollab-sync:/<side>/<path>?<decision>.
const SCHEME = 'lancollab-sync';

// The first-sync decision in an editor panel: lib/client-core.js calls confirmSync with the plan and waits. The
// panel answers false (Huỷ, closing the panel, or the connection leaving `syncing`) or a choice per file.
class SyncPanel {
  constructor(app) {
    this.app = app;
    this.panel = null;
    this.pending = null; // {folder, info, resolve, seq}
    this.seq = 0;
    this.syncingAt = 0;
    this.docs = new Map(); // uri string -> text
    this.disposables = [
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: (uri) => this.docs.get(uri.toString()) ?? '' }),
      app.controller.onDidChange(({ prev, state }) => {
        if (state.name === 'syncing' && prev.name !== 'syncing') this.syncingAt = Date.now();
        if (this.pending && state.name !== 'syncing') this._finish(false);
      }),
    ];
  }

  // confirmSync for the client core.
  decide(folder, info) {
    if (this.pending) this._resolve(false);
    return new Promise((resolve) => {
      this.seq += 1;
      this.pending = { folder, info, resolve, seq: this.seq };
      this.docs.clear();
      if (this.panel) {
        this.panel.title = t('sync.panel.tab', { project: info.project });
        this._postInit();
        this.panel.reveal(vscode.ViewColumn.Active);
      } else {
        this._open(info);
      }
    });
  }

  _open(info) {
    const { extensionUri } = this.app.context;
    const panel = vscode.window.createWebviewPanel('lanCollab.sync', t('sync.panel.tab', { project: info.project }), vscode.ViewColumn.Active, {
      ...webviewOptions(extensionUri),
      retainContextWhenHidden: true, // the member's choices survive opening a diff in the same group
    });
    panel.iconPath = new vscode.ThemeIcon('sync');
    panel.webview.html = webviewHtml(panel.webview, extensionUri, 'sync', { bodyClass: 'lc-editor' });
    panel.webview.onDidReceiveMessage((m) => this._onMessage(m));
    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.panel = null;
      this._finish(false);
    });
    this.panel = panel;
  }

  _onMessage(m) {
    const p = this.pending;
    if (!p || !m) return;
    if (m.type === 'ready') this._postInit();
    else if (m.type === 'painted') this.app.log(`Bảng đồng bộ đã hiện ${Date.now() - this.syncingAt} ms sau welcome (${p.info.conflicts.length} xung đột, ${p.info.replace.length} file khác bản trên hub).`);
    else if (m.type === 'preview') this._preview(p, String(m.path || ''), m.mode === 'merge' ? 'merge' : 'diff');
    else if (m.type === 'cancel') this._finish(false);
    else if (m.type === 'sync') {
      const answer = choicesOf(p.info, m.choices);
      if (answer) this._finish(answer);
    }
  }

  _postInit() {
    const { folder, info } = this.pending;
    this.panel.webview.postMessage({
      type: 'init',
      catalog: catalogFor('sync.'),
      plan: {
        firstTime: info.firstTime,
        project: info.project,
        folder: folder.name,
        path: folder.uri.fsPath,
        conflicts: info.conflicts,
        replace: info.replace,
        get: info.get,
        overwrite: info.overwrite,
        upload: info.upload,
        removeLocal: info.removeLocal,
      },
    });
  }

  async _preview(p, rel, mode) {
    const name = path.posix.basename(rel);
    const local = p.info.localText(rel);
    const other = mode === 'merge' ? await p.info.mergedText(rel) : await p.info.hubText(rel);
    if (this.pending !== p) return;
    if (local === null || other === null) {
      vscode.window.showWarningMessage(t('sync.preview.failed', { path: rel }));
      return;
    }
    const left = mode === 'merge' ? this._doc(p, 'local', rel, local) : this._doc(p, 'hub', rel, other);
    const right = mode === 'merge' ? this._doc(p, 'merged', rel, other) : this._doc(p, 'local', rel, local);
    const title = mode === 'merge' ? t('sync.diff.mergeTitle', { name }) : t('sync.diff.title', { name });
    // Beside the panel, so the rows stay in view while the member reads the diff.
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true });
  }

  _doc(p, side, rel, text) {
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${side}/${rel}`, query: String(p.seq) });
    this.docs.set(uri.toString(), text);
    return uri;
  }

  _resolve(answer) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    p.resolve(answer);
  }

  _finish(answer) {
    if (!this.pending) return;
    this._resolve(answer);
    const panel = this.panel;
    this.panel = null;
    if (panel) panel.dispose();
    this._closePreviews();
  }

  _closePreviews() {
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((tab) => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === SCHEME);
    if (tabs.length) vscode.window.tabGroups.close(tabs);
    this.docs.clear();
  }

  dispose() {
    this._finish(false);
    for (const d of this.disposables) d.dispose();
  }
}

// Only the files the plan asked about, and only choices that file can take. False while a conflict has no choice.
function choicesOf(info, sent) {
  const out = {};
  const given = sent && typeof sent === 'object' ? sent : {};
  for (const r of info.conflicts) {
    const c = given[r.path];
    if (c === 'hub' || c === 'local' || (c === 'merge' && r.mergeable)) out[r.path] = c;
    else return false;
  }
  for (const r of info.replace) out[r.path] = given[r.path] === 'local' ? 'local' : 'hub';
  return out;
}

module.exports = { SyncPanel };
