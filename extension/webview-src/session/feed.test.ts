import { describe, expect, it } from 'vitest';
import {
  activityText,
  feedMembers,
  FEED_LIMIT,
  filterFeed,
  KIND_FILTERS,
  KIND_GROUPS,
  kindLabel,
  newestFirst,
  openablePath,
  prepend,
  relativeTime,
  rttLabel,
  rttQuality,
  type FeedEntry,
} from './feed';
import protocolDoc from '../../../docs/protocol.md?raw';
import catalogJson from '../../i18n/vi.json?raw';

const catalog: Record<string, string> = JSON.parse(catalogJson);

// The host's catalogFor('session.') + catalogFor('activity.') with the webview's t(): an unknown id would come back as the id.
function t(id: string, args?: Record<string, string | number>): string {
  const text = catalog[id];
  if (typeof text !== 'string') throw new Error(`no catalog entry ${id}`);
  return args ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in args ? String(args[k]) : m)) : text;
}

const entry = (kind: string | null, extra: Partial<FeedEntry> = {}): FeedEntry => ({
  ts: 1_700_000_000_000,
  who: 'An',
  color: '#e06c75',
  kind,
  path: null,
  detail: null,
  text: '',
  ...extra,
});

function protocolKinds(): string[] {
  const section = protocolDoc.slice(protocolDoc.indexOf('| `kind` | Emitted when |'), protocolDoc.indexOf('## 8. Presence'));
  // The first match is the table header.
  return [...section.matchAll(/^\| `(\w+)` \| /gm)].map((m) => m[1]).slice(1);
}

describe('activityText', () => {
  it('renders every protocol kind from the catalog', () => {
    const kinds = protocolKinds();
    expect(kinds).toEqual(['join', 'leave', 'edit', 'edit_disk', 'create', 'delete', 'debug_start', 'debug_stop', 'status_set', 'status_clear']);
    for (const kind of kinds) {
      const text = activityText(entry(kind, { path: 'src/a.ts', detail: 'x' }), t);
      expect(text, kind).not.toMatch(/[{}]/);
      expect(text, kind).toBe(t(`activity.${kind}`, { path: 'src/a.ts', target: 'x', text: 'x' }));
    }
  });

  it('puts the path, the debug target and the status where each kind needs them', () => {
    expect(activityText(entry('join'), t)).toBe('vào dự án');
    expect(activityText(entry('leave'), t)).toBe('rời dự án');
    expect(activityText(entry('edit', { path: 'src/app.ts' }), t)).toBe('đang sửa src/app.ts');
    expect(activityText(entry('edit_disk', { path: 'gen.py' }), t)).toBe('đang sửa gen.py bằng công cụ ngoài editor');
    expect(activityText(entry('create', { path: 'b.py' }), t)).toBe('đã tạo b.py');
    expect(activityText(entry('delete', { path: 'c.py' }), t)).toBe('đã xoá c.py');
    expect(activityText(entry('debug_start', { detail: 'a.py' }), t)).toBe('bắt đầu debug a.py');
    expect(activityText(entry('debug_stop'), t)).toBe('dừng debug');
    expect(activityText(entry('status_set', { detail: 'Sửa trang đăng nhập' }), t)).toBe('đặt trạng thái: Sửa trang đăng nhập');
    expect(activityText(entry('status_clear'), t)).toBe('xoá trạng thái');
  });

  it('shows the host sentence for a kind it does not know and for a protocol 1 record', () => {
    expect(activityText(entry('checkpoint', { text: 'checkpoint' }), t)).toBe('checkpoint');
    expect(activityText(entry(null, { text: 'vào phòng (10.0.0.2)' }), t)).toBe('vào phòng (10.0.0.2)');
  });

  it('opens edited and created files but not deleted ones', () => {
    expect(openablePath(entry('edit', { path: 'a.py' }))).toBe('a.py');
    expect(openablePath(entry('create', { path: 'b.py' }))).toBe('b.py');
    expect(openablePath(entry('delete', { path: 'c.py' }))).toBeNull();
    expect(openablePath(entry('join'))).toBeNull();
  });
});

describe('feed order and limit', () => {
  it('keeps the newest FEED_LIMIT records, newest first', () => {
    const records = Array.from({ length: 260 }, (_, i) => entry('edit', { ts: i, path: `f${i}` }));
    const feed = newestFirst(records);
    expect(feed).toHaveLength(FEED_LIMIT);
    expect(feed[0].ts).toBe(259);
    expect(feed[FEED_LIMIT - 1].ts).toBe(60);
    const next = prepend(feed, entry('create', { ts: 300 }));
    expect(next).toHaveLength(FEED_LIMIT);
    expect(next[0].ts).toBe(300);
    expect(next[FEED_LIMIT - 1].ts).toBe(61);
    expect(feed[0].ts).toBe(259);
  });
});

describe('filterFeed', () => {
  const feed = [
    entry('create', { who: 'An', path: 'a.py' }),
    entry('edit', { who: 'Bình', path: 'a.py' }),
    entry('edit_disk', { who: 'An', path: 'g.py' }),
    entry('delete', { who: 'Bình', path: 'b.py' }),
    entry('join', { who: 'Chi' }),
    entry('leave', { who: 'Chi' }),
    entry('debug_start', { who: 'Bình', detail: 'a.py' }),
    entry('debug_stop', { who: 'Bình' }),
    entry('status_set', { who: 'An', detail: 'x' }),
    entry('status_clear', { who: 'An' }),
    entry(null, { who: 'Chi', text: 'cũ' }),
  ];

  it('returns the same array when no filter is set', () => {
    expect(filterFeed(feed, 'all', '')).toBe(feed);
  });

  it('keeps only the kinds of the chosen group', () => {
    expect(filterFeed(feed, 'create', '').map((e) => e.kind)).toEqual(['create']);
    expect(filterFeed(feed, 'edit', '').map((e) => e.kind)).toEqual(['edit', 'edit_disk']);
    expect(filterFeed(feed, 'presence', '').map((e) => e.kind)).toEqual(['join', 'leave']);
    expect(filterFeed(feed, 'debug', '').map((e) => e.kind)).toEqual(['debug_start', 'debug_stop']);
    expect(filterFeed(feed, 'status', '').map((e) => e.kind)).toEqual(['status_set', 'status_clear']);
    expect(filterFeed(feed, 'delete', '').map((e) => e.path)).toEqual(['b.py']);
  });

  it('covers every protocol kind with exactly one group', () => {
    const grouped = Object.values(KIND_GROUPS).flat().sort();
    expect(grouped).toEqual(protocolKinds().sort());
  });

  it('keeps only the chosen member', () => {
    const chi = filterFeed(feed, 'all', 'Chi');
    expect(chi.every((e) => e.who === 'Chi')).toBe(true);
    expect(chi).toHaveLength(3);
  });

  it('combines kind and member', () => {
    expect(filterFeed(feed, 'edit', 'An').map((e) => e.path)).toEqual(['g.py']);
    expect(filterFeed(feed, 'create', 'Bình')).toEqual([]);
  });

  it('labels every kind filter', () => {
    const labels = KIND_FILTERS.map((k) => kindLabel(k, t));
    expect(new Set(labels).size).toBe(KIND_FILTERS.length);
    expect(kindLabel('create', t)).toBe('Tạo file');
  });

  it('offers online members and feed authors once, sorted', () => {
    expect(feedMembers(feed, ['Dũng', 'An'])).toEqual(['An', 'Bình', 'Chi', 'Dũng']);
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;

  it('steps from now to minutes, hours and a date', () => {
    expect(relativeTime(now - 5_000, now, t)).toBe('vừa xong');
    expect(relativeTime(now + 3_000, now, t)).toBe('vừa xong');
    expect(relativeTime(now - 60_000, now, t)).toBe('1 phút trước');
    expect(relativeTime(now - 59 * 60_000, now, t)).toBe('59 phút trước');
    expect(relativeTime(now - 2 * 3_600_000, now, t)).toBe('2 giờ trước');
    expect(relativeTime(now - 3 * 86_400_000, now, t)).toMatch(/^\d{2}\/\d{2}$/);
  });
});

describe('rtt quality', () => {
  it('uses the stated thresholds', () => {
    expect(rttQuality(null)).toBe('unknown');
    expect(rttQuality(0)).toBe('good');
    expect(rttQuality(49)).toBe('good');
    expect(rttQuality(50)).toBe('fair');
    expect(rttQuality(149)).toBe('fair');
    expect(rttQuality(150)).toBe('poor');
    expect(rttLabel(3, t)).toBe('Kết nối tốt, độ trễ 3 ms');
    expect(rttLabel(null, t)).toBe('Chưa đo được độ trễ');
  });
});
