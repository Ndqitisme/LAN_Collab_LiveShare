//! The admin calls behind the app's project screens: token rotation, the members list with what each one
//! reports in presence, history disk use and retention on demand, and the invite codes.

use std::path::PathBuf;
use std::time::Duration;

use lanhub_core::Hub;
use lanhub_core::admin::AdminApi;
use lanhub_core::config::{Config, HubSettings, ProjectConfig};
use lanhub_protocol::json::{self, Json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::net::TcpStream;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::time::timeout;

struct Client {
    lines: Lines<BufReader<OwnedReadHalf>>,
    wr: OwnedWriteHalf,
}

impl Client {
    async fn hello(port: u16, project: &str, token: &str, uid: &str) -> (Client, Json) {
        let (rd, wr) = TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap()
            .into_split();
        let mut c = Client {
            lines: BufReader::new(rd).lines(),
            wr,
        };
        c.send(&format!(
            r#"{{"t":"hello","proto":2,"project":"{project}","token":"{token}","name":"{uid}","uid":"{uid}","account":{{"provider":"github","label":"{uid}"}}}}"#
        ))
        .await;
        let first = c.next().await;
        (c, first)
    }

    async fn send(&mut self, line: &str) {
        self.wr
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn next(&mut self) -> Json {
        let line = timeout(Duration::from_secs(5), self.lines.next_line())
            .await
            .expect("a message within 5 s")
            .unwrap()
            .expect("the connection stays open");
        json::parse(line.as_bytes()).unwrap()
    }

    async fn next_of(&mut self, want: &str) -> Json {
        loop {
            let m = self.next().await;
            if m.get("t").and_then(Json::as_str) == Some(want) {
                return m;
            }
        }
    }
}

fn code(m: &Json) -> Option<&str> {
    m.get("code").and_then(Json::as_str)
}

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "lanhub-admin-{tag}-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("a.txt"), "hello").unwrap();
    d
}

fn config(name: &str, root: &std::path::Path, token: &str) -> Config {
    let mut p = ProjectConfig::new(name, root);
    p.token = token.to_owned();
    Config {
        hub: HubSettings {
            bind: "127.0.0.1".into(),
            port: 0,
            discovery: false,
            public_address: vec!["hub.example.com".into()],
            ..HubSettings::default()
        },
        projects: vec![p],
    }
}

fn base64url_decode(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'-' => 62,
        b'_' => 63,
        _ => panic!("not base64url: {c}"),
    };
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for c in s.bytes() {
        acc = (acc << 6) | u32::from(val(c));
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

#[tokio::test(flavor = "multi_thread")]
async fn admin_rotate_token_refuses_the_old_code_and_keeps_members() {
    let root = tmp("rotate");
    let (hub, _) = Hub::start(config("P", &root, "old"), "inst".into())
        .await
        .unwrap();
    let admin = hub.admin();
    let (mut member, w) = Client::hello(hub.port(), "P", "old", "alice").await;
    assert_eq!(w.get("t").and_then(Json::as_str), Some("welcome"));

    let token = admin.rotate_token("p").await.unwrap();
    assert_ne!(token, "old");
    let (_, refused) = Client::hello(hub.port(), "P", "old", "bob").await;
    assert_eq!(code(&refused), Some("token_invalid"));
    let (_, welcome) = Client::hello(hub.port(), "P", &token, "carol").await;
    assert_eq!(welcome.get("t").and_then(Json::as_str), Some("welcome"));

    member.send(r#"{"t":"ping","ts":1}"#).await;
    member.next_of("pong").await;
    assert!(
        admin
            .clients("P")
            .await
            .unwrap()
            .iter()
            .any(|c| c.name == "alice"),
        "a member joined with the old token stays"
    );
    hub.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn admin_clients_report_account_file_and_rtt_from_presence() {
    let root = tmp("clients");
    let (hub, _) = Hub::start(config("P", &root, "t"), "inst".into())
        .await
        .unwrap();
    let admin = hub.admin();
    let (mut alice, _) = Client::hello(hub.port(), "P", "t", "alice").await;
    alice
        .send(r#"{"t":"presence","p":{"file":"src/a.txt","line":3,"rtt":2.4}}"#)
        .await;
    alice.send(r#"{"t":"ping","ts":1}"#).await;
    alice.next_of("pong").await;
    let clients = admin.clients("P").await.unwrap();
    assert_eq!(clients.len(), 1);
    let c = &clients[0];
    assert_eq!(c.account.as_deref(), Some("github:alice"));
    assert_eq!(c.file.as_deref(), Some("src/a.txt"));
    assert_eq!(c.rtt, Some(2.0));
    assert_eq!(c.addr, "127.0.0.1");
    hub.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn admin_history_usage_counts_runs_and_bytes_and_retention_runs_on_demand() {
    let root = tmp("history");
    let mut cfg = config("P", &root, "t");
    let (hub, _) = Hub::start(cfg.clone(), "inst".into()).await.unwrap();
    let admin = hub.admin();
    let (mut alice, _) = Client::hello(hub.port(), "P", "t", "alice").await;
    let (mut bob, _) = Client::hello(hub.port(), "P", "t", "bob").await;
    // Alternating authors close a run on every op.
    for i in 0..3 {
        let c = if i == 1 { &mut bob } else { &mut alice };
        let len = 5 + i;
        c.send(&format!(
            r#"{{"t":"op","path":"a.txt","rev":{i},"op":["x",{len}],"seq":{}}}"#,
            i + 1
        ))
        .await;
        c.next_of("ack").await;
    }
    let usage = admin.history_usage("P").await.unwrap().expect("history on");
    assert!(usage.runs >= 3, "{usage:?}");
    assert!(usage.db_bytes > 0 && usage.blob_bytes > 0, "{usage:?}");
    assert!(usage.blob_count >= 2, "{usage:?}");

    let report = admin
        .run_retention("P")
        .await
        .unwrap()
        .expect("history on")
        .unwrap();
    assert_eq!(report.runs_deleted, 0, "nothing is older than keep_days");
    assert!(report.bytes_after > 0);

    cfg.projects[0].history.keep_days = 0;
    hub.apply(cfg.clone()).await;
    let report = admin.run_retention("P").await.unwrap().unwrap().unwrap();
    let after = admin.history_usage("P").await.unwrap().unwrap();
    assert!(after.runs < usage.runs, "{report:?} {after:?}");

    assert!(admin.history_usage("nope").await.is_err());
    hub.stop().await;

    let mut off = config("Q", &tmp("history-off"), "t");
    off.projects[0].history.enabled = false;
    let (hub, _) = Hub::start(off, "inst".into()).await.unwrap();
    assert_eq!(hub.admin().history_usage("Q").await.unwrap(), None);
    assert_eq!(hub.admin().run_retention("Q").await.unwrap(), None);
    hub.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn admin_invite_codes_hold_public_addresses_first_and_every_ipv4() {
    let root = tmp("invite");
    let (hub, _) = Hub::start(config("Dự án", &root, "5f0c9e"), "inst-1".into())
        .await
        .unwrap();
    let codes = hub.admin().invite_codes("dự án").await.unwrap();
    let ips: Vec<String> = lanhub_core::util::ipv4_addresses()
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(codes.hosts[0], "hub.example.com");
    assert_eq!(&codes.hosts[1..], &ips[..]);
    assert_eq!(codes.port, hub.port());
    assert!(!codes.tls);

    let code = codes.code.expect("a public address is enough for a code");
    let body = String::from_utf8(base64url_decode(code.strip_prefix("LC3-").unwrap())).unwrap();
    let j = json::parse(body.as_bytes()).unwrap();
    assert_eq!(j.get("n").and_then(Json::as_str), Some("Dự án"));
    assert_eq!(j.get("t").and_then(Json::as_str), Some("5f0c9e"));
    assert_eq!(j.get("i").and_then(Json::as_str), Some("inst-1"));
    let a: Vec<&str> = match j.get("a") {
        Some(Json::Arr(items)) => items.iter().filter_map(Json::as_str).collect(),
        other => panic!("a: {other:?}"),
    };
    assert_eq!(
        a,
        codes.hosts.iter().map(String::as_str).collect::<Vec<_>>()
    );
    assert!(j.get("f").is_none());

    assert_eq!(codes.legacy.len(), ips.len());
    for (l, ip) in codes.legacy.iter().zip(&ips) {
        assert_eq!(&l.host, ip);
        let host: std::net::Ipv4Addr = ip.parse().unwrap();
        assert_eq!(
            l.code,
            lanhub_core::invite::encode_v1(host, hub.port(), "Dự án", "5f0c9e")
        );
    }
    assert!(hub.admin().invite_codes("nope").await.is_err());
    hub.stop().await;
}
