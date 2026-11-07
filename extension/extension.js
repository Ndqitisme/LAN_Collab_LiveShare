'use strict';

const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { CollabClient, hubErrorText } = require('../lib/client-core');
const { t } = require('../lib/i18n');
const { EditorBinding } = require('../lib/editor-binding');
const { ChatView } = require('./src/views/chat');
const { LineSocket, PROTO_V2, encodeInvite, decodeInvite } = require('../lib/common');

let ctx;
let out;
let statusItem;
let tree;
let core = null;
let folder = null;
let watcher = null;
let following = null;
let presenceTimer = null;
let decoTimer = null;
let lastState = 'off';
let connecting = false;
let reachedHub = false;
let chatView;
let unread = 0;
let lastEditor = null;
const bindings = new Map(); // document uri -> EditorBinding
const decorations = new Map(); // user id -> decoration types

function activate(context) {
  ctx = context;
  out = vscode.window.createOutputChannel('LAN Collab');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = 'lanCollab.menu';
  tree = new PeopleTree();
  chatView = new ChatView({
    core: () => core,
    extensionUri: context.extensionUri,
    sendLocation,
    openRef,
    onUnread: (n) => {
      unread = n;
      updateStatus();
    },
  });

  const cmd = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  cmd('lanCollab.connect', connect);
  cmd('lanCollab.disconnect', disconnect);
  cmd('lanCollab.menu', menu);
  cmd('lanCollab.follow', pickFollow);
  cmd('lanCollab.unfollow', () => setFollowing(null));
  cmd('lanCollab.setStatus', setStatus);
  cmd('lanCollab.showLog', () => out.show());
  cmd('lanCollab.goTo', (id) => goTo(id));
  cmd('lanCollab.openChat', () => vscode.commands.executeCommand('lanCollab.chat.focus'));
  cmd('lanCollab.signIn', signIn);
  cmd('lanCollab.join', join);
  cmd('lanCollab.copyInvite', copyInvite);

  context.subscriptions.push(
    out,
    statusItem,
    vscode.window.createTreeView('lanCollab.people', { treeDataProvider: tree }),
    vscode.window.registerWebviewViewProvider('lanCollab.chat', chatView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.onDidOpenTextDocument(bindDoc),
    vscode.workspace.onDidCloseTextDocument(unbindDoc),
    vscode.workspace.onDidChangeTextDocument(onDocChange),
    vscode.workspace.onWillSaveTextDocument((e) => bindingOf(e.document)?.onWillSave()),
    vscode.workspace.onDidSaveTextDocument((doc) => bindingOf(doc)?.onSaved()),
    vscode.window.onDidChangeTextEditorSelection(schedulePresence),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) lastEditor = ed;
      schedulePresence();
      scheduleDecorations();
    }),
    vscode.window.onDidChangeVisibleTextEditors(scheduleDecorations),
    vscode.debug.onDidStartDebugSession(schedulePresence),
    vscode.debug.onDidTerminateDebugSession(schedulePresence),
    vscode.debug.onDidChangeActiveDebugSession(schedulePresence),
  );

  updateStatus('off');
  const first = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (vscode.workspace.getConfiguration('lanCollab').get('autoConnect') && first && connectionFor(first)) connect();
  return { core: () => core };
}

// ------------------------------------------------------------------ invite codes

const folderKey = (uri) => uri.fsPath.toLowerCase();

// A folder joined with an invite code remembers that hub (per machine); otherwise the lanCollab.* settings apply.
function connectionFor(wsFolder) {
  const joined = (ctx.globalState.get('lanCollab.joins') || {})[folderKey(wsFolder.uri)];
  if (joined) return joined;
  const cfg = vscode.workspace.getConfiguration('lanCollab', wsFolder.uri);
  const server = String(cfg.get('server') || '').trim();
  const project = String(cfg.get('project') || '').trim();
  if (!server || !project) return null;
  const [host, portText] = server.split(':');
  return { host, port: Number(portText) || 8200, project, token: String(cfg.get('token') || '') };
}

// Checks a code against the hub before touching any folder: answers null if it may join, else the reason.
function probe(conn) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: conn.host, port: conn.port });
    const ls = new LineSocket(sock);
    ls.on('close', () => done(t('connect.error.closed', { host: conn.host, port: conn.port })));
    let finished = false;
    const done = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ls.close();
      resolve(err);
    };
    const timer = setTimeout(() => {
      log(`Kiểm tra ${conn.host}:${conn.port}: không phản hồi sau 6 giây.`);
      done(t('connect.error.timeout', { host: conn.host, port: conn.port, seconds: 6 }));
    }, 6000);
    sock.on('connect', () => ls.send({ t: 'hello', probe: true, proto: PROTO_V2, token: conn.token, project: conn.project }));
    const mine = { host: conn.host, port: conn.port, project: conn.project, proto: PROTO_V2 };
    ls.on('message', (m) => {
      if (m && m.t === 'probe_result') {
        // account rules are checked again with the real account
        const code = !m.proto_ok ? 'protocol_version' : !m.project_ok ? 'project_unknown' : !m.token_ok ? 'token_invalid' : null;
        if (code) log(`Kiểm tra ${conn.host}:${conn.port}: LAN Hub từ chối (${code}).`);
        done(code && hubErrorText(code, { ...m, ...mine }));
      } else if (m && m.t === 'error') {
        log(`Kiểm tra ${conn.host}:${conn.port}: LAN Hub từ chối: ${typeof m.message === 'string' ? m.message : m.code}`);
        done(typeof m.message === 'string' ? m.message : hubErrorText(m.code, { ...m.data, ...mine }));
      }
    });
    ls.on('error', (e) => {
      log(`Kiểm tra ${conn.host}:${conn.port}: ${e.message}`);
      done(e.code === 'ECONNREFUSED' ? t('connect.error.refused', { host: conn.host, port: conn.port }) : t('connect.error.failed', { host: conn.host, port: conn.port }));
    });
  });
}

function isEmptyDir(p) {
  try {
    return fs.readdirSync(p).every((n) => n === '.vscode' || n === '.lan-collab');
  } catch {
    return false;
  }
}

async function join(codeArg) {
  if (core) {
    vscode.window.showWarningMessage(t('join.error.connected', { project: core.project }));
    return;
  }
  const code = typeof codeArg === 'string' ? codeArg : await vscode.window.showInputBox({
    prompt: t('join.input.prompt'),
    placeHolder: t('join.input.placeholder'),
    ignoreFocusOut: true,
    validateInput: inviteProblem,
  });
  if (!code) return;
  const conn = decodeInvite(code);
  if (!conn) return;
  const err = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('join.progress.probe', { host: conn.host, port: conn.port }) }, () => probe(conn));
  if (err) {
    vscode.window.showErrorMessage(err);
    return;
  }

  let target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!(target && target.uri.scheme === 'file' && isEmptyDir(target.uri.fsPath))) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: t('join.folder.openLabel'),
      title: t('join.folder.title', { project: conn.project }),
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
  const joins = { ...(ctx.globalState.get('lanCollab.joins') || {}) };
  joins[folderKey(target.uri)] = conn;
  await ctx.globalState.update('lanCollab.joins', joins);

  const current = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (current && folderKey(current.uri) === folderKey(target.uri)) connect();
  else vscode.commands.executeCommand('vscode.openFolder', target.uri); // the window reloads and connects on start
}

// The input box message for a pasted code, or null when it decodes or nothing is typed yet.
function inviteProblem(value) {
  const code = String(value || '').replace(/\s+/g, '');
  if (!code || decodeInvite(code)) return null;
  return /^LC3?-/.test(code) ? t('join.input.unreadable') : t('join.input.badPrefix');
}

async function copyInvite() {
  const conn = folder && connectionFor(folder);
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

// After joining, files keep arriving for a moment: show it, so nobody starts editing a half-downloaded tree.
function showDownloadProgress() {
  const c = core;
  if (!c || c.loading.size < 3) return;
  const total = c.loading.size;
  let skipped = 0;
  const onIgnored = () => {
    skipped += 1;
  };
  c.on('ignored', onIgnored);
  vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('sync.progress.title', { project: c.project }), cancellable: true }, (progress, cancel) => new Promise((resolve) => {
    let shown = 0;
    let timer = null;
    const finish = (message) => {
      clearInterval(timer);
      c.off('ignored', onIgnored);
      if (message) vscode.window.showInformationMessage(message);
      resolve();
    };
    // Closing the notification only hides it; synchronization continues in the background.
    cancel.onCancellationRequested(() => finish(null));
    timer = setInterval(() => {
      const done = total - c.loading.size;
      progress.report({ message: t('sync.progress.count', { done, total }), increment: ((done - shown) / total) * 100 });
      shown = done;
      if (core !== c) finish(null);
      else if (c.loading.size === 0) {
        finish(skipped
          ? t('sync.doneSkipped', { synced: total - skipped, total, skipped })
          : t('sync.done', { total }));
      }
    }, 200);
  }));
}

function deactivate() {
  disconnect();
}

function log(line) {
  out.appendLine(`[${new Date().toLocaleTimeString('vi-VN')}] ${line}`);
  if (process.env.LAN_COLLAB_DEBUG) console.log(`[lan-collab] ${line}`);
}

// ------------------------------------------------------------------ connection

async function connect() {
  if (core || connecting) {
    vscode.window.showInformationMessage(core ? t('connect.already', { project: core.project }) : t('connect.busy'));
    return;
  }
  connecting = true;
  try {
    await startClient();
  } finally {
    connecting = false;
  }
}

async function startClient() {
  const cfg = vscode.workspace.getConfiguration('lanCollab');
  folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder || folder.uri.scheme !== 'file') {
    const pick = await vscode.window.showWarningMessage(t('connect.noFolder'), t('connect.button.join'));
    if (pick) join();
    return;
  }
  const conn = connectionFor(folder);
  if (!conn) {
    const pick = await vscode.window.showWarningMessage(t('connect.unbound'), t('connect.button.join'), t('connect.button.settings'));
    if (pick === t('connect.button.join')) join();
    else if (pick) vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'lanCollab');
    return;
  }
  const { host, port, project, token } = conn;
  const account = await getAccount(false);
  const name = String(cfg.get('name') || '').trim() || (account && account.label) || `${os.userInfo().username}@${os.hostname()}`;

  reachedHub = false;
  core = new CollabClient({
    root: folder.uri.fsPath,
    host,
    port,
    token,
    project,
    name,
    account,
    uid: crypto.randomUUID(),
    device: vscode.env.machineId,
    exclude: cfg.get('exclude'),
    autoSave: cfg.get('autoSave'),
    state: {
      get: (k) => ctx.workspaceState.get(`lanCollab.${k}`),
      set: (k, v) => ctx.workspaceState.update(`lanCollab.${k}`, v),
    },
    confirmSync,
    log,
  });
  core.on('status', updateStatus);
  core.on('fatal', async (msg, code) => {
    disconnect();
    const button = { account_required: t('error.button.signIn'), account_denied: t('error.button.switchAccount') }[code];
    const pick = await vscode.window.showErrorMessage(msg, ...(button ? [button] : []));
    if (pick) signIn();
  });
  core.on('chat', (msg) => chatView.onMessage(msg));
  core.on('chat-rejected', (reason) => chatView.onRejected(reason));
  core.on('ready', () => {
    reachedHub = true;
    chatView.refresh();
    showDownloadProgress();
    for (const doc of vscode.workspace.textDocuments) bindDoc(doc);
    schedulePresence();
    scheduleDecorations();
    tree.refresh();
  });
  core.on('entry', (rel) => {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && core.relOf(d.uri.fsPath) === rel);
    if (doc) bindDoc(doc);
  });
  core.on('unbind', (rel) => {
    for (const [key, b] of bindings) {
      if (b.e.rel !== rel) continue;
      b.dispose();
      b.e.binding = null;
      bindings.delete(key);
    }
  });
  core.on('users', () => {
    for (const id of [...decorations.keys()]) if (!core.users.has(id)) disposeDecoration(id);
    if (following && !core.users.has(following)) setFollowing(null);
    tree.refresh();
    updateStatus();
    scheduleDecorations();
    chatView.updatePeople();
  });
  core.on('presence', (id) => {
    tree.refresh();
    scheduleDecorations();
    if (id === following) followNow();
  });
  core.on('activity', (a) => {
    log(`${a.who} ${a.text}`);
    tree.refresh();
  });
  core.on('backup', (dir) => {
    vscode.window.showWarningMessage(t('sync.backup', { dir }));
  });

  watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
  const onDisk = (uri) => core && core.onDiskEvent(uri.fsPath);
  watcher.onDidChange(onDisk);
  watcher.onDidCreate(onDisk);
  watcher.onDidDelete(onDisk);

  log(`Kết nối ${host}:${port} (dự án "${project}", tên "${name}"${account ? `, tài khoản ${account.provider}:${account.label}` : ''})`);
  core.connect();
}

function disconnect() {
  if (!core) return;
  for (const b of bindings.values()) {
    b.dispose();
    b.e.binding = null;
  }
  bindings.clear();
  for (const id of [...decorations.keys()]) disposeDecoration(id);
  if (watcher) watcher.dispose();
  watcher = null;
  core.disconnect();
  core.removeAllListeners();
  core = null;
  following = null;
  updateStatus('off');
  tree.refresh();
  chatView.refresh();
  log('Đã ngắt kết nối.');
}

// Returns false (cancel), true (go ahead; conflicting files take the hub's version) or 'local'.
async function confirmSync(info) {
  const lines = [
    t('sync.confirm.title', { folder: folder.name, project: info.project }),
    '',
    t('sync.confirm.get', { get: info.get, overwrite: info.overwrite }),
    t('sync.confirm.upload', { upload: info.upload }),
    t('sync.confirm.remove', { removeLocal: info.removeLocal }),
  ];
  if (info.conflicts.length) {
    const names = info.conflicts.slice(0, 8).join(', ') + (info.conflicts.length > 8 ? ', …' : '');
    lines.push('', t('sync.confirm.conflicts', { count: info.conflicts.length, names }), t('sync.confirm.conflictsHint'));
  }
  lines.push('', t('sync.confirm.backup'));
  const keepLocal = t('sync.button.keepLocal');
  const buttons = info.conflicts.length ? [t('sync.button.useHub'), keepLocal] : [t('sync.button.sync')];
  const pick = await vscode.window.showWarningMessage(lines.join('\n'), { modal: true }, ...buttons);
  if (pick === keepLocal) return 'local';
  return Boolean(pick);
}

// ------------------------------------------------------------------ editors

function bindingOf(doc) {
  return bindings.get(doc.uri.toString());
}

function bindDoc(doc) {
  if (!core || !core.ready || doc.uri.scheme !== 'file') return;
  const key = doc.uri.toString();
  if (bindings.has(key)) return;
  const rel = core.relOf(doc.uri.fsPath);
  const e = rel && core.entries.get(rel);
  if (!e || e.kind !== 'text' || e.loading) return;
  if (e.binding) return;
  if (doc.isDirty && doc.getText() !== e.text.replace(/^﻿/, '')) core.backupText(rel, doc.getText());
  const b = new EditorBinding(e, adapterFor(doc), core);
  b.onApplied((op) => shiftRemoteCursors(rel, b, op));
  bindings.set(key, b);
  core.attach(e, b);
}

function unbindDoc(doc) {
  const key = doc.uri.toString();
  const b = bindings.get(key);
  if (!b) return;
  bindings.delete(key);
  if (core) core.detach(b.e);
  else b.dispose();
}

function onDocChange(ev) {
  const b = bindingOf(ev.document);
  if (!b || ev.contentChanges.length === 0) return;
  const changes = ev.contentChanges.map((c) => ({ rangeOffset: c.rangeOffset, rangeLength: c.rangeLength, text: c.text }));
  b.onDocChange(changes, ev.document.getText());
  schedulePresence();
}

function adapterFor(doc) {
  return {
    getText: () => doc.getText(),
    isDirty: () => doc.isDirty,
    eol: () => (doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'),
    applyEdits(edits) {
      if (doc.isClosed) return Promise.resolve(false);
      const we = new vscode.WorkspaceEdit();
      for (const ed of edits) we.replace(doc.uri, new vscode.Range(doc.positionAt(ed.start), doc.positionAt(ed.end)), ed.text);
      return vscode.workspace.applyEdit(we);
    },
    save: () => (doc.isClosed ? Promise.resolve(false) : doc.save()),
  };
}

// ------------------------------------------------------------------ presence

function schedulePresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    sendPresence();
  }, 80);
}

function sendPresence() {
  if (!core || !core.ready) return;
  const p = { file: null, sel: [], line: 0, debug: null };
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.uri.scheme === 'file') {
    const rel = core.relOf(ed.document.uri.fsPath);
    if (rel && core.entries.has(rel)) {
      const b = bindingOf(ed.document);
      const off = b ? b.bom.length : 0;
      p.file = rel;
      p.sel = ed.selections.map((s) => [ed.document.offsetAt(s.anchor) + off, ed.document.offsetAt(s.active) + off]);
      p.line = ed.selection.active.line + 1;
    }
  }
  const ds = vscode.debug.activeDebugSession;
  if (ds) {
    const program = ds.configuration && ds.configuration.program;
    const rel = typeof program === 'string' && path.isAbsolute(program) ? core.relOf(program) : null;
    p.debug = rel || ds.name;
  }
  core.sendPresence(p);
  tree.refresh();
}

function shiftRemoteCursors(rel, b, op) {
  if (!core) return;
  const off = b.bom.length;
  for (const u of core.users.values()) {
    const p = u.presence;
    if (!p || p.file !== rel) continue;
    p.sel = p.sel.map(([a, c]) => [op.transformIndex(Math.max(0, a - off)) + off, op.transformIndex(Math.max(0, c - off)) + off]);
  }
  scheduleDecorations();
}

function decorationFor(u) {
  let d = decorations.get(u.id);
  if (d) return d;
  const c = u.color;
  d = {
    sel: vscode.window.createTextEditorDecorationType({ backgroundColor: `${c}33`, borderRadius: '2px' }),
    caretBefore: vscode.window.createTextEditorDecorationType({ borderStyle: 'solid', borderColor: c, borderWidth: '0 0 0 2px' }),
    caretAfter: vscode.window.createTextEditorDecorationType({ borderStyle: 'solid', borderColor: c, borderWidth: '0 2px 0 0' }),
    label: vscode.window.createTextEditorDecorationType({
      after: { contentText: `  ◀ ${u.name}`, color: c, fontStyle: 'italic', margin: '0 0 0 1em' },
    }),
  };
  decorations.set(u.id, d);
  return d;
}

function disposeDecoration(id) {
  const d = decorations.get(id);
  if (!d) return;
  for (const t of Object.values(d)) t.dispose();
  decorations.delete(id);
}

function scheduleDecorations() {
  if (decoTimer) return;
  decoTimer = setTimeout(() => {
    decoTimer = null;
    renderDecorations();
  }, 30);
}

function renderDecorations() {
  if (!core) return;
  for (const ed of vscode.window.visibleTextEditors) {
    const rel = ed.document.uri.scheme === 'file' ? core.relOf(ed.document.uri.fsPath) : null;
    const b = bindingOf(ed.document);
    const off = b ? b.bom.length : 0;
    const len = ed.document.getText().length;
    for (const u of core.users.values()) {
      const d = decorationFor(u);
      const p = u.presence;
      const sels = [];
      const before = [];
      const after = [];
      const labels = [];
      if (rel && p && p.file === rel) {
        p.sel.forEach(([a, c], i) => {
          const pa = ed.document.positionAt(Math.min(len, Math.max(0, a - off)));
          const pc = ed.document.positionAt(Math.min(len, Math.max(0, c - off)));
          if (!pa.isEqual(pc)) sels.push(new vscode.Range(pa, pc));
          const lineEnd = ed.document.lineAt(pc.line).range.end;
          if (pc.isBefore(lineEnd)) before.push(new vscode.Range(pc, pc.translate(0, 1)));
          else if (pc.character > 0) after.push(new vscode.Range(pc.translate(0, -1), pc));
          if (i === 0) labels.push(new vscode.Range(lineEnd, lineEnd));
        });
      }
      ed.setDecorations(d.sel, sels);
      ed.setDecorations(d.caretBefore, before);
      ed.setDecorations(d.caretAfter, after);
      ed.setDecorations(d.label, labels);
    }
  }
}

// ------------------------------------------------------------------ follow / status / menu

function setFollowing(id) {
  following = id;
  updateStatus();
  if (id) followNow();
}

async function followNow() {
  const u = core && core.users.get(following);
  if (u) await reveal(u, true);
}

async function goTo(id) {
  const u = core && core.users.get(id);
  if (!u) return;
  if (!u.presence || !u.presence.file) {
    vscode.window.showInformationMessage(t('follow.noFile', { name: u.name }));
    return;
  }
  await reveal(u, false);
}

async function reveal(u, preserveFocus) {
  const p = u.presence;
  if (!p || !p.file || !folder) return;
  const uri = vscode.Uri.file(path.join(folder.uri.fsPath, p.file));
  const active = vscode.window.activeTextEditor;
  const ed = active && active.document.uri.toString() === uri.toString()
    ? active
    : await vscode.window.showTextDocument(uri, { preview: true, preserveFocus });
  const b = bindingOf(ed.document);
  const off = b ? b.bom.length : 0;
  const caret = p.sel[0] ? p.sel[0][1] : 0;
  const pos = ed.document.positionAt(Math.max(0, caret - off));
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function pickFollow() {
  if (!core || !core.ready) {
    vscode.window.showWarningMessage(t('connect.notConnected'));
    return;
  }
  const items = [...core.users.values()].map((u) => ({ label: u.name, description: describe(u.presence, u.status), id: u.id }));
  if (!items.length) {
    vscode.window.showInformationMessage(t('follow.nobody'));
    return;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('follow.placeholder') });
  if (pick) setFollowing(pick.id);
}

async function setStatus() {
  if (!core) {
    vscode.window.showWarningMessage(t('connect.notConnected'));
    return;
  }
  const text = await vscode.window.showInputBox({ prompt: t('status.input.prompt'), value: core.status });
  if (text !== undefined) core.setStatus(text.trim());
}

// ------------------------------------------------------------------ account / chat

// The GitHub or Microsoft account already signed in to VS Code (as Live Share shows). Only the account name is
// used — authentication.getAccounts lists signed-in accounts without asking for a token, whereas getSession only
// finds a session whose scopes match exactly and otherwise starts a new browser sign-in.
const PROVIDERS = [
  { id: 'github', label: '$(github) GitHub', scopes: ['read:user'] },
  { id: 'microsoft', label: '$(account) Microsoft', scopes: ['openid', 'profile', 'email', 'offline_access'] },
];

async function signedInAccounts() {
  const out = [];
  for (const p of PROVIDERS) {
    try {
      for (const a of await vscode.authentication.getAccounts(p.id)) out.push({ provider: p.id, label: a.label });
    } catch {
      // provider not installed / not available
    }
  }
  return out;
}

async function getAccount(interactive) {
  const chosen = ctx.globalState.get('lanCollab.account');
  const accounts = await signedInAccounts();
  const same = (a) => chosen && a.provider === chosen.provider && a.label === chosen.label;
  if (!interactive) return accounts.find(same) || accounts[0] || null;

  const items = accounts.map((a) => ({
    label: `${a.provider === 'github' ? '$(github)' : '$(account)'} ${a.label}`,
    description: same(a) ? t('account.pick.current', { provider: a.provider }) : a.provider,
    account: a,
  }));
  for (const p of PROVIDERS) items.push({ label: `$(sign-in) ${t('account.pick.signIn', { provider: providerName(p.id) })}`, provider: p });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('account.pick.placeholder') });
  if (!pick) return null;
  let account = pick.account;
  if (!account) {
    try {
      const s = await vscode.authentication.getSession(pick.provider.id, pick.provider.scopes, { createIfNone: true, clearSessionPreference: true });
      account = { provider: pick.provider.id, label: s.account.label };
    } catch (e) {
      log(`Đăng nhập ${pick.provider.id} lỗi: ${e.message}`);
      vscode.window.showErrorMessage(t('account.signInFailed', { provider: providerName(pick.provider.id) }));
      return null;
    }
  }
  await ctx.globalState.update('lanCollab.account', account);
  return account;
}

function providerName(id) {
  return id === 'github' ? 'GitHub' : 'Microsoft';
}

async function signIn() {
  const account = await getAccount(true);
  if (!account) return;
  vscode.window.showInformationMessage(t('account.chosen', { account: `${account.provider}:${account.label}` }));
  disconnect();
  connect();
}

function sendLocation() {
  const ed = vscode.window.activeTextEditor || lastEditor;
  if (!core || !ed || ed.document.isClosed || ed.document.uri.scheme !== 'file') return null;
  const rel = core.relOf(ed.document.uri.fsPath);
  return rel ? `${rel}:${ed.selection.active.line + 1}` : null;
}

async function openRef(ref, line) {
  const rel = core && core.relOf(path.join(folder.uri.fsPath, ref.replace(/\\/g, '/')));
  if (!rel || !core.entries.has(rel)) {
    vscode.window.showWarningMessage(t('ref.missing', { path: ref }));
    return;
  }
  const ed = await vscode.window.showTextDocument(vscode.Uri.file(path.join(folder.uri.fsPath, rel)), { preview: true });
  const pos = new vscode.Position(Math.max(0, Math.min(line - 1, ed.document.lineCount - 1)), 0);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

async function menu() {
  const items = [];
  if (!core) {
    items.push({ label: `$(plug) ${t('menu.connect')}`, run: connect });
    items.push({ label: `$(key) ${t('menu.join')}`, run: () => join() });
  } else {
    items.push({ label: `$(link) ${t('menu.copyInvite')}`, run: copyInvite });
    items.push({ label: `$(comment-discussion) ${unread ? t('menu.openChatUnread', { count: unread }) : t('menu.openChat')}`, run: () => vscode.commands.executeCommand('lanCollab.openChat') });
    items.push({ label: `$(eye) ${t('menu.follow')}`, run: pickFollow });
    if (following) items.push({ label: `$(eye-closed) ${t('menu.unfollow')}`, run: () => setFollowing(null) });
    items.push({ label: `$(comment) ${t('menu.setStatus')}`, run: setStatus });
    items.push({ label: `$(debug-disconnect) ${t('menu.disconnect')}`, run: disconnect });
  }
  items.push({ label: `$(account) ${t('menu.signIn')}`, run: signIn });
  items.push({ label: `$(output) ${t('menu.showLog')}`, run: () => out.show() });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('menu.placeholder') });
  if (pick) pick.run();
}

function updateStatus(state) {
  if (state) lastState = state;
  statusItem.text = '$(debug-disconnect) LAN Collab';
  statusItem.tooltip = t('statusBar.off.tooltip');
  if (core && lastState === 'connecting') {
    statusItem.text = '$(sync~spin) LAN Collab';
    statusItem.tooltip = t('statusBar.connecting.tooltip', { host: core.host, port: core.port });
  } else if (core && lastState === 'offline' && !reachedHub) {
    statusItem.text = `$(warning) ${t('statusBar.unreachable.text')}`;
    statusItem.tooltip = t('statusBar.unreachable.tooltip', { host: core.host, port: core.port });
  } else if (core && lastState === 'offline') {
    statusItem.text = `$(warning) ${t('statusBar.offline.text')}`;
    statusItem.tooltip = t('statusBar.offline.tooltip');
  } else if (core && lastState === 'online') {
    const followed = following && core.users.get(following);
    statusItem.text = [
      `$(broadcast) ${t('statusBar.online.text', { count: core.users.size + 1 })}`,
      ...(followed ? [t('statusBar.online.following', { name: followed.name })] : []),
      ...(unread ? [`$(comment-discussion) ${unread}`] : []),
    ].join(' · ');
    statusItem.tooltip = unread ? t('statusBar.online.unreadTooltip', { count: unread }) : t('statusBar.online.tooltip', { project: core.project });
  }
  statusItem.show();
}

function describe(p, status) {
  const parts = [];
  if (p && p.file) parts.push(`${p.file}:${p.line}`);
  if (p && p.debug) parts.push(t('tree.debugging', { target: p.debug }));
  if (status) parts.push(`“${status}”`);
  return parts.join(' · ');
}

class PeopleTree {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.timer = null;
  }

  refresh() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.emitter.fire();
    }, 150);
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(parent) {
    if (!core) {
      const item = new vscode.TreeItem(t('tree.disconnected'));
      item.iconPath = new vscode.ThemeIcon('plug');
      item.command = { command: 'lanCollab.connect', title: t('command.lanCollab.connect.title') };
      return [item];
    }
    if (parent && parent.contextValue === 'activity') {
      return core.activity.slice(-50).reverse().map((a) => {
        const item = new vscode.TreeItem(`${a.who} ${a.text}`);
        item.description = new Date(a.ts).toLocaleTimeString('vi-VN');
        return item;
      });
    }
    if (parent) return [];
    const items = [];
    const me = new vscode.TreeItem(t('tree.me', { name: core.name }));
    me.description = describe(core.presence, core.status);
    me.tooltip = core.account ? t('tree.account', { account: `${core.account.provider}:${core.account.label}` }) : t('tree.me.noAccount');
    me.iconPath = new vscode.ThemeIcon(core.account && core.account.provider === 'github' ? 'github' : 'account');
    items.push(me);
    for (const u of core.users.values()) {
      const item = new vscode.TreeItem(u.name);
      item.description = describe(u.presence, u.status) || t('tree.member.noFile');
      const acc = u.account ? t('tree.account', { account: `${u.account.provider}:${u.account.label}` }) : t('tree.member.noAccount');
      item.tooltip = [u.id === following ? t('tree.member.following', { name: u.name }) : u.name, acc, t('tree.member.goTo')].join('\n');
      item.iconPath = new vscode.ThemeIcon(u.id === following ? 'eye' : u.account && u.account.provider === 'github' ? 'github' : 'person');
      item.command = { command: 'lanCollab.goTo', title: t('tree.member.goToTitle'), arguments: [u.id] };
      items.push(item);
    }
    const act = new vscode.TreeItem(t('tree.activity'), vscode.TreeItemCollapsibleState.Collapsed);
    act.contextValue = 'activity';
    act.iconPath = new vscode.ThemeIcon('history');
    items.push(act);
    return items;
  }
}

module.exports = { activate, deactivate };
