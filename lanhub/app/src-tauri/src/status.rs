//! The status view: one snapshot of the hub and its projects, sampled every 500 ms (sooner after a project
//! event, never more often) and pushed to the UI only when it differs from the last one.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use lanhub_core::registry::ProjectState;
use lanhub_core::util;
use serde::Serialize;

use crate::service::Inputs;

pub const EVERY: Duration = Duration::from_millis(500);
const RATE_WINDOW: Duration = Duration::from_secs(10);
const ADDRESSES_EVERY: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub hub: HubView,
    pub projects: Vec<ProjectView>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HubState {
    Starting,
    Running,
    BindError,
    ConfigError,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubView {
    pub state: HubState,
    pub bind: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub config_path: PathBuf,
    pub config_line: Option<usize>,
    pub config_message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ViewState {
    Starting,
    Running,
    Disabled,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub name: String,
    pub root: PathBuf,
    pub state: ViewState,
    pub enabled: bool,
    pub advertise: bool,
    pub error: Option<String>,
    pub root_missing: bool,
    pub files: Option<usize>,
    pub clients: usize,
    /// Operations per second over the last 10 seconds, to one decimal.
    pub rate: f64,
    pub last_activity: Option<u64>,
    pub started_at: Option<u64>,
}

/// Counter samples of one run of one project.
struct Ring {
    started_at: Option<u64>,
    samples: VecDeque<(Instant, u64)>,
}

#[derive(Default)]
pub struct Sampler {
    rings: HashMap<String, Ring>,
    addresses: Option<(Instant, Vec<String>)>,
}

impl Sampler {
    fn rate(&mut self, name: &str, started_at: Option<u64>, ops: u64, now: Instant) -> f64 {
        let ring = self
            .rings
            .entry(name.to_lowercase())
            .or_insert_with(|| Ring {
                started_at,
                samples: VecDeque::new(),
            });
        if ring.started_at != started_at {
            ring.started_at = started_at;
            ring.samples.clear();
        }
        ring.samples.push_back((now, ops));
        while ring
            .samples
            .front()
            .is_some_and(|(t, _)| now.duration_since(*t) > RATE_WINDOW)
        {
            ring.samples.pop_front();
        }
        let (t0, ops0) = ring.samples.front().copied().unwrap_or((now, ops));
        let span = now.duration_since(t0).as_secs_f64();
        if span < EVERY.as_secs_f64() / 2.0 {
            return 0.0;
        }
        ((ops.saturating_sub(ops0)) as f64 / span * 10.0).round() / 10.0
    }

    fn addresses(&mut self, now: Instant) -> Vec<String> {
        match &self.addresses {
            Some((at, list)) if now.duration_since(*at) < ADDRESSES_EVERY => list.clone(),
            _ => {
                let list: Vec<String> = util::ipv4_addresses()
                    .iter()
                    .map(ToString::to_string)
                    .collect();
                self.addresses = Some((now, list.clone()));
                list
            }
        }
    }

    pub fn snapshot(&mut self, inputs: Inputs, config_path: PathBuf) -> Snapshot {
        let now = Instant::now();
        let configured_port = inputs.config.as_ref().map_or(0, |c| c.hub.port);
        let state = if inputs.config_error.is_some() {
            HubState::ConfigError
        } else if inputs.bind_error.is_some() {
            HubState::BindError
        } else if inputs.statuses.is_some() {
            HubState::Running
        } else {
            HubState::Starting
        };
        let hub = HubView {
            state,
            bind: inputs
                .config
                .as_ref()
                .map_or_else(String::new, |c| c.hub.bind.clone()),
            port: inputs.port.or(inputs.bind_error).unwrap_or(configured_port),
            addresses: self.addresses(now),
            config_path,
            config_line: inputs
                .config_error
                .as_ref()
                .map(|e| e.line)
                .filter(|&l| l > 0),
            config_message: inputs.config_error.as_ref().map(|e| e.message.clone()),
        };
        let projects: Vec<ProjectView> = match inputs.statuses {
            Some(list) => list
                .into_iter()
                .map(|s| {
                    let state = match s.state {
                        ProjectState::Running => ViewState::Running,
                        ProjectState::Disabled => ViewState::Disabled,
                        ProjectState::Failed => ViewState::Failed,
                    };
                    let rate = self.rate(&s.name, s.started_at, s.ops, now);
                    ProjectView {
                        root_missing: state == ViewState::Failed && !s.root.is_dir(),
                        enabled: state != ViewState::Disabled,
                        name: s.name,
                        root: s.root,
                        state,
                        advertise: s.advertise,
                        error: s.error,
                        files: s.files,
                        clients: s.clients,
                        rate,
                        last_activity: s.last_activity,
                        started_at: s.started_at,
                    }
                })
                .collect(),
            None => inputs
                .config
                .map(|c| c.projects)
                .unwrap_or_default()
                .into_iter()
                .map(|p| ProjectView {
                    state: if p.enabled {
                        ViewState::Starting
                    } else {
                        ViewState::Disabled
                    },
                    enabled: p.enabled,
                    advertise: p.advertise,
                    name: p.name,
                    root: p.root,
                    error: None,
                    root_missing: false,
                    files: None,
                    clients: 0,
                    rate: 0.0,
                    last_activity: None,
                    started_at: None,
                })
                .collect(),
        };
        self.rings
            .retain(|k, _| projects.iter().any(|p| p.name.to_lowercase() == *k));
        Snapshot { hub, projects }
    }
}
