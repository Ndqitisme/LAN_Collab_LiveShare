'use strict';

// What the status bar item shows for a connection state: {text, tooltip, background}. Pure, so
// test/status-bar.test.js checks every state without VS Code. `info` carries what the state alone does not:
// {members, rtt, following, unread, reason}. `members` counts this member too.
const { t } = require('../../lib/i18n');

const ICON = {
  idle: '$(debug-disconnect)',
  busy: '$(sync~spin)',
  live: '$(broadcast)',
  reconnecting: '$(loading~spin)',
  needs_action: '$(warning)',
};
const WARNING_BACKGROUND = 'statusBarItem.warningBackground';

const hubLine = (target) => (target ? t('statusBar.detail.hub', { host: target.host, port: target.port }) : null);
const projectLine = (target) => (target ? t('statusBar.detail.project', { project: target.project }) : null);
const targetLine = (target) => (target ? t('connection.status.target', { project: target.project, host: target.host, port: target.port }) : null);

function statusView(state, info = {}) {
  const target = state.target;
  const time = state.nextAt ? new Date(state.nextAt).toLocaleTimeString('vi-VN') : null;
  const view = (icon, text, lines, background = null) => ({ text: `${icon} ${text}`, tooltip: lines.filter(Boolean).join('\n'), background });
  const menu = t('statusBar.next.menu');
  switch (state.name) {
    case 'resolving':
      return view(ICON.busy, t('connection.state.resolving'), [t('statusBar.resolving.tooltip'), menu]);
    case 'connecting':
    case 'handshaking':
      return view(ICON.busy, t('connection.state.connecting'), [t('statusBar.connecting.tooltip', { host: target.host, port: target.port }), projectLine(target), menu]);
    case 'syncing':
      return view(ICON.busy, t('connection.state.syncing'), [t('statusBar.syncing.tooltip', { project: target.project }), hubLine(target), menu]);
    case 'reconnecting':
      if (state.wasLive) {
        return view(ICON.reconnecting, t('statusBar.offline.text'), [
          time ? t('statusBar.offline.tooltipAt', { time }) : t('statusBar.offline.tooltip'),
          targetLine(target),
          menu,
        ]);
      }
      return view(ICON.reconnecting, t('statusBar.unreachable.text'), [
        time ? t('statusBar.unreachable.tooltipAt', { host: target.host, port: target.port, time }) : t('statusBar.unreachable.tooltip', { host: target.host, port: target.port }),
        projectLine(target),
        menu,
      ]);
    case 'live': {
      const text = [
        t('statusBar.online.text', { count: info.members }),
        ...(info.following ? [t('statusBar.online.following', { name: info.following })] : []),
        ...(info.unread ? [`$(comment-discussion) ${info.unread}`] : []),
      ].join(' · ');
      const details = [
        hubLine(target),
        t('connection.status.members', { count: info.members }),
        ...(typeof info.rtt === 'number' ? [t('connection.status.rtt', { ms: info.rtt })] : []),
      ].join(' · ');
      return view(ICON.live, text, [
        t('statusBar.online.tooltip', { project: target.project }),
        details,
        info.unread ? t('statusBar.online.unreadTooltip', { count: info.unread }) : null,
        menu,
      ]);
    }
    case 'needs_action':
      return view(ICON.needs_action, t('statusBar.needsAction.text'), [info.reason, t('statusBar.next.needsAction')], WARNING_BACKGROUND);
    default:
      return view(ICON.idle, 'LAN Collab', [state.name === 'stopped' ? t('statusBar.stopped.tooltip') : t('statusBar.off.tooltip'), menu]);
  }
}

module.exports = { statusView, ICON, WARNING_BACKGROUND };
