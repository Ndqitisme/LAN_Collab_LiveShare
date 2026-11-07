// The connection panel's data: what the host posts and the rows, captions and action lists built from it. No
// Svelte here, so state.test.ts runs it without a compiler.

export type Translate = (id: string, args?: Record<string, string | number>) => string;

// lib/diagnostics.js STEPS, in order.
export const STEPS = ['config', 'addresses', 'discovery', 'network', 'tls', 'handshake', 'folder', 'rtt'] as const;
export type Step = (typeof STEPS)[number];

export type StepStatus = 'ok' | 'fixed' | 'failed' | 'skipped';

// One result of lib/diagnostics.js runChecks; remedy.text is already rendered by the host.
export interface StepResult {
  step: Step;
  status: StepStatus;
  code: string | null;
  data: Record<string, unknown>;
  remedy: { text: string; actions: string[] } | null;
}

export interface Diagnosis {
  running: boolean;
  results: StepResult[];
  at: number | null;
}

export interface Hub {
  instanceId: string;
  hubName: string;
  hosts: string[];
  port: number;
  tls: boolean;
  projects: string[];
}

export interface Hubs {
  searching: boolean;
  list: Hub[];
}

export interface Target {
  host: string;
  port: number;
  project: string;
}

// The connection machine's state as the host posts it.
export interface Status {
  name: string;
  target: Target | null;
  code: string | null;
  reason: string | null;
  nextAt: number | null;
  wasLive: boolean;
  rtt: number | null;
  members: number | null;
}

export interface Conn {
  source: 'join' | 'settings';
  host: string;
  addresses: string[];
  port: number;
  project: string;
  fingerprint: string | null;
  instanceId: string | null;
  hasToken: boolean;
}

export interface Snapshot {
  folder: { name: string; path: string } | null;
  conn: Conn | null;
  status: Status;
  discoveryPort: number;
}

export type RowState = StepStatus | 'running' | 'pending';
export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';

export interface Action {
  id: string;
  label: string;
}

export interface StepRow {
  step: Step;
  title: string;
  state: RowState;
  label: string;
  tone: Tone;
  remedy: string | null;
  actions: Action[];
  result: StepResult | null;
}

const NETWORK = new Set(['refused', 'timeout', 'unreachable', 'failed', 'not_found']);
// A firewall on the hub machine shows as a refused or silent port, or as no discovery reply.
const FIREWALL = new Set(['refused', 'timeout', 'not_found']);

// The panel's actions for a failed step: the remedy's own ids first, the one that solves it leading, then the
// panel's repairs for a network failure. Kết nối lại becomes Thử lại, which reruns the steps and reconnects.
export function stepActions(r: StepResult): string[] {
  if (r.status !== 'failed' || !r.remedy) return [];
  const ids = r.remedy.actions.map((id) => (id === 'reconnect' ? 'retry' : id === 'join' ? 'paste_invite' : id));
  if (r.code && NETWORK.has(r.code)) {
    if (!ids.includes('retry')) ids.unshift('retry');
    ids.push('rediscover');
    if (FIREWALL.has(r.code)) ids.push('firewall');
  }
  return [...new Set(ids)];
}

export function actionLabel(id: string, t: Translate): string {
  switch (id) {
    case 'retry': return t('connection.action.retry');
    case 'rediscover': return t('connection.action.rediscover');
    case 'firewall': return t('connection.action.firewall');
    case 'paste_invite': return t('action.paste_invite');
    case 'open_settings': return t('action.open_settings');
    case 'enter_token': return t('action.enter_token');
    case 'choose_project': return t('action.choose_project');
    case 'sign_in': return t('action.sign_in');
    case 'switch_account': return t('action.switch_account');
    case 'copy_entry': return t('action.copy_entry');
    case 'update_extension': return t('action.update_extension');
    default: return t('action.diagnose');
  }
}

export function stepTitle(step: Step, t: Translate): string {
  switch (step) {
    case 'config': return t('diag.step.config');
    case 'addresses': return t('diag.step.addresses');
    case 'discovery': return t('diag.step.discovery');
    case 'network': return t('diag.step.network');
    case 'tls': return t('diag.step.tls');
    case 'handshake': return t('diag.step.handshake');
    case 'folder': return t('diag.step.folder');
    default: return t('diag.step.rtt');
  }
}

function rowLabel(state: RowState, t: Translate): string {
  switch (state) {
    case 'ok': return t('diag.status.ok');
    case 'fixed': return t('diag.status.fixed');
    case 'failed': return t('diag.status.failed');
    case 'skipped': return t('diag.status.skipped');
    case 'running': return t('connection.diag.step.running');
    default: return t('connection.diag.step.pending');
  }
}

const TONES: Record<RowState, Tone> = { ok: 'ok', fixed: 'warn', failed: 'danger', skipped: 'muted', running: 'accent', pending: 'muted' };

// What a passed step found, in one short line.
function stepNote(r: StepResult, t: Translate): string | null {
  const d = r.data;
  if (r.step === 'rtt' && typeof d.ms === 'number') return t('connection.diag.note.rtt', { ms: d.ms });
  if (r.status === 'fixed' && typeof d.host === 'string') return t('connection.diag.note.fixed', { host: d.host, port: Number(d.port) });
  if (r.step === 'addresses' && typeof d.host === 'string' && r.status === 'ok') return t('connection.diag.note.reached', { host: d.host, port: Number(d.port) });
  if (r.step === 'handshake' && typeof d.hubName === 'string' && d.hubName) return t('connection.diag.note.hub', { hub: d.hubName });
  return null;
}

// The failed step that stopped the run: earlier failures (a dead address before rediscovery) lead up to it.
function decisive(results: StepResult[]): StepResult | null {
  return results.filter((r) => r.status === 'failed').pop() ?? null;
}

// Every step as a row: the results so far, the step under way, then the steps still waiting. Only the decisive
// failure carries actions, and guidance a later step repeats is shown once, on that step.
export function stepRows(diag: Diagnosis, t: Translate): StepRow[] {
  const last = decisive(diag.results);
  return STEPS.map((step, i) => {
    const result = diag.results.find((r) => r.step === step) ?? null;
    const state: RowState = result ? result.status : diag.running && i === diag.results.length ? 'running' : 'pending';
    const ids = result && result === last ? stepActions(result) : [];
    const repeated = (text: string) => diag.results.slice(diag.results.indexOf(result as StepResult) + 1).some((r) => r.remedy?.text === text);
    let remedy: string | null = null;
    if (result && result.remedy && (result.status === 'failed' || result.code) && !repeated(result.remedy.text)) remedy = result.remedy.text;
    else if (result && (result.status === 'ok' || result.status === 'fixed')) remedy = stepNote(result, t);
    return {
      step,
      title: stepTitle(step, t),
      state,
      label: rowLabel(state, t),
      tone: TONES[state],
      remedy,
      actions: ids.map((id) => ({ id, label: actionLabel(id, t) })),
      result,
    };
  });
}

// The run's outcome in one line, or null while nothing has run.
export function diagSummary(diag: Diagnosis, t: Translate): string | null {
  if (diag.running) return t('connection.diag.running');
  if (!diag.results.length) return null;
  const failed = decisive(diag.results);
  if (failed) return t('connection.diag.summary.failed', { step: stepTitle(failed.step, t) });
  return t('connection.diag.summary.ok');
}

export type StatusDotState = 'live' | 'connecting' | 'offline' | 'error' | 'idle';

export interface StatusView {
  dot: StatusDotState;
  label: string;
  detail: string | null;
}

function retryTime(nextAt: number | null): string | null {
  return nextAt ? new Date(nextAt).toLocaleTimeString('vi-VN') : null;
}

export function statusView(s: Status, t: Translate): StatusView {
  switch (s.name) {
    case 'live':
      return { dot: 'live', label: t('connection.state.live'), detail: null };
    case 'resolving':
      return { dot: 'connecting', label: t('connection.state.resolving'), detail: null };
    case 'connecting':
    case 'handshaking':
      return { dot: 'connecting', label: t('connection.state.connecting'), detail: null };
    case 'syncing':
      return { dot: 'connecting', label: t('connection.state.syncing'), detail: null };
    case 'reconnecting': {
      const time = retryTime(s.nextAt);
      return { dot: 'error', label: t('connection.state.reconnecting'), detail: time ? t('connection.status.retryAt', { time }) : null };
    }
    case 'needs_action':
      return { dot: 'error', label: t('connection.state.needs_action'), detail: s.reason };
    case 'stopped':
      return { dot: 'offline', label: t('connection.state.stopped'), detail: null };
    default:
      return { dot: 'idle', label: t('connection.state.idle'), detail: null };
  }
}

// States in which a connection is under way or up (lib/connection-machine.js ACTIVE).
export const ACTIVE = new Set(['resolving', 'connecting', 'handshaking', 'syncing', 'live', 'reconnecting']);

export interface ManualForm {
  host: string;
  port: string;
  project: string;
}

export interface FormErrors {
  host?: string;
  port?: string;
  project?: string;
}

export function validateForm(f: ManualForm, t: Translate): FormErrors {
  const errors: FormErrors = {};
  if (!f.host.trim() || /\s|:/.test(f.host.trim())) errors.host = t('connection.error.host');
  const port = Number(f.port);
  if (!/^\d+$/.test(f.port.trim()) || port < 1 || port > 65535) errors.port = t('connection.error.port');
  if (!f.project.trim()) errors.project = t('connection.error.project');
  return errors;
}

// A pasted "IP:port" in the address field fills both fields.
export function splitHostPort(value: string): { host: string; port: string | null } {
  const m = /^\s*([^\s:]+):(\d{1,5})\s*$/.exec(value);
  return m ? { host: m[1], port: m[2] } : { host: value, port: null };
}

const LOOPBACK = /^(127\.|::1$|localhost$)/;

// A hub answers from loopback and from its LAN address on its own machine: the LAN address reads better.
export function hubAddress(h: Hub): string {
  const host = h.hosts.find((a) => !LOOPBACK.test(a)) ?? h.hosts[0] ?? '';
  return `${host}:${h.port}`;
}

// The port the firewall guide opens: the one the failing step tried, else the folder's.
export function firewallPort(diag: Diagnosis, conn: Conn | null): number {
  const failed = diag.results.find((r) => r.status === 'failed' && typeof r.data.port === 'number');
  if (failed) return failed.data.port as number;
  return conn ? conn.port : 8200;
}
