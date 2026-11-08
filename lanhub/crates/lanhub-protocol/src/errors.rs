use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Codes of the connection-refusing `error` (docs/protocol.md section 4.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ErrorCode {
    ProtocolVersion,
    ProjectUnknown,
    TokenInvalid,
    AccountRequired,
    AccountDenied,
    TlsRequired,
}

/// `{code, data}` of an `error`, also the `account_error` of a `probe_result`. `data` is `{}` for the
/// codes that carry nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "code", content = "data", rename_all = "snake_case")]
#[ts(export)]
pub enum HubError {
    ProtocolVersion {
        #[serde(rename = "hubMin")]
        hub_min: u32,
        #[serde(rename = "hubMax")]
        hub_max: u32,
    },
    ProjectUnknown {
        projects: Vec<String>,
    },
    TokenInvalid {},
    AccountRequired {},
    AccountDenied {
        account: String,
        entry: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<String>,
    },
    TlsRequired {},
}

impl HubError {
    pub fn code(&self) -> ErrorCode {
        match self {
            HubError::ProtocolVersion { .. } => ErrorCode::ProtocolVersion,
            HubError::ProjectUnknown { .. } => ErrorCode::ProjectUnknown,
            HubError::TokenInvalid {} => ErrorCode::TokenInvalid,
            HubError::AccountRequired {} => ErrorCode::AccountRequired,
            HubError::AccountDenied { .. } => ErrorCode::AccountDenied,
            HubError::TlsRequired {} => ErrorCode::TlsRequired,
        }
    }
}

/// Code of a refused chat image (`chat_rejected`, section 5.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatRejectCode {
    ImageInvalid,
}

/// The one legacy line lanhub sends to a protocol 1 hello (section 14.2), byte for byte: a 0.1 client
/// reads only `message`.
pub const LEGACY_PROTOCOL_LINE: &str = "{\"t\":\"error\",\"code\":\"protocol_version\",\"data\":{\"hubMin\":2,\"hubMax\":2},\"message\":\"Phiên bản giao thức khác hub (máy: 1, hub: 2). Cập nhật extension LAN Collab lên 0.2.\"}";
