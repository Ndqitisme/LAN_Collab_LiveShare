// Writes the lanhub-ot test vectors from lib/ot.js, so the Rust port is checked against the JavaScript output.
//   node tools/gen-ot-vectors.mjs                 write the committed vectors
//   node tools/gen-ot-vectors.mjs --out <dir>     write them elsewhere
//   node tools/gen-ot-vectors.mjs --large         add a 1 MiB apply case and a 20000-line diff case
//   node tools/gen-ot-vectors.mjs --bench         time the workload of `cargo bench -p lanhub-ot --bench transform`
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { TextOperation, diff } = require('../lib/ot.js');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

function rng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  r.below = (k) => Math.floor(r() * k);
  return r;
}

// Code points only, so every generated string is well-formed UTF-16 and survives a JSON round trip in Rust.
const ALPHABET = ['a', 'b', 'x', ' ', '\n', '\r\n', '\r', '\t', 'Đ', 'é', '"', '\\', '\u0001', ' ', '🙂', '🙃', '😀', '𝄞'];

function randomString(r, max) {
  const n = r.below(max);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[r.below(ALPHABET.length)];
  return s;
}

function fixedString(r, units) {
  let s = '';
  while (s.length < units) s += ALPHABET[r.below(ALPHABET.length)];
  return s;
}

function randomLine(r, i) {
  return `${i}:${randomString(r, 24)}${r() < 0.3 ? '\r\n' : '\n'}`;
}

// Random op on `text` that cuts only between code points (a CRLF may still be cut).
function randomOp(r, text, maxRun = 5) {
  const cps = Array.from(text);
  const op = new TextOperation();
  let i = 0;
  while (i < cps.length) {
    const k = r();
    const n = 1 + r.below(Math.min(cps.length - i, maxRun));
    const units = cps.slice(i, i + n).join('').length;
    if (k < 0.2) op.insert(randomString(r, 4));
    else if (k < 0.5) {
      op.delete(units);
      i += n;
    } else {
      op.retain(units);
      i += n;
    }
  }
  if (r() < 0.3) op.insert(randomString(r, 4));
  return op;
}

// A few scattered edits on a long text, the shape a real editing session produces.
function sparseOp(r, text, edits) {
  const cps = Array.from(text);
  const cuts = new Set();
  while (cuts.size < edits) cuts.add(r.below(cps.length));
  const op = new TextOperation();
  let pending = 0;
  cps.forEach((cp, i) => {
    if (!cuts.has(i)) {
      pending += cp.length;
      return;
    }
    op.retain(pending);
    pending = 0;
    op.insert(randomString(r, 6));
    if (r() < 0.5) op.delete(cp.length);
    else pending += cp.length;
  });
  return op.retain(pending);
}

const SEEDS = 3000;
const json = (op) => JSON.stringify(op);

function transformCases() {
  const cases = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed);
    const text = randomString(r, seed % 10 === 0 ? 200 : 30);
    const a = randomOp(r, text);
    const b = randomOp(r, text);
    const [a2, b2] = TextOperation.transform(a, b);
    cases.push({ a: a.ops, b: b.ops, a2: json(a2), b2: json(b2) });
    if (seed % 150 === 0) cases.push({ a: a.ops, b: randomOp(r, text + 'z').ops, error: true });
  }
  return cases;
}

function composeCases() {
  const cases = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed + 100000);
    const text = randomString(r, seed % 10 === 0 ? 200 : 30);
    const a = randomOp(r, text);
    const b = randomOp(r, a.apply(text));
    cases.push({ a: a.ops, b: b.ops, result: json(a.compose(b)) });
    if (seed % 150 === 0) cases.push({ a: a.ops, b: randomOp(r, a.apply(text) + 'z').ops, error: true });
  }
  return cases;
}

function applyCase(text, op, r) {
  const index = r.below(text.length + 1);
  return { text, op: op.ops, result: op.apply(text), index, moved: op.transformIndex(index) };
}

function applyCases(large) {
  const cases = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed + 200000);
    const text = randomString(r, seed % 10 === 0 ? 200 : 30);
    const op = randomOp(r, text);
    cases.push(applyCase(text, op, r));
    if (seed % 150 === 0) cases.push({ text: text + 'q', op: op.ops, error: true });
  }
  if (large) {
    const r = rng(7);
    let text = '';
    for (let i = 0; text.length < 1024 * 1024; i++) text += randomLine(r, i);
    for (const edits of [1, 50, 2000]) cases.push(applyCase(text, sparseOp(r, text, edits), r));
  }
  return cases;
}

function linesText(r, count) {
  const lines = [];
  for (let i = 0; i < count; i++) lines.push(randomLine(r, i));
  return lines;
}

// Edits `places` random lines of a multi-line text: replace, insert, delete, or a small in-line change.
function editLines(r, lines, places) {
  const out = lines.slice();
  for (let n = 0; n < places; n++) {
    const i = r.below(out.length);
    const k = r();
    if (k < 0.25) out[i] = randomLine(r, -i);
    else if (k < 0.5) out.splice(i, 0, randomLine(r, -i), r() < 0.5 ? '\n' : '\r\n');
    else if (k < 0.7) out.splice(i, 1);
    else out[i] = randomOp(r, out[i].replace(/\r?\n$/, ''), 3).apply(out[i].replace(/\r?\n$/, '')) + '\n';
  }
  return out;
}

function assertFallback(a, b, op, what) {
  const changes = op.ops.filter((o) => !(typeof o === 'number' && o > 0));
  if (changes.length !== 2) throw new Error(`${what} did not take the delete-all/insert-all path`);
  return { a, b, op: json(op) };
}

function diffCases(large) {
  const cases = [];
  const add = (a, b) => cases.push({ a, b, op: json(diff(a, b)) });
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed + 300000);
    const a = randomString(r, seed % 10 === 0 ? 200 : 30);
    add(a, r() < 0.5 ? randomString(r, 30) : randomOp(r, a).apply(a));
  }
  const edges = [
    ['a\r\nb', 'a\r\nXb'], ['a\r\n', 'a\n'], ['🙂', '🙃'], ['x\r\ny', 'x\ry'], ['', 'abc'], ['abc', ''], ['same', 'same'],
    ['', ''], ['\r\n', '\n'], ['a\r', 'a\r\n'], ['🙂a', '🙃a'], ['a🙂', 'a🙃'], ['\r\n\r\n', '\r\n'], ['x\r\n', 'y\r\n'],
    ['😀😀', '😀🙂😀'], ['ab\r\ncd', 'ab\ncd'], ['😀', '😁'], ['𝄞x𝄞', '𝄞y𝄞'],
  ];
  for (const [a, b] of edges) add(a, b);
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed + 400000);
    const a = randomString(r, 3000);
    add(a, randomOp(r, a, 40).apply(a));
  }
  for (let seed = 1; seed <= 12; seed++) {
    const r = rng(seed + 500000);
    const lines = linesText(r, 400 + r.below(800));
    add(lines.join(''), editLines(r, lines, 1 + r.below(30)).join(''));
  }
  {
    // One block of 300 replaced lines is larger than the character limit, so that block falls back.
    const r = rng(600001);
    const lines = linesText(r, 900);
    const b = lines.slice();
    b.splice(300, 300, ...linesText(r, 300).map((l) => `#${l}`));
    add(lines.join(''), b.join(''));
  }
  {
    const r = rng(600002);
    const x = `<${fixedString(r, 3900)}>`;
    const y = `<${fixedString(r, 3900)}>`;
    cases.push(assertFallback(x, y, diff(x, y), 'char diff over 1000 edits'));
  }
  {
    const r = rng(600003);
    const x = Array.from({ length: 4000 }, (_, i) => `a${i}-${r.below(1e6)}\n`).join('');
    const y = Array.from({ length: 4000 }, (_, i) => `b${i}-${r.below(1e6)}\n`).join('');
    cases.push(assertFallback(x, y, diff(x, y), 'line diff over 3000 edits'));
  }
  if (large) {
    const r = rng(8);
    const lines = linesText(r, 20000).map((l) => {
      const end = l.endsWith('\r\n') ? '\r\n' : '\n';
      return l.slice(0, -end.length).replace(/[\r\n]/g, '') + end;
    });
    add(lines.join(''), editLines(r, lines, 50).join(''));
  }
  return cases;
}

const REJECTS = [
  '[0]', '[-0]', '[0.0]', '[1.5]', '[-0.5]', '[1e-1]', '[[1]]', '[null]', '[true]', '[false]', '[{}]', '[1,[2]]',
  '[1,null]', '{}', '{"ops":[1]}', '"abc"', '1', 'null', 'true',
];
const ACCEPTS = [
  '[]', '[1]', '[-1]', '["a"]', '[""]', '[1,2]', '[-1,-2]', '["a","b"]', '[-1,"a"]', '["a",-1,"b"]', '[2,-1,"x",3]',
  '[1.0]', '[-2.0]', '[1e2]', '[9007199254740991]', '[-9007199254740991]', '["\\ud83d\\ude42"]', '["\\u0000"]',
  '[1,"",2]', '[-1,"a",-1,"b"]',
];
const POOL = ['1', '-1', '3', '-4', '"a"', '""', '"🙂"', '"\\r\\n"', '2.0', '0', '1.5', 'null', '[]', '{}', 'true', '-0'];

function fromJsonCases() {
  const inputs = [...REJECTS, ...ACCEPTS];
  const r = rng(700000);
  for (let n = 0; n < 600; n++) {
    const parts = [];
    for (let k = r.below(6); k > 0; k--) parts.push(POOL[r.below(POOL.length)]);
    inputs.push(`[${parts.join(',')}]`);
  }
  return inputs.map((input) => {
    try {
      return { input, ok: true, ops: json(TextOperation.fromJSON(JSON.parse(input))) };
    } catch {
      return { input, ok: false };
    }
  });
}

function writeVectors() {
  const at = args.indexOf('--out');
  const dir = at >= 0 ? path.resolve(args[at + 1]) : path.join(repo, 'lanhub/crates/lanhub-ot/tests/vectors');
  const large = args.includes('--large');
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'transform.json': transformCases(),
    'compose.json': composeCases(),
    'apply.json': applyCases(large),
    'diff.json': diffCases(large),
    'fromjson.json': fromJsonCases(),
  };
  for (const [name, cases] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), `{"cases":[\n${cases.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`);
    console.log(`${name}: ${cases.length} cases`);
  }
}

// Same workload, PRNG and checksum as lanhub/crates/lanhub-ot/benches/transform.rs.
function bench() {
  const STEPS = 100000;
  const TEXT_UNITS = 100 * 1024;
  const BIG_UNITS = 1024 * 1024;
  const BIG_APPLIES = 200;
  const TOKENS = ['a', 'b', 'x', ' ', '\n', '\r\n', 'Đ', '🙂'];
  const r = rng(0x5eed);
  const randomText = (units) => {
    let s = '';
    while (s.length < units) s += TOKENS[r.below(TOKENS.length)];
    return s.slice(0, units);
  };
  const randomEdit = (len) => {
    const pos = r.below(len + 1);
    const del = Math.min(r.below(4), len - pos);
    let ins = '';
    for (let n = r.below(4); n > 0; n--) ins += TOKENS[r.below(TOKENS.length)];
    return new TextOperation().retain(pos).insert(ins).delete(del).retain(len - pos - del);
  };
  const fnv = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h.toString(16).padStart(8, '0');
  };

  let text = randomText(TEXT_UNITS);
  let spent = 0;
  for (let i = 0; i < STEPS; i++) {
    const a = randomEdit(text.length);
    const b = randomEdit(text.length);
    const start = performance.now();
    const [a2] = TextOperation.transform(a, b);
    text = a2.apply(b.apply(text));
    spent += performance.now() - start;
  }
  console.log(`transform+apply: ${STEPS} steps on ${TEXT_UNITS} units in ${spent.toFixed(1)} ms (len ${text.length}, fnv ${fnv(text)})`);

  let big = randomText(BIG_UNITS);
  spent = 0;
  for (let i = 0; i < BIG_APPLIES; i++) {
    const pos = r.below(BIG_UNITS);
    const op = new TextOperation().retain(pos).insert('x').delete(1).retain(BIG_UNITS - pos - 1);
    const start = performance.now();
    big = op.apply(big);
    spent += performance.now() - start;
  }
  console.log(`apply 1 MiB: ${BIG_APPLIES} applies, ${(spent / BIG_APPLIES).toFixed(3)} ms each (fnv ${fnv(big)})`);
}

if (args.includes('--bench')) bench();
else writeVectors();
