//! Wire types of LAN Collab protocol 2 (docs/protocol.md). `cargo test -p lanhub-protocol` also writes
//! their TypeScript form to `packages/protocol/src/generated/`.

pub mod activity;
pub mod errors;
pub mod json;
pub mod messages;

pub use activity::{Activity, ActivityKind};
pub use errors::{ChatRejectCode, ErrorCode, HubError, LEGACY_PROTOCOL_LINE};
pub use json::{JsNumber, JsStr, Json};
pub use messages::*;

/// Protocol versions lanhub accepts.
pub const PROTO_MIN: u32 = 2;
pub const PROTO_MAX: u32 = 2;
