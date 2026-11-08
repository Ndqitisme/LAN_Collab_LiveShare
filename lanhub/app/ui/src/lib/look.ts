import type { Key } from '../i18n';
import type { ProjectState } from './api';

export interface Look {
  dot: 'live' | 'connecting' | 'offline' | 'error' | 'idle';
  tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
  label: Key;
}

const looks: Record<ProjectState, Look> = {
  running: { dot: 'live', tone: 'ok', label: 'status.running' },
  starting: { dot: 'connecting', tone: 'warn', label: 'status.starting' },
  disabled: { dot: 'offline', tone: 'neutral', label: 'status.disabled' },
  failed: { dot: 'error', tone: 'danger', label: 'status.failed' },
};

export function stateLook(state: ProjectState): Look {
  return looks[state];
}
