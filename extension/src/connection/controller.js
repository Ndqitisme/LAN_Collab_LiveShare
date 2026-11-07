'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const { CollabClient } = require('../../../lib/client-core');
const machine = require('../../../lib/connection-machine');
const config = require('../config');
const { getAccount } = require('./account');

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
    this.resolved = null; // {folder, conn, account, name, exclude} of the current session
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
    if (restarted || !machine.WITH_CORE.has(next.name)) this._teardown();
    if (next.name === 'resolving') this._resolve(next.session);
    else if (next.name === 'connecting' && prev.name === 'resolving') this._start(next.session);
    this.changed.fire({ prev, state: next });
  }

  async _resolve(session) {
    this.resolved = null;
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
    const account = await getAccount(this.app, false);
    if (this.state.session !== session) return;
    this.resolved = { folder, conn, account, name: config.displayName(account), exclude: config.excludeOf(folder) };
    this.dispatch({ type: 'RESOLVED', session, target: { host: conn.host, port: conn.port, project: conn.project } });
  }

  _start(session) {
    const { folder, conn, account, name } = this.resolved;
    const { host, port, project, token } = conn;
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
      confirmSync: (info) => this.app.sync.decide(folder, info),
      log: this.app.log,
    });
    this.core = core;
    this.folder = folder;
    core.on('connection', (e) => this.dispatch({ ...e, session }));

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
      this.restartTimer = setTimeout(() => this._restartIfChanged(), 1000);
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

  _restartIfChanged() {
    const s = this.state;
    if (!machine.ACTIVE.has(s.name) && s.name !== 'needs_action') return;
    const r = this.resolved;
    const folder = config.workspaceFolder();
    const conn = folder && config.connectionFor(this.app.context, folder);
    if (r && config.sameConnection(r.conn, conn) && r.exclude === config.excludeOf(folder)) return;
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
