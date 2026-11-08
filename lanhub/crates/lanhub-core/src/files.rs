//! Loading the project folder: text or blob (`classify`), one line-ending style per text file
//! (`dominantEol` and `normalizeEol`), and the walk that skips excluded and unsafe paths.

use std::path::{Path, PathBuf};

use crate::exclude::Excluder;
use crate::paths::safe_rel;

pub const MAX_TEXT: usize = 1024 * 1024;

const BLOB_EXT: &[&str] = &[
    ".xlsx", ".xls", ".xlsm", ".xlsb", ".docx", ".doc", ".pptx", ".ppt", ".pdf", ".png", ".jpg",
    ".jpeg", ".gif", ".bmp", ".ico", ".zip", ".7z", ".rar", ".gz", ".exe", ".dll", ".pyd", ".so",
    ".db", ".sqlite", ".vsix",
];

const CR: u16 = b'\r' as u16;
const LF: u16 = b'\n' as u16;

/// `path.extname` of a `/`-separated relative path.
pub fn extname(rel: &str) -> &str {
    let base = rel.rsplit('/').next().unwrap_or(rel);
    match base.rfind('.') {
        Some(i) if i > 0 && base != ".." => &base[i..],
        _ => "",
    }
}

/// `classify(buf, rel) === 'text'`: not a blob extension, at most 1 MiB, no NUL byte, and valid UTF-8 (the
/// bytes survive a decode and re-encode unchanged).
pub fn is_text(bytes: &[u8], rel: &str) -> bool {
    let ext = extname(rel).to_lowercase();
    if BLOB_EXT.contains(&ext.as_str()) {
        return false;
    }
    if bytes.len() > MAX_TEXT || bytes.contains(&0) {
        return false;
    }
    std::str::from_utf8(bytes).is_ok()
}

/// `dominantEol(text) === '\r\n'`: more CRLF than bare LF endings.
pub fn crlf_dominates(text: &[u16]) -> bool {
    let lf_total = text.iter().filter(|u| **u == LF).count();
    let crlf = text.windows(2).filter(|w| w[0] == CR && w[1] == LF).count();
    crlf > lf_total - crlf
}

/// `normalizeEol(text, dominantEol(text))`.
pub fn uniform_eol(text: &[u16]) -> Vec<u16> {
    if !text.contains(&LF) {
        return text.to_vec();
    }
    let crlf = crlf_dominates(text);
    let mut out = Vec::with_capacity(text.len() + if crlf { text.len() / 16 } else { 0 });
    for (i, u) in text.iter().enumerate() {
        let after_cr = i > 0 && text[i - 1] == CR;
        if *u == LF {
            if crlf && !after_cr {
                out.push(CR);
            } else if !crlf && after_cr {
                out.pop();
            }
        }
        out.push(*u);
    }
    out
}

/// Every non-excluded, safe file under `root`, as `(rel, absolute path)`, in directory order.
pub fn walk(root: &Path, excluded: &Excluder) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    walk_dir(root, "", excluded, &mut out);
    out
}

fn walk_dir(root: &Path, rel: &str, excluded: &Excluder, out: &mut Vec<(String, PathBuf)>) {
    let dir = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let r = if rel.is_empty() {
            name
        } else {
            format!("{rel}/{name}")
        };
        if excluded.is_excluded(&r) || safe_rel(&r).is_none() {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            walk_dir(root, &r, excluded, out);
        } else if kind.is_file() {
            out.push((r, entry.path()));
        }
    }
}

/// `path.join(root, rel)` for a safe relative path.
pub fn abs_path(root: &Path, rel: &str) -> PathBuf {
    let mut p = root.to_path_buf();
    p.extend(rel.split('/'));
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    #[test]
    fn eol_follows_the_majority_and_a_tie_goes_to_lf() {
        assert_eq!(uniform_eol(&u("a\r\nb\r\nc\n")), u("a\r\nb\r\nc\r\n"));
        assert_eq!(uniform_eol(&u("a\r\nb\nc\n")), u("a\nb\nc\n"));
        assert_eq!(uniform_eol(&u("a\r\nb\n")), u("a\nb\n"));
        assert_eq!(uniform_eol(&u("a\rb")), u("a\rb"));
        assert_eq!(uniform_eol(&u("\r\r\n\n")), u("\r\n\n"));
    }

    #[test]
    fn extname_matches_node() {
        for (p, e) in [
            ("a.txt", ".txt"),
            (".gitignore", ""),
            ("a.", "."),
            ("..a", ".a"),
            ("x", ""),
            ("d.d/x", ""),
        ] {
            assert_eq!(extname(p), e, "{p}");
        }
    }
}
