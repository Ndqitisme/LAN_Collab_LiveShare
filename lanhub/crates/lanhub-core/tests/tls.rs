//! TLS on the hub port: the self-signed certificate is generated once and keeps its fingerprint across
//! restarts, a provided certificate is used as is, and a plain hello gets exactly one `tls_required` line.

use std::path::{Path, PathBuf};
use std::time::Duration;

use lanhub_core::Hub;
use lanhub_core::config::{Config, HubSettings, ProjectConfig, TlsSettings};
use lanhub_core::tls;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "lanhub-tls-{tag}-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn config(state: &Path, root: &Path, tls: TlsSettings) -> Config {
    Config {
        hub: HubSettings {
            bind: "127.0.0.1".into(),
            port: 0,
            discovery: false,
            tls,
            state_dir: Some(state.to_owned()),
            ..HubSettings::default()
        },
        projects: vec![ProjectConfig::new("Demo", root)],
    }
}

fn self_signed() -> TlsSettings {
    TlsSettings {
        enabled: true,
        ..TlsSettings::default()
    }
}

async fn read_all(s: &mut TcpStream) -> Vec<u8> {
    let mut out = Vec::new();
    timeout(Duration::from_secs(5), s.read_to_end(&mut out))
        .await
        .expect("the hub closes")
        .unwrap();
    out
}

#[tokio::test]
async fn tls_self_signed_certificate_is_stable_and_plain_tcp_is_refused() {
    let (state, root) = (tmp("state"), tmp("root"));
    let (hub, _) = Hub::start(config(&state, &root, self_signed()), "i".into())
        .await
        .unwrap();
    let fp = hub.registry().tls_fingerprint().await.expect("TLS is on");
    assert_eq!(fp.len(), 64);
    assert!(fp.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));

    let mut plain = TcpStream::connect(("127.0.0.1", hub.port())).await.unwrap();
    plain
        .write_all(b"{\"t\":\"hello\",\"proto\":2,\"project\":\"Demo\"}\n")
        .await
        .unwrap();
    assert_eq!(
        String::from_utf8(read_all(&mut plain).await).unwrap(),
        "{\"t\":\"error\",\"code\":\"tls_required\",\"data\":{}}\n"
    );

    // The diagnosis page still answers a browser that forgot https.
    let mut get = TcpStream::connect(("127.0.0.1", hub.port())).await.unwrap();
    get.write_all(b"GET / HTTP/1.1\r\n\r\n").await.unwrap();
    let page = String::from_utf8(read_all(&mut get).await).unwrap();
    assert!(page.starts_with("HTTP/1.1 200 OK"));
    assert!(page.contains(&fp));
    hub.stop().await;

    for _ in 0..2 {
        let (hub, _) = Hub::start(config(&state, &root, self_signed()), "i".into())
            .await
            .unwrap();
        assert_eq!(
            hub.registry().tls_fingerprint().await.as_deref(),
            Some(fp.as_str())
        );
        hub.stop().await;
    }
    assert!(state.join(tls::GENERATED_FILE).is_file());
}

#[tokio::test]
async fn tls_uses_a_provided_certificate_and_refuses_a_broken_one() {
    let (state, root) = (tmp("state"), tmp("root"));
    let generated = rcgen::generate_simple_self_signed(vec!["hub.example.com".to_owned()]).unwrap();
    let (cert, key) = (state.join("hub.pem"), state.join("hub.key"));
    std::fs::write(&cert, generated.cert.pem()).unwrap();
    std::fs::write(&key, generated.signing_key.serialize_pem()).unwrap();
    let provided = TlsSettings {
        enabled: true,
        cert: Some(cert.clone()),
        key: Some(key.clone()),
    };
    let (hub, _) = Hub::start(config(&state, &root, provided.clone()), "i".into())
        .await
        .unwrap();
    assert_eq!(
        hub.registry().tls_fingerprint().await,
        Some(tls::fingerprint(generated.cert.der()))
    );
    assert!(!state.join(tls::GENERATED_FILE).exists());
    hub.stop().await;

    std::fs::write(&key, "not a key").unwrap();
    let e = Hub::start(config(&state, &root, provided), "i".into())
        .await
        .err()
        .expect("a TLS hub never starts without its certificate");
    assert!(e.to_string().contains("hub.key"), "{e}");
}

#[tokio::test]
async fn tls_turns_on_and_off_at_apply() {
    let (state, root) = (tmp("state"), tmp("root"));
    let (hub, _) = Hub::start(config(&state, &root, TlsSettings::default()), "i".into())
        .await
        .unwrap();
    assert_eq!(hub.registry().tls_fingerprint().await, None);
    hub.apply(config(&state, &root, self_signed())).await;
    assert!(hub.registry().tls_fingerprint().await.is_some());
    let mut plain = TcpStream::connect(("127.0.0.1", hub.port())).await.unwrap();
    plain.write_all(b"{\"t\":\"hello\"}\n").await.unwrap();
    assert!(
        String::from_utf8(read_all(&mut plain).await)
            .unwrap()
            .contains("tls_required")
    );
    hub.apply(config(&state, &root, TlsSettings::default()))
        .await;
    assert_eq!(hub.registry().tls_fingerprint().await, None);
    hub.stop().await;
}
