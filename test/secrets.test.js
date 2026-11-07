'use strict';

// Token migration from 0.1 (extension/src/connection/secrets.js): both sources, a crash between the write and the
// delete, an empty source, a store that does not read back, and an open folder that does not use the settings.
// Run: node test/secrets.test.js
const assert = require('assert');
const { migrateTokens, secretKey, SETTINGS_KEY } = require('../extension/src/connection/secrets');
const joins = require('../extension/src/connection/joins');

function memento(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    failNextUpdate: false,
    get: (k) => data.get(k),
    async update(k, v) {
      if (this.failNextUpdate) {
        this.failNextUpdate = false;
        throw new Error('crash');
      }
      data.set(k, v);
    },
  };
}

function secretStore({ readBack = true } = {}) {
  const data = new Map();
  return {
    data,
    get: async (k) => (readBack ? data.get(k) : undefined),
    store: async (k, v) => {
      data.set(k, v);
    },
  };
}

// lanCollab.token at the user and the workspace level.
function setting({ global = '', workspace = '' } = {}) {
  const s = { global, workspace, cleared: [], failNextClear: false };
  const clear = (level) => async () => {
    if (s.failNextClear) {
      s.failNextClear = false;
      throw new Error('crash');
    }
    s[level] = '';
    s.cleared.push(level);
  };
  s.clearGlobal = clear('global');
  s.clearWorkspace = clear('workspace');
  return s;
}

const V1_A = { host: '192.168.1.10', port: 8200, project: 'Demo', token: 'tok-a' };
const V1_B = { host: '10.0.0.5', port: 8300, project: 'Web', token: '' };
const log = () => {};
const noToken = (gs) => assert.ok(!JSON.stringify(gs.data.get(joins.KEY) || {}).includes('"token"'), 'no token left in globalState');
const run = (o) => migrateTokens({ globalState: memento(), secrets: secretStore(), settingsFolderKey: null, setting: setting(), log, ...o });

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('every source moves: joins records become schema 2, the user and workspace settings are cleared', async () => {
  const gs = memento({ [joins.KEY]: { 'c:\\a': V1_A, 'c:\\b': V1_B } });
  const secrets = secretStore();
  const st = setting({ global: 'tok-user', workspace: 'tok-ws' });
  assert.strictEqual(await run({ globalState: gs, secrets, settingsFolderKey: 'c:\\s', setting: st }), 4);
  assert.strictEqual(secrets.data.get(secretKey('c:\\a')), 'tok-a');
  assert.strictEqual(secrets.data.get(secretKey('c:\\b')), '');
  assert.strictEqual(secrets.data.get(secretKey(SETTINGS_KEY)), 'tok-user', 'the user-level token serves every settings folder');
  assert.strictEqual(secrets.data.get(secretKey('c:\\s')), 'tok-ws');
  assert.deepStrictEqual(gs.data.get(joins.KEY)['c:\\a'], { v: 2, instanceId: null, addresses: ['192.168.1.10'], lastGood: null, port: 8200, project: 'Demo', tlsFingerprint: null });
  assert.deepStrictEqual([st.global, st.workspace], ['', '']);
  noToken(gs);
});

test('an open folder that does not use the settings never takes the token', async () => {
  const secrets = secretStore();
  const st = setting({ global: 'tok-user', workspace: 'tok-ws' });
  await run({ secrets, settingsFolderKey: null, setting: st });
  assert.strictEqual(secrets.data.get(secretKey(SETTINGS_KEY)), 'tok-user');
  assert.strictEqual(st.workspace, 'tok-ws', 'the workspace value belongs to that workspace and is not its token');
  assert.deepStrictEqual([...secrets.data.keys()], [secretKey(SETTINGS_KEY)], 'no folder secret was written');
});

test('a crash between the secret write and the record rewrite converges on rerun', async () => {
  const gs = memento({ [joins.KEY]: { 'c:\\a': V1_A } });
  const secrets = secretStore();
  gs.failNextUpdate = true;
  await assert.rejects(run({ globalState: gs, secrets }));
  assert.strictEqual(secrets.data.get(secretKey('c:\\a')), 'tok-a', 'written before the crash');
  assert.strictEqual(gs.data.get(joins.KEY)['c:\\a'].token, 'tok-a', 'old copy kept: the crash came before the delete');
  assert.strictEqual(await run({ globalState: gs, secrets }), 1);
  assert.strictEqual(secrets.data.get(secretKey('c:\\a')), 'tok-a');
  noToken(gs);
  assert.strictEqual(await run({ globalState: gs, secrets }), 0, 'idempotent');
});

test('a crash before the setting is cleared converges on rerun', async () => {
  const secrets = secretStore();
  const st = setting({ global: 'tok-user' });
  st.failNextClear = true;
  await assert.rejects(run({ secrets, setting: st }));
  assert.strictEqual(st.global, 'tok-user');
  await run({ secrets, setting: st });
  assert.strictEqual(st.global, '');
  assert.strictEqual(secrets.data.get(secretKey(SETTINGS_KEY)), 'tok-user');
});

test('an empty source changes nothing', async () => {
  const gs = memento();
  const secrets = secretStore();
  const st = setting();
  assert.strictEqual(await run({ globalState: gs, secrets, settingsFolderKey: 'c:\\s', setting: st }), 0);
  assert.strictEqual(secrets.data.size, 0);
  assert.strictEqual(gs.data.size, 0);
  assert.deepStrictEqual(st.cleared, []);
});

test('nothing is deleted when the secret does not read back', async () => {
  const gs = memento({ [joins.KEY]: { 'c:\\a': V1_A } });
  const st = setting({ global: 'tok-user', workspace: 'tok-ws' });
  assert.strictEqual(await run({ globalState: gs, secrets: secretStore({ readBack: false }), settingsFolderKey: 'c:\\s', setting: st }), 0);
  assert.strictEqual(gs.data.get(joins.KEY)['c:\\a'].token, 'tok-a');
  assert.strictEqual(joins.legacyToken(gs, 'c:\\a'), 'tok-a', 'the connection still finds the old copy');
  assert.deepStrictEqual([st.global, st.workspace], ['tok-user', 'tok-ws']);
});

test('schema 2 records are left alone and never gain a token', async () => {
  const rec = { v: 2, instanceId: 'I1', addresses: ['10.0.0.1'], lastGood: '10.0.0.1', port: 8200, project: 'Demo', tlsFingerprint: null };
  const gs = memento({ [joins.KEY]: { 'c:\\a': rec } });
  const secrets = secretStore();
  assert.strictEqual(await run({ globalState: gs, secrets }), 0);
  assert.deepStrictEqual(gs.data.get(joins.KEY)['c:\\a'], rec);
  assert.strictEqual(secrets.data.size, 0);
  assert.deepStrictEqual(joins.get(gs, 'c:\\a'), rec);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL ${name}\n${e.stack}`);
    }
  }
  if (failed) {
    console.log(`secrets: ${failed} of ${cases.length} failed`);
    process.exit(1);
  }
  console.log(`secrets: OK (${cases.length} cases)`);
})();
