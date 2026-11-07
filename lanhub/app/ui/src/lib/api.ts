// The one door to the Rust side: typed wrappers over the Tauri commands in src-tauri/src/commands.rs and
// the events it emits. The shapes mirror status.rs and config_file.rs.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type HubState = 'starting' | 'running' | 'bindError' | 'configError' | 'offline';
export type ProjectState = 'starting' | 'running' | 'disabled' | 'failed';

export interface HubView {
  state: HubState;
  bind: string;
  port: number;
  addresses: string[];
  configPath: string;
  configLine: number | null;
  configMessage: string | null;
}

export interface ProjectView {
  name: string;
  root: string;
  state: ProjectState;
  enabled: boolean;
  advertise: boolean;
  error: string | null;
  rootMissing: boolean;
  files: number | null;
  clients: number;
  /** Operations per second over the last 10 seconds. */
  rate: number;
  lastActivity: number | null;
  startedAt: number | null;
}

export interface Snapshot {
  hub: HubView;
  projects: ProjectView[];
  /** The remote hub this snapshot is of; null for this machine's hub. */
  hubId: string | null;
  /** Why the remote hub is offline. */
  remoteError: AppError | null;
}

export interface ProjectInput {
  name: string;
  root: string;
  enabled: boolean;
  advertise: boolean;
}

/** `code` is a key under `errors` in vi.json; `field` is the form field it belongs to. */
export interface AppError {
  code: string;
  field: 'name' | 'root' | null;
  params: Record<string, string>;
}

/** A tray action's result: `code` is a full vi.json key. */
export interface Notice {
  code: string;
  params: Record<string, string>;
  error: boolean;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e;
}

export const api = {
  status: () => invoke<Snapshot>('get_status'),
  uiReady: () => invoke<void>('ui_ready'),
  addProject: (input: ProjectInput) => invoke<void>('add_project', { input }),
  updateProject: (original: string, input: ProjectInput) => invoke<void>('update_project', { original, input }),
  setEnabled: (name: string, enabled: boolean) => invoke<void>('set_project_enabled', { name, enabled }),
  removeProject: (name: string) => invoke<void>('remove_project', { name }),
  pickFolder: (title: string, start: string | null) => invoke<string | null>('pick_folder', { title, start }),
  copyInvite: (name: string) => invoke<void>('copy_invite', { name }),
  copyText: (text: string) => invoke<void>('copy_text', { text }),
  openFolder: (path: string) => invoke<void>('open_folder', { path }),
  reload: () => invoke<void>('reload_config'),
};

export function onStatus(fn: (s: Snapshot) => void): Promise<UnlistenFn> {
  return listen<Snapshot>('hub-status', (e) => fn(e.payload));
}

export function onNotice(fn: (n: Notice) => void): Promise<UnlistenFn> {
  return listen<Notice>('notice', (e) => fn(e.payload));
}

// Hub settings screen: src-tauri/src/settings.rs, autostart.rs and the shapes of service.rs and firewall.rs.

export interface HubSettingsView {
  name: string;
  hostname: string;
  bind: string;
  port: number;
  discovery: boolean;
  discoveryPort: number;
  tls: boolean;
  tlsCert: string;
  tlsKey: string;
  publicAddress: string[];
  fingerprint: string | null;
}

export type HubInput = Omit<HubSettingsView, 'hostname' | 'fingerprint'>;

/** The form field a hub settings error belongs to. */
export type HubField = 'name' | 'bind' | 'port' | 'discoveryPort' | 'publicAddress' | 'tls';

export interface InviteView {
  name: string;
  code: string;
}

export type RuleState =
  | { state: 'present'; rule: string }
  | { state: 'missing' }
  | { state: 'disabled' }
  | { state: 'blocked'; rule: string; program: boolean };

export interface RuleCheck {
  protocol: 'TCP' | 'UDP';
  port: number;
  name: string;
  state: RuleState;
}

export interface FirewallReport {
  rules: RuleCheck[];
  /** netsh commands without the leading `netsh`. */
  commands: string[];
  english: boolean;
}

export interface FirewallResult {
  report: FirewallReport;
  outcome: 'nothing' | 'done' | 'declined' | 'failed';
}

export const hubApi = {
  settings: () => invoke<HubSettingsView>('get_hub_settings'),
  update: (input: HubInput) => invoke<HubSettingsView>('update_hub', { input }),
  invites: () => invoke<InviteView[]>('invite_codes'),
  pickFile: (title: string, start: string | null) => invoke<string | null>('pick_file', { title, start }),
  firewallStatus: () => invoke<FirewallReport>('firewall_status'),
  openFirewall: () => invoke<FirewallResult>('open_firewall'),
  autostart: () => invoke<boolean>('get_autostart'),
  setAutostart: (enabled: boolean) => invoke<boolean>('set_autostart', { enabled }),
};

// Remote hubs: src-tauri/src/hubs.rs and the shapes of remote.rs and admin_remote.rs.

export interface RemoteView {
  id: string;
  label: string;
  address: string;
  fingerprint: string | null;
  /** null until the app has tried to connect. */
  online: boolean | null;
}

export interface HubsView {
  /** null is this machine's hub. */
  selected: string | null;
  remotes: RemoteView[];
}

export interface Probe {
  tls: boolean;
  fingerprint: string | null;
}

export interface RemoteInput {
  label: string;
  host: string;
  port: number;
  token: string;
  fingerprint: string;
}

export const hubsApi = {
  list: () => invoke<HubsView>('list_hubs'),
  select: (id: string | null) => invoke<Snapshot>('select_hub', { id }),
  probe: (host: string, port: number) => invoke<Probe>('probe_remote', { host, port }),
  add: (input: RemoteInput) => invoke<Snapshot>('add_remote', { input }),
  remove: (id: string) => invoke<HubsView>('remove_remote', { id }),
};
