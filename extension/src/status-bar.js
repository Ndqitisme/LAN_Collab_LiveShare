'use strict';

const vscode = require('vscode');
const { t } = require('../../lib/i18n');
const { reasonText } = require('./connection/actions');

// One status bar item drawn from the connection state, plus the follow target and unread chat count.
class StatusBar {
  constructor(app) {
    this.app = app;
    this.unread = 0;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'lanCollab.menu';
  }

  setUnread(n) {
    this.unread = n;
    this.render();
  }

  render() {
    const { state, core } = this.app.controller;
    const item = this.item;
    const target = state.target;
    const time = state.nextAt ? new Date(state.nextAt).toLocaleTimeString('vi-VN') : null;
    const spin = '$(sync~spin) LAN Collab';
    switch (state.name) {
      case 'resolving':
        item.text = spin;
        item.tooltip = t('statusBar.resolving.tooltip');
        break;
      case 'connecting':
      case 'handshaking':
        item.text = spin;
        item.tooltip = t('statusBar.connecting.tooltip', { host: target.host, port: target.port });
        break;
      case 'syncing':
        item.text = spin;
        item.tooltip = t('statusBar.syncing.tooltip', { project: target.project });
        break;
      case 'reconnecting':
        if (state.wasLive) {
          item.text = `$(warning) ${t('statusBar.offline.text')}`;
          item.tooltip = time ? t('statusBar.offline.tooltipAt', { time }) : t('statusBar.offline.tooltip');
        } else {
          item.text = `$(warning) ${t('statusBar.unreachable.text')}`;
          item.tooltip = time
            ? t('statusBar.unreachable.tooltipAt', { host: target.host, port: target.port, time })
            : t('statusBar.unreachable.tooltip', { host: target.host, port: target.port });
        }
        break;
      case 'live': {
        const following = this.app.follow.following;
        const followed = following && core.users.get(following);
        item.text = [
          `$(broadcast) ${t('statusBar.online.text', { count: core.users.size + 1 })}`,
          ...(followed ? [t('statusBar.online.following', { name: followed.name })] : []),
          ...(this.unread ? [`$(comment-discussion) ${this.unread}`] : []),
        ].join(' · ');
        item.tooltip = this.unread ? t('statusBar.online.unreadTooltip', { count: this.unread }) : t('statusBar.online.tooltip', { project: core.project });
        break;
      }
      case 'needs_action':
        item.text = `$(warning) ${t('statusBar.needsAction.text')}`;
        item.tooltip = t('statusBar.needsAction.tooltip', { reason: reasonText(state) });
        break;
      default:
        item.text = '$(debug-disconnect) LAN Collab';
        item.tooltip = t('statusBar.off.tooltip');
    }
    item.show();
  }
}

module.exports = { StatusBar };
