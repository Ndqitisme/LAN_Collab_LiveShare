//! The JSON lines lanhub writes, compared with what the former Node hub writes for the same message.

use lanhub_ot::TextOperation;
use lanhub_protocol::json::{self, JsNumber, JsStr, Json};
use lanhub_protocol::*;

fn s(m: &HubMessage) -> String {
    serde_json::to_string(m).unwrap()
}

#[test]
fn errors_match_the_node_hub() {
    assert_eq!(
        s(&HubMessage::Error(HubError::TokenInvalid {})),
        r#"{"t":"error","code":"token_invalid","data":{}}"#
    );
    assert_eq!(
        s(&HubMessage::Error(HubError::ProtocolVersion {
            hub_min: 2,
            hub_max: 2
        })),
        r#"{"t":"error","code":"protocol_version","data":{"hubMin":2,"hubMax":2}}"#
    );
    assert_eq!(
        s(&HubMessage::Error(HubError::ProjectUnknown {
            projects: vec!["Demo".into()]
        })),
        r#"{"t":"error","code":"project_unknown","data":{"projects":["Demo"]}}"#
    );
    assert_eq!(
        s(&HubMessage::Error(HubError::AccountDenied {
            account: "github:m".into(),
            entry: "github:m".into(),
            file: None
        })),
        r#"{"t":"error","code":"account_denied","data":{"account":"github:m","entry":"github:m"}}"#
    );
    let legacy = json::parse(LEGACY_PROTOCOL_LINE.as_bytes()).unwrap();
    assert_eq!(
        legacy.get("code").and_then(Json::as_str),
        Some("protocol_version")
    );
}

#[test]
fn probe_result_keeps_null_steps_and_the_node_field_order() {
    let r = ProbeResult {
        proto_ok: true,
        project_ok: Some(true),
        token_ok: Some(false),
        account_ok: None,
        projects: vec!["Demo".into()],
        hub_id: Some("h".into()),
        hub_name: "box".into(),
        instance_id: "i".into(),
        hub_min: 2,
        hub_max: 2,
        account_error: None,
    };
    assert_eq!(
        s(&HubMessage::ProbeResult(r)),
        r#"{"t":"probe_result","proto_ok":true,"project_ok":true,"token_ok":false,"account_ok":null,"projects":["Demo"],"hubId":"h","hubName":"box","instanceId":"i","hubMin":2,"hubMax":2}"#
    );
}

#[test]
fn file_messages_match_the_node_hub() {
    let text = |t: &str| {
        FileBody::Content(FileContent::Text {
            rev: 3,
            text: t.into(),
        })
    };
    assert_eq!(
        s(&HubMessage::File(FileMessage {
            path: "a.txt".into(),
            body: text("x\n")
        })),
        r#"{"t":"file","path":"a.txt","kind":"text","rev":3,"text":"x\n"}"#
    );
    let blob = FileBody::Content(FileContent::Blob {
        hash: "ab".into(),
        b64: "AAE=".into(),
    });
    assert_eq!(
        s(&HubMessage::File(FileMessage {
            path: "d.bin".into(),
            body: blob
        })),
        r#"{"t":"file","path":"d.bin","kind":"blob","hash":"ab","b64":"AAE="}"#
    );
    assert_eq!(
        s(&HubMessage::File(FileMessage {
            path: "x".into(),
            body: FileBody::Missing { missing: true }
        })),
        r#"{"t":"file","path":"x","missing":true}"#
    );
}

#[test]
fn ops_keep_lone_surrogates_as_escapes() {
    let mut op = TextOperation::new();
    op.retain(2).insert(&[0x61, 0xd83d]).delete(1);
    let m = HubMessage::Op {
        path: "a".into(),
        rev: 4,
        op: WireOp(op),
        by: "1234abcd".into(),
    };
    assert_eq!(
        s(&m),
        r#"{"t":"op","path":"a","rev":4,"op":[2,"a\ud83d",-1],"by":"1234abcd"}"#
    );
    let text = FileBody::Content(FileContent::Text {
        rev: 0,
        text: JsStr::from_units(&[0xdc00]),
    });
    assert_eq!(
        s(&HubMessage::File(FileMessage {
            path: "a".into(),
            body: text
        })),
        r#"{"t":"file","path":"a","kind":"text","rev":0,"text":"\udc00"}"#
    );
}

#[test]
fn echoed_paths_keep_their_json_type() {
    assert_eq!(s(&HubMessage::Nack { path: None }), r#"{"t":"nack"}"#);
    assert_eq!(
        s(&HubMessage::Nack {
            path: Some(Json::Num(5.0))
        }),
        r#"{"t":"nack","path":5}"#
    );
    assert_eq!(
        s(&HubMessage::Ignored {
            path: Some(Json::Str("../x".into())),
            reason: IgnoredReason::WriteFailed
        }),
        r#"{"t":"ignored","path":"../x","reason":"write-failed"}"#
    );
}

#[test]
fn activity_and_presence_match_the_node_hub() {
    let a = Activity {
        ts: 1,
        who: "ann".into(),
        color: "#e6194b".into(),
        kind: ActivityKind::EditDisk,
        path: Some("a.txt".into()),
        text: None,
        addr: None,
    };
    assert_eq!(
        s(&HubMessage::Activity { a }),
        r##"{"t":"activity","a":{"ts":1,"who":"ann","color":"#e6194b","kind":"edit_disk","path":"a.txt"}}"##
    );
    let p = Presence {
        file: None,
        sel: vec![json::parse(b"[1,2]").unwrap()],
        line: JsNumber(1.5),
        debug: Some("m".into()),
        rtt: Some(JsNumber(12.0)),
    };
    assert_eq!(
        s(&HubMessage::Presence { id: "x".into(), p }),
        r#"{"t":"presence","id":"x","p":{"file":null,"sel":[[1,2]],"line":1.5,"debug":"m","rtt":12}}"#
    );
}

#[test]
fn client_messages_from_the_protocol_document_parse() {
    for line in [
        r#"{"t":"hello","proto":2,"project":"Demo","token":"tk","name":"ann","uid":"u1","device":null,"account":{"provider":"github","label":"alice"}}"#,
        r#"{"t":"hello","proto":2,"project":"Demo","probe":true}"#,
        r#"{"t":"op","path":"a.txt","rev":3,"op":[3,"d",-1],"seq":1,"src":"revert","reverts":"run-1"}"#,
        r#"{"t":"create","path":"b.txt","kind":"text","text":"x"}"#,
        r#"{"t":"put","path":"c.bin","b64":"AA=="}"#,
        r#"{"t":"check","path":"a.txt","rev":3,"hash":"00"}"#,
        r#"{"t":"presence","p":{"file":"a.txt","sel":[[0,0]],"line":1,"debug":null,"rtt":4}}"#,
        r#"{"t":"chat","text":"hi","image":{"mime":"image/png","b64":"AA==","w":1,"h":1}}"#,
        r#"{"t":"ping"}"#,
    ] {
        let m: ClientMessage = serde_json::from_str(line).unwrap_or_else(|e| panic!("{line}: {e}"));
        let back = serde_json::to_string(&m).unwrap();
        let again: ClientMessage = serde_json::from_str(&back).unwrap();
        assert_eq!(m, again);
    }
}
