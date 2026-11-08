//! Operational transformation on UTF-16 text, a port of `lib/ot.js` that produces the same operations.

mod diff;
mod operation;

pub use diff::diff;
pub use operation::{Component, OtError, TextOperation};
