'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// Sidebar chat. Messages come from other people, so the page only ever inserts them as text (never as HTML).
class ChatView {
  constructor(host) {
    // host: { core(), extensionUri, sendLocation() -> string|null, openRef(rel, line), onUnread(n) }
    this.host = host;
    this.view = null;
    this.unread = 0;
  }

  resolveWebviewView(view) {
    this.view = view;
    const root = vscode.Uri.joinPath(this.host.extensionUri, 'extension', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [root] };
    view.webview.html = page(view.webview, root, crypto.randomBytes(16).toString('base64'));
    view.webview.onDidReceiveMessage((m) => this._onMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) this._markRead();
    });
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  _onMessage(m) {
    const core = this.host.core();
    if (m.type === 'ready') this.refresh();
    else if (m.type === 'send') {
      const reason = core ? core.sendChat(String(m.text || ''), validImage(m.image)) : 'Chưa kết nối hub, tin nhắn chưa gửi được.';
      this._post({ type: 'sendResult', ok: !reason, reason });
    } else if (m.type === 'location') {
      const loc = this.host.sendLocation();
      if (loc) this._post({ type: 'insert', text: `${loc} ` });
      else this._post({ type: 'notice', text: 'Mở một file của dự án trong editor để gắn vị trí.' });
    } else if (m.type === 'open') {
      this.host.openRef(String(m.rel || ''), Number(m.line) || 1);
    } else if (m.type === 'media') {
      const id = String(m.id || '');
      const pending = core ? core.getChatMedia(id) : Promise.resolve(null);
      pending.then((v) => this._post({ type: 'media', id, src: v ? `data:${v.mime};base64,${v.b64}` : null }));
    } else if (m.type === 'openImage') {
      this._openImage(String(m.id || ''));
    } else if (m.type === 'openUrl') {
      const url = String(m.url || '');
      if (/^https?:\/\//i.test(url)) vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  // Opens a chat image in VS Code's own image viewer (zoom, copy) from a temporary file.
  async _openImage(id) {
    const core = this.host.core();
    const v = core && /^[0-9a-f]{40}$/.test(id) ? await core.getChatMedia(id) : null;
    if (!v || !EXT[v.mime]) {
      vscode.window.showWarningMessage('LAN Collab: ảnh không còn trên hub.');
      return;
    }
    const file = path.join(os.tmpdir(), 'lan-collab-chat', `${id}.${EXT[v.mime]}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(v.b64, 'base64'));
    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file), { preview: true });
  }

  _post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  _markRead() {
    this.unread = 0;
    if (this.view) this.view.badge = undefined;
    this.host.onUnread(0);
  }

  _people() {
    const core = this.host.core();
    return {
      connected: Boolean(core && core.ready),
      users: core ? [...core.users.values()].map((u) => ({ name: u.name, color: u.color, status: u.status || '' })) : [],
    };
  }

  // Full redraw: history, who is online, connection state.
  refresh() {
    const core = this.host.core();
    this._post({ type: 'init', ...this._people(), messages: core ? core.chat.map((msg) => this._decorate(msg)) : [] });
  }

  // Someone joined or left: only the header and @-suggestions change.
  updatePeople() {
    this._post({ type: 'people', ...this._people() });
  }

  onRejected(reason) {
    this._post({ type: 'notice', text: reason });
  }

  _decorate(msg) {
    const core = this.host.core();
    const mine = Boolean(core && core.isMine(msg));
    return { ...msg, mine, mention: Boolean(core && !mine && core.mentionsMe(msg)) };
  }

  onMessage(msg) {
    const d = this._decorate(msg);
    this._post({ type: 'msg', msg: d });
    if (d.mine) return;
    const seen = this.view && this.view.visible && vscode.window.state.focused;
    if (!seen) {
      this.unread += 1;
      if (this.view) this.view.badge = { value: this.unread, tooltip: `${this.unread} tin nhắn mới` };
      this.host.onUnread(this.unread);
    }
    if (d.mention && !seen) {
      const text = msg.text || '[Ảnh]';
      const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      vscode.window.showInformationMessage(`LAN Collab — ${msg.from}: ${preview}`, 'Mở chat').then((pick) => {
        if (pick) vscode.commands.executeCommand('lanCollab.openChat');
      });
    }
  }
}

function validImage(img) {
  if (!img || typeof img !== 'object' || !EXT[img.mime] || typeof img.b64 !== 'string') return null;
  return { mime: img.mime, b64: img.b64, w: Number(img.w) || 0, h: Number(img.h) || 0 };
}

function page(webview, root, nonce) {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(root, 'chat.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(root, 'chat.js'));
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head>
<body>
<header id="top">
  <div id="state"><span class="dot"></span><span id="stateText">Chưa kết nối hub</span></div>
  <div id="faces"></div>
</header>
<div id="logWrap">
  <main id="log" aria-live="polite"></main>
  <button id="jump" class="hidden" title="Cuộn xuống tin mới nhất"></button>
</div>
<footer id="composer">
  <div id="notice" class="hidden"></div>
  <div id="attach" class="hidden">
    <img id="attachImg" alt="">
    <div id="attachInfo"></div>
    <button id="attachRemove" class="icon" title="Bỏ ảnh">
      <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
    </button>
  </div>
  <div id="suggest" class="popup hidden" role="listbox"></div>
  <div id="emoji" class="popup hidden">
    <div id="emojiTabs"></div>
    <div id="emojiGrid"></div>
  </div>
  <textarea id="input" rows="1" maxlength="4000" placeholder="Nhắn cả phòng · @ để nhắc tên · dán ảnh bằng Ctrl+V"></textarea>
  <div id="tools">
    <button id="emojiBtn" class="icon" title="Chèn emoji">
      <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M5.2 9.6c.7 1 1.6 1.5 2.8 1.5s2.1-.5 2.8-1.5"/><path class="fill" d="M6 6.4a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0zM11.6 6.4a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0z"/></svg>
    </button>
    <button id="imageBtn" class="icon" title="Gửi ảnh (hoặc dán ảnh bằng Ctrl+V)">
      <svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6" r="1.2"/><path d="M1.8 12l3.7-3.6 2.6 2.4 2.4-2.2 3.7 3.4"/></svg>
    </button>
    <button id="locBtn" class="icon" title="Chèn vị trí file:dòng đang mở">
      <svg viewBox="0 0 16 16"><path d="M8 14.5s4.5-4.1 4.5-7.6a4.5 4.5 0 0 0-9 0c0 3.5 4.5 7.6 4.5 7.6z"/><circle cx="8" cy="6.9" r="1.6"/></svg>
    </button>
    <span class="grow"></span>
    <span id="count"></span>
    <button id="send" title="Gửi (Enter) · Shift+Enter xuống dòng" disabled>
      <svg viewBox="0 0 16 16"><path class="fill" d="M1.7 2.2l12.6 5.4a.45.45 0 0 1 0 .8L1.7 13.8a.45.45 0 0 1-.62-.52L2.4 8.6l6.1-.6-6.1-.6-1.32-4.68a.45.45 0 0 1 .62-.52z"/></svg>
      <span>Gửi</span>
    </button>
  </div>
  <input id="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
</footer>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

module.exports = { ChatView };
