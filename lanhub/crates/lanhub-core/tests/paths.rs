//! Parity with `lib/common.js`: every case in `vectors/common.json` was computed by `safeRel`,
//! `makeExcluder` and `normalizeEol` (regenerate with `node lanhub/crates/lanhub-core/tests/vectors/gen.mjs`).

use lanhub_core::exclude::Excluder;
use lanhub_core::files::uniform_eol;
use lanhub_core::paths::safe_rel;
use lanhub_protocol::json::{self, Json};

fn vectors() -> Json {
    json::parse(include_bytes!("vectors/common.json")).expect("common.json is JSON")
}

fn items<'a>(v: &'a Json, key: &str) -> &'a [Json] {
    match v.get(key) {
        Some(Json::Arr(items)) => items,
        _ => panic!("{key} is an array"),
    }
}

#[test]
fn safe_rel_paths_match_lib_common() {
    let v = vectors();
    let cases = items(&v, "paths");
    assert!(cases.len() > 80);
    for case in cases {
        let p = case.get("p").and_then(Json::as_str).unwrap();
        let want = case.get("rel").and_then(Json::as_str);
        assert_eq!(safe_rel(p).as_deref(), want, "safeRel({p:?})");
    }
}

#[test]
fn exclude_paths_match_lib_common() {
    let v = vectors();
    for group in items(&v, "exclude") {
        let patterns: Vec<&str> = items(group, "patterns")
            .iter()
            .map(|p| p.as_str().unwrap())
            .collect();
        let ex = Excluder::new(&patterns);
        for r in items(group, "results") {
            let rel = r.get("rel").and_then(Json::as_str).unwrap();
            let want = matches!(r.get("excluded"), Some(Json::Bool(true)));
            assert_eq!(ex.is_excluded(rel), want, "{rel:?} with {patterns:?}");
        }
    }
}

#[test]
fn eol_matches_lib_common() {
    let v = vectors();
    for case in items(&v, "eol") {
        let text: Vec<u16> = case
            .get("text")
            .unwrap()
            .as_js_str()
            .unwrap()
            .units()
            .into_owned();
        let want: Vec<u16> = case
            .get("out")
            .unwrap()
            .as_js_str()
            .unwrap()
            .units()
            .into_owned();
        assert_eq!(
            uniform_eol(&text),
            want,
            "{:?}",
            String::from_utf16_lossy(&text)
        );
    }
}
