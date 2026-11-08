'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const PROTO_V2 = 2;
const MAX_TEXT = 1024 * 1024;
// Longest accepted message. Files travel as base64 inside one message, and V8 strings stop at ~512M characters.
const MAX_LINE = 400 * 1024 * 1024;
const BLOB_EXT = new Set([
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.docx', '.doc', '.pptx', '.ppt', '.pdf', '.png', '.jpg', '.jpeg', '.gif',
  '.bmp', '.ico', '.zip', '.7z', '.rar', '.gz', '.exe', '.dll', '.pyd', '.so', '.db', '.sqlite', '.vsix',
]);

// Never synced: VCS data, per-machine environments and caches, editor lock files, our own state.
const DEFAULT_EXCLUDE = [
  '.git', '.lan-collab', '.venv', 'venv', 'node_modules', '__pycache__', '*.pyc', '*.lc-tmp',
  '~$*', '.DS_Store', 'Thumbs.db',
];

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

// A path is excluded when it, or any folder above it, matches a pattern. Patterns without "/" match at any depth.
function makeExcluder(patterns) {
  const res = patterns
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''))
    .map((p) => globToRe(p.includes('/') ? p : `**/${p}`));
  return (rel) => {
    let cur = '';
    for (const part of rel.split('/')) {
      cur = cur ? `${cur}/${part}` : part;
      if (res.some((r) => r.test(cur))) return true;
    }
    return false;
  };
}

function sha1(data) {
  return crypto.createHash('sha1').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex');
}

// 'text' only when the bytes survive a UTF-8 round trip, so syncing them as a JS string never alters the file.
function classify(buf, rel) {
  if (BLOB_EXT.has(path.extname(rel).toLowerCase())) return 'blob';
  if (buf.length > MAX_TEXT || buf.includes(0)) return 'blob';
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf) ? 'text' : 'blob';
}

function normalizeEol(text, eol) {
  if (!text.includes('\n')) return text;
  return eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
}

function dominantEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

// Windows resolves several spellings to the same file: 8.3 short names ("GIT~1" = ".git"), trailing dots and
// spaces (".git." = ".git"), "name:stream" (an alternate data stream) and device names. A path from another
// machine using any of them could reach a folder the exclude list protects, so they are never accepted.
const UNSAFE_SEGMENT = /^(?:\.{1,2}|.*[<>:"|?*\x00-\x1f].*|.*[. ]|[^~]{1,6}~\d+(?:\.[^.]{0,3})?|(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?)$/i;

function safeRel(p) {
  if (typeof p !== 'string' || !p) return null;
  const rel = p.replace(/\\/g, '/');
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return null;
  if (rel.split('/').some((s) => s === '' || UNSAFE_SEGMENT.test(s))) return null;
  return rel;
}

// Map rel -> absolute path of every non-excluded file under root/relDir.
function walk(root, excluded, relDir = '') {
  const out = new Map();
  const rec = (rel) => {
    let ents;
    try {
      ents = fs.readdirSync(rel ? path.join(root, rel) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of ents) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (excluded(r) || !safeRel(r)) continue;
      if (d.isDirectory()) rec(r);
      else if (d.isFile()) out.set(r, path.join(root, r));
    }
  };
  rec(relDir);
  return out;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Newline-delimited JSON over a TCP socket.
class LineSocket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.parts = [];
    this.pending = 0; // characters buffered for the line not yet complete
    this.maxLine = MAX_LINE;
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      let start = 0;
      let i;
      while ((i = chunk.indexOf('\n', start)) >= 0) {
        this.parts.push(chunk.slice(start, i));
        const line = this.parts.join('');
        this.parts = [];
        this.pending = 0;
        start = i + 1;
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this.emit('bad', line.slice(0, 200));
          continue;
        }
        this.emit('message', msg);
      }
      if (start < chunk.length) {
        this.parts.push(chunk.slice(start));
        this.pending += chunk.length - start;
        if (this.pending > this.maxLine) {
          this.emit('bad', `message over ${this.maxLine} characters`);
          this.close();
          return;
        }
        // A large file is still arriving: the link is alive even though no message has completed.
        this.emit('partial');
      }
    });
    sock.on('close', () => this.emit('close'));
    sock.on('error', (e) => this.emit('error', e));
  }

  send(obj) {
    if (!this.sock.destroyed && this.sock.writable) this.sock.write(`${JSON.stringify(obj)}\n`);
  }

  close() {
    this.sock.destroy();
  }
}

// Invite code v3 (docs/protocol.md): "LC3-" + base64url of JSON {v:3, i, a, p, n, t, f?}. It carries every address
// of the hub, so a client can try them all, and the hub's instanceId, so it can find the hub again by discovery.
function encodeInviteV3({ instanceId, hosts, port, project, token, fingerprint }) {
  const j = { v: 3, i: instanceId, a: hosts, p: port, n: project, t: token || '' };
  if (fingerprint) j.f = fingerprint;
  return `LC3-${Buffer.from(JSON.stringify(j), 'utf8').toString('base64url')}`;
}

function decodeInviteV3(code) {
  const m = /^LC3-([A-Za-z0-9_-]+)$/.exec(String(code || '').replace(/\s+/g, ''));
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!j || j.v !== 3 || typeof j.i !== 'string' || !j.i) return null;
  if (!Array.isArray(j.a) || !j.a.length || !j.a.every((h) => typeof h === 'string' && h)) return null;
  if (!Number.isInteger(j.p) || j.p < 1 || j.p > 65535 || typeof j.n !== 'string' || !j.n) return null;
  if (j.t !== undefined && typeof j.t !== 'string') return null;
  if (j.f !== undefined && !(typeof j.f === 'string' && /^[0-9a-f]{64}$/.test(j.f))) return null;
  const out = { instanceId: j.i, hosts: j.a, port: j.p, project: j.n, token: j.t || '' };
  if (j.f) out.fingerprint = j.f;
  return out;
}

module.exports = {
  PROTO_V2, MAX_LINE, DEFAULT_EXCLUDE, makeExcluder, sha1, classify, safeRel, walk, stamp,
  LineSocket, normalizeEol, dominantEol, encodeInviteV3, decodeInviteV3,
};
