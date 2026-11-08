//! Invite codes (docs/protocol.md section 11), encoded byte for byte as `encodeInviteV3` in `lib/common.js`.

use lanhub_protocol::json::write_js_string;

const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// `buf.toString('base64url')`: no padding.
fn base64url(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..=chunk.len() {
            out.push(char::from(B64URL[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    out
}

fn js_string(s: &str) -> String {
    let mut out = String::new();
    write_js_string(&s.encode_utf16().collect::<Vec<u16>>(), &mut out);
    out
}

/// An `LC3-` code carrying every address of the hub and, with TLS on, the certificate fingerprint.
pub fn encode_v3(
    instance_id: &str,
    hosts: &[String],
    port: u16,
    project: &str,
    token: &str,
    fingerprint: Option<&str>,
) -> String {
    let hosts: Vec<String> = hosts.iter().map(|h| js_string(h)).collect();
    let f = fingerprint
        .map(|f| format!(",\"f\":{}", js_string(f)))
        .unwrap_or_default();
    let j = format!(
        "{{\"v\":3,\"i\":{},\"a\":[{}],\"p\":{port},\"n\":{},\"t\":{}{f}}}",
        js_string(instance_id),
        hosts.join(","),
        js_string(project),
        js_string(token)
    );
    format!("LC3-{}", base64url(j.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v3_matches_the_protocol_example() {
        let hosts = ["192.168.1.10".to_owned(), "10.0.0.5".to_owned()];
        assert_eq!(
            encode_v3(
                "0b6f2c7e-6f0e-4c3a-9a51-2f1d8e7c4b10",
                &hosts,
                8200,
                "MyProject",
                "5f0c9e",
                None
            ),
            "LC3-eyJ2IjozLCJpIjoiMGI2ZjJjN2UtNmYwZS00YzNhLTlhNTEtMmYxZDhlN2M0YjEwIiwiYSI6WyIxOTIuMTY4LjEuMTAiLCIxMC4wLjAuNSJdLCJwIjo4MjAwLCJuIjoiTXlQcm9qZWN0IiwidCI6IjVmMGM5ZSJ9"
        );
    }

    #[test]
    fn v3_carries_the_fingerprint_last() {
        let fp = "ab".repeat(32);
        let code = encode_v3(
            "i",
            &["hub.example.com".to_owned()],
            8200,
            "P",
            "t",
            Some(&fp),
        );
        // encodeInviteV3({instanceId:'i', hosts:['hub.example.com'], port:8200, project:'P', token:'t', fingerprint}) in lib/common.js
        assert_eq!(
            code,
            format!(
                "LC3-{}",
                base64url(
                    format!(
                        "{{\"v\":3,\"i\":\"i\",\"a\":[\"hub.example.com\"],\"p\":8200,\"n\":\"P\",\"t\":\"t\",\"f\":\"{fp}\"}}"
                    )
                    .as_bytes()
                )
            )
        );
    }
}
