'use strict';

// Undoing one edit run (lib/history-client.js revertRun): later edits by others before the run, after it, next to
// it and on the same lines; deletions, insertions at the same place, CRLF and a last line without newline; and a
// random property: no line written after the run is ever lost, and the run's own lines go when nobody touched them.
// Run: node test/revert.test.js
const assert = require('assert');
const { revertRun } = require('../lib/history-client');
const { diff } = require('../lib/ot');

let checks = 0;
const L = (...lines) => lines.map((l) => `${l}\n`).join('');

function check(name, { start, end, current, want, conflicts = 0 }) {
  const got = revertRun(start, end, current);
  assert.strictEqual(got.text, want, name);
  assert.strictEqual(got.conflicts, conflicts, `${name}: conflicts`);
  // The result is applied as one op on today's text.
  assert.strictEqual(diff(current, got.text).apply(current), want, `${name}: as an op`);
  checks += 1;
}

// Bob adds two lines between Alice's; Alice then keeps typing below, above, and right next to them.
const start = L('def a():', '    return 1', '', 'def c():', '    return 3');
const end = L('def a():', '    return 1', '', 'def b():', '    return 2', '', 'def c():', '    return 3');

check('later edit after the run', {
  start,
  end,
  current: end + L('', 'def d():', '    return 4'),
  want: start + L('', 'def d():', '    return 4'),
});

check('later edit before the run', {
  start,
  end,
  current: L('import os', '') + end.replace('return 1', 'return 10'),
  want: L('import os', '') + start.replace('return 1', 'return 10'),
});

check('later lines inserted right before and right after the run block', {
  start,
  end,
  current: end.replace('def b():', '# above\ndef b():').replace('def c():', '# below\ndef c():'),
  want: start.replace('def c():', '# above\n# below\ndef c():'),
});

check('later edit on the run\'s own lines keeps today\'s text', {
  start,
  end,
  current: end.replace('    return 2', '    return 22'),
  want: end.replace('    return 2', '    return 22'),
  conflicts: 1,
});

check('two blocks, one touched later: the other is still undone', {
  start: L('x = 1', 'y = 1', 'z = 1', 'w = 1'),
  end: L('x = 2', 'y = 1', 'z = 1', 'w = 2'),
  current: L('x = 3', 'y = 1', 'z = 1', 'w = 2'),
  want: L('x = 3', 'y = 1', 'z = 1', 'w = 1'),
  conflicts: 1,
});

check('run that changed a line, later edit on the next line', {
  start: L('a = 0', 'b = 0', 'c = 0'),
  end: L('a = 0', 'b = 5', 'c = 0'),
  current: L('a = 0', 'b = 5', 'c = 9'),
  want: L('a = 0', 'b = 0', 'c = 9'),
});

// Bob deleted a function by mistake; Alice edited elsewhere afterwards.
const full = L('def keep():', '    pass', '', 'def lost():', '    x = 1', '    return x', '', 'def tail():', '    pass');
const cut = L('def keep():', '    pass', '', 'def tail():', '    pass');
check('deleted block comes back, later edit kept', {
  start: full,
  end: cut,
  current: cut.replace('def tail():\n    pass', 'def tail():\n    return 0'),
  want: full.replace('def tail():\n    pass', 'def tail():\n    return 0'),
});

check('deleted block comes back where a later line was inserted at the same place', {
  start: full,
  end: cut,
  current: cut.replace('def tail():', '# note\ndef tail():'),
  want: full.replace('def tail():', '# note\ndef tail():'),
});

check('later deletion of the lines around a run insertion', {
  start: L('a', 'b', 'c', 'd'),
  end: L('a', 'b', 'NEW', 'c', 'd'),
  current: L('a', 'NEW', 'd'),
  want: L('a', 'd'),
});

check('run that emptied the file', { start: L('one', 'two'), end: '', current: L('later'), want: L('one', 'two', 'later') });
check('run that created the content', { start: '', end: L('one', 'two'), current: L('one', 'two', 'three'), want: L('three') });

check('crlf text', {
  start: 'a\r\nb\r\nc\r\n',
  end: 'a\r\nb\r\nBOB\r\nc\r\n',
  current: 'ALICE\r\na\r\nb\r\nBOB\r\nc\r\n',
  want: 'ALICE\r\na\r\nb\r\nc\r\n',
});

check('last line without newline', {
  start: 'a\nb',
  end: 'a\nb\nc',
  current: 'z\na\nb\nc',
  want: 'z\na\nb',
});

check('nothing left to undo', { start, end, current: start, want: start });
check('a deletion already put back is not added again', { start: L('a', 'X', 'b'), end: L('a', 'b'), current: L('a', 'X', 'b'), want: L('a', 'X', 'b') });
check('a deletion at the end already put back', { start: L('a', 'X'), end: L('a'), current: L('a', 'X'), want: L('a', 'X') });

// Reverting the revert gives the run back.
{
  const current = end + L('# later');
  const reverted = revertRun(start, end, current).text;
  assert.strictEqual(revertRun(end, start, reverted).text, current, 'revert of the revert');
  checks += 1;
}

// Random property. Unique lines, so each line's origin is known: base lines B*, the run's R*, later lines A*.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mutate(r, lines, tag, n) {
  const out = lines.slice();
  for (let k = 0; k < n; k++) {
    const at = Math.floor(r() * (out.length + 1));
    const kind = r();
    if (kind < 0.4 || !out.length) out.splice(at, 0, `${tag}${k}\n`);
    else if (kind < 0.7) out.splice(Math.min(at, out.length - 1), 1);
    else out.splice(Math.min(at, out.length - 1), 1, `${tag}${k}m\n`);
  }
  // The lines this step wrote that are still there.
  return { lines: out, added: out.filter((l) => l.startsWith(tag)) };
}

for (let seed = 1; seed <= 500; seed++) {
  const r = rng(seed);
  const base = Array.from({ length: 5 + Math.floor(r() * 30) }, (_, i) => `B${i}\n`);
  const run = mutate(r, base, 'R', 1 + Math.floor(r() * 4));
  const later = mutate(r, run.lines, 'A', Math.floor(r() * 5));
  const s = base.join('');
  const e = run.lines.join('');
  const c = later.lines.join('');
  const got = revertRun(s, e, c);
  const result = new Set(got.text.match(/[^\n]*\n/g) || []);
  for (const line of later.added) assert.ok(result.has(line), `seed ${seed}: later line ${line.trim()} kept`);
  if (!got.conflicts) {
    for (const line of run.added) if (!later.added.includes(line)) assert.ok(!result.has(line), `seed ${seed}: run line ${line.trim()} undone`);
  }
  assert.ok(got.conflicts >= 0, `seed ${seed}: conflicts never negative`);
  // Undoing a run in a file already back to its state before the run changes nothing.
  assert.strictEqual(revertRun(s, e, s).text, s, `seed ${seed}: undo twice`);
  // With no later edit the file goes back to exactly its state before the run.
  if (!later.added.length && c === e) assert.strictEqual(got.text, s, `seed ${seed}: plain undo`);
  checks += 1;
}

console.log(`revert.test.js: ${checks} checks OK`);
