'use strict';

// LAN discovery over UDP (docs/protocol.md): lanhub_discover gets lanhub_here with the hub's instanceId, junk gets
// nothing, replies are rate-limited, --no-discovery binds nothing, and a taken port leaves the TCP hub running.
// Every hub here gets its own free UDP port, never 8201, so test files can run in parallel.
const assert = require('assert');
const dgram = require('dgram');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const C = require('../../lib/common');
const { startHubProcess, probeWelcome } = require('../support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-disc-${n}-`));
const DISCOVER = JSON.stringify({ t: 'lanhub_discover', v: 2 });

function bindUdp(port) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', reject);
    s.bind(port, '0.0.0.0', () => resolve(s));
  });
}

async function freeUdpPort() {
  const s = await bindUdp(0);
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

// Sends each payload to 127.0.0.1:port and collects the replies that arrive within ms.
async function ask(port, payloads, ms = 500) {
  const s = await bindUdp(0);
  const replies = [];
  const sentAt = Date.now();
  s.on('message', (buf) => replies.push({ m: JSON.parse(buf.toString('utf8')), after: Date.now() - sentAt }));
  for (const p of payloads) s.send(p, port, '127.0.0.1');
  await sleep(ms);
  s.close();
  return replies;
}

test('lanhub_discover gets lanhub_here with the hub instanceId within 500 ms', async () => {
  const udp = await freeUdpPort();
  const hub = await startHubProcess({ root: tmp('on'), project: 'Demo', token: 'tk', discoveryPort: udp });
  try {
    const w = await probeWelcome(hub.port, { project: 'Demo', token: 'tk' });
    assert.ok(w.features.includes('discovery'));
    const replies = await ask(udp, [DISCOVER]);
    assert.strictEqual(replies.length, 1);
    const { m, after } = replies[0];
    assert.ok(after < 500, `reply after ${after} ms`);
    assert.strictEqual(m.t, 'lanhub_here');
    assert.strictEqual(m.instanceId, w.instanceId);
    assert.strictEqual(m.hubName, w.hubName);
    assert.strictEqual(m.port, hub.port);
    assert.strictEqual(m.tls, false);
    assert.ok(Array.isArray(m.projects) && m.projects.includes('Demo'));
    assert.ok(!JSON.stringify(m).includes('tk'), 'the token is never advertised');

    assert.deepStrictEqual(await ask(udp, ['not json', JSON.stringify({ t: 'other' }), '{"t":"lanhub_discover"'], 300), [], 'junk gets no reply');

    // 20 replies per second per source address: a burst of 60 straddles at most one second boundary. The wait
    // keeps the earlier request out of the burst's second, so at least 20 replies are due.
    await sleep(1000);
    const burst = await ask(udp, Array(60).fill(DISCOVER), 800);
    assert.ok(burst.length >= 20 && burst.length <= 40, `${burst.length} replies to a burst of 60`);
  } finally {
    await hub.stop();
  }
});

test('--no-discovery binds no UDP port', async () => {
  const udp = await freeUdpPort();
  const hub = await startHubProcess({ root: tmp('off'), project: 'Demo', args: ['--discovery-port', String(udp)] });
  try {
    const w = await probeWelcome(hub.port, { project: 'Demo' });
    assert.ok(!w.features.includes('discovery'));
    assert.deepStrictEqual(await ask(udp, [DISCOVER], 300), []);
    const s = await bindUdp(udp); // would fail with EADDRINUSE if the hub held it
    s.close();
  } finally {
    await hub.stop();
  }
});

test('a taken discovery port logs a warning and the TCP hub keeps serving', async () => {
  const holder = await bindUdp(0);
  holder.unref(); // if startHubProcess throws, the open socket must not keep the test process alive forever
  const udp = holder.address().port;
  const hub = await startHubProcess({ root: tmp('busy'), project: 'Demo', discoveryPort: udp });
  try {
    const w = await probeWelcome(hub.port, { project: 'Demo' });
    assert.ok(!w.features.includes('discovery'));
    assert.ok(hub.logs().some((l) => l.includes(String(udp))), `a log line names port ${udp}:\n${hub.logs().join('\n')}`);
    const sock = net.createConnection({ host: '127.0.0.1', port: hub.port });
    const ls = new C.LineSocket(sock);
    const pong = await new Promise((resolve) => {
      ls.on('message', (m) => {
        if (m.t === 'welcome') ls.send({ t: 'ping' });
        if (m.t === 'pong') resolve(m);
      });
      sock.on('connect', () => ls.send({ t: 'hello', proto: C.PROTO_V2, project: 'Demo', name: 'p', uid: 'p' }));
    });
    assert.strictEqual(pong.t, 'pong');
    ls.close();
  } finally {
    holder.close();
    await hub.stop();
  }
});
