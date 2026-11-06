'use strict';

const vscode = require('vscode');
const crypto = require('crypto');

// Sidebar chat. Messages come from other people, so the page only ever inserts them as text (never as HTML).
class ChatView {
  constructor(host) {
    // host: { core(), myName(), sendLocation() -> string|null, openRef(rel, line), onUnread(n) }
    this.host = host;
    this.view = null;
    this.unread = 0;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = page(crypto.randomBytes(16).toString('base64'));
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
      if (!core || !core.sendChat(String(m.text || ''))) vscode.window.showWarningMessage('LAN Collab: chưa kết nối hub, tin nhắn chưa gửi được.');
    } else if (m.type === 'location') {
      const loc = this.host.sendLocation();
      if (loc) this._post({ type: 'insert', text: `${loc} ` });
      else vscode.window.showInformationMessage('Mở một file của dự án trong editor rồi bấm lại để gắn vị trí.');
    } else if (m.type === 'open') {
      this.host.openRef(String(m.rel || ''), Number(m.line) || 1);
    }
  }

  _post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  _markRead() {
    this.unread = 0;
    if (this.view) this.view.badge = undefined;
    this.host.onUnread(0);
  }

  // Full redraw: history, who is online, connection state.
  refresh() {
    const core = this.host.core();
    const users = core ? [...core.users.values()].map((u) => ({ name: u.name, color: u.color })) : [];
    this._post({
      type: 'init',
      connected: Boolean(core && core.ready),
      me: core ? core.myId : null,
      users,
      messages: core ? core.chat.map((msg) => this._decorate(msg)) : [],
    });
  }

  _decorate(msg) {
    const core = this.host.core();
    return { ...msg, mine: core && msg.fromId === core.myId, mention: Boolean(core && msg.fromId !== core.myId && core.mentionsMe(msg)) };
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
      const preview = msg.text.length > 120 ? `${msg.text.slice(0, 120)}…` : msg.text;
      vscode.window.showInformationMessage(`LAN Collab — ${msg.from}: ${preview}`, 'Mở chat').then((pick) => {
        if (pick) vscode.commands.executeCommand('lanCollab.openChat');
      });
    }
  }
}

function page(nonce) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { padding: 0; margin: 0; display: flex; flex-direction: column; height: 100vh; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  #state { padding: 4px 8px; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  #log { flex: 1; overflow-y: auto; padding: 4px 8px; }
  .msg { margin: 6px 0; line-height: 1.4; }
  .msg.mention { border-left: 3px solid var(--vscode-editorWarning-foreground); padding-left: 6px; background: var(--vscode-editor-inactiveSelectionBackground); }
  .head { font-size: 0.85em; }
  .who { font-weight: 600; }
  .time { color: var(--vscode-descriptionForeground); margin-left: 6px; }
  .text { white-space: pre-wrap; word-break: break-word; }
  .text a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
  #people { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px; border-top: 1px solid var(--vscode-panel-border); }
  .chip { border: 1px solid currentColor; border-radius: 10px; padding: 0 6px; font-size: 0.85em; cursor: pointer; background: none; }
  #box { display: flex; gap: 4px; padding: 6px 8px 8px; }
  #box button { white-space: nowrap; }
  textarea { flex: 1; resize: none; min-height: 2.6em; font-family: inherit; font-size: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 4px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
  button.act { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 0 8px; cursor: pointer; }
  button.act.sec { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
</style>
</head>
<body>
<div id="state"></div>
<div id="log"></div>
<div id="people"></div>
<div id="box">
  <textarea id="input" placeholder="Nhắn cả phòng… (Enter gửi, Shift+Enter xuống dòng, @tên để nhắc)"></textarea>
  <button class="act sec" id="loc" title="Chèn vị trí file:dòng đang mở">Vị trí</button>
  <button class="act" id="send" title="Gửi (Enter)">Gửi</button>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const log = document.getElementById('log');
const input = document.getElementById('input');
const people = document.getElementById('people');
const state = document.getElementById('state');
const REF = /([A-Za-z0-9_\\-.\\/\\u00C0-\\uFFFF]+\\.[A-Za-z0-9]+):(\\d+)/g;

function textWithLinks(el, text) {
  let last = 0;
  for (const m of text.matchAll(REF)) {
    el.append(text.slice(last, m.index));
    const a = document.createElement('a');
    a.textContent = m[0];
    a.title = 'Mở ' + m[0];
    a.addEventListener('click', () => vscode.postMessage({ type: 'open', rel: m[1], line: Number(m[2]) }));
    el.append(a);
    last = m.index + m[0].length;
  }
  el.append(text.slice(last));
}

function add(msg) {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const div = document.createElement('div');
  div.className = 'msg' + (msg.mention ? ' mention' : '');
  const head = document.createElement('div');
  head.className = 'head';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = msg.mine ? msg.from + ' (bạn)' : msg.from;
  who.style.color = msg.color || '';
  if (msg.account) who.title = msg.account.provider + ':' + msg.account.label;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(msg.ts).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  head.append(who, time);
  const body = document.createElement('div');
  body.className = 'text';
  textWithLinks(body, msg.text);
  div.append(head, body);
  log.append(div);
  if (atBottom || msg.mine) log.scrollTop = log.scrollHeight;
}

function insert(text) {
  const s = input.selectionStart;
  input.value = input.value.slice(0, s) + text + input.value.slice(input.selectionEnd);
  input.selectionStart = input.selectionEnd = s + text.length;
  input.focus();
}

function setPeople(users) {
  people.replaceChildren();
  for (const u of users) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = '@' + u.name;
    b.style.color = u.color || '';
    b.title = 'Nhắc ' + u.name;
    b.addEventListener('click', () => insert('@' + u.name + ' '));
    people.append(b);
  }
}

function send() {
  const text = input.value.trim();
  if (!text) return;
  vscode.postMessage({ type: 'send', text });
  input.value = '';
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
document.getElementById('send').addEventListener('click', send);
document.getElementById('loc').addEventListener('click', () => vscode.postMessage({ type: 'location' }));

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    log.replaceChildren();
    state.textContent = m.connected ? (m.users.length ? m.users.length + ' người khác đang online' : 'Chỉ có bạn trong phòng') : 'Chưa kết nối hub';
    setPeople(m.users);
    for (const msg of m.messages) add(msg);
    log.scrollTop = log.scrollHeight;
  } else if (m.type === 'msg') add(m.msg);
  else if (m.type === 'insert') insert(m.text);
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

module.exports = { ChatView };
