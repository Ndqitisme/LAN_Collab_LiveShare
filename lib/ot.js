'use strict';

// Operational transformation on plain strings (same model as ot.js):
// an operation is a list of retain(n > 0), insert(string), delete(n < 0).

const isRetain = (o) => typeof o === 'number' && o > 0;
const isInsert = (o) => typeof o === 'string';
const isDelete = (o) => typeof o === 'number' && o < 0;

class TextOperation {
  constructor() {
    this.ops = [];
    this.baseLength = 0;
    this.targetLength = 0;
  }

  retain(n) {
    if (n === 0) return this;
    if (!Number.isInteger(n) || n < 0) throw new Error(`retain: invalid count ${n}`);
    this.baseLength += n;
    this.targetLength += n;
    const ops = this.ops;
    if (isRetain(ops[ops.length - 1])) ops[ops.length - 1] += n;
    else ops.push(n);
    return this;
  }

  insert(s) {
    if (typeof s !== 'string') throw new Error('insert: expects a string');
    if (s === '') return this;
    this.targetLength += s.length;
    const ops = this.ops;
    const n = ops.length;
    if (isInsert(ops[n - 1])) {
      ops[n - 1] += s;
    } else if (isDelete(ops[n - 1])) {
      // Inserts always precede deletes at the same position so equal edits have one canonical form.
      if (isInsert(ops[n - 2])) ops[n - 2] += s;
      else {
        ops[n] = ops[n - 1];
        ops[n - 1] = s;
      }
    } else {
      ops.push(s);
    }
    return this;
  }

  delete(n) {
    if (typeof n === 'string') n = n.length;
    if (n === 0) return this;
    if (!Number.isInteger(n)) throw new Error(`delete: invalid count ${n}`);
    if (n > 0) n = -n;
    this.baseLength -= n;
    const ops = this.ops;
    if (isDelete(ops[ops.length - 1])) ops[ops.length - 1] += n;
    else ops.push(n);
    return this;
  }

  isNoop() {
    return this.ops.length === 0 || (this.ops.length === 1 && isRetain(this.ops[0]));
  }

  apply(str) {
    if (str.length !== this.baseLength) {
      throw new Error(`apply: text length ${str.length} differs from baseLength ${this.baseLength}`);
    }
    const parts = [];
    let pos = 0;
    for (const o of this.ops) {
      if (isRetain(o)) {
        parts.push(str.slice(pos, pos + o));
        pos += o;
      } else if (isInsert(o)) {
        parts.push(o);
      } else {
        pos -= o;
      }
    }
    return parts.join('');
  }

  compose(other) {
    if (this.targetLength !== other.baseLength) {
      throw new Error('compose: targetLength of op 1 differs from baseLength of op 2');
    }
    const result = new TextOperation();
    const ops1 = this.ops;
    const ops2 = other.ops;
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];
    for (;;) {
      if (op1 === undefined && op2 === undefined) break;
      if (isDelete(op1)) {
        result.delete(op1);
        op1 = ops1[i1++];
        continue;
      }
      if (isInsert(op2)) {
        result.insert(op2);
        op2 = ops2[i2++];
        continue;
      }
      if (op1 === undefined) throw new Error('compose: op 1 too short');
      if (op2 === undefined) throw new Error('compose: op 1 too long');

      if (isRetain(op1) && isRetain(op2)) {
        if (op1 > op2) {
          result.retain(op2);
          op1 -= op2;
          op2 = ops2[i2++];
        } else if (op1 === op2) {
          result.retain(op1);
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          result.retain(op1);
          op2 -= op1;
          op1 = ops1[i1++];
        }
      } else if (isInsert(op1) && isDelete(op2)) {
        if (op1.length > -op2) {
          op1 = op1.slice(-op2);
          op2 = ops2[i2++];
        } else if (op1.length === -op2) {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          op2 += op1.length;
          op1 = ops1[i1++];
        }
      } else if (isInsert(op1) && isRetain(op2)) {
        if (op1.length > op2) {
          result.insert(op1.slice(0, op2));
          op1 = op1.slice(op2);
          op2 = ops2[i2++];
        } else if (op1.length === op2) {
          result.insert(op1);
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          result.insert(op1);
          op2 -= op1.length;
          op1 = ops1[i1++];
        }
      } else if (isRetain(op1) && isDelete(op2)) {
        if (op1 > -op2) {
          result.delete(op2);
          op1 += op2;
          op2 = ops2[i2++];
        } else if (op1 === -op2) {
          result.delete(op2);
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          result.delete(op1);
          op2 += op1;
          op1 = ops1[i1++];
        }
      } else {
        throw new Error('compose: invalid state');
      }
    }
    return result;
  }

  // Returns [a', b'] with a ∘ b' == b ∘ a'. On equal-position inserts, a's text comes first.
  static transform(a, b) {
    if (a.baseLength !== b.baseLength) throw new Error('transform: ops have different baseLength');
    const a2 = new TextOperation();
    const b2 = new TextOperation();
    const ops1 = a.ops;
    const ops2 = b.ops;
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];
    for (;;) {
      if (op1 === undefined && op2 === undefined) break;
      if (isInsert(op1)) {
        a2.insert(op1);
        b2.retain(op1.length);
        op1 = ops1[i1++];
        continue;
      }
      if (isInsert(op2)) {
        a2.retain(op2.length);
        b2.insert(op2);
        op2 = ops2[i2++];
        continue;
      }
      if (op1 === undefined) throw new Error('transform: op 1 too short');
      if (op2 === undefined) throw new Error('transform: op 1 too long');

      let min;
      if (isRetain(op1) && isRetain(op2)) {
        if (op1 > op2) {
          min = op2;
          op1 -= op2;
          op2 = ops2[i2++];
        } else if (op1 === op2) {
          min = op2;
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          min = op1;
          op2 -= op1;
          op1 = ops1[i1++];
        }
        a2.retain(min);
        b2.retain(min);
      } else if (isDelete(op1) && isDelete(op2)) {
        if (-op1 > -op2) {
          op1 -= op2;
          op2 = ops2[i2++];
        } else if (op1 === op2) {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          op2 -= op1;
          op1 = ops1[i1++];
        }
      } else if (isDelete(op1) && isRetain(op2)) {
        if (-op1 > op2) {
          min = op2;
          op1 += op2;
          op2 = ops2[i2++];
        } else if (-op1 === op2) {
          min = op2;
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          min = -op1;
          op2 += op1;
          op1 = ops1[i1++];
        }
        a2.delete(min);
      } else if (isRetain(op1) && isDelete(op2)) {
        if (op1 > -op2) {
          min = -op2;
          op1 += op2;
          op2 = ops2[i2++];
        } else if (op1 === -op2) {
          min = op1;
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          min = op1;
          op2 += op1;
          op1 = ops1[i1++];
        }
        b2.delete(min);
      } else {
        throw new Error('transform: invalid state');
      }
    }
    return [a2, b2];
  }

  // Where a cursor at `index` (in the base text) ends up after this operation.
  transformIndex(index) {
    let pos = 0;
    let moved = index;
    for (const o of this.ops) {
      if (pos > index) break;
      if (isRetain(o)) {
        pos += o;
      } else if (isInsert(o)) {
        moved += o.length;
      } else {
        moved -= Math.min(-o, index - pos);
        pos -= o;
      }
    }
    return moved;
  }

  toJSON() {
    return this.ops;
  }

  static fromJSON(ops) {
    if (!Array.isArray(ops)) throw new Error('op must be an array');
    const op = new TextOperation();
    for (const o of ops) {
      if (isInsert(o)) op.insert(o);
      else if (Number.isInteger(o) && o > 0) op.retain(o);
      else if (Number.isInteger(o) && o < 0) op.delete(o);
      else throw new Error(`invalid op component: ${JSON.stringify(o)}`);
    }
    return op;
  }
}

const isHighSurrogate = (c) => c >= 0xd800 && c <= 0xdbff;

// Common prefix/suffix lengths that never cut a surrogate pair or a CRLF.
function commonEnds(a, b) {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  if (p > 0 && (isHighSurrogate(a.charCodeAt(p - 1)) || (a[p - 1] === '\r' && (a[p] === '\n' || b[p] === '\n')))) p--;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (s > 0) {
    const ia = a.length - s;
    const ib = b.length - s;
    if (isHighSurrogate(a.charCodeAt(ia - 1)) || (a[ia] === '\n' && a[ia - 1] === '\r') || (b[ib] === '\n' && b[ib - 1] === '\r')) s--;
  }
  return [p, s];
}

// Myers O(ND) diff on token arrays. Returns a list of 'e'/'d'/'i' steps, or null when more than maxD edits.
function myers(A, B, maxD) {
  const N = A.length;
  const M = B.length;
  const off = N + M + 1;
  const V = new Int32Array(2 * off + 1);
  const trace = [];
  for (let d = 0; d <= N + M; d++) {
    if (d > maxD) return null;
    trace.push(V.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      V[off + k] = x;
      if (x >= N && y >= M) return backtrack(trace, N, M);
    }
  }
  return null;
}

function backtrack(trace, N, M) {
  const steps = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const at = (k) => v[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push('e');
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) steps.push('i');
      else steps.push('d');
    }
    x = prevX;
    y = prevY;
  }
  return steps.reverse();
}

// Characters, keeping CRLF and surrogate pairs whole.
function charTokens(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if ((s[i] === '\r' && s[i + 1] === '\n') || (isHighSurrogate(s.charCodeAt(i)) && i + 1 < s.length)) {
      out.push(s.slice(i, i + 2));
      i++;
    } else out.push(s[i]);
  }
  return out;
}

function lineTokens(s) {
  const out = [];
  let start = 0;
  let i;
  while ((i = s.indexOf('\n', start)) >= 0) {
    out.push(s.slice(start, i + 1));
    start = i + 1;
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

function tokenSteps(ta, tb, maxD) {
  const ids = new Map();
  const id = (t) => {
    let n = ids.get(t);
    if (n === undefined) {
      n = ids.size;
      ids.set(t, n);
    }
    return n;
  };
  return myers(ta.map(id), tb.map(id), maxD);
}

// Groups Myers steps into equal runs and change blocks. With glue, a short equal run between two changes is
// folded into one block, so a line-level alignment on a stray blank line cannot split one edit in two.
function segments(ta, tb, steps, glue) {
  const segs = [];
  let i = 0;
  let j = 0;
  for (const s of steps) {
    let last = segs[segs.length - 1];
    if (s === 'e') {
      const t = ta[i++];
      j++;
      if (last && last.eq) {
        last.text += t;
        last.n += 1;
      } else segs.push({ eq: true, text: t, n: 1 });
      continue;
    }
    if (!last || last.eq) {
      last = { eq: false, del: '', ins: '' };
      segs.push(last);
    }
    if (s === 'd') last.del += ta[i++];
    else last.ins += tb[j++];
  }
  if (!glue) return segs;
  const out = [];
  segs.forEach((sg, k) => {
    const prev = out[out.length - 1];
    if (sg.eq && prev && !prev.eq && k + 1 < segs.length && (sg.n <= 2 || sg.text.length <= 120)) {
      prev.del += sg.text;
      prev.ins += sg.text;
    } else if (!sg.eq && prev && !prev.eq) {
      prev.del += sg.del;
      prev.ins += sg.ins;
    } else out.push({ ...sg });
  });
  return out;
}

function appendSegments(op, segs, onChange) {
  for (const sg of segs) {
    if (sg.eq) op.retain(sg.text.length);
    else onChange(sg.del, sg.ins);
  }
}

function appendCharDiff(op, a, b) {
  if (a && b && a.length + b.length <= 8000) {
    const ta = charTokens(a);
    const tb = charTokens(b);
    const steps = tokenSteps(ta, tb, 1000);
    if (steps) {
      appendSegments(op, segments(ta, tb, steps, false), (d, i) => op.delete(d.length).insert(i));
      return;
    }
  }
  op.delete(a.length).insert(b);
}

// Minimal diff (Myers) so edits stay small and separate: two concurrent changes near each other then merge
// cleanly instead of duplicating the text in between. Large inputs go lines first, then characters per block.
function diff(a, b) {
  const op = new TextOperation();
  if (a === b) return op.retain(a.length);
  const [p, s] = commonEnds(a, b);
  op.retain(p);
  const am = a.slice(p, a.length - s);
  const bm = b.slice(p, b.length - s);
  if (am.length + bm.length <= 8000) appendCharDiff(op, am, bm);
  else {
    const ta = lineTokens(am);
    const tb = lineTokens(bm);
    const steps = tokenSteps(ta, tb, 3000);
    if (steps) appendSegments(op, segments(ta, tb, steps, true), (d, i) => appendCharDiff(op, d, i));
    else op.delete(am.length).insert(bm);
  }
  return op.retain(s);
}

// Builds an operation from editor change records ({rangeOffset, rangeLength, text}) whose
// offsets all refer to the text before the change. Returns null if they overlap.
function fromChanges(oldText, changes) {
  const sorted = [...changes].sort((x, y) => x.rangeOffset - y.rangeOffset);
  const op = new TextOperation();
  let pos = 0;
  for (const c of sorted) {
    if (c.rangeOffset < pos) return null;
    op.retain(c.rangeOffset - pos);
    op.insert(c.text);
    op.delete(c.rangeLength);
    pos = c.rangeOffset + c.rangeLength;
  }
  if (pos > oldText.length) return null;
  return op.retain(oldText.length - pos);
}

// Prepends retain(n): maps an op on text T to the same op on prefix + T.
function withPrefix(op, n) {
  const out = new TextOperation().retain(n);
  for (const o of op.ops) {
    if (isRetain(o)) out.retain(o);
    else if (isInsert(o)) out.insert(o);
    else out.delete(o);
  }
  return out;
}

// Inverse of withPrefix; null if the op touches the first n characters.
function stripPrefix(op, n) {
  if (!isRetain(op.ops[0]) || op.ops[0] < n) return null;
  const out = new TextOperation();
  op.ops.forEach((o, i) => {
    if (i === 0) out.retain(o - n);
    else if (isRetain(o)) out.retain(o);
    else if (isInsert(o)) out.insert(o);
    else out.delete(o);
  });
  return out;
}

module.exports = { TextOperation, diff, fromChanges, withPrefix, stripPrefix, isRetain, isInsert, isDelete };
