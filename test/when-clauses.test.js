'use strict';

// Command palette `when` clauses in package.json: every contributed command either names lanCollab.state, is
// internal (`false`), or is always available, and the clauses show the right commands in each machine state.
// The connection panel and diagnosis stay reachable in every state (docs/plans/B-extension.md appendix C).
// Run: node test/when-clauses.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { STATES } = require('../lib/connection-machine');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { commands, menus, keybindings } = pkg.contributes;

const ALWAYS = ['lanCollab.menu', 'lanCollab.openConnection', 'lanCollab.diagnose', 'lanCollab.showLog', 'lanCollab.openChat', 'lanCollab.signIn', 'lanCollab.restoreBackup', 'lanCollab.showHistory'];

// The subset of the when-clause language package.json uses: `false`, `key == value`, `key =~ /regex/`, a bare
// key, joined by `&&`.
function evaluate(clause, ctx) {
  return clause.split('&&').map((part) => part.trim()).every((part) => {
    if (part === 'false') return false;
    let m = /^([\w.]+) == (\w+)$/.exec(part);
    if (m) return ctx[m[1]] === m[2];
    m = /^([\w.]+) =~ \/(.+)\/$/.exec(part);
    if (m) return new RegExp(m[2]).test(String(ctx[m[1]] ?? ''));
    m = /^([\w.]+)$/.exec(part);
    if (m) return Boolean(ctx[m[1]]);
    throw new Error(`unsupported when clause part: ${part}`);
  });
}

const palette = new Map(menus.commandPalette.map((e) => [e.command, e.when]));
const ids = commands.map((c) => c.command);
const problems = [];
for (const id of ids) {
  const when = palette.get(id);
  if (ALWAYS.includes(id)) {
    if (when !== undefined) problems.push(`${id} is listed as always available but has when "${when}"`);
  } else if (when === undefined) {
    problems.push(`${id} has no commandPalette when clause and is not listed as always available`);
  } else if (when !== 'false' && !when.includes('lanCollab.state')) {
    problems.push(`${id} when "${when}" does not reference lanCollab.state`);
  }
}
for (const id of palette.keys()) if (!ids.includes(id)) problems.push(`commandPalette names ${id}, which is not contributed`);
for (const [id, when] of palette) {
  for (const m of when.matchAll(/\(([\w|]+)\)/g)) {
    for (const name of m[1].split('|')) if (!STATES.includes(name)) problems.push(`${id} when names unknown state ${name}`);
  }
}
for (const k of keybindings) if (!ids.includes(k.command)) problems.push(`keybinding ${k.key} runs ${k.command}, which is not contributed`);

// Every contributed command is registered somewhere under extension/src.
const sources = [];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
  const p = path.join(dir, d.name);
  if (d.isDirectory()) walk(p);
  else if (d.name.endsWith('.js')) sources.push(fs.readFileSync(p, 'utf8'));
});
walk(path.join(ROOT, 'extension', 'src'));
const registered = sources.join('\n');
for (const id of ids) if (!registered.includes(`'${id}'`)) problems.push(`${id} is contributed but never registered in extension/src`);
assert.deepStrictEqual(problems, []);

const visibleIn = (state, extra = {}) => ids.filter((id) => !palette.has(id) || evaluate(palette.get(id), { 'lanCollab.state': state, ...extra }));
const internal = ids.filter((id) => palette.get(id) === 'false');
for (const state of STATES) {
  const shown = visibleIn(state, { 'lanCollab.following': true });
  for (const id of ['lanCollab.openConnection', 'lanCollab.diagnose', 'lanCollab.menu']) assert.ok(shown.includes(id), `${id} hidden in ${state}`);
  for (const id of internal) assert.ok(!shown.includes(id), `${id} shown in ${state}`);
  assert.strictEqual(shown.includes('lanCollab.connect'), ['idle', 'stopped', 'needs_action'].includes(state), `connect in ${state}`);
  assert.strictEqual(shown.includes('lanCollab.disconnect'), !['idle', 'stopped'].includes(state), `disconnect in ${state}`);
}
const idle = visibleIn('idle');
for (const id of ['lanCollab.follow', 'lanCollab.copyInvite', 'lanCollab.unfollow', 'lanCollab.setStatus', 'lanCollab.disconnect']) assert.ok(!idle.includes(id), `${id} shown while idle`);
for (const id of ['lanCollab.connect', 'lanCollab.join']) assert.ok(idle.includes(id), `${id} hidden while idle`);
const live = visibleIn('live');
for (const id of ['lanCollab.follow', 'lanCollab.copyInvite', 'lanCollab.setStatus', 'lanCollab.disconnect', 'lanCollab.showHistory']) assert.ok(live.includes(id), `${id} hidden while live`);
for (const id of ['lanCollab.connect', 'lanCollab.join', 'lanCollab.unfollow']) assert.ok(!live.includes(id), `${id} shown while live and not following`);
assert.ok(visibleIn('live', { 'lanCollab.following': true }).includes('lanCollab.unfollow'), 'unfollow hidden while following');
for (const id of ['lanCollab.connect', 'lanCollab.disconnect', 'lanCollab.join']) assert.ok(visibleIn('needs_action').includes(id), `${id} hidden in needs_action`);

assert.deepStrictEqual(keybindings.map((k) => [k.key, k.command]), [
  ['ctrl+alt+l c', 'lanCollab.openChat'],
  ['ctrl+alt+l f', 'lanCollab.follow'],
  ['ctrl+alt+l h', 'lanCollab.showHistory'],
]);

console.log(`when-clauses: OK (${ids.length} commands, ${internal.length} internal, ${ALWAYS.length} always available)`);
