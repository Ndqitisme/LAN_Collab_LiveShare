//! Edits of `lanhub.toml` from the app, locally or through the admin channel. Each edit re-reads the file, changes only the `[[project]]` table or the
//! `[hub]` keys it is about (comments, key order and keys this version does not know stay as written),
//! validates the result with the same parser the hub uses, and writes it atomically. The caller applies the
//! returned `Config`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::config::{
    self, AdminSettings, Config, ConfigError, HubSettings, ProjectConfig, TlsSettings,
};
use crate::exclude::{DEFAULT_EXCLUDE, Excluder};
use crate::files;
use crate::logs;
use crate::util::{self, random_hex};
use serde::{Deserialize, Serialize};
use toml_edit::{Array, ArrayOfTables, DocumentMut, Item, Table, TableLike, value};

/// The fields the hub settings screen edits. An empty `name` leaves the host name; empty `tls_cert` and
/// `tls_key` mean the self-signed certificate.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubInput {
    pub name: String,
    pub bind: String,
    pub port: u32,
    pub discovery: bool,
    pub discovery_port: u32,
    pub tls: bool,
    pub tls_cert: String,
    pub tls_key: String,
    pub public_address: Vec<String>,
}

/// The fields the project form edits.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    pub root: String,
    pub enabled: bool,
    pub advertise: bool,
}

/// The `[project.history]` limits the History tab edits.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryInput {
    pub idle_minutes: u32,
    pub keep_days: u32,
    pub max_mb: u64,
}

pub const IDLE_MINUTES: std::ops::RangeInclusive<u32> = 1..=1440;
pub const KEEP_DAYS: std::ops::RangeInclusive<u32> = 1..=3650;
pub const MAX_MB: std::ops::RangeInclusive<u64> = 1..=1_048_576;

/// A project of a 0.1 hub folder with the root the admin chose for it.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportInput {
    pub name: String,
    pub root: String,
    pub token: String,
    pub allow: Vec<String>,
}

/// An allow entry is `provider:label` or a bare label, without spaces or `#`. `ui/src/lib/rules.ts` checks
/// the same while typing.
pub fn allow_entry_ok(entry: &str) -> bool {
    if entry.is_empty() || entry.contains(char::is_whitespace) || entry.contains('#') {
        return false;
    }
    match entry.split_once(':') {
        None => true,
        Some((provider, label)) => {
            !provider.is_empty()
                && provider
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                && !label.is_empty()
                && !label.contains(':')
        }
    }
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
            logs::log_in(None, &format!("[LỖI] Không sửa được cấu hình: {e}"));
            AppError::new("configInvalid")
        })
    }

    /// Validates the edited document with the hub's parser, then writes it.
    fn commit(&self, doc: &DocumentMut) -> Result<Config, AppError> {
        let text = doc.to_string();
        let cfg = config::parse(&text, &self.path).map_err(|e| {
            logs::log_in(None, &format!("[LỖI] Cấu hình mới không hợp lệ: {e}"));
            AppError::new("configInvalid")
        })?;
        crate::flush::write_file_atomic(&self.path, text.as_bytes()).map_err(|e| {
            logs::log_in(
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

    /// Writes the `[hub]` keys whose value changes. `check` sees the validated result before anything is
    /// written, so a port that cannot be opened or a certificate that does not load leaves the file as it was.
    pub fn update_hub(
        &self,
        input: &HubInput,
        check: impl FnOnce(&Config) -> Result<(), AppError>,
    ) -> Result<Config, AppError> {
        let (mut doc, cfg) = self.read_for_edit()?;
        let new = validate_hub(input)?;
        let old = &cfg.hub;
        if !doc.contains_key("hub") {
            let mut t = Table::new();
            // Above the `[[project]]` tables, where a hand-written file has it.
            t.set_position(Some(0));
            doc.insert("hub", Item::Table(t));
        }
        let hub_position = doc["hub"].as_table().and_then(Table::position);
        let hub = doc["hub"]
            .as_table_like_mut()
            .ok_or_else(|| AppError::new("configInvalid"))?;
        match new.name.as_deref() {
            None => {
                hub.remove("name");
            }
            Some(n) if old.name.as_deref() != Some(n) => {
                hub.insert("name", value(n));
            }
            Some(_) => {}
        }
        if old.bind != new.bind {
            hub.insert("bind", value(&new.bind));
        }
        if old.port != new.port {
            hub.insert("port", value(i64::from(new.port)));
        }
        if old.discovery != new.discovery {
            hub.insert("discovery", value(new.discovery));
        }
        if old.discovery_port != new.discovery_port {
            hub.insert("discovery_port", value(i64::from(new.discovery_port)));
        }
        if new.public_address.is_empty() {
            hub.remove("public_address");
        } else if old.public_address != new.public_address {
            let list: Array = new.public_address.iter().map(String::as_str).collect();
            hub.insert("public_address", value(list));
        }
        if new.tls != old.tls {
            if !hub.contains_key("tls") {
                let mut t = Table::new();
                // Right after `[hub]`: a child table at its parent's position follows the parent.
                t.set_position(hub_position);
                hub.insert("tls", Item::Table(t));
            }
            let tls = hub
                .get_mut("tls")
                .and_then(Item::as_table_like_mut)
                .ok_or_else(|| AppError::new("configInvalid"))?;
            if old.tls.enabled != new.tls.enabled {
                tls.insert("enabled", value(new.tls.enabled));
            }
            set_path(
                tls,
                "cert",
                old.tls.cert.as_deref(),
                new.tls.cert.as_deref(),
            );
            set_path(tls, "key", old.tls.key.as_deref(), new.tls.key.as_deref());
        }
        let text = doc.to_string();
        let parsed = config::parse(&text, &self.path).map_err(|e| {
            logs::log_in(None, &format!("[LỖI] Cấu hình mới không hợp lệ: {e}"));
            AppError::new("configInvalid")
        })?;
        check(&parsed)?;
        self.commit(&doc)
    }

    /// Changes the project table named `name` with `edit`, then validates and writes the file.
    fn edit_project(&self, name: &str, edit: impl FnOnce(&mut Table)) -> Result<Config, AppError> {
        let (mut doc, cfg) = self.read_for_edit()?;
        let at = position(&cfg, name)?;
        edit(table_at(&mut doc, at)?);
        self.commit(&doc)
    }

    pub fn set_token(&self, name: &str, token: &str) -> Result<Config, AppError> {
        self.edit_project(name, |t| {
            t.insert("token", value(token));
        })
    }

    /// One entry per line as typed; blank lines are dropped. The first invalid line is named, counted from 1.
    pub fn set_allow(&self, name: &str, lines: &[String]) -> Result<Config, AppError> {
        let entries = checked_lines(lines, allow_entry_ok, "allowInvalid", "allow")?;
        self.edit_project(name, |t| {
            if entries.is_empty() {
                t.remove("allow");
            } else {
                t.insert("allow", value(string_array(&entries)));
            }
        })
    }

    pub fn set_exclude(&self, name: &str, lines: &[String]) -> Result<Config, AppError> {
        let patterns = checked_lines(
            lines,
            |p| !p.chars().any(char::is_control),
            "excludeInvalid",
            "exclude",
        )?;
        self.edit_project(name, |t| {
            if patterns.is_empty() {
                t.remove("exclude");
            } else {
                t.insert("exclude", value(string_array(&patterns)));
            }
        })
    }

    /// Writes the limits into `[project.history]`, keeping `enabled` and anything else written there.
    pub fn set_history(&self, name: &str, h: &HistoryInput) -> Result<Config, AppError> {
        if !IDLE_MINUTES.contains(&h.idle_minutes) {
            return Err(range_error(
                "idleMinutes",
                IDLE_MINUTES.start(),
                IDLE_MINUTES.end(),
            ));
        }
        if !KEEP_DAYS.contains(&h.keep_days) {
            return Err(range_error("keepDays", KEEP_DAYS.start(), KEEP_DAYS.end()));
        }
        if !MAX_MB.contains(&h.max_mb) {
            return Err(range_error("maxMb", MAX_MB.start(), MAX_MB.end()));
        }
        self.edit_project(name, |t| {
            // `[project.history]` or an inline `history = { .. }`: either way its other keys stay.
            if !t.get("history").is_some_and(Item::is_table_like) {
                t.insert("history", Item::Table(Table::new()));
            }
            let history = t["history"]
                .as_table_like_mut()
                .expect("a table was just put here");
            history.insert("idle_minutes", value(i64::from(h.idle_minutes)));
            history.insert("keep_days", value(i64::from(h.keep_days)));
            history.insert("max_mb", value(h.max_mb as i64));
        })
    }

    /// Adds each project unless one of its name exists, in one write. Returns the names added.
    pub fn import_projects(
        &self,
        items: &[ImportInput],
    ) -> Result<(Config, Vec<String>), AppError> {
        let (mut doc, mut cfg) = self.read_for_edit()?;
        let mut added = Vec::new();
        for item in items {
            let name = item.name.trim();
            if cfg
                .projects
                .iter()
                .any(|p| p.name.to_lowercase() == name.to_lowercase())
            {
                continue;
            }
            let input = ProjectInput {
                name: name.to_owned(),
                root: item.root.clone(),
                enabled: true,
                advertise: true,
            };
            let (name, root) =
                validate(&cfg, &input, None).map_err(|e| e.param("project", name))?;
            // Kept as the 0.1 file had them, even entries the editor would mark: dropping one could turn a
            // closed project into one any token holder joins.
            let allow: Vec<String> = item
                .allow
                .iter()
                .map(|a| a.trim().to_owned())
                .filter(|a| !a.is_empty())
                .collect();
            let mut t = Table::new();
            t.insert("name", value(&name));
            t.insert("root", value(root));
            t.insert("enabled", value(true));
            t.insert("token", value(item.token.trim()));
            if !allow.is_empty() {
                t.insert("allow", value(string_array(&allow)));
            }
            t.insert("advertise", value(true));
            projects_mut(&mut doc)?.push(t);
            cfg = config::parse(&doc.to_string(), &self.path).map_err(|e| {
                logs::log_in(None, &format!("[LỖI] Cấu hình nhập không hợp lệ: {e}"));
                AppError::new("configInvalid")
            })?;
            added.push(name);
        }
        if added.is_empty() {
            return Ok((cfg, added));
        }
        Ok((self.commit(&doc)?, added))
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

/// The `[hub]` settings as the hub settings screen shows them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubSettingsView {
    pub name: String,
    /// What the hub calls itself while `name` is empty.
    pub hostname: String,
    pub bind: String,
    pub port: u16,
    pub discovery: bool,
    pub discovery_port: u16,
    pub tls: bool,
    pub tls_cert: String,
    pub tls_key: String,
    pub public_address: Vec<String>,
    /// SHA-256 of the certificate the hub serves; `None` while TLS is off.
    pub fingerprint: Option<String>,
}

impl HubSettingsView {
    pub fn new(hub: &HubSettings, fingerprint: Option<String>) -> HubSettingsView {
        let path = |p: &Option<PathBuf>| {
            p.as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        HubSettingsView {
            name: hub.name.clone().unwrap_or_default(),
            hostname: util::hostname(),
            bind: hub.bind.clone(),
            port: hub.port,
            discovery: hub.discovery,
            discovery_port: hub.discovery_port,
            tls: hub.tls.enabled,
            tls_cert: path(&hub.tls.cert),
            tls_key: path(&hub.tls.key),
            public_address: hub.public_address.clone(),
            fingerprint,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InviteView {
    pub name: String,
    pub code: String,
}

/// Files an exclude preview lists at most; the total is counted in full.
pub const PREVIEW_MAX: usize = 200;

/// What the project screens edit, as the hub runs it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub token: String,
    pub allow: Vec<String>,
    /// A 0.1 allow file the hub also reads on every join.
    pub allow_file: Option<PathBuf>,
    pub exclude: Vec<String>,
    pub default_exclude: Vec<String>,
    pub history_enabled: bool,
    pub history: HistoryInput,
}

impl ProjectSettings {
    /// The settings of the project named `name` (ignoring case) in `cfg`.
    pub fn of(cfg: &Config, name: &str) -> Result<ProjectSettings, AppError> {
        let p = project_config(cfg, name)?;
        Ok(ProjectSettings {
            token: p.token.clone(),
            allow: p.allow.clone(),
            allow_file: p.allow_file.clone(),
            exclude: p.exclude.clone(),
            default_exclude: DEFAULT_EXCLUDE.iter().map(|s| (*s).to_owned()).collect(),
            history_enabled: p.history.enabled,
            history: HistoryInput {
                idle_minutes: p.history.idle_minutes,
                keep_days: p.history.keep_days,
                max_mb: p.history.max_mb,
            },
        })
    }
}

/// The project named `name` (ignoring case) in `cfg`.
pub fn project_config<'a>(cfg: &'a Config, name: &str) -> Result<&'a ProjectConfig, AppError> {
    let key = name.trim().to_lowercase();
    cfg.projects
        .iter()
        .find(|p| p.name.to_lowercase() == key)
        .ok_or_else(|| AppError::new("unknownProject").param("name", name))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcludePreview {
    /// The first `PREVIEW_MAX` matching files, sorted.
    pub files: Vec<String>,
    pub total: usize,
    /// Files the project would sync with only the default patterns.
    pub scanned: usize,
}

/// The files under `root` that `lines` would stop syncing, among those the default patterns leave in.
/// Walks the folder: call it off the async threads.
pub fn exclude_preview(root: &Path, lines: &[String]) -> Result<ExcludePreview, AppError> {
    if !root.is_dir() {
        return Err(AppError::field("rootMissing", "root"));
    }
    let synced = files::walk(root, &Excluder::new(DEFAULT_EXCLUDE));
    let extra = Excluder::new(lines);
    let mut matched: Vec<String> = synced
        .iter()
        .map(|(rel, _)| rel)
        .filter(|rel| extra.is_excluded(rel))
        .cloned()
        .collect();
    matched.sort();
    let total = matched.len();
    matched.truncate(PREVIEW_MAX);
    Ok(ExcludePreview {
        files: matched,
        total,
        scanned: synced.len(),
    })
}

/// Refuses settings that the running hub would only log and skip: a port it cannot open, a certificate it
/// cannot load. `running` is the `[hub]` the hub runs now; unchanged parts are not checked again.
pub fn check_hub(new: &HubSettings, running: Option<&HubSettings>) -> Result<(), AppError> {
    let moved = running.is_none_or(|r| r.bind != new.bind || r.port != new.port);
    if moved && let Err(e) = std::net::TcpListener::bind((new.bind.as_str(), new.port)) {
        logs::log_in(
            None,
            &format!("[LỖI] Không mở được {}:{}: {e}", new.bind, new.port),
        );
        return Err(AppError::field("portBusy", "port").param("port", new.port.to_string()));
    }
    let tls_changed = running.is_none_or(|r| r.tls != new.tls || r.state_dir != new.state_dir);
    if new.tls.enabled
        && tls_changed
        && let Err(e) = crate::tls::load_or_create(&new.tls, new.state_dir.as_deref())
    {
        logs::log_in(None, &format!("[LỖI] Không bật được TLS: {e}"));
        return Err(AppError::field("tlsFailed", "tls"));
    }
    Ok(())
}

/// Writes `new` unless it names the folder already written; removes the key for `None`.
fn set_path(t: &mut dyn TableLike, key: &str, old: Option<&Path>, new: Option<&Path>) {
    match (old, new) {
        (_, None) => {
            t.remove(key);
        }
        (Some(o), Some(n)) if config::same_path(o, n) => {}
        (_, Some(n)) => {
            t.insert(key, value(n.to_string_lossy().as_ref()));
        }
    }
}

/// The settings `input` asks for, or the first problem, named by field.
fn validate_hub(input: &HubInput) -> Result<HubSettings, AppError> {
    let name = input.name.trim();
    if name.chars().any(char::is_control) {
        return Err(AppError::field("hubNameControl", "name"));
    }
    let bind = input.bind.trim();
    if bind.parse::<std::net::IpAddr>().is_err() {
        return Err(AppError::field("bindInvalid", "bind"));
    }
    let port = |v: u32, field: &'static str| {
        u16::try_from(v)
            .ok()
            .filter(|&p| p > 0)
            .ok_or_else(|| AppError::field("portInvalid", field))
    };
    let tcp = port(input.port, "port")?;
    let udp = port(input.discovery_port, "discoveryPort")?;
    let mut public_address: Vec<String> = Vec::new();
    for a in input.public_address.iter().map(|a| a.trim()) {
        if a.is_empty() {
            continue;
        }
        // The rule of `config::parse`: one colon is a port, and the invite carries its own.
        if a.contains(char::is_whitespace) || a.contains('/') || a.matches(':').count() == 1 {
            return Err(AppError::field("publicAddressInvalid", "publicAddress").param("value", a));
        }
        if !public_address.iter().any(|p| p.eq_ignore_ascii_case(a)) {
            public_address.push(a.to_owned());
        }
    }
    let file = |p: &str| -> Result<Option<PathBuf>, AppError> {
        let p = p.trim();
        if p.is_empty() {
            return Ok(None);
        }
        let path = Path::new(p);
        if !path.is_absolute() || !path.is_file() {
            return Err(AppError::field("tlsFileMissing", "tls").param("path", p));
        }
        Ok(Some(config::normalize(path)))
    };
    let (cert, key) = (file(&input.tls_cert)?, file(&input.tls_key)?);
    if cert.is_some() != key.is_some() {
        return Err(AppError::field("tlsPair", "tls"));
    }
    Ok(HubSettings {
        name: (!name.is_empty()).then(|| name.to_owned()),
        bind: bind.to_owned(),
        port: tcp,
        discovery: input.discovery,
        discovery_port: udp,
        public_address,
        tls: TlsSettings {
            enabled: input.tls,
            cert,
            key,
        },
        admin: AdminSettings::default(),
        state_dir: None,
    })
}

/// The trimmed non-blank lines, or the first that fails `ok`, numbered from 1 as the editor shows it.
fn checked_lines(
    lines: &[String],
    ok: impl Fn(&str) -> bool,
    code: &'static str,
    field: &'static str,
) -> Result<Vec<String>, AppError> {
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if !ok(line) {
            return Err(AppError::field(code, field).param("line", (i + 1).to_string()));
        }
        out.push(line.to_owned());
    }
    Ok(out)
}

fn string_array(items: &[String]) -> toml_edit::Array {
    items.iter().map(String::as_str).collect()
}

fn range_error<T: ToString>(field: &'static str, min: &T, max: &T) -> AppError {
    AppError::field("outOfRange", field)
        .param("min", min.to_string())
        .param("max", max.to_string())
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
