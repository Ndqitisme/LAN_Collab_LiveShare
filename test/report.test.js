'use strict';

// The diagnosis report (extension/src/connection/report.js) never carries the token or an invite code, wherever
// they appear in the step data. Run: node test/report.test.js
const assert = require('assert');
const { encodeInvite, encodeInviteV3 } = require('../lib/common');
const { buildReport, redact } = require('../extension/src/connection/report');
const { STEPS } = require('../lib/diagnostics');

const TOKEN = '5f0c9e"q\\x';
const V3 = encodeInviteV3({ instanceId: 'I1', hosts: ['192.168.1.10'], port: 8200, project: 'Demo', token: TOKEN });
const V2 = encodeInvite({ host: '192.168.1.10', port: 8200, project: 'Demo', token: 'abcdef' });

const info = { time: '07/11/2026 10:00:00', extensionVersion: '0.2.0', vscodeVersion: '1.99.0', nodeVersion: '20.0.0', os: 'Windows_NT 10.0.19045 x64', interfaces: [{ name: 'Ethernet', address: '192.168.1.20', netmask: '255.255.255.0' }] };
const target = { folder: 'C:\\work\\demo', project: 'Demo', port: 8200, addresses: ['192.168.1.10'], lastGood: null, instanceId: 'I1', tlsFingerprint: null, token: TOKEN };
const results = STEPS.map((step) => ({ step, status: 'ok', code: null, data: {}, remedy: null }));
// Leaks planted where a careless future step could put them: raw, inside JSON (escaped), inside invite codes.
results[1].data = { note: `token ${TOKEN}`, invite: V3, legacy: V2, wrapped: `${V3.slice(0, 20)}\n${V3.slice(20)}` };
results[5] = { step: 'handshake', status: 'failed', code: 'token_invalid', data: { message: `hello ${JSON.stringify({ token: TOKEN })}` }, remedy: { text: `Dán ${V3}`, actions: ['paste_invite'] } };

const report = buildReport({ info, target, results });

assert.ok(!report.includes(TOKEN), 'raw token');
assert.ok(!report.includes(JSON.stringify(TOKEN).slice(1, -1)), 'JSON-escaped token');
assert.ok(!/LC3?-[A-Za-z0-9_-]{4,}/.test(report), 'invite code');
assert.ok(!report.includes(V3.slice(24, 60)), 'any piece of a wrapped invite code');
for (const step of ['Cấu hình thư mục', 'Kết nối tới địa chỉ đã biết', 'Tìm LAN Hub trong mạng LAN', 'Đường mạng tới LAN Hub', 'Vân tay TLS', 'Phiên bản, dự án, token và tài khoản', 'Thư mục dự án', 'Độ trễ tới LAN Hub']) {
  assert.ok(report.includes(step), `step ${step} appears`);
}
assert.ok(report.includes('0.2.0') && report.includes('Windows_NT') && report.includes('192.168.1.20/255.255.255.0'), 'versions, OS and interfaces');
assert.ok(report.includes('6. Phiên bản, dự án, token và tài khoản: Không đạt'), 'status per step');

assert.strictEqual(redact('a LC-AQoAAAEAAQAAWA b', []), 'a *** b');
assert.strictEqual(redact('no secrets here', ['', undefined]), 'no secrets here', 'an empty token redacts nothing');

console.log('report: OK');
