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

/// UTF-16 units of UTF-8 bytes: one per code point, two for one outside the BMP.
pub fn utf16_units(bytes: &[u8]) -> usize {
    bytes
        .iter()
        .map(|b| match b {
            0x80..=0xbf => 0,
            0xf0..=0xf7 => 2,
            _ => 1,
        })
        .sum()
}

#[derive(Debug)]
pub struct LineDecoder {
    partial: Vec<u8>,
    pending_units: usize,
    /// May be raised between `push` and `tail`, as the Node hub raises it while handling the hello.
    pub limit: usize,
}

impl LineDecoder {
    pub fn new(limit: usize) -> LineDecoder {
        LineDecoder {
            partial: Vec::new(),
            pending_units: 0,
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
            start = end + 1;
            if !line.is_empty() {
                lines.push(line);
            }
        }
        if start < chunk.len() {
            self.partial.extend_from_slice(&chunk[start..]);
            self.pending_units += utf16_units(&chunk[start..]);
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
