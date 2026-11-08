//! The allow list, judged as `accountRefusal` in `hub/hub.js` judges it.

use lanhub_core::allow;
use lanhub_protocol::{Account, ErrorCode};

fn acct(provider: &str, label: &str) -> Account {
    Account {
        provider: provider.into(),
        label: label.into(),
    }
}

fn code(text: &str, account: Option<&Account>) -> Option<ErrorCode> {
    allow::judge(&allow::entries(text), account).map(|e| e.code())
}

const LIST: &str = "# comment\r\ngithub:Alice\n  bob@corp.com  # any provider\n\n#github:mallory\n";

#[test]
fn allow_comment_lines_are_not_entries() {
    assert_eq!(allow::entries(LIST), ["github:alice", "bob@corp.com"]);
    assert_eq!(
        code(LIST, Some(&acct("github", "mallory"))),
        Some(ErrorCode::AccountDenied)
    );
    assert_eq!(
        code(LIST, Some(&acct("github", "comment"))),
        Some(ErrorCode::AccountDenied)
    );
}

#[test]
fn allow_matching_ignores_case() {
    assert_eq!(code(LIST, Some(&acct("GitHub", "ALICE"))), None);
    assert_eq!(code(LIST, Some(&acct("microsoft", "Bob@Corp.com"))), None);
}

#[test]
fn allow_provider_prefix_or_bare_label() {
    // A provider:label entry needs that provider; a bare label lets any provider in.
    assert_eq!(
        code(LIST, Some(&acct("microsoft", "alice"))),
        Some(ErrorCode::AccountDenied)
    );
    assert_eq!(code(LIST, Some(&acct("github", "bob@corp.com"))), None);
    let denied = allow::judge(&allow::entries(LIST), Some(&acct("github", "Mallory"))).unwrap();
    assert_eq!(
        serde_json::to_string(&denied).unwrap(),
        r#"{"code":"account_denied","data":{"account":"github:Mallory","entry":"github:Mallory"}}"#
    );
}

#[test]
fn allow_needs_an_account_when_the_list_has_entries() {
    assert_eq!(code(LIST, None), Some(ErrorCode::AccountRequired));
}

#[test]
fn allow_empty_file_lets_everyone_in() {
    assert_eq!(code("", None), None);
    assert_eq!(code("# nobody listed\n   \n", None), None);
    assert_eq!(code("# nobody listed\n", Some(&acct("github", "x"))), None);
}

#[tokio::test]
async fn allow_missing_file_lets_everyone_in() {
    let dir = std::env::temp_dir().join(format!(
        "lanhub-allow-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("allowed.txt");
    assert!(allow::check(&[], Some(&file), None).await.is_none());
    assert!(allow::check(&[], None, None).await.is_none());
    std::fs::write(&file, "github:alice\n").unwrap();
    assert!(allow::check(&[], Some(&file), None).await.is_some());
    assert!(
        allow::check(&[], Some(&file), Some(&acct("github", "alice")))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn allow_inline_entries_and_the_file_are_judged_together() {
    let dir = std::env::temp_dir().join(format!(
        "lanhub-allow-{}",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("allowed.txt");
    let inline = allow::entries("GitHub:Alice\n");
    let alice = acct("github", "alice");
    let bob = acct("microsoft", "bob");
    assert!(allow::check(&inline, None, Some(&alice)).await.is_none());
    assert!(allow::check(&inline, None, Some(&bob)).await.is_some());
    assert!(
        allow::check(&inline, Some(&file), Some(&bob))
            .await
            .is_some(),
        "a missing file adds nothing to a non-empty inline list"
    );
    std::fs::write(&file, "bob\n").unwrap();
    assert!(
        allow::check(&inline, Some(&file), Some(&bob))
            .await
            .is_none()
    );
    assert!(
        allow::check(&inline, Some(&file), Some(&alice))
            .await
            .is_none()
    );
    assert!(allow::check(&inline, Some(&file), None).await.is_some());
}
