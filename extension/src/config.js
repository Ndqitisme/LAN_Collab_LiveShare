'use strict';

const vscode = require('vscode');
const os = require('os');

const folderKey = (uri) => uri.fsPath.toLowerCase();

function workspaceFolder() {
  return (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) || null;
}

function joinsOf(ctx) {
  return ctx.globalState.get('lanCollab.joins') || {};
}

// A folder joined with an invite code remembers that hub (per machine); otherwise the lanCollab.* settings apply.
function connectionFor(ctx, wsFolder) {
  const joined = joinsOf(ctx)[folderKey(wsFolder.uri)];
  if (joined) return joined;
  const cfg = vscode.workspace.getConfiguration('lanCollab', wsFolder.uri);
  const server = String(cfg.get('server') || '').trim();
  const project = String(cfg.get('project') || '').trim();
  if (!server || !project) return null;
  const [host, portText] = server.split(':');
  return { host, port: Number(portText) || 8200, project, token: String(cfg.get('token') || '') };
}

async function saveJoin(ctx, uri, conn) {
  await ctx.globalState.update('lanCollab.joins', { ...joinsOf(ctx), [folderKey(uri)]: conn });
}

// Writes token or project where this folder's connection comes from: its invite record, else the settings.
async function updateConnection(ctx, wsFolder, patch) {
  const key = folderKey(wsFolder.uri);
  const joined = joinsOf(ctx)[key];
  if (joined) {
    await saveJoin(ctx, wsFolder.uri, { ...joined, ...patch });
    return;
  }
  const cfg = vscode.workspace.getConfiguration('lanCollab', wsFolder.uri);
  if ('token' in patch) {
    // A token in the workspace settings overrides the user one, so the new token must replace it there.
    const inWorkspace = cfg.inspect('token').workspaceValue !== undefined;
    await cfg.update('token', patch.token, inWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  }
  if ('project' in patch) await cfg.update('project', patch.project, vscode.ConfigurationTarget.Workspace);
}

function sameConnection(a, b) {
  return Boolean(a && b) && a.host === b.host && a.port === b.port && a.project === b.project && (a.token || '') === (b.token || '');
}

function excludeOf(wsFolder) {
  return JSON.stringify(vscode.workspace.getConfiguration('lanCollab', wsFolder.uri).get('exclude') || []);
}

function displayName(account) {
  const name = String(vscode.workspace.getConfiguration('lanCollab').get('name') || '').trim();
  return name || (account && account.label) || `${os.userInfo().username}@${os.hostname()}`;
}

module.exports = { folderKey, workspaceFolder, connectionFor, saveJoin, updateConnection, sameConnection, excludeOf, displayName };
