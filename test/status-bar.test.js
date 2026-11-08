'use strict';

// The status bar item for every connection state (extension/src/status-view.js): icon, text, tooltip lines and
// background. Run: node test/status-bar.test.js
const assert = require('assert');
const { STATES, initial } = require('../lib/connection-machine');
const { statusView, WARNING_BACKGROUND } = require('../extension/src/status-view');

const target = { host: '192.168.1.10', port: 8200, project: 'web-portal' };
const nextAt = Date.UTC(2026, 10, 8, 2, 15, 30);
const at = new Date(nextAt).toLocaleTimeString('vi-VN');
const state = (name, patch = {}) => ({ ...initial, name, target, ...patch });

const cases = [
  ['idle', state('idle', { target: null }), {}, {
    text: '$(debug-disconnect) LAN Collab',
    tooltip: ['Chưa kết nối LAN Hub.', 'Bấm để mở menu.'],
  }],
  ['stopped', state('stopped', { target: null }), {}, {
    text: '$(debug-disconnect) LAN Collab',
    tooltip: ['Đã ngắt kết nối LAN Hub.', 'Bấm để mở menu.'],
  }],
  ['resolving', state('resolving', { target: null }), {}, {
    text: '$(sync~spin) Đang tìm LAN Hub',
    tooltip: ['Đang tìm LAN Hub của thư mục này.', 'Bấm để mở menu.'],
  }],
  ['connecting', state('connecting'), {}, {
    text: '$(sync~spin) Đang kết nối',
    tooltip: ['Đang kết nối LAN Hub tại 192.168.1.10:8200.', 'Dự án web-portal', 'Bấm để mở menu.'],
  }],
  ['handshaking', state('handshaking'), {}, {
    text: '$(sync~spin) Đang kết nối',
    tooltip: ['Đang kết nối LAN Hub tại 192.168.1.10:8200.', 'Dự án web-portal', 'Bấm để mở menu.'],
  }],
  ['syncing', state('syncing'), {}, {
    text: '$(sync~spin) Đang đồng bộ',
    tooltip: ['Đang đồng bộ dự án web-portal.', 'LAN Hub 192.168.1.10:8200', 'Bấm để mở menu.'],
  }],
  ['live', state('live', { wasLive: true }), { members: 4, rtt: 3 }, {
    text: '$(broadcast) 4 thành viên',
    tooltip: ['Đã kết nối dự án web-portal.', 'LAN Hub 192.168.1.10:8200 · 4 thành viên trực tuyến · Độ trễ 3 ms', 'Bấm để mở menu.'],
  }],
  ['live, following, unread, no RTT yet', state('live', { wasLive: true }), { members: 2, rtt: null, following: 'Minh Anh', unread: 3 }, {
    text: '$(broadcast) 2 thành viên · đang đi theo Minh Anh · $(comment-discussion) 3',
    tooltip: ['Đã kết nối dự án web-portal.', 'LAN Hub 192.168.1.10:8200 · 2 thành viên trực tuyến', '3 tin nhắn chat mới.', 'Bấm để mở menu.'],
  }],
  ['reconnecting after live', state('reconnecting', { wasLive: true, nextAt }), {}, {
    text: '$(loading~spin) Mất kết nối',
    tooltip: [`Mất kết nối LAN Hub. Kết nối lại lúc ${at}. Thay đổi trên máy này được gửi khi kết nối lại.`, 'LAN Hub 192.168.1.10:8200, dự án web-portal', 'Bấm để mở menu.'],
  }],
  ['reconnecting after live, attempt running', state('reconnecting', { wasLive: true }), {}, {
    text: '$(loading~spin) Mất kết nối',
    tooltip: ['Mất kết nối LAN Hub. Đang kết nối lại. Thay đổi trên máy này được gửi khi kết nối lại.', 'LAN Hub 192.168.1.10:8200, dự án web-portal', 'Bấm để mở menu.'],
  }],
  ['reconnecting, never live', state('reconnecting', { nextAt }), {}, {
    text: '$(loading~spin) Chưa kết nối được',
    tooltip: [`Không kết nối được LAN Hub tại 192.168.1.10:8200. Thử lại lúc ${at}.`, 'Dự án web-portal', 'Bấm để mở menu.'],
  }],
  ['needs_action', state('needs_action', { code: 'token_invalid', data: {}, actions: ['paste_invite'] }), { reason: 'LAN Hub từ chối token của máy này. Token đã đổi hoặc mã mời đã cũ.' }, {
    text: '$(warning) Cần xử lý',
    tooltip: ['LAN Hub từ chối token của máy này. Token đã đổi hoặc mã mời đã cũ.', 'Bấm để chọn cách xử lý.'],
    background: WARNING_BACKGROUND,
  }],
];

const covered = new Set();
for (const [name, s, info, want] of cases) {
  covered.add(s.name);
  const got = statusView(s, info);
  assert.strictEqual(got.text, want.text, `${name}: text`);
  assert.strictEqual(got.tooltip, want.tooltip.join('\n'), `${name}: tooltip`);
  assert.strictEqual(got.background, want.background || null, `${name}: background`);
  assert.ok(!/\$\(/.test(got.tooltip), `${name}: no codicon in the tooltip`);
}
assert.deepStrictEqual(STATES.filter((n) => !covered.has(n)), [], 'every machine state has a case');
assert.strictEqual(WARNING_BACKGROUND, 'statusBarItem.warningBackground');

console.log(`status-bar: OK (${cases.length} cases, ${covered.size} states)`);
