'use strict';

const vscode = require('vscode');
const { t, catalogFor } = require('../../../lib/i18n');
const { ACTIVE } = require('../../../lib/connection-machine');
const diagnostics = require('../../../lib/diagnostics');
const config = require('../config');
const joins = require('../connection/joins');
const secrets = require('../connection/secrets');
const { decodeInviteV3 } = require('../../../lib/common');
const { join, inviteProblem } = require('../connection/invite');
const { runDiagnosis, environmentInfo } = require('../connection/diagnose');
const { buildReport } = require('../connection/report');
const { reasonText, runAction } = require('../connection/actions');
const { webviewOptions, webviewHtml } = require('./webview-host');

// client-core emits no event when `pong` updates core.rtt.
const RTT_REFRESH_MS = 2000;
// Actions that change nothing the diagnostics check, so the steps are not run again after them.
const NO_RERUN = new Set(['copy_entry', 'update_extension']);

const fileFolder = () => {
  const f = config.workspaceFolder();
  return f && f.uri.scheme === 'file' ? f : null;
};
const failedIn = (results) => results.some((r) => r.status === 'failed');
const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

// The editor-area panel "Kết nối LAN Hub": setup (invite, a hub found on the LAN, or an address), the folder's
// connection, the live state, the diagnostics steps with their actions, and the reset of this folder's hub.
class ConnectionPanel {
  constructor(app) {
    this.app = app;
    this.panel = null;
    this.rttTimer = null;
    this.lastStatus = '';
    this.diag = { running: false, results: [], at: null };
    this.diagRun = Promise.resolve();
    this.lastTarget = null;
    this.hubs = { searching: false, list: [] };
    const { controller } = app;
    app.context.subscriptions.push(
      controller.onDidChange(({ state }) => {
        vscode.commands.executeCommand('setContext', 'lanCollab.connected', ACTIVE.has(state.name));
        this._postStatus();
        this._syncRttTimer();
      }),
      controller.onDidChangeCore((core) => {
        if (core) core.on('users', () => this._postStatus());
      }),
      vscode.commands.registerCommand('lanCollab.openConnection', (opts) => this.open(opts)),
      vscode.window.registerTreeDataProvider('lanCollab.start', { getChildren: () => [], getTreeItem: (x) => x }),
      { dispose: () => this.dispose() },
    );
    vscode.commands.executeCommand('setContext', 'lanCollab.connected', false);
  }

  get visible() {
    return Boolean(this.panel && this.panel.visible);
  }

  open(opts) {
    if (this.panel) this.panel.reveal();
    else this._create();
    if (opts && opts.diagnose) this.diagnose();
  }

  _create() {
    const { extensionUri } = this.app.context;
    const panel = vscode.window.createWebviewPanel('lanCollab.connection', t('connection.title'), vscode.ViewColumn.Active, {
      ...webviewOptions(extensionUri),
      retainContextWhenHidden: true,
    });
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    panel.webview.html = webviewHtml(panel.webview, extensionUri, 'connection', { bodyClass: 'lc-editor' });
    panel.webview.onDidReceiveMessage((m) => this._onMessage(m).catch((err) => this.app.log(`Màn hình kết nối: ${err.stack || err}`, 'error')));
    panel.onDidChangeViewState(() => this._syncRttTimer());
    panel.onDidDispose(() => {
      this.panel = null;
      this._syncRttTimer();
    });
    this.panel = panel;
    this.hubs = { searching: false, list: [] };
  }

  async _init() {
    this.discover();
    const snapshot = await this.snapshot();
    this.lastStatus = JSON.stringify(snapshot.status);
    this._post({
      type: 'init',
      catalog: { ...catalogFor('connection.'), ...catalogFor('diag.step.'), ...catalogFor('diag.status.'), ...catalogFor('action.') },
      snapshot,
      diag: this.diag,
      hubs: this.hubs,
    });
  }

  _post(msg) {
    if (this.panel) this.panel.webview.postMessage(msg);
  }

  async _onMessage(m) {
    switch (m.type) {
      case 'ready': return this._init();
      case 'rescan': return this.discover();
      case 'invite': return this._applyInvite(String(m.code || ''));
      case 'connectHub': {
        const hub = this.hubs.list.find((h) => h.instanceId === m.instanceId);
        if (!hub) return undefined;
        return this._applyNew({ addresses: hub.hosts, port: hub.port, project: String(m.project || ''), token: String(m.token || ''), instanceId: hub.instanceId });
      }
      case 'manual':
        return this._applyNew({ addresses: [String(m.host || '').trim()], port: Number(m.port), project: String(m.project || '').trim(), token: String(m.token || ''), instanceId: null });
      case 'save': return this._saveEditor(m);
      case 'revealToken': {
        const folder = fileFolder();
        this._post({ type: 'token', token: folder ? await config.tokenFor(this.app.context, folder) : '' });
        return undefined;
      }
      case 'diagnose': return this.diagnose();
      case 'action': return this._action(String(m.id || ''), m.code || null, m.data || {});
      case 'copyReport': return this._copyReport();
      case 'copy':
        await vscode.env.clipboard.writeText(String(m.text || ''));
        vscode.window.showInformationMessage(t('connection.copied'));
        return undefined;
      case 'reset': return this._reset();
      case 'connect': return this.app.controller.connect();
      case 'disconnect': return this.app.controller.disconnect();
      case 'openLog': return this.app.out.show();
      default: return undefined;
    }
  }

  // What the panel shows besides the diagnostics and the hub list. The token itself goes out only on revealToken.
  async snapshot() {
    const folder = fileFolder();
    const conn = folder && config.connectionFor(this.app.context, folder);
    const token = conn ? await config.tokenFor(this.app.context, folder) : '';
    return {
      folder: folder ? { name: folder.name, path: folder.uri.fsPath } : null,
      conn: conn ? {
        source: conn.source,
        host: conn.lastGood || conn.addresses[0] || '',
        addresses: [...new Set([conn.lastGood, ...conn.addresses].filter(Boolean))],
        port: conn.port,
        project: conn.project,
        fingerprint: conn.tlsFingerprint || null,
        instanceId: conn.instanceId || null,
        hasToken: Boolean(token),
      } : null,
      status: this.status(),
      discoveryPort: diagnostics.defaultEnv().discoveryPort,
    };
  }

  status() {
    const { state, core } = this.app.controller;
    const live = state.name === 'live' && core;
    return {
      name: state.name,
      target: state.target,
      code: state.code,
      reason: state.name === 'needs_action' ? reasonText(state) : null,
      nextAt: state.nextAt,
      wasLive: state.wasLive,
      rtt: live ? core.rtt : null,
      members: live ? core.users.size + 1 : null,
    };
  }

  _postStatus() {
    if (!this.panel) return;
    const status = this.status();
    const text = JSON.stringify(status);
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this._post({ type: 'status', status });
  }

  async _postSnapshot() {
    this._post({ type: 'snapshot', snapshot: await this.snapshot() });
  }

  _syncRttTimer() {
    const want = this.visible && this.app.controller.state.name === 'live';
    if (want && !this.rttTimer) this.rttTimer = setInterval(() => this._postStatus(), RTT_REFRESH_MS);
    else if (!want && this.rttTimer) {
      clearInterval(this.rttTimer);
      this.rttTimer = null;
    }
  }

  // One lanhub_discover round. Rows appear as hubs answer, so a hub on this machine shows within milliseconds.
  async discover() {
    if (this.hubs.searching) return;
    const folder = fileFolder();
    const conn = folder && config.connectionFor(this.app.context, folder);
    const known = [...new Set([...(conn ? [conn.lastGood, ...conn.addresses] : []), '127.0.0.1'].filter(Boolean))];
    const list = [];
    this.hubs = { searching: true, list };
    this._post({ type: 'hubs', hubs: this.hubs });
    const { error } = await diagnostics.discoverAll(known, diagnostics.defaultEnv(), (hub) => {
      if (!list.includes(hub)) list.push(hub);
      this._post({ type: 'hubs', hubs: { searching: true, list } });
    });
    if (error) this.app.log(`Tìm LAN Hub trong mạng LAN: ${error}`, 'warn');
    this.hubs = { searching: false, list };
    this._post({ type: 'hubs', hubs: this.hubs });
  }

  // Runs after any run already under way, so a run started after a save always checks the saved connection.
  diagnose() {
    this.diagRun = this.diagRun.catch(() => {}).then(() => this._runDiagnosis());
    return this.diagRun;
  }

  async _runDiagnosis() {
    this.diag = { running: true, results: [], at: Date.now() };
    this._post({ type: 'diag', diag: this.diag });
    try {
      const { target, results } = await runDiagnosis(this.app, (r) => {
        this.diag.results.push(r);
        this._post({ type: 'diagStep', result: r });
      });
      this.lastTarget = target;
      this.diag = { running: false, results, at: this.diag.at };
      return results;
    } catch (err) {
      this.app.log(`Chẩn đoán kết nối: ${err.stack || err}`, 'error');
      this.diag = { ...this.diag, running: false };
      return this.diag.results;
    } finally {
      this._post({ type: 'diag', diag: this.diag });
      this._postSnapshot();
    }
  }

  async _applyInvite(raw) {
    const code = raw.replace(/\s+/g, '');
    const problem = code ? inviteProblem(code) : t('join.input.badPrefix');
    if (problem) {
      this._post({ type: 'inviteError', text: problem });
      return;
    }
    const folder = fileFolder();
    // Without a folder the join flow picks one and reopens the window in it.
    if (!folder) {
      await join(this.app, code);
      return;
    }
    await config.saveJoin(this.app.context, folder.uri, decodeInviteV3(code), { host: null, instanceId: null });
    await this._afterSave();
  }

  // A hub picked from the LAN list or typed in: saved as this folder's hub record, like an invite.
  async _applyNew({ addresses, port, project, token, instanceId }) {
    if (!addresses[0] || !validPort(port) || !project) return;
    const record = { v: 2, instanceId, addresses, lastGood: null, port, project, tlsFingerprint: null };
    const folder = fileFolder();
    if (folder) {
      await this._saveRecord(folder.uri, record, token);
      await this._afterSave();
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: t('join.folder.openLabel'),
      title: t('join.folder.title', { project }),
    });
    if (!picked) return;
    await this._saveRecord(picked[0], record, token);
    vscode.commands.executeCommand('vscode.openFolder', picked[0]); // the window reloads and connects on start
  }

  // The connection editor. An unchanged address keeps every address the record knows; an untouched token field
  // keeps the stored token.
  async _saveEditor(m) {
    const folder = fileFolder();
    const conn = folder && config.connectionFor(this.app.context, folder);
    if (!conn) return;
    const host = String(m.host || '').trim();
    const port = Number(m.port);
    const project = String(m.project || '').trim();
    if (!host || !validPort(port) || !project) return;
    const known = [...new Set([conn.lastGood, ...conn.addresses].filter(Boolean))];
    const sameHost = host === (conn.lastGood || conn.addresses[0]);
    const token = typeof m.token === 'string' ? m.token : await config.tokenFor(this.app.context, folder);
    await this._saveRecord(folder.uri, {
      v: 2,
      instanceId: conn.instanceId || null,
      addresses: sameHost ? known : [host],
      lastGood: null,
      port,
      project,
      tlsFingerprint: conn.tlsFingerprint || null,
    }, token);
    await this._afterSave();
  }

  async _saveRecord(uri, record, token) {
    const key = config.folderKey(uri);
    await secrets.setToken(this.app.context.secrets, key, token);
    await joins.put(this.app.context.globalState, key, record);
    this.app.log(`Đã lưu LAN Hub của thư mục từ màn hình kết nối: ${record.addresses.join(', ')}:${record.port}, dự án "${record.project}"`);
  }

  // The steps run against what was saved, then the connection restarts on it. A failing step lands the machine in
  // needs_action with the same code the row shows.
  async _afterSave() {
    await this._postSnapshot();
    await this.diagnose();
    this.app.controller.reconnect();
  }

  async _action(id, code, data) {
    if (id === 'rediscover') this.discover();
    else if (id !== 'retry') {
      await runAction(this.app, id, { code, data });
      if (NO_RERUN.has(id)) return;
    }
    const results = await this.diagnose();
    // Actions such as Chọn dự án and Đăng nhập reconnect by themselves.
    if (!failedIn(results) && !ACTIVE.has(this.app.controller.state.name)) this.app.controller.reconnect();
  }

  async _copyReport() {
    if (!this.diag.results.length) return;
    const report = buildReport({ info: environmentInfo(), target: this.lastTarget, results: this.diag.results });
    await vscode.env.clipboard.writeText(report);
    vscode.window.showInformationMessage(t('diag.copied'));
  }

  // Forgets this folder's hub record and token. Project files and the lanCollab settings stay as they are.
  async _reset() {
    const folder = fileFolder();
    if (!folder) return;
    const go = t('connection.reset.button');
    const pick = await vscode.window.showWarningMessage(t('connection.reset.confirm'), { modal: true, detail: t('connection.reset.confirmDetail', { path: folder.uri.fsPath }) }, go);
    if (pick !== go) return;
    this.app.controller.disconnect();
    const key = config.folderKey(folder.uri);
    await joins.remove(this.app.context.globalState, key);
    await secrets.deleteToken(this.app.context.secrets, key);
    this.app.log(`Đã đặt lại kết nối cho thư mục ${folder.uri.fsPath}: xoá bản ghi LAN Hub và token.`);
    this.diag = { running: false, results: [], at: null };
    this.lastTarget = null;
    this._post({ type: 'diag', diag: this.diag });
    await this._postSnapshot();
    const remains = config.connectionFor(this.app.context, folder);
    vscode.window.showInformationMessage(remains ? t('connection.reset.settingsRemain') : t('connection.reset.done'));
  }

  dispose() {
    clearInterval(this.rttTimer);
    if (this.panel) this.panel.dispose();
  }
}

module.exports = { ConnectionPanel };
