'use strict';

const vscode = require('vscode');
const { t } = require('../../lib/i18n');
const { ACTIVE } = require('../../lib/connection-machine');
const { join, copyInvite } = require('./connection/invite');
const { signIn } = require('./connection/account');
const { actionLabel, actionIcon, runAction, showNotConnected } = require('./connection/actions');
const { registerDiagnose } = require('./connection/diagnose');
const { restoreBackup } = require('./backup');

function connect(app) {
  const s = app.controller.state;
  if (s.name === 'live') {
    const disconnect = t('menu.disconnect');
    vscode.window.showInformationMessage(t('connect.already', { project: s.target.project }), disconnect).then((pick) => {
      if (pick) app.controller.disconnect();
    });
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
    showNotConnected(app);
    return;
  }
  const text = await vscode.window.showInputBox({ prompt: t('status.input.prompt'), value: core.status });
  if (text !== undefined) core.setStatus(text.trim());
}

const WALKTHROUGH = 'ndqitisme.lan-collab#lanCollab.start';

// The status bar menu: connection, team, history and help groups, each holding only what the current state can run.
// package.json hides the same commands from the command palette with `when` clauses on lanCollab.state.
function menuItems(app) {
  const { state } = app.controller;
  const follow = app.follow;
  const item = (icon, label, run) => ({ label: `${icon} ${label}`, run });
  const command = (id) => () => vscode.commands.executeCommand(id);
  const disconnect = item('$(debug-disconnect)', t('menu.disconnect'), () => app.controller.disconnect());

  // A needs_action state lists its own actions first. The generic item for the same command then stays out.
  const offered = new Set(state.name === 'needs_action' ? state.actions : []);
  const connection = [];
  if (state.name === 'needs_action') {
    for (const id of state.actions) connection.push(item(actionIcon(id), actionLabel(id), () => runAction(app, id, state)));
    connection.push(disconnect);
  } else if (state.name === 'reconnecting') {
    connection.push(item(actionIcon('reconnect'), t('action.reconnect'), () => app.controller.reconnect()), disconnect);
  } else if (ACTIVE.has(state.name)) {
    connection.push(disconnect);
  } else {
    connection.push(item('$(plug)', t('menu.connect'), () => connect(app)), item('$(key)', t('menu.join'), () => join(app)));
  }
  if (!offered.has('open_settings')) connection.push(item('$(settings-gear)', t('menu.openConnection'), command('lanCollab.openConnection')));
  if (!offered.has('sign_in') && !offered.has('switch_account')) connection.push(item('$(account)', t('menu.signIn'), () => signIn(app)));

  const team = [];
  const history = [];
  if (state.name === 'live') {
    const unread = app.statusBar.unread;
    team.push(item('$(comment-discussion)', unread ? t('menu.openChatUnread', { count: unread }) : t('menu.openChat'), command('lanCollab.openChat')));
    team.push(item('$(eye)', t('menu.follow'), () => follow.pick()));
    if (follow.following) team.push(item('$(eye-closed)', t('menu.unfollow'), () => follow.set(null)));
    team.push(item('$(edit)', t('menu.setStatus'), () => setStatus(app)));
    team.push(item('$(link)', t('menu.copyInvite'), () => copyInvite(app)));
    history.push(item('$(history)', t('command.lanCollab.showHistory.title'), command('lanCollab.showHistory')));
  }

  const help = [
    ...(offered.has('diagnose') ? [] : [item('$(pulse)', t('menu.diagnose'), command('lanCollab.diagnose'))]),
    item('$(output)', t('menu.showLog'), () => app.out.show()),
    item('$(book)', t('menu.walkthrough'), () => vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH, false)),
  ];

  const groups = [[t('menu.group.connection'), connection], [t('menu.group.team'), team], [t('menu.group.history'), history], [t('menu.group.help'), help]];
  return groups.filter(([, items]) => items.length)
    .flatMap(([label, items]) => [{ label, kind: vscode.QuickPickItemKind.Separator }, ...items]);
}

async function menu(app) {
  const pick = await vscode.window.showQuickPick(menuItems(app), { title: 'LAN Collab', placeHolder: t('menu.placeholder') });
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
  cmd('lanCollab.restoreBackup', () => restoreBackup(app));
}

module.exports = { registerCommands };
