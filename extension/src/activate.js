'use strict';

const vscode = require('vscode');
const { t } = require('../../lib/i18n');
const { ChatView } = require('./views/chat');
const config = require('./config');
const { ConnectionController } = require('./connection/controller');
const { showNeedsAction } = require('./connection/actions');
const { showDownloadProgress } = require('./connection/sync-ui');
const { registerCommands } = require('./commands');
const { StatusBar } = require('./status-bar');
const { SessionView } = require('./views/session');
const { ConnectionPanel } = require('./views/connection');
const { SyncPanel } = require('./views/sync');
const { Editors } = require('./editors');
const { Decorations } = require('./decorations');
const { Presence } = require('./presence');
const { Follow } = require('./follow');
const { HistoryView } = require('./views/history');
const { registerHistory } = require('./history/commands');
const { HistoryClient } = require('../../lib/history-client');

let app = null;

function activate(context) {
  const out = vscode.window.createOutputChannel('LAN Collab');
  const log = (line) => {
    out.appendLine(`[${new Date().toLocaleTimeString('vi-VN')}] ${line}`);
    if (process.env.LAN_COLLAB_DEBUG) console.log(`[lan-collab] ${line}`);
  };
  app = { context, out, log, lastEditor: null };
  app.controller = new ConnectionController(app);
  app.sync = new SyncPanel(app);
  app.editors = new Editors(app);
  app.decorations = new Decorations(app);
  app.presence = new Presence(app);
  app.follow = new Follow(app);
  app.session = new SessionView(app);
  app.statusBar = new StatusBar(app);
  app.connectionPanel = new ConnectionPanel(app);
  app.history = null;
  app.historyView = new HistoryView(app);
  app.chatView = new ChatView({
    core: () => app.controller.core,
    extensionUri: context.extensionUri,
    sendLocation: () => app.follow.sendLocation(),
    openRef: (ref, line) => app.follow.openRef(ref, line),
    onUnread: (n) => app.statusBar.setUnread(n),
  });
  registerCommands(app);
  registerHistory(app);

  const { controller, editors, decorations, presence, session, statusBar, chatView, historyView } = app;
  context.subscriptions.push(
    out,
    app.sync,
    statusBar.item,
    vscode.window.registerWebviewViewProvider('lanCollab.session', session, { webviewOptions: { retainContextWhenHidden: true } }),
    session,
    vscode.window.registerWebviewViewProvider('lanCollab.chat', chatView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider('lanCollab.history', historyView, { webviewOptions: { retainContextWhenHidden: true } }),
    controller.onDidChange(({ prev, state }) => {
      statusBar.render();
      session.refresh();
      historyView.update();
      // The open connection panel already shows the reason and its actions.
      if (state.name === 'needs_action' && prev.name !== 'needs_action' && !app.connectionPanel.visible) showNeedsAction(app, state);
    }),
    controller.onDidChangeCore((core) => (core ? wireCore(core) : coreGone())),
    vscode.workspace.onDidChangeConfiguration((e) => controller.onConfigChanged(e)),
    vscode.workspace.onDidOpenTextDocument((doc) => editors.bind(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => editors.unbind(doc)),
    vscode.workspace.onDidChangeTextDocument((ev) => editors.onDocChange(ev)),
    vscode.workspace.onWillSaveTextDocument((e) => editors.bindingOf(e.document)?.onWillSave()),
    vscode.workspace.onDidSaveTextDocument((doc) => editors.bindingOf(doc)?.onSaved()),
    vscode.window.onDidChangeTextEditorSelection(() => presence.schedule()),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) app.lastEditor = ed;
      presence.schedule();
      decorations.schedule();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => decorations.schedule()),
    vscode.window.tabGroups.onDidChangeTabs(() => historyView.onTabs()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => historyView.onTabs()),
    vscode.debug.onDidStartDebugSession(() => presence.schedule()),
    vscode.debug.onDidTerminateDebugSession(() => presence.schedule()),
    vscode.debug.onDidChangeActiveDebugSession(() => presence.schedule()),
  );

  statusBar.render();
  // Tokens move to SecretStorage before the first connection reads one.
  config.migrateTokens(context, log).catch((err) => log(`[LỖI] chuyển token vào kho bí mật: ${err.stack || err}`)).then(() => {
    const first = config.workspaceFolder();
    if (vscode.workspace.getConfiguration('lanCollab').get('autoConnect') && first && config.connectionFor(context, first)) controller.connect();
  });
  return { core: () => app.controller.core, session: () => app.session.snapshot() };
}

function wireCore(core) {
  const { editors, decorations, presence, follow, session, statusBar, chatView, historyView, log } = app;
  app.history = new HistoryClient(core);
  app.history.on('changed', (rel) => historyView.onChanged(rel));
  core.on('chat', (msg) => chatView.onMessage(msg));
  core.on('chat-rejected', (reason) => chatView.onRejected(reason));
  core.on('ready', () => {
    chatView.refresh();
    showDownloadProgress(app.controller);
    editors.bindAll();
    presence.schedule();
    decorations.schedule();
    historyView.update();
  });
  core.on('entry', (rel) => editors.bindRel(rel));
  core.on('unbind', (rel) => editors.unbindRel(rel));
  core.on('users', () => {
    decorations.prune(core.users);
    follow.onUsers(core.users);
    session.update();
    statusBar.render();
    decorations.schedule();
    chatView.updatePeople();
  });
  core.on('presence', (id) => {
    session.update();
    decorations.schedule();
    if (id === follow.following) follow.followNow();
  });
  core.on('activity', (a) => {
    log(`${a.who} ${a.text}`);
    session.onActivity(a);
  });
  core.on('backup', (dir) => {
    vscode.window.showWarningMessage(t('sync.backup', { dir }));
  });
}

function coreGone() {
  if (app.history) app.history.dispose();
  app.history = null;
  app.historyView.update();
  app.editors.disposeAll();
  app.decorations.disposeAll();
  app.follow.following = null;
  app.session.refresh();
  app.chatView.refresh();
}

function deactivate() {
  if (app) app.controller.dispose();
}

module.exports = { activate, deactivate };
