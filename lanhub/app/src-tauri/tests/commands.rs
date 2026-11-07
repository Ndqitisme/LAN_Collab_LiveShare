//! What each command does to `lanhub.toml` and to the hub it runs. The Tauri commands are thin wrappers over
//! `AppCore`, so these drive `AppCore` against a config in a temp folder.

use std::path::{Path, PathBuf};

use lanhub_app::config_file::{ConfigFile, ProjectInput};
use lanhub_app::service::AppCore;
use lanhub_core::registry::ProjectState;
use lanhub_core::util::random_hex;

const HEADER: &str = "# written by hand
[hub]
bind = \"127.0.0.1\"
port = 0
discovery = false
";

struct Scratch {
    dir: PathBuf,
}

impl Scratch {
    fn new() -> Scratch {
        let dir = std::env::temp_dir().join(format!("lanhub-app-test-{}", random_hex::<6>()));
        std::fs::create_dir_all(&dir).unwrap();
        Scratch { dir }
    }

    fn folder(&self, name: &str) -> String {
        let p = self.dir.join(name);
        std::fs::create_dir_all(&p).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn config(&self) -> PathBuf {
        self.dir.join("lanhub.toml")
    }

    fn text(&self) -> String {
        std::fs::read_to_string(self.config()).unwrap()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn input(name: &str, root: &str) -> ProjectInput {
    ProjectInput {
        name: name.to_owned(),
        root: root.to_owned(),
        enabled: true,
        advertise: true,
    }
}

async fn started(config: &Path, text: &str) -> AppCore {
    std::fs::write(config, text).unwrap();
    let core = AppCore::new(config.to_owned());
    core.reload().await;
    core
}

async fn state_of(core: &AppCore, name: &str) -> Option<ProjectState> {
    core.inputs()
        .await
        .statuses
        .expect("the hub runs")
        .into_iter()
        .find(|p| p.name == name)
        .map(|p| p.state)
}

fn parsed(text: &str) -> toml_edit::DocumentMut {
    text.parse().unwrap()
}

#[tokio::test]
async fn add_project_writes_the_file_and_starts_serving() {
    let s = Scratch::new();
    let root = s.folder("web");
    std::fs::write(Path::new(&root).join("a.txt"), "hi").unwrap();
    let core = started(&s.config(), HEADER).await;

    core.add_project(&input("  web  ", &root)).await.unwrap();

    let text = s.text();
    assert!(
        text.starts_with(HEADER),
        "the hand-written part stays: {text}"
    );
    let doc = parsed(&text);
    let p = &doc["project"][0];
    assert_eq!(p["name"].as_str(), Some("web"));
    assert_eq!(p["root"].as_str(), Some(root.as_str()));
    assert_eq!(p["enabled"].as_bool(), Some(true));
    assert_eq!(p["advertise"].as_bool(), Some(true));
    let token = p["token"].as_str().unwrap();
    assert!(token.len() == 32 && token.chars().all(|c| c.is_ascii_hexdigit()));
    let status = core.inputs().await.statuses.unwrap();
    assert_eq!(status[0].state, ProjectState::Running);
    assert_eq!(status[0].files, Some(1));
    core.shutdown().await;
}

#[tokio::test]
async fn invalid_input_names_the_field_and_writes_nothing() {
    let s = Scratch::new();
    let (web, api, gone) = (s.folder("web"), s.folder("api"), s.dir.join("gone"));
    let core = started(&s.config(), HEADER).await;
    core.add_project(&input("web", &web)).await.unwrap();
    let before = s.text();

    let cases = [
        (input(" ", &api), "nameEmpty", "name"),
        (input("WEB", &api), "nameDuplicate", "name"),
        (input("api", ""), "rootEmpty", "root"),
        (input("api", "relative\\path"), "rootRelative", "root"),
        (input("api", gone.to_str().unwrap()), "rootMissing", "root"),
        (input("api", &format!("{web}\\")), "rootTaken", "root"),
    ];
    for (bad, code, field) in cases {
        let e = core.add_project(&bad).await.unwrap_err();
        assert_eq!((e.code, e.field), (code, Some(field)), "{bad:?}");
    }
    assert_eq!(s.text(), before);
    core.shutdown().await;
}

#[tokio::test]
async fn update_keeps_the_token_and_keys_the_form_does_not_show() {
    let s = Scratch::new();
    let (web, other) = (s.folder("web"), s.folder("other"));
    let text = format!(
        "{HEADER}\n[[project]]\nname = \"web\"\nroot = '{web}'\ntoken = \"abc\"\nexclude = [\"build/**\"] # keep\n"
    );
    let core = started(&s.config(), &text).await;

    let mut edit = input("portal", &other);
    edit.advertise = false;
    core.update_project("WEB", &edit).await.unwrap();

    let after = s.text();
    assert!(after.contains("exclude = [\"build/**\"] # keep"), "{after}");
    let doc = parsed(&after);
    let p = &doc["project"][0];
    assert_eq!(p["name"].as_str(), Some("portal"));
    assert_eq!(p["root"].as_str(), Some(other.as_str()));
    assert_eq!(p["token"].as_str(), Some("abc"));
    assert_eq!(p["advertise"].as_bool(), Some(false));
    assert_eq!(state_of(&core, "portal").await, Some(ProjectState::Running));
    assert_eq!(state_of(&core, "web").await, None);

    let e = core.update_project("nope", &edit).await.unwrap_err();
    assert_eq!(e.code, "unknownProject");
    core.shutdown().await;
}

#[tokio::test]
async fn set_enabled_pauses_and_resumes_a_project() {
    let s = Scratch::new();
    let web = s.folder("web");
    let core = started(&s.config(), HEADER).await;
    core.add_project(&input("web", &web)).await.unwrap();

    core.set_enabled("web", false).await.unwrap();
    assert_eq!(
        parsed(&s.text())["project"][0]["enabled"].as_bool(),
        Some(false)
    );
    assert_eq!(state_of(&core, "web").await, Some(ProjectState::Disabled));

    core.set_enabled("Web", true).await.unwrap();
    assert_eq!(
        parsed(&s.text())["project"][0]["enabled"].as_bool(),
        Some(true)
    );
    assert_eq!(state_of(&core, "web").await, Some(ProjectState::Running));
    core.shutdown().await;
}

#[tokio::test]
async fn resuming_onto_a_folder_another_project_serves_is_refused() {
    let s = Scratch::new();
    let web = s.folder("web");
    let core = started(&s.config(), HEADER).await;
    core.add_project(&input("a", &web)).await.unwrap();
    core.set_enabled("a", false).await.unwrap();
    core.add_project(&input("b", &web)).await.unwrap();
    let before = s.text();

    let e = core.set_enabled("a", true).await.unwrap_err();
    assert_eq!(
        (e.code, e.params.get("name").map(String::as_str)),
        ("rootTaken", Some("b"))
    );
    assert_eq!(s.text(), before);
    core.shutdown().await;
}

#[tokio::test]
async fn remove_project_drops_its_table_and_stops_it() {
    let s = Scratch::new();
    let (web, api) = (s.folder("web"), s.folder("api"));
    let core = started(&s.config(), HEADER).await;
    core.add_project(&input("web", &web)).await.unwrap();
    core.add_project(&input("api", &api)).await.unwrap();

    core.remove_project("WEB").await.unwrap();
    let doc = parsed(&s.text());
    let names: Vec<&str> = doc["project"]
        .as_array_of_tables()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["api"]);
    assert_eq!(state_of(&core, "web").await, None);

    core.remove_project("api").await.unwrap();
    assert_eq!(s.text().trim_end(), HEADER.trim_end());
    core.shutdown().await;
}

#[test]
fn a_missing_file_is_created_on_the_first_save() {
    let s = Scratch::new();
    let web = s.folder("web");
    // Through `ConfigFile`: a hub on the default port would listen on every interface of the test machine.
    let file = ConfigFile::new(s.config());
    assert_eq!(file.load().unwrap().projects.len(), 0);
    let cfg = file.add_project(&input("web", &web)).unwrap();
    assert_eq!(cfg.projects[0].name, "web");
    assert_eq!(
        parsed(&s.text())["project"][0]["name"].as_str(),
        Some("web")
    );
}

#[tokio::test]
async fn a_file_that_does_not_parse_is_never_overwritten() {
    let s = Scratch::new();
    let web = s.folder("web");
    let broken = format!("{HEADER}[[project]]\nname = \"web\"\n");
    std::fs::write(s.config(), &broken).unwrap();
    let core = AppCore::new(s.config());
    core.reload().await;
    let inputs = core.inputs().await;
    assert_eq!(
        inputs.config_error.map(|e| e.key),
        Some(Some("root".to_owned()))
    );

    let e = core.add_project(&input("api", &web)).await.unwrap_err();
    assert_eq!(e.code, "configInvalid");
    assert_eq!(s.text(), broken);
    core.shutdown().await;
}

fn one_project(web: &str) -> String {
    format!(
        "{HEADER}\n[[project]]\nname = \"web\"\nroot = '{web}'\ntoken = \"abc\"\n\n[project.history]\nenabled = true # keep\nidle_minutes = 15\n"
    )
}

fn token_of(text: &str) -> String {
    parsed(text)["project"][0]["token"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn rotate_token_writes_the_new_token_and_the_hub_uses_it() {
    let s = Scratch::new();
    let web = s.folder("web");
    let core = started(&s.config(), &one_project(&web)).await;

    let token = core.rotate_token("WEB").await.unwrap();

    assert_ne!(token, "abc");
    assert_eq!(token_of(&s.text()), token);
    assert!(s.text().contains("enabled = true # keep"));
    let status = core.inputs().await.statuses.unwrap();
    assert_eq!(status[0].token, token, "the running hub has the new token");
    assert_eq!(core.project_settings("web").unwrap().token, token);
    assert_eq!(
        core.rotate_token("nope").await.unwrap_err().code,
        "unknownProject"
    );
    core.shutdown().await;
}

#[tokio::test]
async fn allow_list_names_the_invalid_line_and_saves_valid_entries() {
    let s = Scratch::new();
    let web = s.folder("web");
    let core = started(&s.config(), &one_project(&web)).await;
    let before = s.text();
    let lines = |v: &[&str]| v.iter().map(|l| (*l).to_owned()).collect::<Vec<_>>();

    for (bad, line) in [
        (lines(&["github:alice", "", "github alice"]), "3"),
        (lines(&[":bob"]), "1"),
        (lines(&["github:", "x"]), "1"),
        (lines(&["a", "github:b # c"]), "2"),
        (lines(&["a", "b:c:d"]), "2"),
    ] {
        let e = core.set_allow("web", &bad).await.unwrap_err();
        assert_eq!(
            (e.code, e.field),
            ("allowInvalid", Some("allow")),
            "{bad:?}"
        );
        assert_eq!(e.params["line"], line, "{bad:?}");
    }
    assert_eq!(s.text(), before);

    core.set_allow(
        "web",
        &lines(&[" github:Alice ", "", "microsoft:bob@example.com", "carol"]),
    )
    .await
    .unwrap();
    let allow = &parsed(&s.text())["project"][0]["allow"];
    let written: Vec<&str> = allow
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert_eq!(
        written,
        ["github:Alice", "microsoft:bob@example.com", "carol"]
    );
    assert_eq!(core.project_settings("web").unwrap().allow.len(), 3);

    core.set_allow("web", &[]).await.unwrap();
    assert!(parsed(&s.text())["project"][0].get("allow").is_none());
    core.shutdown().await;
}

#[tokio::test]
async fn exclude_preview_lists_matching_files_and_saving_writes_the_patterns() {
    let s = Scratch::new();
    let web = s.folder("web");
    let root = Path::new(&web);
    std::fs::create_dir_all(root.join("build")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
    std::fs::write(root.join("build/out.js"), "1").unwrap();
    std::fs::write(root.join("src.js"), "2").unwrap();
    std::fs::write(root.join("node_modules/x/i.js"), "3").unwrap();
    let core = started(&s.config(), &one_project(&web)).await;

    let preview = core
        .preview_exclude("web", vec!["build/**".into(), "  ".into()])
        .await
        .unwrap();
    assert_eq!(preview.files, ["build/out.js"]);
    assert_eq!((preview.total, preview.scanned), (1, 2));
    assert!(!s.text().contains("exclude"), "a preview writes nothing");

    core.set_exclude("web", &["build/**".into(), "".into(), "*.log".into()])
        .await
        .unwrap();
    assert!(
        s.text().contains("exclude = [\"build/**\", \"*.log\"]"),
        "{}",
        s.text()
    );
    assert_eq!(
        core.project_settings("web").unwrap().exclude,
        ["build/**", "*.log"]
    );
    core.shutdown().await;
}

#[tokio::test]
async fn history_limits_go_into_the_history_table_and_ranges_are_checked() {
    use lanhub_app::config_file::HistoryInput;
    let s = Scratch::new();
    let web = s.folder("web");
    let core = started(&s.config(), &one_project(&web)).await;
    let before = s.text();

    let bad = [
        (
            HistoryInput {
                idle_minutes: 0,
                keep_days: 30,
                max_mb: 2048,
            },
            "idleMinutes",
        ),
        (
            HistoryInput {
                idle_minutes: 15,
                keep_days: 0,
                max_mb: 2048,
            },
            "keepDays",
        ),
        (
            HistoryInput {
                idle_minutes: 15,
                keep_days: 30,
                max_mb: 0,
            },
            "maxMb",
        ),
    ];
    for (h, field) in bad {
        let e = core.set_history("web", &h).await.unwrap_err();
        assert_eq!((e.code, e.field), ("outOfRange", Some(field)));
    }
    assert_eq!(s.text(), before);

    let h = HistoryInput {
        idle_minutes: 5,
        keep_days: 7,
        max_mb: 100,
    };
    core.set_history("web", &h).await.unwrap();
    let text = s.text();
    assert!(text.contains("enabled = true # keep"), "{text}");
    let doc = parsed(&text);
    let t = &doc["project"][0]["history"];
    assert_eq!(t["idle_minutes"].as_integer(), Some(5));
    assert_eq!(t["keep_days"].as_integer(), Some(7));
    assert_eq!(t["max_mb"].as_integer(), Some(100));
    assert_eq!(core.project_settings("web").unwrap().history, h);
    assert!(core.history_usage("web").await.unwrap().is_some());
    core.run_retention("web").await.unwrap();
    core.shutdown().await;
}

#[tokio::test]
async fn importing_a_legacy_folder_twice_adds_the_projects_once() {
    use lanhub_app::config_file::ImportInput;
    let s = Scratch::new();
    let (web, api) = (s.folder("web"), s.folder("api"));
    let old = s.folder("hub01");
    std::fs::write(Path::new(&old).join("token-Web.txt"), "aa11bb22\r\n").unwrap();
    std::fs::write(
        Path::new(&old).join("allowed-accounts-Web.txt"),
        "# c\ngithub:alice\n",
    )
    .unwrap();
    std::fs::write(Path::new(&old).join("token-Api.txt"), "cc33").unwrap();
    let core = started(&s.config(), HEADER).await;

    let found = core.scan_legacy(Path::new(&old)).await.unwrap();
    assert_eq!(found.len(), 2);
    let items: Vec<ImportInput> = found
        .iter()
        .map(|p| ImportInput {
            name: p.name.clone(),
            root: if p.name == "Web" {
                web.clone()
            } else {
                api.clone()
            },
            token: p.token.clone(),
            allow: p.allow.clone(),
        })
        .collect();
    let added = core.import_legacy(&items).await.unwrap();
    assert_eq!(added, ["Api", "Web"]);
    let text = s.text();
    let doc = parsed(&text);
    assert_eq!(doc["project"][1]["name"].as_str(), Some("Web"));
    assert_eq!(doc["project"][1]["token"].as_str(), Some("aa11bb22"));
    assert_eq!(doc["project"][1]["allow"][0].as_str(), Some("github:alice"));
    assert_eq!(state_of(&core, "Web").await, Some(ProjectState::Running));

    assert!(
        core.scan_legacy(Path::new(&old))
            .await
            .unwrap()
            .iter()
            .all(|p| p.exists)
    );
    assert!(core.import_legacy(&items).await.unwrap().is_empty());
    assert_eq!(s.text(), text, "the second import writes nothing");

    let e = core
        .import_legacy(&[ImportInput {
            name: "New".into(),
            root: s.dir.join("gone").to_string_lossy().into_owned(),
            token: "t".into(),
            allow: vec![],
        }])
        .await
        .unwrap_err();
    assert_eq!(
        (e.code, e.params["project"].as_str()),
        ("rootMissing", "New")
    );
    core.shutdown().await;
}
