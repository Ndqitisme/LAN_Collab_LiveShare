use lanhub_core::framing::{LineDecoder, MAX_LINE, PREAUTH_MAX_LINE, Tail, utf16_units};
use lanhub_protocol::json;

#[test]
fn framing_joins_split_chunks() {
    let mut d = LineDecoder::new(PREAUTH_MAX_LINE);
    assert!(d.push(b"{\"t\":\"he").is_empty());
    assert_eq!(d.tail(), Tail::Partial);
    let lines = d.push(b"llo\"}\n{\"t\":\"ping\"}\n{\"t\"");
    assert_eq!(
        lines,
        vec![b"{\"t\":\"hello\"}".to_vec(), b"{\"t\":\"ping\"}".to_vec()]
    );
    assert_eq!(d.tail(), Tail::Partial);
    assert_eq!(d.push(b":\"x\"}\n"), vec![b"{\"t\":\"x\"}".to_vec()]);
    assert_eq!(d.tail(), Tail::Empty);
}

#[test]
fn framing_skips_empty_lines_and_keeps_malformed_ones_for_the_parser() {
    let mut d = LineDecoder::new(PREAUTH_MAX_LINE);
    let lines = d.push(b"\n\n{bad json\n\r\n{\"t\":\"ping\"}\r\n\n");
    assert_eq!(lines.len(), 3);
    assert!(json::parse(&lines[0]).is_err());
    assert!(
        json::parse(&lines[1]).is_err(),
        "a lone CR is not a JSON value"
    );
    assert_eq!(
        json::parse(&lines[2])
            .unwrap()
            .get("t")
            .and_then(|t| t.as_str()),
        Some("ping")
    );
}

#[test]
fn framing_closes_on_a_long_preauth_line() {
    let mut d = LineDecoder::new(PREAUTH_MAX_LINE);
    let chunk = vec![b'x'; 64 * 1024];
    assert!(d.push(&chunk).is_empty());
    assert_eq!(d.tail(), Tail::Partial, "exactly 64 KiB is still allowed");
    d.push(b"x");
    assert_eq!(d.tail(), Tail::Overflow);
}

#[test]
fn framing_limit_counts_utf16_units_and_can_be_raised_mid_chunk() {
    assert_eq!(utf16_units("aĐ🙂".as_bytes()), 4);
    let mut d = LineDecoder::new(4);
    d.push("🙂🙂".as_bytes());
    assert_eq!(d.tail(), Tail::Partial);
    d.push("a".as_bytes());
    assert_eq!(d.tail(), Tail::Overflow);

    // A complete line is never measured, only the unfinished tail of a chunk, as in LineSocket.
    let mut d = LineDecoder::new(4);
    let lines = d.push(b"{\"t\":\"hello\"}\nxxxxxx");
    assert_eq!(lines.len(), 1);
    d.limit = MAX_LINE;
    assert_eq!(d.tail(), Tail::Partial);
}

#[test]
fn framing_counts_invalid_utf8_like_nodes_decoder() {
    // Each stray byte decodes to one U+FFFD in Node, so it counts toward the limit.
    let mut d = LineDecoder::new(PREAUTH_MAX_LINE);
    d.push(&vec![0x80; 70_000]);
    assert_eq!(d.tail(), Tail::Overflow);
    // Values from Buffer.from(bytes).toString('utf8').length.
    assert_eq!(utf16_units(&[0x80; 10]), 10);
    assert_eq!(utf16_units(&[0xf0]), 1);
    assert_eq!(utf16_units(&[0xf0, 0x9f, 0x99]), 1);
    assert_eq!(utf16_units(&[0xf0, 0x9f, 0x99, 0x82]), 2);
    assert_eq!(utf16_units(&[0xe0, 0x80, 0x41]), 3);
    assert_eq!(utf16_units(&[0xed, 0xa0, 0x80]), 3);
    assert_eq!(utf16_units(&[0xc0, 0xaf, 0xff, 0x61]), 4);
    // A character split across two chunks counts once, when it completes.
    let mut d = LineDecoder::new(1);
    d.push(&[0xf0, 0x9f]);
    assert_eq!(d.tail(), Tail::Partial);
    d.push(&[0x99, 0x82]);
    assert_eq!(d.tail(), Tail::Overflow);
}
