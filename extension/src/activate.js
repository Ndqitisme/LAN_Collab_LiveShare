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
const { PeopleTree } = require('./views/people');
const { Editors } = require('./editors');
const { Decorations } = require('./decorations');
const { Presence } = require('./presence');
const { Follow } = require('./follow');

let app = null;

function activate(context) {
  const out = vscode.window.createOutputChannel('LAN Collab');
  const log = (line) => {
    out.appendLine(`[${new Date().toLocaleTimeString('vi-VN')}] ${line}`);
    if (process.env.LAN_COLLAB_DEBUG) console.log(`[lan-collab] ${line}`);
  };
  app = { context, out, log, lastEditor: null };
  app.controller = new ConnectionController(app);
  app.editors = new Editors(app);
  app.decorations = new Decorations(app);
  app.presence = new Presence(app);
  app.follow = new Follow(app);
  app.tree = new PeopleTree(app);
  app.statusBar = new StatusBar(app);
  app.chatView = new ChatView({
    core: () => app.controller.core,
    extensionUri: context.extensionUri,
    sendLocation: () => app.follow.sendLocation(),
    openRef: (ref, line) => app.follow.openRef(ref, line),
    onUnread: (n) => app.statusBar.setUnread(n),
  });
  registerCommands(app);

  const { controller, editors, decorations, presence, tree, statusBar, chatView } = app;
  context.subscriptions.push(
    out,
    statusBar.item,
    vscode.window.createTreeView('lanCollab.people', { treeDataProvider: tree }),
    vscode.window.registerWebviewViewProvider('lanCollab.chat', chatView, { webviewOptions: { retainContextWhenHidden: true } }),
    controller.onDidChange(({ prev, state }) => {
      statusBar.render();
      tree.refresh();
      if (state.name === 'needs_action' && prev.name !== 'needs_action') showNeedsAction(app, state);
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
    vscode.debug.onDidStartDebugSession(() => presence.schedule()),
    vscode.debug.onDidTerminateDebugSession(() => presence.schedule()),
    vscode.debug.onDidChangeActiveDebugSession(() => presence.schedule()),
  );

  statusBar.render();
  const first = config.workspaceFolder();
  if (vscode.workspace.getConfiguration('lanCollab').get('autoConnect') && first && config.connectionFor(context, first)) controller.connect();
  return { core: () => app.controller.core };
}

function wireCore(core) {
  const { editors, decorations, presence, follow, tree, statusBar, chatView, log } = app;
  core.on('chat', (msg) => chatView.onMessage(msg));
  core.on('chat-rejected', (reason) => chatView.onRejected(reason));
  core.on('ready', () => {
    chatView.refresh();
    showDownloadProgress(app.controller);
    editors.bindAll();
    presence.schedule();
    decorations.schedule();
    tree.refresh();
  });
  core.on('entry', (rel) => editors.bindRel(rel));
  core.on('unbind', (rel) => editors.unbindRel(rel));
  core.on('users', () => {
    decorations.prune(core.users);
    follow.onUsers(core.users);
    tree.refresh();
    statusBar.render();
    decorations.schedule();
    chatView.updatePeople();
  });
  core.on('presence', (id) => {
    tree.refresh();
    decorations.schedule();
    if (id === follow.following) follow.followNow();
  });
  core.on('activity', (a) => {
    log(`${a.who} ${a.text}`);
    tree.refresh();
  });
  core.on('backup', (dir) => {
    vscode.window.showWarningMessage(t('sync.backup', { dir }));
  });
}

function coreGone() {
  app.editors.disposeAll();
  app.decorations.disposeAll();
  app.follow.following = null;
  app.tree.refresh();
  app.chatView.refresh();
}

function deactivate() {
  if (app) app.controller.dispose();
}

module.exports = { activate, deactivate };
