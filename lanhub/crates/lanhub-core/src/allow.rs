//! The account allow list (docs/protocol.md section 3.3), as `accountRefusal` in the former Node hub: one entry per
//! line, `#` starts a comment, matching ignores case and accepts `provider:label` or the bare label. A
//! missing, unreadable or empty list lets every token holder in. The file is read on every hello, so an
//! edit applies to the next join without a restart. `lanhub.toml` adds an inline list, judged together with the file.

use std::path::Path;

use lanhub_protocol::json::js_trim;
use lanhub_protocol::{Account, HubError};

/// `l.replace(/#.*/, '')`: `.` stops at a line terminator, and only the first `#` counts.
fn strip_comment(l: &str) -> String {
    let Some(hash) = l.find('#') else {
        return l.to_owned();
    };
    let end = l[hash..]
        .find(['\r', '\u{2028}', '\u{2029}'])
        .map_or(l.len(), |i| hash + i);
    format!("{}{}", &l[..hash], &l[end..])
}

/// The entries of an allow file's text, lowercased.
pub fn entries(text: &str) -> Vec<String> {
    text.split('\n')
        .map(|l| js_trim(&strip_comment(l.strip_suffix('\r').unwrap_or(l))).to_lowercase())
        .filter(|l| !l.is_empty())
        .collect()
}

/// The refusal for `account` under these entries, or `None` when it may join.
pub fn judge(entries: &[String], account: Option<&Account>) -> Option<HubError> {
    if entries.is_empty() {
        return None;
    }
    let Some(account) = account else {
        return Some(HubError::AccountRequired {});
    };
    let full = format!(
        "{}:{}",
        account.provider.to_utf8_lossy(),
        account.label.to_utf8_lossy()
    );
    // A string holding a lone surrogate cannot equal a line decoded from UTF-8.
    let full_ok = account.provider.as_str().is_some() && account.label.as_str().is_some();
    let label = account.label.as_str().map(str::to_lowercase);
    if (full_ok && entries.contains(&full.to_lowercase()))
        || label.is_some_and(|l| entries.contains(&l))
    {
        return None;
    }
    Some(HubError::AccountDenied {
        account: full.clone(),
        entry: full,
        file: None,
    })
}

/// Judges `account` against the inline entries (already through `entries`) plus those of the allow file,
/// re-read now. A file that is not configured or cannot be read adds nothing.
pub async fn check(
    inline: &[String],
    file: Option<&Path>,
    account: Option<&Account>,
) -> Option<HubError> {
    let from_file = match file {
        Some(f) => tokio::fs::read(f)
            .await
            .map(|b| entries(&String::from_utf8_lossy(&b)))
            .unwrap_or_default(),
        None => Vec::new(),
    };
    if from_file.is_empty() {
        return judge(inline, account);
    }
    judge(&[inline, &from_file].concat(), account)
}
