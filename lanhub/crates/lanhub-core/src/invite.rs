//! Invite codes (docs/protocol.md section 11), encoded byte for byte as `encodeInvite` and `encodeInviteV3`
//! in `lib/common.js`.

use std::net::Ipv4Addr;

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

fn is_lower_hex_bytes(token: &str) -> bool {
    token.len().is_multiple_of(2)
        && token
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// A legacy `LC-` code for one IPv4 address: the binary version 1 when the token is lowercase hex of at
/// most 255 bytes, else version 2 (JSON).
pub fn encode_v1(host: Ipv4Addr, port: u16, project: &str, token: &str) -> String {
    let mut buf = Vec::new();
    if is_lower_hex_bytes(token) && token.len() <= 510 {
        buf.push(1);
        buf.extend_from_slice(&host.octets());
        buf.extend_from_slice(&port.to_be_bytes());
        buf.push((token.len() / 2) as u8);
        for i in (0..token.len()).step_by(2) {
            buf.push(u8::from_str_radix(&token[i..i + 2], 16).expect("checked hex"));
        }
        buf.extend_from_slice(project.as_bytes());
    } else {
        buf.push(2);
        let j = format!(
            "{{\"h\":{},\"p\":{port},\"n\":{},\"t\":{}}}",
            js_string(&host.to_string()),
            js_string(project),
            js_string(token)
        );
        buf.extend_from_slice(j.as_bytes());
    }
    format!("LC-{}", base64url(&buf))
}

/// An `LC3-` code carrying every address of the hub.
pub fn encode_v3(
    instance_id: &str,
    hosts: &[String],
    port: u16,
    project: &str,
    token: &str,
) -> String {
    let hosts: Vec<String> = hosts.iter().map(|h| js_string(h)).collect();
    let j = format!(
        "{{\"v\":3,\"i\":{},\"a\":[{}],\"p\":{port},\"n\":{},\"t\":{}}}",
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
    fn v1_matches_lib_common() {
        let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        assert_eq!(
            encode_v1(ip("192.168.1.10"), 8200, "Dự án", "5f0c9e"),
            "LC-AcCoAQogCANfDJ5E4buxIMOhbg"
        );
        assert_eq!(
            encode_v1(ip("10.0.0.5"), 65535, "Demo", ""),
            "LC-AQoAAAX__wBEZW1v"
        );
        assert_eq!(
            encode_v1(ip("10.0.0.5"), 8200, "Demo \"x\"\n", "Secret"),
            "LC-AnsiaCI6IjEwLjAuMC41IiwicCI6ODIwMCwibiI6IkRlbW8gXCJ4XCJcbiIsInQiOiJTZWNyZXQifQ"
        );
    }

    #[test]
    fn v3_matches_the_protocol_example() {
        let hosts = ["192.168.1.10".to_owned(), "10.0.0.5".to_owned()];
        assert_eq!(
            encode_v3(
                "0b6f2c7e-6f0e-4c3a-9a51-2f1d8e7c4b10",
                &hosts,
                8200,
                "MyProject",
                "5f0c9e"
            ),
            "LC3-eyJ2IjozLCJpIjoiMGI2ZjJjN2UtNmYwZS00YzNhLTlhNTEtMmYxZDhlN2M0YjEwIiwiYSI6WyIxOTIuMTY4LjEuMTAiLCIxMC4wLjAuNSJdLCJwIjo4MjAwLCJuIjoiTXlQcm9qZWN0IiwidCI6IjVmMGM5ZSJ9"
        );
    }
}
