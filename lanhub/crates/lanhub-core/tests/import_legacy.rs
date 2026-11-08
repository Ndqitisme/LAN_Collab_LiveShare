//! Reading a 0.1 hub folder: `token-<project>.txt`, `allowed-accounts-<project>.txt` and the roots of its
//! `.bat` launchers.

use std::path::{Path, PathBuf};

use lanhub_core::admin::{LegacyProject, scan_legacy};

fn folder() -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "lanhub-import-legacy-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn write(dir: &Path, name: &str, text: &str) {
    std::fs::write(dir.join(name), text).unwrap();
}

/// Two projects as two copies of the 0.1 `start-hub.bat` leave them: Web with an allow file, Api without.
fn hub_folder() -> PathBuf {
    let d = folder();
    write(&d, "token-Web.txt", "a1b2c3d4e5f6a7b8c9d0e1f2");
    write(
        &d,
        "allowed-accounts-Web.txt",
        "# One account per line: github:username or microsoft:email\r\ngithub:Alice\r\n\r\nmicrosoft:bob@example.com # lead\r\n",
    );
    write(&d, "token-Api.txt", "  0f0e0d0c0b0a090807060504 \r\n\n");
    write(
        &d,
        "start-hub.bat",
        "@echo off\r\nset \"PROJECT=Web\"\r\nset \"ROOT=D:\\lan-collab\\workspaces\\Web\"\r\nset \"PORT=8200\"\r\n",
    );
    write(
        &d,
        "start-hub-api.bat",
        "set \"PROJECT=Other\"\r\nset \"ROOT=D:\\x\"\r\n",
    );
    write(&d, "token-.txt", "orphan");
    write(&d, "token-Empty.txt", " \n");
    write(&d, "notes.txt", "token-Web.txt");
    d
}

#[test]
fn import_legacy_reads_two_projects_with_tokens_allow_lists_and_roots() {
    let d = hub_folder();
    let found = scan_legacy(&d, &[]).unwrap();
    assert_eq!(
        found,
        vec![
            LegacyProject {
                name: "Api".into(),
                token: "0f0e0d0c0b0a090807060504".into(),
                allow: vec![],
                root: None,
                exists: false,
            },
            LegacyProject {
                name: "Web".into(),
                token: "a1b2c3d4e5f6a7b8c9d0e1f2".into(),
                allow: vec!["github:alice".into(), "microsoft:bob@example.com".into()],
                root: Some(PathBuf::from(r"D:\lan-collab\workspaces\Web")),
                exists: false,
            },
        ]
    );
}

#[test]
fn import_legacy_missing_allow_file_gives_an_empty_list() {
    let d = folder();
    write(&d, "token-Solo.txt", "abc");
    let found = scan_legacy(&d, &[]).unwrap();
    assert_eq!(found.len(), 1);
    assert!(found[0].allow.is_empty());
}

#[test]
fn import_legacy_trims_trailing_whitespace_of_the_token() {
    let d = folder();
    write(&d, "token-P.txt", "deadbeef\r\n   \t");
    assert_eq!(scan_legacy(&d, &[]).unwrap()[0].token, "deadbeef");
}

#[test]
fn import_legacy_twice_marks_every_project_as_existing() {
    let d = hub_folder();
    let first = scan_legacy(&d, &["Other".into()]).unwrap();
    assert!(first.iter().all(|p| !p.exists));
    let imported: Vec<String> = first.iter().map(|p| p.name.clone()).collect();
    let again = scan_legacy(&d, &imported).unwrap();
    assert_eq!(again.len(), 2);
    assert!(again.iter().all(|p| p.exists), "{again:?}");
    let upper: Vec<String> = imported.iter().map(|n| n.to_uppercase()).collect();
    assert!(scan_legacy(&d, &upper).unwrap().iter().all(|p| p.exists));
}

#[test]
fn import_legacy_missing_folder_is_an_error() {
    assert!(scan_legacy(Path::new(r"Z:\no\such\lanhub\folder"), &[]).is_err());
}
