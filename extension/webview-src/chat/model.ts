export interface ChatImage {
  id: string;
  size: number;
  w?: number;
  h?: number;
}

export interface ChatMessage {
  id?: string;
  ts: number;
  from: string;
  fromId?: string;
  fromKey?: string;
  color?: string;
  account?: { provider: string; label: string } | null;
  text?: string;
  image?: ChatImage;
  mine?: boolean;
  mention?: boolean;
}

export interface Person {
  name: string;
  color?: string;
  status?: string;
}

export type Row =
  | { kind: 'day'; key: string; ts: number }
  | { kind: 'msg'; key: string; msg: ChatMessage; cont: boolean };

export const GROUP_MS = 5 * 60 * 1000;

const sender = (m: ChatMessage) => m.fromKey || m.fromId || m.from;
const dayOf = (ts: number) => new Date(ts).toDateString();

// Appends one message to the rows: a day divider when the day changes, and `cont` when the same sender
// wrote within GROUP_MS of the previous message (no avatar or name repeated). Returns the new last message.
export function appendRow(rows: Row[], last: ChatMessage | null, msg: ChatMessage): ChatMessage {
  const n = rows.length;
  if (!last || dayOf(last.ts) !== dayOf(msg.ts)) {
    rows.push({ kind: 'day', key: `d${n}:${msg.ts}`, ts: msg.ts });
    last = null;
  }
  const cont = Boolean(last && sender(last) === sender(msg) && msg.ts - last.ts < GROUP_MS);
  rows.push({ kind: 'msg', key: msg.id ? `m${msg.id}` : `i${n}:${msg.ts}`, msg, cont });
  return msg;
}
