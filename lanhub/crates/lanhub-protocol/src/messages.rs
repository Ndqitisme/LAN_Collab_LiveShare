//! Every protocol 2 message of docs/protocol.md, as serde enums tagged by `t`. Field order follows the Node
//! hub so a captured line reads the same from either hub.

use std::collections::BTreeMap;

use lanhub_ot::{Component, TextOperation};
use serde::ser::SerializeSeq;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

use crate::activity::Activity;
use crate::errors::{ChatRejectCode, HubError};
use crate::json::{JsNumber, JsStr, Json};

/// An operation in its JSON form (docs/protocol.md section 2): retain `n > 0`, insert a string, delete `-n`.
#[derive(Debug, Clone, PartialEq, Eq, TS)]
#[ts(type = "Array<number | string>")]
pub struct WireOp(pub TextOperation);

impl Serialize for WireOp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let ops = self.0.ops();
        let mut seq = serializer.serialize_seq(Some(ops.len()))?;
        for c in ops {
            match c {
                Component::Retain(n) => seq.serialize_element(n)?,
                Component::Delete(n) => seq.serialize_element(&-(*n as i64))?,
                Component::Insert(s) => seq.serialize_element(&crate::json::Utf16Text(s))?,
            }
        }
        seq.end()
    }
}

impl<'de> Deserialize<'de> for WireOp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        TextOperation::deserialize(deserializer).map(WireOp)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum FileKind {
    Text,
    Blob,
}

/// Where an op came from (section 5.1). Unknown values count as `editor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum OpSource {
    Editor,
    Disk,
    Revert,
    Merge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum IgnoredReason {
    #[serde(rename = "invalid")]
    Invalid,
    #[serde(rename = "excluded")]
    Excluded,
    #[serde(rename = "write-failed")]
    WriteFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Account {
    pub provider: JsStr,
    pub label: JsStr,
}

/// `hello` (section 3.1).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Hello {
    pub proto: u32,
    pub project: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub uid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<Option<String>>")]
    pub device: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<Option<Account>>")]
    pub account: Option<Account>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub probe: Option<bool>,
}

/// `presence.p` as a client sends it (section 8).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PresenceUpdate {
    pub file: Option<String>,
    pub sel: Vec<[u64; 2]>,
    pub line: u64,
    pub debug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rtt: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatImageUpload {
    pub mime: String,
    pub b64: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub w: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub h: Option<u32>,
}

/// Messages a member sends (section 5), plus `hello`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export, export_to = "Message.ts")]
pub enum ClientMessage {
    Hello(Hello),
    Get {
        path: String,
    },
    Op {
        path: String,
        rev: u64,
        op: WireOp,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        seq: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        src: Option<OpSource>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        reverts: Option<String>,
    },
    Create {
        path: String,
        kind: FileKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        b64: Option<String>,
    },
    Put {
        path: String,
        b64: String,
    },
    Delete {
        path: String,
    },
    Check {
        path: String,
        rev: u64,
        hash: String,
    },
    Presence {
        p: PresenceUpdate,
    },
    Status {
        text: String,
    },
    Chat {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        image: Option<ChatImageUpload>,
    },
    Media {
        id: String,
    },
    Ping {},
}

/// One entry of `welcome.files`. Blobs have `rev` 0.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileInfo {
    pub kind: FileKind,
    pub rev: u64,
    pub hash: String,
}

/// A member's presence as the hub stores and relays it (section 8).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct Presence {
    pub file: Option<JsStr>,
    #[ts(as = "Vec<[f64; 2]>")]
    pub sel: Vec<Json>,
    pub line: JsNumber,
    pub debug: Option<JsStr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rtt: Option<JsNumber>,
}

/// User record (section 6.2).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct User {
    pub id: String,
    pub name: JsStr,
    pub color: String,
    pub account: Option<Account>,
    pub presence: Option<Presence>,
    pub status: JsStr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatImage {
    pub id: String,
    pub mime: String,
    pub size: u64,
    pub w: u32,
    pub h: u32,
}

/// A chat message (section 5.3).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct ChatMessage {
    pub id: String,
    pub ts: u64,
    pub from: JsStr,
    #[serde(rename = "fromId")]
    pub from_id: String,
    #[serde(rename = "fromKey")]
    pub from_key: String,
    pub color: String,
    pub account: Option<Account>,
    pub text: JsStr,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<ChatImage>,
}

/// `welcome` (section 6.1).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct Welcome {
    pub id: String,
    pub color: String,
    #[serde(rename = "hubId")]
    pub hub_id: String,
    pub session: String,
    pub project: String,
    pub files: BTreeMap<String, FileInfo>,
    #[ts(as = "BTreeMap<String, f64>")]
    pub applied: BTreeMap<String, Json>,
    pub users: Vec<User>,
    pub activity: Vec<Activity>,
    pub features: Vec<String>,
    pub key: String,
    pub exclude: Vec<String>,
    /// Kept as parsed JSON, so history written by another hub is sent back unchanged.
    #[ts(as = "Vec<ChatMessage>")]
    pub chat: Vec<Json>,
    pub proto: u32,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "hubName")]
    pub hub_name: String,
    #[serde(rename = "hubVersion")]
    pub hub_version: String,
}

/// `probe_result` (section 3.4). A step not checked because an earlier one failed is `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ProbeResult {
    pub proto_ok: bool,
    pub project_ok: Option<bool>,
    pub token_ok: Option<bool>,
    pub account_ok: Option<bool>,
    pub projects: Vec<String>,
    #[serde(rename = "hubId")]
    pub hub_id: Option<String>,
    #[serde(rename = "hubName")]
    pub hub_name: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "hubMin")]
    pub hub_min: u32,
    #[serde(rename = "hubMax")]
    pub hub_max: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub account_error: Option<HubError>,
}

/// The body of a `file` message after `path`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum FileBody {
    Content(FileContent),
    Missing { missing: bool },
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export)]
pub enum FileContent {
    Text { rev: u64, text: JsStr },
    Blob { hash: String, b64: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct FileMessage {
    pub path: String,
    #[serde(flatten)]
    pub body: FileBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ChatRejectData {
    #[serde(rename = "maxBytes")]
    pub max_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum MediaReply {
    Found {
        id: String,
        mime: String,
        b64: String,
    },
    Missing {
        id: String,
        missing: bool,
    },
}

/// Messages the hub sends (section 6).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export, export_to = "Message.ts")]
pub enum HubMessage {
    Welcome(Welcome),
    ProbeResult(ProbeResult),
    Error(HubError),
    File(FileMessage),
    Op {
        path: String,
        rev: u64,
        op: WireOp,
        by: String,
    },
    Ack {
        path: String,
        rev: u64,
    },
    /// `path` is echoed as the client sent it, whatever its JSON type.
    Nack {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<String>")]
        path: Option<Json>,
    },
    Resync {
        path: String,
    },
    Stored {
        path: String,
        hash: String,
    },
    Ignored {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<String>")]
        path: Option<Json>,
        reason: IgnoredReason,
    },
    Deleted {
        path: String,
        by: String,
    },
    Joined {
        user: User,
    },
    Left {
        id: String,
    },
    Presence {
        id: String,
        p: Presence,
    },
    Status {
        id: String,
        text: JsStr,
    },
    Activity {
        a: Activity,
    },
    Chat {
        #[ts(as = "ChatMessage")]
        msg: Json,
    },
    ChatRejected {
        code: ChatRejectCode,
        data: ChatRejectData,
    },
    Media(MediaReply),
    Pong {
        ts: u64,
    },
    Rejected {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<BTreeMap<String, Json>>")]
        data: Option<Json>,
    },
}

/// Any protocol 2 message, in either direction.
#[derive(TS)]
#[ts(export, export_to = "Message.ts", untagged)]
pub enum Message {
    Client(ClientMessage),
    Hub(HubMessage),
}
