//! The registry applies configs idempotently: only projects whose settings differ start, stop or change,
//! members of the others stay connected, and a panic that ends one actor leaves the other projects
//! serving.

use std::path::PathBuf;
use std::time::Duration;

use lanhub_core::Hub;
use lanhub_core::config::{Config, HubSettings, ProjectConfig};
use lanhub_core::registry::{EventKind, ProjectEvent, ProjectState};
use lanhub_protocol::json::{self, Json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::net::TcpStream;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::time::timeout;

struct Client {
    lines: Lines<BufReader<OwnedReadHalf>>,
    wr: OwnedWriteHalf,
    seq: u32,
}

impl Client {
    /// Sends a hello and returns the client with the hub's first answer (`welcome` or `error`).
    async fn hello(port: u16, project: &str, token: &str) -> (Client, Json) {
        let (rd, wr) = TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap()
            .into_split();
        let mut c = Client {
            lines: BufReader::new(rd).lines(),
            wr,
            seq: 0,
        };
        c.send(&format!(
            r#"{{"t":"hello","proto":2,"project":"{project}","token":"{token}","name":"t","uid":"u-{project}"}}"#
        ))
        .await;
        let first = c.next_any().await.expect("an answer to the hello");
        (c, first)
    }

    async fn join(port: u16, project: &str, token: &str) -> Client {
        let (c, first) = Client::hello(port, project, token).await;
        assert_eq!(t(&first), "welcome", "{project}: {first:?}");
        c
    }

    async fn send(&mut self, line: &str) {
        self.wr
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
    }

    /// The next message, or `None` once the hub closed the connection.
    async fn next_any(&mut self) -> Option<Json> {
        timeout(Duration::from_secs(5), self.lines.next_line())
            .await
            .expect("no message within 5 s")
            .ok()
            .flatten()
            .map(|l| json::parse(l.as_bytes()).unwrap())
    }

    async fn next_of(&mut self, want: &str) -> Json {
        loop {
            let m = self
                .next_any()
                .await
                .unwrap_or_else(|| panic!("closed while waiting for {want}"));
            if t(&m) == want {
                return m;
            }
        }
    }

    /// Inserts "x" at the start of `path`, `len` units long at `rev`, and waits for the ack.
    async fn edit(&mut self, path: &str, rev: u32, len: u32) -> Json {
        self.seq += 1;
        self.send(&format!(
            r#"{{"t":"op","path":"{path}","rev":{rev},"op":["x",{len}],"seq":{}}}"#,
            self.seq
        ))
        .await;
        self.next_of("ack").await
    }

    /// True when the hub closes the connection within 5 s.
    async fn closed(&mut self) -> bool {
        while self.next_any().await.is_some() {}
        true
    }
}

fn t(m: &Json) -> &str {
    m.get("t").and_then(Json::as_str).unwrap_or("")
}

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "lanhub-registry-{tag}-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("f.txt"), "a").unwrap();
    d
}

fn project(name: &str, root: &std::path::Path, token: &str) -> ProjectConfig {
    let mut p = ProjectConfig::new(name, root);
    p.token = token.to_owned();
    p
}

fn config(projects: Vec<ProjectConfig>) -> Config {
    Config {
        hub: HubSettings {
            bind: "127.0.0.1".into(),
            port: 0,
            discovery: false,
            ..HubSettings::default()
        },
        projects,
    }
}

fn ev(project: &str, kind: EventKind) -> (String, EventKind) {
    (project.to_owned(), kind)
}

fn kinds(events: &[ProjectEvent]) -> Vec<(String, EventKind)> {
    let mut v: Vec<_> = events.iter().map(|e| (e.project.clone(), e.kind)).collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

#[tokio::test(flavor = "multi_thread")]
async fn registry_applies_a_b_b_a_with_only_the_needed_events() {
    let (r1, r2, r3) = (tmp("a1"), tmp("a2"), tmp("a3"));
    let a = config(vec![project("P1", &r1, ""), project("P2", &r2, "t2")]);
    let b = config(vec![
        project("P1", &r1, ""),
        project("P2", &r2, "t2b"),
        project("P3", &r3, ""),
    ]);

    let (hub, report) = Hub::start(a.clone(), "inst".into()).await.unwrap();
    assert_eq!(
        kinds(&report.events),
        [ev("P1", EventKind::Started), ev("P2", EventKind::Started)]
    );
    let port = hub.port();
    let mut p1 = Client::join(port, "p1", "").await;
    assert_eq!(
        p1.edit("f.txt", 0, 1)
            .await
            .get("rev")
            .and_then(Json::as_f64),
        Some(1.0)
    );

    let report = hub.apply(b.clone()).await;
    assert_eq!(
        kinds(&report.events),
        [
            ev("P2", EventKind::Reconfigured),
            ev("P3", EventKind::Started)
        ]
    );
    let (_, refused) = Client::hello(port, "P2", "t2").await;
    assert_eq!(
        refused.get("code").and_then(Json::as_str),
        Some("token_invalid")
    );
    Client::join(port, "P2", "t2b").await;
    Client::join(port, "P3", "").await;

    assert!(
        hub.apply(b).await.events.is_empty(),
        "B again changes nothing"
    );

    let report = hub.apply(a.clone()).await;
    assert_eq!(
        kinds(&report.events),
        [
            ev("P2", EventKind::Reconfigured),
            ev("P3", EventKind::Stopped)
        ]
    );
    let (_, refused) = Client::hello(port, "P3", "").await;
    assert_eq!(
        refused.get("code").and_then(Json::as_str),
        Some("project_unknown")
    );
    assert!(
        hub.apply(a).await.events.is_empty(),
        "A again changes nothing"
    );

    // P1's member went through every apply on one connection.
    assert_eq!(
        p1.edit("f.txt", 1, 2)
            .await
            .get("rev")
            .and_then(Json::as_f64),
        Some(2.0)
    );
    hub.stop().await;
    assert_eq!(std::fs::read_to_string(r1.join("f.txt")).unwrap(), "xxa");
}

#[tokio::test(flavor = "multi_thread")]
async fn registry_restarts_a_project_whose_root_changes_and_flushes_the_old_one() {
    let (old_root, new_root, other) = (tmp("old"), tmp("new"), tmp("other"));
    std::fs::write(new_root.join("f.txt"), "NEW").unwrap();
    let (hub, _) = Hub::start(
        config(vec![project("P", &old_root, ""), project("Q", &other, "")]),
        "inst".into(),
    )
    .await
    .unwrap();
    let port = hub.port();
    let mut p = Client::join(port, "P", "").await;
    let mut q = Client::join(port, "Q", "").await;
    p.edit("f.txt", 0, 1).await;

    let report = hub
        .apply(config(vec![
            project("P", &new_root, ""),
            project("Q", &other, ""),
        ]))
        .await;
    assert_eq!(
        report
            .events
            .iter()
            .map(|e| (e.project.as_str(), e.kind))
            .collect::<Vec<_>>(),
        [("P", EventKind::Stopped), ("P", EventKind::Started)]
    );
    assert_eq!(
        std::fs::read_to_string(old_root.join("f.txt")).unwrap(),
        "xa"
    );
    assert!(
        p.closed().await,
        "members of the restarted project are closed"
    );
    let (_, w) = Client::hello(port, "P", "").await;
    let hash = w
        .get("files")
        .and_then(|f| f.get("f.txt"))
        .and_then(|f| f.get("hash"))
        .and_then(Json::as_str)
        .map(str::to_owned);
    assert_eq!(hash, Some(lanhub_core::util::sha1_hex(b"NEW")));
    q.edit("f.txt", 0, 1).await;
    hub.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn registry_disabled_or_unknown_project_gets_project_unknown_with_advertised_names() {
    let (r1, r2, r3) = (tmp("d1"), tmp("d2"), tmp("d3"));
    let mut hidden = project("Hidden", &r2, "");
    hidden.advertise = false;
    let mut off = project("Off", &r3, "");
    off.enabled = false;
    let (hub, report) = Hub::start(
        config(vec![project("Shown", &r1, ""), hidden, off]),
        "inst".into(),
    )
    .await
    .unwrap();
    assert_eq!(report.events.len(), 2, "a disabled project does not start");
    let port = hub.port();
    for name in ["off", "nope"] {
        let (_, e) = Client::hello(port, name, "").await;
        assert_eq!(
            e.get("code").and_then(Json::as_str),
            Some("project_unknown")
        );
        let listed = e.get("data").and_then(|d| d.get("projects")).cloned();
        assert_eq!(listed, Some(Json::Arr(vec![Json::Str("Shown".into())])));
    }
    Client::join(port, "HIDDEN", "").await;
    let statuses = hub.registry().list_projects().await;
    let states: Vec<_> = statuses
        .iter()
        .map(|s| (s.name.as_str(), s.state))
        .collect();
    assert_eq!(
        states,
        [
            ("Shown", ProjectState::Running),
            ("Hidden", ProjectState::Running),
            ("Off", ProjectState::Disabled)
        ]
    );
    hub.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn registry_panic_in_one_actor_marks_it_failed_and_others_keep_acking() {
    if !cfg!(debug_assertions) {
        return;
    }
    let (r1, r2, r3) = (tmp("p1"), tmp("p2"), tmp("p3"));
    std::fs::write(r2.join("boom.txt"), "x").unwrap();
    let mut crashy = project("P2", &r2, "");
    crashy.debug.crash_path = Some("boom.txt".into());
    let cfg = config(vec![project("P1", &r1, ""), crashy, project("P3", &r3, "")]);
    let (hub, _) = Hub::start(cfg.clone(), "inst".into()).await.unwrap();
    let mut events = hub.registry().subscribe();
    let port = hub.port();
    let mut p1 = Client::join(port, "P1", "").await;
    let mut p2 = Client::join(port, "P2", "").await;
    let mut p3 = Client::join(port, "P3", "").await;

    p2.send(r#"{"t":"op","path":"boom.txt","rev":0,"op":[1,"y"],"seq":1}"#)
        .await;
    let failed = timeout(Duration::from_secs(5), events.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (failed.project.as_str(), failed.kind),
        ("P2", EventKind::Failed)
    );
    assert!(failed.detail.unwrap().contains("boom.txt"));
    assert!(
        p2.closed().await,
        "the failed project's members are disconnected"
    );

    assert_eq!(
        p1.edit("f.txt", 0, 1)
            .await
            .get("rev")
            .and_then(Json::as_f64),
        Some(1.0)
    );
    assert_eq!(
        p3.edit("f.txt", 0, 1)
            .await
            .get("rev")
            .and_then(Json::as_f64),
        Some(1.0)
    );
    let s = hub.registry().project_status("p2").await.unwrap();
    assert_eq!(s.state, ProjectState::Failed);
    let (_, e) = Client::hello(port, "P2", "").await;
    assert_eq!(
        e.get("code").and_then(Json::as_str),
        Some("project_unknown")
    );

    let report = hub.apply(cfg).await;
    assert_eq!(
        kinds(&report.events),
        [ev("P2", EventKind::Started)],
        "apply restarts a failed project"
    );
    Client::join(port, "P2", "").await;
    hub.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn registry_apply_dropped_midway_still_finishes_and_stop_flushes_every_project() {
    let (ra, rb) = (tmp("cancel-a"), tmp("cancel-b"));
    for i in 0..3000 {
        std::fs::write(rb.join(format!("f{i}.txt")), "b").unwrap();
    }
    let a = project("A", &ra, "");
    let (hub, _) = Hub::start(config(vec![a.clone()]), "inst".into())
        .await
        .unwrap();
    let mut m = Client::join(hub.port(), "A", "").await;
    m.edit("f.txt", 0, 1).await;
    // The caller gives up while B's 3000 files load, as the CLI does when it stops during an apply.
    let pending = {
        let registry = hub.registry().clone();
        let b = config(vec![a, project("B", &rb, "")]);
        tokio::spawn(async move { registry.apply(b).await })
    };
    tokio::time::sleep(Duration::from_millis(5)).await;
    pending.abort();
    let names: Vec<String> = hub
        .registry()
        .list_projects()
        .await
        .into_iter()
        .map(|s| s.name)
        .collect();
    assert_eq!(names, ["A", "B"], "the apply ran to its end");
    hub.stop().await;
    assert_eq!(std::fs::read_to_string(ra.join("f.txt")).unwrap(), "xa");
}

#[tokio::test(flavor = "multi_thread")]
async fn registry_admin_api_lists_rotates_and_reports_clients() {
    use lanhub_core::admin::AdminApi;
    let r1 = tmp("adm");
    let (hub, _) = Hub::start(config(vec![project("P", &r1, "old")]), "inst".into())
        .await
        .unwrap();
    let admin = hub.admin();
    let port = hub.port();
    let _member = Client::join(port, "P", "old").await;
    let clients = admin.clients("p").await.unwrap();
    assert_eq!(clients.len(), 1);
    assert_eq!(clients[0].addr, "127.0.0.1");
    assert_eq!(admin.list_projects().await.unwrap()[0].clients, 1);

    let token = admin.rotate_token("P").await.unwrap();
    assert_eq!(token.len(), 32);
    let (_, e) = Client::hello(port, "P", "old").await;
    assert_eq!(e.get("code").and_then(Json::as_str), Some("token_invalid"));
    Client::join(port, "P", &token).await;
    assert_eq!(
        admin.project_status("P").await.unwrap().unwrap().token,
        token
    );
    assert!(admin.rotate_token("nope").await.is_err());

    let logs = admin.logs(0, usize::MAX).await.unwrap();
    assert!(
        logs.iter()
            .any(|r| r.project.as_deref() == Some("P") && r.msg.contains("đã đổi token")),
        "the rotation is in the structured log"
    );
    let last = logs.last().unwrap().seq;
    assert!(
        admin
            .logs(last, 10)
            .await
            .unwrap()
            .iter()
            .all(|r| r.seq > last)
    );
    hub.stop().await;
}
