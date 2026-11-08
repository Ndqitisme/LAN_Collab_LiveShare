'use strict';

// Several projects on one port from a lanhub.toml (docs/protocol.md, feature multi-project): routing by
// hello.project ignoring case, a token and a hubId per project, project_unknown listing only advertised
// projects, no op crossing projects, hot add, disable and remove while members of the other projects keep
// editing on the same connection, and a config with a syntax error leaving the running projects in place.
// Skipped when the hub does not list multi-project (the Node hub has no --config).
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const C = require('../../lib/common');
const { TextOperation } = require('../../lib/ot');
const { startHubProcess, probeWelcome } = require('../support/hub-process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `lan-collab-multi-${n}-`));
const FILE = 'shared.txt';
const sockets = new Set();

function closeAll() {
  for (const m of sockets) m.close();
}

// A raw member that edits FILE at the start, one op at a time, tracking only rev and length.
class Member {
  constructor(port) {
    this.ls = new C.LineSocket(net.createConnection({ host: '127.0.0.1', port }));
    this.ls.on('error', () => {});
    sockets.add(this);
    this.closed = false;
    this.ops = []; // inserted strings of other members' ops
    this.acks = 0;
    this.waiters = [];
    this.ls.on('close', () => {
      this.closed = true;
      this._wake();
    });
    this.ls.on('message', (m) => this._on(m));
  }

  _wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  _on(m) {
    if (m.t === 'file' && m.path === FILE) {
      this.rev = m.rev;
      this.len = m.text.length;
    } else if (m.t === 'op' && m.path === FILE) {
      const op = TextOperation.fromJSON(m.op);
      this.len += op.targetLength - op.baseLength;
      this.rev = m.rev + 1;
      for (const part of m.op) if (typeof part === 'string') this.ops.push(part);
    } else if (m.t === 'ack' && m.path === FILE) {
      this.len += this.pending.length;
      this.rev = m.rev;
      this.pending = null;
      this.acks += 1;
    }
    if (!this.first) this.first = m;
    this.last = m;
    this._wake();
  }

  until(pred, ms = 5000, what = 'condition') {
    const end = Date.now() + ms;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (pred()) return resolve();
        if (Date.now() > end) return reject(new Error(`timeout waiting for ${what}`));
        this.waiters.push(check);
        setTimeout(() => this._wake(), Math.max(0, Math.min(100, end - Date.now())));
      };
      check();
    });
  }

  // Resolves to the hub's answer to the hello (welcome, error or probe_result), or {t: 'closed'} when the hub
  // closed the connection without one, as it does to a hello that races the stop of its project.
  async hello(fields) {
    await new Promise((r) => this.ls.sock.once('connect', r));
    this.ls.send({ t: 'hello', proto: C.PROTO_V2, name: 'm', uid: `m-${Math.random()}`, ...fields });
    await this.until(() => this.first || this.closed, 5000, 'hello answer');
    return this.first || { t: 'closed' };
  }

  async open() {
    this.ls.send({ t: 'get', path: FILE });
    await this.until(() => this.rev !== undefined, 5000, `${FILE}`);
  }

  async edit(marker) {
    this.pending = marker;
    this.ls.send({ t: 'op', path: FILE, rev: this.rev, op: new TextOperation().insert(marker).retain(this.len).toJSON(), seq: this.acks + 1 });
    await this.until(() => this.pending === null || this.closed, 5000, `ack of ${marker}`);
    assert.ok(!this.closed, `closed while waiting for the ack of ${marker}`);
  }

  close() {
    sockets.delete(this);
    this.ls.close();
  }
}

async function join(port, project, token = '') {
  const m = new Member(port);
  const first = await m.hello({ project, token });
  return { m, first };
}

async function member(port, project, token = '') {
  const { m, first } = await join(port, project, token);
  assert.strictEqual(first.t, 'welcome', `${project}: ${JSON.stringify(first)}`);
  await m.open();
  return m;
}

// Retries a hello until check(answer) holds, so a test waits for the hub to re-read its file.
async function eventually(port, project, token, check, ms = 3000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    const { m, first } = await join(port, project, token);
    m.close();
    last = first;
    if (check(first)) return first;
    await sleep(50);
  }
  throw new Error(`hello ${project}: last answer ${JSON.stringify(last)}`);
}

// A member that keeps editing until stop(), so a test can show its connection survived an apply.
function keepEditing(m, tag) {
  let n = 0;
  let running = true;
  let error = null;
  const done = (async () => {
    try {
      while (running) {
        await m.edit(`<${tag}.${n++}>`);
        await sleep(20);
      }
    } catch (e) {
      error = e;
    }
  })();
  return {
    // Rejects with the first edit that failed.
    async stop() {
      running = false;
      await done;
      if (error) throw error;
      return n;
    },
  };
}

const toml = (s) => `'${s}'`;

function writeConfig(file, projects, extra = '') {
  const body = projects.map((p) => [
    '[[project]]',
    `name = "${p.name}"`,
    `root = ${toml(p.root)}`,
    `token = "${p.token || ''}"`,
    ...(p.advertise === false ? ['advertise = false'] : []),
    ...(p.enabled === false ? ['enabled = false'] : []),
    '',
  ].join('\n')).join('\n');
  fs.writeFileSync(file, `[hub]\nname = "Multi"\n\n${body}${extra}`);
}

function project(name, token, opts = {}) {
  const root = tmp(name);
  fs.writeFileSync(path.join(root, FILE), `${name}:`);
  return { name, token, root, ...opts };
}

async function supportsMultiProject() {
  const hub = await startHubProcess({ root: tmp('probe'), project: 'Probe' });
  try {
    const w = await probeWelcome(hub.port, { project: 'Probe' });
    return w.features.includes('multi-project');
  } finally {
    await hub.stop();
  }
}

test('one hub serves several projects from a lanhub.toml', async (t) => {
  if (!(await supportsMultiProject())) {
    t.skip('the hub does not list multi-project in welcome.features');
    return;
  }

  await t.test('routing, tokens, hubIds and project_unknown', async () => {
    const dir = tmp('cfg');
    const file = path.join(dir, 'lanhub.toml');
    const p1 = project('Alpha', 't1');
    const p2 = project('Beta', 't2');
    const p3 = project('Gamma', 't3', { advertise: false });
    fs.mkdirSync(path.join(p1.root, '.lan-collab'));
    fs.writeFileSync(path.join(p1.root, '.lan-collab', 'hub.json'), JSON.stringify({ id: 'hub-0.1-id', instance: 'old-instance' }));
    writeConfig(file, [p1, p2, p3]);
    const hub = await startHubProcess({ config: file });
    try {
      const { m: a, first: wa } = await join(hub.port, 'ALPHA', 't1');
      assert.strictEqual(wa.t, 'welcome');
      assert.strictEqual(wa.project, 'Alpha', 'the name ignores case and welcome carries the configured one');
      assert.strictEqual(wa.hubId, 'hub-0.1-id', 'a project keeps the hubId of its hub.json');
      assert.ok(wa.features.includes('multi-project'));
      assert.deepStrictEqual(Object.keys(wa.files), [FILE]);
      const instance = JSON.parse(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')).instanceId;
      assert.strictEqual(wa.instanceId, instance, 'instanceId comes from instance.json next to the config');
      assert.strictEqual(wa.hubName, 'Multi');
      a.close();

      const { first: wb } = await join(hub.port, 'Beta', 't2');
      const { first: wg } = await join(hub.port, 'gamma', 't3');
      assert.strictEqual(wb.t, 'welcome');
      assert.strictEqual(wg.t, 'welcome', 'a project that is not advertised still serves');
      assert.strictEqual(new Set([wa.hubId, wb.hubId, wg.hubId]).size, 3, 'one hubId per project');
      assert.strictEqual(wb.instanceId, instance);

      const { first: cross } = await join(hub.port, 'Beta', 't1');
      assert.deepStrictEqual([cross.t, cross.code], ['error', 'token_invalid'], 'a token is good for its own project only');
      const { first: unknown } = await join(hub.port, 'Delta', 't1');
      assert.deepStrictEqual(unknown, { t: 'error', code: 'project_unknown', data: { projects: ['Alpha', 'Beta'] } });
      const probe = await new Member(hub.port).hello({ project: 'Delta', probe: true });
      closeAll();
      assert.strictEqual(probe.t, 'probe_result');
      assert.deepStrictEqual(probe.projects, ['Alpha', 'Beta']);
      assert.strictEqual(probe.project_ok, false);
    } finally {
      closeAll();
      await hub.stop();
    }
  });

  await t.test('ten members in each of three projects: no op crosses projects', async () => {
    const dir = tmp('cfg');
    const file = path.join(dir, 'lanhub.toml');
    const ps = [project('One', 'a'), project('Two', 'b'), project('Three', 'c')];
    writeConfig(file, ps);
    const hub = await startHubProcess({ config: file });
    const members = [];
    try {
      for (const p of ps) for (let i = 0; i < 10; i++) members.push({ p, m: await member(hub.port, p.name, p.token), i });
      await Promise.all(members.map(async ({ p, m, i }) => {
        for (let k = 0; k < 5; k++) await m.edit(`<${p.name}.${i}.${k}>`);
      }));
      // Every member sees the 45 ops of the other nine members of its project and nothing else.
      for (const { p, m } of members) await m.until(() => m.ops.length >= 45, 5000, `ops in ${p.name}`);
      await sleep(200);
      for (const { p, m } of members) {
        assert.strictEqual(m.ops.length, 45, `${p.name}: ${m.ops.length} ops`);
        for (const s of m.ops) assert.ok(s.startsWith(`<${p.name}.`), `${p.name} received ${s}`);
      }
    } finally {
      closeAll();
      await hub.stop();
    }
    for (const p of ps) {
      const text = fs.readFileSync(path.join(p.root, FILE), 'utf8');
      const markers = text.match(/<[^>]*>/g);
      assert.strictEqual(markers.length, 50, `${p.name} on disk`);
      assert.ok(markers.every((s) => s.startsWith(`<${p.name}.`)), `${p.name} on disk: ${text}`);
      assert.ok(text.endsWith(`${p.name}:`));
    }
  });

  await t.test('hot add, disable and remove while the other projects keep editing; a bad file changes nothing', async () => {
    const dir = tmp('cfg');
    const file = path.join(dir, 'lanhub.toml');
    const p1 = project('Keep', 'k');
    const p2 = project('Steady', 's');
    const p3 = project('Later', 'l');
    writeConfig(file, [p1, p2]);
    const hub = await startHubProcess({ config: file });
    const editors = [];
    try {
      const a = await member(hub.port, 'Keep', 'k');
      const b = await member(hub.port, 'Steady', 's');
      const ea = keepEditing(a, 'a');
      const eb = keepEditing(b, 'b');
      editors.push(ea, eb);
      await sleep(200);
      const before = a.acks;

      writeConfig(file, [p1, p2, p3]);
      const added = Date.now();
      await eventually(hub.port, 'Later', 'l', (m) => m.t === 'welcome');
      assert.ok(Date.now() - added < 2000, `the added project took ${Date.now() - added} ms`);
      const c = await member(hub.port, 'Later', 'l');
      await c.edit('<c>');

      writeConfig(file, [p1, p2, { ...p3, enabled: false }]);
      await eventually(hub.port, 'Later', 'l', (m) => m.code === 'project_unknown');
      await c.until(() => c.closed, 5000, 'the disabled project closing its members');
      const { first } = await join(hub.port, 'Nope', '');
      assert.deepStrictEqual(first.data.projects, ['Keep', 'Steady'], 'a disabled project is not listed');

      writeConfig(file, [p1, p2, p3]);
      await eventually(hub.port, 'Later', 'l', (m) => m.t === 'welcome');
      writeConfig(file, [p1, p2]);
      await eventually(hub.port, 'Later', 'l', (m) => m.code === 'project_unknown');

      // Line 7 becomes `token = "k` without its closing quote.
      const good = fs.readFileSync(file, 'utf8');
      const lines = good.split('\n');
      assert.match(lines[6], /^token = "k"$/);
      lines[6] = 'token = "k';
      fs.writeFileSync(file, lines.join('\n'));
      const logged = await hub.waitLog(/lanhub\.toml:7:/, 5000);
      assert.match(logged, /token/);
      const { first: still } = await join(hub.port, 'Keep', 'k');
      assert.strictEqual(still.t, 'welcome', 'the running config stays after a bad file');

      await sleep(200);
      assert.ok(a.acks > before && !a.closed && !b.closed, 'members of untouched projects never left');
      const na = await ea.stop();
      const nb = await eb.stop();
      assert.ok(na > 10 && nb > 10, `edits during the applies: ${na}, ${nb}`);
    } finally {
      await Promise.allSettled(editors.map((e) => e.stop()));
      closeAll();
      await hub.stop();
    }
    const text = fs.readFileSync(path.join(p1.root, FILE), 'utf8');
    assert.ok(text.includes('<a.0>') && text.endsWith('Keep:'));
    assert.ok(fs.readFileSync(path.join(p3.root, FILE), 'utf8').startsWith('<c>'), 'the disabled project was written before it stopped');
  });
});
