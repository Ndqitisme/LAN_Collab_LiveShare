//! Every log line goes to stdout and into an in-memory ring of structured records that `AdminApi::logs`
//! serves. A record names its project when it was written by that project's actor task or IO thread, or
//! through `log_in`.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::Write as _;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::util::{local_time, now_ms};

const KEEP: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogRecord {
    /// Increases by one per record, so a reader asks for what came after the last one it saw.
    pub seq: u64,
    pub ts: u64,
    pub level: Level,
    pub project: Option<String>,
    pub msg: String,
}

struct Ring {
    next: u64,
    records: VecDeque<LogRecord>,
}

static RING: Mutex<Ring> = Mutex::new(Ring {
    next: 1,
    records: VecDeque::new(),
});
static PREFIX_PROJECT: AtomicBool = AtomicBool::new(false);

tokio::task_local! {
    static TASK_PROJECT: String;
}

thread_local! {
    static THREAD_PROJECT: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// With several projects on one hub, stdout lines start with `[project]`. The single-project flags keep
/// the Node hub's lines.
pub fn prefix_project(on: bool) {
    PREFIX_PROJECT.store(on, Ordering::Relaxed);
}

/// Runs `fut` with its log lines attributed to `project`.
pub async fn in_project<F: Future>(project: String, fut: F) -> F::Output {
    TASK_PROJECT.scope(project, fut).await
}

/// Attributes the log lines of the current thread to `project` (IO threads).
pub fn set_thread_project(project: &str) {
    THREAD_PROJECT.with(|p| *p.borrow_mut() = Some(project.to_owned()));
}

fn current_project() -> Option<String> {
    TASK_PROJECT
        .try_with(Clone::clone)
        .ok()
        .or_else(|| THREAD_PROJECT.with(|p| p.borrow().clone()))
}

fn level_of(msg: &str) -> Level {
    if msg.starts_with("[LỖI]") {
        Level::Error
    } else if msg.starts_with("[CẢNH BÁO]") {
        Level::Warn
    } else {
        Level::Info
    }
}

pub fn log_in(project: Option<&str>, msg: &str) {
    let project = project.map(str::to_owned).or_else(current_project);
    {
        let mut out = std::io::stdout().lock();
        let _ = match (&project, PREFIX_PROJECT.load(Ordering::Relaxed)) {
            (Some(p), true) => writeln!(out, "{} [{p}] {msg}", local_time()),
            _ => writeln!(out, "{} {msg}", local_time()),
        };
        let _ = out.flush();
    }
    let mut ring = RING.lock().unwrap_or_else(|e| e.into_inner());
    let seq = ring.next;
    ring.next += 1;
    ring.records.push_back(LogRecord {
        seq,
        ts: now_ms(),
        level: level_of(msg),
        project,
        msg: msg.to_owned(),
    });
    if ring.records.len() > KEEP {
        ring.records.pop_front();
    }
}

/// Up to `limit` records with `seq` above `after`, oldest first.
pub fn since(after: u64, limit: usize) -> Vec<LogRecord> {
    let ring = RING.lock().unwrap_or_else(|e| e.into_inner());
    let skip = ring.records.partition_point(|r| r.seq <= after);
    ring.records
        .iter()
        .skip(skip)
        .take(limit)
        .cloned()
        .collect()
}
