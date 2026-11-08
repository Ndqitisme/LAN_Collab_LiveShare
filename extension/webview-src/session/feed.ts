// The session view's data: members as the host posts them, the activity feed, its filters and the captions
// built from them. No Svelte here, so feed.test.ts runs it without a compiler.

export type Translate = (id: string, args?: Record<string, string | number>) => string;

export interface Account {
  provider: string;
  label: string;
}

export interface Member {
  id: string;
  name: string;
  color: string | null;
  account: Account | null;
  file: string | null;
  line: number;
  debug: string | null;
  status: string;
  rtt: number | null;
}

// One activity record (docs/protocol.md section 7). `detail` is the hub's own `text` (debug target or status),
// `text` the sentence the host rendered, shown only for a kind this view does not know.
export interface FeedEntry {
  ts: number;
  who: string;
  color: string | null;
  kind: string | null;
  path: string | null;
  detail: string | null;
  text: string;
}

export interface ConnectionView {
  name: string;
  tone?: 'connecting' | 'error' | 'offline';
  title?: string;
  description?: string;
  actions?: { id: string; label: string }[];
}

// The hub keeps the last 200 records; the view holds as many.
export const FEED_LIMIT = 200;

export const KIND_GROUPS = {
  edit: ['edit', 'edit_disk'],
  create: ['create'],
  delete: ['delete'],
  presence: ['join', 'leave'],
  debug: ['debug_start', 'debug_stop'],
  status: ['status_set', 'status_clear'],
} as const;

export type KindFilter = 'all' | keyof typeof KIND_GROUPS;

export const KIND_FILTERS: KindFilter[] = ['all', 'edit', 'create', 'delete', 'presence', 'debug', 'status'];

export function kindLabel(kind: KindFilter, t: Translate): string {
  switch (kind) {
    case 'edit': return t('session.filter.kind.edit');
    case 'create': return t('session.filter.kind.create');
    case 'delete': return t('session.filter.kind.delete');
    case 'presence': return t('session.filter.kind.presence');
    case 'debug': return t('session.filter.kind.debug');
    case 'status': return t('session.filter.kind.status');
    default: return t('session.filter.kind.all');
  }
}

// What the member did, written after the member's name.
export function activityText(e: FeedEntry, t: Translate): string {
  const path = e.path ?? '';
  switch (e.kind) {
    case 'join': return t('activity.join');
    case 'leave': return t('activity.leave');
    case 'edit': return t('activity.edit', { path });
    case 'edit_disk': return t('activity.edit_disk', { path });
    case 'create': return t('activity.create', { path });
    case 'delete': return t('activity.delete', { path });
    case 'debug_start': return t('activity.debug_start', { target: e.detail ?? '' });
    case 'debug_stop': return t('activity.debug_stop');
    case 'status_set': return t('activity.status_set', { text: e.detail ?? '' });
    case 'status_clear': return t('activity.status_clear');
    default: return e.text;
  }
}

// A record whose file can still be opened: edits and creations. A deleted file has nothing to open.
export function openablePath(e: FeedEntry): string | null {
  return e.path && e.kind !== 'delete' ? e.path : null;
}

// Newest first, at most FEED_LIMIT entries. The host sends records oldest first.
export function newestFirst(oldestFirst: FeedEntry[]): FeedEntry[] {
  return oldestFirst.slice(-FEED_LIMIT).reverse();
}

export function prepend(feed: FeedEntry[], e: FeedEntry): FeedEntry[] {
  const next = [e, ...feed];
  if (next.length > FEED_LIMIT) next.length = FEED_LIMIT;
  return next;
}

// `who` is '' for every member.
export function filterFeed(feed: FeedEntry[], kind: KindFilter, who: string): FeedEntry[] {
  if (kind === 'all' && !who) return feed;
  const kinds: readonly string[] | null = kind === 'all' ? null : KIND_GROUPS[kind];
  return feed.filter((e) => (!kinds || (e.kind !== null && kinds.includes(e.kind))) && (!who || e.who === who));
}

// Names for the member filter: everyone in the feed and everyone online, sorted.
export function feedMembers(feed: FeedEntry[], online: string[]): string[] {
  return [...new Set([...online, ...feed.map((e) => e.who)])].sort((a, b) => a.localeCompare(b, 'vi'));
}

// Hub time against this machine's clock: a small skew between machines must not show a time in the future.
export function relativeTime(ts: number, now: number, t: Translate): string {
  const s = Math.max(0, now - ts) / 1000;
  if (s < 60) return t('session.time.now');
  if (s < 3600) return t('session.time.minutes', { count: Math.floor(s / 60) });
  if (s < 86400) return t('session.time.hours', { count: Math.floor(s / 3600) });
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fullTime(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN');
}

// Round trip to the hub in ms. On a LAN a healthy link answers in a few ms; past 50 ms typing from others
// arrives visibly late, past 150 ms it lags.
export const RTT_GOOD_MS = 50;
export const RTT_FAIR_MS = 150;

export type Quality = 'good' | 'fair' | 'poor' | 'unknown';

export function rttQuality(rtt: number | null): Quality {
  if (rtt === null || !Number.isFinite(rtt)) return 'unknown';
  if (rtt < RTT_GOOD_MS) return 'good';
  if (rtt < RTT_FAIR_MS) return 'fair';
  return 'poor';
}

export function rttLabel(rtt: number | null, t: Translate): string {
  const ms = rtt === null ? 0 : Math.round(rtt);
  switch (rttQuality(rtt)) {
    case 'good': return t('session.rtt.good', { ms });
    case 'fair': return t('session.rtt.fair', { ms });
    case 'poor': return t('session.rtt.poor', { ms });
    default: return t('session.rtt.unknown');
  }
}

// Others by name; the host sends them in join order.
export function sortMembers(members: Member[]): Member[] {
  return members.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
