//! Seeded randomized properties over UTF-16 text with surrogate pairs, CRLF, and ops that cut anywhere.

use lanhub_ot::{Component, TextOperation, diff};

struct Lcg(u32);

impl Lcg {
    fn below(&mut self, k: usize) -> usize {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        ((self.0 as u64 * k as u64) >> 32) as usize
    }
}

const TOKENS: [&str; 10] = ["a", "b", "x", " ", "\n", "\r\n", "\r", "Đ", "🙂", "𝄞"];

fn text(r: &mut Lcg, max_tokens: usize) -> Vec<u16> {
    let mut out = Vec::new();
    for _ in 0..r.below(max_tokens + 1) {
        out.extend(TOKENS[r.below(TOKENS.len())].encode_utf16());
    }
    out
}

/// Cuts at any code unit, so it also splits surrogate pairs and CRLF.
fn op(r: &mut Lcg, len: usize) -> TextOperation {
    let mut o = TextOperation::new();
    let mut left = len;
    while left > 0 {
        let n = 1 + r.below(left.min(6));
        match r.below(10) {
            0 | 1 => {
                o.insert(&text(r, 3));
            }
            2..=4 => {
                o.delete(n);
                left -= n;
            }
            _ => {
                o.retain(n);
                left -= n;
            }
        }
    }
    if r.below(3) == 0 {
        o.insert(&text(r, 3));
    }
    o
}

fn check_seed(seed: u32, max_tokens: usize) {
    let r = &mut Lcg(seed);
    let s = text(r, max_tokens);
    let a = op(r, s.len());
    let b = op(r, s.len());

    let (a2, b2) = TextOperation::transform(&a, &b).unwrap();
    let left = b2.apply(&a.apply(&s).unwrap()).unwrap();
    let right = a2.apply(&b.apply(&s).unwrap()).unwrap();
    assert_eq!(left, right, "transform does not converge, seed {seed}");
    assert_eq!(
        a.compose(&b2).unwrap(),
        b.compose(&a2).unwrap(),
        "seed {seed}"
    );

    let after_a = a.apply(&s).unwrap();
    let c = op(r, after_a.len());
    let composed = a.compose(&c).unwrap();
    assert_eq!(
        composed.apply(&s).unwrap(),
        c.apply(&after_a).unwrap(),
        "compose differs from sequential apply, seed {seed}"
    );

    let target = text(r, max_tokens);
    let d = diff(&s, &target);
    assert_eq!(d.apply(&s).unwrap(), target, "diff round trip, seed {seed}");
    assert_no_split(&s, &d, seed);

    let json = serde_json::to_value(&a).unwrap();
    assert_eq!(
        TextOperation::from_json(&json).unwrap(),
        a,
        "JSON round trip, seed {seed}"
    );
}

/// A retain that ends inside a surrogate pair or a CRLF of the old text would make the diff cut it.
fn assert_no_split(s: &[u16], d: &TextOperation, seed: u32) {
    let mut pos = 0;
    for c in d.ops() {
        match c {
            Component::Retain(n) => {
                pos += n;
                if pos < s.len() {
                    let cut_pair = (0xd800..=0xdbff).contains(&s[pos - 1]);
                    let cut_crlf = s[pos - 1] == b'\r' as u16 && s[pos] == b'\n' as u16;
                    assert!(!cut_pair && !cut_crlf, "diff cuts at {pos}, seed {seed}");
                }
            }
            Component::Delete(n) => pos += n,
            Component::Insert(_) => {}
        }
    }
}

#[test]
fn random_ops_converge() {
    for seed in 1..=5000 {
        check_seed(seed, 30);
    }
}

#[test]
#[ignore = "slow: run with --include-ignored"]
fn random_ops_converge_long() {
    for seed in 1..=100_000 {
        check_seed(seed, if seed % 20 == 0 { 2000 } else { 60 });
    }
}

#[test]
fn equal_position_inserts_put_a_first() {
    let mut a = TextOperation::new();
    a.retain(1).insert(&[b'A' as u16]).retain(1);
    let mut b = TextOperation::new();
    b.retain(1).insert(&[b'B' as u16]).retain(1);
    let (a2, b2) = TextOperation::transform(&a, &b).unwrap();
    let s: Vec<u16> = "xy".encode_utf16().collect();
    let want: Vec<u16> = "xABy".encode_utf16().collect();
    assert_eq!(a2.apply(&b.apply(&s).unwrap()).unwrap(), want);
    assert_eq!(b2.apply(&a.apply(&s).unwrap()).unwrap(), want);
}
