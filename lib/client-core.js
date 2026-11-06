'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { TextOperation, diff } = require('./ot');
const C = require('./common');

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

// Keeps one local folder in sync with the hub. Text files are edited with OT (operational transformation);
// binary/large files are replaced whole. Editors plug in through EditorBinding; everything else goes via disk.
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
    this.account = o.account || null; // {provider, label} of the VS Code account, if any
    this.chat = [];
    this.autoSave = o.autoSave !== false;
    this.retryMs = o.retryMs || 1000;
    this.excluded = C.makeExcluder([...C.DEFAULT_EXCLUDE, ...(o.exclude || [])]);
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
    this.prevSession = null;
    this.diskTimers = new Map();
    this.writeTimers = new Map();
    this.queue = null;
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
    if (this.ls) this.ls.send(m);
  }

  // ---------------------------------------------------------------- connection

  connect() {
    this.closed = false;
    this._open();
    clearInterval(this.tick);
    this.tick = setInterval(() => this._onTick(), 3000);
  }

  disconnect() {
    this.closed = true;
    clearInterval(this.tick);
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
    this.emit('status', 'connecting');
    const sock = net.createConnection({ host: this.host, port: this.port });
    const ls = new C.LineSocket(sock);
    this.ls = ls;
    this.lastSeen = Date.now();
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 10000);
    sock.on('connect', () => {
      this.retryDelay = this.retryMs;
      ls.send({ t: 'hello', proto: C.PROTO, token: this.token, project: this.project, name: this.name, uid: this.uid, account: this.account });
    });
    ls.on('message', (m) => {
      if (this.ls !== ls || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
      this.lastSeen = Date.now();
      if (this.queue && m.t !== 'welcome') {
        this.queue.push(m);
        return;
      }
      this._dispatch(m);
    });
    ls.on('error', (e) => {
      this.lastError = e.message;
    });
    ls.on('close', () => {
      if (this.ls === ls) this._onClosed();
    });
  }

  _onClosed() {
    const wasReady = this.ready;
    this.ls = null;
    this.ready = false;
    this.queue = null;
    this.loading.clear();
    for (const e of this.entries.values()) if (e.kind === 'text') e.loading = false;
    this.users.clear();
    if (wasReady) this.log('Mất kết nối hub.');
    this.emit('users');
    if (this.closed) {
      this.emit('status', 'off');
      return;
    }
    this.emit('status', 'offline');
    this.retryDelay = Math.min((this.retryDelay || this.retryMs) * 2, 10 * this.retryMs);
    this.retryTimer = setTimeout(() => this._open(), this.retryDelay);
  }

  _onTick() {
    if (this.ls && Date.now() - this.lastSeen > 35000) {
      this.log('Hub không phản hồi 35 giây → kết nối lại.');
      this.ls.close();
      return;
    }
    if (this.ls) this.send({ t: 'ping' }); // also while the first-sync dialog is open, so the hub link stays up
    if (!this.ready) return;
    this._saveSyncedHashes();
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
    this.closed = true;
    this.emit('fatal', m.message, m.code);
  }

  _on_welcome(w) {
    const ls = this.ls;
    this.queue = [];
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
    const local = C.walk(this.root, this.excluded);
    const localByLower = new Map([...local.keys()].map((r) => [r.toLowerCase(), r]));
    const matched = new Set();
    const plan = { keep: [], merge: [], get: [], overwrite: [], push: [], conflict: [], upload: [], uploadBlob: [], removeLocal: [] };

    for (const [rel, s] of Object.entries(w.files)) {
      if (this.excluded(rel)) continue;
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
      else if (firstTime && !was) plan.overwrite.push(rel);
      else plan.conflict.push([rel, buf]);
    }
    for (const rel of local.keys()) {
      if (matched.has(rel)) continue;
      const e = this.entries.get(rel);
      if (known.has(rel) || (e && e.synced)) plan.removeLocal.push(rel);
      else plan.upload.push(rel);
    }

    const touchesLocal = plan.overwrite.length + plan.upload.length + plan.uploadBlob.length + plan.removeLocal.length + plan.push.length > 0;
    let conflictChoice = 'server';
    if ((firstTime && touchesLocal) || plan.conflict.length || plan.removeLocal.length > 5) {
      const answer = await this.confirmSync({
        firstTime,
        project: w.project,
        get: plan.get.length,
        overwrite: plan.overwrite.length,
        upload: plan.upload.length + plan.uploadBlob.length + plan.push.length,
        removeLocal: plan.removeLocal.length,
        conflicts: plan.conflict.map(([rel]) => rel),
      });
      if (this.ls !== ls) return;
      if (!answer) {
        this.closed = true;
        ls.close();
        return;
      }
      if (answer === 'local') conflictChoice = 'local';
    }
    if (this.ls !== ls) return;
    if (firstTime) this.state.set(`confirmed:${w.hubId}`, true);
    for (const item of plan.conflict) {
      if (conflictChoice === 'local') plan.push.push(item);
      else plan.overwrite.push(item[0]);
    }

    this.ready = true;
    this.myId = w.id;
    this.myColor = w.color;
    this.hubId = w.hubId;
    this.prevSession = w.session;
    this.users = new Map(w.users.map((u) => [u.id, u]));
    this.activity = w.activity || [];
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
        this.entries.set(rel, { kind: 'blob', rel, hash: s.hash, synced: true });
      }
    }
    for (const rel of plan.merge) this._reconcile(this.entries.get(rel), w.files[rel], w.applied && w.applied[rel], sameSession);
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
    this.log(`Đã vào phòng "${w.project}": giữ ${n('keep')}, gộp ${n('merge')}, tải ${n('get') + n('overwrite')}, gửi ${n('upload') + n('uploadBlob') + n('push')}, xoá ${n('removeLocal')}.`);
    this.emit('status', 'online');
    this.emit('users');
    this.emit('ready');
    if (this.presence) this.send({ t: 'presence', p: this.presence });
    if (this.status) this.send({ t: 'status', text: this.status });
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
      this._clientOp(e, diff(base, e.text), 'editor');
      return;
    }
    this._request(e.rel, { mode: 'merge', base });
  }

  // Records, for every file whose disk copy currently equals the shared text, that content's hash.
  _saveSyncedHashes() {
    if (!this.hubId) return;
    const hashes = { ...(this.syncedHashes || this.state.get(`hashes:${this.hubId}`) || {}) };
    let changed = false;
    for (const e of this.entries.values()) {
      if (!e.synced) continue;
      let h = null;
      if (e.kind === 'blob') h = e.hash;
      else if (!e.loading && !e.ot.outstanding && !e.ot.buffer && e.text === e.ot.serverText && e.diskText === e.text) h = C.sha1(e.text);
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
  }

  _saveKnown() {
    clearTimeout(this.knownTimer);
    this.knownTimer = setTimeout(() => {
      const synced = [...this.entries.values()].filter((e) => e.synced).map((e) => e.rel);
      this.state.set(`known:${this.hubId}`, synced);
    }, 1000);
  }

  _request(rel, pend) {
    this.loading.set(rel, pend);
    const e = this.entries.get(rel);
    if (e && e.kind === 'text') e.loading = true;
    this.send({ t: 'get', path: rel });
  }

  _resync(e) {
    if (e.loading) return;
    this._request(e.rel, { mode: 'merge', base: e.ot.serverText });
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
    if (!e || e.kind !== 'text' || e.loading || !e.ot.outstanding) return;
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
    this.loading.set(e.rel, { mode: 'create', base: e.text });
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
      this.entries.set(rel, { kind: 'blob', rel, hash: m.hash, synced: true });
      this._saveKnown();
      this.emit('remote-file', rel);
      return;
    }

    const srv = m.text;
    if (e && e.kind === 'text' && pend && (pend.mode === 'merge' || pend.mode === 'create')) {
      const [mine, theirs] = TextOperation.transform(diff(pend.base, e.text), diff(pend.base, srv));
      e.loading = false;
      e.synced = true;
      e.resetOt(m.rev, srv);
      this._applyToView(e, theirs);
      this._clientOp(e, mine, 'editor');
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
    if (this.ready) this.send({ t: 'presence', p });
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
    u.presence = m.p;
    this.emit('presence', m.id);
  }

  _on_status(m) {
    const u = this.users.get(m.id);
    if (!u) return;
    u.status = m.text;
    this.emit('users');
  }

  _on_activity(m) {
    this.activity.push(m.a);
    if (this.activity.length > 200) this.activity.splice(0, this.activity.length - 200);
    this.emit('activity', m.a);
  }

  _on_pong() {}

  sendChat(text) {
    if (!this.ready || !text.trim()) return false;
    this.send({ t: 'chat', text });
    return true;
  }

  _on_chat(m) {
    if (!m.msg || typeof m.msg.text !== 'string') return;
    this.chat.push(m.msg);
    if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500);
    this.emit('chat', m.msg);
  }

  // True when a chat message mentions this machine's user (@name, @account or @all / @tatca).
  mentionsMe(msg) {
    const t = msg.text.toLowerCase();
    const names = [this.name, this.account && this.account.label, 'all', 'tatca', 'tất cả'].filter(Boolean);
    return names.some((n) => t.includes(`@${n.toLowerCase()}`));
  }

  // ---------------------------------------------------------------- disk

  // Called by the file watcher for every create/change/delete under root.
  onDiskEvent(absPath) {
    const rel = this.relOf(absPath);
    if (!rel) return;
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
      if (!this.ready || this.loading.has(rel)) return;
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
      this.loading.set(rel, { mode: 'create', base: text });
      this.send({ t: 'create', path: rel, kind: 'text', text });
    } else {
      this.entries.set(rel, { kind: 'blob', rel, hash: C.sha1(buf) });
      this.loading.set(rel, { mode: 'create' });
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

  _backupDir() {
    if (!this.backupStamp) {
      this.backupStamp = C.stamp();
      const dir = path.join(this.root, '.lan-collab');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
      this.emit('backup', path.join(dir, 'backup', this.backupStamp));
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

module.exports = { CollabClient, TextEntry };
