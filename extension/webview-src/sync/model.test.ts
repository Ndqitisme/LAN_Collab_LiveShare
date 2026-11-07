import { describe, expect, it } from 'vitest';
import { answer, canSync, choose, chooseAll, initialChoices, outcome, previewMode, rowsOf, splitPath, unresolved, type Plan } from './model';

const plan = (over: Partial<Plan> = {}): Plan => ({
  firstTime: false,
  project: 'web',
  folder: 'web',
  path: 'C:/work/web',
  conflicts: [
    { path: 'a.py', text: true, mergeable: true },
    { path: 'src/b.py', text: true, mergeable: false },
    { path: 'logo.png', text: false, mergeable: false },
  ],
  replace: [],
  get: ['new.py'],
  overwrite: ['old.py', 'old2.py'],
  upload: ['mine.py'],
  removeLocal: [],
  ...over,
});

describe('rows and choices', () => {
  it('offers merge only on mergeable conflicts and never on replaced files', () => {
    const rows = rowsOf(plan({ replace: [{ path: 'r.py', text: true }] }));
    expect(rows.map((r) => [r.path, r.group, r.options])).toEqual([
      ['a.py', 'conflict', ['hub', 'local', 'merge']],
      ['src/b.py', 'conflict', ['hub', 'local']],
      ['logo.png', 'conflict', ['hub', 'local']],
      ['r.py', 'replace', ['hub', 'local']],
    ]);
  });

  it('starts conflicts unchosen and replaced files on the hub version', () => {
    const p = plan({ firstTime: true, conflicts: [{ path: 'a.py', text: true, mergeable: true }], replace: [{ path: 'r.py', text: true }] });
    const c = initialChoices(p);
    expect(c).toEqual({ 'a.py': null, 'r.py': 'hub' });
    expect(unresolved(c, rowsOf(p))).toBe(1);
    expect(canSync(c, rowsOf(p))).toBe(false);
  });

  it('keeps a choice made before the plan was rebuilt when the row can still take it', () => {
    const p = plan({ chosen: { 'a.py': 'merge', 'src/b.py': 'merge', 'logo.png': 'local' } });
    expect(initialChoices(p)).toEqual({ 'a.py': 'merge', 'src/b.py': null, 'logo.png': 'local' });
  });

  it('refuses a choice the row cannot take', () => {
    const p = plan();
    const rows = rowsOf(p);
    const c = initialChoices(p);
    expect(choose(c, rows[1], 'merge')).toBe(c);
    expect(choose(c, rows[0], 'merge')['a.py']).toBe('merge');
  });

  it('applies a bulk merge only where merge is possible and keeps the others', () => {
    const p = plan();
    const rows = rowsOf(p);
    let c = choose(initialChoices(p), rows[2], 'local');
    c = chooseAll(c, rows, 'merge');
    expect(c).toEqual({ 'a.py': 'merge', 'src/b.py': null, 'logo.png': 'local' });
    expect(unresolved(c, rows)).toBe(1);
    c = chooseAll(c, rows, 'hub');
    expect(c).toEqual({ 'a.py': 'hub', 'src/b.py': 'hub', 'logo.png': 'hub' });
    expect(canSync(c, rows)).toBe(true);
  });

  it('answers a choice per file, mixed', () => {
    const p = plan();
    const rows = rowsOf(p);
    let c = initialChoices(p);
    c = choose(c, rows[0], 'hub');
    c = choose(c, rows[1], 'local');
    expect(answer(c, rows)).toEqual({ 'a.py': 'hub', 'src/b.py': 'local' });
  });
});

describe('outcome', () => {
  it('counts each file once by where its content comes from', () => {
    const p = plan({ removeLocal: ['x', 'y'], replace: [{ path: 'r.py', text: true }] });
    const rows = rowsOf(p);
    let c = initialChoices(p);
    c = choose(c, rows[0], 'merge');
    c = choose(c, rows[1], 'local');
    c = choose(c, rows[2], 'hub');
    expect(outcome(p, c)).toEqual({ fromHub: 1 + 2 + 2, toHub: 1 + 1, merged: 1, removed: 2 });
  });
});

describe('preview', () => {
  it('compares both sides, shows the merge result once merge is chosen, and has none for binary files', () => {
    const rows = rowsOf(plan());
    expect(previewMode(rows[0], null)).toBe('diff');
    expect(previewMode(rows[0], 'merge')).toBe('merge');
    expect(previewMode(rows[0], 'hub')).toBe('diff');
    expect(previewMode(rows[2], 'hub')).toBeNull();
  });

  it('splits a path into folder and name', () => {
    expect(splitPath('src/app/main.ts')).toEqual({ dir: 'src/app', base: 'main.ts' });
    expect(splitPath('a.py')).toEqual({ dir: '', base: 'a.py' });
  });
});
