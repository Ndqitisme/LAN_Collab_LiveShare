'use strict';

const vscode = require('vscode');
const { reasonText } = require('./connection/actions');
const { statusView } = require('./status-view');

// The tooltip shows the round trip time, which the core measures every few seconds without an event.
const RTT_REFRESH_MS = 5000;

// One status bar item drawn from the connection state, plus the follow target and unread chat count.
class StatusBar {
  constructor(app) {
    this.app = app;
    this.unread = 0;
    this.shownRtt = null;
    this.rttTimer = null;
    this.item = vscode.window.createStatusBarItem('lanCollab.status', vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'LAN Collab';
    this.item.command = 'lanCollab.menu';
  }

  setUnread(n) {
    this.unread = n;
    this.render();
  }

  render() {
    const { state, core } = this.app.controller;
    const live = state.name === 'live' && core;
    const followed = live && this.app.follow.following && core.users.get(this.app.follow.following);
    this.shownRtt = live ? core.rtt : null;
    const view = statusView(state, {
      members: live ? core.users.size + 1 : 0,
      rtt: this.shownRtt,
      following: followed ? followed.name : null,
      unread: this.unread,
      reason: state.name === 'needs_action' ? reasonText(state) : null,
    });
    const item = this.item;
    item.text = view.text;
    item.tooltip = view.tooltip;
    item.backgroundColor = view.background ? new vscode.ThemeColor(view.background) : undefined;
    item.show();
    this._syncRttTimer(live);
  }

  _syncRttTimer(live) {
    if (live && !this.rttTimer) {
      this.rttTimer = setInterval(() => {
        const core = this.app.controller.core;
        if (core && core.rtt !== this.shownRtt) this.render();
      }, RTT_REFRESH_MS);
    } else if (!live && this.rttTimer) {
      clearInterval(this.rttTimer);
      this.rttTimer = null;
    }
  }

  dispose() {
    clearInterval(this.rttTimer);
    this.item.dispose();
  }
}

module.exports = { StatusBar };
