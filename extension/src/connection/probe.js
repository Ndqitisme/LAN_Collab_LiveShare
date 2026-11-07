'use strict';

const net = require('net');
const { hubErrorText } = require('../../../lib/client-core');
const { t } = require('../../../lib/i18n');
const { LineSocket, PROTO_V2 } = require('../../../lib/common');

// Checks a code against the hub before touching any folder: answers null if it may join, else the reason.
function probe(conn, log) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: conn.host, port: conn.port });
    const ls = new LineSocket(sock);
    ls.on('close', () => done(t('connect.error.closed', { host: conn.host, port: conn.port })));
    let finished = false;
    const done = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ls.close();
      resolve(err);
    };
    const timer = setTimeout(() => {
      log(`Kiểm tra ${conn.host}:${conn.port}: không phản hồi sau 6 giây.`);
      done(t('connect.error.timeout', { host: conn.host, port: conn.port, seconds: 6 }));
    }, 6000);
    sock.on('connect', () => ls.send({ t: 'hello', probe: true, proto: PROTO_V2, token: conn.token, project: conn.project }));
    const mine = { host: conn.host, port: conn.port, project: conn.project, proto: PROTO_V2 };
    ls.on('message', (m) => {
      if (m && m.t === 'probe_result') {
        // account rules are checked again with the real account
        const code = !m.proto_ok ? 'protocol_version' : !m.project_ok ? 'project_unknown' : !m.token_ok ? 'token_invalid' : null;
        if (code) log(`Kiểm tra ${conn.host}:${conn.port}: LAN Hub từ chối (${code}).`);
        done(code && hubErrorText(code, { ...m, ...mine }));
      } else if (m && m.t === 'error') {
        log(`Kiểm tra ${conn.host}:${conn.port}: LAN Hub từ chối: ${typeof m.message === 'string' ? m.message : m.code}`);
        done(typeof m.message === 'string' ? m.message : hubErrorText(m.code, { ...m.data, ...mine }));
      }
    });
    ls.on('error', (e) => {
      log(`Kiểm tra ${conn.host}:${conn.port}: ${e.message}`);
      done(e.code === 'ECONNREFUSED' ? t('connect.error.refused', { host: conn.host, port: conn.port }) : t('connect.error.failed', { host: conn.host, port: conn.port }));
    });
  });
}

module.exports = { probe };
