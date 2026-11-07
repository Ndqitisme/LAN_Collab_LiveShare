//! NDJSON framing as `LineSocket` in `lib/common.js` does it: lines split on LF, empty lines skipped, and
//! the length limit checked only on the unfinished line left at the end of a chunk, counted in UTF-16 units.

/// Longest line before the hello is accepted.
pub const PREAUTH_MAX_LINE: usize = 64 * 1024;
/// `MAX_LINE` in `lib/common.js`: the longest message after the hello, in UTF-16 units.
pub const MAX_LINE: usize = 400 * 1024 * 1024;

/// State after a chunk, once its complete lines were taken out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tail {
    /// The chunk ended on a line boundary.
    Empty,
    /// Part of a line is still arriving (the hub may send a keep-alive `pong`).
    Partial,
    /// The unfinished line is longer than the limit: the connection must close.
    Overflow,
}

/// Counts the UTF-16 units Node's streaming UTF-8 decoder (`sock.setEncoding('utf8')`) produces: two for a
/// code point outside the BMP, one for any other, and one U+FFFD for each invalid byte or cut-off sequence
/// (the WHATWG decoder). A sequence split across chunks counts once it completes.
#[derive(Debug, Default, Clone, Copy)]
pub struct Utf16Counter {
    need: u8,
    seen: u8,
    lower: u8,
    upper: u8,
}

impl Utf16Counter {
    pub fn feed(&mut self, b: u8) -> usize {
        if self.need == 0 {
            let (need, lower, upper) = match b {
                0x00..=0x7f => return 1,
                0xc2..=0xdf => (1, 0x80, 0xbf),
                0xe0 => (2, 0xa0, 0xbf),
                0xed => (2, 0x80, 0x9f),
                0xe1..=0xef => (2, 0x80, 0xbf),
                0xf0 => (3, 0x90, 0xbf),
                0xf4 => (3, 0x80, 0x8f),
                0xf1..=0xf3 => (3, 0x80, 0xbf),
                _ => return 1,
            };
            *self = Utf16Counter {
                need,
                seen: 0,
                lower,
                upper,
            };
            return 0;
        }
        if b < self.lower || b > self.upper {
            *self = Utf16Counter::default();
            return 1 + self.feed(b);
        }
        self.seen += 1;
        self.lower = 0x80;
        self.upper = 0xbf;
        if self.seen < self.need {
            return 0;
        }
        let units = if self.need == 3 { 2 } else { 1 };
        *self = Utf16Counter::default();
        units
    }
}

/// UTF-16 units of a complete UTF-8 byte string.
pub fn utf16_units(bytes: &[u8]) -> usize {
    let mut c = Utf16Counter::default();
    let n: usize = bytes.iter().map(|b| c.feed(*b)).sum();
    n + usize::from(c.need > 0)
}

#[derive(Debug)]
pub struct LineDecoder {
    partial: Vec<u8>,
    pending_units: usize,
    counter: Utf16Counter,
    /// May be raised between `push` and `tail`, as the Node hub raises it while handling the hello.
    pub limit: usize,
}

impl LineDecoder {
    pub fn new(limit: usize) -> LineDecoder {
        LineDecoder {
            partial: Vec::new(),
            pending_units: 0,
            counter: Utf16Counter::default(),
            limit,
        }
    }

    /// Takes the complete, non-empty lines out of `chunk` (without their LF).
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        let mut lines = Vec::new();
        let mut start = 0;
        while let Some(i) = chunk[start..].iter().position(|b| *b == b'\n') {
            let end = start + i;
            let line = if self.partial.is_empty() {
                chunk[start..end].to_vec()
            } else {
                let mut l = std::mem::take(&mut self.partial);
                l.extend_from_slice(&chunk[start..end]);
                l
            };
            self.pending_units = 0;
            self.counter = Utf16Counter::default();
            start = end + 1;
            if !line.is_empty() {
                lines.push(line);
            }
        }
        if start < chunk.len() {
            self.partial.extend_from_slice(&chunk[start..]);
            for b in &chunk[start..] {
                self.pending_units += self.counter.feed(*b);
            }
        }
        lines
    }

    /// The state of the unfinished line after the last `push`.
    pub fn tail(&self) -> Tail {
        if self.partial.is_empty() {
            Tail::Empty
        } else if self.pending_units > self.limit {
            Tail::Overflow
        } else {
            Tail::Partial
        }
    }
}
