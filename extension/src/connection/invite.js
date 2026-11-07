'use strict';

const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const { t } = require('../../../lib/i18n');
const { ACTIVE } = require('../../../lib/connection-machine');
const { encodeInvite, decodeInvite, encodeInviteV3, decodeInviteV3 } = require('../../../lib/common');
const config = require('../config');
const { probe } = require('./probe');

function isEmptyDir(p) {
  try {
    return fs.readdirSync(p).every((n) => n === '.vscode' || n === '.lan-collab');
  } catch {
    return false;
  }
}

// Either code form as {instanceId, hosts, port, project, token, fingerprint?}; a legacy LC- code has one host and
// no instanceId.
function decodeAny(code) {
  const v3 = decodeInviteV3(code);
  if (v3) return v3;
  const v2 = decodeInvite(code);
  return v2 && { instanceId: null, hosts: [v2.host], port: v2.port, project: v2.project, token: v2.token };
}

// The input box message for a pasted code, or null when it decodes or nothing is typed yet.
function inviteProblem(value) {
  const code = String(value || '').replace(/\s+/g, '');
  if (!code || decodeAny(code)) return null;
  return /^LC3?-/.test(code) ? t('join.input.unreadable') : t('join.input.badPrefix');
}

// {inv, reached}: a decoded invite the hub accepts and the address that answered, or null after telling the
// member why not.
async function askInvite(app, codeArg) {
  const code = typeof codeArg === 'string' ? codeArg : await vscode.window.showInputBox({
    prompt: t('join.input.prompt'),
    placeHolder: t('join.input.placeholder'),
    ignoreFocusOut: true,
    validateInput: inviteProblem,
  });
  if (!code) return null;
  const inv = decodeAny(code);
  if (!inv) return null;
  const title = t('join.progress.probe', { host: inv.hosts[0], port: inv.port });
  const reached = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => probe(inv, app.log));
  if (reached.error) {
    vscode.window.showErrorMessage(reached.error);
    return null;
  }
  return { inv, reached };
}

async function join(app, codeArg) {
  const s = app.controller.state;
  if (ACTIVE.has(s.name)) {
    vscode.window.showWarningMessage(s.target ? t('join.error.connected', { project: s.target.project }) : t('connect.busy'));
    return;
  }
  const asked = await askInvite(app, codeArg);
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
    target = { uri: picked[0] };
    if (!isEmptyDir(target.uri.fsPath)) {
      const go = await vscode.window.showWarningMessage(
        t('join.folder.notEmpty', { path: target.uri.fsPath }),
        { modal: true }, t('sync.button.sync'));
      if (!go) return;
    }
  }
  await config.saveJoin(app.context, target.uri, inv, reached);

  const current = config.workspaceFolder();
  if (current && config.folderKey(current.uri) === config.folderKey(target.uri)) app.controller.connect();
  else vscode.commands.executeCommand('vscode.openFolder', target.uri); // the window reloads and connects on start
}

// A new invite for the folder already open: replaces its hub record and connects again, no folder picking.
async function pasteInvite(app) {
  const folder = config.workspaceFolder();
  if (!folder) return join(app);
  const asked = await askInvite(app);
  if (!asked) return;
  await config.saveJoin(app.context, folder.uri, asked.inv, asked.reached);
  app.controller.reconnect();
}

async function copyInvite(app) {
  const folder = config.workspaceFolder();
  const conn = folder && config.connectionFor(app.context, folder);
  if (!conn) {
    vscode.window.showWarningMessage(t('connect.unbound'));
    return;
  }
  const token = await config.tokenFor(app.context, folder);
  // A code pointing at "localhost" would send the teammate to their own machine.
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  const known = [...new Set([conn.lastGood, ...conn.addresses].filter(Boolean))];
  const hosts = [...new Set(known.flatMap((h) => (['127.0.0.1', 'localhost', '::1'].includes(h) && ips.length ? ips : [h])))];
  const { port, project, instanceId, tlsFingerprint } = conn;
  const code = instanceId
    ? encodeInviteV3({ instanceId, hosts, port, project, token, fingerprint: tlsFingerprint || undefined })
    : encodeInvite({ host: hosts[0], port, project, token });
  await vscode.env.clipboard.writeText(code);
  vscode.window.showInformationMessage(t('invite.copied'));
}

module.exports = { join, pasteInvite, copyInvite };
