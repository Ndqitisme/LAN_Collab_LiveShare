//! Content-addressed file contents: `blobs/<first 2 hex>/<sha256>.zst`, zstd level 3. A blob is written
//! to a temp file and renamed, so a crash never leaves a partial blob under its final name, and an
//! existing blob is never rewritten. Only names of this exact form are ever read or removed here, so files
//! the Node hub left in the history folder stay untouched.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::util::{hex, random_hex};

const LEVEL: i32 = 3;
const EXT: &str = ".zst";
const TMP_EXT: &str = ".tmp";

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn is_lower_hex(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn is_sha256(s: &str) -> bool {
    s.len() == 64 && is_lower_hex(s)
}

/// Debug builds: `LANHUB_DEBUG_BLOB_PAUSE_MS` sleeps between the temp write and the rename, so a test can
/// kill the hub in the middle of a blob write.
fn debug_pause() {
    if cfg!(debug_assertions)
        && let Some(ms) = std::env::var("LANHUB_DEBUG_BLOB_PAUSE_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
    {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

#[derive(Debug)]
pub struct BlobStore {
    dir: PathBuf,
    /// Blobs known to exist, so a repeated content costs no `stat`.
    known: HashSet<String>,
    /// Compressed bytes of the blobs this store wrote, for the size check between retention passes.
    pub written: u64,
}

impl BlobStore {
    pub fn new(dir: PathBuf) -> BlobStore {
        BlobStore {
            dir,
            known: HashSet::new(),
            written: 0,
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, sha: &str) -> PathBuf {
        self.dir.join(&sha[..2]).join(format!("{sha}{EXT}"))
    }

    /// Stores `bytes` unless a blob with their hash exists, and returns the hash.
    pub fn put(&mut self, bytes: &[u8]) -> io::Result<String> {
        let sha = sha256_hex(bytes);
        if self.known.contains(&sha) {
            return Ok(sha);
        }
        let path = self.path(&sha);
        if !path.exists() {
            let dir = path.parent().expect("a blob path has a folder");
            std::fs::create_dir_all(dir)?;
            let packed = zstd::bulk::compress(bytes, LEVEL)?;
            let tmp = dir.join(format!("{sha}{EXT}.{}{TMP_EXT}", random_hex::<4>()));
            std::fs::write(&tmp, &packed)?;
            debug_pause();
            if let Err(e) = std::fs::rename(&tmp, &path) {
                let _ = std::fs::remove_file(&tmp);
                if !path.exists() {
                    return Err(e);
                }
            }
            self.written += packed.len() as u64;
        }
        self.known.insert(sha.clone());
        Ok(sha)
    }

    /// The content of a blob; `None` when `sha` is not a SHA-256 or no such blob is stored.
    pub fn get(&self, sha: &str) -> io::Result<Option<Vec<u8>>> {
        if !is_sha256(sha) {
            return Ok(None);
        }
        let file = match std::fs::File::open(self.path(sha)) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        zstd::stream::decode_all(io::BufReader::new(file)).map(Some)
    }

    /// Every stored blob with its size on disk. Temp files a crash left behind are removed.
    pub fn scan(&self) -> io::Result<Vec<(String, u64)>> {
        let mut out = Vec::new();
        let top = match std::fs::read_dir(&self.dir) {
            Ok(t) => t,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(e),
        };
        for sub in top {
            let sub = sub?;
            let prefix = sub.file_name().to_string_lossy().into_owned();
            let is_prefix = prefix.len() == 2 && is_lower_hex(&prefix);
            if !is_prefix || !sub.file_type()?.is_dir() {
                continue;
            }
            for f in std::fs::read_dir(sub.path())? {
                let f = f?;
                let name = f.file_name().to_string_lossy().into_owned();
                if let Some(sha) = name.strip_suffix(EXT)
                    && is_sha256(sha)
                    && sha.starts_with(&prefix)
                {
                    out.push((sha.to_owned(), f.metadata()?.len()));
                } else if Self::is_temp(&name) {
                    let _ = std::fs::remove_file(f.path());
                }
            }
        }
        Ok(out)
    }

    /// `<sha>.zst.<8 hex>.tmp`
    fn is_temp(name: &str) -> bool {
        let Some(rest) = name.strip_suffix(TMP_EXT) else {
            return false;
        };
        let Some((head, rand)) = rest.rsplit_once('.') else {
            return false;
        };
        rand.len() == 8
            && rand.bytes().all(|b| b.is_ascii_hexdigit())
            && head.strip_suffix(EXT).is_some_and(is_sha256)
    }

    pub fn remove(&mut self, sha: &str) -> io::Result<()> {
        self.known.remove(sha);
        if !is_sha256(sha) {
            return Ok(());
        }
        match std::fs::remove_file(self.path(sha)) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lanhub-blobs-{name}-{}", random_hex::<4>()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn put_get_roundtrip_and_names() {
        let dir = temp_dir("rt");
        let mut b = BlobStore::new(dir.join("blobs"));
        let sha = b.put(b"hello").unwrap();
        assert_eq!(
            sha,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert!(
            dir.join("blobs")
                .join("2c")
                .join(format!("{sha}.zst"))
                .is_file()
        );
        assert_eq!(b.get(&sha).unwrap().as_deref(), Some(&b"hello"[..]));
        assert_eq!(b.get(&"0".repeat(64)).unwrap(), None);
        assert_eq!(b.get("../../etc/passwd").unwrap(), None);
        assert_eq!(
            b.put(b"hello").unwrap(),
            sha,
            "a second put of the same bytes is a no-op"
        );
        assert_eq!(
            b.scan().unwrap(),
            vec![(sha.clone(), std::fs::metadata(b.path(&sha)).unwrap().len())]
        );
        b.remove(&sha).unwrap();
        assert_eq!(b.get(&sha).unwrap(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn scan_removes_temp_files_and_ignores_foreign_files() {
        let dir = temp_dir("scan");
        let mut b = BlobStore::new(dir.clone());
        let sha = b.put(b"x").unwrap();
        let sub = dir.join(&sha[..2]);
        let tmp = sub.join(format!("{sha}.zst.0a1b2c3d.tmp"));
        std::fs::write(&tmp, b"partial").unwrap();
        let foreign = sub.join("notes.txt.2026-01-01T00-00-00");
        std::fs::write(&foreign, b"node snapshot").unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src").join("a.py.123"), b"node snapshot").unwrap();
        assert_eq!(b.scan().unwrap().len(), 1);
        assert!(!tmp.exists());
        assert!(foreign.exists() && dir.join("src").join("a.py.123").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
