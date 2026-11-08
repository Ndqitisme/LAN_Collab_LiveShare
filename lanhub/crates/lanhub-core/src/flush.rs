//! Disk access off the async runtime. One thread runs every write, delete and blob read of a project in the
//! order the actor queued them, so a delete never races an earlier flush of the same file. The actor
//! decides when a dirty text is due: at most once per 500 ms after its first edit, like the Node hub.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use tokio::sync::oneshot;
use tokio::time::Instant;

use crate::history::BlobRecord;
use crate::util::{log, random_hex};

pub const FLUSH_DELAY: Duration = Duration::from_millis(500);

pub type IoResult<T> = Result<T, String>;

pub enum IoJob {
    /// Write a text file, logging a failure (nobody waits for it).
    FlushText {
        rel: String,
        abs: PathBuf,
        text: Vec<u16>,
    },
    /// The answers carry no bytes, except `Read`.
    Write {
        abs: PathBuf,
        bytes: Vec<u8>,
        done: oneshot::Sender<IoResult<Vec<u8>>>,
    },
    Remove {
        abs: PathBuf,
        done: oneshot::Sender<IoResult<Vec<u8>>>,
    },
    Read {
        abs: PathBuf,
        done: oneshot::Sender<IoResult<Vec<u8>>>,
    },
    /// Write a content-addressed file unless it exists: an existing one already holds these bytes.
    WriteNew {
        abs: PathBuf,
        bytes: Vec<u8>,
        done: oneshot::Sender<IoResult<Vec<u8>>>,
    },
    /// Append to a file, creating it and its folder, and log a failure under `what`.
    Append {
        abs: PathBuf,
        bytes: Vec<u8>,
        what: &'static str,
    },
    /// `Write` of a blob, recorded as a history run with the bytes the file held before.
    WriteRecorded {
        abs: PathBuf,
        bytes: Vec<u8>,
        done: oneshot::Sender<IoResult<Vec<u8>>>,
        record: BlobRecord,
    },
    /// `Remove` of a blob, recorded as a history delete run with its last bytes.
    RemoveRecorded {
        abs: PathBuf,
        done: oneshot::Sender<IoResult<Vec<u8>>>,
        record: BlobRecord,
    },
    /// Answered once every job queued before it is done.
    Barrier { done: oneshot::Sender<()> },
}

/// `writeFileAtomic` in `lib/common.js`: a temp file next to the target, then a rename; when the rename
/// fails (the target is open in a program that denies delete access, such as Excel), an in-place write.
pub fn write_file_atomic(abs: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = abs.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut tmp = abs.as_os_str().to_owned();
    tmp.push(format!(".{}.lc-tmp", random_hex::<4>()));
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, data)?;
    if std::fs::rename(&tmp, abs).is_ok() {
        return Ok(());
    }
    let result = std::fs::write(abs, data);
    let _ = std::fs::remove_file(&tmp);
    result
}

fn append(abs: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    if let Some(dir) = abs.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(abs)?
        .write_all(bytes)
}

fn remove_file_force(abs: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(abs) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

pub struct Io {
    tx: Option<mpsc::Sender<IoJob>>,
    thread: Option<JoinHandle<()>>,
}

impl Io {
    pub fn start(name: &str) -> Io {
        let (tx, rx) = mpsc::channel::<IoJob>();
        let project = name.to_owned();
        let thread = std::thread::Builder::new()
            .name(format!("lanhub-io-{name}"))
            .spawn(move || {
                crate::logs::set_thread_project(&project);
                for job in rx {
                    run(job);
                }
            })
            .expect("the OS can start a thread");
        Io {
            tx: Some(tx),
            thread: Some(thread),
        }
    }

    pub fn send(&self, job: IoJob) {
        if let Some(tx) = &self.tx {
            // The thread only stops once `tx` is dropped, so this cannot fail.
            let _ = tx.send(job);
        }
    }

    /// Moves the thread out, leaving an `Io` that drops every job, so it can be finished off the runtime.
    pub fn detach(&mut self) -> Io {
        Io {
            tx: self.tx.take(),
            thread: self.thread.take(),
        }
    }

    /// Waits for every queued job, then stops the thread.
    pub fn finish(&mut self) {
        self.tx = None;
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run(job: IoJob) {
    match job {
        IoJob::FlushText { rel, abs, text } => {
            let bytes = String::from_utf16_lossy(&text).into_bytes();
            if let Err(e) = write_file_atomic(&abs, &bytes) {
                log(format!("[LỖI] không ghi được {rel}: {e}"));
            }
        }
        IoJob::Write { abs, bytes, done } => {
            let _ = done.send(
                write_file_atomic(&abs, &bytes)
                    .map(|_| Vec::new())
                    .map_err(|e| e.to_string()),
            );
        }
        IoJob::Remove { abs, done } => {
            let _ = done.send(
                remove_file_force(&abs)
                    .map(|_| Vec::new())
                    .map_err(|e| e.to_string()),
            );
        }
        IoJob::Read { abs, done } => {
            let _ = done.send(std::fs::read(&abs).map_err(|e| e.to_string()));
        }
        IoJob::WriteNew { abs, bytes, done } => {
            let r = if abs.exists() {
                Ok(())
            } else {
                write_file_atomic(&abs, &bytes)
            };
            let _ = done.send(r.map(|_| Vec::new()).map_err(|e| e.to_string()));
        }
        IoJob::Append { abs, bytes, what } => {
            if let Err(e) = append(&abs, &bytes) {
                log(format!("[LỖI] không lưu được {what}: {e}"));
            }
        }
        // The run is handed to the history thread before `done`, so it is queued ahead of anything the
        // actor records after this job.
        IoJob::WriteRecorded {
            abs,
            bytes,
            done,
            record,
        } => {
            let mut record = record;
            let old = record.before.take().or_else(|| std::fs::read(&abs).ok());
            let r = write_file_atomic(&abs, &bytes);
            if r.is_ok() {
                record.written(old, bytes);
            }
            let _ = done.send(r.map(|_| Vec::new()).map_err(|e| e.to_string()));
        }
        IoJob::RemoveRecorded { abs, done, record } => {
            let old = std::fs::read(&abs).ok();
            let r = remove_file_force(&abs);
            if let (Ok(()), Some(old)) = (&r, old) {
                record.removed(old);
            }
            let _ = done.send(r.map(|_| Vec::new()).map_err(|e| e.to_string()));
        }
        IoJob::Barrier { done } => {
            let _ = done.send(());
        }
    }
}

/// When each dirty text file is due to be written.
#[derive(Debug, Default)]
pub struct FlushSchedule {
    due: HashMap<String, Instant>,
}

impl FlushSchedule {
    /// `markDirty`: starts the 500 ms wait unless one is already running for this file.
    pub fn mark(&mut self, rel: &str, now: Instant) {
        self.due.entry(rel.to_owned()).or_insert(now + FLUSH_DELAY);
    }

    /// `clearTimeout(f.timer)`.
    pub fn cancel(&mut self, rel: &str) {
        self.due.remove(rel);
    }

    pub fn next(&self) -> Option<Instant> {
        self.due.values().min().copied()
    }

    pub fn take_due(&mut self, now: Instant) -> Vec<String> {
        let ready: Vec<String> = self
            .due
            .iter()
            .filter(|(_, at)| **at <= now)
            .map(|(r, _)| r.clone())
            .collect();
        for r in &ready {
            self.due.remove(r);
        }
        ready
    }

    pub fn take_all(&mut self) -> Vec<String> {
        self.due.drain().map(|(r, _)| r).collect()
    }
}
