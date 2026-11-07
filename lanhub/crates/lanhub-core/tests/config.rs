//! `lanhub.toml` parsing: defaults, every field, and errors that point at the file, line, column and key.

use std::path::{Path, PathBuf};

use lanhub_core::config::{self, ConfigError, HistorySettings};

fn file() -> PathBuf {
    std::path::absolute("cfg/lanhub.toml").unwrap()
}

fn err(text: &str) -> ConfigError {
    config::parse(text, &file()).expect_err("the config must be refused")
}

#[test]
fn config_defaults_fill_missing_fields() {
    let c = config::parse("[[project]]\nname = \"A\"\nroot = \"a\"\n", &file()).unwrap();
    assert_eq!(c.hub.name, None);
    assert_eq!(c.hub.bind, "0.0.0.0");
    assert_eq!(c.hub.port, 8200);
    assert!(c.hub.discovery);
    assert_eq!(c.hub.discovery_port, 8201);
    assert!(c.hub.public_address.is_empty());
    let p = &c.projects[0];
    assert_eq!(p.name, "A");
    assert_eq!(
        p.root,
        file().parent().unwrap().join("a"),
        "relative to the file"
    );
    assert!(p.enabled);
    assert_eq!(p.token, "");
    assert!(p.allow.is_empty() && p.exclude.is_empty());
    assert_eq!(p.allow_file, None);
    assert!(p.advertise);
    assert_eq!(p.history, HistorySettings::default());
    assert_eq!(
        config::parse("", &file()).unwrap().projects,
        vec![],
        "an empty file is a hub with no project"
    );
}

#[test]
fn config_reads_every_field() {
    let text = r#"
[hub]
name = "Phòng dev"
bind = "127.0.0.1"
port = 9000
discovery = false
discovery_port = 9001
public_address = ["hub.example.com", "203.0.113.5"]

[hub.tls]
enabled = false

[[project]]
name = "MyProject"
root = 'D:\workspaces\MyProject'
enabled = false
token = "5f0c"
allow = ["github:alice", "microsoft:bob@example.com"]
allow_file = "allowed.txt"
exclude = ["build/**"]
advertise = false

[project.history]
idle_minutes = 5
keep_days = 7
max_mb = 100
"#;
    let c = config::parse(text, &file()).unwrap();
    assert_eq!(c.hub.name.as_deref(), Some("Phòng dev"));
    assert_eq!(c.hub.bind, "127.0.0.1");
    assert_eq!((c.hub.port, c.hub.discovery_port), (9000, 9001));
    assert!(!c.hub.discovery);
    assert_eq!(c.hub.public_address, ["hub.example.com", "203.0.113.5"]);
    let p = &c.projects[0];
    if cfg!(windows) {
        assert_eq!(p.root, Path::new(r"D:\workspaces\MyProject"));
    }
    assert!(!p.enabled && !p.advertise);
    assert_eq!(p.token, "5f0c");
    assert_eq!(p.allow, ["github:alice", "microsoft:bob@example.com"]);
    assert_eq!(
        p.allow_file.as_deref(),
        Some(file().parent().unwrap().join("allowed.txt").as_path())
    );
    assert_eq!(p.exclude, ["build/**"]);
    assert_eq!(
        p.history,
        HistorySettings {
            idle_minutes: 5,
            keep_days: 7,
            max_mb: 100
        }
    );
}

#[test]
fn config_refuses_a_duplicate_project_name_ignoring_case() {
    let e = err(
        "[[project]]\nname = \"Web\"\nroot = \"a\"\n\n[[project]]\nname = \"web\"\nroot = \"b\"\n",
    );
    assert_eq!((e.line, e.column), (6, 8));
    assert_eq!(e.key.as_deref(), Some("name"));
    assert!(e.message.contains("line 2"), "{e}");
}

#[test]
fn config_refuses_a_missing_or_empty_root() {
    let e = err("[[project]]\nname = \"Web\"\n");
    assert_eq!(e.key.as_deref(), Some("root"), "{e}");
    assert_eq!(e.line, 1, "{e}");
    let e = err("[[project]]\nname = \"Web\"\nroot = \"  \"\n");
    assert_eq!((e.line, e.key.as_deref()), (3, Some("root")), "{e}");
}

#[test]
fn config_refuses_two_enabled_projects_on_one_folder() {
    let e =
        err("[[project]]\nname = \"A\"\nroot = \"x\"\n[[project]]\nname = \"B\"\nroot = \"./x\"\n");
    assert_eq!((e.line, e.key.as_deref()), (6, Some("root")), "{e}");
    let e = err(
        "[[project]]\nname = \"A\"\nroot = \"x\"\n[[project]]\nname = \"B\"\nroot = \"y/../x/\"\n",
    );
    assert_eq!((e.line, e.key.as_deref()), (6, Some("root")), "{e}");
    if cfg!(windows) {
        let e = err(
            "[[project]]\nname = \"A\"\nroot = 'C:\\tmp\\p'\n[[project]]\nname = \"B\"\nroot = 'c:\\TMP\\p\\'\n",
        );
        assert_eq!((e.line, e.key.as_deref()), (6, Some("root")), "{e}");
    }
    config::parse(
        "[[project]]\nname = \"A\"\nroot = \"x\"\n[[project]]\nname = \"B\"\nroot = \"x\"\nenabled = false\n",
        &file(),
    )
    .expect("a disabled project may share the folder");
}

#[test]
fn config_error_names_file_line_column_and_key() {
    // A syntax error on line 7.
    let text =
        "[hub]\nport = 8200\n\n[[project]]\nname = \"A\"\nroot = \"a\"\ntoken = \"unterminated\n";
    let e = err(text);
    assert_eq!(e.file, file());
    assert_eq!(e.line, 7, "{e}");
    assert!(e.column >= 1);
    assert_eq!(e.key.as_deref(), Some("token"), "{e}");
    let shown = e.to_string();
    assert!(
        shown.starts_with(&format!("{}:7:", file().display())),
        "{shown}"
    );

    let e = err("[hub]\nport = \"eighty\"\n");
    assert_eq!(
        (e.line, e.column, e.key.as_deref()),
        (2, 8, Some("port")),
        "{e}"
    );

    let e = err("[hub]\nprot = 1\n");
    assert_eq!((e.line, e.key.as_deref()), (2, Some("prot")), "{e}");

    let e = err("[hub.tls]\nenabled = true\n");
    assert_eq!(
        (e.line, e.key.as_deref()),
        (2, Some("hub.tls.enabled")),
        "{e}"
    );
}

#[test]
fn config_example_parses() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/lanhub.toml");
    let c = config::load(&example).unwrap();
    assert_eq!(c.projects.len(), 2);
    assert!(!c.projects[1].advertise);
}

#[test]
fn config_unreadable_file_has_no_line() {
    let e = config::load(Path::new("no/such/lanhub.toml")).unwrap_err();
    assert_eq!(e.line, 0);
}
