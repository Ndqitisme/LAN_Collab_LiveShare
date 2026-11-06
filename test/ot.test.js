'use strict';

// Property tests for the OT core: transform must converge, compose must equal sequential apply.
const assert = require('assert');
const { TextOperation, diff, fromChanges, withPrefix, stripPrefix } = require('../lib/ot');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomString(r, max) {
  const n = Math.floor(r() * max);
  let s = '';
  for (let i = 0; i < n; i++) s += ['a', 'b', '\n', 'x', 'y', ' ', 'Đ'][Math.floor(r() * 7)];
  return s;
}

function randomOp(r, text) {
  const op = new TextOperation();
  let left = text.length;
  while (left > 0) {
    const k = r();
    const n = 1 + Math.floor(r() * Math.min(left, 5));
    if (k < 0.2) op.insert(randomString(r, 4));
    else if (k < 0.5) {
      op.delete(n);
      left -= n;
    } else {
      op.retain(n);
      left -= n;
    }
  }
  if (r() < 0.3) op.insert(randomString(r, 4));
  return op;
}

let checks = 0;
for (let seed = 1; seed <= 3000; seed++) {
  const r = rng(seed);
  const text = randomString(r, 30);
  const a = randomOp(r, text);
  const b = randomOp(r, text);
  const [a2, b2] = TextOperation.transform(a, b);
  assert.strictEqual(b2.apply(a.apply(text)), a2.apply(b.apply(text)), `transform seed ${seed}`);

  const c = randomOp(r, a.apply(text));
  assert.strictEqual(a.compose(c).apply(text), c.apply(a.apply(text)), `compose seed ${seed}`);

  const target = randomString(r, 30);
  assert.strictEqual(diff(text, target).apply(text), target, `diff seed ${seed}`);

  assert.strictEqual(stripPrefix(withPrefix(a, 1), 1).apply(text), a.apply(text));
  assert.deepStrictEqual(TextOperation.fromJSON(JSON.parse(JSON.stringify(a))).ops, a.ops);
  checks += 5;
}

// CRLF and surrogate pairs are never split by diff.
for (const [x, y] of [['a\r\nb', 'a\r\nXb'], ['a\r\n', 'a\n'], ['🙂', '🙃'], ['x\r\ny', 'x\ry']]) {
  const op = diff(x, y);
  assert.strictEqual(op.apply(x), y);
  let pos = 0;
  for (const o of op.ops) {
    if (typeof o === 'number' && o > 0) {
      pos += o;
      assert.ok(!(x[pos - 1] === '\r' && x[pos] === '\n'), `diff cắt CRLF: ${JSON.stringify([x, y, op.ops])}`);
      assert.ok(!(x.charCodeAt(pos - 1) >= 0xd800 && x.charCodeAt(pos - 1) <= 0xdbff), 'diff cắt surrogate pair');
    } else if (typeof o === 'number') pos -= o;
  }
  checks += 1;
}

// Multi-cursor change records (offsets relative to the old text, any order).
const old = 'hello world\nfoo';
const changes = [
  { rangeOffset: 12, rangeLength: 3, text: 'bar' },
  { rangeOffset: 0, rangeLength: 5, text: 'HELLO' },
];
assert.strictEqual(fromChanges(old, changes).apply(old), 'HELLO world\nbar');
assert.strictEqual(fromChanges(old, [{ rangeOffset: 0, rangeLength: 5, text: '' }, { rangeOffset: 3, rangeLength: 1, text: '' }]), null);

// transformIndex: insert before the cursor shifts it, delete around it collapses it.
const ins = new TextOperation().retain(2).insert('XYZ').retain(5);
assert.strictEqual(ins.transformIndex(4), 7);
assert.strictEqual(ins.transformIndex(1), 1);
const del = new TextOperation().retain(1).delete(4).retain(2);
assert.strictEqual(del.transformIndex(3), 1);
assert.strictEqual(del.transformIndex(6), 2);
checks += 6;

console.log(`ot.test.js: ${checks} kiểm tra OK`);
