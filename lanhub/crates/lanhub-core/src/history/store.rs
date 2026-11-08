//! The run index: `<history>/history.db`, bundled SQLite in WAL mode, written by the project's history
//! thread only. Ids are SQLite `AUTOINCREMENT` rowids, never reused, sent as decimal strings. An open run
//! has `end_blob` NULL and `ended_at` at its latest op so far.

use std::path::{Path, PathBuf};

use lanhub_protocol::{CheckpointRecord, FileKind, RunRecord};
use rusqlite::{Connection, Row, params};

use super::blobs::BlobStore;
use super::runs::{Author, Source};

pub const DB_FILE: &str = "history.db";
pub const BLOB_DIR: &str = "blobs";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    author_uid TEXT NOT NULL,
    author_name TEXT NOT NULL,
    color TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    op_count INTEGER NOT NULL,
    chars_added INTEGER NOT NULL,
    chars_removed INTEGER NOT NULL,
    start_blob TEXT,
    end_blob TEXT,
    reverts TEXT,
    kind TEXT NOT NULL DEFAULT 'text'
);
CREATE INDEX IF NOT EXISTS runs_path ON runs(path, id);
CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    author_uid TEXT NOT NULL,
    author_name TEXT NOT NULL,
    color TEXT NOT NULL,
    last_run INTEGER
);
";

const RUN_COLUMNS: &str = "id, path, author_uid, author_name, color, source, kind, started_at, ended_at, \
     op_count, chars_added, chars_removed, start_blob, end_blob, reverts";

/// One run to insert. `end_blob` `None` inserts it open.
#[derive(Debug, Clone)]
pub struct NewRun<'a> {
    pub path: &'a str,
    pub author: &'a Author,
    pub source: Source,
    pub kind: FileKind,
    pub reverts: Option<&'a str>,
    pub started_at: u64,
    pub ended_at: u64,
    pub op_count: u64,
    pub chars_added: u64,
    pub chars_removed: u64,
    pub start_blob: Option<&'a str>,
    pub end_blob: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counters {
    pub last_at: u64,
    pub op_count: u64,
    pub chars_added: u64,
    pub chars_removed: u64,
}

pub struct Store {
    pub conn: Connection,
    pub blobs: BlobStore,
    dir: PathBuf,
}

fn kind_str(k: FileKind) -> &'static str {
    match k {
        FileKind::Text => "text",
        FileKind::Blob => "blob",
    }
}

fn run_record(r: &Row<'_>) -> rusqlite::Result<RunRecord> {
    let end_blob: Option<String> = r.get(13)?;
    Ok(RunRecord {
        id: r.get::<_, i64>(0)?.to_string(),
        path: r.get(1)?,
        author_uid: r.get(2)?,
        author_name: r.get(3)?,
        color: r.get(4)?,
        source: r.get(5)?,
        kind: if r.get::<_, String>(6)? == "blob" {
            FileKind::Blob
        } else {
            FileKind::Text
        },
        started_at: r.get::<_, i64>(7)? as u64,
        ended_at: r.get::<_, i64>(8)? as u64,
        op_count: r.get::<_, i64>(9)? as u64,
        chars_added: r.get::<_, i64>(10)? as u64,
        chars_removed: r.get::<_, i64>(11)? as u64,
        start_blob: r.get(12)?,
        open: end_blob.is_none(),
        end_blob,
        reverts: r.get(14)?,
    })
}

impl Store {
    /// Opens or creates the index in `dir`. Fails when SQLite cannot use WAL there (a network drive, for
    /// example), so the caller runs the project without history.
    pub fn open(dir: &Path) -> Result<Store, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let conn = Connection::open(dir.join(DB_FILE)).map_err(|e| e.to_string())?;
        let mode: String = conn
            .pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(format!("SQLite cannot use WAL here (journal_mode {mode})"));
        }
        conn.pragma_update(None, "synchronous", "NORMAL")
            .and_then(|_| conn.busy_timeout(std::time::Duration::from_secs(5)))
            .and_then(|_| conn.execute_batch(SCHEMA))
            .map_err(|e| e.to_string())?;
        Ok(Store {
            conn,
            blobs: BlobStore::new(dir.join(BLOB_DIR)),
            dir: dir.to_owned(),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Bytes of the database file, the part of the index that counts toward `max_mb`.
    pub fn db_bytes(&self) -> u64 {
        std::fs::metadata(self.dir.join(DB_FILE)).map_or(0, |m| m.len())
    }
}

pub fn insert_run(conn: &Connection, r: &NewRun<'_>) -> rusqlite::Result<i64> {
    conn.prepare_cached(
        "INSERT INTO runs (path, author_uid, author_name, color, source, kind, started_at, ended_at, \
         op_count, chars_added, chars_removed, start_blob, end_blob, reverts) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
    )?
    .execute(params![
        r.path,
        r.author.uid,
        r.author.name,
        r.author.color,
        r.source.as_str(),
        kind_str(r.kind),
        r.started_at as i64,
        r.ended_at as i64,
        r.op_count as i64,
        r.chars_added as i64,
        r.chars_removed as i64,
        r.start_blob,
        r.end_blob,
        r.reverts,
    ])?;
    Ok(conn.last_insert_rowid())
}

pub fn update_open(conn: &Connection, id: i64, c: Counters) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "UPDATE runs SET ended_at = ?2, op_count = ?3, chars_added = ?4, chars_removed = ?5 \
         WHERE id = ?1 AND end_blob IS NULL",
    )?
    .execute(params![
        id,
        c.last_at as i64,
        c.op_count as i64,
        c.chars_added as i64,
        c.chars_removed as i64
    ])?;
    Ok(())
}

pub fn close_run(
    conn: &Connection,
    id: i64,
    ended_at: u64,
    c: Counters,
    end_blob: &str,
) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "UPDATE runs SET ended_at = ?2, op_count = ?3, chars_added = ?4, chars_removed = ?5, \
         end_blob = ?6 WHERE id = ?1",
    )?
    .execute(params![
        id,
        ended_at as i64,
        c.op_count as i64,
        c.chars_added as i64,
        c.chars_removed as i64,
        end_blob
    ])?;
    Ok(())
}

/// Newest first. Returns at most `limit` runs with an id below `before`, and whether older ones exist.
pub fn list_runs(
    conn: &Connection,
    path: Option<&str>,
    before: Option<i64>,
    limit: usize,
) -> rusqlite::Result<(Vec<RunRecord>, bool)> {
    let before = before.unwrap_or(i64::MAX);
    let take = limit as i64 + 1;
    let mut runs: Vec<RunRecord> = match path {
        Some(p) => conn
            .prepare_cached(&format!(
                "SELECT {RUN_COLUMNS} FROM runs WHERE path = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3"
            ))?
            .query_map(params![p, before, take], run_record)?
            .collect::<rusqlite::Result<_>>()?,
        None => conn
            .prepare_cached(&format!(
                "SELECT {RUN_COLUMNS} FROM runs WHERE id < ?1 ORDER BY id DESC LIMIT ?2"
            ))?
            .query_map(params![before, take], run_record)?
            .collect::<rusqlite::Result<_>>()?,
    };
    let more = runs.len() > limit;
    runs.truncate(limit);
    Ok((runs, more))
}

pub fn insert_checkpoint(
    conn: &Connection,
    name: &str,
    author: &Author,
    at: u64,
) -> rusqlite::Result<i64> {
    conn.prepare_cached(
        "INSERT INTO checkpoints (name, created_at, author_uid, author_name, color, last_run) \
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT MAX(id) FROM runs))",
    )?
    .execute(params![
        name,
        at as i64,
        author.uid,
        author.name,
        author.color
    ])?;
    Ok(conn.last_insert_rowid())
}

/// Oldest first.
pub fn list_checkpoints(conn: &Connection) -> rusqlite::Result<Vec<CheckpointRecord>> {
    conn.prepare_cached(
        "SELECT id, name, created_at, author_uid, author_name, color, last_run FROM checkpoints ORDER BY id",
    )?
    .query_map([], |r| {
        Ok(CheckpointRecord {
            id: r.get::<_, i64>(0)?.to_string(),
            name: r.get(1)?,
            created_at: r.get::<_, i64>(2)? as u64,
            author_uid: r.get(3)?,
            author_name: r.get(4)?,
            color: r.get(5)?,
            last_run: r.get::<_, Option<i64>>(6)?.map(|id| id.to_string()),
        })
    })?
    .collect()
}

/// Runs a stopped hub left open: `(id, path, start_blob)`.
pub fn open_runs(conn: &Connection) -> rusqlite::Result<Vec<(i64, String, Option<String>)>> {
    conn.prepare("SELECT id, path, start_blob FROM runs WHERE end_blob IS NULL ORDER BY id")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect()
}

/// Sets the end blob of a run a killed hub left open; `ended_at` keeps its latest recorded op.
pub fn end_open_run(conn: &Connection, id: i64, end_blob: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE runs SET end_blob = ?2 WHERE id = ?1 AND end_blob IS NULL",
        params![id, end_blob],
    )?;
    Ok(())
}

pub fn run_count(conn: &Connection) -> rusqlite::Result<u64> {
    conn.query_row("SELECT COUNT(*) FROM runs", [], |r| r.get::<_, i64>(0))
        .map(|n| n as u64)
}
