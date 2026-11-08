//! The HTTP diagnosis page (docs/protocol.md section 13.2). A connection that opens with an HTTP request
//! line gets one fixed page saying the hub runs, then the hub closes it. The page lets a user tell a network
//! fault from an extension fault with nothing but a browser. Whatever the path, the hub answers the same
//! page and reads no file; the page holds only what LAN discovery already tells anyone on the network
//! (no token, folder, or member).

use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::time::{Instant, timeout_at};

/// The request line and headers are read up to this size; the rest is never read.
pub const MAX_REQUEST: usize = 8 * 1024;
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// The longest method with its space, `OPTIONS `/`CONNECT `: enough bytes to decide.
pub const SNIFF_BYTES: usize = 8;

const METHODS: [&[u8]; 9] = [
    b"GET ",
    b"HEAD ",
    b"POST ",
    b"PUT ",
    b"DELETE ",
    b"OPTIONS ",
    b"PATCH ",
    b"CONNECT ",
    b"TRACE ",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Head,
    /// Any other method: `405`.
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sniff {
    /// The bytes so far could still start an HTTP request line.
    NeedMore,
    Http(Method),
    /// Not HTTP: a protocol client.
    Other,
}

/// Decides from the first bytes of a connection whether it is an HTTP request.
pub fn sniff(prefix: &[u8]) -> Sniff {
    let mut maybe = false;
    for m in METHODS {
        if prefix.starts_with(m) {
            return Sniff::Http(match m {
                b"GET " => Method::Get,
                b"HEAD " => Method::Head,
                _ => Method::Other,
            });
        }
        maybe |= m.starts_with(prefix);
    }
    if maybe { Sniff::NeedMore } else { Sniff::Other }
}

/// What the page shows.
pub struct PageFacts<'a> {
    pub hub_name: &'a str,
    pub hub_version: &'a str,
    pub uptime_ms: u64,
    /// Projects with `advertise = true`.
    pub projects: &'a [String],
    pub tls_fingerprint: Option<&'a str>,
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

fn uptime(ms: u64) -> String {
    let m = ms / 60_000;
    let (d, h, m) = (m / 1440, m / 60 % 24, m % 60);
    match (d, h, m) {
        (0, 0, 0) => "dưới 1 phút".to_owned(),
        (0, 0, m) => format!("{m} phút"),
        (0, h, m) => format!("{h} giờ {m} phút"),
        (d, h, _) => format!("{d} ngày {h} giờ"),
    }
}

pub fn page(f: &PageFacts) -> String {
    let tls = match f.tls_fingerprint {
        Some(fp) => format!("Bật. Vân tay SHA-256: <code>{}</code>", escape(fp)),
        None => "Tắt".to_owned(),
    };
    let projects = if f.projects.is_empty() {
        "<p>Không có dự án công khai. Dự án không công khai vẫn tham gia được bằng mã mời.</p>"
            .to_owned()
    } else {
        let items: String = f
            .projects
            .iter()
            .map(|p| format!("<li>{}</li>", escape(p)))
            .collect();
        format!("<ul>{items}</ul>")
    };
    format!(
        r#"<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LAN Hub {name}</title>
<style>
:root {{ color-scheme: light dark; --fg: #1b1f24; --muted: #57606a; --bg: #ffffff; --line: #d0d7de; --ok: #1a7f37; }}
@media (prefers-color-scheme: dark) {{ :root {{ --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --line: #30363d; --ok: #3fb950; }} }}
body {{ margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }}
main {{ max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }}
h1 {{ font-size: 1.5rem; margin: 0 0 .25rem; }}
h1::before {{ content: ""; display: inline-block; width: .6em; height: .6em; border-radius: 50%; background: var(--ok); margin-right: .5em; vertical-align: .1em; }}
h2 {{ font-size: 1.05rem; margin: 1.75rem 0 .5rem; }}
p.lead {{ color: var(--muted); margin: 0 0 1.25rem; }}
dl {{ display: grid; grid-template-columns: max-content 1fr; gap: .4rem 1rem; margin: 0; padding: 1rem 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }}
dt {{ color: var(--muted); }}
dd {{ margin: 0; overflow-wrap: anywhere; }}
code {{ font: 13px ui-monospace, Consolas, monospace; overflow-wrap: anywhere; }}
ul, ol {{ margin: 0; padding-left: 1.4rem; }}
</style>
</head>
<body>
<main>
<h1>LAN Hub đang chạy</h1>
<p class="lead">Trình duyệt mở được trang này, nên mạng từ máy này tới LAN Hub thông suốt.</p>
<dl>
<dt>Tên LAN Hub</dt><dd>{name}</dd>
<dt>Phiên bản</dt><dd>{version}</dd>
<dt>Thời gian chạy</dt><dd>{uptime}</dd>
<dt>Kết nối mã hoá (TLS)</dt><dd>{tls}</dd>
</dl>
<h2>Dự án công khai</h2>
{projects}
<h2>Cách kết nối</h2>
<ol>
<li>Lấy mã mời từ người quản trị LAN Hub hoặc từ một thành viên của dự án.</li>
<li>Trong VS Code, chạy lệnh <b>LAN Collab: Tham gia bằng mã mời</b> rồi dán mã mời.</li>
<li>Nếu VS Code vẫn không kết nối được, chạy <b>LAN Collab: Chẩn đoán kết nối</b>.</li>
</ol>
</main>
</body>
</html>
"#,
        name = escape(f.hub_name),
        version = escape(f.hub_version),
        uptime = uptime(f.uptime_ms),
    )
}

/// The whole HTTP/1.1 response for `method`.
pub fn response(method: Method, facts: &PageFacts) -> Vec<u8> {
    let (status, body, ctype) = match method {
        Method::Get | Method::Head => ("200 OK", page(facts), "text/html; charset=utf-8"),
        Method::Other => (
            "405 Method Not Allowed",
            "405 Method Not Allowed\n".to_owned(),
            "text/plain; charset=utf-8",
        ),
    };
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nAllow: GET, HEAD\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    if method != Method::Head {
        out.extend_from_slice(body.as_bytes());
    }
    out
}

fn head_complete(b: &[u8]) -> bool {
    b.windows(4).any(|w| w == b"\r\n\r\n") || b.windows(2).any(|w| w == b"\n\n")
}

/// Reads the rest of the request head (up to `MAX_REQUEST` bytes or `deadline`), answers, and closes. The
/// head is not parsed: every request gets the same answer.
pub async fn serve<S: AsyncRead + AsyncWrite + Unpin>(
    mut s: S,
    mut head: Vec<u8>,
    method: Method,
    facts: &PageFacts<'_>,
    deadline: Instant,
) {
    let mut buf = [0u8; 2048];
    while head.len() < MAX_REQUEST && !head_complete(&head) {
        match timeout_at(deadline, s.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => head.extend_from_slice(&buf[..n]),
            _ => break,
        }
    }
    let _ = timeout_at(Instant::now() + WRITE_TIMEOUT, async {
        s.write_all(&response(method, facts)).await?;
        s.shutdown().await
    })
    .await;
}
