'use strict';

// lib/connection-machine.js over every pair of state and event. Run: node test/connection-machine.test.js
const assert = require('assert');
const M = require('../lib/connection-machine');

const ACTION_IDS = new Set(['join', 'open_settings', 'paste_invite', 'enter_token', 'diagnose', 'choose_project', 'sign_in',
  'copy_entry', 'switch_account', 'update_extension', 'reconnect']);
const TARGET = { host: '127.0.0.1', port: 8200, project: 'Demo' };

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// One payload per event. System events carry the session of the state they are sent to.
function event(type, s) {
  const session = s.session;
  switch (type) {
    case 'RESOLVED': return { type, session, target: TARGET };
    case 'RESOLVE_FAILED': return { type, session, code: 'unbound', data: {} };
    case 'SOCKET_CLOSED': return { type, session, retryAt: 1000 };
    case 'HUB_ERROR': return { type, session, code: 'token_invalid', data: { host: TARGET.host, port: TARGET.port } };
    default: return M.SYSTEM_EVENTS.includes(type) ? { type, session } : { type };
  }
}

const go = (s, ...types) => types.reduce((st, type) => M.transition(st, event(type, st)), s);
const at = {
  idle: M.initial,
  resolving: go(M.initial, 'CONNECT'),
  connecting: go(M.initial, 'CONNECT', 'RESOLVED'),
  handshaking: go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_OPEN'),
  syncing: go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_OPEN', 'WELCOME'),
  live: go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_OPEN', 'WELCOME', 'SYNCED'),
  reconnecting: go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_OPEN', 'WELCOME', 'SYNCED', 'SOCKET_CLOSED'),
  needs_action: go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_OPEN', 'HUB_ERROR'),
  stopped: go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_OPEN', 'WELCOME', 'SYNCED', 'DISCONNECT'),
};
for (const [name, s] of Object.entries(at)) {
  assert.strictEqual(s.name, name, `fixture ${name}`);
  deepFreeze(s);
}

// Next state name per [state][event]; '=' means the event does not apply and the very same object comes back.
const COLUMNS = ['CONNECT', 'RECONNECT', 'DISCONNECT', 'CONFIG_CHANGED', 'SYNC_CANCELLED', 'RESOLVED', 'RESOLVE_FAILED', 'ATTEMPT', 'SOCKET_OPEN', 'WELCOME', 'SYNCED', 'SOCKET_CLOSED', 'HUB_ERROR'];
const R = 'resolving';
const TABLE = {
  idle: [R, R, '=', '=', '=', '=', '=', '=', '=', '=', '=', '=', '='],
  resolving: ['=', R, 'stopped', R, '=', 'connecting', 'needs_action', '=', '=', '=', '=', '=', '='],
  connecting: ['=', R, 'stopped', R, '=', '=', '=', '=', 'handshaking', '=', '=', 'reconnecting', 'needs_action'],
  handshaking: ['=', R, 'stopped', R, '=', '=', '=', '=', '=', 'syncing', '=', 'reconnecting', 'needs_action'],
  syncing: ['=', R, 'stopped', R, 'stopped', '=', '=', '=', '=', '=', 'live', 'reconnecting', '='],
  live: ['=', R, 'stopped', R, '=', '=', '=', '=', '=', '=', '=', 'reconnecting', '='],
  reconnecting: ['=', R, 'stopped', R, '=', '=', '=', 'reconnecting', 'handshaking', '=', '=', 'reconnecting', '='],
  needs_action: [R, R, 'stopped', R, '=', '=', '=', '=', '=', '=', '=', '=', '='],
  stopped: [     R, R, '=', '=', '=', '=', '=', '=', '=', '=', '=', '=', '='],
};

assert.deepStrictEqual(Object.keys(TABLE), M.STATES, 'table rows are the machine states');
assert.deepStrictEqual([...COLUMNS].sort(), [...M.EVENTS].sort(), 'table columns are the machine events');

let pairs = 0;
for (const state of M.STATES) {
  const s = at[state];
  let exits = 0;
  COLUMNS.forEach((type, i) => {
    const want = TABLE[state][i];
    const e = deepFreeze(event(type, s));
    const next = M.transition(s, e);
    const where = `${state} + ${type}`;
    pairs += 1;
    if (want === '=') {
      assert.strictEqual(next, s, `${where}: expected no change`);
      return;
    }
    exits += 1;
    assert.notStrictEqual(next, s, `${where}: expected a new state object`);
    assert.strictEqual(next.name, want, `${where}: expected ${want}, got ${next.name}`);
    if (next.name === 'needs_action') {
      assert.ok(typeof next.code === 'string' && next.code, `${where}: needs_action without a code`);
      assert.ok(Array.isArray(next.actions) && next.actions.length > 0, `${where}: needs_action without actions`);
      for (const a of next.actions) assert.ok(ACTION_IDS.has(a), `${where}: unknown action ${a}`);
    } else {
      assert.strictEqual(next.code, null, `${where}: code outside needs_action`);
      assert.strictEqual(next.actions, null, `${where}: actions outside needs_action`);
    }
    if (next.name === 'stopped') assert.ok(M.USER_EVENTS.includes(type), `${where}: stopped reached by a system event`);
    if (M.SYSTEM_EVENTS.includes(type)) {
      const stale = M.transition(s, { ...e, session: s.session - 1 });
      assert.strictEqual(stale, s, `${where}: an event from an older session changed the state`);
    }
  });
  assert.ok(exits > 0, `${state} has no exit`);
}
assert.strictEqual(pairs, M.STATES.length * M.EVENTS.length);

// A refusal never retries by itself: needs_action leaves only on a member event.
for (const type of M.SYSTEM_EVENTS) assert.strictEqual(M.transition(at.needs_action, event(type, at.needs_action)), at.needs_action);

// First attempt versus lost connection, from the state and not a flag outside it.
assert.strictEqual(go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_CLOSED').wasLive, false);
assert.strictEqual(go(M.initial, 'CONNECT', 'RESOLVED', 'SOCKET_OPEN', 'SOCKET_CLOSED').wasLive, false);
assert.strictEqual(at.reconnecting.wasLive, true);
const back = go(at.reconnecting, 'ATTEMPT', 'SOCKET_OPEN', 'WELCOME');
assert.strictEqual(back.name, 'syncing');
assert.strictEqual(back.wasLive, true, 'a resync after a drop still counts as the same session');
assert.strictEqual(go(at.reconnecting, 'RECONNECT').wasLive, false, 'a fresh start forgets the old session');
assert.strictEqual(go(at.stopped, 'CONNECT').wasLive, false);

// Retry bookkeeping for the status bar tooltip.
assert.strictEqual(at.reconnecting.nextAt, 1000);
const trying = go(at.reconnecting, 'ATTEMPT');
assert.deepStrictEqual([trying.attempt, trying.nextAt], [1, null]);
const failedAgain = M.transition(trying, { type: 'SOCKET_CLOSED', session: trying.session, retryAt: 5000 });
assert.deepStrictEqual([failedAgain.name, failedAgain.attempt, failedAgain.nextAt], ['reconnecting', 1, 5000]);
assert.deepStrictEqual([go(failedAgain, 'SOCKET_OPEN', 'WELCOME', 'SYNCED').attempt, go(failedAgain, 'SOCKET_OPEN', 'WELCOME', 'SYNCED').nextAt], [0, null]);

// Sessions: a fresh start bumps it and forgets the target, so the old core's late events are dropped.
assert.strictEqual(at.resolving.session, 1);
assert.strictEqual(go(at.live, 'RECONNECT').session, at.live.session + 1);
assert.strictEqual(go(at.live, 'RECONNECT').target, null);
assert.deepStrictEqual(at.live.target, TARGET);
assert.deepStrictEqual(at.needs_action.target, TARGET, 'needs_action keeps the address for its message');
assert.strictEqual(M.transition(go(at.live, 'RECONNECT'), { type: 'SOCKET_CLOSED', session: at.live.session, retryAt: 1 }).name, 'resolving');

// Actions per reason code.
const actions = (code, data = {}) => M.transition(at.handshaking, { type: 'HUB_ERROR', session: at.handshaking.session, code, data }).actions;
assert.deepStrictEqual(actions('token_invalid'), ['paste_invite', 'enter_token', 'diagnose']);
assert.deepStrictEqual(actions('project_unknown', { projects: ['Demo'] }), ['choose_project', 'paste_invite', 'diagnose']);
assert.deepStrictEqual(actions('project_unknown', { projects: [] }), ['paste_invite', 'diagnose']);
assert.deepStrictEqual(actions('account_required'), ['sign_in', 'diagnose']);
assert.deepStrictEqual(actions('account_denied', { account: 'github:x', entry: 'github:x' }), ['copy_entry', 'switch_account', 'diagnose']);
assert.deepStrictEqual(actions('protocol_version', { proto: 2, hubMin: 3, hubMax: 3 }), ['update_extension', 'diagnose']);
assert.deepStrictEqual(actions('protocol_version', { proto: 2, hubMin: 1, hubMax: 1 }), ['reconnect', 'diagnose']);
assert.deepStrictEqual(actions('tls_required'), ['reconnect', 'diagnose']);
assert.deepStrictEqual(actions('', { message: 'protocol 1 sentence' }), ['reconnect', 'diagnose']);
assert.deepStrictEqual(M.transition(at.resolving, { type: 'RESOLVE_FAILED', session: 1, code: 'no_folder' }).actions, ['join']);
assert.deepStrictEqual(M.transition(at.resolving, { type: 'RESOLVE_FAILED', session: 1, code: 'unbound' }).actions, ['join', 'open_settings']);
assert.deepStrictEqual(M.transition(at.handshaking, { type: 'HUB_ERROR', session: at.handshaking.session, code: 'token_invalid' }).data, {}, 'missing data becomes {}');
for (const code of ['no_folder', 'unbound', 'token_invalid', 'project_unknown', 'account_required', 'account_denied', 'protocol_version', 'tls_required', 'other']) {
  assert.ok(M.actionsFor(code, { projects: ['Demo'] }).length <= 3, `${code}: a toast carries at most three buttons`);
}

console.log(`connection-machine: OK (${pairs} state and event pairs)`);
