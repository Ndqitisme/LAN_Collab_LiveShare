//! The admin channel end to end over loopback TLS: the same scenarios run through `LocalAdmin` and
//! `RemoteAdmin` on one hub and must give equal results, edits sent over the channel land in the hub's own
//! `lanhub.toml`, and a wrong token or a wrong pin is refused with its code.

use std::path::{Path, PathBuf};

use lanhub_core::Hub;
use lanhub_core::admin::{AdminApi, AnyAdmin};
use lanhub_core::admin_remote::{RemoteAdmin, RemoteTarget};
use lanhub_core::admin_server::AdminSource;
use lanhub_core::config::{self, Config};
use lanhub_core::config_file::{ConfigFile, ProjectInput};
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
        adjust: Box::new(|c: Config| c),
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
    let codes = remote.invite_codes().await.unwrap();
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
