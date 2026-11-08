'use strict';

// The connection's single source of truth (docs/plans/README.md section 5.7). transition() is pure: the
// extension's controller feeds it events from the member, the config resolver and lib/client-core.js, then runs
// the side effects of the state it lands in. Every UI surface reads the state the controller publishes.
const STATES = ['idle', 'resolving', 'connecting', 'handshaking', 'syncing', 'live', 'reconnecting', 'needs_action', 'stopped'];

// Member actions. The rest come from the resolver or from the client core of the current session.
const USER_EVENTS = ['CONNECT', 'RECONNECT', 'DISCONNECT', 'CONFIG_CHANGED', 'SYNC_CANCELLED'];
const SYSTEM_EVENTS = ['RESOLVED', 'RESOLVE_FAILED', 'ATTEMPT', 'SOCKET_OPEN', 'WELCOME', 'SYNCED', 'SOCKET_CLOSED', 'HUB_ERROR'];
const EVENTS = [...USER_EVENTS, ...SYSTEM_EVENTS];

// States in which a client core exists and owns a socket or a retry timer.
const WITH_CORE = new Set(['connecting', 'handshaking', 'syncing', 'live', 'reconnecting']);
const ACTIVE = new Set(['resolving', ...WITH_CORE]);

const initial = Object.freeze({
  name: 'idle',
  session: 0, // bumped on every fresh start; events stamped with an older session are stale
  target: null, // {host, port, project} once resolved
  wasLive: false, // this session reached live at least once: a drop is a lost connection, not a first attempt
  attempt: 0, // reconnect attempts since the last drop
  nextAt: null, // epoch ms of the next reconnect attempt, null while one is running
  code: null, // needs_action only
  data: null,
  actions: null,
});

// Which side a protocol_version refusal asks to update. `proto` is this client's, `hubMin` the hub's.
function updateSide(data) {
  return data.proto < data.hubMin ? 'extension' : 'hub';
}

// Action ids per reason code, the one that solves the problem first. The extension maps each id to a caption
// and a handler. Codes this client does not know (and protocol 1 hubs, which send a sentence) get the default.
function actionsFor(code, data) {
  switch (code) {
    case 'no_folder': return ['join'];
    case 'unbound': return ['join', 'open_settings'];
    case 'token_invalid': return ['paste_invite', 'enter_token', 'diagnose'];
    case 'project_unknown': return Array.isArray(data.projects) && data.projects.length
      ? ['choose_project', 'paste_invite', 'diagnose']
      : ['paste_invite', 'diagnose'];
    case 'account_required': return ['sign_in', 'diagnose'];
    case 'account_denied': return ['copy_entry', 'switch_account', 'diagnose'];
    case 'protocol_version': return updateSide(data) === 'extension' ? ['update_extension', 'diagnose'] : ['reconnect', 'diagnose'];
    // A changed certificate is fixed only by a new invite, which carries the new fingerprint.
    case 'tls_mismatch': return ['paste_invite', 'diagnose'];
    case 'no_instance': return ['paste_invite'];
    case 'folder_other_project': return ['join', 'diagnose'];
    default: return ['reconnect', 'diagnose'];
  }
}

function transition(s, e) {
  if (e.session !== undefined && e.session !== s.session) return s;
  const to = (name, patch) => ({ ...s, name, ...patch });
  const fresh = () => ({ ...initial, name: 'resolving', session: s.session + 1 });
  const stopped = () => ({ ...initial, name: 'stopped', session: s.session });
  const needsAction = () => {
    const data = e.data || {};
    return to('needs_action', { attempt: 0, nextAt: null, code: e.code, data, actions: actionsFor(e.code, data) });
  };
  switch (e.type) {
    case 'CONNECT': return ACTIVE.has(s.name) ? s : fresh();
    case 'RECONNECT': return fresh();
    case 'DISCONNECT': return s.name === 'idle' || s.name === 'stopped' ? s : stopped();
    case 'CONFIG_CHANGED': return ACTIVE.has(s.name) || s.name === 'needs_action' ? fresh() : s;
    case 'SYNC_CANCELLED': return s.name === 'syncing' ? stopped() : s;
    case 'RESOLVED': return s.name === 'resolving' ? to('connecting', { target: e.target }) : s;
    case 'RESOLVE_FAILED': return s.name === 'resolving' ? needsAction() : s;
    // Any refusal the core cannot retry: the hub's `error`, and on a reconnect a changed TLS certificate. Accepted
    // in every state with a core, so a core that stopped never leaves the machine showing a live connection.
    case 'HUB_ERROR': return WITH_CORE.has(s.name) ? needsAction() : s;
    case 'ATTEMPT': return s.name === 'reconnecting' ? to('reconnecting', { attempt: s.attempt + 1, nextAt: null }) : s;
    case 'SOCKET_OPEN': return s.name === 'connecting' || s.name === 'reconnecting' ? to('handshaking') : s;
    case 'WELCOME': return s.name === 'handshaking' ? to('syncing') : s;
    case 'SYNCED': return s.name === 'syncing' ? to('live', { wasLive: true, attempt: 0, nextAt: null }) : s;
    case 'SOCKET_CLOSED': return WITH_CORE.has(s.name) ? to('reconnecting', { nextAt: e.retryAt === undefined ? null : e.retryAt }) : s;
    default: return s;
  }
}

module.exports = { STATES, EVENTS, USER_EVENTS, SYSTEM_EVENTS, WITH_CORE, ACTIVE, initial, transition, actionsFor, updateSide };
