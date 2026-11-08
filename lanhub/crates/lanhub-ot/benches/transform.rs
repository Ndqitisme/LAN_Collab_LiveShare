//! Same workload as `node tools/gen-ot-vectors.mjs --bench`: equal fnv checksums prove both ran it.

use std::time::{Duration, Instant};

use lanhub_ot::TextOperation;

const STEPS: usize = 100_000;
const TEXT_UNITS: usize = 100 * 1024;
const BIG_UNITS: usize = 1024 * 1024;
const BIG_APPLIES: usize = 200;
const ALPHABET: [&str; 8] = ["a", "b", "x", " ", "\n", "\r\n", "Đ", "🙂"];

struct Lcg(u32);

impl Lcg {
    fn below(&mut self, k: usize) -> usize {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.0 as f64 / 4294967296.0 * k as f64).floor() as usize
    }

    fn token(&mut self) -> impl Iterator<Item = u16> {
        ALPHABET[self.below(ALPHABET.len())].encode_utf16()
    }
}

fn random_text(r: &mut Lcg, units: usize) -> Vec<u16> {
    let mut out = Vec::with_capacity(units + 2);
    while out.len() < units {
        out.extend(r.token());
    }
    out.truncate(units);
    out
}

fn random_edit(r: &mut Lcg, len: usize) -> TextOperation {
    let pos = r.below(len + 1);
    let del = r.below(4).min(len - pos);
    let mut ins = Vec::new();
    for _ in 0..r.below(4) {
        ins.extend(r.token());
    }
    let mut op = TextOperation::new();
    op.retain(pos)
        .insert(&ins)
        .delete(del)
        .retain(len - pos - del);
    op
}

fn fnv(text: &[u16]) -> u32 {
    text.iter()
        .fold(2166136261u32, |h, &u| (h ^ u as u32).wrapping_mul(16777619))
}

fn main() {
    let mut r = Lcg(0x5eed);
    let mut text = random_text(&mut r, TEXT_UNITS);
    let mut spent = Duration::ZERO;
    for _ in 0..STEPS {
        let a = random_edit(&mut r, text.len());
        let b = random_edit(&mut r, text.len());
        let start = Instant::now();
        let (a2, _) = TextOperation::transform(&a, &b).unwrap();
        text = a2.apply(&b.apply(&text).unwrap()).unwrap();
        spent += start.elapsed();
    }
    println!(
        "transform+apply: {STEPS} steps on {TEXT_UNITS} units in {:.1} ms (len {}, fnv {:08x})",
        spent.as_secs_f64() * 1e3,
        text.len(),
        fnv(&text)
    );

    let mut big = random_text(&mut r, BIG_UNITS);
    let x: Vec<u16> = "x".encode_utf16().collect();
    let mut spent = Duration::ZERO;
    for _ in 0..BIG_APPLIES {
        let pos = r.below(BIG_UNITS);
        let mut op = TextOperation::new();
        op.retain(pos)
            .insert(&x)
            .delete(1)
            .retain(BIG_UNITS - pos - 1);
        let start = Instant::now();
        big = op.apply(&big).unwrap();
        spent += start.elapsed();
    }
    println!(
        "apply 1 MiB: {BIG_APPLIES} applies, {:.3} ms each (fnv {:08x})",
        spent.as_secs_f64() * 1e3 / BIG_APPLIES as f64,
        fnv(&big)
    );
}
