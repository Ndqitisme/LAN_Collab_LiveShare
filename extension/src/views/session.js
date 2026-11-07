'use strict';

const vscode = require('vscode');
const { t, catalogFor } = require('../../../lib/i18n');
const { webviewOptions, webviewHtml } = require('./webview-host');
const { actionLabel, reasonText, runAction } = require('../connection/actions');

// Others repeat their presence every 5 s only to refresh `rtt`, and client-core emits no event for that.
const RTT_REFRESH_MS = 5000;

// The `Thành viên` view: every member's place in the project and the activity feed. It shows members only in
// `live`; in every other state it shows the connection state with the actions that state offers.
class SessionView {
  constructor(app) {
    this.app = app;
    this.view = null;
    this.timer = null;
    this.rttTimer = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = webviewOptions(this.app.context.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.app.context.extensionUri, 'session');
    view.webview.onDidReceiveMessage((m) => this._onMessage(m));
    view.onDidChangeVisibility(() => this._syncRttTimer());
    view.onDidDispose(() => {
      this.view = null;
      this._syncRttTimer();
    });
    this._syncRttTimer();
  }

  _onMessage(m) {
    const { follow, controller } = this.app;
    if (m.type === 'ready') this.refresh();
    else if (m.type === 'goTo') follow.goTo(String(m.id || ''));
    else if (m.type === 'follow') follow.set(m.id ? String(m.id) : null);
    else if (m.type === 'open') follow.openRef(String(m.path || ''), Number(m.line) || 1);
    else if (m.type === 'action') {
      const s = controller.state;
      if (m.id === 'connect') vscode.commands.executeCommand('lanCollab.connect');
      else if (s.name === 'needs_action' && s.actions.includes(m.id)) runAction(this.app, m.id, s);
      else if (m.id === 'join' || m.id === 'reconnect') runAction(this.app, m.id, s);
    }
  }

  _post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  // Full redraw: captions, connection, members and the whole feed.
  refresh() {
    this._syncRttTimer();
    const core = this.app.controller.core;
    this._post({
      type: 'init',
      catalog: { ...catalogFor('session.'), ...catalogFor('activity.') },
      ...this.snapshot(),
      activity: core && this.app.controller.state.name === 'live' ? core.activity.map(feedEntry) : [],
    });
  }

  // Members, presence, status or the follow target changed. Coalesced: 30 members moving at once post one update.
  update() {
    this._syncRttTimer();
    if (this.timer || !this.view) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._post({ type: 'members', ...this.snapshot() });
    }, 16);
  }

  onActivity(a) {
    if (this.app.controller.state.name === 'live') this._post({ type: 'activity', entry: feedEntry(a) });
  }

  // What the view shows, also read by test/vscode/suite.js.
  snapshot() {
    const { controller, follow } = this.app;
    const { state, core } = controller;
    const live = state.name === 'live' && core;
    return {
      connection: connectionView(state),
      me: live ? me(core) : null,
      members: live ? [...core.users.values()].map(member) : [],
      following: live ? follow.following : null,
    };
  }

  _syncRttTimer() {
    const want = Boolean(this.view && this.view.visible && this.app.controller.state.name === 'live');
    if (want && !this.rttTimer) this.rttTimer = setInterval(() => this.update(), RTT_REFRESH_MS);
    else if (!want && this.rttTimer) {
      clearInterval(this.rttTimer);
      this.rttTimer = null;
    }
  }

  dispose() {
    clearTimeout(this.timer);
    clearInterval(this.rttTimer);
  }
}

function me(core) {
  const p = core.presence || {};
  return {
    id: core.myId,
    name: core.name,
    color: core.myColor || null,
    account: core.account || null,
    file: p.file || null,
    line: p.line || 0,
    debug: p.debug || null,
    status: core.status || '',
    rtt: core.rtt,
  };
}

function member(u) {
  const p = u.presence || {};
  return {
    id: u.id,
    name: u.name,
    color: u.color || null,
    account: u.account || null,
    file: p.file || null,
    line: p.line || 0,
    debug: p.debug || null,
    status: u.status || '',
    rtt: typeof p.rtt === 'number' ? p.rtt : null,
  };
}

function feedEntry(a) {
  return { ts: a.ts, who: a.who, color: a.color || null, kind: a.kind || null, path: a.path || null, detail: a.detail || null, text: a.text || '' };
}

// The connection state as the view's empty state: a title, one sentence and the buttons of that state.
function connectionView(s) {
  const target = s.target;
  const time = s.nextAt ? new Date(s.nextAt).toLocaleTimeString('vi-VN') : null;
  const action = (id) => ({ id, label: actionLabel(id) });
  switch (s.name) {
    case 'live':
      return { name: 'live' };
    case 'resolving':
      return { name: s.name, tone: 'connecting', title: t('session.state.connecting.title'), description: t('statusBar.resolving.tooltip'), actions: [] };
    case 'connecting':
    case 'handshaking':
      return { name: s.name, tone: 'connecting', title: t('session.state.connecting.title'), description: t('statusBar.connecting.tooltip', { host: target.host, port: target.port }), actions: [] };
    case 'syncing':
      return { name: s.name, tone: 'connecting', title: t('session.state.syncing.title'), description: t('statusBar.syncing.tooltip', { project: target.project }), actions: [] };
    case 'reconnecting':
      return s.wasLive
        ? { name: s.name, tone: 'error', title: t('statusBar.offline.text'), description: time ? t('statusBar.offline.tooltipAt', { time }) : t('statusBar.offline.tooltip'), actions: [action('reconnect')] }
        : {
          name: s.name,
          tone: 'error',
          title: t('statusBar.unreachable.text'),
          description: time ? t('statusBar.unreachable.tooltipAt', { host: target.host, port: target.port, time }) : t('statusBar.unreachable.tooltip', { host: target.host, port: target.port }),
          actions: [action('reconnect')],
        };
    case 'needs_action':
      return { name: s.name, tone: 'error', title: t('statusBar.needsAction.text'), description: reasonText(s), actions: s.actions.map(action) };
    default:
      return { name: s.name, tone: 'offline', title: t('session.state.idle.title'), description: t('session.state.idle.description'), actions: [{ id: 'connect', label: t('menu.connect') }, action('join')] };
  }
}

module.exports = { SessionView, connectionView };
