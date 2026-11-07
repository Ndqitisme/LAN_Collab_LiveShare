//! Edit-run history (plan README section 5.6, docs/protocol.md section 12). The project actor decides run
//! boundaries with `runs::Runs` and sends jobs down a channel to one history thread per project, which
//! owns `history.db` and the blob folder, commits in batches, and answers the history requests. The actor
//! never waits on it: answers come back on a channel the actor selects on, already serialized.
//!
//! The history thread keeps its own copy (a mirror) of each text file that has an open run: the actor sends
//! the text once when a run opens on a file it has not mirrored, then only the ops. Boundary contents come
//! from the mirror, so an author switch on every op costs the actor no copy of the file and a queued job
//! holds an op, not a file.

pub mod blobs;
pub mod retention;
pub mod runs;
pub mod store;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use lanhub_ot::{Component, TextOperation};
use lanhub_protocol::{FileKind, HistoryBlobBody, HistoryBlobContent, HubMessage};
use tokio::sync::mpsc::UnboundedSender;

use crate::config::HistorySettings;
use crate::project::{Line, LoadedFile, line};
use crate::util::{base64_encode, log, now_ms};

pub use retention::Limits;
pub use runs::{Author, Closed, Edit, OpenRun, Runs, Source};
pub use store::{Counters, Store};

const RETENTION_EVERY: Duration = Duration::from_secs(3600);
/// Jobs taken into one transaction at most.
const BATCH: usize = 1024;
pub const LIST_DEFAULT: usize = 50;
pub const LIST_MAX: usize = 200;
pub const CHECKPOINT_NAME_MAX: usize = 100;

pub fn limits(s: &HistorySettings) -> Limits {
    Limits {
        keep_days: s.keep_days,
        max_mb: s.max_mb,
    }
}

/// File content at a run boundary.
#[derive(Debug, Clone)]
pub enum Content {
    /// The mirrored text of the job's path, as it is at that point of the job stream.
    Mirror,
    Bytes(Vec<u8>),
}

#[derive(Debug)]
pub enum StartBlob {
    Missing,
    /// A deletion: the file before it is also what a restore brings back.
    SameAsEnd,
    Content(Content),
}

pub enum Job {
    /// Starts the mirror of `path`.
    Text {
        path: String,
        text: Arc<[u16]>,
    },
    /// An op applied to the mirror, with the counters of the open run it belongs to.
    Op {
        key: u64,
        path: String,
        op: TextOperation,
        counters: Counters,
    },
    /// Drops the mirror of `path`.
    Forget {
        path: String,
    },
    /// A run starts from the mirrored text.
    Open {
        key: u64,
        path: String,
        author: Author,
        source: Source,
        reverts: Option<String>,
        started_at: u64,
    },
    /// A run ends at the mirrored text.
    Close {
        key: u64,
        path: String,
        ended_at: u64,
        counters: Counters,
    },
    /// A run closed as soon as it exists: a blob written by `create` or `put`, or a deletion.
    Closed {
        path: String,
        author: Author,
        source: Source,
        kind: FileKind,
        at: u64,
        chars_removed: u64,
        start: StartBlob,
        end: Content,
    },
    Checkpoint {
        name: String,
        author: Author,
        at: u64,
    },
    List {
        key: u64,
        path: Option<String>,
        before: Option<i64>,
        /// Echoed as the client sent it.
        before_text: Option<String>,
        limit: usize,
    },
    Blob {
        key: u64,
        blob: String,
    },
    Checkpoints {
        key: u64,
    },
    Limits(Limits),
    Stop,
}

/// What the history thread asks the actor to send.
pub enum Reply {
    To {
        key: u64,
        line: Line,
    },
    All {
        line: Line,
    },
    /// Retention removed runs of this path.
    Changed {
        path: String,
    },
}

/// The sending side of the history channel, shared with the IO thread for blob runs.
#[derive(Clone)]
pub struct JobSender {
    tx: mpsc::Sender<Job>,
    queued: Arc<AtomicUsize>,
    peak: Arc<AtomicUsize>,
}

impl JobSender {
    pub fn send(&self, job: Job) {
        let n = self.queued.fetch_add(1, Ordering::Relaxed) + 1;
        self.peak.fetch_max(n, Ordering::Relaxed);
        if self.tx.send(job).is_err() {
            self.queued.fetch_sub(1, Ordering::Relaxed);
        }
    }
}

/// A blob write or a deletion that the IO thread records once it has done it, with the bytes the file
/// held before.
pub struct BlobRecord {
    pub tx: JobSender,
    pub path: String,
    pub author: Author,
    /// The file before, when the hub holds it as text: the disk may lag the last 500 ms of edits.
    pub before: Option<Vec<u8>>,
}

impl BlobRecord {
    pub fn written(self, old: Option<Vec<u8>>, new: Vec<u8>) {
        self.tx.send(Job::Closed {
            path: self.path,
            author: self.author,
            source: Source::Disk,
            kind: FileKind::Blob,
            at: now_ms(),
            chars_removed: 0,
            start: old.map_or(StartBlob::Missing, |b| {
                StartBlob::Content(Content::Bytes(b))
            }),
            end: Content::Bytes(new),
        });
    }

    pub fn removed(self, old: Vec<u8>) {
        self.tx.send(Job::Closed {
            path: self.path,
            author: self.author,
            source: Source::Delete,
            kind: FileKind::Blob,
            at: now_ms(),
            chars_removed: 0,
            start: StartBlob::SameAsEnd,
            end: Content::Bytes(old),
        });
    }
}

/// Opens the index of `dir` and ends the runs a killed hub left open, with the file as it was loaded now.
/// Runs on a blocking thread, before the project starts. Also returns how many runs it ended.
pub fn open(dir: &Path, loaded: &[LoadedFile]) -> Result<(Store, usize), String> {
    let mut store = Store::open(dir)?;
    let open = store::open_runs(&store.conn).map_err(|e| e.to_string())?;
    if open.is_empty() {
        return Ok((store, 0));
    }
    let texts: HashMap<&str, &Vec<u16>> = loaded
        .iter()
        .filter_map(|f| f.text.as_ref().map(|t| (f.rel.as_str(), t)))
        .collect();
    for (id, path, start) in &open {
        let end = match texts.get(path.as_str()) {
            Some(t) => Some(
                store
                    .blobs
                    .put(String::from_utf16_lossy(t).as_bytes())
                    .map_err(|e| e.to_string())?,
            ),
            None => start.clone(),
        };
        if let Some(end) = end {
            store::end_open_run(&store.conn, *id, &end).map_err(|e| e.to_string())?;
        }
    }
    Ok((store, open.len()))
}

pub struct History {
    tx: Option<JobSender>,
    thread: Option<JoinHandle<()>>,
}

impl History {
    pub fn start(
        project: &str,
        store: Store,
        limits: Limits,
        replies: UnboundedSender<Reply>,
    ) -> History {
        let (tx, rx) = mpsc::channel();
        let sender = JobSender {
            tx,
            queued: Arc::default(),
            peak: Arc::default(),
        };
        let name = project.to_owned();
        let (queued, peak) = (sender.queued.clone(), sender.peak.clone());
        let thread = std::thread::Builder::new()
            .name(format!("lanhub-history-{project}"))
            .spawn(move || {
                crate::logs::set_thread_project(&name);
                let mut w = Writer {
                    store,
                    rows: HashMap::new(),
                    dirty: HashMap::new(),
                    mirrors: HashMap::new(),
                    batch_rows: Vec::new(),
                    limits,
                    replies,
                    queued,
                    retained_bytes: 0,
                };
                w.run(rx);
                log(format!(
                    "Lịch sử: hàng đợi ghi cao nhất {} việc",
                    peak.load(Ordering::Relaxed)
                ));
            })
            .expect("the OS can start a thread");
        History {
            tx: Some(sender),
            thread: Some(thread),
        }
    }

    pub fn send(&self, job: Job) {
        if let Some(tx) = &self.tx {
            tx.send(job);
        }
    }

    pub fn sender(&self) -> Option<JobSender> {
        self.tx.clone()
    }

    /// Moves the thread out, so it can be finished off the runtime.
    pub fn detach(&mut self) -> History {
        History {
            tx: self.tx.take(),
            thread: self.thread.take(),
        }
    }

    /// Commits every queued job, then stops the thread.
    pub fn finish(&mut self) {
        if let Some(tx) = self.tx.take() {
            tx.send(Job::Stop);
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

struct Writer {
    store: Store,
    /// Open run key to database id.
    rows: HashMap<u64, i64>,
    /// Counters of open runs not yet written.
    dirty: HashMap<u64, Counters>,
    mirrors: HashMap<String, Mirror>,
    /// Keys whose row was inserted in the current transaction, forgotten if it does not commit.
    batch_rows: Vec<u64>,
    limits: Limits,
    replies: UnboundedSender<Reply>,
    queued: Arc<AtomicUsize>,
    /// History size after the last retention pass, plus `blobs.written` since then, estimates the size.
    retained_bytes: u64,
}

struct Mirror {
    text: Vec<u16>,
    /// Hash of `text` once stored, so the end of one run and the start of the next are stored once.
    sha: Option<String>,
}

/// `op.apply` without a new buffer: the mirror of a large file gets an op per keystroke.
fn apply_in_place(text: &mut Vec<u16>, op: &TextOperation) -> bool {
    if op.base_length() != text.len() {
        return false;
    }
    let mut at = 0;
    for c in op.ops() {
        match c {
            Component::Retain(n) => at += n,
            Component::Insert(s) => {
                text.splice(at..at, s.iter().copied());
                at += s.len();
            }
            Component::Delete(n) => {
                text.drain(at..at + n);
            }
        }
    }
    true
}

fn fail(what: &str, e: impl std::fmt::Display) {
    log(format!("[LỖI] lịch sử: {what}: {e}"));
}

impl Writer {
    fn run(&mut self, rx: mpsc::Receiver<Job>) {
        self.retention();
        let mut next_retention = Instant::now() + RETENTION_EVERY;
        loop {
            let wait = next_retention.saturating_duration_since(Instant::now());
            let first = match rx.recv_timeout(wait) {
                Ok(job) => job,
                Err(RecvTimeoutError::Timeout) => {
                    self.retention();
                    next_retention = Instant::now() + RETENTION_EVERY;
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => return,
            };
            let mut batch = vec![first];
            while batch.len() < BATCH {
                match rx.try_recv() {
                    Ok(job) => batch.push(job),
                    Err(_) => break,
                }
            }
            self.queued.fetch_sub(batch.len(), Ordering::Relaxed);
            if self.apply(batch) {
                return;
            }
        }
    }

    /// One transaction for the whole batch; answers go out after the commit. Returns true on `Stop`.
    fn apply(&mut self, batch: Vec<Job>) -> bool {
        let mut out = Vec::new();
        let mut stop = false;
        let mut limits = None;
        if let Err(e) = self.store.conn.execute_batch("BEGIN IMMEDIATE") {
            fail("BEGIN", e);
        }
        for job in batch {
            match job {
                Job::Stop => stop = true,
                Job::Limits(l) => limits = Some(l),
                job => self.job(job, &mut out),
            }
        }
        self.flush_dirty();
        if let Err(e) = self.store.conn.execute_batch("COMMIT") {
            fail("COMMIT", e);
            let _ = self.store.conn.execute_batch("ROLLBACK");
            // The rolled-back ids can be given again to other runs; later jobs of these runs are dropped.
            for key in &self.batch_rows {
                self.rows.remove(key);
                self.dirty.remove(key);
            }
        }
        self.batch_rows.clear();
        for r in out {
            let _ = self.replies.send(r);
        }
        if let Some(l) = limits.filter(|l| *l != self.limits) {
            self.limits = l;
            self.retention();
        } else if self.over_size() {
            self.retention();
        }
        stop
    }

    /// Stores `c` and returns its hash. `path` names the mirror for `Content::Mirror`.
    fn put(&mut self, path: &str, c: &Content) -> Result<String, String> {
        match c {
            Content::Mirror => {
                let m = self
                    .mirrors
                    .get_mut(path)
                    .ok_or_else(|| format!("no text held for {path}"))?;
                if let Some(sha) = &m.sha {
                    return Ok(sha.clone());
                }
                let sha = self
                    .store
                    .blobs
                    .put(String::from_utf16_lossy(&m.text).as_bytes())
                    .map_err(|e| e.to_string())?;
                m.sha = Some(sha.clone());
                Ok(sha)
            }
            Content::Bytes(b) => self.store.blobs.put(b).map_err(|e| e.to_string()),
        }
    }

    fn flush_dirty(&mut self) {
        for (key, c) in std::mem::take(&mut self.dirty) {
            if let Some(id) = self.rows.get(&key)
                && let Err(e) = store::update_open(&self.store.conn, *id, c)
            {
                fail("cập nhật lượt", e);
            }
        }
    }

    fn job(&mut self, job: Job, out: &mut Vec<Reply>) {
        match job {
            Job::Text { path, text } => {
                self.mirrors.insert(
                    path,
                    Mirror {
                        text: text.to_vec(),
                        sha: None,
                    },
                );
            }
            Job::Op {
                key,
                path,
                op,
                counters,
            } => {
                if let Some(m) = self.mirrors.get_mut(&path) {
                    m.sha = None;
                    if !apply_in_place(&mut m.text, &op) {
                        self.mirrors.remove(&path);
                        fail(&format!("áp op vào bản sao {path}"), "độ dài không khớp");
                    }
                }
                self.dirty.insert(key, counters);
            }
            Job::Forget { path } => {
                self.mirrors.remove(&path);
            }
            Job::Open {
                key,
                path,
                author,
                source,
                reverts,
                started_at,
            } => {
                let start = match self.put(&path, &Content::Mirror) {
                    Ok(s) => s,
                    Err(e) => return fail(&format!("lưu nội dung {path}"), e),
                };
                let run = store::NewRun {
                    path: &path,
                    author: &author,
                    source,
                    kind: FileKind::Text,
                    reverts: reverts.as_deref(),
                    started_at,
                    ended_at: started_at,
                    op_count: 0,
                    chars_added: 0,
                    chars_removed: 0,
                    start_blob: Some(&start),
                    end_blob: None,
                };
                match store::insert_run(&self.store.conn, &run) {
                    Ok(id) => {
                        self.rows.insert(key, id);
                        self.batch_rows.push(key);
                    }
                    Err(e) => fail(&format!("ghi lượt {path}"), e),
                }
            }
            Job::Close {
                key,
                path,
                ended_at,
                counters,
            } => {
                self.dirty.remove(&key);
                let Some(id) = self.rows.remove(&key) else {
                    return;
                };
                let end = match self.put(&path, &Content::Mirror) {
                    Ok(s) => s,
                    Err(e) => return fail(&format!("lưu nội dung cuối lượt {path}"), e),
                };
                if let Err(e) = store::close_run(&self.store.conn, id, ended_at, counters, &end) {
                    fail("đóng lượt", e);
                }
            }
            Job::Closed {
                path,
                author,
                source,
                kind,
                at,
                chars_removed,
                start,
                end,
            } => {
                let end = match self.put(&path, &end) {
                    Ok(s) => s,
                    Err(e) => return fail(&format!("lưu nội dung {path}"), e),
                };
                let start = match start {
                    StartBlob::Missing => None,
                    StartBlob::SameAsEnd => Some(end.clone()),
                    StartBlob::Content(c) => match self.put(&path, &c) {
                        Ok(s) => Some(s),
                        Err(e) => return fail(&format!("lưu nội dung {path}"), e),
                    },
                };
                let run = store::NewRun {
                    path: &path,
                    author: &author,
                    source,
                    kind,
                    reverts: None,
                    started_at: at,
                    ended_at: at,
                    op_count: 1,
                    chars_added: 0,
                    chars_removed,
                    start_blob: start.as_deref(),
                    end_blob: Some(&end),
                };
                if let Err(e) = store::insert_run(&self.store.conn, &run) {
                    fail(&format!("ghi lượt {path}"), e);
                }
            }
            Job::Checkpoint { name, author, at } => {
                if let Err(e) = store::insert_checkpoint(&self.store.conn, &name, &author, at) {
                    return fail("tạo điểm khôi phục", e);
                }
                match store::list_checkpoints(&self.store.conn) {
                    Ok(checkpoints) => out.push(Reply::All {
                        line: line(&HubMessage::CheckpointList { checkpoints }),
                    }),
                    Err(e) => fail("đọc điểm khôi phục", e),
                }
            }
            Job::Checkpoints { key } => match store::list_checkpoints(&self.store.conn) {
                Ok(checkpoints) => out.push(Reply::To {
                    key,
                    line: line(&HubMessage::CheckpointList { checkpoints }),
                }),
                Err(e) => fail("đọc điểm khôi phục", e),
            },
            Job::List {
                key,
                path,
                before,
                before_text,
                limit,
            } => {
                self.flush_dirty();
                match store::list_runs(&self.store.conn, path.as_deref(), before, limit) {
                    Ok((runs, more)) => out.push(Reply::To {
                        key,
                        line: line(&HubMessage::HistoryRuns {
                            path,
                            before: before_text,
                            runs,
                            more,
                        }),
                    }),
                    Err(e) => fail("đọc danh sách lượt", e),
                }
            }
            Job::Blob { key, blob } => {
                let body = match self.store.blobs.get(&blob) {
                    Ok(Some(bytes)) => HistoryBlobBody::Content(blob_content(bytes)),
                    Ok(None) => HistoryBlobBody::Missing { missing: true },
                    Err(e) => return fail(&format!("đọc nội dung {blob}"), e),
                };
                out.push(Reply::To {
                    key,
                    line: line(&HubMessage::HistoryBlob { blob, body }),
                });
            }
            Job::Limits(_) | Job::Stop => unreachable!("taken by apply"),
        }
    }

    /// Fast edits write many blobs, so retention also runs between its hourly passes once the history is
    /// over `max_mb` and a tenth of `max_mb` was written since the last pass (so newest runs that alone
    /// exceed the limit do not make every batch scan the blob folder).
    fn over_size(&self) -> bool {
        let max = self.limits.max_mb.saturating_mul(1024 * 1024);
        let written = self.store.blobs.written;
        written > max / 10 && self.retained_bytes + written > max
    }

    fn retention(&mut self) {
        self.store.blobs.written = 0;
        match retention::run(&mut self.store, self.limits, now_ms()) {
            Ok(r) => {
                self.retained_bytes = r.bytes_after;
                if r.runs_deleted > 0 || r.blobs_deleted > 0 {
                    log(format!(
                        "Lịch sử: đã dọn {} lượt và {} nội dung ({:.1} MB → {:.1} MB)",
                        r.runs_deleted,
                        r.blobs_deleted,
                        r.bytes_before as f64 / 1_048_576.0,
                        r.bytes_after as f64 / 1_048_576.0
                    ));
                }
                for path in r.paths {
                    let _ = self.replies.send(Reply::Changed { path });
                }
            }
            Err(e) => fail("dọn lịch sử", e),
        }
    }
}

/// Text when the bytes are UTF-8 without NUL (so the text gives the exact bytes back), else base64.
fn blob_content(bytes: Vec<u8>) -> HistoryBlobContent {
    if !bytes.contains(&0) {
        match String::from_utf8(bytes) {
            Ok(text) => return HistoryBlobContent::Text { text },
            Err(e) => {
                return HistoryBlobContent::Blob {
                    b64: base64_encode(e.as_bytes()),
                };
            }
        }
    }
    HistoryBlobContent::Blob {
        b64: base64_encode(&bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_in_place_matches_apply() {
        let units = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
        let base = units("hello wörld 😀 end");
        let mut ops = Vec::new();
        let mut a = TextOperation::new();
        a.retain(6)
            .delete(6)
            .insert(&units("there"))
            .retain(base.len() - 12);
        ops.push(a);
        let mut b = TextOperation::new();
        b.insert(&units(">>"))
            .retain(base.len())
            .insert(&units("<<"));
        ops.push(b);
        let mut c = TextOperation::new();
        c.delete(base.len());
        ops.push(c);
        for op in ops {
            let mut t = base.clone();
            assert!(apply_in_place(&mut t, &op));
            assert_eq!(t, op.apply(&base).unwrap());
        }
        let mut short = TextOperation::new();
        short.retain(1);
        assert!(!apply_in_place(&mut base.clone(), &short));
    }
}
