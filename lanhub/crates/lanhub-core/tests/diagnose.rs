//! `lanhub-cli --diagnose` checks: a port held by another socket fails with its owner, a config with a
//! syntax error fails with its line.

use std::net::TcpListener;

use lanhub_core::config::HubSettings;
use lanhub_core::diagnose::{self, Source, Status};

#[test]
fn diagnose_fails_the_port_line_when_the_port_is_taken() {
    let held = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = held.local_addr().unwrap().port();
    let c = diagnose::check_tcp("127.0.0.1", port);
    assert_eq!(c.status, Status::Fail, "{c}");
    assert!(c.hint.is_some());
    if cfg!(windows) {
        assert!(
            c.detail.contains(&format!("PID {}", std::process::id())),
            "names the owner: {c}"
        );
    }
    drop(held);
    assert_eq!(diagnose::check_tcp("127.0.0.1", port).status, Status::Ok);
}

#[test]
fn diagnose_reports_the_config_line() {
    let dir = std::env::temp_dir().join(format!(
        "lanhub-diagnose-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("lanhub.toml");
    std::fs::write(&file, "[hub]\nport = 8200\nname = \"x\n").unwrap();
    let (config, hub) = diagnose::check_config(Source::File(file));
    assert_eq!((config.name, config.status), ("config", Status::Fail));
    assert!(config.detail.contains(":3:"), "{config}");
    assert!(
        config.hint.as_deref().unwrap().contains("dòng 3"),
        "{config}"
    );
    assert_eq!(
        hub,
        HubSettings::default(),
        "the other checks run on the defaults"
    );
}
