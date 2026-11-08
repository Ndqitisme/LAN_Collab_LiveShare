//! Retention: closed runs older than `keep_days` go first, then the oldest runs until `history.db` plus
//! the blobs they reference fit in `max_mb`, then every blob no run references. The newest run of each
//! path and every open run always stay, so the latest state of each file (a deleted one included) can
//! still be viewed and restored. A second pass right after the first deletes nothing.

use std::collections::{HashMap, HashSet};

use super::store::Store;

const DAY_MS: u64 = 86_400_000;
const MB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub keep_days: u32,
    pub max_mb: u64,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub runs_deleted: u64,
    pub blobs_deleted: u64,
    /// `history.db` plus the referenced blobs, before and after.
    pub bytes_before: u64,
    pub bytes_after: u64,
    /// Paths that lost runs, sorted.
    pub paths: Vec<String>,
}

struct Candidate {
    id: i64,
    path: String,
    ended_at: u64,
    blobs: [Option<String>; 2],
}

pub fn run(store: &mut Store, limits: Limits, now: u64) -> Result<Report, String> {
    let cutoff = now.saturating_sub(u64::from(limits.keep_days) * DAY_MS);
    let max_bytes = limits.max_mb.saturating_mul(MB);
    let sizes: HashMap<String, u64> = store
        .blobs
        .scan()
        .map_err(|e| format!("blobs: {e}"))?
        .into_iter()
        .collect();
    let db_bytes = store.db_bytes();
    let tx = store.conn.transaction().map_err(|e| e.to_string())?;
    let mut refs: HashMap<String, u32> = HashMap::new();
    let mut candidates = Vec::new();
    {
        let protected: HashSet<i64> = tx
            .prepare(
                "SELECT MAX(id) FROM runs GROUP BY path UNION SELECT id FROM runs WHERE end_blob IS NULL",
            )
            .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
            .map_err(|e| e.to_string())?;
        let mut stmt = tx
            .prepare(
                "SELECT id, path, ended_at, start_blob, end_blob FROM runs ORDER BY ended_at, id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Candidate {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    ended_at: r.get::<_, i64>(2)? as u64,
                    blobs: [r.get(3)?, r.get(4)?],
                })
            })
            .map_err(|e| e.to_string())?;
        for c in rows {
            let c = c.map_err(|e| e.to_string())?;
            for b in c.blobs.iter().flatten() {
                *refs.entry(b.clone()).or_default() += 1;
            }
            if !protected.contains(&c.id) {
                candidates.push(c);
            }
        }
    }
    let referenced = |refs: &HashMap<String, u32>| -> u64 {
        refs.keys().filter_map(|b| sizes.get(b)).sum::<u64>()
    };
    let bytes_before = db_bytes + referenced(&refs);
    let mut total = bytes_before;
    let mut report = Report {
        bytes_before,
        ..Report::default()
    };
    let mut paths = HashSet::new();
    {
        let mut delete = tx
            .prepare("DELETE FROM runs WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        for c in candidates {
            if c.ended_at >= cutoff && total <= max_bytes {
                break;
            }
            delete.execute([c.id]).map_err(|e| e.to_string())?;
            report.runs_deleted += 1;
            for b in c.blobs.iter().flatten() {
                let n = refs.get_mut(b).expect("counted above");
                *n -= 1;
                if *n == 0 {
                    refs.remove(b);
                    total -= sizes.get(b).copied().unwrap_or(0);
                }
            }
            paths.insert(c.path);
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    // Only after the commit: a blob must never go while a committed run still names it.
    for sha in sizes.keys().filter(|b| !refs.contains_key(*b)) {
        store
            .blobs
            .remove(sha)
            .map_err(|e| format!("blob {sha}: {e}"))?;
        report.blobs_deleted += 1;
    }
    report.bytes_after = total;
    report.paths = paths.into_iter().collect();
    report.paths.sort();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::super::runs::{Author, Source};
    use super::super::store::{NewRun, insert_run, list_runs, run_count};
    use super::*;
    use crate::util::random_hex;
    use lanhub_protocol::FileKind;

    const NOW: u64 = 100 * DAY_MS;

    fn store(name: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("lanhub-ret-{name}-{}", random_hex::<4>()));
        (Store::open(&dir).unwrap(), dir)
    }

    fn alice() -> Author {
        Author {
            uid: "a".into(),
            name: "Alice".into(),
            color: "#000000".into(),
        }
    }

    /// A closed text run of `path` from content `from` to `to`, ended at `ended_at`.
    fn run(s: &mut Store, path: &str, from: &[u8], to: &[u8], ended_at: u64) -> i64 {
        let start = s.blobs.put(from).unwrap();
        let end = s.blobs.put(to).unwrap();
        insert_run(
            &s.conn,
            &NewRun {
                path,
                author: &alice(),
                source: Source::Editor,
                kind: FileKind::Text,
                reverts: None,
                started_at: ended_at,
                ended_at,
                op_count: 1,
                chars_added: 1,
                chars_removed: 0,
                start_blob: Some(&start),
                end_blob: Some(&end),
            },
        )
        .unwrap()
    }

    fn ids(s: &Store) -> Vec<String> {
        let (runs, _) = list_runs(&s.conn, None, None, 1000).unwrap();
        runs.into_iter().map(|r| r.id).collect()
    }

    /// Bytes that do not compress, so blob sizes are predictable.
    fn noise(n: usize, seed: u8) -> Vec<u8> {
        let mut x = u32::from(seed).wrapping_mul(2_654_435_761).wrapping_add(1);
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect()
    }

    const ROOMY: Limits = Limits {
        keep_days: 30,
        max_mb: 2048,
    };

    #[test]
    fn age_deletes_old_runs_but_keeps_the_newest_of_each_path() {
        let (mut s, dir) = store("age");
        let old_a = run(&mut s, "a.py", b"1", b"2", NOW - 40 * DAY_MS);
        let new_a = run(&mut s, "a.py", b"2", b"3", NOW - DAY_MS);
        let only_b = run(&mut s, "b.py", b"x", b"y", NOW - 90 * DAY_MS);
        let r = super::run(&mut s, ROOMY, NOW).unwrap();
        assert_eq!(r.runs_deleted, 1);
        assert_eq!(r.paths, ["a.py"]);
        assert_eq!(
            ids(&s),
            [only_b.to_string(), new_a.to_string()],
            "newest id first"
        );
        assert!(!ids(&s).contains(&old_a.to_string()));
        assert_eq!(
            r.blobs_deleted, 1,
            "blob \"1\" lost its only run; \"2\" is still the start of the next"
        );
        assert_eq!(
            s.blobs.get(&super::super::blobs::sha256_hex(b"1")).unwrap(),
            None
        );
        assert!(
            s.blobs
                .get(&super::super::blobs::sha256_hex(b"2"))
                .unwrap()
                .is_some()
        );
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keep_days_zero_leaves_only_the_newest_run_of_each_path() {
        let (mut s, dir) = store("zero");
        run(&mut s, "a.py", b"1", b"2", NOW - 3);
        let a = run(&mut s, "a.py", b"2", b"3", NOW - 2);
        let b = run(&mut s, "b.py", b"4", b"5", NOW - 1);
        super::run(
            &mut s,
            Limits {
                keep_days: 0,
                max_mb: 2048,
            },
            NOW,
        )
        .unwrap();
        assert_eq!(ids(&s), [b.to_string(), a.to_string()]);
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn size_deletes_the_oldest_runs_until_under_max_mb() {
        let (mut s, dir) = store("size");
        // Four 400 KiB versions of one file: three runs, about 1.6 MiB of blobs.
        let v: Vec<Vec<u8>> = (0..4).map(|i| noise(400 * 1024, i)).collect();
        let r1 = run(&mut s, "big.bin", &v[0], &v[1], NOW - 30);
        let r2 = run(&mut s, "big.bin", &v[1], &v[2], NOW - 20);
        let r3 = run(&mut s, "big.bin", &v[2], &v[3], NOW - 10);
        let r = super::run(
            &mut s,
            Limits {
                keep_days: 30,
                max_mb: 1,
            },
            NOW,
        )
        .unwrap();
        assert!(r.bytes_before > MB && r.bytes_after <= MB, "{r:?}");
        assert_eq!(ids(&s), [r3.to_string()]);
        assert!(!ids(&s).contains(&r1.to_string()) && !ids(&s).contains(&r2.to_string()));
        assert_eq!(r.blobs_deleted, 2);
        assert_eq!(s.blobs.scan().unwrap().len(), 2);
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_shared_blob_stays_while_any_run_references_it() {
        let (mut s, dir) = store("shared");
        let shared = noise(700 * 1024, 9);
        run(&mut s, "a.bin", &shared, b"a2", NOW - 30);
        run(&mut s, "b.bin", b"b1", &shared, NOW - 20);
        run(&mut s, "b.bin", &shared, b"b3", NOW - 10);
        run(&mut s, "a.bin", b"a2", b"a3", NOW - 5);
        // Over 1 MiB only if the shared blob is counted twice; it is counted once, so nothing goes.
        let r = super::run(
            &mut s,
            Limits {
                keep_days: 30,
                max_mb: 1,
            },
            NOW,
        )
        .unwrap();
        assert_eq!(r.runs_deleted, 0, "{r:?}");
        let r = super::run(
            &mut s,
            Limits {
                keep_days: 0,
                max_mb: 2048,
            },
            NOW,
        )
        .unwrap();
        assert_eq!(r.runs_deleted, 2);
        assert!(
            s.blobs
                .get(&super::super::blobs::sha256_hex(&shared))
                .unwrap()
                .is_some(),
            "b.bin's newest run starts from it"
        );
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn open_runs_stay_and_unreferenced_blobs_go() {
        let (mut s, dir) = store("open");
        let start = s.blobs.put(b"open start").unwrap();
        insert_run(
            &s.conn,
            &NewRun {
                path: "a.py",
                author: &alice(),
                source: Source::Editor,
                kind: FileKind::Text,
                reverts: None,
                started_at: 0,
                ended_at: 0,
                op_count: 1,
                chars_added: 1,
                chars_removed: 0,
                start_blob: Some(&start),
                end_blob: None,
            },
        )
        .unwrap();
        run(&mut s, "a.py", b"later", b"later2", 1);
        let orphan = s.blobs.put(b"nobody").unwrap();
        let r = super::run(
            &mut s,
            Limits {
                keep_days: 0,
                max_mb: 0,
            },
            NOW,
        )
        .unwrap();
        assert_eq!(
            run_count(&s.conn).unwrap(),
            2,
            "the open run and the newest run stay"
        );
        assert_eq!(r.blobs_deleted, 1);
        assert_eq!(s.blobs.get(&orphan).unwrap(), None);
        assert!(s.blobs.get(&start).unwrap().is_some());
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_second_pass_deletes_nothing() {
        let (mut s, dir) = store("twice");
        for i in 0..6u8 {
            run(
                &mut s,
                "x.bin",
                &noise(300 * 1024, i),
                &noise(300 * 1024, i + 1),
                NOW - 100 + u64::from(i),
            );
            run(
                &mut s,
                "y.py",
                &[i],
                &[i + 1],
                NOW - 50 * DAY_MS + u64::from(i),
            );
        }
        let limits = Limits {
            keep_days: 30,
            max_mb: 1,
        };
        let first = super::run(&mut s, limits, NOW).unwrap();
        assert!(
            first.runs_deleted > 0 && first.blobs_deleted > 0,
            "{first:?}"
        );
        let second = super::run(&mut s, limits, NOW).unwrap();
        assert_eq!(
            (second.runs_deleted, second.blobs_deleted),
            (0, 0),
            "{second:?}"
        );
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
