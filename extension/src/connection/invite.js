'use strict';

const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const { t } = require('../../../lib/i18n');
const { ACTIVE } = require('../../../lib/connection-machine');
const { encodeInvite, decodeInvite } = require('../../../lib/common');
const config = require('../config');
const { probe } = require('./probe');

function isEmptyDir(p) {
  try {
    return fs.readdirSync(p).every((n) => n === '.vscode' || n === '.lan-collab');
  } catch {
    return false;
  }
}

// The input box message for a pasted code, or null when it decodes or nothing is typed yet.
function inviteProblem(value) {
  const code = String(value || '').replace(/\s+/g, '');
  if (!code || decodeInvite(code)) return null;
  return /^LC3?-/.test(code) ? t('join.input.unreadable') : t('join.input.badPrefix');
}

// A decoded invite the hub accepts, or null after telling the member why not.
async function askInvite(app, codeArg) {
  const code = typeof codeArg === 'string' ? codeArg : await vscode.window.showInputBox({
    prompt: t('join.input.prompt'),
    placeHolder: t('join.input.placeholder'),
    ignoreFocusOut: true,
    validateInput: inviteProblem,
  });
  if (!code) return null;
  const conn = decodeInvite(code);
  if (!conn) return null;
  const err = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('join.progress.probe', { host: conn.host, port: conn.port }) }, () => probe(conn, app.log));
  if (err) {
    vscode.window.showErrorMessage(err);
    return null;
  }
  return conn;
}

async function join(app, codeArg) {
  const s = app.controller.state;
  if (ACTIVE.has(s.name)) {
    vscode.window.showWarningMessage(s.target ? t('join.error.connected', { project: s.target.project }) : t('connect.busy'));
    return;
  }
  const conn = await askInvite(app, codeArg);
  if (!conn) return;

  let target = config.workspaceFolder();
  if (!(target && target.uri.scheme === 'file' && isEmptyDir(target.uri.fsPath))) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: t('join.folder.openLabel'),
      title: t('join.folder.title', { project: conn.project }),
    });
    if (!picked) return;
    // A folder with files gets the sync panel on its first sync: every file to replace or upload is listed there
    // with a choice before anything is written.
    target = { uri: picked[0] };
  }
  await config.saveJoin(app.context, target.uri, conn);

  const current = config.workspaceFolder();
  if (current && config.folderKey(current.uri) === config.folderKey(target.uri)) app.controller.connect();
  else vscode.commands.executeCommand('vscode.openFolder', target.uri); // the window reloads and connects on start
}

// A new invite for the folder already open: replaces its hub record and connects again, no folder picking.
async function pasteInvite(app) {
  const folder = config.workspaceFolder();
  if (!folder) return join(app);
  const conn = await askInvite(app);
  if (!conn) return;
  await config.saveJoin(app.context, folder.uri, conn);
  app.controller.reconnect();
}

async function copyInvite(app) {
  const folder = config.workspaceFolder();
  const conn = folder && config.connectionFor(app.context, folder);
  if (!conn) {
    vscode.window.showWarningMessage(t('connect.unbound'));
    return;
  }
  let host = conn.host;
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
    host = ips[0] || host; // a code pointing at "localhost" would send the teammate to their own machine
  }
  const code = encodeInvite({ ...conn, host });
  await vscode.env.clipboard.writeText(code);
  vscode.window.showInformationMessage(t('invite.copied'));
}

module.exports = { join, pasteInvite, copyInvite };
