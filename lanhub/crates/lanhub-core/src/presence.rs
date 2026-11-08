//! Normalizing `presence.p` (docs/protocol.md section 8), as the Node hub's presence handler does.

use lanhub_protocol::{JsNumber, JsStr, Json, Presence};

const MAX_SELECTIONS: usize = 20;

pub fn normalize(p: Option<&Json>) -> Presence {
    let p = p.filter(|v| v.is_js_object());
    let field = |k: &str| p.and_then(|v| v.get(k));
    let string = |k: &str| field(k).and_then(Json::as_js_str).cloned();
    let sel = match field("sel") {
        Some(Json::Arr(items)) => items.iter().take(MAX_SELECTIONS).cloned().collect(),
        _ => Vec::new(),
    };
    // `Number(p.line) || 0`: NaN, 0 and -0 all become 0.
    let line = field("line")
        .map(Json::to_js_number)
        .filter(|n| *n != 0.0 && !n.is_nan())
        .unwrap_or(0.0);
    let rtt = match field("rtt") {
        Some(Json::Num(n)) if n.is_finite() && *n >= 0.0 => Some(JsNumber(n.round())),
        _ => None,
    };
    Presence {
        file: string("file"),
        sel,
        line: JsNumber(line),
        debug: string("debug"),
        rtt,
    }
}

/// What a presence change means for the activity feed: `Some(Some(target))` is `debug_start`, `Some(None)`
/// is `debug_stop`, `None` is no record. Mirrors `(before || null) !== debug`, so an empty `debug` after an
/// empty one still logs a stop, as the Node hub does.
pub fn debug_change(before: Option<&Presence>, after: &Presence) -> Option<Option<JsStr>> {
    let before = before
        .and_then(|p| p.debug.clone())
        .filter(|d| !d.is_empty());
    if before == after.debug {
        return None;
    }
    Some(after.debug.clone().filter(|d| !d.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lanhub_protocol::json::parse;

    fn p(s: &str) -> Presence {
        normalize(Some(&parse(s.as_bytes()).unwrap()))
    }

    #[test]
    fn normalizes_like_the_node_hub() {
        let n = p(r#"{"file":"a.txt","sel":[[1,2]],"line":"7","debug":null,"rtt":12.5}"#);
        assert_eq!(n.file, Some(JsStr::from("a.txt")));
        assert_eq!(n.line, JsNumber(7.0));
        assert_eq!(n.rtt, Some(JsNumber(13.0)));
        let n = p(r#"{"line":{},"rtt":-1,"file":3,"sel":"x"}"#);
        assert_eq!(
            (n.file, n.line, n.rtt, n.sel.len()),
            (None, JsNumber(0.0), None, 0)
        );
        let sel: String = format!("[{}]", vec!["[0,0]"; 30].join(","));
        assert_eq!(p(&format!(r#"{{"sel":{sel}}}"#)).sel.len(), 20);
        assert_eq!(normalize(Some(&Json::Arr(vec![]))).line, JsNumber(0.0));
    }

    #[test]
    fn debug_changes() {
        let start = p(r#"{"debug":"main.py"}"#);
        let empty = p(r#"{"debug":""}"#);
        let none = p("{}");
        assert_eq!(
            debug_change(None, &start),
            Some(Some(JsStr::from("main.py")))
        );
        assert_eq!(debug_change(Some(&start), &start), None);
        assert_eq!(debug_change(Some(&start), &none), Some(None));
        assert_eq!(debug_change(Some(&none), &none), None);
        assert_eq!(debug_change(Some(&empty), &empty), Some(None));
    }
}
