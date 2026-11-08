'use strict';

// Captions and handlers for the action ids a needs_action state carries (lib/connection-machine.js).
const vscode = require('vscode');
const { t } = require('../../../lib/i18n');
const { problemText } = require('../../../lib/diagnostics');
const config = require('../config');
const { join, pasteInvite } = require('./invite');
const { signIn } = require('./account');

const EXTENSION_ID = 'ndqitisme.lan-collab';

// The codicon each action carries in the status bar menu.
const ACTION_ICONS = {
  join: '$(key)',
  open_settings: '$(settings-gear)',
  paste_invite: '$(key)',
  enter_token: '$(lock)',
  choose_project: '$(folder)',
  sign_in: '$(sign-in)',
  switch_account: '$(account)',
  copy_entry: '$(copy)',
  update_extension: '$(cloud-download)',
  reconnect: '$(refresh)',
  diagnose: '$(pulse)',
};

const actionIcon = (id) => ACTION_ICONS[id] || ACTION_ICONS.diagnose;

function actionLabel(id) {
  switch (id) {
    case 'join': return t('action.join');
    case 'open_settings': return t('action.open_settings');
    case 'paste_invite': return t('action.paste_invite');
    case 'enter_token': return t('action.enter_token');
    case 'choose_project': return t('action.choose_project');
    case 'sign_in': return t('action.sign_in');
    case 'switch_account': return t('action.switch_account');
    case 'copy_entry': return t('action.copy_entry');
    case 'update_extension': return t('action.update_extension');
    case 'reconnect': return t('action.reconnect');
    default: return t('action.diagnose');
  }
}

function reasonText(s) {
  if (s.code === 'no_folder') return t('connect.noFolder');
  if (s.code === 'unbound') return t('connect.unbound');
  // A protocol 1 hub refuses with its own sentence.
  return typeof s.data.message === 'string' ? s.data.message : problemText(s.code, s.data);
}

async function enterToken(app) {
  const folder = config.workspaceFolder();
  if (!folder) return;
  const token = await vscode.window.showInputBox({ prompt: t('token.input.prompt'), placeHolder: t('token.input.placeholder'), password: true, ignoreFocusOut: true });
  if (token === undefined) return;
  await config.updateConnection(app.context, folder, { token: token.trim() });
  app.controller.reconnect();
}

async function chooseProject(app, s) {
  const folder = config.workspaceFolder();
  if (!folder) return;
  const project = await vscode.window.showQuickPick(s.data.projects, { placeHolder: t('project.pick.placeholder', { host: s.data.host, port: s.data.port }) });
  if (!project) return;
  await config.updateConnection(app.context, folder, { project });
  app.controller.reconnect();
}

async function copyEntry(entry) {
  await vscode.env.clipboard.writeText(entry);
  vscode.window.showInformationMessage(t('account.entryCopied', { entry }));
}

function runAction(app, id, s) {
  switch (id) {
    case 'join': return join(app);
    case 'open_settings': return vscode.commands.executeCommand('lanCollab.openConnection');
    case 'paste_invite': return pasteInvite(app);
    case 'enter_token': return enterToken(app);
    case 'choose_project': return chooseProject(app, s);
    case 'sign_in':
    case 'switch_account': return signIn(app);
    case 'copy_entry': return copyEntry(String(s.data.entry || ''));
    case 'update_extension': return vscode.commands.executeCommand('extension.open', EXTENSION_ID);
    case 'reconnect': return app.controller.reconnect();
    default: return vscode.commands.executeCommand('lanCollab.openConnection', { diagnose: true });
  }
}

// For a command that needs a live connection, run while there is none.
async function showNotConnected(app) {
  const connect = t('menu.connect');
  const pick = await vscode.window.showWarningMessage(t('connect.notConnected'), connect, t('action.diagnose'));
  if (pick === connect) vscode.commands.executeCommand('lanCollab.connect');
  else if (pick) vscode.commands.executeCommand('lanCollab.diagnose');
}

// The toast shown once when the connection lands in needs_action. The status bar menu offers the same actions.
async function showNeedsAction(app, s) {
  const labels = s.actions.map(actionLabel);
  const show = s.code === 'no_folder' || s.code === 'unbound' ? vscode.window.showWarningMessage : vscode.window.showErrorMessage;
  const pick = await show(reasonText(s), ...labels);
  if (pick) runAction(app, s.actions[labels.indexOf(pick)], s);
}

module.exports = { actionLabel, actionIcon, reasonText, runAction, showNeedsAction, showNotConnected };
