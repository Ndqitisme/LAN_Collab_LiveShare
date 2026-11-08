'use strict';

const vscode = require('vscode');
const { catalogFor } = require('../../../lib/i18n');
const { webviewOptions, webviewHtml } = require('./webview-host');
const { connectionView } = require('./session');
const { runAction } = require('../connection/actions');

// LAN Hub serves at most 200 runs per history_list.
const PAGE_SIZE = 200;
const RUN_ACTIONS = new Set(['openAfter', 'diffCurrent', 'diffBefore', 'copy', 'revert', 'restoreFile', 'restoreVersion']);

// The `Lịch sử chỉnh sửa` view: edit runs of the open file or of the whole project. The webview keeps the pages it
// loaded and asks for more; the host answers from LAN Hub and forwards history_changed.
class HistoryView {
  constructor(app) {
    this.app = app;
    this.view = null;
    this.activePath = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = webviewOptions(this.app.context.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.app.context.extensionUri, 'history');
    view.webview.onDidReceiveMessage((m) => this._onMessage(m));
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  _onMessage(m) {
    if (m.type === 'ready') this.refresh();
    else if (m.type === 'load') this._load(typeof m.path === 'string' ? m.path : null, typeof m.before === 'string' ? m.before : null, m.gen);
    else if (m.type === 'run' && RUN_ACTIONS.has(m.action)) vscode.commands.executeCommand(`lanCollab.history.${m.action}`, String(m.id));
    else if (m.type === 'size') this._size(String(m.id));
    else if (m.type === 'action') {
      const s = this.app.controller.state;
      if (m.id === 'connect') vscode.commands.executeCommand('lanCollab.connect');
      else if (s.name === 'needs_action' && s.actions.includes(m.id)) runAction(this.app, m.id, s);
      else if (m.id === 'join' || m.id === 'reconnect') runAction(this.app, m.id, s);
    }
  }

  _post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  refresh() {
    this._post({ type: 'init', catalog: catalogFor('history.'), ...this.snapshot() });
  }

  // Connection, feature or open file changed.
  update() {
    this._post({ type: 'state', ...this.snapshot() });
  }

  snapshot() {
    const { state, core } = this.app.controller;
    const live = state.name === 'live' && core;
    const rel = this._activePath();
    if (rel !== undefined) this.activePath = rel;
    return { connection: connectionView(state), feature: Boolean(live && core.hasHistory()), activePath: live ? this.activePath : null };
  }

  // The active tab moved: another file, another group, or a file closed.
  onTabs() {
    const rel = this._activePath();
    if (rel !== undefined && rel !== this.activePath) this.update();
  }

  // The project file of the active tab, null for a file outside the project, undefined to keep the file shown.
  // The tab rather than the text editor, because an image opens in a custom editor; and a history document, a diff
  // of two of them or any other non-file tab keeps the file, so opening a run beside it does not switch the list.
  _activePath() {
    const core = this.app.controller.core;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab && tab.input;
    const uri = input && (input.uri || input.modified);
    if (!core || !(uri instanceof vscode.Uri) || uri.scheme !== 'file') return undefined;
    return core.relOf(uri.fsPath);
  }

  onChanged(rel) {
    this._post({ type: 'changed', path: rel });
  }

  async _load(rel, before, gen) {
    const history = this.app.history;
    try {
      if (!history) throw new Error('not connected');
      const page = await history.list(rel, before, PAGE_SIZE);
      this._post({ type: 'page', gen, before, runs: page.runs, more: page.more });
    } catch (err) {
      this.app.log(`Lịch sử chỉnh sửa ${rel || '(dự án)'}: ${err.message}`, 'error');
      this._post({ type: 'page', gen, before, error: true });
    }
  }

  async _size(id) {
    const history = this.app.history;
    const run = history && history.run(id);
    let bytes = null;
    try {
      const content = run && run.end_blob ? await history.blob(run.end_blob) : null;
      if (content) bytes = content.kind === 'text' ? Buffer.byteLength(content.text, 'utf8') : Buffer.from(content.b64, 'base64').length;
    } catch (err) {
      this.app.log(`Lịch sử chỉnh sửa: không đọc được nội dung lượt ${id}: ${err.message}`, 'error');
    }
    this._post({ type: 'size', id, bytes });
  }
}

module.exports = { HistoryView };
