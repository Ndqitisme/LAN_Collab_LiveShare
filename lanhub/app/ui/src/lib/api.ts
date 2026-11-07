// The one door to the Rust side: typed wrappers over the Tauri commands in src-tauri/src/commands.rs and
// the events it emits. The shapes mirror status.rs and config_file.rs.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type HubState = 'starting' | 'running' | 'bindError' | 'configError';
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
  field: 'name' | 'root' | 'allow' | 'exclude' | 'idleMinutes' | 'keepDays' | 'maxMb' | null;
  params: Record<string, string>;
}

export interface HistoryInput {
  idleMinutes: number;
  keepDays: number;
  maxMb: number;
}

export interface ProjectSettings {
  token: string;
  allow: string[];
  allowFile: string | null;
  exclude: string[];
  defaultExclude: string[];
  historyEnabled: boolean;
  history: HistoryInput;
}

export interface ExcludePreview {
  files: string[];
  total: number;
  scanned: number;
}

export interface HistoryUsage {
  dbBytes: number;
  blobBytes: number;
  blobCount: number;
  runs: number;
}

export interface RetentionReport {
  runsDeleted: number;
  blobsDeleted: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface InviteCodes {
  code: string | null;
  hosts: string[];
  port: number;
  tls: boolean;
  legacy: { host: string; code: string }[];
}

export interface ClientInfo {
  id: string;
  name: string;
  account: string | null;
  addr: string;
  joinedAt: number;
  rtt: number | null;
  file: string | null;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRecord {
  seq: number;
  ts: number;
  level: LogLevel;
  project: string | null;
  msg: string;
}

export interface LegacyProject {
  name: string;
  token: string;
  allow: string[];
  root: string | null;
  exists: boolean;
}

export interface ImportInput {
  name: string;
  root: string;
  token: string;
  allow: string[];
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

  projectSettings: (name: string) => invoke<ProjectSettings>('project_settings', { name }),
  rotateToken: (name: string) => invoke<string>('rotate_token', { name }),
  setAllow: (name: string, lines: string[]) => invoke<void>('set_allow', { name, lines }),
  setExclude: (name: string, lines: string[]) => invoke<void>('set_exclude', { name, lines }),
  previewExclude: (name: string, lines: string[]) => invoke<ExcludePreview>('preview_exclude', { name, lines }),
  setHistory: (name: string, history: HistoryInput) => invoke<void>('set_history', { name, history }),
  historyUsage: (name: string) => invoke<HistoryUsage | null>('history_usage', { name }),
  runRetention: (name: string) => invoke<RetentionReport>('run_retention', { name }),
  inviteCodes: (name: string) => invoke<InviteCodes>('invite_codes', { name }),
  clients: (name: string) => invoke<ClientInfo[]>('project_clients', { name }),
  logs: (after: number, limit: number) => invoke<LogRecord[]>('get_logs', { after, limit }),
  exportLogs: (title: string, filter: string, fileName: string, text: string) =>
    invoke<string | null>('export_logs', { title, filter, fileName, text }),
  scanLegacy: (dir: string) => invoke<LegacyProject[]>('scan_legacy', { dir }),
  importLegacy: (items: ImportInput[]) => invoke<string[]>('import_legacy', { items }),
};

export function onStatus(fn: (s: Snapshot) => void): Promise<UnlistenFn> {
  return listen<Snapshot>('hub-status', (e) => fn(e.payload));
}

export function onNotice(fn: (n: Notice) => void): Promise<UnlistenFn> {
  return listen<Notice>('notice', (e) => fn(e.payload));
}
