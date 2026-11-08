//! Edit runs as a pure state machine (plan README section 5.6). A run is the consecutive ops of one author
//! on one file. It closes when another author edits the file, when its author has not edited it for
//! `idle_ms`, at a checkpoint, when the file is deleted, renamed or replaced, and when the hub stops. A
//! change of source (or of the run a revert undoes) also starts a new run, so every run has one source.
//! Times are hub milliseconds since the Unix epoch.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Author {
    /// `hello.uid`: one client session, kept across its reconnects.
    pub uid: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Editor,
    Disk,
    Revert,
    Merge,
    /// The run that records a deletion. Never sent by a client.
    Delete,
}

impl Source {
    /// `op.src`; anything else counts as `editor` (docs/protocol.md section 5.1).
    pub fn from_wire(src: Option<&str>) -> Source {
        match src {
            Some("disk") => Source::Disk,
            Some("revert") => Source::Revert,
            Some("merge") => Source::Merge,
            _ => Source::Editor,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Source::Editor => "editor",
            Source::Disk => "disk",
            Source::Revert => "revert",
            Source::Merge => "merge",
            Source::Delete => "delete",
        }
    }

    pub fn parse(s: &str) -> Source {
        match s {
            "delete" => Source::Delete,
            other => Source::from_wire(Some(other)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenRun {
    /// Unique within one hub run; the writer maps it to the database id.
    pub key: u64,
    pub author: Author,
    pub source: Source,
    pub reverts: Option<String>,
    pub started_at: u64,
    pub last_at: u64,
    pub op_count: u64,
    pub chars_added: u64,
    pub chars_removed: u64,
}

/// One applied op. `added` and `removed` count UTF-16 code units of the transformed op.
#[derive(Debug, Clone, Copy)]
pub struct Edit<'a> {
    pub uid: &'a str,
    pub name: &'a str,
    pub color: &'a str,
    pub source: Source,
    pub reverts: Option<&'a str>,
    pub at: u64,
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Closed {
    pub path: String,
    pub run: OpenRun,
    pub ended_at: u64,
}

/// What an op did to the runs of its file.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct EditOutcome {
    pub closed: Option<Closed>,
    /// A new run started with this op; its start content is the text before the op.
    pub opened: bool,
}

#[derive(Debug)]
pub struct Runs {
    open: HashMap<String, OpenRun>,
    idle_ms: u64,
    next_key: u64,
}

impl Runs {
    pub fn new(idle_ms: u64) -> Runs {
        Runs {
            open: HashMap::new(),
            idle_ms,
            next_key: 1,
        }
    }

    pub fn idle_ms(&self) -> u64 {
        self.idle_ms
    }

    pub fn set_idle_ms(&mut self, idle_ms: u64) {
        self.idle_ms = idle_ms;
    }

    pub fn get(&self, path: &str) -> Option<&OpenRun> {
        self.open.get(path)
    }

    pub fn is_empty(&self) -> bool {
        self.open.is_empty()
    }

    /// An op applied to `path`. An author switch or an idle gap ends the old run at its last op.
    pub fn edit(&mut self, path: &str, e: Edit<'_>) -> EditOutcome {
        let mut out = EditOutcome::default();
        if let Some(run) = self.open.get(path) {
            let same = run.author.uid == e.uid
                && run.source == e.source
                && run.reverts.as_deref() == e.reverts
                && e.at.saturating_sub(run.last_at) < self.idle_ms;
            if !same {
                let run = self.open.remove(path).expect("checked above");
                out.closed = Some(Closed {
                    path: path.to_owned(),
                    ended_at: run.last_at,
                    run,
                });
            }
        }
        let run = match self.open.get_mut(path) {
            Some(run) => run,
            None => {
                out.opened = true;
                let key = self.next_key;
                self.next_key += 1;
                self.open.entry(path.to_owned()).or_insert(OpenRun {
                    key,
                    author: Author {
                        uid: e.uid.to_owned(),
                        name: e.name.to_owned(),
                        color: e.color.to_owned(),
                    },
                    source: e.source,
                    reverts: e.reverts.map(str::to_owned),
                    started_at: e.at,
                    last_at: e.at,
                    op_count: 0,
                    chars_added: 0,
                    chars_removed: 0,
                })
            }
        };
        run.last_at = e.at;
        run.op_count += 1;
        run.chars_added += e.added;
        run.chars_removed += e.removed;
        out
    }

    /// The file was deleted, renamed or replaced at `at`.
    pub fn close(&mut self, path: &str, at: u64) -> Option<Closed> {
        self.open.remove(path).map(|run| Closed {
            path: path.to_owned(),
            run,
            ended_at: at,
        })
    }

    /// A checkpoint, or the hub stopping, at `at`. Sorted by path.
    pub fn close_all(&mut self, at: u64) -> Vec<Closed> {
        let mut out: Vec<Closed> = self
            .open
            .drain()
            .map(|(path, run)| Closed {
                path,
                run,
                ended_at: at,
            })
            .collect();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        out
    }

    /// Runs whose author has not edited for `idle_ms` by `now`, ended at their last op. Sorted by path.
    pub fn expire(&mut self, now: u64) -> Vec<Closed> {
        let idle = self.idle_ms;
        let mut paths: Vec<String> = self
            .open
            .iter()
            .filter(|(_, r)| now.saturating_sub(r.last_at) >= idle)
            .map(|(p, _)| p.clone())
            .collect();
        paths.sort();
        paths
            .into_iter()
            .map(|path| {
                let run = self.open.remove(&path).expect("listed above");
                Closed {
                    path,
                    ended_at: run.last_at,
                    run,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDLE: u64 = 15 * 60_000;

    fn edit(uid: &str, at: u64) -> Edit<'_> {
        Edit {
            uid,
            name: uid,
            color: "#000000",
            source: Source::Editor,
            reverts: None,
            at,
            added: 1,
            removed: 0,
        }
    }

    #[test]
    fn consecutive_ops_of_one_author_are_one_run() {
        let mut r = Runs::new(IDLE);
        assert!(r.edit("a.py", edit("alice", 1000)).opened);
        let o = r.edit("a.py", edit("alice", 2000));
        assert_eq!(o, EditOutcome::default());
        let run = r.get("a.py").unwrap();
        assert_eq!(
            (run.op_count, run.chars_added, run.started_at, run.last_at),
            (2, 2, 1000, 2000)
        );
    }

    #[test]
    fn another_author_closes_the_run_at_its_last_op() {
        let mut r = Runs::new(IDLE);
        r.edit("a.py", edit("alice", 1000));
        r.edit("a.py", edit("alice", 1500));
        let o = r.edit("a.py", edit("bob", 3000));
        assert!(o.opened);
        let c = o.closed.unwrap();
        assert_eq!(
            (c.run.author.uid.as_str(), c.ended_at, c.run.op_count),
            ("alice", 1500, 2)
        );
        assert_eq!(r.get("a.py").unwrap().author.uid, "bob");
        assert_eq!(r.get("a.py").unwrap().started_at, 3000);
    }

    #[test]
    fn an_idle_gap_of_exactly_idle_ms_starts_a_new_run_and_one_ms_less_does_not() {
        let mut r = Runs::new(IDLE);
        r.edit("a.py", edit("alice", 0));
        assert!(r.edit("a.py", edit("alice", IDLE - 1)).closed.is_none());
        let o = r.edit("a.py", edit("alice", 2 * IDLE - 1));
        let c = o.closed.expect("a gap of exactly idle_ms closes the run");
        assert_eq!(c.ended_at, IDLE - 1);
        assert!(o.opened);
        assert_eq!(r.get("a.py").unwrap().started_at, 2 * IDLE - 1);
    }

    #[test]
    fn expire_closes_idle_runs_at_their_last_op() {
        let mut r = Runs::new(IDLE);
        r.edit("a.py", edit("alice", 0));
        r.edit("b.py", edit("alice", 10));
        assert!(r.expire(IDLE - 1).is_empty());
        let c = r.expire(IDLE);
        assert_eq!(c.len(), 1);
        assert_eq!((c[0].path.as_str(), c[0].ended_at), ("a.py", 0));
        assert!(r.get("b.py").is_some());
    }

    #[test]
    fn a_change_of_source_or_reverted_run_starts_a_new_run() {
        let mut r = Runs::new(IDLE);
        r.edit("a.py", edit("alice", 0));
        let disk = Edit {
            source: Source::Disk,
            ..edit("alice", 1)
        };
        assert!(r.edit("a.py", disk).closed.is_some());
        let rev = |id| Edit {
            source: Source::Revert,
            reverts: Some(id),
            ..edit("alice", 2)
        };
        assert!(r.edit("a.py", rev("7")).closed.is_some());
        assert!(r.edit("a.py", rev("7")).closed.is_none());
        let c = r.edit("a.py", rev("8")).closed.unwrap();
        assert_eq!(
            (c.run.source, c.run.reverts.as_deref(), c.run.op_count),
            (Source::Revert, Some("7"), 2)
        );
    }

    #[test]
    fn interleaved_files_keep_separate_runs() {
        let mut r = Runs::new(IDLE);
        r.edit("a.py", edit("alice", 0));
        r.edit("b.py", edit("bob", 1));
        assert!(r.edit("a.py", edit("alice", 2)).closed.is_none());
        assert!(r.edit("b.py", edit("bob", 3)).closed.is_none());
        let o = r.edit("b.py", edit("alice", 4));
        assert_eq!(o.closed.unwrap().run.author.uid, "bob");
        assert_eq!(r.get("a.py").unwrap().op_count, 2);
    }

    #[test]
    fn delete_rename_and_checkpoint_close_at_the_event_time() {
        let mut r = Runs::new(IDLE);
        r.edit("a.py", edit("alice", 0));
        r.edit("b.py", edit("bob", 5));
        r.edit("c.py", edit("bob", 6));
        assert_eq!(r.close("a.py", 100).unwrap().ended_at, 100);
        assert!(
            r.close("a.py", 101).is_none(),
            "no open run is left to close"
        );
        let all = r.close_all(200);
        assert_eq!(
            all.iter()
                .map(|c| (c.path.as_str(), c.ended_at))
                .collect::<Vec<_>>(),
            [("b.py", 200), ("c.py", 200)]
        );
        assert!(r.is_empty());
        assert!(
            r.edit("b.py", edit("bob", 300)).opened,
            "the next edit opens a new run"
        );
    }

    #[test]
    fn shutdown_closes_an_open_run_with_its_counters() {
        let mut r = Runs::new(IDLE);
        r.edit(
            "a.py",
            Edit {
                added: 3,
                removed: 2,
                ..edit("alice", 0)
            },
        );
        r.edit(
            "a.py",
            Edit {
                added: 4,
                removed: 0,
                ..edit("alice", 1)
            },
        );
        let c = r.close_all(50);
        assert_eq!(c.len(), 1);
        let run = &c[0].run;
        assert_eq!(
            (
                run.op_count,
                run.chars_added,
                run.chars_removed,
                c[0].ended_at
            ),
            (2, 7, 2, 50)
        );
    }

    #[test]
    fn unknown_sources_count_as_editor() {
        assert_eq!(Source::from_wire(Some("zzz")), Source::Editor);
        assert_eq!(Source::from_wire(Some("delete")), Source::Editor);
        assert_eq!(Source::from_wire(None), Source::Editor);
        assert_eq!(Source::parse("delete"), Source::Delete);
    }
}
