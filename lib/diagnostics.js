'use strict';

// Finds the folder's LAN Hub and explains why it cannot when it fails (docs/plans/README.md section 5.7).
// resolve() is the connection path: it races every known address, falls back to UDP rediscovery by instanceId and
// pins the TLS fingerprint, and hands back a connected socket. runChecks() runs the same steps plus a probe, the
// folder and the round trip, and yields one result per step for the "Chẩn đoán kết nối" command.
// `env` injects sockets, UDP, interfaces, the clock and the file system, so tests run without a network.
const net = require('net');
const tls = require('tls');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LineSocket, PROTO_V2 } = require('./common');
const { actionsFor } = require('./connection-machine');
const { hubErrorText, folderHubId } = require('./client-core');
const { t } = require('./i18n');

const STEPS = ['config', 'addresses', 'discovery', 'network', 'tls', 'handshake', 'folder', 'rtt'];
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const JITTER = 0.2;
const NETWORK_CODES = ['refused', 'timeout', 'unreachable', 'failed'];
// When every address fails, the code that says the most about the hub machine wins: a refusal proves the machine
// answered, a timeout points at a firewall, unreachable at routing.
const FAILURE_ORDER = ['tls_mismatch', ...NETWORK_CODES];

function defaultEnv() {
  return {
    net,
    tls,
    dgram,
    fs,
    interfaces: () => os.networkInterfaces(),
    now: () => Date.now(),
    connectTimeoutMs: 3000,
    discoveryPort: 8201,
    discoveryWaitMs: 2000,
    probeTimeoutMs: 5000,
  };
}

class DiagError extends Error {
  constructor(code, data = {}, message = code) {
    super(message);
    this.code = code;
    this.data = data;
    this.fatal = code === 'tls_mismatch'; // a changed certificate is never retried or skipped
  }
}

// Delay before reconnect attempt `attempt` (0 = first after a drop): 1, 2, 5, 10, then 30 s, plus up to 20 percent.
function backoffDelay(attempt, random = Math.random) {
  return Math.round(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] * (1 + JITTER * random()));
}

function networkCode(err) {
  switch (err && err.code) {
    case 'tls_mismatch': return 'tls_mismatch';
    case 'ECONNREFUSED': return 'refused';
    case 'ETIMEDOUT': return 'timeout';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EADDRNOTAVAIL':
    case 'ENOTFOUND':
    case 'EAI_AGAIN': return 'unreachable';
    default: return 'failed';
  }
}

const fingerprintOf = (sock) => {
  const cert = sock.getPeerCertificate();
  return cert && cert.raw ? crypto.createHash('sha256').update(cert.raw).digest('hex') : '';
};

// One address. With a fingerprint the socket is TLS and host-name checking is replaced by an exact compare of the
// certificate's SHA-256, done before anything (the token) is written. Resolves {socket, host, port, ms}.
function connectOne(host, port, fingerprint, env) {
  return new Promise((resolve, reject) => {
    const started = env.now();
    const sock = fingerprint
      ? env.tls.connect({ host, port, rejectUnauthorized: false, servername: net.isIP(host) ? undefined : host })
      : env.net.createConnection({ host, port });
    let done = false;
    // Stays attached: an error between this race and the client core taking the socket must not go unhandled.
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!err) {
        resolve({ socket: sock, host, port, ms: env.now() - started });
        return;
      }
      sock.destroy();
      reject(err);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error(`no answer after ${env.connectTimeoutMs} ms`), { code: 'ETIMEDOUT' })), env.connectTimeoutMs);
    sock.on('error', finish);
    sock.once(fingerprint ? 'secureConnect' : 'connect', () => {
      if (!fingerprint) return finish(null);
      const got = fingerprintOf(sock);
      if (got === fingerprint) return finish(null);
      return finish(Object.assign(new Error(`certificate fingerprint ${got || 'none'}`), { code: 'tls_mismatch', fingerprint: got }));
    });
  });
}

// Every address at once; the first to connect wins and the others are closed. Rejects with a DiagError whose data
// lists each address's failure.
function race(hosts, port, fingerprint, env) {
  return new Promise((resolve, reject) => {
    if (!hosts.length) {
      reject(new DiagError('failed', { host: '', port, failures: [] }));
      return;
    }
    const failures = [];
    let won = false;
    for (const host of hosts) {
      connectOne(host, port, fingerprint, env).then((r) => {
        if (won) {
          r.socket.destroy();
          return;
        }
        won = true;
        resolve({ ...r, failures });
      }, (err) => {
        failures.push({ host, code: networkCode(err), error: err.code || '', message: err.message, fingerprint: err.fingerprint });
        if (won || failures.length < hosts.length) return;
        const code = FAILURE_ORDER.find((c) => failures.some((f) => f.code === c));
        const blamed = code === 'tls_mismatch' ? failures.find((f) => f.code === code).host : hosts[0];
        reject(new DiagError(code, {
          host: blamed,
          port,
          seconds: env.connectTimeoutMs / 1000,
          failures: failures.map(({ host: h, code: c, error }) => ({ host: h, code: c, error })),
          ...(code === 'tls_mismatch' ? { fingerprint: failures.find((f) => f.code === code).fingerprint } : {}),
        }, failures.map((f) => `${f.host}: ${f.message}`).join('; ')));
      });
    }
  });
}

const isIPv4 = (a) => a && (a.family === 'IPv4' || a.family === 4);

// Broadcast address of each IPv4 interface, plus the known addresses as unicast (protocol.md section 10): a hub
// on the same host or behind a router that drops broadcasts still answers those.
function discoveryTargets(interfaces, knownHosts) {
  const out = new Set();
  for (const a of Object.values(interfaces).flat()) {
    if (!isIPv4(a) || a.internal || !a.netmask) continue;
    const ip = a.address.split('.').map(Number);
    const mask = a.netmask.split('.').map(Number);
    out.add(ip.map((x, i) => x | (~mask[i] & 255)).join('.'));
  }
  for (const h of knownHosts) if (net.isIPv4(h)) out.add(h);
  return [...out];
}

// Resolves {hub: {hosts, port, tls, hubName} | null, sentTo, error} from the lanhub_here replies whose instanceId
// matches. A hub answers from each address a request reached (loopback and LAN on its own machine, every card of a
// multi-homed host), and its TCP side may listen on only one of them, so replies arriving within GATHER_MS of the
// first are kept and the caller races them all.
const GATHER_MS = 100;
function discover(instanceId, knownHosts, env) {
  return new Promise((resolve) => {
    const sentTo = discoveryTargets(env.interfaces(), knownHosts);
    const sock = env.dgram.createSocket('udp4');
    let hub = null;
    let done = false;
    const finish = (error = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        // already closed by its error
      }
      resolve({ hub, sentTo, error });
    };
    let timer = setTimeout(() => finish(), env.discoveryWaitMs);
    sock.on('error', (e) => finish(e.message));
    sock.on('message', (buf, from) => {
      let m;
      try {
        m = JSON.parse(buf.toString('utf8'));
      } catch {
        return;
      }
      if (!m || m.t !== 'lanhub_here' || m.instanceId !== instanceId || !Number.isInteger(m.port)) return;
      if (hub) {
        if (!hub.hosts.includes(from.address)) hub.hosts.push(from.address);
        return;
      }
      hub = { hosts: [from.address], port: m.port, tls: m.tls === true, hubName: typeof m.hubName === 'string' ? m.hubName : '' };
      clearTimeout(timer);
      timer = setTimeout(() => finish(), GATHER_MS);
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      const msg = Buffer.from(JSON.stringify({ t: 'lanhub_discover', v: 2 }));
      for (const addr of sentTo) sock.send(msg, env.discoveryPort, addr, () => {});
    });
  });
}

// target: {addresses, lastGood, port, tlsFingerprint, instanceId}. The address that reached live last goes first.
const knownHosts = (target) => [...new Set([target.lastGood, ...(target.addresses || [])].filter(Boolean))];

// The connection path. Resolves {socket, host, port, ms, via: 'race' | 'discovery'} or rejects with a DiagError
// whose code is a network code or tls_mismatch, with data.discovery telling whether rediscovery ran.
async function resolve(target, envIn = {}) {
  const env = { ...defaultEnv(), ...envIn };
  const hosts = knownHosts(target);
  let first;
  try {
    return { ...(await race(hosts, target.port, target.tlsFingerprint, env)), via: 'race' };
  } catch (err) {
    if (err.fatal || !target.instanceId) throw err;
    first = err;
  }
  const found = await discover(target.instanceId, hosts, env);
  first.data.discovery = { found: Boolean(found.hub), sentTo: found.sentTo, error: found.error };
  if (!found.hub) throw first;
  const r = await race(found.hub.hosts, found.hub.port, target.tlsFingerprint, env);
  return { ...r, via: 'discovery' };
}

// Sends one hello on a connected socket and resolves the hub's answer ({msg, ms}): probe_result, or error from a
// hub that refuses before probing (protocol 1 hubs, tls_required).
function exchange(socket, hello, env = defaultEnv()) {
  return new Promise((resolveExchange, reject) => {
    const ls = new LineSocket(socket);
    const started = env.now();
    let done = false;
    const finish = (err, msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolveExchange({ msg, ms: env.now() - started });
    };
    const timer = setTimeout(() => finish(new DiagError('no_reply')), env.probeTimeoutMs);
    ls.on('message', (m) => {
      if (m && (m.t === 'probe_result' || m.t === 'error')) finish(null, m);
    });
    ls.on('error', () => {}); // close follows
    ls.on('close', () => finish(new DiagError('closed')));
    ls.send(hello);
  });
}

function probeHello(target) {
  return { t: 'hello', probe: true, proto: PROTO_V2, project: target.project, token: target.token || '', name: target.name, account: target.account || null };
}

// The refusal a probe answer stands for, {code, data} or null. A field that is null was not checked because an
// earlier step failed (protocol.md 3.4), so the first false field in hub order decides. Join by code passes
// ignoreAccount: it probes before choosing an account and lets the real hello judge the account.
function probeProblem(m, ignoreAccount = false) {
  if (m.t === 'error') {
    const data = { ...(m.data || {}) };
    if (typeof m.message === 'string') data.message = m.message;
    return { code: typeof m.code === 'string' ? m.code : '', data };
  }
  if (m.proto_ok === false) return { code: 'protocol_version', data: { hubMin: m.hubMin, hubMax: m.hubMax } };
  if (m.project_ok === false) return { code: 'project_unknown', data: { projects: Array.isArray(m.projects) ? m.projects : [] } };
  if (m.token_ok === false) return { code: 'token_invalid', data: {} };
  if (m.account_ok === false && !ignoreAccount) {
    return m.account_error && typeof m.account_error.code === 'string'
      ? { code: m.account_error.code, data: m.account_error.data || {} }
      : { code: 'account_required', data: {} };
  }
  return null;
}

// Writable means a file can be created and removed; the *.lc-tmp name is never synced.
function checkWritable(folder, env) {
  const probe = path.join(folder, `.lan-collab-write-${crypto.randomBytes(4).toString('hex')}.lc-tmp`);
  try {
    env.fs.writeFileSync(probe, '');
    env.fs.rmSync(probe, { force: true });
    return null;
  } catch (e) {
    return e.code || e.message;
  }
}

// The sentence for a connection that stopped with this code: what failed and, when known, why. Shown in the
// needs_action toast and the status bar tooltip.
function problemText(code, d = {}) {
  switch (code) {
    case 'refused': return t('connect.error.refused', { host: d.host, port: d.port });
    case 'timeout': return t('connect.error.timeout', { host: d.host, port: d.port, seconds: d.seconds || 3 });
    case 'unreachable': return t('connect.error.unreachable', { host: d.host, port: d.port });
    case 'failed': return t('connect.error.failed', { host: d.host, port: d.port });
    case 'tls_mismatch': return t('connect.error.tls_mismatch', { host: d.host, port: d.port });
    case 'closed': return t('connect.error.closed', { host: d.host, port: d.port });
    case 'no_reply': return t('diag.remedy.no_reply', { host: d.host, port: d.port });
    case 'folder_readonly': return t('diag.remedy.folder_readonly', { path: d.path });
    case 'folder_other_project': return t('diag.remedy.folder_other_project', { path: d.path });
    default: return hubErrorText(code, d);
  }
}

// Guidance for a failed step: what to do next, from the catalog, and the action ids that do it.
function remedyText(code, d) {
  switch (code) {
    case 'no_folder': return t('connect.noFolder');
    case 'unbound': return t('diag.remedy.unbound');
    case 'refused': return t('diag.remedy.refused', { port: d.port });
    case 'timeout': return t('diag.remedy.timeout', { port: d.port, seconds: d.seconds || 3 });
    case 'unreachable': return t('diag.remedy.unreachable', { host: d.host });
    case 'failed': return t('connect.error.failed', { host: d.host, port: d.port });
    case 'not_found': return t('diag.remedy.not_found', { port: d.discoveryPort });
    case 'no_instance': return t('diag.remedy.no_instance');
    case 'tls_mismatch': return t('diag.remedy.tls_mismatch', { host: d.host, port: d.port });
    case 'no_reply': return t('diag.remedy.no_reply', { host: d.host, port: d.port });
    case 'closed': return t('connect.error.closed', { host: d.host, port: d.port });
    case 'folder_readonly': return t('diag.remedy.folder_readonly', { path: d.path });
    case 'folder_other_project': return t('diag.remedy.folder_other_project', { path: d.path });
    default: return typeof d.message === 'string' ? d.message : hubErrorText(code, d);
  }
}

function remedyFor(code, data) {
  return { text: remedyText(code, data), actions: actionsFor(code, data).filter((a) => a !== 'diagnose') };
}

// target: {folder, project, port, addresses, lastGood, instanceId, tlsFingerprint, token, name, account, rtt}, with
// folder null when no folder is open and project empty when the folder has no hub. Yields {step, status, code,
// data, remedy} for each of STEPS in order; status is ok, fixed, failed or skipped. A result with status fixed
// carries data {host, port}, the hub's new address, for the caller to store.
async function* runChecks(target, envIn = {}) {
  const env = { ...defaultEnv(), ...envIn };
  const result = (step, status, code = null, data = {}) => ({ step, status, code, data, remedy: code ? remedyFor(code, data) : null });
  const skipFrom = function* skip(step) {
    for (const s of STEPS.slice(STEPS.indexOf(step))) yield result(s, 'skipped');
  };

  if (!target || !target.folder || !target.project) {
    yield result('config', 'failed', target && target.folder ? 'unbound' : 'no_folder');
    yield* skipFrom('addresses');
    return;
  }
  const hosts = knownHosts(target);
  yield result('config', 'ok', null, { project: target.project, port: target.port, addresses: hosts, tls: Boolean(target.tlsFingerprint) });

  let conn = null;
  let mismatch = null;
  let failure = null;
  try {
    try {
      conn = await race(hosts, target.port, target.tlsFingerprint, env);
      yield result('addresses', 'ok', null, { host: conn.host, port: conn.port, ms: conn.ms, failures: conn.failures });
    } catch (err) {
      if (err.code === 'tls_mismatch') {
        mismatch = err;
        yield result('addresses', 'ok', null, { host: err.data.host, port: err.data.port, failures: err.data.failures });
      } else {
        failure = err;
        yield result('addresses', 'failed', err.code, err.data);
      }
    }

    if (conn || mismatch) yield result('discovery', 'skipped');
    else if (!target.instanceId) yield result('discovery', 'skipped', 'no_instance');
    else {
      const found = await discover(target.instanceId, hosts, env);
      const data = { sentTo: found.sentTo, error: found.error, discoveryPort: env.discoveryPort };
      if (!found.hub) yield result('discovery', 'failed', 'not_found', data);
      else {
        try {
          conn = await race(found.hub.hosts, found.hub.port, target.tlsFingerprint, env);
          yield result('discovery', 'fixed', null, { ...data, host: conn.host, port: conn.port, hubName: found.hub.hubName });
        } catch (err) {
          if (err.code === 'tls_mismatch') mismatch = err;
          else failure = err;
          yield result('discovery', 'failed', err.code, err.data);
        }
      }
    }

    if (!conn && !mismatch) {
      yield result('network', 'failed', failure.code, failure.data);
      yield* skipFrom('tls');
      return;
    }
    yield result('network', 'ok');

    if (mismatch) {
      yield result('tls', 'failed', 'tls_mismatch', { ...mismatch.data, expected: target.tlsFingerprint });
      yield* skipFrom('handshake');
      return;
    }
    yield target.tlsFingerprint ? result('tls', 'ok', null, { fingerprint: target.tlsFingerprint }) : result('tls', 'skipped');

    const where = { host: conn.host, port: conn.port, project: target.project, proto: PROTO_V2 };
    let reply;
    try {
      reply = await exchange(conn.socket, probeHello(target), env);
    } catch (err) {
      yield result('handshake', 'failed', err.code, where);
      yield* skipFrom('folder');
      return;
    }
    const problem = probeProblem(reply.msg);
    if (problem) {
      yield result('handshake', 'failed', problem.code, { ...problem.data, ...where });
      yield* skipFrom('folder');
      return;
    }
    const hub = reply.msg;
    yield result('handshake', 'ok', null, { hubName: hub.hubName, hubId: hub.hubId, instanceId: hub.instanceId, ms: reply.ms });

    const writeError = checkWritable(target.folder, env);
    const owner = folderHubId(target.folder);
    if (writeError) yield result('folder', 'failed', 'folder_readonly', { path: target.folder, error: writeError });
    else if (owner && hub.hubId && owner !== hub.hubId) yield result('folder', 'failed', 'folder_other_project', { path: target.folder, folderHubId: owner });
    else yield result('folder', 'ok', null, { path: target.folder });

    yield Number.isFinite(target.rtt)
      ? result('rtt', 'ok', null, { ms: target.rtt, source: 'live' })
      : result('rtt', 'ok', null, { ms: reply.ms, source: 'probe' });
  } finally {
    if (conn) conn.socket.destroy();
  }
}

module.exports = {
  STEPS, BACKOFF_MS, NETWORK_CODES, DiagError, defaultEnv, backoffDelay, networkCode, connectOne, race, discover,
  discoveryTargets, resolve, exchange, probeHello, probeProblem, checkWritable, problemText, remedyText, runChecks,
};
