use std::collections::HashMap;
use std::ops::Range;

use crate::TextOperation;

const CR: u16 = b'\r' as u16;
const LF: u16 = b'\n' as u16;

const CHAR_DIFF_MAX_UNITS: usize = 8000;
const CHAR_DIFF_MAX_EDITS: usize = 1000;
const LINE_DIFF_MAX_EDITS: usize = 3000;

fn is_high_surrogate(c: u16) -> bool {
    (0xd800..=0xdbff).contains(&c)
}

/// Port of `diff` in `lib/ot.js`: a minimal Myers diff, lines first for large inputs, that never cuts a
/// surrogate pair or a CRLF in the common prefix or suffix. The result equals the JavaScript op exactly.
pub fn diff(a: &[u16], b: &[u16]) -> TextOperation {
    let mut op = TextOperation::new();
    if a == b {
        op.retain(a.len());
        return op;
    }
    let (p, s) = common_ends(a, b);
    op.retain(p);
    let am = &a[p..a.len() - s];
    let bm = &b[p..b.len() - s];
    if am.len() + bm.len() <= CHAR_DIFF_MAX_UNITS {
        append_char_diff(&mut op, am, bm);
    } else {
        let ta = line_tokens(am);
        let tb = line_tokens(bm);
        match token_steps(&ta, &tb, LINE_DIFF_MAX_EDITS) {
            Some(steps) => {
                for sg in segments(&ta, &tb, &steps, true) {
                    if sg.eq {
                        op.retain(sg.a.len());
                    } else {
                        append_char_diff(&mut op, &am[sg.a], &bm[sg.b]);
                    }
                }
            }
            None => {
                op.delete(am.len()).insert(bm);
            }
        }
    }
    op.retain(s);
    op
}

fn common_ends(a: &[u16], b: &[u16]) -> (usize, usize) {
    let max = a.len().min(b.len());
    let mut p = 0;
    while p < max && a[p] == b[p] {
        p += 1;
    }
    if p > 0
        && (is_high_surrogate(a[p - 1])
            || (a[p - 1] == CR && (a.get(p) == Some(&LF) || b.get(p) == Some(&LF))))
    {
        p -= 1;
    }
    let mut s = 0;
    while s < max - p && a[a.len() - 1 - s] == b[b.len() - 1 - s] {
        s += 1;
    }
    if s > 0 {
        let ia = a.len() - s;
        let ib = b.len() - s;
        let before = |t: &[u16], i: usize| i.checked_sub(1).map(|j| t[j]);
        if before(a, ia).is_some_and(is_high_surrogate)
            || (a[ia] == LF && before(a, ia) == Some(CR))
            || (b[ib] == LF && before(b, ib) == Some(CR))
        {
            s -= 1;
        }
    }
    (p, s)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Step {
    Equal,
    Delete,
    Insert,
}

/// Myers O(ND) diff over token ids. `None` when more than `max_d` edits are needed.
fn myers(a: &[u32], b: &[u32], max_d: usize) -> Option<Vec<Step>> {
    let n = a.len();
    let m = b.len();
    let off = n + m + 1;
    let mut v = vec![0i32; 2 * off + 1];
    // Round d stores the 2d + 3 entries of V around diagonal 0 at offset d * d + 2 * d.
    let mut trace: Vec<i32> = Vec::new();
    for d in 0..=n + m {
        if d > max_d {
            return None;
        }
        trace.extend_from_slice(&v[off - d - 1..off + d + 2]);
        let di = d as isize;
        let mut k = -di;
        while k <= di {
            let at = (off as isize + k) as usize;
            let mut x = if k == -di || (k != di && v[at - 1] < v[at + 1]) {
                v[at + 1] as isize
            } else {
                v[at - 1] as isize + 1
            };
            let mut y = x - k;
            // A negative y casts to a huge usize, so the bound check fails as JavaScript's undefined compare does.
            while (x as usize) < n && (y as usize) < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[at] = x as i32;
            if x >= n as isize && y >= m as isize {
                return Some(backtrack(&trace, d, n, m));
            }
            k += 2;
        }
    }
    None
}

fn backtrack(trace: &[i32], last_d: usize, n: usize, m: usize) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut x = n as isize;
    let mut y = m as isize;
    for d in (0..=last_d).rev() {
        let di = d as isize;
        let base = (d * d + 2 * d) as isize;
        let at = |k: isize| trace[(base + k + di + 1) as usize] as isize;
        let k = x - y;
        let prev_k = if k == -di || (k != di && at(k - 1) < at(k + 1)) {
            k + 1
        } else {
            k - 1
        };
        let (prev_x, prev_y) = if d == 0 {
            (0, 0)
        } else {
            let px = at(prev_k);
            (px, px - prev_k)
        };
        while x > prev_x && y > prev_y {
            steps.push(Step::Equal);
            x -= 1;
            y -= 1;
        }
        if d > 0 {
            steps.push(if x == prev_x {
                Step::Insert
            } else {
                Step::Delete
            });
        }
        x = prev_x;
        y = prev_y;
    }
    steps.reverse();
    steps
}

/// Characters, keeping CRLF and surrogate pairs whole.
fn char_tokens(s: &[u16]) -> Vec<&[u16]> {
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let pair = i + 1 < s.len() && ((s[i] == CR && s[i + 1] == LF) || is_high_surrogate(s[i]));
        let w = if pair { 2 } else { 1 };
        out.push(&s[i..i + w]);
        i += w;
    }
    out
}

fn line_tokens(s: &[u16]) -> Vec<&[u16]> {
    s.split_inclusive(|&c| c == LF).collect()
}

fn token_steps<'t>(ta: &[&'t [u16]], tb: &[&'t [u16]], max_d: usize) -> Option<Vec<Step>> {
    let mut ids: HashMap<&'t [u16], u32> = HashMap::new();
    let mut id = |t: &'t [u16]| {
        let next = ids.len() as u32;
        *ids.entry(t).or_insert(next)
    };
    let a: Vec<u32> = ta.iter().map(|&t| id(t)).collect();
    let b: Vec<u32> = tb.iter().map(|&t| id(t)).collect();
    myers(&a, &b, max_d)
}

/// An equal run or a change block, as unit ranges into the two inputs. Both ranges stay contiguous, and
/// an equal run has the same content on both sides.
struct Segment {
    eq: bool,
    a: Range<usize>,
    b: Range<usize>,
    tokens: usize,
}

// Groups Myers steps into equal runs and change blocks. With glue, a short equal run between two changes is
// folded into one block, so a line-level alignment on a stray blank line cannot split one edit in two.
fn segments(ta: &[&[u16]], tb: &[&[u16]], steps: &[Step], glue: bool) -> Vec<Segment> {
    let mut segs: Vec<Segment> = Vec::new();
    let (mut i, mut j, mut ua, mut ub) = (0, 0, 0, 0);
    for &step in steps {
        if step == Step::Equal {
            let la = ta[i].len();
            let lb = tb[j].len();
            i += 1;
            j += 1;
            match segs.last_mut() {
                Some(last) if last.eq => {
                    last.a.end += la;
                    last.b.end += lb;
                    last.tokens += 1;
                }
                _ => segs.push(Segment {
                    eq: true,
                    a: ua..ua + la,
                    b: ub..ub + lb,
                    tokens: 1,
                }),
            }
            ua += la;
            ub += lb;
            continue;
        }
        if segs.last().is_none_or(|last| last.eq) {
            segs.push(Segment {
                eq: false,
                a: ua..ua,
                b: ub..ub,
                tokens: 0,
            });
        }
        let last = segs.last_mut().expect("pushed above");
        if step == Step::Delete {
            ua += ta[i].len();
            last.a.end = ua;
            i += 1;
        } else {
            ub += tb[j].len();
            last.b.end = ub;
            j += 1;
        }
    }
    if !glue {
        return segs;
    }
    let count = segs.len();
    let mut out: Vec<Segment> = Vec::new();
    for (k, sg) in segs.into_iter().enumerate() {
        match out.last_mut() {
            Some(prev)
                if !prev.eq
                    && (!sg.eq || (k + 1 < count && (sg.tokens <= 2 || sg.a.len() <= 120))) =>
            {
                prev.a.end = sg.a.end;
                prev.b.end = sg.b.end;
            }
            _ => out.push(sg),
        }
    }
    out
}

fn append_char_diff(op: &mut TextOperation, a: &[u16], b: &[u16]) {
    if !a.is_empty() && !b.is_empty() && a.len() + b.len() <= CHAR_DIFF_MAX_UNITS {
        let ta = char_tokens(a);
        let tb = char_tokens(b);
        if let Some(steps) = token_steps(&ta, &tb, CHAR_DIFF_MAX_EDITS) {
            for sg in segments(&ta, &tb, &steps, false) {
                if sg.eq {
                    op.retain(sg.a.len());
                } else {
                    op.delete(sg.a.len()).insert(&b[sg.b]);
                }
            }
            return;
        }
    }
    op.delete(a.len()).insert(b);
}
