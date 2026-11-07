//! Edits of `lanhub.toml` from the UI. Each edit re-reads the file, changes only the `[[project]]` table it is
//! about (comments, key order and keys this version does not know stay as written), validates the result
//! with the same parser the hub uses, and writes it atomically. The caller applies the returned `Config`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use lanhub_core::config::{self, Config, ConfigError};
use lanhub_core::util::random_hex;
use serde::{Deserialize, Serialize};
use toml_edit::{ArrayOfTables, DocumentMut, Item, Table, value};

/// The fields the project form edits.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    pub root: String,
    pub enabled: bool,
    pub advertise: bool,
}

/// An error the UI shows: `code` is a key under `errors` in `vi.json`, `field` names the form field it
/// belongs to, `params` fill the placeholders.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: &'static str,
    pub field: Option<&'static str>,
    pub params: BTreeMap<String, String>,
}

impl AppError {
    pub fn new(code: &'static str) -> AppError {
        AppError {
            code,
            field: None,
            params: BTreeMap::new(),
        }
    }

    pub fn field(code: &'static str, field: &'static str) -> AppError {
        AppError {
            field: Some(field),
            ..AppError::new(code)
        }
    }

    pub fn param(mut self, key: &str, val: impl Into<String>) -> AppError {
        self.params.insert(key.to_owned(), val.into());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code)?;
        for (k, v) in &self.params {
            write!(f, " {k}={v}")?;
        }
        Ok(())
    }
}

pub struct ConfigFile {
    path: PathBuf,
}

impl ConfigFile {
    pub fn new(path: PathBuf) -> ConfigFile {
        ConfigFile { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The config in the file; a missing file is a hub with default settings and no project.
    pub fn load(&self) -> Result<Config, ConfigError> {
        self.read().map(|(_, cfg)| cfg)
    }

    fn read(&self) -> Result<(DocumentMut, Config), ConfigError> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => {
                return Err(ConfigError {
                    file: self.path.clone(),
                    line: 0,
                    column: 0,
                    key: None,
                    message: e.to_string(),
                });
            }
        };
        let cfg = config::parse(&text, &self.path)?;
        let doc = text.parse::<DocumentMut>().map_err(|e| ConfigError {
            file: self.path.clone(),
            line: 0,
            column: 0,
            key: None,
            message: e.to_string(),
        })?;
        Ok((doc, cfg))
    }

    fn read_for_edit(&self) -> Result<(DocumentMut, Config), AppError> {
        self.read().map_err(|e| {
            lanhub_core::logs::log_in(None, &format!("[LỖI] Không sửa được cấu hình: {e}"));
            AppError::new("configInvalid")
        })
    }

    /// Validates the edited document with the hub's parser, then writes it.
    fn commit(&self, doc: &DocumentMut) -> Result<Config, AppError> {
        let text = doc.to_string();
        let cfg = config::parse(&text, &self.path).map_err(|e| {
            lanhub_core::logs::log_in(None, &format!("[LỖI] Cấu hình mới không hợp lệ: {e}"));
            AppError::new("configInvalid")
        })?;
        lanhub_core::flush::write_file_atomic(&self.path, text.as_bytes()).map_err(|e| {
            lanhub_core::logs::log_in(
                None,
                &format!("[LỖI] Không ghi được {}: {e}", self.path.display()),
            );
            AppError::new("writeFailed").param("path", self.path.display().to_string())
        })?;
        Ok(cfg)
    }

    pub fn add_project(&self, input: &ProjectInput) -> Result<Config, AppError> {
        let (mut doc, cfg) = self.read_for_edit()?;
        let (name, root) = validate(&cfg, input, None)?;
        let mut t = Table::new();
        t.insert("name", value(name));
        t.insert("root", value(root));
        t.insert("enabled", value(input.enabled));
        t.insert("token", value(random_hex::<16>()));
        t.insert("advertise", value(input.advertise));
        projects_mut(&mut doc)?.push(t);
        self.commit(&doc)
    }

    /// Changes the project named `original` (ignoring case). Its token and the keys the form does not show
    /// stay as they are.
    pub fn update_project(&self, original: &str, input: &ProjectInput) -> Result<Config, AppError> {
        let (mut doc, cfg) = self.read_for_edit()?;
        let at = position(&cfg, original)?;
        let (name, root) = validate(&cfg, input, Some(at))?;
        let t = table_at(&mut doc, at)?;
        set_if_changed(t, "name", &name);
        let written_root = cfg.projects[at].root.to_string_lossy().into_owned();
        if !config::same_path(Path::new(&written_root), Path::new(&root)) {
            t.insert("root", value(root));
        }
        t.insert("enabled", value(input.enabled));
        t.insert("advertise", value(input.advertise));
        self.commit(&doc)
    }

    pub fn set_enabled(&self, name: &str, enabled: bool) -> Result<Config, AppError> {
        let (mut doc, cfg) = self.read_for_edit()?;
        let at = position(&cfg, name)?;
        if enabled {
            let p = &cfg.projects[at];
            if let Some(o) = cfg
                .projects
                .iter()
                .enumerate()
                .find(|(i, o)| *i != at && o.enabled && config::same_path(&o.root, &p.root))
                .map(|(_, o)| o)
            {
                return Err(AppError::field("rootTaken", "root").param("name", &o.name));
            }
        }
        table_at(&mut doc, at)?.insert("enabled", value(enabled));
        self.commit(&doc)
    }

    pub fn remove_project(&self, name: &str) -> Result<Config, AppError> {
        let (mut doc, cfg) = self.read_for_edit()?;
        let at = position(&cfg, name)?;
        projects_mut(&mut doc)?.remove(at);
        if projects_mut(&mut doc)?.is_empty() {
            doc.remove("project");
        }
        self.commit(&doc)
    }
}

/// Keeps the written form (quotes, case) when only the surrounding spaces would change.
fn set_if_changed(t: &mut Table, key: &str, new: &str) {
    if t.get(key).and_then(Item::as_str).map(str::trim) != Some(new) {
        t.insert(key, value(new));
    }
}

fn position(cfg: &Config, name: &str) -> Result<usize, AppError> {
    let key = name.trim().to_lowercase();
    cfg.projects
        .iter()
        .position(|p| p.name.to_lowercase() == key)
        .ok_or_else(|| AppError::new("unknownProject").param("name", name))
}

fn projects_mut(doc: &mut DocumentMut) -> Result<&mut ArrayOfTables, AppError> {
    if !doc.contains_key("project") {
        doc.insert("project", Item::ArrayOfTables(ArrayOfTables::new()));
    }
    doc["project"]
        .as_array_of_tables_mut()
        .ok_or_else(|| AppError::new("configInvalid"))
}

/// The parser keeps `[[project]]` order, so index `at` of the config is table `at` of the document.
fn table_at(doc: &mut DocumentMut, at: usize) -> Result<&mut Table, AppError> {
    projects_mut(doc)?
        .get_mut(at)
        .ok_or_else(|| AppError::new("configInvalid"))
}

/// The trimmed name and the absolute root to write, or the first problem, named by field.
fn validate(
    cfg: &Config,
    input: &ProjectInput,
    editing: Option<usize>,
) -> Result<(String, String), AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::field("nameEmpty", "name"));
    }
    if name.chars().any(char::is_control) {
        return Err(AppError::field("nameControl", "name"));
    }
    let others = || {
        cfg.projects
            .iter()
            .enumerate()
            .filter(move |(i, _)| Some(*i) != editing)
            .map(|(_, p)| p)
    };
    if let Some(o) = others().find(|o| o.name.to_lowercase() == name.to_lowercase()) {
        return Err(AppError::field("nameDuplicate", "name").param("name", &o.name));
    }
    let root = input.root.trim();
    if root.is_empty() {
        return Err(AppError::field("rootEmpty", "root"));
    }
    let path = Path::new(root);
    if !path.is_absolute() {
        return Err(AppError::field("rootRelative", "root"));
    }
    if !path.is_dir() {
        return Err(AppError::field("rootMissing", "root"));
    }
    let path = config::normalize(path);
    if input.enabled
        && let Some(o) = others().find(|o| o.enabled && config::same_path(&o.root, &path))
    {
        return Err(AppError::field("rootTaken", "root").param("name", &o.name));
    }
    Ok((name.to_owned(), path.to_string_lossy().into_owned()))
}
