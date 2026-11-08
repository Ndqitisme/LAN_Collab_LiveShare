'use strict';

// The HTTP diagnosis page (docs/protocol.md section 13.2): a
// connection that opens with an HTTP request line gets one HTML page with the hub name, version and advertised
// projects, then the hub closes it. A browser at http://<ip>:<port>/ tells a network fault from an extension fault.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const { startHubProcess, probeWelcome } = require('../support/hub-process');

const TOKEN = 'secret-token-5521';
let hub;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-collab-http-'));
  hub = await startHubProcess({ root, project: 'Demo', token: TOKEN, args: ['--name', 'Phòng thử'] });
});

after(async () => {
  if (hub) await hub.stop();
});

function request(port, raw) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    const chunks = [];
    sock.on('connect', () => sock.write(raw));
    sock.on('data', (d) => chunks.push(d));
    sock.on('error', reject);
    sock.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

test('GET / returns 200 with an HTML page naming the hub and its projects, then closes', async () => {
  const res = await request(hub.port, 'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
  const [head, body] = res.split('\r\n\r\n');
  assert.match(head, /^HTTP\/1\.1 200 OK\r\n/);
  assert.match(head, /\r\nContent-Type: text\/html; charset=utf-8/);
  assert.strictEqual(Number(/\r\nContent-Length: (\d+)/.exec(head)[1]), Buffer.byteLength(body));
  assert.match(body, /^<!doctype html>/);
  assert.ok(body.includes('Phòng thử'), 'hub name');
  assert.ok(body.includes('<li>Demo</li>'), 'advertised project');
  assert.ok(!res.includes(TOKEN), 'never the token');
  assert.ok(!res.includes(hub.root), 'never the folder');
});

test('any path gets the same page and the protocol still works on the port', async () => {
  // The uptime row may tick between the two requests.
  const page = async (line) => (await request(hub.port, `${line}\r\n\r\n`)).split('\r\n\r\n')[1].replace(/<dd>[^<]*phút<\/dd>/, '');
  const a = await page('GET / HTTP/1.1');
  const b = await page('GET /../../etc/passwd HTTP/1.1');
  assert.strictEqual(b, a);
  const w = await probeWelcome(hub.port, { project: 'Demo', token: TOKEN });
  assert.strictEqual(w.t, 'welcome');
});
