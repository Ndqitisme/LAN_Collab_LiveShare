use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::json::JsStr;

/// What a member did (docs/protocol.md section 7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ActivityKind {
    Join,
    Leave,
    Edit,
    EditDisk,
    Create,
    Delete,
    DebugStart,
    DebugStop,
    StatusSet,
    StatusClear,
}

impl ActivityKind {
    /// The 0.1 sentence for the hub log (docs/protocol.md section 15).
    pub fn sentence(self, a: &Activity) -> String {
        let path = a.path.as_deref().unwrap_or("");
        let text = a
            .text
            .as_ref()
            .map(|t| t.to_utf8_lossy().into_owned())
            .unwrap_or_default();
        match self {
            ActivityKind::Join => format!("vào phòng ({})", a.addr.as_deref().unwrap_or("")),
            ActivityKind::Leave => "rời phòng".into(),
            ActivityKind::Edit => format!("đang sửa {path}"),
            ActivityKind::EditDisk => format!("đang sửa {path} (AI/công cụ ngoài editor)"),
            ActivityKind::Create => format!("tạo {path}"),
            ActivityKind::Delete => format!("xoá {path}"),
            ActivityKind::DebugStart => format!("bắt đầu debug {text}"),
            ActivityKind::DebugStop => "dừng debug".into(),
            ActivityKind::StatusSet => format!("đặt trạng thái: {text}"),
            ActivityKind::StatusClear => "xoá trạng thái".into(),
        }
    }
}

/// One activity record `{ts, who, color, kind, path?, text?, addr?}`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct Activity {
    pub ts: u64,
    #[ts(type = "string")]
    pub who: JsStr,
    pub color: String,
    pub kind: ActivityKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string")]
    pub text: Option<JsStr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub addr: Option<String>,
}
