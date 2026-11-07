'use strict';

// Property tests for the OT core: transform must converge, compose must equal sequential apply.
const assert = require('assert');
const { TextOperation, diff, fromChanges, withPrefix, stripPrefix } = require('../lib/ot');
const { encodeInviteV3, decodeInviteV3, decodeInvite } = require('../lib/common');

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

// Invite v3 round trip: every address, the port, project, token and TLS fingerprint come back unchanged.
const ips = ['192.168.1.10', '10.0.0.5', '172.16.4.2', '192.168.56.1', '100.64.0.7', '169.254.10.1', '10.8.0.2', '192.168.137.1'];
const fp = 'ab'.repeat(32);
for (const n of [1, 4, 8]) {
  for (const extra of [{}, { fingerprint: fp }]) {
    const inv = { instanceId: '0b6f2c7e-6f0e-4c3a-9a51-2f1d8e7c4b10', hosts: ips.slice(0, n), port: 8200, project: 'Dự án A', token: '5f0c9e', ...extra };
    const code = encodeInviteV3(inv);
    assert.match(code, /^LC3-[A-Za-z0-9_-]+$/);
    assert.deepStrictEqual(decodeInviteV3(code), inv);
    assert.deepStrictEqual(decodeInviteV3(` ${code.slice(0, 20)}\n${code.slice(20)} `), inv, 'whitespace from a chat paste is ignored');
    checks += 3;
  }
}
const v3 = (j) => `LC3-${Buffer.from(JSON.stringify(j)).toString('base64url')}`;
const good = { v: 3, i: 'id', a: ['10.0.0.1'], p: 8200, n: 'P', t: '' };
assert.deepStrictEqual(decodeInviteV3(v3(good)), { instanceId: 'id', hosts: ['10.0.0.1'], port: 8200, project: 'P', token: '' });
for (const bad of [{ v: 2 }, { a: [] }, { a: '10.0.0.1' }, { p: 0 }, { p: 70000 }, { n: '' }, { i: '' }, { t: 5 }, { f: 'AB:CD' }, { f: 'ab'.repeat(31) }]) {
  assert.strictEqual(decodeInviteV3(v3({ ...good, ...bad })), null, JSON.stringify(bad));
}
for (const bad of ['', 'LC-AQoAAAEAAQAAWA', 'LC3-', 'LC3-!!!', `LC3-${Buffer.from('not json').toString('base64url')}`]) {
  assert.strictEqual(decodeInviteV3(bad), null, bad);
}
assert.strictEqual(decodeInvite(encodeInviteV3({ ...good, instanceId: 'id', hosts: ['10.0.0.1'], project: 'P' })), null, 'v1/v2 decoder ignores v3');
checks += 17;

console.log(`ot.test.js: ${checks} kiểm tra OK`);
