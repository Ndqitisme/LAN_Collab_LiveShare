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
