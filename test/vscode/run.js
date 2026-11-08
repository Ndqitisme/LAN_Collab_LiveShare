'use strict';

// Runs test/vscode/suite.js inside a real VS Code (separate temp profile) against a lanhub-cli child process
// (test/support/hub-process.js: the release build, or LANHUB_CMD).
// Usage: node test/vscode/run.js [--debug-port <n>] [path to Code.exe]
// --debug-port opens VS Code's DevTools endpoint so tools/cdp/ can screenshot or drive the test window.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startHubProcess, probeWelcome } = require('../support/hub-process');
const { encodeInviteV3 } = require('../../lib/common');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const debugAt = argv.indexOf('--debug-port');
const debugPort = debugAt >= 0 ? Number(argv.splice(debugAt, 2)[1]) : 0;
if (debugAt >= 0 && !(debugPort > 0)) throw new Error('--debug-port needs a port number');
const codeExe = argv[0]
  || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-collab-vscode-'));
  const dir = (name) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const hubRoot = dir('hub');
  const clientRoot = dir('client');
  const peerRoot = dir('peer');
  fs.writeFileSync(path.join(hubRoot, 'a.py'), 'def main():\n    return 1\n');
  fs.writeFileSync(path.join(hubRoot, 'crlf.py'), 'line1\r\nline2\r\n');
  fs.writeFileSync(path.join(hubRoot, 'bom.csv'), '﻿col1,col2\n1,2\n');

  const hub = await startHubProcess({ root: hubRoot, project: 'Demo', history: dir('history') });
  const settings = JSON.stringify({ 'lanCollab.server': `127.0.0.1:${hub.port}`, 'lanCollab.project': 'Demo', 'files.saveConflictResolution': 'overwriteFileOnDisk' }, null, 2);
  for (const r of [hubRoot, clientRoot]) {
    fs.mkdirSync(path.join(r, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(r, '.vscode', 'settings.json'), settings);
  }
  // The hub loaded its folder before settings.json existed there: restart it so it is part of the shared tree.
  await hub.stop();
  const hub2 = await startHubProcess({ root: hubRoot, port: hub.port, project: 'Demo', history: path.join(tmp, 'history') });

  const env = { ...process.env, LC_HUB_PORT: String(hub2.port), LC_PEER_ROOT: peerRoot, LC_HUB_ROOT: hubRoot, LAN_COLLAB_DEBUG: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const runVSCode = (suite, folder, profile) => new Promise((resolve) => {
    const args = [
      `--extensionDevelopmentPath=${ROOT}`,
      `--extensionTestsPath=${path.join(__dirname, suite)}`,
      `--user-data-dir=${dir(`user-data-${profile}`)}`,
      `--extensions-dir=${dir(`extensions-${profile}`)}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--new-window',
      ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []),
      folder,
    ];
    spawn(codeExe, args, { env, stdio: 'inherit' }).on('exit', (code) => resolve(code));
  });

  let code = await runVSCode('suite.js', clientRoot, 'a');
  console.log(code === 0 ? 'vscode suite: OK' : `vscode suite: LỖI (exit ${code})`);
  if (code === 0) {
    // A fresh machine: empty folder, no settings, only the invite code.
    const { instanceId } = await probeWelcome(hub2.port, { project: 'Demo' });
    env.LC_INVITE = encodeInviteV3({ instanceId, hosts: ['127.0.0.1'], port: hub2.port, project: 'Demo', token: '' });
    code = await runVSCode('join-suite.js', dir('newcomer'), 'b');
    console.log(code === 0 ? 'vscode join-suite: OK' : `vscode join-suite: LỖI (exit ${code})`);
  }
  await hub2.stop();
  process.exit(code === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
