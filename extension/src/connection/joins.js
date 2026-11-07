'use strict';

// The hub each folder joined by invite, in globalState `lanCollab.joins` keyed by folder key. Schema 2 says where
// the hub is and never holds the token, which lives in SecretStorage (secrets.js):
// {v: 2, instanceId, addresses, lastGood, port, project, tlsFingerprint}. A 0.1 record {host, port, project, token}
// reads as schema 2 until secrets.js migrates it.
const KEY = 'lanCollab.joins';

function fromInvite(inv) {
  return {
    v: 2,
    instanceId: inv.instanceId || null,
    addresses: inv.hosts,
    lastGood: null,
    port: inv.port,
    project: inv.project,
    tlsFingerprint: inv.fingerprint || null,
  };
}

function fromV1(r) {
  return { v: 2, instanceId: null, addresses: [r.host], lastGood: null, port: r.port, project: r.project, tlsFingerprint: null };
}

const all = (globalState) => globalState.get(KEY) || {};

function get(globalState, key) {
  const r = all(globalState)[key];
  if (!r) return null;
  return r.v === 2 ? r : fromV1(r);
}

// The token a 0.1 record still holds when its migration could not finish.
function legacyToken(globalState, key) {
  const r = all(globalState)[key];
  return r && r.v !== 2 && typeof r.token === 'string' ? r.token : undefined;
}

async function put(globalState, key, record) {
  await globalState.update(KEY, { ...all(globalState), [key]: record });
}

async function update(globalState, key, patch) {
  const r = get(globalState, key);
  if (r) await put(globalState, key, { ...r, ...patch });
}

module.exports = { KEY, fromInvite, fromV1, all, get, legacyToken, put, update };
