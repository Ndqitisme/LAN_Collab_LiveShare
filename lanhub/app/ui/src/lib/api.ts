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
