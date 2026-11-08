//! The admin channel end to end over loopback TLS: the same scenarios run through `LocalAdmin` and
//! `RemoteAdmin` on one hub and must give equal results, edits sent over the channel land in the hub's own
//! `lanhub.toml`, and a wrong token or a wrong pin is refused with its code.

use std::path::{Path, PathBuf};

use lanhub_core::Hub;
use lanhub_core::admin::{AdminApi, AnyAdmin};
use lanhub_core::admin_remote::{RemoteAdmin, RemoteTarget};
use lanhub_core::admin_server::AdminSource;
use lanhub_core::config::{self, Config};
use lanhub_core::config_file::{ConfigFile, HistoryInput, ImportInput, ProjectInput};
use lanhub_core::registry::AdminError;

const TOKEN: &str = "admin-token-0123456789";

struct Setup {
    dir: PathBuf,
    hub: Hub,
    file: PathBuf,
    target: RemoteTarget,
}

impl Drop for Setup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn folder(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    std::fs::create_dir_all(&p).unwrap();
    p
}

async fn setup(tag: &str) -> Setup {
    setup_with(tag, |c| c).await
}

async fn setup_with(tag: &str, adjust: fn(Config) -> Config) -> Setup {
    let dir = std::env::temp_dir().join(format!(
        "lanhub-admin-{tag}-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    let root = folder(&dir, "p");
    let file = dir.join("lanhub.toml");
    let text = format!(
        "[hub]\nbind = \"127.0.0.1\"\nport = 0\ndiscovery = false\n\n[hub.tls]\nenabled = true\n\n[hub.admin]\nremote = true\ntoken = \"{TOKEN}\"\n\n[[project]]\nname = \"P\"\nroot = '{}'\ntoken = \"t0\"\n",
        root.display()
    );
    std::fs::write(&file, text).unwrap();
    let cfg = config::load(&file).unwrap();
    let (hub, _) = Hub::start(cfg, "instance".into()).await.unwrap();
    hub.serve_admin(AdminSource::File {
        file: ConfigFile::new(file.clone()),
        adjust: Box::new(adjust),
    })
    .await;
    let target = RemoteTarget {
        host: "127.0.0.1".into(),
        port: hub.port(),
        fingerprint: hub.registry().tls_fingerprint().await,
    };
    Setup {
        dir,
        hub,
        file,
        target,
    }
}

#[tokio::test]
async fn admin_remote_gives_the_results_of_the_local_api() {
    let s = setup("same").await;
    let local = AnyAdmin::Local(s.hub.admin());
    let remote = AnyAdmin::Remote(RemoteAdmin::connect(&s.target, TOKEN).await.unwrap());

    assert_eq!(
        local.list_projects().await.unwrap(),
        remote.list_projects().await.unwrap()
    );
    assert_eq!(
        local.project_status("p").await.unwrap(),
        remote.project_status("p").await.unwrap()
    );
    assert_eq!(remote.project_status("nope").await.unwrap(), None);
    assert_eq!(
        local.clients("P").await.unwrap(),
        remote.clients("P").await.unwrap()
    );
    for api in [&local, &remote] {
        assert!(matches!(
            api.clients("nope").await,
            Err(AdminError::UnknownProject(n)) if n == "nope"
        ));
        assert!(matches!(
            api.rotate_token("nope").await,
            Err(AdminError::UnknownProject(n)) if n == "nope"
        ));
    }
    let first = local.logs(0, 1).await.unwrap()[0].seq;
    assert_eq!(
        local.logs(first - 1, 3).await.unwrap(),
        remote.logs(first - 1, 3).await.unwrap()
    );
    assert_eq!(
        local.invite_codes("p").await.unwrap(),
        remote.invite_codes("p").await.unwrap()
    );
    assert_eq!(
        local.history_usage("P").await.unwrap(),
        remote.history_usage("P").await.unwrap()
    );
    for api in [&local, &remote] {
        assert!(matches!(api.run_retention("P").await, Ok(Some(Ok(_)))));
        assert!(matches!(
            api.history_usage("nope").await,
            Err(AdminError::UnknownProject(n)) if n == "nope"
        ));
        assert!(matches!(
            api.import_legacy(&s.dir.join("missing")).await,
            Ok(Err(_))
        ));
    }
    let legacy = folder(&s.dir, "legacy");
    std::fs::write(legacy.join("token-Old.txt"), "0123456789abcdef").unwrap();
    std::fs::write(legacy.join("token-p.txt"), "fedcba9876543210").unwrap();
    let found = local.import_legacy(&legacy).await.unwrap().unwrap();
    assert_eq!(found, remote.import_legacy(&legacy).await.unwrap().unwrap());
    assert_eq!(
        found
            .iter()
            .map(|p| (p.name.as_str(), p.exists))
            .collect::<Vec<_>>(),
        [("Old", false), ("p", true)]
    );
    let cfg = config::load(&s.file).unwrap();
    assert_eq!(
        local.apply_config(cfg.clone()).await.unwrap(),
        remote.apply_config(cfg).await.unwrap()
    );

    // A remote rotation is written to the hub's file; both are in force for the next join.
    let token = remote.rotate_token("P").await.unwrap();
    assert_eq!(
        local.project_status("P").await.unwrap().unwrap().token,
        token
    );
    assert!(std::fs::read_to_string(&s.file).unwrap().contains(&token));
    let token = local.rotate_token("P").await.unwrap();
    assert_eq!(
        remote.project_status("P").await.unwrap().unwrap().token,
        token
    );
    s.hub.registry().stop().await;
}

#[tokio::test]
async fn admin_remote_edits_write_the_hub_file_and_keep_the_channel() {
    let s = setup("edit").await;
    let remote = RemoteAdmin::connect(&s.target, TOKEN).await.unwrap();
    let root = folder(&s.dir, "q");
    let input = ProjectInput {
        name: "Q".into(),
        root: root.to_string_lossy().into_owned(),
        enabled: true,
        advertise: false,
    };
    remote.add_project(&input).await.unwrap();
    let text = std::fs::read_to_string(&s.file).unwrap();
    assert!(text.contains("name = \"Q\""), "{text}");
    assert!(
        text.contains("[hub.admin]"),
        "the edit keeps the admin table"
    );
    let names: Vec<String> = remote
        .list_projects()
        .await
        .unwrap()
        .into_iter()
        .map(|p| p.name)
        .collect();
    assert_eq!(names, ["P", "Q"]);

    let dup = remote.add_project(&input).await.unwrap_err();
    assert_eq!(
        (dup.code.as_str(), dup.field.as_deref()),
        ("nameDuplicate", Some("name"))
    );
    remote.set_enabled("Q", false).await.unwrap();
    remote.remove_project("Q").await.unwrap();
    assert!(
        !std::fs::read_to_string(&s.file)
            .unwrap()
            .contains("name = \"Q\"")
    );
    let codes = remote.all_invite_codes().await.unwrap();
    assert!(codes.len() == 1 && codes[0].code.starts_with("LC3-"));
    let settings = remote.hub_settings().await.unwrap();
    assert_eq!(settings.fingerprint, s.target.fingerprint);
    // An apply sent over the channel carries no admin settings; the hub keeps its own.
    remote
        .apply_config(config::load(&s.file).unwrap())
        .await
        .unwrap();
    assert!(RemoteAdmin::connect(&s.target, TOKEN).await.is_ok());
    s.hub.registry().stop().await;
}

#[tokio::test]
async fn admin_remote_project_screens_write_the_hub_file() {
    let s = setup("screens").await;
    let remote = RemoteAdmin::connect(&s.target, TOKEN).await.unwrap();
    std::fs::write(s.dir.join("p").join("a.log"), "x").unwrap();
    std::fs::write(s.dir.join("p").join("b.txt"), "y").unwrap();

    remote
        .set_allow("p", &["github:alice".into(), "".into()])
        .await
        .unwrap();
    remote.set_exclude("P", &["*.log".into()]).await.unwrap();
    let limits = HistoryInput {
        idle_minutes: 5,
        keep_days: 7,
        max_mb: 64,
    };
    remote.set_history("P", &limits).await.unwrap();
    let settings = remote.project_settings("P").await.unwrap();
    assert_eq!(settings.allow, ["github:alice"]);
    assert_eq!(settings.exclude, ["*.log"]);
    assert_eq!(settings.history, limits);
    assert_eq!(settings.token, "t0");
    let text = std::fs::read_to_string(&s.file).unwrap();
    assert!(
        text.contains("github:alice") && text.contains("keep_days = 7"),
        "{text}"
    );

    let bad = remote
        .set_allow("P", &["github: alice".into()])
        .await
        .unwrap_err();
    assert_eq!(
        (bad.code.as_str(), bad.field.as_deref()),
        ("allowInvalid", Some("allow"))
    );
    let range = remote
        .set_history(
            "P",
            &HistoryInput {
                keep_days: 0,
                ..limits
            },
        )
        .await
        .unwrap_err();
    assert_eq!(range.field.as_deref(), Some("keepDays"));

    let preview = remote
        .preview_exclude("P", &["*.txt".into()])
        .await
        .unwrap();
    assert_eq!(
        (preview.files, preview.total),
        (vec!["b.txt".to_owned()], 1)
    );

    let root = folder(&s.dir, "old");
    let added = remote
        .import_projects(&[
            ImportInput {
                name: "Old".into(),
                root: root.to_string_lossy().into_owned(),
                token: "0123456789abcdef".into(),
                allow: vec!["github:bob".into()],
            },
            ImportInput {
                name: "p".into(),
                root: root.to_string_lossy().into_owned(),
                token: "x".into(),
                allow: vec![],
            },
        ])
        .await
        .unwrap();
    assert_eq!(added, ["Old"]);
    let old = remote.project_status("Old").await.unwrap().unwrap();
    assert_eq!(old.token, "0123456789abcdef");
    assert!(
        std::fs::read_to_string(&s.file)
            .unwrap()
            .contains("[hub.admin]")
    );
    s.hub.registry().stop().await;
}

#[tokio::test]
async fn admin_remote_refuses_a_wrong_token_and_a_wrong_pin() {
    let s = setup("refuse").await;
    let wrong = RemoteAdmin::connect(&s.target, "not-the-admin-token")
        .await
        .err()
        .unwrap();
    assert_eq!(wrong.code, "remoteTokenInvalid");

    let mut pinned = s.target.clone();
    let other = "ab".repeat(32);
    pinned.fingerprint = Some(other.clone());
    let e = RemoteAdmin::connect(&pinned, TOKEN).await.err().unwrap();
    assert_eq!(e.code, "remoteFingerprint");
    assert_eq!(e.params["expected"], other);
    assert_eq!(Some(&e.params["received"]), s.target.fingerprint.as_ref());

    let mut plain = s.target.clone();
    plain.fingerprint = None;
    let e = RemoteAdmin::connect(&plain, TOKEN).await.err().unwrap();
    assert_eq!(e.code, "remoteTlsOn", "a plain session to a TLS hub");
    s.hub.registry().stop().await;
}

#[tokio::test]
async fn admin_remote_apply_keeps_the_command_line_overrides() {
    let s = setup_with("adjust", |mut c| {
        c.hub.name = Some("Override".into());
        c
    })
    .await;
    let remote = RemoteAdmin::connect(&s.target, TOKEN).await.unwrap();
    remote
        .apply_config(config::load(&s.file).unwrap())
        .await
        .unwrap();
    let again = RemoteAdmin::connect(&s.target, TOKEN).await.unwrap();
    assert_eq!(again.info().hub_name, "Override");
    s.hub.registry().stop().await;
}
