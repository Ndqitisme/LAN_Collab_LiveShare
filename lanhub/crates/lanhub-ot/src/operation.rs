use std::cmp::Ordering;
use std::fmt;

use serde::de::{self, Deserializer, SeqAccess, Visitor};
use serde::ser::{SerializeSeq, Serializer};
use serde::{Deserialize, Serialize};

/// One component of an operation. Lengths count UTF-16 code units, like JavaScript strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Component {
    Retain(usize),
    Delete(usize),
    Insert(Vec<u16>),
}

/// Port of `TextOperation` in `lib/ot.js`. The builder keeps the same canonical form, so the JSON of
/// every result matches the JavaScript output byte for byte.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TextOperation {
    ops: Vec<Component>,
    base_length: usize,
    target_length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OtError {
    ApplyLength { text: usize, base: usize },
    ComposeLength { target: usize, base: usize },
    TransformLength { a: usize, b: usize },
    Json(String),
}

impl fmt::Display for OtError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OtError::ApplyLength { text, base } => {
                write!(
                    f,
                    "apply: text length {text} differs from base length {base}"
                )
            }
            OtError::ComposeLength { target, base } => {
                write!(
                    f,
                    "compose: target length {target} differs from base length {base}"
                )
            }
            OtError::TransformLength { a, b } => {
                write!(f, "transform: base lengths differ ({a} and {b})")
            }
            OtError::Json(msg) => write!(f, "invalid op: {msg}"),
        }
    }
}

impl std::error::Error for OtError {}

#[derive(Clone, Copy)]
enum Piece<'a> {
    Retain(usize),
    Delete(usize),
    Insert(&'a [u16]),
}

impl<'a> From<&'a Component> for Piece<'a> {
    fn from(c: &'a Component) -> Self {
        match c {
            Component::Retain(n) => Piece::Retain(*n),
            Component::Delete(n) => Piece::Delete(*n),
            Component::Insert(s) => Piece::Insert(s),
        }
    }
}

const BROKEN_INVARIANT: &str =
    "component lengths always sum to the checked base and target lengths";

impl TextOperation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ops(&self) -> &[Component] {
        &self.ops
    }

    pub fn base_length(&self) -> usize {
        self.base_length
    }

    pub fn target_length(&self) -> usize {
        self.target_length
    }

    pub fn retain(&mut self, n: usize) -> &mut Self {
        if n == 0 {
            return self;
        }
        self.base_length += n;
        self.target_length += n;
        match self.ops.last_mut() {
            Some(Component::Retain(last)) => *last += n,
            _ => self.ops.push(Component::Retain(n)),
        }
        self
    }

    pub fn insert(&mut self, s: &[u16]) -> &mut Self {
        if s.is_empty() {
            return self;
        }
        self.target_length += s.len();
        match self.ops.as_mut_slice() {
            [.., Component::Insert(last)] => last.extend_from_slice(s),
            // Inserts always precede deletes at the same position so equal edits have one canonical form.
            [.., Component::Insert(prev), Component::Delete(_)] => prev.extend_from_slice(s),
            [.., Component::Delete(_)] => {
                let at = self.ops.len() - 1;
                self.ops.insert(at, Component::Insert(s.to_vec()));
            }
            _ => self.ops.push(Component::Insert(s.to_vec())),
        }
        self
    }

    pub fn delete(&mut self, n: usize) -> &mut Self {
        if n == 0 {
            return self;
        }
        self.base_length += n;
        match self.ops.last_mut() {
            Some(Component::Delete(last)) => *last += n,
            _ => self.ops.push(Component::Delete(n)),
        }
        self
    }

    pub fn is_noop(&self) -> bool {
        matches!(self.ops.as_slice(), [] | [Component::Retain(_)])
    }

    pub fn apply(&self, text: &[u16]) -> Result<Vec<u16>, OtError> {
        if text.len() != self.base_length {
            return Err(OtError::ApplyLength {
                text: text.len(),
                base: self.base_length,
            });
        }
        let mut out = Vec::with_capacity(self.target_length);
        let mut pos = 0;
        for c in &self.ops {
            match c {
                Component::Retain(n) => {
                    out.extend_from_slice(&text[pos..pos + n]);
                    pos += n;
                }
                Component::Insert(s) => out.extend_from_slice(s),
                Component::Delete(n) => pos += n,
            }
        }
        Ok(out)
    }

    pub fn compose(&self, other: &TextOperation) -> Result<TextOperation, OtError> {
        if self.target_length != other.base_length {
            return Err(OtError::ComposeLength {
                target: self.target_length,
                base: other.base_length,
            });
        }
        let mut result = TextOperation::new();
        let mut it1 = self.ops.iter().map(Piece::from);
        let mut it2 = other.ops.iter().map(Piece::from);
        let mut op1 = it1.next();
        let mut op2 = it2.next();
        loop {
            match (op1, op2) {
                (None, None) => break,
                (Some(Piece::Delete(n)), _) => {
                    result.delete(n);
                    op1 = it1.next();
                }
                (_, Some(Piece::Insert(s))) => {
                    result.insert(s);
                    op2 = it2.next();
                }
                (Some(Piece::Retain(n1)), Some(Piece::Retain(n2))) => match n1.cmp(&n2) {
                    Ordering::Greater => {
                        result.retain(n2);
                        op1 = Some(Piece::Retain(n1 - n2));
                        op2 = it2.next();
                    }
                    Ordering::Equal => {
                        result.retain(n1);
                        op1 = it1.next();
                        op2 = it2.next();
                    }
                    Ordering::Less => {
                        result.retain(n1);
                        op2 = Some(Piece::Retain(n2 - n1));
                        op1 = it1.next();
                    }
                },
                (Some(Piece::Insert(s)), Some(Piece::Delete(n))) => match s.len().cmp(&n) {
                    Ordering::Greater => {
                        op1 = Some(Piece::Insert(&s[n..]));
                        op2 = it2.next();
                    }
                    Ordering::Equal => {
                        op1 = it1.next();
                        op2 = it2.next();
                    }
                    Ordering::Less => {
                        op2 = Some(Piece::Delete(n - s.len()));
                        op1 = it1.next();
                    }
                },
                (Some(Piece::Insert(s)), Some(Piece::Retain(n))) => match s.len().cmp(&n) {
                    Ordering::Greater => {
                        result.insert(&s[..n]);
                        op1 = Some(Piece::Insert(&s[n..]));
                        op2 = it2.next();
                    }
                    Ordering::Equal => {
                        result.insert(s);
                        op1 = it1.next();
                        op2 = it2.next();
                    }
                    Ordering::Less => {
                        result.insert(s);
                        op2 = Some(Piece::Retain(n - s.len()));
                        op1 = it1.next();
                    }
                },
                (Some(Piece::Retain(n1)), Some(Piece::Delete(n2))) => match n1.cmp(&n2) {
                    Ordering::Greater => {
                        result.delete(n2);
                        op1 = Some(Piece::Retain(n1 - n2));
                        op2 = it2.next();
                    }
                    Ordering::Equal => {
                        result.delete(n2);
                        op1 = it1.next();
                        op2 = it2.next();
                    }
                    Ordering::Less => {
                        result.delete(n1);
                        op2 = Some(Piece::Delete(n2 - n1));
                        op1 = it1.next();
                    }
                },
                (None, _) | (_, None) => unreachable!("{BROKEN_INVARIANT}"),
            }
        }
        Ok(result)
    }

    /// Returns `(a', b')` with `a ∘ b' == b ∘ a'`. On equal-position inserts, the text of `a` comes first.
    pub fn transform(
        a: &TextOperation,
        b: &TextOperation,
    ) -> Result<(TextOperation, TextOperation), OtError> {
        if a.base_length != b.base_length {
            return Err(OtError::TransformLength {
                a: a.base_length,
                b: b.base_length,
            });
        }
        let mut a2 = TextOperation::new();
        let mut b2 = TextOperation::new();
        let mut it1 = a.ops.iter().map(Piece::from);
        let mut it2 = b.ops.iter().map(Piece::from);
        let mut op1 = it1.next();
        let mut op2 = it2.next();
        loop {
            let (n1, n2) = match (op1, op2) {
                (None, None) => break,
                (Some(Piece::Insert(s)), _) => {
                    a2.insert(s);
                    b2.retain(s.len());
                    op1 = it1.next();
                    continue;
                }
                (_, Some(Piece::Insert(s))) => {
                    a2.retain(s.len());
                    b2.insert(s);
                    op2 = it2.next();
                    continue;
                }
                (
                    Some(Piece::Retain(n1) | Piece::Delete(n1)),
                    Some(Piece::Retain(n2) | Piece::Delete(n2)),
                ) => (n1, n2),
                (None, _) | (_, None) => unreachable!("{BROKEN_INVARIANT}"),
            };
            let min = n1.min(n2);
            match (op1, op2) {
                (Some(Piece::Retain(_)), Some(Piece::Retain(_))) => {
                    a2.retain(min);
                    b2.retain(min);
                }
                (Some(Piece::Delete(_)), Some(Piece::Retain(_))) => {
                    a2.delete(min);
                }
                (Some(Piece::Retain(_)), Some(Piece::Delete(_))) => {
                    b2.delete(min);
                }
                _ => {}
            }
            op1 = shorten(op1, min, &mut it1);
            op2 = shorten(op2, min, &mut it2);
        }
        Ok((a2, b2))
    }

    /// Where a cursor at `index` (in the base text) ends up after this operation.
    pub fn transform_index(&self, index: usize) -> usize {
        let mut pos = 0;
        let mut moved = index;
        for c in &self.ops {
            if pos > index {
                break;
            }
            match c {
                Component::Retain(n) => pos += n,
                Component::Insert(s) => moved += s.len(),
                Component::Delete(n) => {
                    moved -= (*n).min(index - pos);
                    pos += n;
                }
            }
        }
        moved
    }

    /// Mirrors `TextOperation.fromJSON`: an array of positive integers (retain), negative integers
    /// (delete), and strings (insert), normalized through the builder.
    pub fn from_json(value: &serde_json::Value) -> Result<TextOperation, OtError> {
        TextOperation::deserialize(value).map_err(|e| OtError::Json(e.to_string()))
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("an operation always serializes")
    }
}

fn shorten<'a>(
    piece: Option<Piece<'a>>,
    used: usize,
    rest: &mut impl Iterator<Item = Piece<'a>>,
) -> Option<Piece<'a>> {
    match piece {
        Some(Piece::Retain(n)) if n > used => Some(Piece::Retain(n - used)),
        Some(Piece::Delete(n)) if n > used => Some(Piece::Delete(n - used)),
        _ => rest.next(),
    }
}

impl Serialize for TextOperation {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.ops.len()))?;
        for c in &self.ops {
            match c {
                Component::Retain(n) => seq.serialize_element(n)?,
                Component::Delete(n) => seq.serialize_element(&-(*n as i64))?,
                // serde cannot write a lone surrogate; one only appears when compose cuts an insert inside a pair.
                Component::Insert(s) => seq.serialize_element(&String::from_utf16_lossy(s))?,
            }
        }
        seq.end()
    }
}

impl<'de> Deserialize<'de> for TextOperation {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(OperationVisitor)
    }
}

struct OperationVisitor;

impl<'de> Visitor<'de> for OperationVisitor {
    type Value = TextOperation;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("an array of op components")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<TextOperation, A::Error> {
        let mut op = TextOperation::new();
        while let Some(JsonComponent(c)) = seq.next_element()? {
            match c {
                Component::Retain(n) => op.retain(n),
                Component::Delete(n) => op.delete(n),
                Component::Insert(s) => op.insert(&s),
            };
        }
        Ok(op)
    }
}

struct JsonComponent(Component);

impl<'de> Deserialize<'de> for JsonComponent {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer
            .deserialize_any(ComponentVisitor)
            .map(JsonComponent)
    }
}

// JavaScript accepts any integral number; larger than 2^53 - 1 it cannot describe a real text, so it is
// rejected here rather than overflowing.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

struct ComponentVisitor;

impl ComponentVisitor {
    fn count<E: de::Error>(negative: bool, magnitude: u64) -> Result<Component, E> {
        if magnitude == 0 || magnitude > MAX_SAFE_INTEGER {
            return Err(E::custom(format!(
                "invalid op component length {magnitude}"
            )));
        }
        let n = magnitude as usize;
        Ok(if negative {
            Component::Delete(n)
        } else {
            Component::Retain(n)
        })
    }
}

impl<'de> Visitor<'de> for ComponentVisitor {
    type Value = Component;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a non-zero integer or a string")
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Component, E> {
        Self::count(false, v)
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Component, E> {
        Self::count(v < 0, v.unsigned_abs())
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Component, E> {
        if !v.is_finite() || v.fract() != 0.0 || v.abs() > MAX_SAFE_INTEGER as f64 {
            return Err(E::custom(format!("invalid op component {v}")));
        }
        Self::count(v < 0.0, v.abs() as u64)
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Component, E> {
        Ok(Component::Insert(v.encode_utf16().collect()))
    }
}
