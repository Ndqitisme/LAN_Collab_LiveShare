// The history view's data: run records as LAN Hub sends them (docs/protocol.md section 12.2), the pages loaded so
// far, and the captions built from them. No Svelte here, so model.test.ts runs it without a compiler.
import type { IconName } from '@lan-collab/ui-kit';

export type Translate = (id: string, args?: Record<string, string | number>) => string;

export interface Run {
  id: string;
  path: string;
  author_uid: string;
  author_name: string;
  color: string;
  source: string;
  kind: 'text' | 'blob';
  started_at: number;
  ended_at: number;
  op_count: number;
  chars_added: number;
  chars_removed: number;
  start_blob: string | null;
  end_blob: string | null;
  reverts: string | null;
  open: boolean;
}

export type Mode = 'file' | 'project';

export type Action = 'openAfter' | 'diffCurrent' | 'diffBefore' | 'copy' | 'revert' | 'restoreFile' | 'restoreVersion';

// One page per request; the host asks LAN Hub for the largest page it serves.
export const PAGE_SIZE = 200;

// Binary versions whose size the view asks for on its own, newest first: each one is a blob fetch.
export const SIZE_LOOKUPS = 20;

// Binary versions of the shown runs whose size is not known or asked for yet.
export function sizesToAsk(runs: Run[], asked: Record<string, unknown>): string[] {
  return runs.filter((r) => r.kind === 'blob' && r.end_blob && !(r.id in asked)).slice(0, SIZE_LOOKUPS).map((r) => r.id);
}

// The path a list request names: one file, or null for the whole project. Null too when no file is open.
export function listPath(mode: Mode, activePath: string | null): string | null {
  return mode === 'file' ? activePath : null;
}

// Whether a history_changed for `path` concerns what the view shows.
export function concerns(mode: Mode, activePath: string | null, path: string): boolean {
  return mode === 'project' || path === activePath;
}

const newer = (a: Run, b: Run) => Number(b.id) - Number(a.id);

// Merges a page into the runs shown, newest first, one entry per id. A first page (no `before`) replaces what it
// covers: when it says no older runs exist the list ends with it, otherwise runs already loaded below it stay.
export function mergePage(shown: Run[], page: Run[], before: string | null, more: boolean): Run[] {
  if (before === null) {
    if (!more || !page.length) return page.slice().sort(newer);
    const oldest = Math.min(...page.map((r) => Number(r.id)));
    return [...page, ...shown.filter((r) => Number(r.id) < oldest)].sort(newer);
  }
  const ids = new Set(page.map((r) => r.id));
  return [...shown.filter((r) => !ids.has(r.id)), ...page].sort(newer);
}

// What a member can do with a run. Binary files only go back to a stored version; a deleted file comes back whole.
export function actionsFor(run: Run): Action[] {
  if (run.source === 'delete') return run.kind === 'text' ? ['restoreFile', 'openAfter', 'copy'] : ['restoreFile'];
  if (run.kind === 'blob') return run.end_blob ? ['restoreVersion'] : [];
  // An open run ends at today's text, so comparing it with today's text shows nothing.
  return run.open ? ['openAfter', 'diffBefore', 'copy', 'revert'] : ['openAfter', 'diffCurrent', 'diffBefore', 'copy', 'revert'];
}

export function actionLabel(action: Action, run: Run, t: Translate): string {
  switch (action) {
    case 'openAfter': return run.source === 'delete' ? t('history.action.openDeleted') : t('history.action.openAfter');
    case 'diffCurrent': return t('history.action.diffCurrent');
    case 'diffBefore': return t('history.action.diffBefore');
    case 'copy': return t('history.action.copy');
    case 'revert': return t('history.action.revert');
    case 'restoreFile': return t('history.action.restoreFile');
    default: return t('history.action.restoreVersion');
  }
}

export function actionIcon(action: Action): IconName {
  switch (action) {
    case 'openAfter': return 'eye';
    case 'diffCurrent': return 'file-text';
    case 'diffBefore': return 'history';
    case 'copy': return 'copy';
    case 'revert': return 'rotate-ccw';
    default: return 'download';
  }
}

export interface SourceView {
  label: string;
  tooltip: string;
  icon: IconName;
  tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
}

export function sourceView(source: string, t: Translate): SourceView {
  switch (source) {
    case 'disk': return { label: t('history.source.disk'), tooltip: t('history.source.disk.tooltip'), icon: 'terminal', tone: 'warn' };
    case 'revert': return { label: t('history.source.revert'), tooltip: t('history.source.revert.tooltip'), icon: 'rotate-ccw', tone: 'accent' };
    case 'merge': return { label: t('history.source.merge'), tooltip: t('history.source.merge.tooltip'), icon: 'refresh-cw', tone: 'neutral' };
    case 'delete': return { label: t('history.source.delete'), tooltip: t('history.source.delete.tooltip'), icon: 'file-minus', tone: 'danger' };
    default: return { label: t('history.source.editor'), tooltip: t('history.source.editor.tooltip'), icon: 'pencil', tone: 'neutral' };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const day = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// "14:05", "14:05 – 14:12", with the date in front when the run did not start today on this machine's clock.
export function timeRange(start: number, end: number, now: number, t: Translate): string {
  const s = new Date(start);
  const e = new Date(end);
  const from = sameDay(s, new Date(now)) ? clock(s) : `${day(s)} ${clock(s)}`;
  if (clock(s) === clock(e) && sameDay(s, e)) return from;
  return t('history.time.range', { start: from, end: sameDay(s, e) ? clock(e) : `${day(e)} ${clock(e)}` });
}

const seconds = (d: Date) => `${clock(d)}:${pad(d.getSeconds())}`;
const fullDay = (d: Date) => `${day(d)}/${d.getFullYear()}`;

// The exact span for the detail and the row tooltip: the date once, to the second.
export function exactTime(start: number, end: number, t: Translate): string {
  const s = new Date(start);
  const e = new Date(end);
  const from = `${fullDay(s)} ${seconds(s)}`;
  if (!sameDay(s, e)) return t('history.time.range', { start: from, end: `${fullDay(e)} ${seconds(e)}` });
  return seconds(s) === seconds(e) ? from : t('history.time.range', { start: from, end: seconds(e) });
}

// Bytes in the copy guide's form: a space before the unit and a decimal comma.
export function sizeText(bytes: number, t: Translate): string {
  if (bytes < 1024) return t('history.size.bytes', { n: bytes });
  const kb = bytes / 1024;
  if (kb < 1024) return t('history.size.kb', { n: decimal(kb) });
  return t('history.size.mb', { n: decimal(kb / 1024) });
}

function decimal(n: number): string {
  return (n < 10 ? n.toFixed(1) : String(Math.round(n))).replace(/\.0$/, '').replace('.', ',');
}

export interface RowView {
  id: string;
  author: string;
  color: string;
  start: number;
  time: string;
  timeTitle: string;
  source: SourceView;
  added: number;
  removed: number;
  path: string;
  open: boolean;
  binary: boolean;
  // The stored size of a binary version, once the host has read it.
  size: string | null;
}

export function rowView(run: Run, now: number, t: Translate, bytes: number | null = null): RowView {
  return {
    id: run.id,
    author: run.author_name,
    color: run.color,
    start: run.started_at,
    time: timeRange(run.started_at, run.ended_at, now, t),
    timeTitle: exactTime(run.started_at, run.ended_at, t),
    source: sourceView(run.source, t),
    added: run.chars_added,
    removed: run.chars_removed,
    path: run.path,
    open: run.open,
    binary: run.kind === 'blob',
    size: run.kind === 'blob' && bytes !== null ? sizeText(bytes, t) : null,
  };
}
