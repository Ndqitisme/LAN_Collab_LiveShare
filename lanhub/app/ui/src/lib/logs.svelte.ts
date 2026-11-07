// The log lines the Logs tab shows, pulled from the hub's ring of structured records. Polling starts when
// the tab first opens and keeps the newest MAX lines, more than the ring holds, so a long session can be
// searched and exported. The array is plain; `logState.version` is what views depend on.
import { api, type LogLevel, type LogRecord } from './api';

const MAX = 50_000;
const BATCH = 5_000;
const EVERY = 500;

export interface LogLine {
  seq: number;
  ts: number;
  level: LogLevel;
  project: string | null;
  /** The message without its level tag, which the row shows as a badge. */
  text: string;
  /** Lowercased message and project, for search. */
  haystack: string;
  /** The line as the hub wrote it to stdout, for export. */
  raw: string;
}

let lines: LogLine[] = [];
let after = 0;
let started = false;

export const logState = $state({ version: 0 });

/** Oldest first; read `logState.version` in the same reactive scope to follow new lines. */
export function logLines(): readonly LogLine[] {
  return lines;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function stamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function line(r: LogRecord): LogLine {
  const text = r.level === 'info' ? r.msg : r.msg.replace(/^\[[^\]]*\]\s*/, '');
  return {
    seq: r.seq,
    ts: r.ts,
    level: r.level,
    project: r.project,
    text,
    haystack: `${r.project ?? ''}\n${text}`.toLowerCase(),
    raw: `${stamp(r.ts)} ${r.project ? `[${r.project}] ` : ''}${r.msg}`,
  };
}

async function pull(): Promise<void> {
  let added = false;
  for (;;) {
    const batch = await api.logs(after, BATCH);
    if (batch.length === 0) break;
    after = batch[batch.length - 1].seq;
    for (const r of batch) lines.push(line(r));
    added = true;
    if (batch.length < BATCH) break;
  }
  if (!added) return;
  if (lines.length > MAX) lines = lines.slice(lines.length - MAX);
  logState.version++;
}

export function startLogs(): void {
  if (started) return;
  started = true;
  const tick = () => pull().catch(() => undefined).finally(() => setTimeout(tick, EVERY));
  tick();
}
