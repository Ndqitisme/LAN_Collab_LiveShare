'use strict';

const vscode = require('vscode');
const { t } = require('../../lib/i18n');
const { ACTIVE } = require('../../lib/connection-machine');
const { join, copyInvite } = require('./connection/invite');
const { signIn } = require('./connection/account');
const { actionLabel, runAction } = require('./connection/actions');
const { registerDiagnose } = require('./connection/diagnose');

function connect(app) {
  const s = app.controller.state;
  if (s.name === 'live') {
    vscode.window.showInformationMessage(t('connect.already', { project: s.target.project }));
    return;
  }
  // Repeated clicks while a connection is under way only point at the status bar, which already shows it.
  if (ACTIVE.has(s.name)) {
    vscode.window.setStatusBarMessage(t('connect.busy'), 3000);
    return;
  }
  app.controller.connect();
}

async function setStatus(app) {
  const core = app.controller.core;
  if (!core) {
    vscode.window.showWarningMessage(t('connect.notConnected'));
    return;
  }
  const text = await vscode.window.showInputBox({ prompt: t('status.input.prompt'), value: core.status });
  if (text !== undefined) core.setStatus(text.trim());
}

async function menu(app) {
  const { state, core } = app.controller;
  const follow = app.follow;
  const disconnect = { label: `$(debug-disconnect) ${t('menu.disconnect')}`, run: () => app.controller.disconnect() };
  const items = [];
  if (state.name === 'needs_action') {
    for (const id of state.actions) items.push({ label: `$(tools) ${actionLabel(id)}`, run: () => runAction(app, id, state) });
    items.push(disconnect);
  } else if (core) {
    items.push({ label: `$(link) ${t('menu.copyInvite')}`, run: () => copyInvite(app) });
    const unread = app.statusBar.unread;
    items.push({ label: `$(comment-discussion) ${unread ? t('menu.openChatUnread', { count: unread }) : t('menu.openChat')}`, run: () => vscode.commands.executeCommand('lanCollab.openChat') });
    items.push({ label: `$(eye) ${t('menu.follow')}`, run: () => follow.pick() });
    if (follow.following) items.push({ label: `$(eye-closed) ${t('menu.unfollow')}`, run: () => follow.set(null) });
    items.push({ label: `$(comment) ${t('menu.setStatus')}`, run: () => setStatus(app) });
    items.push(disconnect);
  } else if (state.name === 'resolving') {
    items.push(disconnect);
  } else {
    items.push({ label: `$(plug) ${t('menu.connect')}`, run: () => connect(app) });
    items.push({ label: `$(key) ${t('menu.join')}`, run: () => join(app) });
  }
  items.push({ label: `$(settings-gear) ${t('menu.openConnection')}`, run: () => vscode.commands.executeCommand('lanCollab.openConnection') });
  items.push({ label: `$(pulse) ${t('menu.diagnose')}`, run: () => vscode.commands.executeCommand('lanCollab.diagnose') });
  items.push({ label: `$(account) ${t('menu.signIn')}`, run: () => signIn(app) });
  items.push({ label: `$(output) ${t('menu.showLog')}`, run: () => app.out.show() });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('menu.placeholder') });
  if (pick) pick.run();
}

function registerCommands(app) {
  const cmd = (id, fn) => app.context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  cmd('lanCollab.connect', () => connect(app));
  cmd('lanCollab.disconnect', () => app.controller.disconnect());
  cmd('lanCollab.menu', () => menu(app));
  cmd('lanCollab.follow', () => app.follow.pick());
  cmd('lanCollab.unfollow', () => app.follow.set(null));
  cmd('lanCollab.setStatus', () => setStatus(app));
  cmd('lanCollab.showLog', () => app.out.show());
  cmd('lanCollab.goTo', (id) => app.follow.goTo(id));
  cmd('lanCollab.openChat', () => vscode.commands.executeCommand('lanCollab.chat.focus'));
  cmd('lanCollab.signIn', () => signIn(app));
  cmd('lanCollab.join', (code) => join(app, code));
  cmd('lanCollab.copyInvite', () => copyInvite(app));
  registerDiagnose(app);
}

module.exports = { registerCommands };
