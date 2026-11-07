'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { TextOperation, diff } = require('./ot');
const C = require('./common');
const { t } = require('./i18n');

class TextEntry {
  constructor(rel, text, rev) {
    this.kind = 'text';
    this.rel = rel;
    this.text = text; // this machine's view: confirmed server text + unacknowledged local ops
    this.diskText = null; // last content known to be on this machine's disk
    this.binding = null;
    this.loading = false;
    this.synced = false; // the hub has confirmed this file at least once
    this.saving = 0; // time a save started, 0 when none
    this.saveFailed = false;
    this.checkedRev = -1;
    this.resetOt(rev, text);
  }

  resetOt(rev, serverText) {
    this.ot = { rev, serverText, outstanding: null, outstandingSeq: 0, buffer: null, bufSrc: 'editor' };
  }
}

// Protocol 2 hubs send codes and structured activity, never display text. Error data is the hub's `data` plus
// this client's own `host`, `port`, `project` and `proto`.
function hubErrorText(code, d = {}) {
  switch (code) {
    case 'protocol_version': return d.proto < d.hubMin ? t('error.protocol_version.hub_newer') : t('error.protocol_version.hub_older');
    case 'token_invalid': return t('error.token_invalid');
    case 'project_unknown': return d.projects && d.projects.length
      ? t('error.project_unknown.list', { host: d.host, port: d.port, project: d.project, projects: d.projects.map((p) => `"${p}"`).join(', ') })
      : t('error.project_unknown', { host: d.host, port: d.port, project: d.project });
    case 'account_required': return t('error.account_required');
    case 'account_denied': return t('error.account_denied', { account: d.account, entry: d.entry });
    case 'tls_required': return t('error.tls_required', { host: d.host, port: d.port });
    case 'image_invalid': return t('error.image_invalid', { maxMb: String((d.maxBytes || 0) / 1024 / 1024).replace('.', ',') });
    default: return t('error.other', { host: d.host, port: d.port });
  }
}

function activityText(a) {
  switch (a.kind) {
    case 'join': return t('activity.join');
    case 'leave': return t('activity.leave');
    case 'edit': return t('activity.edit', { path: a.path });
    case 'edit_disk': return t('activity.edit_disk', { path: a.path });
    case 'create': return t('activity.create', { path: a.path });
    case 'delete': return t('activity.delete', { path: a.path });
    case 'debug_start': return t('activity.debug_start', { target: a.text });
    case 'debug_stop': return t('activity.debug_stop');
    case 'status_set': return t('activity.status_set', { text: a.text });
    case 'status_clear': return t('activity.status_clear');
    // A hub before protocol 2 sends its own sentence and no kind; a newer kind is shown by name.
    default: return typeof a.kind === 'string' ? a.kind : String(a.text || '');
  }
}

// Equal positions, ignoring the RTT a member repeats every 5 s.
function samePlace(a, b) {
  if (!a || !b) return a === b;
  return a.file === b.file && a.line === b.line && a.debug === b.debug && JSON.stringify(a.sel) === JSON.stringify(b.sel);
}

// The default socket factory: plain TCP to one address, resolved once connected.
function connectTcp(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      resolve({ socket, host, port });
    });
  });
}

// A hub keeps its project's id in <root>/.lan-collab/hub.json, so a folder holding one is that hub's project folder.
function folderHubId(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, '.lan-collab', 'hub.json'), 'utf8'));
    return typeof j.id === 'string' ? j.id : null;
  } catch {
    return null;
  }
}

// Keeps one local folder in sync with the hub. Text files are edited with OT (operational transformation);
// binary/large files are replaced whole. Editors plug in through EditorBinding; everything else goes via disk.
const LIVE_PATH_MESSAGES = new Set(['file', 'deleted', 'op', 'ack', 'resync', 'nack', 'stored']);
const BASE_WRITES_PER_BATCH = 200;

// Confirmation is mandatory when a first sync changes local files, on any conflict, and above 5 local removals.
function needsDecision(plan, firstTime) {
  const touchesLocal = plan.overwrite.length + plan.replace.length + plan.upload.length + plan.uploadBlob.length + plan.removeLocal.length + plan.push.length > 0;
  return (firstTime && touchesLocal) || plan.conflict.length > 0 || plan.removeLocal.length > 5;
}

// confirmSync answers false (cancel), true (the hub's version for every conflict and replaced file) or an object
// {path: 'hub' | 'local' | 'merge'}.
function choiceOf(answer, rel, fallback) {
  return answer && typeof answer === 'object' && Object.hasOwn(answer, rel) ? answer[rel] : fallback;
}

class CollabClient extends EventEmitter {
  constructor(o) {
    super();
    this.root = o.root;
    this.host = o.host;
    this.port = o.port;
    this.token = o.token || '';
    this.project = o.project;
    this.name = o.name;
    this.uid = o.uid;
    this.device = o.device || null; // stable per machine, unlike uid
    this.account = o.account || null; // {provider, label} of the VS Code account, if any
    this.chat = [];
    this.hubFeatures = [];
    this.media = new Map(); // chat image id -> {mime, b64}, most recent last
    this.mediaWaits = new Map(); // chat image id -> resolvers waiting for the hub
    this.autoSave = o.autoSave !== false;
    this.retryMs = o.retryMs || 1000;
    // Delay before reconnect attempt n (0 = the first after a drop). Default: doubling from 2 retryMs to 10 retryMs.
    this.retryDelay = o.retryDelay || ((n) => Math.min(this.retryMs * 2 ** (n + 1), 10 * this.retryMs));
    this.retryAttempt = 0;
    // Resolves {socket, host, port} with the socket already connected (and, for TLS, verified), so plain TCP and
    // TLS share one path. The extension passes the diagnostics resolver, which races every known address.
    this.openSocket = o.openSocket || (() => connectTcp(this.host, this.port));
    this.ownExcluded = C.makeExcluder([...C.DEFAULT_EXCLUDE, ...(o.exclude || [])]);
    this.excluded = this.ownExcluded; // widened with the hub's own patterns on every welcome
    this.hubIgnored = new Set(); // paths the hub refused this session; not offered again
    this.createTimeoutMs = o.createTimeoutMs || 20000;
    this.state = o.state || { get: () => undefined, set: () => {} };
    this.confirmSync = o.confirmSync || (async () => true);
    this.log = o.log || (() => {});

    this.entries = new Map();
    this.loading = new Map(); // rel -> {mode: 'server'|'merge'|'create', base?, backup?}
    this.users = new Map();
    this.activity = [];
    this.presence = null;
    this.status = '';
    this.ready = false;
    this.closed = true;
    this.ls = null;
    this.seq = 0;
    this.rtt = null; // last measured ping-to-pong time in ms
    this.pingAt = 0;
    this.prevSession = null;
    this.diskTimers = new Map();
    this.writeTimers = new Map();
    this.queue = null;
    this.previews = new Map(); // rel -> resolvers of hub content asked for while the sync plan waits for a decision
    this.baseHashes = null; // hashes of the texts kept under .lan-collab/base, read on first use
  }

  abs(rel) {
    return path.join(this.root, rel);
  }

  relOf(absPath) {
    const r = path.relative(this.root, absPath);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
    const rel = r.replace(/\\/g, '/');
    return this.excluded(rel) ? null : rel;
  }

  send(m) {
    if (!this.ls) return;
    // The hub drops a connection whose message exceeds MAX_LINE; resending it after every reconnect would loop.
    if (typeof m.b64 === 'string' && m.b64.length > C.MAX_LINE - 1024) {
      this.hubIgnored.add(m.path);
      this._giveUpCreate(m.path);
      this.log(`[CẢNH BÁO] Không đồng bộ ${m.path}: file lớn hơn giới hạn của LAN Hub. File vẫn giữ nguyên trên máy này.`);
      return;
    }
    this.ls.send(m);
  }

  // ---------------------------------------------------------------- connection

  connect() {
    this.closed = false;
    this._open();
    clearInterval(this.tick);
    this.tick = setInterval(() => this._onTick(), 3000);
    clearInterval(this.rttTimer);
    this.rttTimer = setInterval(() => {
      if (this.ready && this.rtt !== null) this._sendPresence();
    }, 5000);
  }

  disconnect() {
    this.closed = true;
    clearInterval(this.tick);
    clearInterval(this.rttTimer);
    clearTimeout(this.retryTimer);
    for (const t of this.diskTimers.values()) clearTimeout(t);
    this.diskTimers.clear();
    for (const [rel, t] of this.writeTimers) {
      clearTimeout(t);
      const e = this.entries.get(rel);
      if (e) this._writeNow(e);
    }
    this.writeTimers.clear();
    if (this.ready) this._saveSyncedHashes();
    if (this.ls) this.ls.close();
  }

  _open() {
    clearTimeout(this.retryTimer);
    this.emit('connection', { type: 'ATTEMPT' });
    const opening = {};
    this.opening = opening;
    Promise.resolve().then(() => this.openSocket()).then((r) => {
      if (this.closed || this.opening !== opening) {
        r.socket.destroy();
        return;
      }
      this.opening = null;
      this._attach(r);
    }, (err) => {
      if (this.closed || this.opening !== opening) return;
      this.opening = null;
      // Logged once per distinct error: a hub that stays down fails the same way on every retry.
      if (err.message !== this.lastError) this.log(`Không kết nối được LAN Hub ${this.host}:${this.port}: ${err.message}`);
      this.lastError = err.message;
      if (err.fatal) this._refuse(err.code, err.data || {});
      else this._retryLater();
    });
  }

  _attach({ socket: sock, host, port }) {
    this.host = host;
    this.port = port;
    this.lastError = null;
    const ls = new C.LineSocket(sock);
    this.ls = ls;
    this.lastSeen = Date.now();
    this.pingAt = 0;
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 10000);
    ls.on('message', (m) => {
      if (this.ls !== ls || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
      this.lastSeen = Date.now();
      if (this._previewReply(m)) return;
      if (this.queue && m.t !== 'welcome') {
        this.queue.push(m);
        return;
      }
      this._dispatch(m);
    });
    ls.on('partial', () => {
      // A large file is arriving; the hub's pong is queued behind it.
      this.lastSeen = Date.now();
      this.lastPartial = this.lastSeen;
    });
    ls.on('error', (e) => {
      if (e.message !== this.lastError) this.log(`Kết nối LAN Hub ${this.host}:${this.port} lỗi: ${e.message}`);
      this.lastError = e.message;
    });
    ls.on('close', () => {
      if (this.ls === ls) this._onClosed();
    });
    // The resolver may have held the socket across awaits: a hub that closed it meanwhile emits no close now.
    if (sock.destroyed) {
      this._onClosed();
      return;
    }
    ls.send({ t: 'hello', proto: C.PROTO_V2, token: this.token, project: this.project, name: this.name, uid: this.uid, device: this.device, account: this.account });
    this.emit('connection', { type: 'SOCKET_OPEN' });
  }

  _onClosed() {
    const wasReady = this.ready;
    this.ls = null;
    this.ready = false;
    this.queue = null;
    this.loading.clear();
    for (const e of this.entries.values()) if (e.kind === 'text') e.loading = false;
    this.users.clear();
    for (const waits of this.mediaWaits.values()) for (const r of waits) r(null);
    this.mediaWaits.clear();
    if (wasReady) this.log('Mất kết nối LAN Hub.');
    this.emit('users');
    if (this.closed) return;
    this._retryLater();
  }

  _retryLater() {
    const delay = this.retryDelay(this.retryAttempt);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => this._open(), delay);
    this.emit('connection', { type: 'SOCKET_CLOSED', retryAt: Date.now() + delay });
  }

  // A refusal that must wait for the member: the hub's `error`, a changed TLS certificate, a folder that belongs to
  // another hub. Never retried.
  _refuse(code, data) {
    this.closed = true;
    const full = { ...data, host: this.host, port: this.port, project: this.project, proto: C.PROTO_V2 };
    this.emit('connection', { type: 'HUB_ERROR', code, data: full });
    // Headless clients (conformance tests, tools) read the rendered sentence; the extension reads the event above.
    this.emit('fatal', full.message || hubErrorText(code, full), code);
    if (this.ls) this.ls.close();
  }

  _onTick() {
    if (this.ls && Date.now() - this.lastSeen > 35000) {
      this.log('LAN Hub không phản hồi 35 giây → kết nối lại.');
      this.ls.close();
      return;
    }
    if (this.ls) {
      // also while the first-sync dialog is open, so the hub link stays up
      if (!this.pingAt) this.pingAt = Date.now();
      this.send({ t: 'ping' });
    }
    if (!this.ready) return;
    this._saveSyncedHashes();
    this._expireCreates();
    for (const e of this.entries.values()) {
      if (e.kind !== 'text' || e.loading || e.ot.outstanding || e.ot.buffer) continue;
      if (e.binding) {
        e.binding.verify();
        if (!e.binding.idle()) continue;
      }
      if (e.text !== e.ot.serverText) {
        this.log(`[CẢNH BÁO] ${e.rel}: lệch nội bộ → đồng bộ lại`);
        this._resync(e);
        continue;
      }
      if (e.checkedRev !== e.ot.rev) {
        e.checkedRev = e.ot.rev;
        this.send({ t: 'check', path: e.rel, rev: e.ot.rev, hash: C.sha1(e.text) });
      }
    }
  }

  _dispatch(m) {
    const h = this[`_on_${m.t}`];
    if (!h) return;
    // The hub is not authenticated to us: never let a path from it leave the project folder, and never let it
    // touch what this machine excludes (its own run output, .git, ...).
    if (LIVE_PATH_MESSAGES.has(m.t) && (!C.safeRel(m.path) || this.excluded(m.path))) {
      if (!C.safeRel(m.path)) this.log(`[CẢNH BÁO] Bỏ qua "${m.t}" với đường dẫn không hợp lệ: ${String(m.path).slice(0, 200)}`);
      return;
    }
    try {
      h.call(this, m);
    } catch (err) {
      this.log(`[LỖI] xử lý "${m.t}" ${m.path || ''}: ${err.stack || err}`);
      const e = m.path && this.entries.get(m.path);
      if (e && e.kind === 'text') this._resync(e);
    }
  }

  // ---------------------------------------------------------------- initial sync

  _on_error(m) {
    // A hub older than protocol 2 refuses this client with its own sentence in `message`.
    this.log(`LAN Hub từ chối kết nối: ${typeof m.message === 'string' ? m.message : `${m.code} ${JSON.stringify(m.data || {})}`}`);
    const data = { ...m.data };
    if (typeof m.message === 'string') data.message = m.message;
    this._refuse(typeof m.code === 'string' ? m.code : '', data);
  }

  // Concerns one message only (C5 role_denied): the connection stays, and a code this client does not know is
  // ignored (protocol.md 4.2).
  _on_rejected(m) {
    this.log(`LAN Hub không nhận thao tác: ${m.code} ${m.path || ''}`);
  }

  _on_welcome(w) {
    const owner = folderHubId(this.root);
    if (owner && owner !== w.hubId) {
      this.log(`Thư mục ${this.root} là thư mục dự án của LAN Hub khác (hubId ${owner}, LAN Hub này ${w.hubId}).`);
      this._refuse('folder_other_project', { path: this.root });
      return;
    }
    const ls = this.ls;
    this.queue = [];
    this.retryAttempt = 0;
    this.previews.clear();
    this.emit('connection', { type: 'WELCOME', instanceId: typeof w.instanceId === 'string' ? w.instanceId : null, hubId: w.hubId });
    this._sync(w).then(() => {
      if (this.ls !== ls) return;
      const q = this.queue || [];
      this.queue = null;
      for (const m of q) this._dispatch(m);
    }, (err) => {
      if (this.ls !== ls) return;
      this.queue = null;
      this.log(`[LỖI] đồng bộ ban đầu: ${err.stack || err}`);
      if (this.ls) this.ls.close();
    });
  }

  async _sync(w) {
    const ls = this.ls;
    const sameSession = this.prevSession === w.session;
    const known = new Set(this.state.get(`known:${w.hubId}`) || []);
    // Hash of each file as it was on this disk when last in sync with the hub: tells "I edited it while
    // the extension was not running" apart from "teammates edited it while I was away".
    const syncedHashes = this.state.get(`hashes:${w.hubId}`) || {};
    const firstTime = !this.state.get(`confirmed:${w.hubId}`);
    // Skip what the hub itself never stores; hubs before 0.1.1 do not send their list (see _expireCreates).
    if (Array.isArray(w.exclude)) {
      const hubExcluded = C.makeExcluder(w.exclude);
      this.excluded = (rel) => this.ownExcluded(rel) || hubExcluded(rel);
    } else {
      this.excluded = this.ownExcluded;
    }
    let plan = this._plan(w, known, syncedHashes, firstTime);
    let answer = true;
    while (needsDecision(plan, firstTime)) {
      this.diskTouched = new Set();
      try {
        answer = await this.confirmSync(this._decisionRequest(w, plan, firstTime, syncedHashes, answer));
      } finally {
        this._endPreviews();
      }
      const touched = this.diskTouched;
      this.diskTouched = null;
      if (this.ls !== ls) return;
      if (!answer) {
        this.closed = true;
        this.emit('connection', { type: 'SYNC_CANCELLED' });
        ls.close();
        return;
      }
      if (!touched.size) break;
      // The panel leaves the editor usable, so a file saved, created or deleted meanwhile makes the plan stale.
      // The choices carry over; a file that now needs one the member did not make is asked about again.
      this.log(`${touched.size} file đổi trên máy này trong lúc chờ quyết định, lập lại kế hoạch đồng bộ.`);
      plan = this._plan(w, known, syncedHashes, firstTime);
      if ([...plan.conflict, ...plan.replace].every(([rel]) => choiceOf(answer, rel, null) !== null)) break;
    }
    if (this.ls !== ls) return;
    if (firstTime) this.state.set(`confirmed:${w.hubId}`, true);
    for (const [rel, buf] of plan.replace) {
      if (choiceOf(answer, rel, 'hub') === 'local') plan.push.push([rel, buf]);
      else plan.overwrite.push(rel);
    }
    for (const [rel, buf] of plan.conflict) {
      const choice = choiceOf(answer, rel, 'hub');
      const base = choice === 'merge' ? this._readBase(syncedHashes[rel]) : null;
      if (choice === 'local') plan.push.push([rel, buf]);
      else if (base !== null && w.files[rel].kind === 'text' && C.classify(buf, rel) === 'text') plan.conflictMerge.push([rel, buf.toString('utf8'), base]);
      else {
        if (choice === 'merge') this.log(`[CẢNH BÁO] Không gộp được ${rel}: thiếu bản của lần đồng bộ trước. Dùng bản trên hub, bản trên máy này được sao lưu.`);
        plan.overwrite.push(rel);
      }
    }

    this.ready = true;
    this.myId = w.id;
    this.myKey = w.key || null;
    this.hubFeatures = Array.isArray(w.features) ? w.features : [];
    this.myColor = w.color;
    this.hubId = w.hubId;
    this.prevSession = w.session;
    this.users = new Map(w.users.map((u) => [u.id, u]));
    this.activity = (w.activity || []).map(activityView);
    this.chat = w.chat || [];
    this.backupStamp = null;

    const uploading = new Set(plan.upload);
    for (const rel of [...this.entries.keys()]) if (!(rel in w.files) && !uploading.has(rel)) this._dropEntry(rel);

    for (const [rel, buf] of plan.keep) {
      const s = w.files[rel];
      if (s.kind === 'text') {
        const text = buf.toString('utf8');
        const e = new TextEntry(rel, text, s.rev);
        e.diskText = text;
        e.synced = true;
        this.entries.set(rel, e);
      } else {
        this.entries.set(rel, { kind: 'blob', rel, hash: s.hash, hubHash: s.hash, synced: true });
      }
    }
    for (const rel of plan.merge) this._reconcile(this.entries.get(rel), w.files[rel], w.applied && w.applied[rel], sameSession);
    // The same three-way merge as a reconnect, with the text kept from the last sync as the base.
    for (const [rel, text, base] of plan.conflictMerge) {
      this._backupFile(rel);
      const e = new TextEntry(rel, text, 0);
      e.diskText = text;
      this.entries.set(rel, e);
      this._request(rel, { mode: 'merge', base });
    }
    for (const rel of plan.get) this._request(rel, { mode: 'server' });
    for (const rel of plan.overwrite) this._request(rel, { mode: 'server', backup: true });
    for (const [rel, buf] of plan.uploadBlob) {
      this.entries.set(rel, { kind: 'blob', rel, hash: C.sha1(buf) });
      this.send({ t: 'put', path: rel, b64: buf.toString('base64') });
    }
    // The hub turns a create on an existing text file into an edit, and a blob put into a replacement.
    for (const [rel, buf] of plan.push) {
      if (w.files[rel].kind === 'text' && C.classify(buf, rel) === 'text') this._localCreated(rel, buf, true);
      else {
        this.entries.set(rel, { kind: 'blob', rel, hash: C.sha1(buf), synced: true });
        this.send({ t: 'put', path: rel, b64: buf.toString('base64') });
      }
    }
    for (const rel of plan.upload) {
      const e = this.entries.get(rel);
      if (e && e.kind === 'text') {
        this._recreate(e);
        continue;
      }
      try {
        this._localCreated(rel, fs.readFileSync(this.abs(rel)), true);
      } catch {
        // vanished meanwhile
      }
    }
    for (const rel of plan.removeLocal) {
      this._backupFile(rel);
      this._dropEntry(rel);
      fs.rmSync(this.abs(rel), { force: true });
    }

    this._saveKnown();
    const n = (k) => plan[k].length;
    this.log(`Đã vào dự án "${w.project}": giữ ${n('keep')}, gộp ${n('merge') + n('conflictMerge')}, tải ${n('get') + n('overwrite')}, gửi ${n('upload') + n('uploadBlob') + n('push')}, xoá ${n('removeLocal')}.`);
    this.emit('connection', { type: 'SYNCED' });
    this.emit('users');
    this.emit('ready');
    if (this.presence) this._sendPresence();
    if (this.status) this.send({ t: 'status', text: this.status });
  }

  // What the first sync does with each file, from the hub's list and this disk.
  _plan(w, known, syncedHashes, firstTime) {
    const local = C.walk(this.root, this.excluded);
    const localByLower = new Map([...local.keys()].map((r) => [r.toLowerCase(), r]));
    const matched = new Set();
    // replace: a file that differs from the hub's in a folder joined for the first time. conflictMerge: a conflict
    // the member chose to merge, with the text both sides last agreed on.
    const plan = { keep: [], merge: [], get: [], overwrite: [], push: [], conflict: [], replace: [], conflictMerge: [], upload: [], uploadBlob: [], removeLocal: [] };

    for (const [rel, s] of Object.entries(w.files)) {
      if (this.excluded(rel) || !C.safeRel(rel)) continue;
      const e = this.entries.get(rel);
      const localRel = local.has(rel) ? rel : localByLower.get(rel.toLowerCase()); // Windows paths ignore case
      if (localRel) matched.add(localRel);
      if (e && e.kind === 'text' && s.kind === 'text') {
        plan.merge.push(rel);
        continue;
      }
      if (!localRel) {
        plan.get.push(rel);
        continue;
      }
      let buf;
      try {
        buf = fs.readFileSync(local.get(localRel));
      } catch {
        plan.get.push(rel);
        continue;
      }
      const h = C.sha1(buf);
      const was = syncedHashes[rel];
      if (h === s.hash) plan.keep.push([rel, buf]);
      else if (e && e.kind === 'blob' && s.kind === 'blob' && e.hash === s.hash) plan.uploadBlob.push([rel, buf]);
      else if (was && h === was) plan.overwrite.push(rel); // unchanged here since last sync: take the hub's
      else if (was && s.hash === was) plan.push.push([rel, buf]); // changed only here (offline): send ours
      else if (firstTime && !was) plan.replace.push([rel, buf]);
      else plan.conflict.push([rel, buf]);
    }
    for (const rel of local.keys()) {
      if (matched.has(rel)) continue;
      const e = this.entries.get(rel);
      if (known.has(rel) || (e && e.synced)) plan.removeLocal.push(rel);
      else plan.upload.push(rel);
    }
    return plan;
  }

  // What confirmSync shows: every file of the plan by action, and per conflict or replaced file whether it is text
  // and whether a merge is possible, plus the choices of an earlier round when the plan was rebuilt. The functions
  // read both sides for a preview while the plan waits.
  _decisionRequest(w, plan, firstTime, syncedHashes, earlier) {
    const local = new Map([...plan.conflict, ...plan.replace]);
    const text = new Map([...local].map(([rel, buf]) => [rel, w.files[rel].kind === 'text' && C.classify(buf, rel) === 'text']));
    const localText = (rel) => (text.get(rel) ? local.get(rel).toString('utf8') : null);
    return {
      firstTime,
      project: w.project,
      chosen: earlier && typeof earlier === 'object' ? { ...earlier } : {},
      conflicts: plan.conflict.map(([rel]) => ({ path: rel, text: text.get(rel), mergeable: text.get(rel) && this._hasBase(syncedHashes[rel]) })),
      replace: plan.replace.map(([rel]) => ({ path: rel, text: text.get(rel) })),
      get: [...plan.get],
      overwrite: [...plan.overwrite],
      upload: [...plan.upload, ...plan.uploadBlob.map(([rel]) => rel), ...plan.push.map(([rel]) => rel)],
      removeLocal: [...plan.removeLocal],
      localText,
      hubText: (rel) => this._hubText(rel),
      mergedText: async (rel) => {
        const base = this._readBase(syncedHashes[rel]);
        const mine = localText(rel);
        const hub = await this._hubText(rel);
        if (base === null || mine === null || hub === null) return null;
        const [, theirs] = TextOperation.transform(diff(base, mine), diff(base, hub));
        return theirs.apply(mine);
      },
    };
  }

  // The hub's text of a file, asked for while the plan waits. The reply skips the queue and is never dispatched:
  // the plan has not touched the file yet, and requests the plan makes later get their own replies.
  _hubText(rel) {
    if (!this.ls || !this.queue) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waits = this.previews.get(rel);
      if (waits) {
        waits.push(resolve);
        return;
      }
      this.previews.set(rel, [resolve]);
      this.send({ t: 'get', path: rel });
    }).then((m) => (m && m.kind === 'text' ? m.text : null));
  }

  _previewReply(m) {
    const waits = m.t === 'file' ? this.previews.get(m.path) : undefined;
    if (!waits) return false;
    this.previews.delete(m.path);
    for (const resolve of waits) resolve(m);
    return true;
  }

  // The decision is made: nobody waits any more, but replies still on the way must not reach _on_file.
  _endPreviews() {
    for (const [rel, waits] of this.previews) {
      for (const resolve of waits) resolve(null);
      this.previews.set(rel, []);
    }
  }

  // Reconnect: we still have this file's last confirmed server text, so local and remote edits made
  // while apart are merged (3-way) instead of one side winning.
  _reconcile(e, s, appliedSeq, sameSession) {
    let base = e.ot.serverText;
    if (e.ot.outstanding && sameSession && appliedSeq !== undefined && appliedSeq >= e.ot.outstandingSeq) {
      base = e.ot.outstanding.apply(base);
    }
    if (C.sha1(e.text) === s.hash) {
      e.resetOt(s.rev, e.text);
      return;
    }
    if (C.sha1(base) === s.hash) {
      e.resetOt(s.rev, base);
      this._clientOp(e, diff(base, e.text), 'merge');
      return;
    }
    this._request(e.rel, { mode: 'merge', base });
  }

  // Records, for every file whose disk copy currently equals the shared text, that content's hash.
  _saveSyncedHashes() {
    if (!this.hubId) return;
    const hashes = { ...(this.syncedHashes || this.state.get(`hashes:${this.hubId}`) || {}) };
    let changed = false;
    const texts = new Map(); // hash -> text of each text file in sync
    for (const e of this.entries.values()) {
      if (!e.synced) continue;
      let h = null;
      if (e.kind === 'blob') h = e.hubHash; // only a version the hub confirmed holding
      else if (!e.loading && !e.ot.outstanding && !e.ot.buffer && e.text === e.ot.serverText && e.diskText === e.text) {
        h = C.sha1(e.text);
        texts.set(h, e.text);
      }
      if (h && hashes[e.rel] !== h) {
        hashes[e.rel] = h;
        changed = true;
      }
    }
    for (const rel of Object.keys(hashes)) {
      if (!this.entries.has(rel) && !this.loading.has(rel)) {
        delete hashes[rel];
        changed = true;
      }
    }
    this.syncedHashes = hashes;
    if (changed) this.state.set(`hashes:${this.hubId}`, hashes);
    this._storeBases(hashes, texts);
  }

  // .lan-collab/base/<sha1> holds the text of each file as it was when last in sync, the base a conflict merge
  // needs after a restart (the hash alone cannot rebuild it). Written in the background, a bounded batch per call.
  _storeBases(hashes, texts) {
    if (this.baseWriting) return;
    const have = this._baseSet();
    const live = new Set(Object.values(hashes));
    const todo = [...texts].filter(([h]) => !have.has(h)).slice(0, BASE_WRITES_PER_BATCH);
    const stale = [...have].filter((h) => !live.has(h));
    if (!todo.length && !stale.length) return;
    const dir = this._baseDir();
    this.baseWriting = (async () => {
      this._metaDir();
      await fs.promises.mkdir(dir, { recursive: true });
      for (const [h, text] of todo) {
        await fs.promises.writeFile(path.join(dir, h), text);
        have.add(h);
      }
      for (const h of stale) {
        have.delete(h);
        await fs.promises.rm(path.join(dir, h), { force: true });
      }
    })().catch((err) => this.log(`[LỖI] không lưu được bản gốc để gộp: ${err.message}`)).finally(() => {
      this.baseWriting = null;
    });
  }

  _baseDir() {
    return path.join(this.root, '.lan-collab', 'base');
  }

  _baseSet() {
    if (!this.baseHashes) {
      try {
        this.baseHashes = new Set(fs.readdirSync(this._baseDir()));
      } catch {
        this.baseHashes = new Set();
      }
    }
    return this.baseHashes;
  }

  _hasBase(hash) {
    return Boolean(hash) && this._baseSet().has(hash);
  }

  _readBase(hash) {
    if (!this._hasBase(hash)) return null;
    try {
      const text = fs.readFileSync(path.join(this._baseDir(), hash), 'utf8');
      return C.sha1(text) === hash ? text : null;
    } catch {
      return null;
    }
  }

  _saveKnown() {
    clearTimeout(this.knownTimer);
    this.knownTimer = setTimeout(() => {
      const synced = [...this.entries.values()].filter((e) => e.synced).map((e) => e.rel);
      this.state.set(`known:${this.hubId}`, synced);
    }, 1000);
  }

  _request(rel, pend) {
    this.loading.set(rel, { ...pend, since: Date.now() });
    const e = this.entries.get(rel);
    if (e && e.kind === 'text') e.loading = true;
    this.send({ t: 'get', path: rel });
  }

  _resync(e) {
    if (e.loading) return;
    // An op already sent may or may not be applied by the hub; its ack (which arrives before the file) tells.
    this._request(e.rel, { mode: 'merge', base: e.ot.serverText, inflight: e.ot.outstanding });
  }

  _dropEntry(rel) {
    const e = this.entries.get(rel);
    this.entries.delete(rel);
    this.loading.delete(rel);
    if (e && e.binding) this.emit('unbind', rel);
  }

  // ---------------------------------------------------------------- OT

  // op is relative to e.text (this machine's current view).
  localOp(e, op, src) {
    if (op.isNoop()) return;
    e.text = op.apply(e.text);
    this._clientOp(e, op, src);
  }

  _clientOp(e, op, src) {
    if (op.isNoop() || !this.ready || e.loading || !this.ls) return;
    const ot = e.ot;
    if (!ot.outstanding) {
      ot.outstanding = op;
      this._sendOutstanding(e, src);
    } else {
      ot.buffer = ot.buffer ? ot.buffer.compose(op) : op;
      if (src === 'disk') ot.bufSrc = 'disk';
    }
  }

  _sendOutstanding(e, src) {
    e.ot.outstandingSeq = ++this.seq;
    this.send({ t: 'op', path: e.rel, rev: e.ot.rev, op: e.ot.outstanding.ops, seq: e.ot.outstandingSeq, src });
  }

  _on_ack(m) {
    const e = this.entries.get(m.path);
    if (!e || e.kind !== 'text' || !e.ot.outstanding) return;
    if (e.loading) {
      const pend = this.loading.get(e.rel);
      if (pend && pend.inflight === e.ot.outstanding) pend.applied = true;
      return;
    }
    const ot = e.ot;
    ot.serverText = ot.outstanding.apply(ot.serverText);
    ot.rev += 1;
    ot.outstanding = null;
    if (ot.rev !== m.rev) {
      this._resync(e);
      return;
    }
    if (ot.buffer) {
      ot.outstanding = ot.buffer;
      ot.buffer = null;
      const src = ot.bufSrc;
      ot.bufSrc = 'editor';
      this._sendOutstanding(e, src);
    }
  }

  _on_op(m) {
    const e = this.entries.get(m.path);
    if (!e || e.kind !== 'text' || e.loading) return;
    const ot = e.ot;
    if (m.rev !== ot.rev) {
      this._resync(e);
      return;
    }
    let op = TextOperation.fromJSON(m.op);
    ot.serverText = op.apply(ot.serverText);
    ot.rev += 1;
    if (ot.outstanding) {
      [ot.outstanding, op] = TextOperation.transform(ot.outstanding, op);
      if (ot.buffer) [ot.buffer, op] = TextOperation.transform(ot.buffer, op);
    }
    this._applyToView(e, op);
    this.emit('remote-edit', e.rel, m.by);
  }

  // Applies an op (relative to e.text) to whatever shows this file here: the open editor, or the disk.
  _applyToView(e, op) {
    if (op.isNoop()) return;
    const old = e.text;
    e.text = op.apply(old);
    if (e.binding) e.binding.enqueue(op, old);
    else this._scheduleWrite(e);
  }

  _on_resync(m) {
    const e = this.entries.get(m.path);
    if (e && e.kind === 'text') this._resync(e);
  }

  _on_nack(m) {
    // The file was deleted on the hub while we edited it: recreate it with our content.
    const e = this.entries.get(m.path);
    if (e && e.kind === 'text') this._recreate(e);
  }

  _recreate(e) {
    e.ot.outstanding = null;
    e.ot.buffer = null;
    e.loading = true;
    this.loading.set(e.rel, { mode: 'create', base: e.text, since: Date.now() });
    this.send({ t: 'create', path: e.rel, kind: 'text', text: e.text });
  }

  _on_file(m) {
    const rel = m.path;
    const pend = this.loading.get(rel);
    this.loading.delete(rel);
    let e = this.entries.get(rel);
    if (m.missing) {
      if (e && e.kind === 'text') e.loading = false;
      if (pend && e && pend.mode !== 'create') this._dropEntry(rel);
      return;
    }

    if (m.kind === 'blob') {
      if (e && e.kind === 'text') this._dropEntry(rel);
      const buf = Buffer.from(m.b64, 'base64');
      let cur = null;
      try {
        cur = fs.readFileSync(this.abs(rel));
      } catch {
        // not on disk yet
      }
      if (!cur || C.sha1(cur) !== m.hash) {
        if (cur && pend && pend.backup) this._backupFile(rel);
        this._writeRaw(rel, buf);
      }
      this.entries.set(rel, { kind: 'blob', rel, hash: m.hash, hubHash: m.hash, synced: true });
      this._saveKnown();
      this.emit('remote-file', rel);
      return;
    }

    const srv = m.text;
    if (e && e.kind === 'text' && pend && (pend.mode === 'merge' || pend.mode === 'create')) {
      // Applied op: it is part of srv already, so it must be part of the base too (or it would be applied twice).
      const base = pend.applied ? pend.inflight.apply(pend.base) : pend.base;
      const [mine, theirs] = TextOperation.transform(diff(base, e.text), diff(base, srv));
      e.loading = false;
      e.synced = true;
      e.resetOt(m.rev, srv);
      this._applyToView(e, theirs);
      this._clientOp(e, mine, pend.mode === 'merge' ? 'merge' : 'editor');
      this._saveKnown();
      this.emit('entry', rel);
      return;
    }

    if (e && e.kind === 'text') {
      if (pend && pend.backup && e.text !== srv) this._backupText(rel, e.text);
      e.loading = false;
      e.synced = true;
      const op = diff(e.text, srv);
      e.resetOt(m.rev, srv);
      this._applyToView(e, op);
      this.emit('entry', rel);
      return;
    }

    if (e) this._dropEntry(rel);
    let cur = null;
    try {
      cur = fs.readFileSync(this.abs(rel), 'utf8');
    } catch {
      // not on disk yet
    }
    if (cur !== null && cur !== srv && pend && pend.backup) this._backupText(rel, cur);
    e = new TextEntry(rel, srv, m.rev);
    e.diskText = cur;
    e.synced = true;
    this.entries.set(rel, e);
    this._saveKnown();
    this._writeNow(e);
    this.emit('entry', rel);
    this.emit('remote-file', rel);
  }

  _on_deleted(m) {
    const e = this.entries.get(m.path);
    this._dropEntry(m.path);
    if (e) {
      clearTimeout(this.writeTimers.get(m.path));
      this.writeTimers.delete(m.path);
    }
    fs.rmSync(this.abs(m.path), { force: true });
    this._saveKnown();
    this.emit('remote-file', m.path);
  }

  // ---------------------------------------------------------------- presence & activity

  sendPresence(p) {
    this.presence = p;
    if (this.ready) this._sendPresence();
  }

  _sendPresence() {
    this.send({ t: 'presence', p: this.rtt === null ? this.presence : { ...this.presence, rtt: this.rtt } });
  }

  setStatus(text) {
    this.status = text;
    if (this.ready) this.send({ t: 'status', text });
    this.emit('users');
  }

  _on_joined(m) {
    this.users.set(m.user.id, m.user);
    this.emit('users');
  }

  _on_left(m) {
    this.users.delete(m.id);
    this.emit('users');
  }

  _on_presence(m) {
    const u = this.users.get(m.id);
    if (!u) return;
    const moved = !samePlace(u.presence, m.p);
    u.presence = m.p;
    if (moved) this.emit('presence', m.id);
  }

  _on_status(m) {
    const u = this.users.get(m.id);
    if (!u) return;
    u.status = m.text;
    this.emit('users');
  }

  _on_activity(m) {
    const a = activityView(m.a);
    this.activity.push(a);
    if (this.activity.length > 200) this.activity.splice(0, this.activity.length - 200);
    this.emit('activity', a);
  }

  _on_pong() {
    if (!this.pingAt) return;
    this.rtt = Date.now() - this.pingAt;
    this.pingAt = 0;
  }

  _on_stored(m) {
    const e = this.entries.get(m.path);
    if (e && e.kind === 'blob') e.hubHash = m.hash;
  }

  // The hub refused a file we offered (it is excluded there, or could not be written).
  _on_ignored(m) {
    if (!this._giveUpCreate(m.path)) return;
    if (m.reason === 'excluded') this.log(`[CẢNH BÁO] Không đồng bộ ${m.path}: LAN Hub không lưu loại file này (bị loại trừ trên LAN Hub). File vẫn giữ nguyên trên máy này.`);
    else this.log(`[CẢNH BÁO] Không đồng bộ ${m.path}: LAN Hub không nhận file (${m.reason || 'không rõ lý do'}). File vẫn giữ nguyên trên máy này.`);
  }

  // Hubs before 0.1.1 drop excluded files without answering: stop waiting after a while.
  _expireCreates() {
    const now = Date.now();
    // While a large file is still going out or coming in, replies are queued behind it: keep waiting.
    const busy = (this.ls && this.ls.sock.writableLength > 0) || now - (this.lastPartial || 0) < 5000;
    for (const [rel, p] of [...this.loading]) {
      if (p.mode !== 'create') continue;
      if (busy) p.since = now;
      else if (now - p.since > this.createTimeoutMs && this._giveUpCreate(rel)) this.log(`[CẢNH BÁO] Không đồng bộ ${rel}: LAN Hub không trả lời. File vẫn giữ nguyên trên máy này.`);
    }
  }

  // Returns true when rel was waiting for the hub to take it.
  _giveUpCreate(rel) {
    const pend = this.loading.get(rel);
    if (!pend || pend.mode !== 'create') return false;
    this.loading.delete(rel);
    this.hubIgnored.add(rel);
    const e = this.entries.get(rel);
    if (e && !e.synced) this._dropEntry(rel);
    this.emit('ignored', rel);
    return true;
  }

  // image: {mime, b64, w, h} or null. Returns null when sent, otherwise the reason it was not.
  sendChat(text, image) {
    if (!this.ready) return t('chat.send.notConnected');
    if (!text.trim() && !image) return null;
    if (image) {
      if (!this.hubFeatures.includes('chat-image')) return t('chat.image.unsupported');
      this._cacheMedia(C.sha1(Buffer.from(image.b64, 'base64')), { mime: image.mime, b64: image.b64 });
    }
    this.send(image ? { t: 'chat', text, image } : { t: 'chat', text });
    return null;
  }

  isMine(msg) {
    return msg.fromKey && this.myKey ? msg.fromKey === this.myKey : msg.fromId === this.myId;
  }

  // Resolves to {mime, b64} or null when the hub no longer has the image or the connection is down.
  getChatMedia(id) {
    const hit = this.media.get(id);
    if (hit) return Promise.resolve(hit);
    if (!this.ready) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waits = this.mediaWaits.get(id);
      if (waits) return waits.push(resolve);
      this.mediaWaits.set(id, [resolve]);
      this.send({ t: 'media', id });
    });
  }

  _cacheMedia(id, v) {
    this.media.delete(id);
    this.media.set(id, v);
    if (this.media.size > 60) this.media.delete(this.media.keys().next().value);
  }

  _on_media(m) {
    const waits = this.mediaWaits.get(m.id) || [];
    this.mediaWaits.delete(m.id);
    const v = m.missing || typeof m.b64 !== 'string' ? null : { mime: m.mime, b64: m.b64 };
    if (v) this._cacheMedia(m.id, v);
    for (const r of waits) r(v);
  }

  _on_chat_rejected(m) {
    this.emit('chat-rejected', hubErrorText(m.code, m.data));
  }

  _on_chat(m) {
    if (!m.msg || typeof m.msg.text !== 'string') return;
    this.chat.push(m.msg);
    if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500);
    this.emit('chat', m.msg);
  }

  // True when a chat message mentions this machine's user (@name, @account or @all / @tatca).
  mentionsMe(msg) {
    const lower = msg.text.toLowerCase();
    const names = [this.name, this.account && this.account.label, 'all', 'tatca', t('chat.mention.everyone')].filter(Boolean);
    // "@Quang" must not match "@QuangAnh": the tag has to end at a non-word character.
    return names.some((n) => {
      const tag = `@${n.toLowerCase()}`;
      for (let i = lower.indexOf(tag); i >= 0; i = lower.indexOf(tag, i + 1)) {
        if (!/[\p{L}\p{N}_]/u.test(lower[i + tag.length] || '')) return true;
      }
      return false;
    });
  }

  // ---------------------------------------------------------------- disk

  // Called by the file watcher for every create/change/delete under root.
  onDiskEvent(absPath) {
    const rel = this.relOf(absPath);
    if (!rel) return;
    if (this.diskTouched) this.diskTouched.add(rel);
    clearTimeout(this.diskTimers.get(rel));
    this.diskTimers.set(rel, setTimeout(() => {
      this.diskTimers.delete(rel);
      this._checkDisk(rel, false);
    }, 100));
  }

  _checkDisk(rel, afterReloadWait) {
    let st = null;
    try {
      st = fs.statSync(this.abs(rel));
    } catch {
      // deleted
    }
    if (st && st.isDirectory()) {
      for (const r of C.walk(this.root, this.excluded, rel).keys()) this._checkDisk(r, false);
      return;
    }
    const e = this.entries.get(rel);
    if (!st) {
      if (e) this._localDeleted(rel);
      else for (const r of [...this.entries.keys()]) if (r.startsWith(`${rel}/`)) this._localDeleted(r);
      return;
    }
    if (!st.isFile()) return;
    let buf;
    try {
      buf = fs.readFileSync(this.abs(rel));
    } catch {
      return;
    }
    if (!e) {
      if (!this.ready || this.loading.has(rel) || this.hubIgnored.has(rel)) return;
      // Windows paths ignore case: "Foo.py" renamed to "foo.py" is the same file under a new name.
      const lower = rel.toLowerCase();
      const old = [...this.entries.keys()].find((r) => r !== rel && r.toLowerCase() === lower);
      if (old) this._localDeleted(old);
      this._localCreated(rel, buf, false);
      return;
    }
    if (e.kind === 'blob') {
      const h = C.sha1(buf);
      if (h !== e.hash && this.ready) {
        e.hash = h;
        this.send({ t: 'put', path: rel, b64: buf.toString('base64') });
      }
      return;
    }
    if (C.classify(buf, rel) === 'blob') {
      if (!this.ready) return;
      this._dropEntry(rel);
      this.entries.set(rel, { kind: 'blob', rel, hash: C.sha1(buf) });
      this.send({ t: 'put', path: rel, b64: buf.toString('base64') });
      return;
    }
    const text = buf.toString('utf8');
    if (text === e.diskText) return;
    if (e.binding && Date.now() - e.saving < 3000) {
      // A save is in progress: look again once onSaved has recorded what VS Code wrote.
      setTimeout(() => {
        if (this.entries.get(rel) === e) this._checkDisk(rel, afterReloadWait);
      }, 300);
      return;
    }
    if (e.binding) {
      // Remember the external change even if the disk gets overwritten by a save before we merge it.
      if (!e.pendingExternal) e.pendingExternal = { base: e.diskText, since: Date.now() };
      e.pendingExternal.text = text;
      if (e.binding.expectsReload() && Date.now() - e.pendingExternal.since < 10000) {
        // A clean editor is reloaded by VS Code itself; that reload arrives as an editor change and clears this.
        setTimeout(() => {
          if (this.entries.get(rel) === e && e.pendingExternal) this._checkDisk(rel, true);
        }, 1500);
        return;
      }
      this.applyPendingExternal(e);
      return;
    }
    this._mergeDisk(e, text);
  }

  // Merges an external change recorded for an open editor (VS Code will not reload a dirty editor).
  applyPendingExternal(e) {
    const p = e.pendingExternal;
    if (!p) return;
    e.pendingExternal = null;
    this._mergeDisk(e, p.text, p.base);
  }

  // Someone outside the editor (AI, script, git) rewrote the file: 3-way merge against what we last saw on disk.
  // The incoming text is brought to the file's line-ending style first: an editor cannot hold mixed line endings,
  // and letting each editor fix them up on its own would insert the missing '\r' once per open editor.
  _mergeDisk(e, text, base) {
    if (base === undefined || base === null) base = e.diskText === null ? e.text : e.diskText;
    if (this.readDisk(e) === text) e.diskText = text;
    const eol = C.dominantEol(e.text.includes('\n') ? e.text : text);
    const [, theirs] = TextOperation.transform(diff(C.normalizeEol(base, eol), e.text), diff(C.normalizeEol(base, eol), C.normalizeEol(text, eol)));
    const old = e.text;
    this.localOp(e, theirs, 'disk');
    if (e.binding) e.binding.enqueue(theirs, old);
    else if (e.text !== e.diskText) this._scheduleWrite(e);
  }

  _localCreated(rel, buf, quiet) {
    if (this.entries.has(rel)) this._dropEntry(rel);
    const kind = C.classify(buf, rel);
    if (kind === 'text') {
      const text = buf.toString('utf8');
      const e = new TextEntry(rel, text, 0);
      e.diskText = text;
      e.loading = true;
      this.entries.set(rel, e);
      this.loading.set(rel, { mode: 'create', base: text, since: Date.now() });
      this.send({ t: 'create', path: rel, kind: 'text', text });
    } else {
      this.entries.set(rel, { kind: 'blob', rel, hash: C.sha1(buf) });
      this.loading.set(rel, { mode: 'create', since: Date.now() });
      this.send({ t: 'create', path: rel, kind: 'blob', b64: buf.toString('base64') });
    }
    if (!quiet) this.log(`Gửi file mới ${rel}`);
  }

  _localDeleted(rel) {
    this._dropEntry(rel);
    if (this.ready) this.send({ t: 'delete', path: rel });
  }

  _scheduleWrite(e) {
    if (this.writeTimers.has(e.rel)) return;
    this.writeTimers.set(e.rel, setTimeout(() => this._writeNow(e), 120));
  }

  _writeNow(e) {
    this.writeTimers.delete(e.rel);
    if (this.entries.get(e.rel) !== e || e.binding) return;
    let cur = null;
    try {
      cur = fs.readFileSync(this.abs(e.rel), 'utf8');
    } catch {
      // not on disk
    }
    if (cur === null && e.diskText !== null) {
      // Deleted here before the watcher told us: the deletion wins over our pending write.
      this._localDeleted(e.rel);
      return;
    }
    if (cur !== null && e.diskText !== null && cur !== e.diskText) {
      this._mergeDisk(e, cur);
      return;
    }
    if (cur === e.text) {
      e.diskText = cur;
      return;
    }
    e.diskText = e.text;
    try {
      this._writeRaw(e.rel, e.text);
    } catch (err) {
      this.log(`[LỖI] không ghi được ${e.rel}: ${err.message}`);
    }
  }

  _writeRaw(rel, data) {
    const file = this.abs(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }

  readDisk(e) {
    try {
      return fs.readFileSync(this.abs(e.rel), 'utf8');
    } catch {
      return null;
    }
  }

  // The file's current disk content if it equals `text` up to line endings (VS Code converts the line endings
  // of a file it reloads), else null. Size is checked first so most keystrokes cost only a stat.
  diskMatch(e, text) {
    try {
      const file = this.abs(e.rel);
      const size = fs.statSync(file).size;
      const bytes = Buffer.byteLength(text, 'utf8');
      if (size !== bytes && Math.abs(size - bytes) > text.split('\n').length) return null;
      const raw = fs.readFileSync(file, 'utf8');
      if (raw === text) return raw;
      return C.normalizeEol(raw, C.dominantEol(text)) === text ? raw : null;
    } catch {
      return null;
    }
  }

  // Used when the editor refuses to save (VS Code "file is newer" conflict): keep the disk current anyway,
  // after merging whatever newer content is on disk into the shared text.
  writeEditorFallback(e) {
    let cur = null;
    try {
      cur = fs.readFileSync(this.abs(e.rel), 'utf8');
    } catch {
      // not on disk
    }
    if (cur !== null && e.diskText !== null && cur !== e.diskText) this._mergeDisk(e, cur);
    e.diskText = e.text;
    try {
      this._writeRaw(e.rel, e.text);
    } catch (err) {
      this.log(`[LỖI] không ghi được ${e.rel}: ${err.message}`);
    }
  }

  attach(e, binding) {
    e.binding = binding;
  }

  detach(e) {
    if (e.binding) e.binding.dispose();
    e.binding = null;
    if (this.entries.get(e.rel) === e && e.text !== e.diskText) this._scheduleWrite(e);
  }

  _metaDir() {
    const dir = path.join(this.root, '.lan-collab');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
    return dir;
  }

  _backupDir() {
    if (!this.backupStamp) {
      this.backupStamp = C.stamp();
      this.emit('backup', path.join(this._metaDir(), 'backup', this.backupStamp));
    }
    return path.join(this.root, '.lan-collab', 'backup', this.backupStamp);
  }

  _backupFile(rel) {
    try {
      const dst = path.join(this._backupDir(), rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(this.abs(rel), dst);
    } catch (err) {
      this.log(`[LỖI] không sao lưu được ${rel}: ${err.message}`);
    }
  }

  _backupText(rel, text) {
    try {
      const dst = path.join(this._backupDir(), rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, text);
    } catch (err) {
      this.log(`[LỖI] không sao lưu được ${rel}: ${err.message}`);
    }
  }

  backupText(rel, text) {
    this._backupText(rel, text);
  }
}

// The activity record the UI shows: the hub's structured record with its sentence in `text`; the hub's own `text`
// (debug target or status) stays in `detail`.
function activityView(a) {
  return { ...a, detail: a.text, text: activityText(a) };
}

module.exports = { CollabClient, TextEntry, hubErrorText, folderHubId };
