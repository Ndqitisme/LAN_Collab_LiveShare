//! `safeRel` and `UNSAFE_SEGMENT` from `lib/common.js`. The regular expression is matched over UTF-16 units
//! as JavaScript does, including its quirk that `.` does not match a line terminator.

/// `.` in a JavaScript regular expression without the `s` flag does not match these.
fn is_line_terminator(u: u16) -> bool {
    matches!(u, 0x0a | 0x0d | 0x2028 | 0x2029)
}

fn no_line_terminator(s: &[u16]) -> bool {
    !s.iter().any(|u| is_line_terminator(*u))
}

fn forbidden(u: u16) -> bool {
    matches!(u, 0x00..=0x1f) || b"<>:\"|?*".iter().any(|b| u == u16::from(*b))
}

fn is_digit(u: u16) -> bool {
    (0x30..=0x39).contains(&u)
}

/// `UNSAFE_SEGMENT.test(seg)`:
/// `^(?:\.{1,2}|.*[<>:"|?*\x00-\x1f].*|.*[. ]|[^~]{1,6}~\d+(?:\.[^.]{0,3})?|(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?)$` with `i`.
pub fn unsafe_segment(seg: &str) -> bool {
    if seg == "." || seg == ".." {
        return true;
    }
    let u: Vec<u16> = seg.encode_utf16().collect();
    let n = u.len();
    let forbidden_char = (0..n)
        .any(|i| forbidden(u[i]) && no_line_terminator(&u[..i]) && no_line_terminator(&u[i + 1..]));
    let trailing_dot_or_space = n > 0
        && (u[n - 1] == u16::from(b'.') || u[n - 1] == u16::from(b' '))
        && no_line_terminator(&u[..n - 1]);
    forbidden_char || trailing_dot_or_space || short_name(&u) || device_name(&u)
}

/// `[^~]{1,6}~\d+(?:\.[^.]{0,3})?` over the whole segment: an 8.3 short name such as `GIT~1`.
fn short_name(u: &[u16]) -> bool {
    let Some(tilde) = u.iter().position(|x| *x == u16::from(b'~')) else {
        return false;
    };
    if !(1..=6).contains(&tilde) {
        return false;
    }
    let digits = u[tilde + 1..].iter().take_while(|x| is_digit(**x)).count();
    if digits == 0 {
        return false;
    }
    match &u[tilde + 1 + digits..] {
        [] => true,
        [dot, ext @ ..] => {
            *dot == u16::from(b'.') && ext.len() <= 3 && !ext.contains(&u16::from(b'.'))
        }
    }
}

/// `(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?` over the whole segment. JavaScript's case folding never maps
/// a non-ASCII character onto these ASCII letters, so ASCII folding is exact.
fn device_name(u: &[u16]) -> bool {
    let lower: Vec<u16> = u
        .iter()
        .map(|x| {
            if (0x41..=0x5a).contains(x) {
                x + 32
            } else {
                *x
            }
        })
        .collect();
    let starts =
        |s: &[u8]| lower.len() >= s.len() && lower.iter().zip(s).all(|(a, b)| *a == u16::from(*b));
    let stem = if ["con", "prn", "aux", "nul"]
        .iter()
        .any(|s| starts(s.as_bytes()))
    {
        3
    } else if (starts(b"com") || starts(b"lpt")) && lower.len() > 3 && is_digit(lower[3]) {
        4
    } else {
        return false;
    };
    match &u[stem..] {
        [] => true,
        [dot, rest @ ..] => *dot == u16::from(b'.') && no_line_terminator(rest),
    }
}

/// `safeRel(p)`: the project-relative path with `/` separators, or `None` when the path is not safe.
pub fn safe_rel(p: &str) -> Option<String> {
    if p.is_empty() {
        return None;
    }
    let rel = p.replace('\\', "/");
    let b = rel.as_bytes();
    if rel.starts_with('/') || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':') {
        return None;
    }
    if rel.split('/').any(|s| s.is_empty() || unsafe_segment(s)) {
        return None;
    }
    Some(rel)
}
