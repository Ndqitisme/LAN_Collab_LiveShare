'use strict';

// Token migration from 0.1 (extension/src/connection/secrets.js): both sources, a crash between the write and the
// delete, an empty source, and a store that does not read back. Run: node test/secrets.test.js
const assert = require('assert');
const { migrateTokens, secretKey } = require('../extension/src/connection/secrets');
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

function setting(value) {
  const s = { value, cleared: 0, failNextClear: false };
  s.clear = async () => {
    if (s.failNextClear) {
      s.failNextClear = false;
      throw new Error('crash');
    }
    s.value = '';
    s.cleared += 1;
  };
  return s;
}

const V1_A = { host: '192.168.1.10', port: 8200, project: 'Demo', token: 'tok-a' };
const V1_B = { host: '10.0.0.5', port: 8300, project: 'Web', token: '' };
const lines = [];
const log = (l) => lines.push(l);
const noToken = (gs) => assert.ok(!JSON.stringify(gs.data.get(joins.KEY) || {}).includes('"token"'), 'no token left in globalState');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('both sources move: joins records become schema 2 and the setting is cleared', async () => {
  const gs = memento({ [joins.KEY]: { 'c:\\a': V1_A, 'c:\\b': V1_B } });
  const secrets = secretStore();
  const st = setting('tok-settings');
  const moved = await migrateTokens({ globalState: gs, secrets, workspaceKey: 'c:\\s', setting: st, log });
  assert.strictEqual(moved, 3);
  assert.strictEqual(secrets.data.get(secretKey('c:\\a')), 'tok-a');
  assert.strictEqual(secrets.data.get(secretKey('c:\\b')), '');
  assert.strictEqual(secrets.data.get(secretKey('c:\\s')), 'tok-settings');
  assert.deepStrictEqual(gs.data.get(joins.KEY)['c:\\a'], { v: 2, instanceId: null, addresses: ['192.168.1.10'], lastGood: null, port: 8200, project: 'Demo', tlsFingerprint: null });
  assert.strictEqual(st.value, '');
  noToken(gs);
});

test('a crash between the secret write and the record rewrite converges on rerun', async () => {
  const gs = memento({ [joins.KEY]: { 'c:\\a': V1_A } });
  const secrets = secretStore();
  gs.failNextUpdate = true;
  await assert.rejects(migrateTokens({ globalState: gs, secrets, workspaceKey: null, setting: setting(''), log }));
  assert.strictEqual(secrets.data.get(secretKey('c:\\a')), 'tok-a', 'written before the crash');
  assert.strictEqual(gs.data.get(joins.KEY)['c:\\a'].token, 'tok-a', 'old copy kept: the crash came before the delete');
  assert.strictEqual(await migrateTokens({ globalState: gs, secrets, workspaceKey: null, setting: setting(''), log }), 1);
  assert.strictEqual(secrets.data.get(secretKey('c:\\a')), 'tok-a');
  noToken(gs);
  assert.strictEqual(await migrateTokens({ globalState: gs, secrets, workspaceKey: null, setting: setting(''), log }), 0, 'idempotent');
});

test('a crash before the setting is cleared converges on rerun', async () => {
  const gs = memento();
  const secrets = secretStore();
  const st = setting('tok-settings');
  st.failNextClear = true;
  await assert.rejects(migrateTokens({ globalState: gs, secrets, workspaceKey: 'c:\\s', setting: st, log }));
  assert.strictEqual(st.value, 'tok-settings');
  await migrateTokens({ globalState: gs, secrets, workspaceKey: 'c:\\s', setting: st, log });
  assert.strictEqual(st.value, '');
  assert.strictEqual(secrets.data.get(secretKey('c:\\s')), 'tok-settings');
});

test('an empty source changes nothing', async () => {
  const gs = memento();
  const secrets = secretStore();
  const st = setting('');
  assert.strictEqual(await migrateTokens({ globalState: gs, secrets, workspaceKey: 'c:\\s', setting: st, log }), 0);
  assert.strictEqual(secrets.data.size, 0);
  assert.strictEqual(gs.data.size, 0);
  assert.strictEqual(st.cleared, 0);
});

test('the setting stays when the open folder takes its hub from an invite, or no folder is open', async () => {
  const gs = memento({ [joins.KEY]: { 'c:\\a': V1_A } });
  const st = setting('tok-settings');
  await migrateTokens({ globalState: gs, secrets: secretStore(), workspaceKey: 'c:\\a', setting: st, log });
  assert.strictEqual(st.value, 'tok-settings', 'that token belongs to folders that use the settings');
  await migrateTokens({ globalState: memento(), secrets: secretStore(), workspaceKey: null, setting: st, log });
  assert.strictEqual(st.value, 'tok-settings');
});

test('nothing is deleted when the secret does not read back', async () => {
  const gs = memento({ [joins.KEY]: { 'c:\\a': V1_A } });
  const st = setting('tok-settings');
  assert.strictEqual(await migrateTokens({ globalState: gs, secrets: secretStore({ readBack: false }), workspaceKey: 'c:\\s', setting: st, log }), 0);
  assert.strictEqual(gs.data.get(joins.KEY)['c:\\a'].token, 'tok-a');
  assert.strictEqual(joins.legacyToken(gs, 'c:\\a'), 'tok-a', 'the connection still finds the old copy');
  assert.strictEqual(st.value, 'tok-settings');
});

test('schema 2 records are left alone and never gain a token', async () => {
  const rec = { v: 2, instanceId: 'I1', addresses: ['10.0.0.1'], lastGood: '10.0.0.1', port: 8200, project: 'Demo', tlsFingerprint: null };
  const gs = memento({ [joins.KEY]: { 'c:\\a': rec } });
  const secrets = secretStore();
  assert.strictEqual(await migrateTokens({ globalState: gs, secrets, workspaceKey: null, setting: setting(''), log }), 0);
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
