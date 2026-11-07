//! Strings the Rust side shows (tray menu and tooltip), read from the UI's `vi.json` so every visible string
//! has one source.

use std::sync::OnceLock;

use serde_json::Value;

static STRINGS: OnceLock<Value> = OnceLock::new();

fn strings() -> &'static Value {
    STRINGS.get_or_init(|| {
        serde_json::from_str(include_str!("../../ui/src/i18n/vi.json")).expect("vi.json parses")
    })
}

/// The string at the dotted `key` with each `{name}` replaced; the key itself when it is missing.
pub fn t(key: &str, params: &[(&str, &str)]) -> String {
    let pointer = format!("/{}", key.replace('.', "/"));
    let mut s = strings()
        .pointer(&pointer)
        .and_then(Value::as_str)
        .unwrap_or(key)
        .to_owned();
    for (k, v) in params {
        s = s.replace(&format!("{{{k}}}"), v);
    }
    s
}
