// The sync panel's state: the plan lib/client-core.js asks about, and a choice per conflicting or replaced file.

export type Choice = 'hub' | 'local' | 'merge';

export interface ConflictRow {
  path: string;
  text: boolean;
  mergeable: boolean;
}

export interface ReplaceRow {
  path: string;
  text: boolean;
}

export interface Plan {
  firstTime: boolean;
  project: string;
  folder: string;
  path: string;
  conflicts: ConflictRow[];
  replace: ReplaceRow[];
  get: string[];
  overwrite: string[];
  upload: string[];
  removeLocal: string[];
}

export type Choices = Record<string, Choice | null>;

export interface Row {
  path: string;
  group: 'conflict' | 'replace';
  text: boolean;
  options: Choice[];
}

// More removals than this need a confirmation even without conflicts (client-core, fragile behavior 5).
export const REMOVE_CONFIRM_OVER = 5;

export function rowsOf(plan: Plan): Row[] {
  return [
    ...plan.conflicts.map((r): Row => ({ path: r.path, group: 'conflict', text: r.text, options: r.mergeable ? ['hub', 'local', 'merge'] : ['hub', 'local'] })),
    ...plan.replace.map((r): Row => ({ path: r.path, group: 'replace', text: r.text, options: ['hub', 'local'] })),
  ];
}

// A conflict has no default: one side's edits would be lost without the member looking. A replaced file in a folder
// joined for the first time takes the hub's version, as 0.1 did, and the local copy is backed up.
export function initialChoices(plan: Plan): Choices {
  const out: Choices = {};
  for (const r of plan.conflicts) out[r.path] = null;
  for (const r of plan.replace) out[r.path] = 'hub';
  return out;
}

export function choose(choices: Choices, row: Row, choice: Choice): Choices {
  if (!row.options.includes(choice)) return choices;
  return { ...choices, [row.path]: choice };
}

// The bulk buttons: a row that cannot take the choice keeps its own (merge applies only to mergeable rows).
export function chooseAll(choices: Choices, rows: Row[], choice: Choice): Choices {
  const out = { ...choices };
  for (const row of rows) if (row.options.includes(choice)) out[row.path] = choice;
  return out;
}

export function unresolved(choices: Choices, rows: Row[]): number {
  return rows.filter((r) => !choices[r.path]).length;
}

export function canSync(choices: Choices, rows: Row[]): boolean {
  return unresolved(choices, rows) === 0;
}

// What the plan will do once confirmed, counting each file once.
export function outcome(plan: Plan, choices: Choices) {
  const rows = rowsOf(plan);
  const picked = (c: Choice) => rows.filter((r) => choices[r.path] === c).length;
  return {
    fromHub: plan.get.length + plan.overwrite.length + picked('hub'),
    toHub: plan.upload.length + picked('local'),
    merged: picked('merge'),
    removed: plan.removeLocal.length,
  };
}

export function answer(choices: Choices, rows: Row[]): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const row of rows) {
    const c = choices[row.path];
    if (c) out[row.path] = c;
  }
  return out;
}

export function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? { dir: '', base: path } : { dir: path.slice(0, slash), base: path.slice(slash + 1) };
}

export type PreviewMode = 'diff' | 'merge';

// The merge preview shows the merged result once merge is chosen; otherwise the preview compares both sides.
export function previewMode(row: Row, choice: Choice | null): PreviewMode | null {
  if (!row.text) return null;
  return choice === 'merge' ? 'merge' : 'diff';
}
