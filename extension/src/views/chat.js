'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { t, catalogFor } = require('../../../lib/i18n');
const { webviewOptions, webviewHtml } = require('./webview-host');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const IMAGE_ID = /^[0-9a-f]{40}$/;

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
    view.webview.options = webviewOptions(this.host.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.host.extensionUri, 'chat');
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
      const reason = core ? core.sendChat(String(m.text || ''), validImage(m.image)) : t('chat.send.notConnected');
      this._post({ type: 'sendResult', ok: !reason, reason });
    } else if (m.type === 'location') {
      const loc = this.host.sendLocation();
      if (loc) this._post({ type: 'insert', text: `${loc} ` });
      else this._post({ type: 'notice', text: t('chat.location.none') });
    } else if (m.type === 'open') {
      this.host.openRef(String(m.rel || ''), Number(m.line) || 1);
    } else if (m.type === 'media') {
      const id = String(m.id || '');
      const pending = core && IMAGE_ID.test(id) ? core.getChatMedia(id) : Promise.resolve(null);
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
    const v = core && IMAGE_ID.test(id) ? await core.getChatMedia(id) : null;
    if (!v || !EXT[v.mime]) {
      vscode.window.showWarningMessage(t('chat.image.gone'));
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
    this._post({ type: 'init', catalog: catalogFor('chat.'), ...this._people(), messages: core ? core.chat.map((msg) => this._decorate(msg)) : [] });
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
      if (this.view) this.view.badge = { value: this.unread, tooltip: t('chat.badge', { count: this.unread }) };
      this.host.onUnread(this.unread);
    }
    if (d.mention && !seen) {
      const text = msg.text || t('chat.mention.image');
      const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      vscode.window.showInformationMessage(t('chat.mention.notify', { from: msg.from, text: preview }), t('command.lanCollab.openChat.title')).then((pick) => {
        if (pick) vscode.commands.executeCommand('lanCollab.openChat');
      });
    }
  }
}

function validImage(img) {
  if (!img || typeof img !== 'object' || !EXT[img.mime] || typeof img.b64 !== 'string') return null;
  return { mime: img.mime, b64: img.b64, w: Number(img.w) || 0, h: Number(img.h) || 0 };
}

module.exports = { ChatView };
