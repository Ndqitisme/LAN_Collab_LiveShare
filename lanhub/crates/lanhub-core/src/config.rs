//! `lanhub.toml` (plan README section 5.5), parsed into typed settings. Every value the hub runs on comes
//! from a `Config`: the single-project CLI flags build one in memory. Relative paths are taken from the
//! folder of the file.

use std::fmt;
use std::ops::Range;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use toml::Spanned;

pub const FILE_NAME: &str = "lanhub.toml";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Config {
    pub hub: HubSettings,
    pub projects: Vec<ProjectConfig>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HubSettings {
    /// `hubName`; the host name when unset.
    pub name: Option<String>,
    pub bind: String,
    pub port: u16,
    pub discovery: bool,
    pub discovery_port: u16,
    /// Read for A6 (invite addresses); nothing uses it yet.
    pub public_address: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectConfig {
    pub name: String,
    /// Absolute.
    pub root: PathBuf,
    pub enabled: bool,
    pub token: String,
    /// Entries as written; `allow::entries` rules apply when they are judged.
    pub allow: Vec<String>,
    /// A 0.1 allow file, read on every hello like `--allow-file`. Its entries add to `allow`.
    pub allow_file: Option<PathBuf>,
    pub exclude: Vec<String>,
    pub advertise: bool,
    pub history: HistorySettings,
    /// `--history` of the single-project flags; `<root>/.lan-collab/history` otherwise.
    #[serde(skip)]
    pub history_dir: Option<PathBuf>,
    #[serde(skip)]
    pub debug: DebugHooks,
}

/// Edit-run history (`history` module). Limits apply to a running project; `enabled` restarts it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct HistorySettings {
    pub enabled: bool,
    pub idle_minutes: u32,
    pub keep_days: u32,
    pub max_mb: u64,
    /// `--history-idle-ms`, for tests: replaces `idle_minutes`.
    #[serde(skip)]
    pub idle_ms: Option<u64>,
}

impl Default for HistorySettings {
    fn default() -> Self {
        HistorySettings {
            enabled: true,
            idle_minutes: 15,
            keep_days: 30,
            max_mb: 2048,
            idle_ms: None,
        }
    }
}

impl HistorySettings {
    pub fn idle_ms(&self) -> u64 {
        self.idle_ms
            .unwrap_or(u64::from(self.idle_minutes) * 60_000)
    }
}

/// Test hooks, honoured by debug builds only.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DebugHooks {
    /// A message about this path panics inside its handler; the actor recovers.
    pub panic_path: Option<String>,
    /// A message about this path panics in the actor loop, ending the actor.
    pub crash_path: Option<String>,
}

impl ProjectConfig {
    pub fn new(name: impl Into<String>, root: impl Into<PathBuf>) -> ProjectConfig {
        ProjectConfig {
            name: name.into(),
            root: root.into(),
            enabled: true,
            token: String::new(),
            allow: Vec::new(),
            allow_file: None,
            exclude: Vec::new(),
            advertise: true,
            history: HistorySettings::default(),
            history_dir: None,
            debug: DebugHooks::default(),
        }
    }
}

impl Default for HubSettings {
    fn default() -> Self {
        HubSettings {
            name: None,
            bind: "0.0.0.0".to_owned(),
            port: 8200,
            discovery: true,
            discovery_port: crate::discovery::DEFAULT_PORT,
            public_address: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigError {
    pub file: PathBuf,
    /// 1-based; 0 when the error is not about a place in the file (it could not be read).
    pub line: usize,
    pub column: usize,
    pub key: Option<String>,
    pub message: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.file.display())?;
        if self.line > 0 {
            write!(f, ":{}:{}", self.line, self.column)?;
        }
        if let Some(k) = &self.key {
            write!(f, ": `{k}`")?;
        }
        write!(f, ": {}", self.message)
    }
}

impl std::error::Error for ConfigError {}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConfig {
    #[serde(default)]
    hub: RawHub,
    #[serde(default)]
    project: Vec<RawProject>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, default)]
struct RawHub {
    name: Option<String>,
    bind: String,
    port: u16,
    discovery: bool,
    discovery_port: u16,
    tls: RawTls,
    public_address: Vec<String>,
}

impl Default for RawHub {
    fn default() -> Self {
        let d = HubSettings::default();
        RawHub {
            name: d.name,
            bind: d.bind,
            port: d.port,
            discovery: d.discovery,
            discovery_port: d.discovery_port,
            tls: RawTls::default(),
            public_address: d.public_address,
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct RawTls {
    enabled: Option<Spanned<bool>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProject {
    name: Spanned<String>,
    root: Spanned<String>,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default)]
    token: String,
    #[serde(default)]
    allow: Vec<String>,
    #[serde(default)]
    allow_file: Option<String>,
    #[serde(default)]
    exclude: Vec<String>,
    #[serde(default = "yes")]
    advertise: bool,
    #[serde(default)]
    history: HistorySettings,
}

/// `%APPDATA%\LanHub\lanhub.toml` on Windows, `$XDG_CONFIG_HOME/lanhub/lanhub.toml` (else
/// `~/.config/lanhub/lanhub.toml`) elsewhere.
pub fn default_path() -> Option<PathBuf> {
    let env = |k: &str| {
        std::env::var_os(k)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    if cfg!(windows) {
        return env("APPDATA").map(|d| d.join("LanHub").join(FILE_NAME));
    }
    env("XDG_CONFIG_HOME")
        .or_else(|| env("HOME").map(|h| h.join(".config")))
        .map(|d| d.join("lanhub").join(FILE_NAME))
}

pub fn load(file: &Path) -> Result<Config, ConfigError> {
    let text = std::fs::read_to_string(file).map_err(|e| ConfigError {
        file: file.to_owned(),
        line: 0,
        column: 0,
        key: None,
        message: e.to_string(),
    })?;
    parse(&text, file)
}

/// 1-based line and column (in characters) of a byte offset.
fn line_col(text: &str, at: usize) -> (usize, usize) {
    let at = at.min(text.len());
    let before = &text[..at];
    let line = before.matches('\n').count() + 1;
    let start = before.rfind('\n').map_or(0, |i| i + 1);
    (line, before[start..].chars().count() + 1)
}

/// The key a message names (``missing field `root` ``), else the key written on the error's line.
fn key_of(text: &str, at: usize, message: &str) -> Option<String> {
    let names_key = ["missing field", "unknown field", "duplicate key"]
        .iter()
        .any(|p| message.starts_with(p));
    if names_key
        && let Some(rest) = message.split_once('`').map(|(_, r)| r)
        && let Some((k, _)) = rest.split_once('`')
    {
        return Some(k.to_owned());
    }
    let at = at.min(text.len());
    let start = text[..at].rfind('\n').map_or(0, |i| i + 1);
    let line = text[start..].lines().next().unwrap_or("");
    let (k, _) = line.split_once('=')?;
    let k = k.trim();
    (!k.is_empty() && !k.starts_with('[')).then(|| k.to_owned())
}

pub fn parse(text: &str, file: &Path) -> Result<Config, ConfigError> {
    let err = |span: Option<Range<usize>>, key: Option<String>, message: String| {
        let (line, column) = span.map_or((0, 0), |s| line_col(text, s.start));
        ConfigError {
            file: file.to_owned(),
            line,
            column,
            key,
            message,
        }
    };
    let raw: RawConfig = toml::from_str(text).map_err(|e| {
        let message = e.message().trim().to_owned();
        let key = e.span().and_then(|s| key_of(text, s.start, &message));
        err(e.span(), key, message)
    })?;
    if let Some(tls) = &raw.hub.tls.enabled
        && *tls.get_ref()
    {
        return Err(err(
            Some(tls.span()),
            Some("hub.tls.enabled".into()),
            "TLS is not available in this version of the hub".into(),
        ));
    }
    let dir = file.parent().unwrap_or(Path::new("."));
    let resolve = |p: &str| -> PathBuf {
        let p = Path::new(p);
        let joined = if p.is_absolute() {
            p.to_owned()
        } else {
            dir.join(p)
        };
        normalize(&std::path::absolute(&joined).unwrap_or(joined))
    };
    let mut projects: Vec<ProjectConfig> = Vec::with_capacity(raw.project.len());
    let mut spans: Vec<(Range<usize>, Range<usize>)> = Vec::new();
    for p in raw.project {
        let name = p.name.get_ref().trim().to_owned();
        if name.is_empty() {
            return Err(err(
                Some(p.name.span()),
                Some("name".into()),
                "a project needs a name".into(),
            ));
        }
        if let Some(i) = projects
            .iter()
            .position(|o| o.name.to_lowercase() == name.to_lowercase())
        {
            let (first, _) = line_col(text, spans[i].0.start);
            return Err(err(
                Some(p.name.span()),
                Some("name".into()),
                format!(
                    "project \"{name}\" is already defined on line {first} (names ignore case)"
                ),
            ));
        }
        if p.root.get_ref().trim().is_empty() {
            return Err(err(
                Some(p.root.span()),
                Some("root".into()),
                "a project needs a root folder".into(),
            ));
        }
        let root = resolve(p.root.get_ref());
        if p.enabled
            && let Some(i) = projects
                .iter()
                .position(|o| o.enabled && same_path(&o.root, &root))
        {
            return Err(err(
                Some(p.root.span()),
                Some("root".into()),
                format!(
                    "project \"{}\" already serves this folder",
                    projects[i].name
                ),
            ));
        }
        spans.push((p.name.span(), p.root.span()));
        projects.push(ProjectConfig {
            name,
            root,
            enabled: p.enabled,
            token: p.token,
            allow: p.allow,
            allow_file: p.allow_file.as_deref().map(resolve),
            exclude: p.exclude,
            advertise: p.advertise,
            history: p.history,
            history_dir: None,
            debug: DebugHooks::default(),
        });
    }
    let h = raw.hub;
    Ok(Config {
        hub: HubSettings {
            name: h.name.filter(|n| !n.is_empty()),
            bind: h.bind,
            port: h.port,
            discovery: h.discovery,
            discovery_port: h.discovery_port,
            public_address: h.public_address,
        },
        projects,
    })
}

/// Drops `.`, `..` (lexically) and trailing separators, so one folder written two ways compares equal.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            c => out.push(c),
        }
    }
    out
}

/// Folder names ignore case on Windows.
pub fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}
