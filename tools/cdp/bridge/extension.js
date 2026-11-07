'use strict';

// Dev-only helper extension loaded by tools/cdp/vscode.mjs as a second --extensionDevelopmentPath.
// Extension commands live in the extension host, which the workbench renderer reached over CDP cannot
// call, so the driver posts {id, args} here and this runs vscode.commands.executeCommand.
// The port and a random token go to <user-data-dir>/User/globalStorage/<this id>/bridge.json: environment
// variables set on Code.exe do not reach the extension host of a normal (non-test) window.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const vscode = require('vscode');

function activate(context) {
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/command' || req.headers['x-token'] !== token) return reply(403, { error: 'forbidden' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      try {
        const { id, args = [] } = JSON.parse(raw);
        const result = await vscode.commands.executeCommand(id, ...args);
        let value = null;
        try { value = result === undefined ? null : JSON.parse(JSON.stringify(result)); } catch { value = String(result); }
        reply(200, { ok: true, result: value });
      } catch (e) {
        reply(200, { ok: false, error: e && e.message ? e.message : String(e) });
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const dir = context.globalStorageUri.fsPath;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({ port: server.address().port, token, pid: process.pid }));
  });
  context.subscriptions.push({ dispose: () => server.close() });
}

module.exports = { activate, deactivate() {} };
