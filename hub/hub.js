#!/usr/bin/env node
'use strict';

const net = require('net');
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
const PREAUTH_MAX_LINE = 64 * 1024;
const HELLO_TIMEOUT_MS = 15000;
const UID_FORGET_MS = 60 * 60 * 1000;

function loadHubId(root) {
  const file = path.join(root, '.lan-collab', 'hub.json');
  try {
    const { id } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (id) return id;
  } catch {
    // first start on this folder
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id, created: new Date().toISOString() }, null, 2));
  return id;
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
  const hubId = loadHubId(root);
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

  function addActivity(who, color, text) {
    const a = { ts: Date.now(), who, color, text };
    activity.push(a);
    if (activity.length > 200) activity.splice(0, activity.length - 200);
    log(`${who} ${text}`);
    broadcast({ t: 'activity', a });
  }

  function noteEdit(c, rel, src) {
    const key = `${c.id}\n${rel}`;
    const now = Date.now();
    if (now - (lastEditNote.get(key) || 0) > EDIT_NOTE_MS) {
      addActivity(c.name, c.color, `đang sửa ${rel}${src === 'disk' ? ' (AI/công cụ ngoài editor)' : ''}`);
    }
    lastEditNote.set(key, now);
  }

  function publicUser(c) {
    return { id: c.id, name: c.name, color: c.color, account: c.account, presence: c.presence, status: c.status };
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
      if (!f) addActivity(c.name, c.color, `tạo ${rel}`);
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
      addActivity(c.name, c.color, `xoá ${rel}`);
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
      c.presence = {
        file: typeof p.file === 'string' ? p.file : null,
        sel: Array.isArray(p.sel) ? p.sel.slice(0, 20) : [],
        line: Number(p.line) || 0,
        debug: typeof p.debug === 'string' ? p.debug : null,
      };
      broadcast({ t: 'presence', id: c.id, p: c.presence }, c);
      if ((before || null) !== c.presence.debug) {
        addActivity(c.name, c.color, c.presence.debug ? `bắt đầu debug ${c.presence.debug}` : 'dừng debug');
      }
    },

    status(c, m) {
      c.status = String(m.text || '').slice(0, 200);
      broadcast({ t: 'status', id: c.id, text: c.status }, c);
      addActivity(c.name, c.color, c.status ? `đặt trạng thái: ${c.status}` : 'xoá trạng thái');
    },

    chat(c, m) {
      const text = typeof m.text === 'string' ? m.text.trim().slice(0, 4000) : '';
      let image = null;
      if (m.image && typeof m.image === 'object') {
        image = saveImage(m.image);
        if (!image) return send(c, { t: 'chat_rejected', reason: `Ảnh không hợp lệ hoặc lớn hơn ${IMAGE_MAX / 1024 / 1024} MB.` });
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
      send(c, { t: 'pong' });
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

  // allowed-accounts file: one account per line, "github:<user>", "microsoft:<email>" or just the name;
  // "#" starts a comment. Missing or empty file = everyone with the token may join. Re-read on every join.
  function accountError(account) {
    if (!opts.allowFile) return null;
    let lines = [];
    try {
      lines = fs.readFileSync(opts.allowFile, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim().toLowerCase()).filter(Boolean);
    } catch {
      return null;
    }
    if (!lines.length) return null;
    if (!account) {
      return 'Hub chỉ cho các tài khoản trong danh sách vào. Đăng nhập GitHub hoặc Microsoft trong VS Code (biểu tượng tài khoản ở góc dưới bên trái), rồi chạy lệnh "LAN Collab: Dùng tài khoản VS Code".';
    }
    const full = `${account.provider}:${account.label}`.toLowerCase();
    if (lines.includes(full) || lines.includes(account.label.toLowerCase())) return null;
    return `Tài khoản ${account.provider}:${account.label} chưa được phép vào. Nhờ người quản lý hub thêm dòng "${account.provider}:${account.label}" vào ${path.basename(opts.allowFile)}.`;
  }

  function welcome(c) {
    const manifest = {};
    for (const [rel, f] of files) {
      manifest[rel] = f.kind === 'text' ? { kind: 'text', rev: f.rev, hash: C.sha1(f.text) } : { kind: 'blob', rev: 0, hash: f.hash };
    }
    const applied = {};
    const prefix = `${c.uid}\n`;
    for (const [key, seq] of lastSeq) if (key.startsWith(prefix)) applied[key.slice(prefix.length)] = seq;
    send(c, {
      t: 'welcome',
      id: c.id,
      color: c.color,
      hubId,
      session,
      project,
      files: manifest,
      applied,
      users: [...clients.values()].filter((o) => o !== c).map(publicUser),
      activity: activity.slice(-60),
      features: FEATURES,
      key: c.key,
      exclude: excludePatterns, // clients skip these too, so nobody offers files the hub will refuse
      chat: chat.slice(-200),
    });
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
        send(me, { t: 'pong' });
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
        let err = null;
        let code = '';
        if (m.proto !== C.PROTO) err = `Phiên bản giao thức khác hub (máy: ${m.proto}, hub: ${C.PROTO}) — cập nhật extension.`;
        else if (token && m.token !== token) err = 'Sai lanCollab.token.';
        else if (String(m.project || '').toLowerCase() !== project.toLowerCase()) err = `Hub này phục vụ dự án "${project}", máy đang mở "${m.project}".`;
        else if ((err = accountError(account))) code = 'account';
        if (!err && m.probe) {
          // "Join by code" checks the code first; it is not a member of the room.
          ls.send({ t: 'probe-ok' });
          sock.end();
          return;
        }
        if (err) {
          log(`Từ chối ${sock.remoteAddress}${account ? ` (${account.provider}:${account.label})` : ''}: ${err}`);
          ls.send({ t: 'error', message: err, code });
          sock.end();
          return;
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
          ls,
        };
        clearTimeout(helloTimer);
        ls.maxLine = C.MAX_LINE;
        clients.set(me.id, me);
        welcome(me);
        broadcast({ t: 'joined', user: publicUser(me) }, me);
        addActivity(me.name, me.color, `vào phòng (${sock.remoteAddress})`);
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
      addActivity(me.name, me.color, 'rời phòng');
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8200, opts.host || '0.0.0.0', () => {
      const { port } = server.address();
      log(`LAN Collab hub — dự án "${project}" — thư mục ${root} — cổng ${port} — ${files.size} file`);
      if (opts.allowFile) log(`Danh sách tài khoản được vào: ${opts.allowFile} (trống hoặc không có file = ai có token cũng vào được)`);
      const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
      for (const ip of ips) log(`Mã mời (${ip}): ${C.encodeInvite({ host: ip, port, project, token })}`);
      resolve({
        port,
        files,
        flushAll,
        close() {
          flushAll();
          for (const c of clients.values()) c.ls.close();
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
    out[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return out;
}

if (require.main === module) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.root) {
    console.error('Dùng: node hub.js --root <thư mục dự án trên server> [--port 8200] [--project TÊN] [--token BÍ_MẬT] [--history DIR] [--allow-file FILE] [--exclude "a,b"]');
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
  }).then((hub) => {
    const stop = () => {
      hub.flushAll();
      process.exit(0);
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, stop);
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
