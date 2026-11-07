#!/usr/bin/env node
'use strict';

const net = require('net');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextOperation, diff } = require('../lib/ot');
const C = require('../lib/common');

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0fa3b1', '#f032e6', '#9a6324', '#808000', '#000075'];
const LOG_KEEP = 2000;
const FLUSH_MS = 500;
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const EDIT_NOTE_MS = 2 * 60 * 1000;
const CHAT_KEEP = 500;
const IMAGE_MAX = 4 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const FEATURES = ['chat-image'];
const HUB_VERSION = '0.1.1+proto2';
// Protocol 1 is the 0.1 extension, answered byte for byte as hub 0.1.1 did; protocol 2 is docs/protocol.md.
const PROTO_MIN = 1;
const PROTO_MAX = 2;
const DISCOVERY_PORT = 8201;
const DISCOVERY_MAX_REQUEST = 512;
const DISCOVERY_REPLIES_PER_SEC = 20;
const PREAUTH_MAX_LINE = 64 * 1024;
const HELLO_TIMEOUT_MS = 15000;
const UID_FORGET_MS = 60 * 60 * 1000;

// `id` is the project's hubId: clients key their sync state on it, so it never changes once written.
// `instance` is the hub's instanceId (discovery, invite v3), added next to it by the first protocol 2 hub.
function loadIdentity(root) {
  const file = path.join(root, '.lan-collab', 'hub.json');
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    // first start on this folder
  }
  if (saved.id && saved.instance) return { hubId: saved.id, instanceId: saved.instance };
  const next = { ...saved, id: saved.id || crypto.randomUUID(), instance: saved.instance || crypto.randomUUID() };
  if (!next.created) next.created = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return { hubId: next.id, instanceId: next.instance };
}

function startHub(opts) {
  const root = path.resolve(opts.root);
  fs.mkdirSync(root, { recursive: true });
  // History lives in the project's own .lan-collab folder (never synced).
  const historyDir = path.resolve(opts.history || path.join(root, '.lan-collab', 'history'));
  const project = opts.project || path.basename(root);
  const token = opts.token || '';
  const log = opts.log || ((...a) => console.log(new Date().toLocaleTimeString('vi-VN'), ...a));
  const legacyHistory = `${root}.history`; // location used by earlier versions, next to the project folder
  if (!opts.history && fs.existsSync(legacyHistory) && !fs.existsSync(historyDir)) {
    try {
      fs.mkdirSync(path.dirname(historyDir), { recursive: true });
      fs.renameSync(legacyHistory, historyDir);
      log(`Đã dời lịch sử ${legacyHistory} → ${historyDir}`);
    } catch (e) {
      log(`[CẢNH BÁO] không dời được ${legacyHistory} vào ${historyDir}: ${e.message} (vẫn dùng thư mục mới)`);
    }
  }
  const excludePatterns = [...C.DEFAULT_EXCLUDE, ...(opts.exclude || [])];
  const excluded = C.makeExcluder(excludePatterns);
  const { hubId, instanceId } = loadIdentity(root);
  const hubName = opts.name || os.hostname();
  let discovery = null;
  const session = crypto.randomBytes(6).toString('hex');
  const abs = (rel) => path.join(root, rel);

  // rel -> text: {kind, text, rev, log, logStart, timer} | blob: {kind, hash}
  const files = new Map();
  for (const [rel, file] of C.walk(root, excluded)) {
    const buf = fs.readFileSync(file);
    const f = fileFromBuffer(rel, buf);
    files.set(rel, f);
    if (f.kind === 'text' && f.text !== buf.toString('utf8')) f.timer = setTimeout(() => flush(rel), FLUSH_MS);
  }

  const chatFile = path.join(historyDir, 'chat.jsonl');
  const mediaDir = path.join(historyDir, 'chat-media'); // images are stored once here; messages carry only the id
  const chat = [];
  try {
    for (const line of fs.readFileSync(chatFile, 'utf8').split('\n').slice(-CHAT_KEEP - 1)) {
      try {
        if (line) chat.push(JSON.parse(line));
      } catch {
        // a torn last line after a crash
      }
    }
  } catch {
    // no chat yet
  }

  const clients = new Map();
  const lastSeq = new Map();
  const lastEditNote = new Map();
  const lastSnapshot = new Map();
  const activity = [];
  let colorIndex = 0;

  // Editors cannot hold mixed line endings, so the shared text of a file always uses one style
  // (the one most of its lines already use).
  function uniformEol(text) {
    return C.normalizeEol(text, C.dominantEol(text));
  }

  function fileFromBuffer(rel, buf) {
    if (C.classify(buf, rel) === 'text') return { kind: 'text', text: uniformEol(buf.toString('utf8')), rev: 0, log: [], logStart: 0, timer: null };
    return { kind: 'blob', hash: C.sha1(buf) };
  }

  function fileMsg(rel) {
    const f = files.get(rel);
    if (!f) return { t: 'file', path: rel, missing: true };
    if (f.kind === 'text') return { t: 'file', path: rel, kind: 'text', rev: f.rev, text: f.text };
    return { t: 'file', path: rel, kind: 'blob', hash: f.hash, b64: fs.readFileSync(abs(rel)).toString('base64') };
  }

  function snapshot(rel) {
    const src = abs(rel);
    if (!fs.existsSync(src)) return;
    const dst = path.join(historyDir, path.dirname(rel), `${path.basename(rel)}.${C.stamp()}`);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      lastSnapshot.set(rel, Date.now());
    } catch (e) {
      log(`[LỖI] không lưu được lịch sử ${rel}: ${e.message}`);
    }
  }

  function flush(rel) {
    const f = files.get(rel);
    if (!f || f.kind !== 'text') return;
    clearTimeout(f.timer);
    f.timer = null;
    if (Date.now() - (lastSnapshot.get(rel) || 0) > SNAPSHOT_EVERY_MS) snapshot(rel);
    try {
      C.writeFileAtomic(abs(rel), Buffer.from(f.text, 'utf8'));
    } catch (e) {
      log(`[LỖI] không ghi được ${rel}: ${e.message}`);
    }
  }

  function markDirty(rel) {
    const f = files.get(rel);
    if (!f.timer) f.timer = setTimeout(() => flush(rel), FLUSH_MS);
  }

  function flushAll() {
    for (const [rel, f] of files) if (f.timer) flush(rel);
  }

  function send(c, msg) {
    c.ls.send(msg);
  }

  function broadcast(msg, except) {
    for (const c of clients.values()) if (c !== except) c.ls.send(msg);
  }

  // v1 goes to protocol 1 clients, v2 to the others; a null message is not sent to that group.
  function broadcastByProto(v1, v2, except) {
    for (const c of clients.values()) {
      const msg = c.proto === 1 ? v1 : v2;
      if (c !== except && msg) c.ls.send(msg);
    }
  }

  // The 0.1 sentence of an activity, still sent to protocol 1 clients and written to the hub log.
  function v1ActivityText(a) {
    switch (a.kind) {
      case 'join': return `vào phòng (${a.addr})`;
      case 'leave': return 'rời phòng';
      case 'edit': return `đang sửa ${a.path}`;
      case 'edit_disk': return `đang sửa ${a.path} (AI/công cụ ngoài editor)`;
      case 'create': return `tạo ${a.path}`;
      case 'delete': return `xoá ${a.path}`;
      case 'debug_start': return `bắt đầu debug ${a.text}`;
      case 'debug_stop': return 'dừng debug';
      case 'status_set': return `đặt trạng thái: ${a.text}`;
      default: return 'xoá trạng thái';
    }
  }

  function addActivity(c, kind, fields) {
    const v2 = { ts: Date.now(), who: c.name, color: c.color, kind, ...fields };
    const v1 = { ts: v2.ts, who: v2.who, color: v2.color, text: v1ActivityText(v2) };
    activity.push({ v1, v2 });
    if (activity.length > 200) activity.splice(0, activity.length - 200);
    log(`${v1.who} ${v1.text}`);
    broadcastByProto({ t: 'activity', a: v1 }, { t: 'activity', a: v2 });
  }

  function noteEdit(c, rel, src) {
    const key = `${c.id}\n${rel}`;
    const now = Date.now();
    if (now - (lastEditNote.get(key) || 0) > EDIT_NOTE_MS) addActivity(c, src === 'disk' ? 'edit_disk' : 'edit', { path: rel });
    lastEditNote.set(key, now);
  }

  function v1Presence(p) {
    if (!p || p.rtt === undefined) return p;
    const { rtt, ...rest } = p;
    return rest;
  }

  function publicUser(c, proto) {
    const presence = proto === 1 ? v1Presence(c.presence) : c.presence;
    return { id: c.id, name: c.name, color: c.color, account: c.account, presence, status: c.status };
  }

  function applyOp(c, rel, f, op, rev, seq, src) {
    if (rev < f.logStart || rev > f.rev) return false;
    try {
      for (const s of f.log.slice(rev - f.logStart)) op = TextOperation.transform(op, s)[0];
    } catch {
      return false; // op does not fit the text at its rev: the caller asks the client to resync
    }
    if (op.baseLength !== f.text.length) return false;
    f.text = op.apply(f.text);
    f.log.push(op);
    f.rev += 1;
    if (f.log.length > LOG_KEEP) {
      const drop = f.log.length - LOG_KEEP / 2;
      f.log.splice(0, drop);
      f.logStart += drop;
    }
    if (seq !== undefined) lastSeq.set(`${c.uid}\n${rel}`, seq);
    markDirty(rel);
    broadcast({ t: 'op', path: rel, rev: f.rev - 1, op: op.ops, by: c.id }, c);
    noteEdit(c, rel, src);
    return true;
  }

  // Applied-op sequence numbers only matter to a client reconnecting with the same uid; a new extension
  // session uses a new uid, so the entries of a uid gone for an hour are dropped.
  function forgetUidLater(uid) {
    setTimeout(() => {
      if ([...clients.values()].some((o) => o.uid === uid)) return;
      const prefix = `${uid}\n`;
      for (const key of [...lastSeq.keys()]) if (key.startsWith(prefix)) lastSeq.delete(key);
    }, UID_FORGET_MS).unref();
  }

  const handlers = {
    get(c, m) {
      const rel = C.safeRel(m.path);
      if (rel) send(c, fileMsg(rel));
    },

    op(c, m) {
      const rel = C.safeRel(m.path);
      const f = rel && files.get(rel);
      if (!f || f.kind !== 'text') {
        send(c, { t: 'nack', path: m.path });
        return;
      }
      let op;
      try {
        op = TextOperation.fromJSON(m.op);
      } catch {
        send(c, { t: 'resync', path: rel });
        return;
      }
      if (!Number.isInteger(m.rev) || !applyOp(c, rel, f, op, m.rev, m.seq, m.src)) {
        send(c, { t: 'resync', path: rel });
        return;
      }
      send(c, { t: 'ack', path: rel, rev: f.rev });
    },

    create(c, m) {
      const rel = C.safeRel(m.path);
      // Always answer, so the client does not wait for a file the hub will not take.
      if (!rel || excluded(rel) || (m.kind === 'text' && typeof m.text !== 'string')) {
        send(c, { t: 'ignored', path: m.path, reason: rel && excluded(rel) ? 'excluded' : 'invalid' });
        return;
      }
      // Same path in another letter case = the same file on Windows (a case-only rename): retire the old name.
      const lower = rel.toLowerCase();
      for (const other of [...files.keys()]) {
        if (other === rel || other.toLowerCase() !== lower) continue;
        clearTimeout(files.get(other).timer);
        snapshot(other);
        files.delete(other);
        broadcast({ t: 'deleted', path: other, by: c.id }, c);
      }
      const text = m.kind === 'text' ? uniformEol(m.text) : null;
      const f = files.get(rel);
      if (f && f.kind === 'text' && m.kind === 'text') {
        // Someone else created it first: turn ours into an edit so both clients converge.
        if (f.text !== text) applyOp(c, rel, f, diff(f.text, text), f.rev, undefined, 'disk');
        send(c, fileMsg(rel));
        return;
      }
      const buf = m.kind === 'text' ? Buffer.from(text, 'utf8') : Buffer.from(String(m.b64 || ''), 'base64');
      if (f) {
        snapshot(rel);
        clearTimeout(f.timer);
      }
      try {
        C.writeFileAtomic(abs(rel), buf);
      } catch (e) {
        log(`[LỖI] không ghi được ${rel}: ${e.message}`);
        send(c, { t: 'ignored', path: rel, reason: 'write-failed' });
        return;
      }
      files.set(rel, m.kind === 'text'
        ? { kind: 'text', text, rev: 0, log: [], logStart: 0, timer: null }
        : { kind: 'blob', hash: C.sha1(buf) });
      const msg = fileMsg(rel);
      broadcast(msg);
      if (!f) addActivity(c, 'create', { path: rel });
    },

    put(c, m) {
      const rel = C.safeRel(m.path);
      if (!rel || excluded(rel)) {
        send(c, { t: 'ignored', path: m.path, reason: rel ? 'excluded' : 'invalid' });
        return;
      }
      const buf = Buffer.from(m.b64 || '', 'base64');
      const f = files.get(rel);
      if (f) {
        snapshot(rel);
        clearTimeout(f.timer);
      }
      try {
        C.writeFileAtomic(abs(rel), buf);
      } catch (e) {
        log(`[LỖI] không ghi được ${rel}: ${e.message}`);
        send(c, { t: 'ignored', path: rel, reason: 'write-failed' });
        return;
      }
      files.set(rel, { kind: 'blob', hash: C.sha1(buf) });
      send(c, { t: 'stored', path: rel, hash: files.get(rel).hash }); // the client may now treat this version as synced
      broadcast(fileMsg(rel), c);
      noteEdit(c, rel, 'disk');
    },

    delete(c, m) {
      const rel = C.safeRel(m.path);
      const f = rel && files.get(rel);
      if (!f) return;
      clearTimeout(f.timer);
      snapshot(rel);
      fs.rmSync(abs(rel), { force: true });
      files.delete(rel);
      broadcast({ t: 'deleted', path: rel, by: c.id }, c);
      addActivity(c, 'delete', { path: rel });
    },

    check(c, m) {
      const f = files.get(m.path);
      if (f && f.kind === 'text' && f.rev === m.rev && C.sha1(f.text) !== m.hash) {
        log(`[CẢNH BÁO] ${c.name} lệch nội dung ${m.path} ở rev ${m.rev} → đồng bộ lại`);
        send(c, { t: 'resync', path: m.path });
      }
    },

    presence(c, m) {
      const p = m.p && typeof m.p === 'object' ? m.p : {};
      const before = c.presence && c.presence.debug;
      const v1Before = JSON.stringify(v1Presence(c.presence));
      c.presence = {
        file: typeof p.file === 'string' ? p.file : null,
        sel: Array.isArray(p.sel) ? p.sel.slice(0, 20) : [],
        line: Number(p.line) || 0,
        debug: typeof p.debug === 'string' ? p.debug : null,
      };
      if (typeof p.rtt === 'number' && Number.isFinite(p.rtt) && p.rtt >= 0) c.presence.rtt = Math.round(p.rtt);
      const v1 = v1Presence(c.presence);
      // A protocol 2 client repeats its presence every 5 s to report its RTT; 0.1 members never see the RTT, so
      // they are not sent a copy identical to the last one.
      const v1Changed = c.presence.rtt === undefined || JSON.stringify(v1) !== v1Before;
      broadcastByProto(v1Changed ? { t: 'presence', id: c.id, p: v1 } : null, { t: 'presence', id: c.id, p: c.presence }, c);
      if ((before || null) !== c.presence.debug) {
        addActivity(c, c.presence.debug ? 'debug_start' : 'debug_stop', c.presence.debug ? { text: c.presence.debug } : {});
      }
    },

    status(c, m) {
      c.status = String(m.text || '').slice(0, 200);
      broadcast({ t: 'status', id: c.id, text: c.status }, c);
      addActivity(c, c.status ? 'status_set' : 'status_clear', c.status ? { text: c.status } : {});
    },

    chat(c, m) {
      const text = typeof m.text === 'string' ? m.text.trim().slice(0, 4000) : '';
      let image = null;
      if (m.image && typeof m.image === 'object') {
        image = saveImage(m.image);
        if (!image) {
          return send(c, c.proto === 1
            ? { t: 'chat_rejected', reason: `Ảnh không hợp lệ hoặc lớn hơn ${IMAGE_MAX / 1024 / 1024} MB.` }
            : { t: 'chat_rejected', code: 'image_invalid', data: { maxBytes: IMAGE_MAX } });
        }
      }
      if (!text && !image) return;
      const msg = { id: crypto.randomBytes(6).toString('hex'), ts: Date.now(), from: c.name, fromId: c.id, fromKey: c.key, color: c.color, account: c.account, text };
      if (image) msg.image = image;
      chat.push(msg);
      if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
      try {
        fs.mkdirSync(historyDir, { recursive: true });
        fs.appendFileSync(chatFile, `${JSON.stringify(msg)}\n`);
      } catch (e) {
        log(`[LỖI] không lưu được chat: ${e.message}`);
      }
      broadcast({ t: 'chat', msg });
    },

    media(c, m) {
      const id = typeof m.id === 'string' && /^[0-9a-f]{40}$/.test(m.id) ? m.id : null;
      const meta = id && chat.find((x) => x.image && x.image.id === id);
      let b64 = null;
      try {
        if (meta) b64 = fs.readFileSync(path.join(mediaDir, `${id}.${IMAGE_TYPES[meta.image.mime]}`)).toString('base64');
      } catch {
        // deleted from the server by hand
      }
      send(c, b64 ? { t: 'media', id, mime: meta.image.mime, b64 } : { t: 'media', id: String(m.id || '').slice(0, 40), missing: true });
    },

    ping(c) {
      send(c, pong(c));
    },
  };

  // Returns the image's metadata for the chat message, or null when it is not an accepted image.
  function saveImage(img) {
    const ext = IMAGE_TYPES[img.mime];
    if (!ext || typeof img.b64 !== 'string' || img.b64.length > Math.ceil(IMAGE_MAX / 3) * 4) return null;
    const buf = Buffer.from(img.b64, 'base64');
    if (!buf.length || buf.length > IMAGE_MAX) return null;
    const id = C.sha1(buf);
    const file = path.join(mediaDir, `${id}.${ext}`);
    try {
      if (!fs.existsSync(file)) {
        fs.mkdirSync(mediaDir, { recursive: true });
        fs.writeFileSync(file, buf);
      }
    } catch (e) {
      log(`[LỖI] không lưu được ảnh chat: ${e.message}`);
      return null;
    }
    const dim = (v) => (Number.isInteger(v) && v > 0 && v < 100000 ? v : 0);
    return { id, mime: img.mime, size: buf.length, w: dim(img.w), h: dim(img.h) };
  }

  function pong(c) {
    return c.proto === 1 ? { t: 'pong' } : { t: 'pong', ts: Date.now() };
  }

  // allowed-accounts file: one account per line, "github:<user>", "microsoft:<email>" or just the name;
  // "#" starts a comment. Missing or empty file = everyone with the token may join. Re-read on every join.
  function accountRefusal(account) {
    if (!opts.allowFile) return null;
    let lines = [];
    try {
      lines = fs.readFileSync(opts.allowFile, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim().toLowerCase()).filter(Boolean);
    } catch {
      return null;
    }
    if (!lines.length) return null;
    if (!account) return { code: 'account_required', data: {} };
    const full = `${account.provider}:${account.label}`;
    if (lines.includes(full.toLowerCase()) || lines.includes(account.label.toLowerCase())) return null;
    return { code: 'account_denied', data: { account: full, entry: full, file: path.basename(opts.allowFile) } };
  }

  // The 0.1 refusal text: sent to protocol 1 clients, and written to the hub log for every client.
  function refusalText({ code, data }, m, hubProto) {
    switch (code) {
      case 'protocol_version': return `Phiên bản giao thức khác hub (máy: ${m.proto}, hub: ${hubProto}) — cập nhật extension.`;
      case 'token_invalid': return 'Sai lanCollab.token.';
      case 'project_unknown': return `Hub này phục vụ dự án "${project}", máy đang mở "${m.project}".`;
      case 'account_required':
        return 'Hub chỉ cho các tài khoản trong danh sách vào. Đăng nhập GitHub hoặc Microsoft trong VS Code (biểu tượng tài khoản ở góc dưới bên trái), rồi chạy lệnh "LAN Collab: Dùng tài khoản VS Code".';
      default: return `Tài khoản ${data.account} chưa được phép vào. Nhờ người quản lý hub thêm dòng "${data.entry}" vào ${data.file}.`;
    }
  }

  // Protocol 2 checks in this order, each step only when the ones before it passed: a token belongs to a project.
  function helloSteps(m, account) {
    const r = { proto_ok: m.proto === 2, project_ok: null, token_ok: null, account_ok: null, refusal: null };
    if (!r.proto_ok) {
      r.refusal = { code: 'protocol_version', data: { hubMin: PROTO_MIN, hubMax: PROTO_MAX } };
      return r;
    }
    r.project_ok = String(m.project || '').toLowerCase() === project.toLowerCase();
    if (!r.project_ok) {
      r.refusal = { code: 'project_unknown', data: { projects: [project] } };
      return r;
    }
    r.token_ok = !token || m.token === token;
    if (!r.token_ok) {
      r.refusal = { code: 'token_invalid', data: {} };
      return r;
    }
    r.refusal = accountRefusal(account);
    r.account_ok = !r.refusal;
    return r;
  }

  function probeResult(r) {
    const msg = {
      t: 'probe_result',
      proto_ok: r.proto_ok,
      project_ok: r.project_ok,
      token_ok: r.token_ok,
      account_ok: r.account_ok,
      projects: [project],
      hubId: r.project_ok ? hubId : null,
      hubName,
      instanceId,
      hubMin: PROTO_MIN,
      hubMax: PROTO_MAX,
    };
    if (r.account_ok === false) msg.account_error = r.refusal;
    return msg;
  }

  function features() {
    return discovery ? [...FEATURES, 'discovery'] : FEATURES;
  }

  function welcome(c) {
    const manifest = {};
    for (const [rel, f] of files) {
      manifest[rel] = f.kind === 'text' ? { kind: 'text', rev: f.rev, hash: C.sha1(f.text) } : { kind: 'blob', rev: 0, hash: f.hash };
    }
    const applied = {};
    const prefix = `${c.uid}\n`;
    for (const [key, seq] of lastSeq) if (key.startsWith(prefix)) applied[key.slice(prefix.length)] = seq;
    const msg = {
      t: 'welcome',
      id: c.id,
      color: c.color,
      hubId,
      session,
      project,
      files: manifest,
      applied,
      users: [...clients.values()].filter((o) => o !== c).map((o) => publicUser(o, c.proto)),
      activity: activity.slice(-60).map((a) => (c.proto === 1 ? a.v1 : a.v2)),
      features: FEATURES,
      key: c.key,
      exclude: excludePatterns, // clients skip these too, so nobody offers files the hub will refuse
      chat: chat.slice(-200),
    };
    if (c.proto !== 1) Object.assign(msg, { features: features(), proto: 2, instanceId, hubName, hubVersion: HUB_VERSION });
    send(c, msg);
  }

  const server = net.createServer((sock) => {
    const ls = new C.LineSocket(sock);
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 10000);
    let me = null;
    // Until the hello is accepted, nobody may hold the connection open or make the hub buffer much.
    ls.maxLine = PREAUTH_MAX_LINE;
    const helloTimer = setTimeout(() => {
      if (!me) ls.close();
    }, HELLO_TIMEOUT_MS);
    let lastKeepAlive = 0;
    ls.on('partial', () => {
      // A big upload keeps the client's own messages (and our pongs) waiting: show it the link is alive.
      if (me && Date.now() - lastKeepAlive > 5000) {
        lastKeepAlive = Date.now();
        send(me, pong(me));
      }
    });
    ls.on('error', () => {});
    ls.on('message', (m) => {
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') {
        if (!me) ls.close();
        return;
      }
      if (!me) {
        if (m.t !== 'hello') return ls.close();
        const a = m.account && typeof m.account === 'object' ? m.account : null;
        const account = a && typeof a.label === 'string' && a.label
          ? { provider: String(a.provider || '').slice(0, 20), label: a.label.slice(0, 100) }
          : null;
        const refused = (refusal, hubProto) => log(`Từ chối ${sock.remoteAddress}${account ? ` (${account.provider}:${account.label})` : ''}: ${refusalText(refusal, m, hubProto)}`);
        const proto = Number.isInteger(m.proto) && m.proto >= 2 ? 2 : 1;
        if (proto === 2) {
          const steps = helloSteps(m, account);
          if (m.probe) {
            // "Join by code" checks the code first; it is not a member of the room.
            ls.send(probeResult(steps));
            sock.end();
            return;
          }
          if (steps.refusal) {
            refused(steps.refusal, `${PROTO_MIN}-${PROTO_MAX}`);
            ls.send({ t: 'error', code: steps.refusal.code, data: steps.refusal.data });
            sock.end();
            return;
          }
        } else {
          let refusal = null;
          if (m.proto !== C.PROTO) refusal = { code: 'protocol_version' };
          else if (token && m.token !== token) refusal = { code: 'token_invalid' };
          else if (String(m.project || '').toLowerCase() !== project.toLowerCase()) refusal = { code: 'project_unknown' };
          else refusal = accountRefusal(account);
          if (!refusal && m.probe) {
            ls.send({ t: 'probe-ok' });
            sock.end();
            return;
          }
          if (refusal) {
            refused(refusal, C.PROTO);
            ls.send({ t: 'error', message: refusalText(refusal, m, C.PROTO), code: refusal.code.startsWith('account_') ? 'account' : '' });
            sock.end();
            return;
          }
        }
        me = {
          id: crypto.randomBytes(4).toString('hex'),
          uid: String(m.uid || ''),
          // Marks one's own chat messages across reconnects and restarts without revealing the device id.
          key: C.sha1(`chat:${m.device || m.uid || crypto.randomUUID()}`).slice(0, 16),
          name: String(m.name || (account && account.label) || 'ẩn danh').slice(0, 60),
          account,
          color: COLORS[colorIndex++ % COLORS.length],
          presence: null,
          status: '',
          proto,
          ls,
        };
        clearTimeout(helloTimer);
        ls.maxLine = C.MAX_LINE;
        clients.set(me.id, me);
        welcome(me);
        broadcast({ t: 'joined', user: publicUser(me, 2) }, me);
        addActivity(me, 'join', { addr: sock.remoteAddress });
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(handlers, m.t)) return;
      const h = handlers[m.t];
      try {
        h(me, m);
      } catch (e) {
        log(`[LỖI] xử lý "${m.t}" từ ${me.name}: ${e.stack || e}`);
      }
    });
    ls.on('close', () => {
      clearTimeout(helloTimer);
      if (!me) return;
      clients.delete(me.id);
      forgetUidLater(me.uid);
      broadcast({ t: 'left', id: me.id });
      addActivity(me, 'leave', {});
    });
  });

  // Answers "is there a hub here" on UDP, so a client finds the hub again after its address changed. Resolves once
  // the socket is bound or has failed: a hub whose discovery port is taken still serves TCP.
  function startDiscovery(udpPort, tcpPort) {
    return new Promise((resolve) => {
      const sock = dgram.createSocket('udp4');
      const replies = new Map(); // source address -> replies sent in the current second
      let second = 0;
      sock.on('error', (e) => {
        log(`[CẢNH BÁO] không mở được cổng UDP ${udpPort} để máy khác tự tìm thấy hub: ${e.message}. Hub vẫn chạy; máy khác vào bằng mã mời.`);
        sock.close();
        discovery = null;
        resolve();
      });
      sock.on('message', (buf, from) => {
        if (buf.length > DISCOVERY_MAX_REQUEST) return;
        let m;
        try {
          m = JSON.parse(buf.toString('utf8'));
        } catch {
          return;
        }
        if (!m || m.t !== 'lanhub_discover') return;
        const now = Math.floor(Date.now() / 1000);
        if (now !== second) {
          second = now;
          replies.clear();
        }
        const n = (replies.get(from.address) || 0) + 1;
        replies.set(from.address, n);
        if (n > DISCOVERY_REPLIES_PER_SEC) return;
        const reply = { t: 'lanhub_here', v: 2, instanceId, hubName, port: tcpPort, tls: false, projects: [project] };
        sock.send(JSON.stringify(reply), from.port, from.address);
      });
      // Broadcasts reach only a socket bound to every interface, whatever --host the TCP side uses.
      sock.bind(udpPort, '0.0.0.0', () => {
        discovery = sock;
        log(`Cho máy khác tự tìm hub: UDP cổng ${udpPort}`);
        resolve();
      });
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8200, opts.host || '0.0.0.0', async () => {
      const { port } = server.address();
      log(`LAN Collab hub — dự án "${project}" — thư mục ${root} — cổng ${port} — ${files.size} file`);
      if (opts.allowFile) log(`Danh sách tài khoản được vào: ${opts.allowFile} (trống hoặc không có file = ai có token cũng vào được)`);
      const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
      for (const ip of ips) log(`Mã mời (${ip}): ${C.encodeInvite({ host: ip, port, project, token })}`);
      if (ips.length) log(`Mã mời: ${C.encodeInviteV3({ instanceId, hosts: ips, port, project, token })}`);
      if (opts.discoveryPort !== undefined && opts.discoveryPort !== null) await startDiscovery(opts.discoveryPort, port);
      resolve({
        port,
        files,
        flushAll,
        close() {
          flushAll();
          for (const c of clients.values()) c.ls.close();
          if (discovery) discovery.close();
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    const next = argv[i + 1];
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (next === undefined || next.startsWith('--')) out[m[1]] = true;
    else out[m[1]] = argv[++i];
  }
  return out;
}

if (require.main === module) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.root) {
    console.error('Dùng: node hub.js --root <thư mục dự án trên server> [--port 8200] [--project TÊN] [--token BÍ_MẬT] [--history DIR] [--allow-file FILE] [--exclude "a,b"] [--name TÊN_HUB] [--discovery-port 8201] [--no-discovery]');
    process.exit(1);
  }
  startHub({
    root: a.root,
    port: a.port ? Number(a.port) : 8200,
    host: a.host,
    project: a.project,
    token: a.token || process.env.LAN_COLLAB_TOKEN,
    history: a.history,
    allowFile: a['allow-file'],
    exclude: a.exclude ? a.exclude.split(',') : [],
    name: a.name,
    discoveryPort: a['no-discovery'] ? null : Number(a['discovery-port'] || DISCOVERY_PORT),
  }).then((hub) => {
    if (a['log-format'] === 'json') console.log(JSON.stringify({ event: 'listening', port: hub.port }));
    const stop = () => {
      hub.flushAll();
      process.exit(0);
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, stop);
    // A parent on Windows cannot send a catchable SIGINT, so closing our stdin is its graceful stop.
    if (a['stop-on-stdin-close']) {
      process.stdin.on('end', stop);
      process.stdin.resume();
    }
    // A bug in one message handler must not take the shared text of everyone down with it.
    process.on('uncaughtException', (e) => {
      console.error(`[LỖI] ${e.stack || e}`);
      hub.flushAll();
    });
  }, (e) => {
    console.error(`Không mở được hub: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { startHub };
