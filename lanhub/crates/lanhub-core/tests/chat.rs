//! Chat history loading, text normalization and the chat key, against what `hub/hub.js` does.

use lanhub_core::chat::{self, CHAT_KEEP};
use lanhub_protocol::json::{JsStr, Json};

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "lanhub-chat-{name}-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("chat.jsonl")
}

fn texts(chat: &std::collections::VecDeque<Json>) -> Vec<String> {
    chat.iter()
        .map(|m| m.get("text").and_then(Json::as_str).unwrap().to_owned())
        .collect()
}

#[test]
fn chat_load_skips_a_torn_last_line_and_junk() {
    let file = scratch("torn");
    std::fs::write(
        &file,
        "{\"text\":\"a\"}\n\nnot json\r\n{\"text\":\"b\"}\r\n{\"text\":\"c\"}\n{\"id\":\"x\",\"te",
    )
    .unwrap();
    assert_eq!(texts(&chat::load(&file)), ["a", "b", "c"]);
}

#[test]
fn chat_load_keeps_the_last_lines_like_slice_minus_501() {
    let file = scratch("long");
    let body: String = (0..600)
        .map(|i| format!("{{\"text\":\"{i}\"}}\n"))
        .collect();
    std::fs::write(&file, &body).unwrap();
    let chat = chat::load(&file);
    // The trailing newline leaves an empty last segment, so 500 messages remain.
    assert_eq!(chat.len(), CHAT_KEEP);
    assert_eq!(texts(&chat)[0], "100");
    std::fs::write(&file, body.trim_end()).unwrap();
    let chat = chat::load(&file);
    assert_eq!(chat.len(), CHAT_KEEP + 1);
    assert_eq!(texts(&chat)[0], "99");
}

#[test]
fn chat_load_without_a_file_is_empty() {
    assert!(chat::load(&scratch("none")).is_empty());
}

#[test]
fn chat_text_is_trimmed_and_cut_to_4000_units() {
    let s = |v: &str| Json::Str(v.into());
    assert_eq!(
        chat::text(Some(&s("\u{feff}\u{3000} hi \n\t"))),
        JsStr::from("hi")
    );
    assert_eq!(chat::text(Some(&Json::Num(42.0))), JsStr::from(""));
    assert_eq!(chat::text(None), JsStr::from(""));
    let long = format!("  {}  ", "x".repeat(5000));
    assert_eq!(chat::text(Some(&s(&long))).len_units(), 4000);
    // slice(0, 4000) may cut a surrogate pair, leaving a lone high surrogate.
    let cut = chat::text(Some(&s(&format!("{}😀", "a".repeat(3999)))));
    assert_eq!(cut.len_units(), 4000);
    assert_eq!(cut.units()[3999], 0xd83d);
}

#[test]
fn chat_key_matches_lib_common_sha1() {
    // C.sha1(`chat:${seed}`).slice(0, 16) in Node.
    assert_eq!(chat::chat_key(&JsStr::from("dev-1")), "562e52e556162683");
    assert_eq!(chat::chat_key(&JsStr::from("máy-Ω")), "6a279431febae9f2");
    assert_eq!(
        chat::chat_key(&JsStr::from_units(&[0xd83d])),
        "278c91c3635a0fa6"
    );
}

#[test]
fn chat_image_checks_follow_save_image() {
    let img = |mime: Json, b64: &str| {
        Json::Obj(vec![
            ("mime".into(), mime),
            ("b64".into(), Json::Str(b64.into())),
            ("w".into(), Json::Num(800.0)),
            ("h".into(), Json::Num(100_000.0)),
        ])
    };
    let png = Json::Str("image/png".into());
    let ok = chat::check_image(&img(png.clone(), "AAEC")).unwrap();
    assert_eq!(ok.bytes, [0, 1, 2]);
    assert_eq!(ok.ext, "png");
    assert_eq!(
        serde_json::to_string(&ok.meta).unwrap(),
        format!(
            r#"{{"id":"{}","mime":"image/png","size":3,"w":800,"h":0}}"#,
            ok.id
        )
    );
    assert!(chat::check_image(&img(Json::Str("text/html".into()), "AAEC")).is_none());
    assert!(chat::check_image(&img(png.clone(), "")).is_none());
    assert!(chat::check_image(&img(png.clone(), "====")).is_none());
    let too_big = "A".repeat(4 * 1024 * 1024 / 3 * 4 + 8);
    assert!(chat::check_image(&img(png, &too_big)).is_none());
    // String(["image/png"]) is "image/png", so the Node lookup accepts it.
    assert!(
        chat::check_image(&img(Json::Arr(vec![Json::Str("image/png".into())]), "AA==")).is_some()
    );
}
