//! One connection: a reader task (this one) that frames and parses lines, runs the handshake and forwards
//! member messages to the project actor, and a writer task that drains a bounded queue to the socket.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use lanhub_protocol::json::{self, JsStr, Json};
use lanhub_protocol::{
    Account, HubError, HubMessage, LEGACY_PROTOCOL_LINE, PROTO_MAX, PROTO_MIN, ProbeResult,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::net::tcp::OwnedWriteHalf;
use tokio::sync::{mpsc, watch};
use tokio::time::{Instant, sleep_until};

use crate::framing::{LineDecoder, MAX_LINE, PREAUTH_MAX_LINE, Tail};
use crate::project::{ActorMsg, JoinRequest, Line, ProjectInfo, line};
use crate::util::{log, now_ms, random_uuid, sha1_hex};

pub const HELLO_TIMEOUT: Duration = Duration::from_secs(15);
const KEEPALIVE_EVERY: Duration = Duration::from_secs(5);
/// A member whose queue holds more than this, or whose socket accepted nothing for `STALL_MS` while data
/// waited, is too slow to keep. Counting bytes rather than messages lets a first sync queue thousands of
/// files without tripping it; the limit sits above `MAX_LINE`, the largest single message.
pub const MAX_QUEUED_BYTES: usize = 512 * 1024 * 1024;
pub const STALL_MS: u64 = 30_000;
const READ_CHUNK: usize = 64 * 1024;
const COALESCE: usize = 64 * 1024;
const WRITE_CHUNK: usize = 256 * 1024;

/// The project a connection talks to: its fixed facts and the actor's inbox.
#[derive(Clone)]
pub struct ProjectHandle {
    pub info: Arc<ProjectInfo>,
    pub inbox: mpsc::Sender<ActorMsg>,
}

/// Milliseconds on a monotonic clock, so a change of the wall clock never looks like a stall.
fn mono_ms() -> u64 {
    static START: OnceLock<std::time::Instant> = OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis() as u64
}

#[derive(Default)]
struct Backlog {
    bytes: AtomicUsize,
    /// When the writer last made progress, or when the queue last became non-empty (`mono_ms`).
    since: AtomicU64,
}

/// What the project holds of a connection: its outgoing queue and the switch that closes it.
#[derive(Clone)]
pub struct Conn {
    tx: mpsc::UnboundedSender<Line>,
    backlog: Arc<Backlog>,
    close: Arc<watch::Sender<bool>>,
}

impl Conn {
    /// Queues a line. `false` means the member is too slow to keep; the line is dropped.
    pub fn send(&self, l: Line) -> bool {
        let now = mono_ms();
        let queued = self.backlog.bytes.load(Ordering::Acquire);
        if queued == 0 {
            // Set before the bytes are counted, so a concurrent sender never sees bytes with an old time.
            self.backlog.since.store(now, Ordering::Release);
        } else {
            let stalled = now.saturating_sub(self.backlog.since.load(Ordering::Acquire)) > STALL_MS;
            if queued > MAX_QUEUED_BYTES || stalled {
                return false;
            }
        }
        self.backlog.bytes.fetch_add(l.len(), Ordering::AcqRel);
        // An error means the writer is gone and the session is ending; its Leave follows.
        let _ = self.tx.send(l);
        true
    }

    pub fn close(&self) {
        let _ = self.close.send(true);
    }
}

enum Hello {
    /// Answer with this line, then close.
    Refuse(Line),
    Accept(JoinRequest),
}

/// The checks of docs/protocol.md section 3.3, in order. The allow list arrives in A3, so the account step
/// always passes here.
fn steps(info: &ProjectInfo, m: &Json) -> (ProbeResult, Option<HubError>) {
    let mut r = ProbeResult {
        proto_ok: m.get("proto").and_then(Json::as_f64) == Some(2.0),
        project_ok: None,
        token_ok: None,
        account_ok: None,
        projects: vec![info.name.clone()],
        hub_id: None,
        hub_name: info.hub_name.clone(),
        instance_id: info.instance_id.clone(),
        hub_min: PROTO_MIN,
        hub_max: PROTO_MAX,
        account_error: None,
    };
    if !r.proto_ok {
        return (
            r,
            Some(HubError::ProtocolVersion {
                hub_min: PROTO_MIN,
                hub_max: PROTO_MAX,
            }),
        );
    }
    let project = m
        .get("project")
        .filter(|v| v.truthy())
        .map(Json::to_js_string);
    let project_ok = project
        .as_ref()
        .and_then(JsStr::as_str)
        .unwrap_or("")
        .to_lowercase()
        == info.name.to_lowercase();
    r.project_ok = Some(project_ok);
    if !project_ok {
        return (
            r,
            Some(HubError::ProjectUnknown {
                projects: vec![info.name.clone()],
            }),
        );
    }
    r.hub_id = Some(info.hub_id.clone());
    let token_ok =
        info.token.is_empty() || m.get("token").and_then(Json::as_str) == Some(info.token.as_str());
    r.token_ok = Some(token_ok);
    if !token_ok {
        return (r, Some(HubError::TokenInvalid {}));
    }
    r.account_ok = Some(true);
    (r, None)
}

/// `hello.account` as the Node hub normalizes it: only an object with a non-empty string `label` counts.
fn account(m: &Json) -> Option<Account> {
    let a = m.get("account").filter(|a| a.is_js_object())?;
    let label = a
        .get("label")
        .and_then(Json::as_js_str)
        .filter(|l| !l.is_empty())?;
    let provider = a
        .get("provider")
        .filter(|p| p.truthy())
        .map(Json::to_js_string)
        .unwrap_or_else(|| "".into());
    Some(Account {
        provider: provider.truncate_units(20),
        label: label.truncate_units(100),
    })
}

fn hello(info: &ProjectInfo, m: &Json, key: u64, conn: &Conn, addr: &SocketAddr) -> Hello {
    let proto = m.get("proto").and_then(Json::as_js_integer);
    if !proto.is_some_and(|p| p >= 2.0) {
        log(format!("Từ chối {}: protocol 1", addr.ip()));
        return Hello::Refuse(format!("{LEGACY_PROTOCOL_LINE}\n").into_bytes().into());
    }
    let (probe, refusal) = steps(info, m);
    if m.get("probe").is_some_and(Json::truthy) {
        return Hello::Refuse(line(&HubMessage::ProbeResult(probe)));
    }
    let account = account(m);
    if let Some(e) = refusal {
        log(format!("Từ chối {}: {:?}", addr.ip(), e.code()));
        return Hello::Refuse(line(&HubMessage::Error(e)));
    }
    let truthy = |k: &str| m.get(k).filter(|v| v.truthy());
    let name = truthy("name")
        .map(Json::to_js_string)
        .or_else(|| account.as_ref().map(|a| a.label.clone()))
        .unwrap_or_else(|| "ẩn danh".into())
        .truncate_units(60);
    let uid = truthy("uid")
        .map(Json::to_js_string)
        .unwrap_or_else(|| "".into());
    let seed = truthy("device")
        .or_else(|| truthy("uid"))
        .map(Json::to_js_string)
        .unwrap_or_else(|| random_uuid().into());
    let chat_key = sha1_hex(format!("chat:{}", seed.to_utf8_lossy()).as_bytes())[..16].to_owned();
    Hello::Accept(JoinRequest {
        key,
        conn: conn.clone(),
        uid,
        name,
        account,
        chat_key,
        addr: addr.ip().to_string(),
    })
}

async fn closed(rx: &mut watch::Receiver<bool>) {
    let _ = rx.wait_for(|c| *c).await;
}

fn is_message(m: &Json) -> bool {
    m.is_object() && m.get("t").and_then(Json::as_js_str).is_some()
}

pub async fn serve(stream: TcpStream, addr: SocketAddr, project: ProjectHandle, key: u64) {
    let _ = stream.set_nodelay(true);
    let keepalive = socket2::TcpKeepalive::new().with_time(Duration::from_secs(10));
    let _ = socket2::SockRef::from(&stream).set_tcp_keepalive(&keepalive);
    let (mut rd, wr) = stream.into_split();
    let (tx, rx) = mpsc::unbounded_channel::<Line>();
    let (close_tx, mut close_rx) = watch::channel(false);
    let conn = Conn {
        tx,
        backlog: Arc::default(),
        close: Arc::new(close_tx),
    };
    tokio::spawn(write_loop(wr, rx, conn.backlog.clone(), conn.close.clone()));

    let mut dec = LineDecoder::new(PREAUTH_MAX_LINE);
    let mut joined = false;
    let deadline = Instant::now() + HELLO_TIMEOUT;
    let mut last_keepalive: Option<Instant> = None;
    let mut buf = vec![0u8; READ_CHUNK];
    'conn: loop {
        let n = tokio::select! {
            biased;
            _ = closed(&mut close_rx) => break,
            _ = sleep_until(deadline), if !joined => {
                conn.close();
                break;
            }
            r = rd.read(&mut buf) => match r {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            },
        };
        for raw in dec.push(&buf[..n]) {
            let parsed = json::parse(&raw);
            if joined {
                if let Some(m) = parsed.ok().filter(is_message)
                    && project
                        .inbox
                        .send(ActorMsg::Client { key, msg: m })
                        .await
                        .is_err()
                {
                    break 'conn;
                }
                continue;
            }
            // Before the hello, a line that is not JSON is skipped; anything else but a hello closes.
            let Ok(m) = parsed else { continue };
            if !is_message(&m) || m.get("t").and_then(Json::as_str) != Some("hello") {
                conn.close();
                break 'conn;
            }
            match hello(&project.info, &m, key, &conn, &addr) {
                Hello::Refuse(l) => {
                    conn.send(l);
                    break 'conn;
                }
                Hello::Accept(req) => {
                    if project.inbox.send(ActorMsg::Join(req)).await.is_err() {
                        break 'conn;
                    }
                    joined = true;
                    dec.limit = MAX_LINE;
                }
            }
        }
        match dec.tail() {
            Tail::Overflow => {
                log(format!(
                    "[CẢNH BÁO] {}: dòng dài quá {} ký tự, đóng kết nối",
                    addr.ip(),
                    dec.limit
                ));
                conn.close();
                break;
            }
            // A big upload keeps the member's own messages (and our pongs) waiting: show it the link is alive.
            Tail::Partial
                if joined && last_keepalive.is_none_or(|t| t.elapsed() > KEEPALIVE_EVERY) =>
            {
                last_keepalive = Some(Instant::now());
                conn.send(line(&HubMessage::Pong { ts: now_ms() }));
            }
            _ => {}
        }
    }
    if joined {
        let _ = project.inbox.send(ActorMsg::Leave { key }).await;
    }
}

/// Writes queued lines, several at a time when they are small. Ends when every sender is gone (after the
/// queue drains, then a FIN), or at once when the connection is closed.
async fn write_loop(
    mut wr: OwnedWriteHalf,
    mut rx: mpsc::UnboundedReceiver<Line>,
    backlog: Arc<Backlog>,
    close: Arc<watch::Sender<bool>>,
) {
    let mut close_rx = close.subscribe();
    let mut batch = Vec::new();
    loop {
        let first = tokio::select! {
            biased;
            _ = closed(&mut close_rx) => return,
            l = rx.recv() => match l {
                Some(l) => l,
                None => {
                    let _ = wr.shutdown().await;
                    return;
                }
            },
        };
        let data: &[u8] = if first.len() >= COALESCE {
            &first
        } else {
            batch.clear();
            batch.extend_from_slice(&first);
            while batch.len() < COALESCE {
                match rx.try_recv() {
                    Ok(l) => batch.extend_from_slice(&l),
                    Err(_) => break,
                }
            }
            &batch
        };
        // Progress is noted per chunk, so a large file going out over a slow link never looks stalled.
        for chunk in data.chunks(WRITE_CHUNK) {
            let written = tokio::select! {
                biased;
                _ = closed(&mut close_rx) => return,
                r = wr.write_all(chunk) => r,
            };
            if written.is_err() {
                let _ = close.send(true);
                return;
            }
            backlog.since.store(mono_ms(), Ordering::Release);
        }
        backlog.bytes.fetch_sub(data.len(), Ordering::AcqRel);
    }
}
