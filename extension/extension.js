'use strict';

const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { CollabClient } = require('../lib/client-core');
const { EditorBinding } = require('../lib/editor-binding');
const { ChatView } = require('./chat-view');
const { LineSocket, PROTO, encodeInvite, decodeInvite } = require('../lib/common');

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
    ls.on('close', () => done(`hub ${conn.host}:${conn.port} đóng kết nối`));
    let finished = false;
    const done = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ls.close();
      resolve(err);
    };
    const timer = setTimeout(() => done(`hub ${conn.host}:${conn.port} không phản hồi. Kiểm tra hub đang chạy và tường lửa đã mở cổng ${conn.port}.`), 6000);
    sock.on('connect', () => ls.send({ t: 'hello', probe: true, proto: PROTO, token: conn.token, project: conn.project }));
    ls.on('message', (m) => {
      if (m && m.t === 'probe-ok') done(null);
      else if (m && m.t === 'error' && m.code !== 'account') done(m.message);
      else if (m && m.t === 'error') done(null); // account rules are checked again with the real account
    });
    ls.on('error', (e) => done(`không kết nối được ${conn.host}:${conn.port}: ${e.message}`));
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
    vscode.window.showWarningMessage('LAN Collab: đang ở trong một phòng. Ngắt kết nối trước khi tham gia phòng khác.');
    return;
  }
  const code = typeof codeArg === 'string' ? codeArg : await vscode.window.showInputBox({
    prompt: 'Dán mã mời (bắt đầu bằng LC-). Lấy mã ở cửa sổ hub, hoặc nhờ người đã vào phòng bấm "Sao chép mã mời".',
    placeHolder: 'LC-…',
    ignoreFocusOut: true,
    validateInput: (v) => (decodeInvite(v) ? null : 'Mã không hợp lệ'),
  });
  if (!code) return;
  const conn = decodeInvite(code);
  if (!conn) return;
  const err = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `LAN Collab: kiểm tra hub ${conn.host}:${conn.port}…` }, () => probe(conn));
  if (err) {
    vscode.window.showErrorMessage(`LAN Collab: ${err}`);
    return;
  }

  let target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!(target && target.uri.scheme === 'file' && isEmptyDir(target.uri.fsPath))) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: `Tải dự án "${conn.project}" vào đây`,
      title: 'Chọn hoặc tạo một thư mục trống để chứa dự án',
    });
    if (!picked) return;
    target = { uri: picked[0] };
    if (!isEmptyDir(target.uri.fsPath)) {
      const go = await vscode.window.showWarningMessage(
        `Thư mục ${target.uri.fsPath} đã có file. File khác bản chung sẽ bị thay (bản cũ sao lưu vào .lan-collab/backup); file chỉ có ở đây sẽ được gửi lên hub. Tiếp tục?`,
        { modal: true }, 'Tiếp tục');
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

async function copyInvite() {
  const conn = folder && connectionFor(folder);
  if (!conn) {
    vscode.window.showWarningMessage('LAN Collab: thư mục này chưa gắn với hub nào.');
    return;
  }
  let host = conn.host;
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
    host = ips[0] || host; // a code pointing at "localhost" would send the teammate to their own machine
  }
  const code = encodeInvite({ ...conn, host });
  await vscode.env.clipboard.writeText(code);
  vscode.window.showInformationMessage(`LAN Collab: đã chép mã mời vào clipboard: ${code}. Người nhận chạy "LAN Collab: Tham gia bằng mã". Mã có chứa token, chỉ gửi cho người trong nhóm.`);
}

// After joining, files keep arriving for a moment: show it, so nobody starts editing a half-downloaded tree.
function showDownloadProgress() {
  const c = core;
  if (!c || c.loading.size < 3) return;
  const total = c.loading.size;
  vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LAN Collab: đang tải dự án' }, (progress) => new Promise((resolve) => {
    let shown = 0;
    const t = setInterval(() => {
      const done = total - c.loading.size;
      progress.report({ message: `${done}/${total} file`, increment: ((done - shown) / total) * 100 });
      shown = done;
      if (core !== c || c.loading.size === 0) {
        clearInterval(t);
        if (core === c) vscode.window.showInformationMessage(`LAN Collab: đã tải đủ ${total} file.`);
        resolve();
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
    vscode.window.showInformationMessage('LAN Collab đang kết nối rồi.');
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
    const pick = await vscode.window.showWarningMessage('LAN Collab: chưa mở thư mục nào. Có mã mời thì tham gia luôn, dự án sẽ được tải về một thư mục trống.', 'Tham gia bằng mã');
    if (pick) join();
    return;
  }
  const conn = connectionFor(folder);
  if (!conn) {
    const pick = await vscode.window.showWarningMessage('LAN Collab: thư mục này chưa gắn với hub nào. Dán mã mời, hoặc đặt lanCollab.server và lanCollab.project.', 'Tham gia bằng mã', 'Mở Settings');
    if (pick === 'Tham gia bằng mã') join();
    else if (pick) vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'lanCollab');
    return;
  }
  const { host, port, project, token } = conn;
  const account = await getAccount(false);
  const name = String(cfg.get('name') || '').trim() || (account && account.label) || `${os.userInfo().username}@${os.hostname()}`;

  core = new CollabClient({
    root: folder.uri.fsPath,
    host,
    port,
    token,
    project,
    name,
    account,
    uid: crypto.randomUUID(),
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
    const pick = await vscode.window.showErrorMessage(`LAN Collab: ${msg}`, ...(code === 'account' ? ['Dùng tài khoản VS Code'] : []));
    if (pick) signIn();
  });
  core.on('chat', (msg) => chatView.onMessage(msg));
  core.on('ready', () => {
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
    chatView.refresh();
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
    vscode.window.showWarningMessage(`LAN Collab: bản khác bản chung trên máy này đã được sao lưu vào ${dir}`);
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
    `Đồng bộ thư mục "${folder.name}" với hub (dự án "${info.project}")?`,
    '',
    `• Tải về ${info.get} file, ghi đè ${info.overwrite} file khác bản chung`,
    `• Gửi lên ${info.upload} file sửa/tạo trên máy này`,
    `• Xoá ${info.removeLocal} file đã bị xoá trên hub`,
  ];
  if (info.conflicts.length) {
    const names = info.conflicts.slice(0, 8).join(', ') + (info.conflicts.length > 8 ? ', …' : '');
    lines.push('', `${info.conflicts.length} file đã thay đổi cả trên máy này (trong lúc chưa kết nối) và trên hub: ${names}`,
      'Chọn bản nào được giữ cho các file này; bản bị thay luôn được sao lưu.');
  }
  lines.push('', 'File bị ghi đè/xoá được sao lưu vào .lan-collab/backup.');
  const buttons = info.conflicts.length ? ['Lấy bản chung', 'Giữ bản máy này'] : ['Đồng bộ'];
  const pick = await vscode.window.showWarningMessage(lines.join('\n'), { modal: true }, ...buttons);
  if (pick === 'Giữ bản máy này') return 'local';
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
    vscode.window.showInformationMessage(`${u.name} không mở file nào trong dự án.`);
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
    vscode.window.showWarningMessage('LAN Collab chưa kết nối.');
    return;
  }
  const items = [...core.users.values()].map((u) => ({ label: u.name, description: describe(u.presence, u.status), id: u.id }));
  if (!items.length) {
    vscode.window.showInformationMessage('Chưa có ai khác trong phòng.');
    return;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Đi theo ai? (màn hình của bạn sẽ nhảy theo file/dòng của họ)' });
  if (pick) setFollowing(pick.id);
}

async function setStatus() {
  if (!core) {
    vscode.window.showWarningMessage('LAN Collab chưa kết nối.');
    return;
  }
  const text = await vscode.window.showInputBox({ prompt: 'Bạn đang làm gì? (để trống để xoá)', value: core.status });
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
    description: `${a.provider}${same(a) ? ' · đang dùng' : ''}`,
    account: a,
  }));
  for (const p of PROVIDERS) items.push({ label: `$(sign-in) Đăng nhập tài khoản ${p.id === 'github' ? 'GitHub' : 'Microsoft'} khác…`, provider: p });
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Dùng tài khoản nào để đồng đội nhận ra bạn? (chỉ gửi tên tài khoản lên hub)',
  });
  if (!pick) return null;
  let account = pick.account;
  if (!account) {
    try {
      const s = await vscode.authentication.getSession(pick.provider.id, pick.provider.scopes, { createIfNone: true, clearSessionPreference: true });
      account = { provider: pick.provider.id, label: s.account.label };
    } catch (e) {
      vscode.window.showErrorMessage(`LAN Collab: không đăng nhập được ${pick.provider.id}: ${e.message}`);
      return null;
    }
  }
  await ctx.globalState.update('lanCollab.account', account);
  return account;
}

async function signIn() {
  const account = await getAccount(true);
  if (!account) return;
  vscode.window.showInformationMessage(`LAN Collab: dùng tài khoản ${account.provider}:${account.label}.`);
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
    vscode.window.showWarningMessage(`LAN Collab: không có file ${ref} trong dự án.`);
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
    items.push({ label: '$(plug) Kết nối', run: connect });
    items.push({ label: '$(key) Tham gia bằng mã…', run: () => join() });
  } else {
    items.push({ label: '$(link) Sao chép mã mời', run: copyInvite });
    items.push({ label: `$(comment-discussion) Mở chat${unread ? ` (${unread} tin mới)` : ''}`, run: () => vscode.commands.executeCommand('lanCollab.openChat') });
    items.push({ label: '$(eye) Đi theo một người…', run: pickFollow });
    if (following) items.push({ label: '$(eye-closed) Thôi đi theo', run: () => setFollowing(null) });
    items.push({ label: '$(comment) Đặt trạng thái…', run: setStatus });
    items.push({ label: '$(debug-disconnect) Ngắt kết nối', run: disconnect });
  }
  items.push({ label: '$(account) Dùng tài khoản VS Code (GitHub/Microsoft)…', run: signIn });
  items.push({ label: '$(output) Xem nhật ký', run: () => out.show() });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'LAN Collab' });
  if (pick) pick.run();
}

function updateStatus(state) {
  if (state) lastState = state;
  const n = core ? core.users.size + 1 : 0;
  const followName = following && core && core.users.get(following) ? ` · theo ${core.users.get(following).name}` : '';
  const view = {
    off: ['$(debug-disconnect) LAN Collab', 'Chưa kết nối — bấm để mở menu'],
    connecting: ['$(sync~spin) LAN Collab', 'Đang kết nối hub…'],
    offline: ['$(warning) LAN Collab mất kết nối', 'Đang thử kết nối lại; bạn vẫn sửa được, sẽ gộp khi có mạng'],
    online: [`$(broadcast) ${n} người${followName}${unread ? ` · $(comment-discussion) ${unread}` : ''}`, unread ? `${unread} tin nhắn chat mới — bấm để mở menu` : 'LAN Collab — bấm để mở menu'],
  }[lastState] || ['LAN Collab', ''];
  statusItem.text = view[0];
  statusItem.tooltip = view[1];
  statusItem.show();
}

function describe(p, status) {
  const parts = [];
  if (p && p.file) parts.push(`${p.file}:${p.line}`);
  if (p && p.debug) parts.push(`đang debug ${p.debug}`);
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
      const item = new vscode.TreeItem('Chưa kết nối — bấm để kết nối');
      item.iconPath = new vscode.ThemeIcon('plug');
      item.command = { command: 'lanCollab.connect', title: 'Kết nối' };
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
    const me = new vscode.TreeItem(`${core.name} (bạn)`);
    me.description = describe(core.presence, core.status);
    me.tooltip = core.account ? `Tài khoản ${core.account.provider}:${core.account.label}` : 'Chưa dùng tài khoản VS Code — menu LAN Collab > Dùng tài khoản VS Code';
    me.iconPath = new vscode.ThemeIcon(core.account && core.account.provider === 'github' ? 'github' : 'account');
    items.push(me);
    for (const u of core.users.values()) {
      const item = new vscode.TreeItem(u.name);
      item.description = describe(u.presence, u.status) || 'không mở file nào';
      const acc = u.account ? `Tài khoản ${u.account.provider}:${u.account.label}` : 'Không dùng tài khoản VS Code';
      item.tooltip = `${u.name}${u.id === following ? ' (đang đi theo)' : ''}\n${acc}\nBấm để nhảy tới chỗ người này đang đứng`;
      item.iconPath = new vscode.ThemeIcon(u.id === following ? 'eye' : u.account && u.account.provider === 'github' ? 'github' : 'person');
      item.command = { command: 'lanCollab.goTo', title: 'Nhảy tới', arguments: [u.id] };
      items.push(item);
    }
    const act = new vscode.TreeItem('Hoạt động gần đây', vscode.TreeItemCollapsibleState.Collapsed);
    act.contextValue = 'activity';
    act.iconPath = new vscode.ThemeIcon('history');
    items.push(act);
    return items;
  }
}

module.exports = { activate, deactivate };
