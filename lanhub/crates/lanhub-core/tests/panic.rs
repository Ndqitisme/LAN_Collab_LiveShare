//! A panic inside one message handler must not take the project down: the member gets a resync for that
//! file and the next op on another file is still applied.

use std::time::Duration;

use lanhub_core::HubConfig;
use lanhub_protocol::json::{self, Json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;

async fn next_of(
    lines: &mut tokio::io::Lines<BufReader<tokio::net::tcp::OwnedReadHalf>>,
    t: &str,
) -> Json {
    timeout(Duration::from_secs(5), async {
        loop {
            let l = lines
                .next_line()
                .await
                .unwrap()
                .expect("hub closed the connection");
            let m = json::parse(l.as_bytes()).unwrap();
            if m.get("t").and_then(Json::as_str) == Some(t) {
                return m;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no {t} within 5 s"))
}

#[tokio::test(flavor = "multi_thread")]
async fn panic_in_a_handler_keeps_the_actor_alive() {
    let root = std::env::temp_dir().join(format!(
        "lanhub-panic-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("boom.txt"), "x").unwrap();
    std::fs::write(root.join("ok.txt"), "y").unwrap();
    let hub = lanhub_core::start(HubConfig {
        root: root.clone(),
        host: "127.0.0.1".into(),
        project: Some("P".into()),
        panic_path: Some("boom.txt".into()),
        ..HubConfig::default()
    })
    .await
    .unwrap();

    let (rd, mut wr) = TcpStream::connect(("127.0.0.1", hub.port()))
        .await
        .unwrap()
        .into_split();
    let mut lines = BufReader::new(rd).lines();
    wr.write_all(b"{\"t\":\"hello\",\"proto\":2,\"project\":\"P\",\"name\":\"t\",\"uid\":\"u\"}\n")
        .await
        .unwrap();
    next_of(&mut lines, "welcome").await;

    wr.write_all(b"{\"t\":\"op\",\"path\":\"boom.txt\",\"rev\":0,\"op\":[1,\"a\"],\"seq\":1}\n")
        .await
        .unwrap();
    let resync = next_of(&mut lines, "resync").await;
    assert_eq!(resync.get("path").and_then(Json::as_str), Some("boom.txt"));

    wr.write_all(b"{\"t\":\"op\",\"path\":\"ok.txt\",\"rev\":0,\"op\":[1,\"b\"],\"seq\":2}\n")
        .await
        .unwrap();
    let ack = next_of(&mut lines, "ack").await;
    assert_eq!(ack.get("path").and_then(Json::as_str), Some("ok.txt"));
    assert_eq!(ack.get("rev").and_then(Json::as_f64), Some(1.0));

    hub.stop().await;
    assert_eq!(std::fs::read_to_string(root.join("ok.txt")).unwrap(), "yb");
    let _ = std::fs::remove_dir_all(&root);
}
