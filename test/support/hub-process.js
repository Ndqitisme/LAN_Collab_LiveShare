'use strict';

// Starts a hub as a child process and talks to it only through its CLI, the protocol and its disk, so the
// same tests run against any hub binary: LANHUB_CMD="<command>" overrides the default Node hub.
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const C = require('../../lib/common');

const REPO = path.resolve(__dirname, '..', '..');
const STOP_TIMEOUT_MS = 10000;

function splitCommand(cmd) {
  const out = [];
  for (const m of cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function hubCommand() {
  if (process.env.LANHUB_CMD) return splitCommand(process.env.LANHUB_CMD);
  return [process.execPath, path.join(REPO, 'hub', 'hub.js')];
}

// opts: root, project, token, history, allowFile, exclude (array), discoveryPort, args (extra CLI arguments).
// opts.config (a lanhub.toml path) replaces root for a hub with the multi-project feature.
// Discovery is off unless discoveryPort is given, so parallel test files never fight over UDP 8201.
// Resolves to {port, root, pid, logs(), waitLog(re, ms), kill(), stop()}.
function startHubProcess(opts) {
  const [cmd, ...pre] = hubCommand();
  const source = opts.config ? ['--config', opts.config] : ['--root', opts.root];
  const args = [...pre, ...source, '--port', '0', '--log-format', 'json', '--stop-on-stdin-close'];
  if (opts.project) args.push('--project', opts.project);
  if (opts.token) args.push('--token', opts.token);
  if (opts.history) args.push('--history', opts.history);
  if (opts.allowFile) args.push('--allow-file', opts.allowFile);
  if (opts.exclude && opts.exclude.length) args.push('--exclude', opts.exclude.join(','));
  if (opts.discoveryPort) args.push('--discovery-port', String(opts.discoveryPort));
  else args.push('--no-discovery');
  if (opts.args) args.push(...opts.args);
  const child = spawn(cmd, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

  const tail = [];
  const watchers = new Set();
  const remember = (line) => {
    tail.push(line);
    if (tail.length > 40) tail.shift();
    for (const w of watchers) w(line);
  };
  let stopping = false;
  let onListening = null;
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      remember(line);
      if (onListening && line.startsWith('{')) {
        try {
          const m = JSON.parse(line);
          if (m.event === 'listening' && Number.isInteger(m.port)) onListening(m.port);
        } catch {
          // a human log line that happens to start with "{"
        }
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split('\n')) if (line.trim()) remember(line.trim());
  });

  const describe = ({ code, signal }) => `hub exited (code ${code}, signal ${signal})\n  ${tail.join('\n  ')}`;

  return new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`cannot start hub "${cmd}": ${e.message}`)));
    exited.then((how) => {
      if (onListening) reject(new Error(`${describe(how)}\n  (before it printed the listening line)`));
      else if (!stopping) {
        // The test's own waits would only time out much later with a misleading message.
        console.error(describe(how));
        process.exit(1);
      }
    });
    onListening = (port) => {
      onListening = null;
      resolve({
        port,
        root: opts.root,
        pid: child.pid,
        logs: () => [...tail],
        // Resolves with the first log line from now on that matches re, or rejects after ms.
        waitLog(re, ms = 5000) {
          return new Promise((res, rej) => {
            const w = (line) => {
              if (!re.test(line)) return;
              watchers.delete(w);
              clearTimeout(timer);
              res(line);
            };
            const timer = setTimeout(() => {
              watchers.delete(w);
              rej(new Error(`no log line matching ${re} within ${ms} ms:\n  ${tail.join('\n  ')}`));
            }, ms);
            watchers.add(w);
          });
        },
        // A forced kill (TerminateProcess on Windows, SIGKILL elsewhere): nothing is flushed.
        async kill() {
          stopping = true;
          child.kill('SIGKILL');
          await exited;
        },
        // Closing stdin asks the hub to write every pending file and exit 0.
        async stop() {
          stopping = true;
          child.stdin.end();
          const timer = setTimeout(() => child.kill(), STOP_TIMEOUT_MS);
          const how = await exited;
          clearTimeout(timer);
          if (how.code !== 0) throw new Error(`stop: ${describe(how)}`);
        },
      });
    };
  });
}

// Joins as a throwaway member and returns the hub's welcome message (files manifest, users, chat...).
function probeWelcome(port, hello = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    const ls = new C.LineSocket(sock);
    const timer = setTimeout(() => {
      ls.close();
      reject(new Error('probe: no welcome within 5 s'));
    }, 5000);
    sock.on('connect', () => ls.send({ t: 'hello', proto: C.PROTO_V2, name: 'probe', uid: `probe-${Math.random()}`, ...hello }));
    ls.on('error', () => {});
    ls.on('message', (m) => {
      if (m.t !== 'welcome' && m.t !== 'error') return;
      clearTimeout(timer);
      ls.close();
      if (m.t === 'welcome') resolve(m);
      else reject(new Error(`probe refused: ${m.message || m.code}`));
    });
    ls.on('close', () => {
      clearTimeout(timer);
      reject(new Error('probe: hub closed the connection'));
    });
  });
}

module.exports = { startHubProcess, probeWelcome };
