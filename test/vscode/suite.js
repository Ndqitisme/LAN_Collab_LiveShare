'use strict';

// Runs inside the VS Code extension host (see run.js). A real editor and a disk-only peer edit the same
// files at the same time; afterwards both, the hub and both disks must agree and no character may be lost
// or duplicated.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { CollabClient } = require('../../lib/client-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(25);
  }
  throw new Error(`Hết giờ chờ: ${what}`);
}

function boundary(t, i) {
  const c = t.charCodeAt(i - 1);
  if ((t[i - 1] === '\r' && t[i] === '\n') || (c >= 0xd800 && c <= 0xdbff)) return i - 1;
  return i;
}

function quietClient(c) {
  return c.ready && c.loading.size === 0 && c.writeTimers.size === 0 && c.diskTimers.size === 0
    && [...c.entries.values()].every((e) => e.kind !== 'text' || (!e.ot.outstanding && !e.ot.buffer && (!e.binding || e.binding.idle())));
}

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

exports.run = async function run() {
  const ext = vscode.extensions.getExtension('ndqitisme.lan-collab');
  const api = await ext.activate();
  await waitFor(() => api.core() && api.core().ready && api.core().loading.size === 0, 20000, 'extension vào phòng');
  const core = api.core();
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;

  const store = new Map();
  const peer = new CollabClient({
    root: process.env.LC_PEER_ROOT, host: '127.0.0.1', port: Number(process.env.LC_HUB_PORT), project: 'Demo',
    name: 'peer', uid: 'peer', retryMs: 50, state: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
  });
  peer.connect();
  await waitFor(() => peer.ready && peer.loading.size === 0, 10000, 'peer vào phòng');

  const problems = [];
  let uniq = 0x4e00;
  for (const rel of ['a.py', 'crlf.py', 'bom.csv']) {
    const file = path.join(folder, rel);
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await waitFor(() => core.entries.get(rel) && core.entries.get(rel).binding, 5000, `binding ${rel}`);
    const bom = core.entries.get(rel).binding.bom;
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const startLen = core.entries.get(rel).text.length;
    let inserted = 0;
    let rejected = 0;
    const pending = [];
    const marks = [];

    for (let i = 0; i < 160; i++) {
      if (Math.random() < 0.55) {
        const t = doc.getText();
        const off = boundary(t, Math.floor(Math.random() * (t.length + 1)));
        const s = (Math.random() < 0.15 ? '\n' : 'v') + String.fromCharCode(uniq++);
        const p = editor.edit((eb) => eb.insert(doc.positionAt(off), s)).then((ok) => {
          if (ok) {
            inserted += s.replace(/\n/g, eol).length;
            marks.push(['local', s[1]]);
          } else rejected += 1;
        });
        pending.push(p);
        if (Math.random() < 0.3) await p;
      } else {
        const pf = peer.abs(rel);
        const cur = fs.readFileSync(pf, 'utf8');
        const off = Math.max(cur.startsWith('﻿') ? 1 : 0, boundary(cur, Math.floor(Math.random() * (cur.length + 1))));
        const s = `P${String.fromCharCode(uniq++)}`;
        fs.writeFileSync(pf, cur.slice(0, off) + s + cur.slice(off));
        peer.onDiskEvent(pf);
        inserted += s.length;
        marks.push(['peer', s[1]]);
      }
      if (i % 4 === 0) await sleep(Math.floor(Math.random() * 25));
    }
    await Promise.all(pending);
    await waitFor(() => quietClient(core) && quietClient(peer) && !doc.isDirty, 20000, `lặng sau khi sửa ${rel}`);
    await sleep(600);

    const shared = peer.entries.get(rel).text;
    const editorText = bom + doc.getText();
    if (editorText !== shared) problems.push(`${rel}: editor VS Code lệch peer`);
    if (core.entries.get(rel).text !== shared) problems.push(`${rel}: core VS Code lệch peer`);
    if (fs.readFileSync(file, 'utf8') !== shared) problems.push(`${rel}: đĩa máy VS Code lệch`);
    if (fs.readFileSync(peer.abs(rel), 'utf8') !== shared) problems.push(`${rel}: đĩa peer lệch`);
    if (shared.length !== startLen + inserted) problems.push(`${rel}: dài ${shared.length}, kỳ vọng ${startLen + inserted} (mất/nhân đôi chữ)`);
    if (bom && !shared.startsWith('﻿')) problems.push(`${rel}: mất BOM`);
    for (const [who, ch] of marks) {
      if (count(shared, ch) !== 1) problems.push(`${rel}: dấu ${who} ${ch} xuất hiện ${count(shared, ch)} lần`);
    }
    if (problems.length) console.log(`[suite] ${problems.join(' | ')}`);
    console.log(`[suite] ${rel}: ${inserted} ký tự chèn, ${rejected} lần gõ bị VS Code từ chối vì tài liệu vừa đổi, dài ${shared.length}`);
  }

  // AI on the VS Code machine writes a file whose editor is clean: VS Code reloads it, the change must reach the peer once.
  {
    const rel = 'a.py';
    const file = path.join(folder, rel);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath.toLowerCase() === file.toLowerCase());
    await waitFor(() => !doc.isDirty, 5000, 'a.py sạch');
    const cur = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, `${cur}# EXT1\n`);
    await waitFor(() => peer.entries.get(rel).text.includes('# EXT1'), 8000, 'EXT1 tới peer');
    await sleep(2500);
    const shared = peer.entries.get(rel).text;
    if (count(shared, '# EXT1') !== 1) problems.push(`EXT1 xuất hiện ${count(shared, '# EXT1')} lần`);
    if (doc.getText() !== shared) problems.push('a.py: editor lệch sau EXT1');
  }

  // AI appends an LF-terminated line to a CRLF file open (clean) here: VS Code reloads it as CRLF; it must
  // reach the peer once, as CRLF.
  {
    const rel = 'crlf.py';
    const file = path.join(folder, rel);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath.toLowerCase() === file.toLowerCase());
    await waitFor(() => !doc.isDirty, 5000, 'crlf.py sạch');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}# EXT3\n`);
    await waitFor(() => peer.entries.get(rel).text.includes('# EXT3'), 8000, 'EXT3 tới peer');
    await sleep(2500);
    const shared = peer.entries.get(rel).text;
    if (count(shared, '# EXT3') !== 1) problems.push(`EXT3 xuất hiện ${count(shared, '# EXT3')} lần`);
    if (!shared.endsWith('# EXT3\r\n') || /[^\r]\n/.test(shared)) problems.push(`crlf.py không còn CRLF đồng nhất: ${JSON.stringify(shared.slice(-30))}`);
    if (doc.getText() !== shared) problems.push('crlf.py: editor lệch sau EXT3');
  }

  // AI writes while the editor still holds an unsaved edit: 3-way merge keeps both.
  {
    const rel = 'a.py';
    const file = path.join(folder, rel);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath.toLowerCase() === file.toLowerCase());
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await editor.edit((eb) => eb.insert(new vscode.Position(0, 0), '# TYPED\n'));
    const cur = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, `${cur}# EXT2\n`);
    await waitFor(() => peer.entries.get(rel).text.includes('# EXT2') && peer.entries.get(rel).text.includes('# TYPED'), 8000, 'EXT2 + TYPED tới peer');
    await sleep(2500);
    const shared = peer.entries.get(rel).text;
    if (count(shared, '# EXT2') !== 1 || count(shared, '# TYPED') !== 1) problems.push(`EXT2/TYPED sai số lần: ${JSON.stringify(shared)}`);
    if (doc.getText() !== shared) problems.push('a.py: editor lệch sau EXT2');
    if (doc.isDirty) problems.push('a.py: còn dirty sau EXT2 (xem files.saveConflictResolution)');
    if (fs.readFileSync(file, 'utf8') !== shared) problems.push('a.py: đĩa máy VS Code lệch sau EXT2');
  }

  // Presence, status and "go to" a teammate: open another file, then jump to where the peer stands.
  {
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(folder, 'crlf.py')));
    peer.sendPresence({ file: 'a.py', sel: [[5, 8]], line: 1, debug: 'a.py' });
    peer.setStatus('đang làm PD1');
    await waitFor(() => [...core.users.values()].some((u) => u.presence && u.presence.file === 'a.py' && u.status === 'đang làm PD1'), 5000, 'presence của peer');
    const u = [...core.users.values()].find((x) => x.name === 'peer');
    await vscode.commands.executeCommand('lanCollab.goTo', u.id);
    const active = vscode.window.activeTextEditor;
    if (!active || path.basename(active.document.uri.fsPath) !== 'a.py') problems.push('goTo không mở a.py');
    await waitFor(() => core.activity.some((a) => a.text === 'bắt đầu debug a.py'), 5000, 'activity debug');
    const mine = await new Promise((resolve) => {
      const t = setInterval(() => {
        const me = [...peer.users.values()].find((x) => x.name !== 'peer');
        if (me && me.presence && me.presence.file === 'a.py') {
          clearInterval(t);
          resolve(me.presence);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(t);
        resolve(null);
      }, 5000);
    });
    if (!mine) problems.push('peer không thấy vị trí của máy VS Code');
  }

  // Chat: the view opens, messages go both ways, a mention of this user is recognised.
  {
    await vscode.commands.executeCommand('lanCollab.openChat');
    await sleep(500);
    peer.sendChat(`@${core.name} vui lòng kiểm tra a.py:1`);
    await waitFor(() => core.chat.some((m) => m.from === 'peer'), 5000, 'chat tới máy VS Code');
    if (!core.mentionsMe(core.chat.find((m) => m.from === 'peer'))) problems.push('không nhận ra @tên của mình');
    core.sendChat('Đã nhận');
    await waitFor(() => peer.chat.some((m) => m.text === 'Đã nhận'), 5000, 'chat tới peer');
    if (core.account) problems.push('profile thử nghiệm không được có tài khoản');
    const gh = await vscode.authentication.getAccounts('github');
    if (!Array.isArray(gh)) problems.push('authentication.getAccounts không trả về mảng');
  }

  peer.disconnect();
  if (problems.length) throw new Error(`\n  ${problems.join('\n  ')}`);
  console.log('[suite] OK');
};
