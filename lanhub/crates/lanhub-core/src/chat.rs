//! Chat as the former Node hub keeps it: the last messages in memory, every message appended to
//! `<history>/chat.jsonl`, and images stored once under `<history>/chat-media/<sha1>.<ext>`. Messages stay
//! parsed JSON, so history written by the Node hub is sent back unchanged.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use lanhub_protocol::json::{self, JsStr, Json};

use crate::util::{base64_decode_lenient, sha1_hex};

pub const CHAT_KEEP: usize = 500;
pub const WELCOME_CHAT: usize = 200;
pub const TEXT_MAX: usize = 4000;
pub const IMAGE_MAX: usize = 4 * 1024 * 1024;
const IMAGE_TYPES: [(&str, &str); 4] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
];

pub fn log_path(history: &Path) -> PathBuf {
    history.join("chat.jsonl")
}

pub fn media_path(history: &Path, id: &str, ext: &str) -> PathBuf {
    history.join("chat-media").join(format!("{id}.{ext}"))
}

/// The last messages of `chat.jsonl`, as the Node hub reads them: the last `CHAT_KEEP + 1` lines, skipping
/// empty lines and lines that do not parse (a torn last line after a crash). A missing file is no chat yet.
pub fn load(file: &Path) -> VecDeque<Json> {
    let Ok(bytes) = std::fs::read(file) else {
        return VecDeque::new();
    };
    let lines: Vec<&[u8]> = bytes.split(|b| *b == b'\n').collect();
    let skip = lines.len().saturating_sub(CHAT_KEEP + 1);
    lines[skip..]
        .iter()
        .filter(|l| !l.is_empty())
        .filter_map(|l| json::parse(l).ok())
        .collect()
}

/// `welcome.key`: marks one machine's own messages across reconnects, restarts and a hub swap without
/// revealing the device id. `seed` is `device || uid || randomUUID()`.
pub fn chat_key(seed: &JsStr) -> String {
    sha1_hex(format!("chat:{}", seed.to_utf8_lossy()).as_bytes())[..16].to_owned()
}

/// `chat.text`: a string is trimmed and cut to 4000 UTF-16 units; anything else is no text.
pub fn text(v: Option<&Json>) -> JsStr {
    match v {
        Some(Json::Str(s)) => s.trim().truncate_units(TEXT_MAX),
        _ => JsStr::from(""),
    }
}

/// `IMAGE_TYPES[mime]`: the lookup converts the key with `String()`, so `["image/png"]` matches too.
pub fn image_ext(mime: Option<&Json>) -> Option<&'static str> {
    let key = mime?.to_js_string();
    IMAGE_TYPES
        .iter()
        .find(|(m, _)| key == **m)
        .map(|(_, ext)| *ext)
}

/// An image that passed the checks, before it is written.
pub struct Image {
    pub bytes: Vec<u8>,
    pub id: String,
    pub ext: &'static str,
    /// `msg.image`: `{id, mime, size, w, h}`.
    pub meta: Json,
}

/// The checks of `saveImage` that need no disk: a known MIME type, a string `b64` no longer than 4 MiB
/// encodes to, and 1 byte to 4 MiB once decoded.
pub fn check_image(img: &Json) -> Option<Image> {
    let mime = img.get("mime")?;
    let ext = image_ext(Some(mime))?;
    let Some(Json::Str(b64)) = img.get("b64") else {
        return None;
    };
    if b64.len_units() > IMAGE_MAX.div_ceil(3) * 4 {
        return None;
    }
    let bytes = base64_decode_lenient(&b64.to_utf8_lossy());
    if bytes.is_empty() || bytes.len() > IMAGE_MAX {
        return None;
    }
    let id = sha1_hex(&bytes);
    let dim = |k: &str| {
        img.get(k)
            .filter(|v| v.as_js_integer().is_some_and(|n| n > 0.0 && n < 100_000.0))
            .cloned()
            .unwrap_or(Json::Num(0.0))
    };
    let meta = Json::Obj(vec![
        ("id".into(), Json::Str(id.clone().into())),
        ("mime".into(), mime.clone()),
        ("size".into(), Json::Num(bytes.len() as f64)),
        ("w".into(), dim("w")),
        ("h".into(), dim("h")),
    ]);
    Some(Image {
        bytes,
        id,
        ext,
        meta,
    })
}

pub fn is_media_id(id: &str) -> bool {
    id.len() == 40 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// A `null` line in `chat.jsonl`, on which the Node hub's lookup throws.
#[derive(Debug)]
pub struct NullLine;

/// `chat.find((x) => x.image && x.image.id === id).image`, oldest first.
pub fn find_image<'a>(chat: &'a VecDeque<Json>, id: &str) -> Result<Option<&'a Json>, NullLine> {
    for x in chat {
        if matches!(x, Json::Null) {
            return Err(NullLine);
        }
        let image = x.get("image").filter(|i| i.truthy());
        if image.and_then(|i| i.get("id")).and_then(Json::as_str) == Some(id) {
            return Ok(image);
        }
    }
    Ok(None)
}
