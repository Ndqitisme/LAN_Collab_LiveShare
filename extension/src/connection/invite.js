'use strict';

const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const { t } = require('../../../lib/i18n');
const { ACTIVE } = require('../../../lib/connection-machine');
const { encodeInviteV3, decodeInviteV3 } = require('../../../lib/common');
const config = require('../config');
const { probe } = require('./probe');

function isEmptyDir(p) {
  try {
    return fs.readdirSync(p).every((n) => n === '.vscode' || n === '.lan-collab');
  } catch {
    return false;
  }
}

// The input box message for a pasted code, or null when it decodes or nothing is typed yet. An LC- code comes from
// a 0.1 hub, which speaks protocol 1 only.
function inviteProblem(value) {
  const code = String(value || '').replace(/\s+/g, '');
  if (!code || decodeInviteV3(code)) return null;
  if (code.startsWith('LC-')) return t('invite.legacy');
  return code.startsWith('LC3-') ? t('join.input.unreadable') : t('join.input.badPrefix');
}

// {inv, reached}: a decoded invite the hub accepts and the address that answered, or null after telling the
// member why not. The refusal toast does not hold the command: its buttons start `again(code)` with the same code
// or with none, so a new one is asked for.
async function askInvite(app, codeArg, again) {
  const code = typeof codeArg === 'string' ? codeArg : await vscode.window.showInputBox({
    prompt: t('join.input.prompt'),
    placeHolder: t('join.input.placeholder'),
    ignoreFocusOut: true,
    validateInput: inviteProblem,
  });
  if (!code) return null;
  const inv = decodeInviteV3(code);
  if (!inv) {
    vscode.window.showErrorMessage(inviteProblem(code) || t('join.input.badPrefix'));
    return null;
  }
  const title = t('join.progress.probe', { host: inv.hosts[0], port: inv.port });
  const reached = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => probe(inv, app.log));
  if (reached.error) {
    const retry = t('action.retry');
    const paste = t('action.paste_invite');
    vscode.window.showErrorMessage(reached.error, retry, paste).then((pick) => {
      if (pick === retry) again(code);
      else if (pick === paste) again();
    });
    return null;
  }
  return { inv, reached };
}

async function join(app, codeArg) {
  const s = app.controller.state;
  if (ACTIVE.has(s.name)) {
    const disconnect = t('menu.disconnect');
    vscode.window.showWarningMessage(s.target ? t('join.error.connected', { project: s.target.project }) : t('connect.busy'), disconnect).then((pick) => {
      if (pick) app.controller.disconnect();
    });
    return;
  }
  const asked = await askInvite(app, codeArg, (code) => join(app, code));
  if (!asked) return;
  const { inv, reached } = asked;

  let target = config.workspaceFolder();
  if (!(target && target.uri.scheme === 'file' && isEmptyDir(target.uri.fsPath))) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: t('join.folder.openLabel'),
      title: t('join.folder.title', { project: inv.project }),
    });
    if (!picked) return;
    // A folder with files gets the sync panel on its first sync: every file to replace or upload is listed there
    // with a choice before anything is written.
    target = { uri: picked[0] };
  }
  await config.saveJoin(app.context, target.uri, inv, reached);

  const current = config.workspaceFolder();
  if (current && config.folderKey(current.uri) === config.folderKey(target.uri)) app.controller.connect();
  else vscode.commands.executeCommand('vscode.openFolder', target.uri); // the window reloads and connects on start
}

// A new invite for the folder already open: replaces its hub record and connects again, no folder picking.
async function pasteInvite(app, codeArg) {
  const folder = config.workspaceFolder();
  if (!folder) return join(app, codeArg);
  const asked = await askInvite(app, codeArg, (code) => pasteInvite(app, code));
  if (!asked) return;
  await config.saveJoin(app.context, folder.uri, asked.inv, asked.reached);
  app.controller.reconnect();
}

async function copyInvite(app) {
  const folder = config.workspaceFolder();
  const conn = folder && config.connectionFor(app.context, folder);
  if (!conn) {
    const joinLabel = t('action.join');
    const setup = t('action.open_settings');
    vscode.window.showWarningMessage(t('connect.unbound'), joinLabel, setup).then((pick) => {
      if (pick === joinLabel) join(app);
      else if (pick) vscode.commands.executeCommand('lanCollab.openConnection');
    });
    return;
  }
  const token = await config.tokenFor(app.context, folder);
  // A code pointing at "localhost" would send the teammate to their own machine.
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  const known = [...new Set([conn.lastGood, ...conn.addresses].filter(Boolean))];
  const hosts = [...new Set(known.flatMap((h) => (['127.0.0.1', 'localhost', '::1'].includes(h) && ips.length ? ips : [h])))];
  const { port, project, instanceId, tlsFingerprint } = conn;
  // The instanceId comes with the first welcome, so a folder set up by hand has none until it connects once.
  if (!instanceId) {
    const connect = t('menu.connect');
    vscode.window.showWarningMessage(t('invite.noInstance'), connect).then((pick) => {
      if (pick) app.controller.connect();
    });
    return;
  }
  const code = encodeInviteV3({ instanceId, hosts, port, project, token, fingerprint: tlsFingerprint || undefined });
  await vscode.env.clipboard.writeText(code);
  vscode.window.showInformationMessage(t('invite.copied'));
}

module.exports = { join, pasteInvite, copyInvite, inviteProblem };
