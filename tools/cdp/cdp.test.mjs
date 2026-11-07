// node --test tools/cdp/cdp.test.mjs — drives headless Edge through cdp.mjs on a local page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { CDP, listTargets, waitFor } from './cdp.mjs';
import { killTree } from './vscode.mjs';
import { record, mediaDuration } from './record.mjs';

const EDGE = [
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((p) => fs.existsSync(p));

const PAGE = `<!doctype html><meta charset="utf-8"><title>cdp test</title>
<button id="b" style="position:absolute;left:400px;top:40px;width:120px;height:40px">go</button>
<p id="out">idle</p><input id="i"><p id="keys"></p>
<script>
  document.getElementById('b').addEventListener('click', () => { document.getElementById('out').textContent = 'clicked'; });
  document.getElementById('i').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('keys').textContent = 'enter:' + e.target.value; });
  setInterval(() => { document.title = String(Date.now()); document.body.style.background = document.body.style.background ? '' : '#eee'; }, 100);
</script>`;

let server;
let edge;
let profile;
let cdp;
let page;

test.before(async () => {
  assert.ok(EDGE, 'Microsoft Edge not found at its standard install paths');
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-cdp-edge-'));
  edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--window-size=800,600', `http://127.0.0.1:${server.address().port}/`], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const port = await waitFor(() => fs.existsSync(portFile) && Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]), { what: 'DevToolsActivePort' });
  const target = await waitFor(async () => (await listTargets(port)).find((t) => t.type === 'page' && t.url.startsWith('http')), { what: 'page target' });
  cdp = await CDP.connectPort(port);
  page = await cdp.attach(target.id);
  await page.send('Page.enable');
  await page.waitFor('document.readyState === "complete"');
});

test.after(async () => {
  if (cdp) cdp.close();
  if (edge) killTree(edge.pid, profile);
  if (server) server.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* locked */ }
});

test('click by selector changes the DOM', async () => {
  assert.equal(await page.evaluate(() => document.getElementById('out').textContent), 'idle');
  await page.click('#b');
  assert.equal(await page.waitFor(`document.getElementById('out').textContent === 'clicked' && 'ok'`, { timeout: 3000 }), 'ok');
});

test('type inserts text into the focused input and press sends a real key event', async () => {
  await page.click('#i');
  await page.type('xin chào');
  await page.press('Enter');
  assert.equal(await page.waitFor(`document.getElementById('keys').textContent`, { timeout: 3000 }), 'enter:xin chào');
});

test('evaluate passes arguments and surfaces page exceptions', async () => {
  assert.equal(await page.evaluate((a, b) => a + b, [2, 3]), 5);
  await assert.rejects(page.evaluate('nope.x'), /evaluate failed: ReferenceError/);
});

test('screenshot writes a PNG', async () => {
  const file = path.join(profile, 'shot.png');
  const buf = await page.screenshot(file);
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.ok(fs.statSync(file).size > 1000);
});

test('screencast recording encodes an mp4 that lasts as long as the recording', async () => {
  const out = path.join(profile, 'rec.mp4');
  const r = await record(page, { seconds: 2, out });
  assert.ok(r.frames > 1, `only ${r.frames} frames`);
  const dur = mediaDuration(out);
  assert.ok(dur >= 1.8 && dur <= 2.6, `duration ${dur}`);
});

test('a dead target rejects pending and later calls with a clear error', async () => {
  const c = await CDP.connect((await listTargets(cdp.ws.url.match(/:(\d+)\//)[1])).find((t) => t.type === 'page').webSocketDebuggerUrl);
  const pending = c.send('Runtime.evaluate', { expression: 'new Promise(() => {})', awaitPromise: true });
  c.ws.close();
  await assert.rejects(pending, /DevTools connection closed.*Runtime\.evaluate/);
  await assert.rejects(c.send('Runtime.evaluate', { expression: '1' }), /DevTools connection closed/);
});
