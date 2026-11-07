// App-wide reactive state: the latest hub snapshot, toasts, a clock for relative times, and the theme.
import { api, isAppError, onNotice, onStatus, type Snapshot } from './api';
import { t, tDynamic, type Key, type Params } from '../i18n';

export const hub = $state<{ snap: Snapshot | null }>({ snap: null });

export async function connect(): Promise<void> {
  await onStatus((s) => (hub.snap = s));
  await onNotice((n) => toast(n.error ? 'danger' : 'ok', tDynamic(n.code, n.params)));
  const first = await api.status();
  hub.snap ??= first;
}

export interface ToastItem {
  id: number;
  tone: 'info' | 'ok' | 'warn' | 'danger';
  title: string;
  message?: string;
}

export const toasts = $state<ToastItem[]>([]);
let nextToast = 1;

export function toast(tone: ToastItem['tone'], title: string, message?: string): void {
  const id = nextToast++;
  toasts.push({ id, tone, title, message });
  if (toasts.length > 3) toasts.shift();
  setTimeout(() => dismiss(id), tone === 'danger' ? 8000 : 4000);
}

export function dismiss(id: number): void {
  const at = toasts.findIndex((x) => x.id === id);
  if (at >= 0) toasts.splice(at, 1);
}

export function errorText(e: unknown): string {
  return isAppError(e) ? tDynamic(`errors.${e.code}`, e.params) : t('errors.generic');
}

/** Runs a command and turns its error into a danger toast. Resolves to whether it succeeded. */
export async function attempt(run: () => Promise<unknown>, ok?: [Key, Params?]): Promise<boolean> {
  try {
    await run();
    if (ok) toast('ok', t(ok[0], ok[1]));
    return true;
  } catch (e) {
    toast('danger', errorText(e));
    return false;
  }
}

/** Ticks every 15 seconds so "3 phút trước" stays current without a timer per card. */
export const clock = $state({ now: Date.now() });
setInterval(() => (clock.now = Date.now()), 15000);

export type ThemeChoice = 'system' | 'light' | 'dark';
const THEME_KEY = 'lanhub.theme';

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const theme = $state({ choice: readTheme() });

export function applyTheme(): void {
  const root = document.documentElement;
  if (theme.choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme.choice;
}

export function cycleTheme(): void {
  const order: ThemeChoice[] = ['system', 'light', 'dark'];
  theme.choice = order[(order.indexOf(theme.choice) + 1) % order.length];
  try {
    localStorage.setItem(THEME_KEY, theme.choice);
  } catch {
    // Storage can be unavailable; the choice then lasts until the window reloads.
  }
  applyTheme();
}
