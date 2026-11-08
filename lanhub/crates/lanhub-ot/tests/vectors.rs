//! Checks the port against the JSON vectors that `node tools/gen-ot-vectors.mjs` writes from `lib/ot.js`.
//! Expected ops are stored as the JavaScript `JSON.stringify` text and compared byte for byte.
//! `LANHUB_OT_VECTORS=<dir>` points the test at another vector directory (for example a `--large` run).

use std::path::PathBuf;

use lanhub_ot::{TextOperation, diff};
use serde_json::Value;

fn cases(file: &str) -> Vec<Value> {
    let dir = std::env::var_os("LANHUB_OT_VECTORS")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/vectors"));
    let path = dir.join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let mut doc: Value = serde_json::from_str(&text).unwrap();
    match doc["cases"].take() {
        Value::Array(cases) if !cases.is_empty() => cases,
        _ => panic!("{file} has no cases"),
    }
}

fn op(v: &Value) -> TextOperation {
    TextOperation::from_json(v).unwrap()
}

fn units(v: &Value) -> Vec<u16> {
    v.as_str().unwrap().encode_utf16().collect()
}

fn json(op: &TextOperation) -> String {
    serde_json::to_string(op).unwrap()
}

fn expected(v: &Value) -> &str {
    v.as_str().unwrap()
}

/// Runs `check` on every case and fails once at the end with the first few mismatches.
fn run(file: &str, check: impl Fn(&Value) -> Result<(), String>) {
    let cases = cases(file);
    let failures: Vec<String> = cases
        .iter()
        .enumerate()
        .filter_map(|(i, c)| check(c).err().map(|e| format!("case {i}: {e}")))
        .collect();
    assert!(
        failures.is_empty(),
        "{file}: {} of {} cases differ from lib/ot.js\n{}",
        failures.len(),
        cases.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    println!("{file}: {} cases passed", cases.len());
}

fn same(what: &str, got: &str, want: &str) -> Result<(), String> {
    if got == want {
        Ok(())
    } else {
        Err(format!("{what}: got {got}, want {want}"))
    }
}

#[test]
fn transform_vectors() {
    run("transform.json", |c| {
        let result = TextOperation::transform(&op(&c["a"]), &op(&c["b"]));
        if c["error"] == true {
            return match result {
                Err(_) => Ok(()),
                Ok(_) => Err("expected an error".into()),
            };
        }
        let (a2, b2) = result.map_err(|e| e.to_string())?;
        same("a'", &json(&a2), expected(&c["a2"]))?;
        same("b'", &json(&b2), expected(&c["b2"]))
    });
}

#[test]
fn compose_vectors() {
    run("compose.json", |c| {
        let result = op(&c["a"]).compose(&op(&c["b"]));
        if c["error"] == true {
            return match result {
                Err(_) => Ok(()),
                Ok(_) => Err("expected an error".into()),
            };
        }
        same(
            "compose",
            &json(&result.map_err(|e| e.to_string())?),
            expected(&c["result"]),
        )
    });
}

#[test]
fn apply_vectors() {
    run("apply.json", |c| {
        let o = op(&c["op"]);
        let result = o.apply(&units(&c["text"]));
        if c["error"] == true {
            return match result {
                Err(_) => Ok(()),
                Ok(_) => Err("expected an error".into()),
            };
        }
        if result.map_err(|e| e.to_string())? != units(&c["result"]) {
            return Err("apply output differs".into());
        }
        let index = c["index"].as_u64().unwrap() as usize;
        let moved = o.transform_index(index) as u64;
        same(
            "transformIndex",
            &moved.to_string(),
            &c["moved"].to_string(),
        )
    });
}

#[test]
fn diff_vectors() {
    run("diff.json", |c| {
        let (a, b) = (units(&c["a"]), units(&c["b"]));
        let d = diff(&a, &b);
        same("diff", &json(&d), expected(&c["op"]))?;
        if d.apply(&a).map_err(|e| e.to_string())? != b {
            return Err("diff does not turn a into b".into());
        }
        Ok(())
    });
}

#[test]
fn from_json_vectors() {
    run("fromjson.json", |c| {
        let input = expected(&c["input"]);
        let parsed = serde_json::from_str::<Value>(input)
            .map_err(|e| e.to_string())
            .and_then(|v| TextOperation::from_json(&v).map_err(|e| e.to_string()));
        match (parsed, c["ok"] == true) {
            (Ok(o), true) => same(input, &json(&o), expected(&c["ops"])),
            (Err(_), false) => Ok(()),
            (Ok(o), false) => Err(format!(
                "{input}: accepted as {}, JavaScript rejects it",
                json(&o)
            )),
            (Err(e), true) => Err(format!("{input}: rejected ({e}), JavaScript accepts it")),
        }
    });
}
