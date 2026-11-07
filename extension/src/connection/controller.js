'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const { CollabClient } = require('../../../lib/client-core');
const machine = require('../../../lib/connection-machine');
const diagnostics = require('../../../lib/diagnostics');
const config = require('../config');
const joins = require('./joins');
const { getAccount } = require('./account');
const { confirmSync } = require('./sync-ui');

// Settings baked into a running client core. A change restarts the connection without asking.
const RESTART_KEYS = ['lanCollab.server', 'lanCollab.project', 'lanCollab.token', 'lanCollab.exclude'];

// The only writer of the connection state. It feeds events to lib/connection-machine.js, runs the effects of
// each new state (resolve the folder's hub, start or dispose the client core) and publishes the state.
class ConnectionController {
  constructor(app) {
    this.app = app;
    this.state = machine.initial;
    this.core = null;
    this.folder = null;
    this.resolved = null; // {folder, conn, token, account, name, exclude} of the current session
    this.pending = null; // the socket _resolve won, taken by the core's first attempt
    this.watcher = null;
    this.queue = [];
    this.stepping = false;
    this.restartTimer = null;
    this.changed = new vscode.EventEmitter();
    this.onDidChange = this.changed.event; // ({prev, state})
    this.coreChanged = new vscode.EventEmitter();
    this.onDidChangeCore = this.coreChanged.event; // (core | null)
  }

  connect() {
    this.dispatch({ type: 'CONNECT' });
  }

  reconnect() {
    this.dispatch({ type: 'RECONNECT' });
  }

  disconnect() {
    this.dispatch({ type: 'DISCONNECT' });
  }

  // A core emits synchronously from inside an effect (connect() reports its first attempt): such events wait
  // until the current transition has run its effects and published, so listeners see states in order.
  dispatch(event) {
    this.queue.push(event);
    if (this.stepping) return;
    this.stepping = true;
    try {
      while (this.queue.length) this._step(this.queue.shift());
    } finally {
      this.stepping = false;
    }
  }

  _step(event) {
    const prev = this.state;
    const next = machine.transition(prev, event);
    if (next === prev) return;
    this.state = next;
    const restarted = next.session !== prev.session;
    if (next.name !== prev.name || restarted) this.app.log(`Trạng thái kết nối: ${prev.name} → ${next.name}${next.code !== null ? ` (${next.code})` : ''}`);
    if (next.name === 'reconnecting' && next.attempt !== prev.attempt) this.app.log(`Thử kết nối lại lần ${next.attempt}.`);
    if (next.name === 'reconnecting' && next.nextAt && next.nextAt !== prev.nextAt) this.app.log(`Thử kết nối lại sau ${((next.nextAt - Date.now()) / 1000).toFixed(1)} giây.`);
    if (restarted || !machine.WITH_CORE.has(next.name)) this._teardown();
    if (next.name === 'resolving') this._resolve(next.session);
    else if (next.name === 'connecting' && prev.name === 'resolving') this._start(next.session);
    this.changed.fire({ prev, state: next });
  }

  // Steps 1 to 5 of the diagnostics before any core exists: the folder has a hub and is writable, then the race over
  // every known address with rediscovery and the TLS pin. A failure lands in needs_action with its code.
  async _resolve(session) {
    this.resolved = null;
    this._dropPending();
    const folder = config.workspaceFolder();
    if (!folder || folder.uri.scheme !== 'file') {
      this.dispatch({ type: 'RESOLVE_FAILED', session, code: 'no_folder' });
      return;
    }
    const conn = config.connectionFor(this.app.context, folder);
    if (!conn) {
      this.dispatch({ type: 'RESOLVE_FAILED', session, code: 'unbound' });
      return;
    }
    const [token, account] = await Promise.all([config.tokenFor(this.app.context, folder), getAccount(this.app, false)]);
    if (this.state.session !== session) return;
    const writeError = diagnostics.checkWritable(folder.uri.fsPath, diagnostics.defaultEnv());
    if (writeError) {
      this.app.log(`Không ghi được vào ${folder.uri.fsPath}: ${writeError}`);
      this.dispatch({ type: 'RESOLVE_FAILED', session, code: 'folder_readonly', data: { path: folder.uri.fsPath } });
      return;
    }
    this.resolved = { folder, conn, token, account, name: config.displayName(account), exclude: config.excludeOf(folder) };
    let won;
    try {
      won = await this._openSocket();
    } catch (err) {
      if (this.state.session !== session) return;
      this.app.log(`Không kết nối được LAN Hub: ${err.message}`);
      this.dispatch({ type: 'RESOLVE_FAILED', session, code: err.code || 'failed', data: err.data || {} });
      return;
    }
    if (this.state.session !== session) {
      won.socket.destroy();
      return;
    }
    this.pending = won;
    this.dispatch({ type: 'RESOLVED', session, target: { host: won.host, port: won.port, project: conn.project } });
  }

  // The core's socket factory, so every reconnect attempt reruns the race and rediscovery. The invite record is
  // read again each time: an earlier welcome may have stored a new lastGood or the instanceId.
  async _openSocket() {
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      return pending;
    }
    const { folder, conn } = this.resolved;
    const target = conn.source === 'join' ? { ...conn, ...joins.get(this.app.context.globalState, config.folderKey(folder.uri)) } : conn;
    const won = await diagnostics.resolve(target);
    if (won.via === 'discovery') this.app.log(`Đã tìm thấy LAN Hub tại địa chỉ mới ${won.host}:${won.port}.`);
    return won;
  }

  _dropPending() {
    if (this.pending) this.pending.socket.destroy();
    this.pending = null;
  }

  // A welcome proves the address and gives the hub's instanceId, which folders joined with a 0.1 code lack.
  async _rememberHub(core, instanceId) {
    const { folder, conn } = this.resolved;
    if (conn.source !== 'join') return;
    const key = config.folderKey(folder.uri);
    const rec = joins.get(this.app.context.globalState, key);
    if (!rec) return;
    const patch = {};
    if (instanceId && rec.instanceId !== instanceId) patch.instanceId = instanceId;
    if (rec.lastGood !== core.host) patch.lastGood = core.host;
    if (rec.port !== core.port) patch.port = core.port;
    if (!Object.keys(patch).length) return;
    await joins.update(this.app.context.globalState, key, patch);
    this.app.log(`Đã lưu LAN Hub của thư mục: ${JSON.stringify(patch)}`);
  }

  _start(session) {
    const { folder, conn, token, account, name } = this.resolved;
    const { host, port } = this.state.target;
    const { project } = conn;
    const cfg = vscode.workspace.getConfiguration('lanCollab', folder.uri);
    const ctx = this.app.context;
    const core = new CollabClient({
      root: folder.uri.fsPath,
      host,
      port,
      token,
      project,
      name,
      account,
      uid: crypto.randomUUID(),
      device: vscode.env.machineId,
      exclude: cfg.get('exclude'),
      autoSave: cfg.get('autoSave'),
      state: {
        get: (k) => ctx.workspaceState.get(`lanCollab.${k}`),
        set: (k, v) => ctx.workspaceState.update(`lanCollab.${k}`, v),
      },
      confirmSync: (info) => confirmSync(folder, info),
      log: this.app.log,
      openSocket: () => this._openSocket(),
      retryDelay: (n) => diagnostics.backoffDelay(n),
    });
    this.core = core;
    this.folder = folder;
    core.on('connection', (e) => {
      if (e.type === 'WELCOME') this._rememberHub(core, e.instanceId).catch((err) => this.app.log(`Không lưu được LAN Hub của thư mục: ${err.message}`));
      this.dispatch({ ...e, session });
    });

    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
    const onDisk = (uri) => core.onDiskEvent(uri.fsPath);
    this.watcher.onDidChange(onDisk);
    this.watcher.onDidCreate(onDisk);
    this.watcher.onDidDelete(onDisk);

    this.coreChanged.fire(core);
    this.app.log(`Kết nối ${host}:${port} (dự án "${project}", tên "${name}"${account ? `, tài khoản ${account.provider}:${account.label}` : ''})`);
    core.connect();
  }

  // Editors let go of their files before the core flushes pending disk writes in disconnect().
  _teardown() {
    this._dropPending();
    const core = this.core;
    if (!core) return;
    this.core = null;
    core.removeAllListeners();
    this.coreChanged.fire(null);
    if (this.watcher) this.watcher.dispose();
    this.watcher = null;
    core.disconnect();
    this.app.log('Đã ngắt kết nối.');
  }

  onConfigChanged(e) {
    const core = this.core;
    const uri = this.folder ? this.folder.uri : undefined;
    if (core && e.affectsConfiguration('lanCollab.autoSave', uri)) core.autoSave = vscode.workspace.getConfiguration('lanCollab', uri).get('autoSave') !== false;
    if (core && e.affectsConfiguration('lanCollab.name')) this._rename(core);
    if (RESTART_KEYS.some((k) => e.affectsConfiguration(k, uri))) {
      // The settings editor writes while the member types: wait for the value to settle.
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => this._restartIfChanged().catch((err) => this.app.log(`[LỖI] áp cấu hình kết nối: ${err.stack || err}`)), 1000);
    }
  }

  // Protocol 2 has no rename message: the hub and the other members get the new name with the next hello.
  async _rename(core) {
    const name = config.displayName(await getAccount(this.app, false));
    if (this.core !== core || core.name === name) return;
    core.name = name;
    this.app.log(`Tên hiển thị: "${name}"`);
    this.changed.fire({ prev: this.state, state: this.state });
  }

  async _restartIfChanged() {
    const settled = () => machine.ACTIVE.has(this.state.name) || this.state.name === 'needs_action';
    if (!settled()) return;
    // A token typed into the settings moves to SecretStorage before it is compared.
    await config.migrateTokens(this.app.context, this.app.log);
    const r = this.resolved;
    const folder = config.workspaceFolder();
    const conn = folder && config.connectionFor(this.app.context, folder);
    const token = conn ? await config.tokenFor(this.app.context, folder) : '';
    if (!settled()) return;
    if (r && config.sameConnection(r.conn, conn) && r.token === token && r.exclude === config.excludeOf(folder)) return;
    this.app.log('Cấu hình kết nối đã đổi, kết nối lại.');
    this.dispatch({ type: 'CONFIG_CHANGED' });
  }

  dispose() {
    clearTimeout(this.restartTimer);
    this._teardown();
    this.changed.dispose();
    this.coreChanged.dispose();
  }
}

module.exports = { ConnectionController };
