'use strict';

const vscode = require('vscode');
const os = require('os');
const joins = require('./connection/joins');
const secrets = require('./connection/secrets');

const folderKey = (uri) => uri.fsPath.toLowerCase();

function workspaceFolder() {
  return (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) || null;
}

// Where this folder's hub is, in the joins record shape plus `source`: the folder's invite record (joins.js), else
// the lanCollab.server and lanCollab.project settings. The token is not part of it, see tokenFor.
function connectionFor(ctx, wsFolder) {
  const joined = joins.get(ctx.globalState, folderKey(wsFolder.uri));
  if (joined) return { source: 'join', ...joined };
  const cfg = vscode.workspace.getConfiguration('lanCollab', wsFolder.uri);
  const server = String(cfg.get('server') || '').trim();
  const project = String(cfg.get('project') || '').trim();
  if (!server || !project) return null;
  const [host, portText] = server.split(':');
  return { source: 'settings', v: 2, instanceId: null, addresses: [host], lastGood: null, port: Number(portText) || 8200, project, tlsFingerprint: null };
}

// lanCollab.token as this folder sees it, and how to remove it from every level that holds it.
function tokenSetting(wsFolder) {
  const cfg = vscode.workspace.getConfiguration('lanCollab', wsFolder && wsFolder.uri);
  const info = cfg.inspect('token') || {};
  const levels = [['globalValue', vscode.ConfigurationTarget.Global], ['workspaceValue', vscode.ConfigurationTarget.Workspace]]
    .filter(([k]) => typeof info[k] === 'string' && info[k] !== '');
  return {
    value: String(cfg.get('token') || ''),
    clear: async () => {
      for (const [, target] of levels) await cfg.update('token', undefined, target);
    },
  };
}

// SecretStorage first. The fallbacks are 0.1 copies that migrateTokens has not moved yet.
async function tokenFor(ctx, wsFolder) {
  const key = folderKey(wsFolder.uri);
  const stored = await secrets.getToken(ctx.secrets, key);
  if (stored !== undefined) return stored;
  const conn = connectionFor(ctx, wsFolder);
  if (conn && conn.source === 'join') return joins.legacyToken(ctx.globalState, key) || '';
  return tokenSetting(wsFolder).value;
}

function migrateTokens(ctx, log) {
  const folder = workspaceFolder();
  return secrets.migrateTokens({
    globalState: ctx.globalState,
    secrets: ctx.secrets,
    workspaceKey: folder ? folderKey(folder.uri) : null,
    setting: tokenSetting(folder),
    log,
  });
}

// inv: a decoded invite, v3 or legacy, as invite.js normalizes it. lastGood is the address the probe reached.
async function saveJoin(ctx, uri, inv, reached) {
  const key = folderKey(uri);
  await secrets.setToken(ctx.secrets, key, inv.token || '');
  await joins.put(ctx.globalState, key, { ...joins.fromInvite(inv), lastGood: reached.host, instanceId: inv.instanceId || reached.instanceId || null });
}

// Writes token or project where this folder's connection comes from.
async function updateConnection(ctx, wsFolder, patch) {
  const key = folderKey(wsFolder.uri);
  const joined = joins.get(ctx.globalState, key);
  if ('token' in patch) {
    await secrets.setToken(ctx.secrets, key, patch.token);
    // A value left in the settings would be moved over the new token on the next activation.
    if (!joined) await tokenSetting(wsFolder).clear();
  }
  if (!('project' in patch)) return;
  if (joined) await joins.update(ctx.globalState, key, { project: patch.project });
  else await vscode.workspace.getConfiguration('lanCollab', wsFolder.uri).update('project', patch.project, vscode.ConfigurationTarget.Workspace);
}

function sameConnection(a, b) {
  if (!a || !b || a.source !== b.source || a.project !== b.project) return false;
  // An invite record moves by itself (rediscovery, lastGood); only a new invite replaces it, and that reconnects.
  return a.source === 'join' || (a.addresses[0] === b.addresses[0] && a.port === b.port);
}

function excludeOf(wsFolder) {
  return JSON.stringify(vscode.workspace.getConfiguration('lanCollab', wsFolder.uri).get('exclude') || []);
}

function displayName(account) {
  const name = String(vscode.workspace.getConfiguration('lanCollab').get('name') || '').trim();
  return name || (account && account.label) || `${os.userInfo().username}@${os.hostname()}`;
}

module.exports = {
  folderKey, workspaceFolder, connectionFor, tokenFor, migrateTokens, saveJoin, updateConnection, sameConnection, excludeOf, displayName,
};
