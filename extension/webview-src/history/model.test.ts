import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  actionsFor,
  concerns,
  exactTime,
  listPath,
  mergePage,
  rowView,
  sizesToAsk,
  sizeText,
  sourceView,
  timeRange,
  type Run,
} from './model';
import catalogJson from '../../i18n/vi.json?raw';

const catalog: Record<string, string> = JSON.parse(catalogJson);

// The host's catalogFor('history.') with the webview's t(): an unknown id fails the test instead of showing.
function t(id: string, args?: Record<string, string | number>): string {
  const text = catalog[id];
  if (typeof text !== 'string') throw new Error(`no catalog entry ${id}`);
  return args ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in args ? String(args[k]) : m)) : text;
}

const run = (id: number, extra: Partial<Run> = {}): Run => ({
  id: String(id),
  path: 'a.py',
  author_uid: 'u1',
  author_name: 'Alice',
  color: '#e06c75',
  source: 'editor',
  kind: 'text',
  started_at: new Date(2026, 10, 8, 14, 5).getTime(),
  ended_at: new Date(2026, 10, 8, 14, 12).getTime(),
  op_count: 3,
  chars_added: 12,
  chars_removed: 3,
  start_blob: 'a'.repeat(64),
  end_blob: 'b'.repeat(64),
  reverts: null,
  open: false,
  ...extra,
});

const ids = (runs: Run[]) => runs.map((r) => r.id);

describe('scope', () => {
  it('lists the open file in file mode and the project otherwise', () => {
    expect(listPath('file', 'a.py')).toBe('a.py');
    expect(listPath('file', null)).toBe(null);
    expect(listPath('project', 'a.py')).toBe(null);
  });

  it('refreshes only for the shown file, and for every file in the project timeline', () => {
    expect(concerns('file', 'a.py', 'a.py')).toBe(true);
    expect(concerns('file', 'a.py', 'b.py')).toBe(false);
    expect(concerns('file', null, 'b.py')).toBe(false);
    expect(concerns('project', null, 'b.py')).toBe(true);
  });
});

describe('mergePage', () => {
  it('appends an older page after the runs shown, newest first, once per id', () => {
    const shown = [run(9), run(8), run(7)];
    expect(ids(mergePage(shown, [run(7), run(6), run(5)], '7', true))).toEqual(['9', '8', '7', '6', '5']);
  });

  it('replaces the list with a complete first page, dropping runs retention removed', () => {
    const shown = [run(9), run(8), run(3)];
    expect(ids(mergePage(shown, [run(10), run(9), run(8)], null, false))).toEqual(['10', '9', '8']);
  });

  it('keeps older pages loaded below a refreshed first page that has more', () => {
    const shown = [run(9), run(8), run(7), run(6), run(5)];
    expect(ids(mergePage(shown, [run(11, { open: true }), run(10), run(9)], null, true))).toEqual(['11', '10', '9', '8', '7', '6', '5']);
  });

  it('takes the fresh record of a run that changed, such as an open run that ended', () => {
    const shown = [run(9, { open: true, end_blob: null })];
    const merged = mergePage(shown, [run(10, { author_name: 'Bob' }), run(9)], null, false);
    expect(merged[1].open).toBe(false);
    expect(merged[1].end_blob).not.toBe(null);
  });

  it('sorts by numeric id, not by text', () => {
    expect(ids(mergePage([], [run(9), run(100), run(10)], null, false))).toEqual(['100', '10', '9']);
  });
});

describe('actionsFor', () => {
  it('offers the five text actions on a closed text run', () => {
    expect(actionsFor(run(1))).toEqual(['openAfter', 'diffCurrent', 'diffBefore', 'copy', 'revert']);
  });

  it('does not compare an open run with today\'s text, which is where it ends', () => {
    expect(actionsFor(run(1, { open: true, end_blob: null }))).not.toContain('diffCurrent');
    expect(actionsFor(run(1, { open: true, end_blob: null }))).toContain('revert');
  });

  it('offers only Khôi phục phiên bản này on a binary file', () => {
    expect(actionsFor(run(1, { kind: 'blob', source: 'disk', start_blob: null }))).toEqual(['restoreVersion']);
    expect(actionLabel('restoreVersion', run(1, { kind: 'blob' }), t)).toBe('Khôi phục phiên bản này');
  });

  it('restores a deleted file, text or binary', () => {
    expect(actionsFor(run(1, { source: 'delete' }))[0]).toBe('restoreFile');
    expect(actionsFor(run(1, { source: 'delete', kind: 'blob' }))).toEqual(['restoreFile']);
    expect(actionLabel('openAfter', run(1, { source: 'delete' }), t)).not.toBe(actionLabel('openAfter', run(1), t));
  });

  it('has a caption for every action', () => {
    for (const a of ['openAfter', 'diffCurrent', 'diffBefore', 'copy', 'revert', 'restoreFile', 'restoreVersion'] as const) {
      expect(actionLabel(a, run(1), t).length).toBeGreaterThan(0);
    }
  });
});

describe('row captions', () => {
  const now = new Date(2026, 10, 8, 18, 0).getTime();

  it('shows the time range of a run today, one time when it fits in a minute', () => {
    expect(timeRange(run(1).started_at, run(1).ended_at, now, t)).toBe('14:05 – 14:12');
    const at = new Date(2026, 10, 8, 9, 3, 10).getTime();
    expect(timeRange(at, at + 20_000, now, t)).toBe('09:03');
  });

  it('puts the date in front of a run from another day', () => {
    const s = new Date(2026, 10, 6, 23, 50).getTime();
    expect(timeRange(s, new Date(2026, 10, 7, 0, 10).getTime(), now, t)).toBe('06/11 23:50 – 07/11 00:10');
    expect(timeRange(s, s + 60_000, now, t)).toBe('06/11 23:50 – 23:51');
  });

  it('gives the exact span to the second, the date once', () => {
    const s = new Date(2026, 10, 8, 14, 5, 7).getTime();
    expect(exactTime(s, s + 400, t)).toBe('08/11/2026 14:05:07');
    expect(exactTime(s, new Date(2026, 10, 8, 14, 12, 30).getTime(), t)).toBe('08/11/2026 14:05:07 – 14:12:30');
    expect(exactTime(s, new Date(2026, 10, 9, 0, 1, 2).getTime(), t)).toBe('08/11/2026 14:05:07 – 09/11/2026 00:01:02');
  });

  it('labels every source and falls back to editor for an unknown one', () => {
    expect(sourceView('editor', t).label).toBe(catalog['history.source.editor']);
    expect(sourceView('disk', t).icon).toBe('terminal');
    expect(sourceView('revert', t).label).toBe(catalog['history.source.revert']);
    expect(sourceView('merge', t).label).toBe(catalog['history.source.merge']);
    expect(sourceView('delete', t).tone).toBe('danger');
    expect(sourceView('future', t).label).toBe(catalog['history.source.editor']);
  });

  it('builds a row with author, color, counts and states', () => {
    const r = rowView(run(4, { open: true, kind: 'text' }), now, t);
    expect(r).toMatchObject({ id: '4', author: 'Alice', color: '#e06c75', added: 12, removed: 3, open: true, binary: false, path: 'a.py' });
    expect(rowView(run(5, { kind: 'blob' }), now, t).binary).toBe(true);
    expect(rowView(run(5, { kind: 'blob' }), now, t).size).toBe(null);
    expect(rowView(run(5, { kind: 'blob' }), now, t, 2048).size).toBe('2 KB');
    expect(rowView(run(5), now, t, 2048).size).toBe(null);
  });

  it('asks for the size of binary versions it has not asked for, at most 20', () => {
    const blobs = Array.from({ length: 25 }, (_, i) => run(100 - i, { kind: 'blob' }));
    expect(sizesToAsk([run(1), ...blobs.slice(0, 3)], { 100: 10 })).toEqual(['99', '98']);
    expect(sizesToAsk(blobs, {})).toHaveLength(20);
    expect(sizesToAsk([run(7, { kind: 'blob', end_blob: null })], {})).toEqual([]);
  });

  it('writes sizes with a space and a decimal comma', () => {
    expect(sizeText(512, t)).toBe('512 B');
    expect(sizeText(1536, t)).toBe('1,5 KB');
    expect(sizeText(20 * 1024, t)).toBe('20 KB');
    expect(sizeText(3.25 * 1024 * 1024, t)).toBe('3,3 MB');
  });
});
