//! JSON as `JSON.parse` and `JSON.stringify` see it. A JavaScript peer may send a string holding a lone
//! surrogate (`"\ud83d"`), which serde_json refuses to put in a Rust `String`; this parser keeps such a
//! string as UTF-16 instead of dropping the whole line, and the writer escapes it back the same way.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt::Write as _;

use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::value::RawValue;
use ts_rs::TS;

/// A JavaScript string. `Wide` is used only for text that is not valid UTF-16 (a lone surrogate).
#[derive(Clone, Debug, PartialEq, Eq, Hash, TS)]
#[ts(as = "String")]
pub enum JsStr {
    Utf8(String),
    Wide(Vec<u16>),
}

impl JsStr {
    pub fn from_units(units: &[u16]) -> JsStr {
        match String::from_utf16(units) {
            Ok(s) => JsStr::Utf8(s),
            Err(_) => JsStr::Wide(units.to_vec()),
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsStr::Utf8(s) => Some(s),
            JsStr::Wide(_) => None,
        }
    }

    pub fn units(&self) -> Cow<'_, [u16]> {
        match self {
            JsStr::Utf8(s) => Cow::Owned(s.encode_utf16().collect()),
            JsStr::Wide(u) => Cow::Borrowed(u),
        }
    }

    /// `String.length`.
    pub fn len_units(&self) -> usize {
        match self {
            JsStr::Utf8(s) => s.chars().map(char::len_utf16).sum(),
            JsStr::Wide(u) => u.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            JsStr::Utf8(s) => s.is_empty(),
            JsStr::Wide(u) => u.is_empty(),
        }
    }

    /// `s.slice(0, n)`, which may cut a surrogate pair in two.
    pub fn truncate_units(&self, n: usize) -> JsStr {
        if self.len_units() <= n {
            return self.clone();
        }
        JsStr::from_units(&self.units()[..n])
    }

    /// The bytes `Buffer.from(s, 'utf8')` produces: a lone surrogate becomes U+FFFD.
    pub fn to_utf8_lossy(&self) -> Cow<'_, str> {
        match self {
            JsStr::Utf8(s) => Cow::Borrowed(s),
            JsStr::Wide(u) => Cow::Owned(String::from_utf16_lossy(u)),
        }
    }
}

impl From<&str> for JsStr {
    fn from(s: &str) -> Self {
        JsStr::Utf8(s.to_owned())
    }
}

impl From<String> for JsStr {
    fn from(s: String) -> Self {
        JsStr::Utf8(s)
    }
}

impl PartialEq<str> for JsStr {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == Some(other)
    }
}

impl Serialize for JsStr {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            JsStr::Utf8(s) => serializer.serialize_str(s),
            JsStr::Wide(u) => {
                let mut out = String::with_capacity(u.len() + 2);
                write_js_string(u, &mut out);
                raw(out).serialize(serializer)
            }
        }
    }
}

impl<'de> Deserialize<'de> for JsStr {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(JsStr::Utf8)
    }
}

/// UTF-16 text written the way `JSON.stringify` writes a string.
pub struct Utf16Text<'a>(pub &'a [u16]);

impl Serialize for Utf16Text<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match String::from_utf16(self.0) {
            Ok(s) => serializer.serialize_str(&s),
            Err(_) => JsStr::Wide(self.0.to_vec()).serialize(serializer),
        }
    }
}

/// A number written the way `JSON.stringify` writes it (`1e+21`, `5e-324`, `null` for NaN and Infinity).
#[derive(Clone, Copy, Debug, PartialEq, TS)]
#[ts(as = "f64")]
pub struct JsNumber(pub f64);

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

impl Serialize for JsNumber {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let v = self.0;
        if !v.is_finite() {
            serializer.serialize_unit()
        } else if v.fract() == 0.0 && v.abs() <= MAX_SAFE_INTEGER {
            serializer.serialize_i64(v as i64)
        } else {
            raw(js_number_to_string(v)).serialize(serializer)
        }
    }
}

fn raw(json: String) -> Box<RawValue> {
    RawValue::from_string(json).expect("the writer produces valid JSON")
}

/// `Number.prototype.toString()` for a finite number (ECMAScript Number::toString, radix 10).
pub fn js_number_to_string(v: f64) -> String {
    if v == 0.0 {
        return "0".into();
    }
    if v.is_nan() {
        return "NaN".into();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let mut out = String::new();
    if v < 0.0 {
        out.push('-');
    }
    // Rust's `{:e}` prints the shortest digits that round-trip, which is what ECMAScript asks for.
    let sci = format!("{:e}", v.abs());
    let (mantissa, exp) = sci.split_once('e').expect("{:e} always has an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp.parse::<i32>().expect("exponent is an integer") + 1;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        let e = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    }
    out
}

/// Appends `units` as a JSON string literal, escaping exactly what `JSON.stringify` escapes.
pub fn write_js_string(units: &[u16], out: &mut String) {
    out.push('"');
    let mut i = 0;
    while i < units.len() {
        let u = units[i];
        match u {
            0x22 => out.push_str("\\\""),
            0x5c => out.push_str("\\\\"),
            0x08 => out.push_str("\\b"),
            0x0c => out.push_str("\\f"),
            0x0a => out.push_str("\\n"),
            0x0d => out.push_str("\\r"),
            0x09 => out.push_str("\\t"),
            0..=0x1f => {
                let _ = write!(out, "\\u{u:04x}");
            }
            0xd800..=0xdbff if i + 1 < units.len() && (0xdc00..=0xdfff).contains(&units[i + 1]) => {
                let c = 0x10000 + (((u as u32) - 0xd800) << 10) + (units[i + 1] as u32 - 0xdc00);
                out.push(char::from_u32(c).expect("a surrogate pair is a valid code point"));
                i += 1;
            }
            0xd800..=0xdfff => {
                let _ = write!(out, "\\u{u:04x}");
            }
            _ => out.push(char::from_u32(u as u32).expect("a non-surrogate unit is a char")),
        }
        i += 1;
    }
    out.push('"');
}

/// A parsed JSON value. Object members keep their first position; a repeated key replaces the value,
/// like assigning to an existing property in JavaScript.
#[derive(Clone, Debug, PartialEq, TS)]
#[ts(type = "unknown")]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(JsStr),
    Arr(Vec<Json>),
    Obj(Vec<(JsStr, Json)>),
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_js_str(&self) -> Option<&JsStr> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        self.as_js_str().and_then(JsStr::as_str)
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn is_object(&self) -> bool {
        matches!(self, Json::Obj(_))
    }

    /// `typeof v === 'object' && v !== null`: arrays count, as in JavaScript.
    pub fn is_js_object(&self) -> bool {
        matches!(self, Json::Obj(_) | Json::Arr(_))
    }

    /// `Number.isInteger(v)`.
    pub fn as_js_integer(&self) -> Option<f64> {
        self.as_f64().filter(|n| n.is_finite() && n.fract() == 0.0)
    }

    /// JavaScript truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            Json::Null => false,
            Json::Bool(b) => *b,
            Json::Num(n) => *n != 0.0 && !n.is_nan(),
            Json::Str(s) => !s.is_empty(),
            Json::Arr(_) | Json::Obj(_) => true,
        }
    }

    /// `String(v)`.
    pub fn to_js_string(&self) -> JsStr {
        match self {
            Json::Str(s) => s.clone(),
            Json::Null => "null".into(),
            Json::Bool(b) => if *b { "true" } else { "false" }.into(),
            Json::Num(n) => js_number_to_string(*n).into(),
            Json::Obj(_) => "[object Object]".into(),
            Json::Arr(items) => {
                let mut units = Vec::new();
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        units.push(b',' as u16);
                    }
                    // Array.prototype.join writes null and undefined as nothing.
                    if !matches!(item, Json::Null) {
                        units.extend_from_slice(&item.to_js_string().units());
                    }
                }
                JsStr::from_units(&units)
            }
        }
    }

    /// `Number(v)` (ToNumber), NaN included.
    pub fn to_js_number(&self) -> f64 {
        match self {
            Json::Null => 0.0,
            Json::Bool(b) => f64::from(u8::from(*b)),
            Json::Num(n) => *n,
            Json::Str(s) => string_to_number(&s.to_utf8_lossy()),
            Json::Obj(_) => f64::NAN,
            Json::Arr(_) => string_to_number(&self.to_js_string().to_utf8_lossy()),
        }
    }
}

fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// ECMAScript StringToNumber.
fn string_to_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(rest) = t.strip_prefix(prefix) {
            if rest.is_empty() || !rest.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return rest.chars().fold(0.0, |acc, c| {
                acc * radix as f64 + c.to_digit(radix).unwrap() as f64
            });
        }
    }
    let unsigned = t.strip_prefix(['+', '-']).unwrap_or(t);
    if unsigned == "Infinity" {
        return if t.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    // Rust also accepts "inf" and "nan"; JavaScript accepts only digits, one dot and an exponent.
    let decimal = unsigned.bytes().enumerate().all(|(i, b)| {
        b.is_ascii_digit()
            || b == b'.'
            || b == b'e'
            || b == b'E'
            || ((b == b'+' || b == b'-')
                && i > 0
                && matches!(unsigned.as_bytes()[i - 1], b'e' | b'E'))
    });
    if !decimal || !unsigned.bytes().any(|b| b.is_ascii_digit()) {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// An integer-like key ("0" to "4294967294"), which JavaScript objects list first, in numeric order.
fn array_index(key: &JsStr) -> Option<u32> {
    let s = key.as_str()?;
    if s.is_empty() || (s.len() > 1 && s.starts_with('0')) || !s.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    s.parse::<u32>().ok().filter(|n| *n != u32::MAX)
}

impl Serialize for Json {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Json::Null => serializer.serialize_unit(),
            Json::Bool(b) => serializer.serialize_bool(*b),
            Json::Num(n) => JsNumber(*n).serialize(serializer),
            Json::Str(s) => s.serialize(serializer),
            Json::Arr(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            Json::Obj(members) => {
                let mut indexed: Vec<(u32, &(JsStr, Json))> = members
                    .iter()
                    .filter_map(|m| array_index(&m.0).map(|i| (i, m)))
                    .collect();
                indexed.sort_by_key(|(i, _)| *i);
                let mut map = serializer.serialize_map(Some(members.len()))?;
                for (_, (k, v)) in &indexed {
                    map.serialize_entry(k, v)?;
                }
                for (k, v) in members.iter().filter(|(k, _)| array_index(k).is_none()) {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}

/// Nesting deeper than this is refused. V8 parses any depth, but a value this deep cannot be a
/// protocol message, and recursion on it (drop, serialize) would overflow the stack.
pub const MAX_DEPTH: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError;

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("invalid JSON")
    }
}

impl std::error::Error for ParseError {}

/// `JSON.parse` on UTF-8 bytes. Invalid UTF-8 inside a string reads as U+FFFD, as Node's UTF-8 decoder
/// gives it to `JSON.parse`.
pub fn parse(input: &[u8]) -> Result<Json, ParseError> {
    let mut p = Parser { s: input, i: 0 };
    p.ws();
    let v = p.value(0)?;
    p.ws();
    if p.i != p.s.len() {
        return Err(ParseError);
    }
    Ok(v)
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn ws(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.s.get(self.i) {
            self.i += 1;
        }
    }

    fn eat(&mut self, lit: &[u8]) -> Result<(), ParseError> {
        if self.s[self.i..].starts_with(lit) {
            self.i += lit.len();
            Ok(())
        } else {
            Err(ParseError)
        }
    }

    fn value(&mut self, depth: usize) -> Result<Json, ParseError> {
        match self.s.get(self.i).ok_or(ParseError)? {
            b'{' => self.object(depth + 1),
            b'[' => self.array(depth + 1),
            b'"' => Ok(Json::Str(self.string()?)),
            b't' => self.eat(b"true").map(|_| Json::Bool(true)),
            b'f' => self.eat(b"false").map(|_| Json::Bool(false)),
            b'n' => self.eat(b"null").map(|_| Json::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => Err(ParseError),
        }
    }

    fn array(&mut self, depth: usize) -> Result<Json, ParseError> {
        if depth > MAX_DEPTH {
            return Err(ParseError);
        }
        self.i += 1;
        let mut items = Vec::new();
        self.ws();
        if self.s.get(self.i) == Some(&b']') {
            self.i += 1;
            return Ok(Json::Arr(items));
        }
        loop {
            self.ws();
            items.push(self.value(depth)?);
            self.ws();
            match self.s.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(Json::Arr(items));
                }
                _ => return Err(ParseError),
            }
        }
    }

    fn object(&mut self, depth: usize) -> Result<Json, ParseError> {
        if depth > MAX_DEPTH {
            return Err(ParseError);
        }
        self.i += 1;
        let mut members: Vec<(JsStr, Json)> = Vec::new();
        let mut index: Option<HashMap<JsStr, usize>> = None;
        self.ws();
        if self.s.get(self.i) == Some(&b'}') {
            self.i += 1;
            return Ok(Json::Obj(members));
        }
        loop {
            self.ws();
            if self.s.get(self.i) != Some(&b'"') {
                return Err(ParseError);
            }
            let key = self.string()?;
            self.ws();
            self.eat(b":")?;
            self.ws();
            let value = self.value(depth)?;
            // A linear scan is fine for message-sized objects; a large one gets a hash index.
            if members.len() == 16 && index.is_none() {
                index = Some(
                    members
                        .iter()
                        .enumerate()
                        .map(|(i, (k, _))| (k.clone(), i))
                        .collect(),
                );
            }
            let existing = match &index {
                Some(ix) => ix.get(&key).copied(),
                None => members.iter().position(|(k, _)| *k == key),
            };
            match existing {
                Some(at) => members[at].1 = value,
                None => {
                    if let Some(ix) = index.as_mut() {
                        ix.insert(key.clone(), members.len());
                    }
                    members.push((key, value));
                }
            }
            self.ws();
            match self.s.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Json::Obj(members));
                }
                _ => return Err(ParseError),
            }
        }
    }

    fn number(&mut self) -> Result<Json, ParseError> {
        let start = self.i;
        if self.s[self.i] == b'-' {
            self.i += 1;
        }
        match self.s.get(self.i) {
            Some(b'0') => self.i += 1,
            Some(b'1'..=b'9') => self.digits(),
            _ => return Err(ParseError),
        }
        if self.s.get(self.i) == Some(&b'.') {
            self.i += 1;
            if !matches!(self.s.get(self.i), Some(b'0'..=b'9')) {
                return Err(ParseError);
            }
            self.digits();
        }
        if let Some(b'e' | b'E') = self.s.get(self.i) {
            self.i += 1;
            if let Some(b'+' | b'-') = self.s.get(self.i) {
                self.i += 1;
            }
            if !matches!(self.s.get(self.i), Some(b'0'..=b'9')) {
                return Err(ParseError);
            }
            self.digits();
        }
        let text = std::str::from_utf8(&self.s[start..self.i]).map_err(|_| ParseError)?;
        text.parse::<f64>().map(Json::Num).map_err(|_| ParseError)
    }

    fn digits(&mut self) {
        while let Some(b'0'..=b'9') = self.s.get(self.i) {
            self.i += 1;
        }
    }

    fn string(&mut self) -> Result<JsStr, ParseError> {
        self.i += 1;
        let mut out = StrBuilder::default();
        let mut run = self.i;
        loop {
            let b = *self.s.get(self.i).ok_or(ParseError)?;
            match b {
                b'"' => {
                    out.push_bytes(&self.s[run..self.i]);
                    self.i += 1;
                    return Ok(out.finish());
                }
                b'\\' => {
                    out.push_bytes(&self.s[run..self.i]);
                    self.i += 1;
                    let e = *self.s.get(self.i).ok_or(ParseError)?;
                    self.i += 1;
                    match e {
                        b'"' => out.push_unit(0x22),
                        b'\\' => out.push_unit(0x5c),
                        b'/' => out.push_unit(0x2f),
                        b'b' => out.push_unit(0x08),
                        b'f' => out.push_unit(0x0c),
                        b'n' => out.push_unit(0x0a),
                        b'r' => out.push_unit(0x0d),
                        b't' => out.push_unit(0x09),
                        b'u' => {
                            let hex = self.s.get(self.i..self.i + 4).ok_or(ParseError)?;
                            let hex = std::str::from_utf8(hex).map_err(|_| ParseError)?;
                            if !hex.bytes().all(|h| h.is_ascii_hexdigit()) {
                                return Err(ParseError);
                            }
                            out.push_unit(u16::from_str_radix(hex, 16).map_err(|_| ParseError)?);
                            self.i += 4;
                        }
                        _ => return Err(ParseError),
                    }
                    run = self.i;
                }
                0..=0x1f => return Err(ParseError),
                _ => self.i += 1,
            }
        }
    }
}

/// Collects a string as UTF-8 until a lone surrogate forces UTF-16. A high surrogate escape waits in
/// `pending` for a possible low surrogate escape right after it.
#[derive(Default)]
struct StrBuilder {
    utf8: String,
    wide: Option<Vec<u16>>,
    pending: Option<u16>,
}

impl StrBuilder {
    fn push_bytes(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.flush_pending();
        let text = String::from_utf8_lossy(bytes);
        match &mut self.wide {
            Some(w) => w.extend(text.encode_utf16()),
            None => self.utf8.push_str(&text),
        }
    }

    fn push_unit(&mut self, u: u16) {
        if let Some(high) = self.pending.take() {
            if (0xdc00..=0xdfff).contains(&u) {
                let c = 0x10000 + (((high as u32) - 0xd800) << 10) + (u as u32 - 0xdc00);
                self.push_char(char::from_u32(c).expect("a surrogate pair is a valid code point"));
                return;
            }
            self.push_lone(high);
        }
        match u {
            0xd800..=0xdbff => self.pending = Some(u),
            0xdc00..=0xdfff => self.push_lone(u),
            _ => self.push_char(char::from_u32(u as u32).expect("a non-surrogate unit is a char")),
        }
    }

    fn push_char(&mut self, c: char) {
        match &mut self.wide {
            Some(w) => {
                let mut buf = [0u16; 2];
                w.extend_from_slice(c.encode_utf16(&mut buf));
            }
            None => self.utf8.push(c),
        }
    }

    fn push_lone(&mut self, u: u16) {
        let wide = self
            .wide
            .get_or_insert_with(|| self.utf8.encode_utf16().collect());
        wide.push(u);
    }

    fn flush_pending(&mut self) {
        if let Some(high) = self.pending.take() {
            self.push_lone(high);
        }
    }

    fn finish(mut self) -> JsStr {
        self.flush_pending();
        match self.wide {
            Some(w) => JsStr::Wide(w),
            None => JsStr::Utf8(self.utf8),
        }
    }
}

/// One JSON line, `JSON.stringify(value) + "\n"`.
pub fn to_line<T: Serialize + ?Sized>(value: &T) -> Vec<u8> {
    let mut out = serde_json::to_vec(value).expect("protocol values always serialize");
    out.push(b'\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(line: &str) -> String {
        serde_json::to_string(&parse(line.as_bytes()).unwrap()).unwrap()
    }

    #[test]
    fn lone_surrogates_survive_a_round_trip() {
        assert_eq!(roundtrip(r#"["\ud83d"]"#), r#"["\ud83d"]"#);
        assert_eq!(roundtrip(r#"["a\udc00b"]"#), r#"["a\udc00b"]"#);
        assert_eq!(roundtrip(r#"["\ud83d\ude42"]"#), "[\"\u{1F642}\"]");
        assert_eq!(roundtrip(r#"["\ud83d\ud83d"]"#), r#"["\ud83d\ud83d"]"#);
        assert_eq!(roundtrip(r#"["\ud83dx"]"#), r#"["\ud83dx"]"#);
        let s = parse(br#""x\ud800""#).unwrap();
        assert_eq!(s.as_js_str().unwrap().units().as_ref(), &[0x78, 0xd800]);
    }

    #[test]
    fn rejects_what_json_parse_rejects() {
        for bad in [
            "",
            "{",
            "[1,]",
            "{\"a\":1,}",
            "01",
            "1.",
            ".5",
            "+1",
            "\"\t\"",
            "'a'",
            "nul",
            "[1] x",
            "{\"a\" 1}",
            "\"\\x\"",
            "\"\\u12g4\"",
            "\u{feff}{}",
        ] {
            assert!(parse(bad.as_bytes()).is_err(), "{bad:?} must not parse");
        }
        let deep = "[".repeat(MAX_DEPTH + 1) + &"]".repeat(MAX_DEPTH + 1);
        assert!(parse(deep.as_bytes()).is_err());
        let ok = "[".repeat(MAX_DEPTH) + &"]".repeat(MAX_DEPTH);
        assert!(parse(ok.as_bytes()).is_ok());
    }

    #[test]
    fn invalid_utf8_in_a_string_reads_as_replacement() {
        let v = parse(b"\"a\xffb\"").unwrap();
        assert_eq!(v.as_str(), Some("a\u{fffd}b"));
    }

    #[test]
    fn objects_keep_first_position_and_list_index_keys_first() {
        assert_eq!(roundtrip(r#"{"a":1,"b":2,"a":3}"#), r#"{"a":3,"b":2}"#);
        assert_eq!(
            roundtrip(r#"{"b":1,"2":2,"a":3,"01":4,"4294967294":5,"4294967295":6}"#),
            r#"{"2":2,"4294967294":5,"b":1,"a":3,"01":4,"4294967295":6}"#
        );
    }

    #[test]
    fn numbers_print_like_javascript() {
        let cases = [
            (1e21, "1e+21"),
            (1e-7, "1e-7"),
            (123456789012345680000.0, "123456789012345680000"),
            (2f64.powi(60), "1152921504606847000"),
            (0.1 + 0.2, "0.30000000000000004"),
            (-0.0, "0"),
            (1.5e-6, "0.0000015"),
            (5e-324, "5e-324"),
            (1e300, "1e+300"),
            (-12.5, "-12.5"),
            (100.0, "100"),
        ];
        for (v, want) in cases {
            assert_eq!(js_number_to_string(v), want);
        }
        assert_eq!(roundtrip("[1e400,-0,3.0,2.5]"), "[null,0,3,2.5]");
    }

    #[test]
    fn coercions_follow_javascript() {
        let n = |s: &str| parse(s.as_bytes()).unwrap().to_js_number();
        assert_eq!(n(r#"" 12 ""#), 12.0);
        assert_eq!(n(r#""0x1f""#), 31.0);
        assert_eq!(n("[7]"), 7.0);
        assert_eq!(n("[]"), 0.0);
        assert_eq!(n("null"), 0.0);
        assert_eq!(n("true"), 1.0);
        assert!(n(r#""inf""#).is_nan());
        assert!(n(r#""1,2""#).is_nan());
        assert!(n("[1,2]").is_nan());
        assert!(n("{}").is_nan());
        assert_eq!(n(r#""-Infinity""#), f64::NEG_INFINITY);
        assert_eq!(n(r#""1e3""#), 1000.0);
        let s = |s: &str| parse(s.as_bytes()).unwrap().to_js_string();
        assert_eq!(s("[1,[2,null],\"x\"]"), JsStr::from("1,2,,x"));
        assert_eq!(s("12.50"), JsStr::from("12.5"));
        assert_eq!(s("{}"), JsStr::from("[object Object]"));
    }

    #[test]
    fn truncation_counts_units_and_may_split_a_pair() {
        let s = JsStr::from("ab\u{1F642}");
        assert_eq!(s.len_units(), 4);
        assert_eq!(s.truncate_units(3).units().as_ref(), &[0x61, 0x62, 0xd83d]);
        assert!(matches!(s.truncate_units(3), JsStr::Wide(_)));
        assert_eq!(s.truncate_units(3).to_utf8_lossy(), "ab\u{fffd}");
    }

    #[test]
    fn strings_escape_like_json_stringify() {
        let mut out = String::new();
        write_js_string(
            &"a\"\\\u{8}\u{c}\n\r\t\u{1}\u{7f}\u{2028}/"
                .encode_utf16()
                .collect::<Vec<_>>(),
            &mut out,
        );
        assert_eq!(out, "\"a\\\"\\\\\\b\\f\\n\\r\\t\\u0001\u{7f}\u{2028}/\"");
        let units: Vec<u16> = "\u{1}".encode_utf16().collect();
        assert_eq!(
            serde_json::to_string(&Utf16Text(&units)).unwrap(),
            "\"\\u0001\""
        );
    }
}
