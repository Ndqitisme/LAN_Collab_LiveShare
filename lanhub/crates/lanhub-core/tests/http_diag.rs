//! The HTTP diagnosis page: an HTTP request on the hub port gets one fixed page with the hub name, version
//! and advertised projects, and never a token, a folder or a member.

use std::path::PathBuf;
use std::time::Duration;

use lanhub_core::Hub;
use lanhub_core::config::{Config, HubSettings, ProjectConfig};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "lanhub-http-{tag}-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

const TOKEN: &str = "s3cret-token-0042";
const UID: &str = "uid-member-7781";

async fn hub() -> (Hub, PathBuf) {
    let shown = tmp("shown");
    let hidden = tmp("hidden");
    let mut a = ProjectConfig::new("Shown <b>", &shown);
    a.token = TOKEN.to_owned();
    let mut b = ProjectConfig::new("HiddenProject", &hidden);
    b.advertise = false;
    let config = Config {
        hub: HubSettings {
            name: Some("Phòng dev".into()),
            bind: "127.0.0.1".into(),
            port: 0,
            discovery: false,
            ..HubSettings::default()
        },
        projects: vec![a, b],
    };
    let (hub, _) = Hub::start(config, "inst-1".into()).await.unwrap();
    (hub, shown)
}

/// Sends `request` and returns everything the hub writes before it closes.
async fn fetch(port: u16, request: &[u8]) -> String {
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    s.write_all(request).await.unwrap();
    let mut out = Vec::new();
    timeout(Duration::from_secs(5), s.read_to_end(&mut out))
        .await
        .expect("the hub closes after the page")
        .unwrap();
    String::from_utf8(out).unwrap()
}

#[tokio::test]
async fn http_diag_page_shows_hub_facts_and_no_secret() {
    let (hub, root) = hub().await;
    let port = hub.port();
    // A member is connected, so its uid exists on the hub.
    let mut member = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    member
        .write_all(
            format!(
                "{{\"t\":\"hello\",\"proto\":2,\"project\":\"Shown <b>\",\"token\":\"{TOKEN}\",\"name\":\"Alice\",\"uid\":\"{UID}\"}}\n"
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut lines = BufReader::new(&mut member).lines();
    let welcome = timeout(Duration::from_secs(5), lines.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(welcome.contains("\"t\":\"welcome\""), "{welcome}");
    assert!(welcome.contains("\"http-diag\""), "{welcome}");

    let page = fetch(port, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await;
    let (head, body) = page.split_once("\r\n\r\n").unwrap();
    assert!(head.starts_with("HTTP/1.1 200 OK\r\n"), "{head}");
    assert!(head.contains("Content-Type: text/html; charset=utf-8"));
    assert!(head.contains(&format!("Content-Length: {}", body.len())));
    assert!(body.contains("LAN Hub đang chạy"));
    assert!(body.contains("Phòng dev"));
    assert!(body.contains(lanhub_core::HUB_VERSION));
    assert!(
        body.contains("<li>Shown &lt;b&gt;</li>"),
        "names are escaped"
    );
    assert!(!body.contains("HiddenProject"), "only advertised projects");
    for secret in [TOKEN, UID, "Alice", &root.display().to_string(), "inst-1"] {
        assert!(!page.contains(secret), "the page leaks {secret}");
    }

    // Any path gets the same page and no file is read.
    let other = fetch(port, b"GET /../../etc/passwd HTTP/1.1\r\n\r\n").await;
    // The uptime row may tick between the two requests.
    let no_uptime = |b: &str| {
        b.lines()
            .filter(|l| !l.contains("Thời gian chạy"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert_eq!(
        no_uptime(other.split_once("\r\n\r\n").unwrap().1),
        no_uptime(body)
    );
    let head_only = fetch(port, b"HEAD / HTTP/1.0\r\n\r\n").await;
    assert!(head_only.starts_with("HTTP/1.1 200 OK") && head_only.ends_with("\r\n\r\n"));
    let post = fetch(port, b"POST / HTTP/1.1\r\nContent-Length: 0\r\n\r\n").await;
    assert!(post.starts_with("HTTP/1.1 405 "), "{post}");

    // A request line split across writes is still recognised.
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    s.write_all(b"GE").await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    s.write_all(b"T / HTTP/1.1\r\n\r\n").await.unwrap();
    let mut out = Vec::new();
    timeout(Duration::from_secs(5), s.read_to_end(&mut out))
        .await
        .unwrap()
        .unwrap();
    assert!(out.starts_with(b"HTTP/1.1 200 OK"));

    drop(lines);
    hub.stop().await;
}

#[tokio::test]
async fn http_diag_answers_an_oversized_request_without_reading_it_all() {
    let (hub, _) = hub().await;
    let mut s = TcpStream::connect(("127.0.0.1", hub.port())).await.unwrap();
    let mut req = b"GET /".to_vec();
    req.extend(std::iter::repeat_n(b'a', 1024 * 1024));
    // The hub answers after 8 KiB and closes; the rest of the write may then fail.
    let _ = s.write_all(&req).await;
    let mut out = Vec::new();
    let _ = timeout(Duration::from_secs(5), s.read_to_end(&mut out))
        .await
        .expect("the hub closes");
    assert!(
        out.is_empty() || out.starts_with(b"HTTP/1.1 200 OK"),
        "the fixed page or a close"
    );
    hub.stop().await;
}
