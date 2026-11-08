//! `makeExcluder` and `DEFAULT_EXCLUDE` from `lib/common.js`. Each glob becomes the token form of the
//! regular expression `globToRe` builds, matched over UTF-16 units with JavaScript's case folding.

use lanhub_protocol::json::js_trim;

/// Never synced: VCS data, per-machine environments and caches, editor lock files, our own state.
pub const DEFAULT_EXCLUDE: &[&str] = &[
    ".git",
    ".lan-collab",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    "*.pyc",
    "*.lc-tmp",
    "~$*",
    ".DS_Store",
    "Thumbs.db",
];

#[derive(Debug, Clone, Copy, PartialEq)]
enum Token {
    /// A literal unit, already case-folded.
    Lit(u16),
    /// `?`: `[^/]`.
    One,
    /// `*`: `[^/]*`.
    Segment,
    /// `**`: `.*`.
    Any,
    /// `**/`: `(?:.*/)?`.
    Dirs,
}

const SLASH: u16 = b'/' as u16;

fn is_line_terminator(u: u16) -> bool {
    matches!(u, 0x0a | 0x0d | 0x2028 | 0x2029)
}

/// Canonicalize of a JavaScript regular expression with `i` and without `u`: the upper case of the unit when
/// it is a single unit, unless that would map a non-ASCII unit onto ASCII.
fn fold(u: u16) -> u16 {
    let Some(c) = char::from_u32(u32::from(u)) else {
        return u;
    };
    let mut upper = c.to_uppercase();
    let (Some(up), None) = (upper.next(), upper.next()) else {
        return u;
    };
    let Ok(cu) = u16::try_from(u32::from(up)) else {
        return u;
    };
    if u >= 128 && cu < 128 { u } else { cu }
}

#[derive(Debug, Clone)]
struct Glob(Vec<Token>);

impl Glob {
    fn compile(glob: &[u16]) -> Glob {
        let star = u16::from(b'*');
        let mut tokens = Vec::new();
        let mut i = 0;
        while i < glob.len() {
            let u = glob[i];
            if u == star {
                if glob.get(i + 1) == Some(&star) {
                    if glob.get(i + 2) == Some(&SLASH) {
                        tokens.push(Token::Dirs);
                        i += 2;
                    } else {
                        tokens.push(Token::Any);
                        i += 1;
                    }
                } else {
                    tokens.push(Token::Segment);
                }
            } else if u == u16::from(b'?') {
                tokens.push(Token::One);
            } else {
                tokens.push(Token::Lit(fold(u)));
            }
            i += 1;
        }
        Glob(tokens)
    }

    /// Anchored match. `at[t][p]` memoizes whether tokens `t..` match text `p..`.
    fn matches(&self, text: &[u16]) -> bool {
        let (nt, np) = (self.0.len(), text.len());
        let mut memo = vec![None; (nt + 1) * (np + 1)];
        self.step(0, 0, text, &mut memo)
    }

    fn step(&self, t: usize, p: usize, text: &[u16], memo: &mut [Option<bool>]) -> bool {
        let key = t * (text.len() + 1) + p;
        if let Some(r) = memo[key] {
            return r;
        }
        let r = match self.0.get(t) {
            None => p == text.len(),
            Some(Token::Lit(u)) => {
                p < text.len() && fold(text[p]) == *u && self.step(t + 1, p + 1, text, memo)
            }
            Some(Token::One) => {
                p < text.len() && text[p] != SLASH && self.step(t + 1, p + 1, text, memo)
            }
            Some(Token::Segment) => {
                let mut q = p;
                loop {
                    if self.step(t + 1, q, text, memo) {
                        break true;
                    }
                    if q == text.len() || text[q] == SLASH {
                        break false;
                    }
                    q += 1;
                }
            }
            Some(Token::Any) => {
                let mut q = p;
                loop {
                    if self.step(t + 1, q, text, memo) {
                        break true;
                    }
                    if q == text.len() || is_line_terminator(text[q]) {
                        break false;
                    }
                    q += 1;
                }
            }
            Some(Token::Dirs) => {
                // Either nothing, or `.*` followed by a slash.
                self.step(t + 1, p, text, memo) || {
                    let mut q = p;
                    let mut found = false;
                    while q < text.len() && !is_line_terminator(text[q]) {
                        if text[q] == SLASH && self.step(t + 1, q + 1, text, memo) {
                            found = true;
                            break;
                        }
                        q += 1;
                    }
                    found
                }
            }
        };
        memo[key] = Some(r);
        r
    }
}

/// A path is excluded when it, or any folder above it, matches a pattern. Patterns without `/` match at
/// any depth.
#[derive(Debug, Clone)]
pub struct Excluder {
    globs: Vec<Glob>,
}

impl Excluder {
    pub fn new<S: AsRef<str>>(patterns: &[S]) -> Excluder {
        let globs = patterns
            .iter()
            .map(|p| js_trim(p.as_ref()))
            .filter(|p| !p.is_empty())
            .map(|p| {
                let p = p.replace('\\', "/");
                let p = p.strip_prefix("./").unwrap_or(&p);
                let p = p.trim_end_matches('/');
                let full = if p.contains('/') {
                    p.to_owned()
                } else {
                    format!("**/{p}")
                };
                Glob::compile(&full.encode_utf16().collect::<Vec<_>>())
            })
            .collect();
        Excluder { globs }
    }

    pub fn is_excluded(&self, rel: &str) -> bool {
        let units: Vec<u16> = rel.encode_utf16().collect();
        let mut end = 0;
        loop {
            let next = units[end..]
                .iter()
                .position(|u| *u == SLASH)
                .map(|i| end + i);
            let prefix = &units[..next.unwrap_or(units.len())];
            if self.globs.iter().any(|g| g.matches(prefix)) {
                return true;
            }
            match next {
                Some(i) => end = i + 1,
                None => return false,
            }
        }
    }
}
