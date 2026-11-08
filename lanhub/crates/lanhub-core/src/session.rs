//! One connection: a reader task (this one) that frames and parses lines, runs the handshake and forwards
//! member messages to the project actor, and a writer task that drains a bounded queue to the socket.

use std::io::ErrorKind;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use lanhub_protocol::json::{self, JsStr, Json};
use lanhub_protocol::{
    Account, HubError, HubMessage, LEGACY_PROTOCOL_LINE, PROTO_MAX, PROTO_MIN, ProbeResult,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio::time::{Instant, sleep_until, timeout_at};

use crate::framing::{LineDecoder, MAX_LINE, PREAUTH_MAX_LINE, Tail};
use crate::logs::log_in;
use crate::project::{ActorMsg, JoinRequest, Line, ProjectInfo, line};
use crate::router::{Router, Table};
use crate::util::{log, now_ms, random_uuid};
use crate::{HUB_VERSION, admin_server, allow, chat, http_diag, tls};

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
    Accept(Box<JoinRequest>, ProjectHandle),
}

/// The checks of docs/protocol.md section 3.3, in order; the allow file is read only for a token holder.
/// The project is the one the hello names, from the router's current table.
async fn steps(
    table: &Table,
    m: &Json,
    account: Option<&Account>,
) -> (ProbeResult, Option<HubError>, Option<ProjectHandle>) {
    let mut r = ProbeResult {
        proto_ok: m.get("proto").and_then(Json::as_f64) == Some(2.0),
        project_ok: None,
        token_ok: None,
        account_ok: None,
        projects: table.advertised.clone(),
        hub_id: None,
        hub_name: table.hub_name.clone(),
        instance_id: table.instance_id.clone(),
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
            None,
        );
    }
    let project = m
        .get("project")
        .filter(|v| v.truthy())
        .map(Json::to_js_string);
    let found = project
        .as_ref()
        .and_then(JsStr::as_str)
        .and_then(|p| table.resolve(p));
    r.project_ok = Some(found.is_some());
    let Some(handle) = found else {
        return (
            r,
            Some(HubError::ProjectUnknown {
                projects: table.advertised.clone(),
            }),
            None,
        );
    };
    let info = &handle.info;
    r.hub_id = Some(info.hub_id.clone());
    let token_ok =
        info.token.is_empty() || m.get("token").and_then(Json::as_str) == Some(info.token.as_str());
    r.token_ok = Some(token_ok);
    if !token_ok {
        return (r, Some(HubError::TokenInvalid {}), Some(handle.clone()));
    }
    let refusal = allow::check(&info.allow, info.allow_file.as_deref(), account).await;
    r.account_ok = Some(refusal.is_none());
    r.account_error = refusal.clone();
    (r, refusal, Some(handle.clone()))
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

async fn hello(router: &Router, m: &Json, key: u64, conn: &Conn, addr: &SocketAddr) -> Hello {
    let proto = m.get("proto").and_then(Json::as_js_integer);
    if !proto.is_some_and(|p| p >= 2.0) {
        log(format!("Từ chối {}: protocol 1", addr.ip()));
        return Hello::Refuse(format!("{LEGACY_PROTOCOL_LINE}\n").into_bytes().into());
    }
    let account = account(m);
    let (probe, refusal, project) = steps(&router.table(), m, account.as_ref()).await;
    if m.get("probe").is_some_and(Json::truthy) {
        return Hello::Refuse(line(&HubMessage::ProbeResult(probe)));
    }
    let project = match (refusal, project) {
        (None, Some(p)) => p,
        (refusal, project) => {
            let e = refusal.expect("a hello without a project is refused");
            return refuse(e, account.as_ref(), project.as_ref(), addr);
        }
    };
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
    let chat_key = chat::chat_key(&seed);
    Hello::Accept(
        Box::new(JoinRequest {
            key,
            conn: conn.clone(),
            uid,
            name,
            account,
            chat_key,
            addr: addr.ip().to_string(),
        }),
        project,
    )
}

fn refuse(
    e: HubError,
    account: Option<&Account>,
    project: Option<&ProjectHandle>,
    addr: &SocketAddr,
) -> Hello {
    let who = account
        .map(|a| {
            format!(
                " ({}:{})",
                a.provider.to_utf8_lossy(),
                a.label.to_utf8_lossy()
            )
        })
        .unwrap_or_default();
    log_in(
        project.map(|p| p.info.name.as_str()),
        &format!("Từ chối {}{who}: {:?}", addr.ip(), e.code()),
    );
    Hello::Refuse(line(&HubMessage::Error(e)))
}

async fn closed(rx: &mut watch::Receiver<bool>) {
    let _ = rx.wait_for(|c| *c).await;
}

fn is_message(m: &Json) -> bool {
    m.is_object() && m.get("t").and_then(Json::as_js_str).is_some()
}

/// A new TCP connection. With TLS on, its first byte must open a TLS handshake; a plain one gets
/// `tls_required` (or the diagnosis page, when it is an HTTP request). The TLS handshake and the first
/// bytes count toward the hello timeout.
pub async fn accept(mut stream: TcpStream, addr: SocketAddr, router: Arc<Router>, key: u64) {
    let _ = stream.set_nodelay(true);
    let keepalive = socket2::TcpKeepalive::new().with_time(Duration::from_secs(10));
    let _ = socket2::SockRef::from(&stream).set_tcp_keepalive(&keepalive);
    let deadline = Instant::now() + HELLO_TIMEOUT;
    let Some(identity) = router.table().tls.clone() else {
        let Some(prefix) = first_bytes(&mut stream, &router, deadline).await else {
            return;
        };
        let (rd, wr) = stream.into_split();
        return serve(rd, wr, prefix, addr, router, key, deadline, false).await;
    };
    let mut first = [0u8; 1];
    if !matches!(
        timeout_at(deadline, stream.peek(&mut first)).await,
        Ok(Ok(1))
    ) {
        return;
    }
    if first[0] != tls::HANDSHAKE_RECORD {
        if first_bytes(&mut stream, &router, deadline).await.is_some() {
            log(format!(
                "Từ chối {}: kết nối không mã hoá tới hub bật TLS",
                addr.ip()
            ));
            let _ = timeout_at(deadline, async {
                stream
                    .write_all(&line(&HubMessage::Error(HubError::TlsRequired {})))
                    .await?;
                stream.shutdown().await
            })
            .await;
        }
        return;
    }
    let mut stream = match timeout_at(deadline, identity.acceptor.accept(stream)).await {
        Ok(Ok(s)) => s,
        // A client tries every address of an invite at once and drops the losers mid-handshake, and a
        // client whose pin does not match hangs up; only other failures are worth a line.
        Ok(Err(e))
            if matches!(
                e.kind(),
                ErrorKind::UnexpectedEof
                    | ErrorKind::ConnectionReset
                    | ErrorKind::ConnectionAborted
            ) =>
        {
            return;
        }
        Ok(Err(e)) => {
            log(format!(
                "[CẢNH BÁO] {}: bắt tay TLS không thành: {e}",
                addr.ip()
            ));
            return;
        }
        Err(_) => return,
    };
    let Some(prefix) = first_bytes(&mut stream, &router, deadline).await else {
        return;
    };
    let (rd, wr) = tokio::io::split(stream);
    serve(rd, wr, prefix, addr, router, key, deadline, true).await;
}

/// Reads until the first bytes tell an HTTP request from a protocol client. An HTTP request gets the
/// diagnosis page here and `None` comes back, as it does when the peer goes quiet or away; otherwise the
/// bytes read so far, which the session takes as its first chunk.
async fn first_bytes<S: AsyncRead + AsyncWrite + Unpin>(
    s: &mut S,
    router: &Router,
    deadline: Instant,
) -> Option<Vec<u8>> {
    let mut prefix = Vec::new();
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        match http_diag::sniff(&prefix) {
            http_diag::Sniff::Other => return Some(prefix),
            http_diag::Sniff::Http(method) => {
                let table = router.table();
                let facts = http_diag::PageFacts {
                    hub_name: &table.hub_name,
                    hub_version: HUB_VERSION,
                    uptime_ms: now_ms().saturating_sub(table.started_at),
                    projects: &table.advertised,
                    tls_fingerprint: table.tls.as_ref().map(|t| t.fingerprint.as_str()),
                };
                http_diag::serve(s, prefix, method, &facts, deadline).await;
                return None;
            }
            http_diag::Sniff::NeedMore => {}
        }
        match timeout_at(deadline, s.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => prefix.extend_from_slice(&buf[..n]),
            _ => return None,
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn serve<R, W>(
    mut rd: R,
    wr: W,
    prefix: Vec<u8>,
    addr: SocketAddr,
    router: Arc<Router>,
    key: u64,
    deadline: Instant,
    tls: bool,
) where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (tx, rx) = mpsc::unbounded_channel::<Line>();
    let (close_tx, mut close_rx) = watch::channel(false);
    let conn = Conn {
        tx,
        backlog: Arc::default(),
        close: Arc::new(close_tx),
    };
    tokio::spawn(write_loop(wr, rx, conn.backlog.clone(), conn.close.clone()));

    let mut dec = LineDecoder::new(PREAUTH_MAX_LINE);
    let mut joined: Option<ProjectHandle> = None;
    let mut last_keepalive: Option<Instant> = None;
    let mut buf = vec![0u8; READ_CHUNK];
    let mut pending = Some(prefix);
    'conn: loop {
        let owned: Vec<u8>;
        let chunk: &[u8] = if let Some(p) = pending.take() {
            owned = p;
            &owned
        } else {
            let n = tokio::select! {
            biased;
            _ = closed(&mut close_rx) => break,
            _ = sleep_until(deadline), if joined.is_none() => {
                conn.close();
                break;
            }
            // The actor ended (a panic, or a stop that raced this join): nothing will ever answer.
            _ = async { joined.as_ref().expect("guarded").inbox.closed().await }, if joined.is_some() => {
                conn.close();
                break;
            }
            r = rd.read(&mut buf) => match r {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            },
            };
            &buf[..n]
        };
        let mut lines = dec.push(chunk).into_iter();
        while let Some(raw) = lines.next() {
            let parsed = json::parse(&raw);
            if let Some(project) = &joined {
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
            if is_message(&m) && m.get("t").and_then(Json::as_str) == Some("admin_hello") {
                let rest = lines.collect();
                return admin_server::serve(rd, dec, &raw, rest, conn, close_rx, addr, router, tls)
                    .await;
            }
            if !is_message(&m) || m.get("t").and_then(Json::as_str) != Some("hello") {
                conn.close();
                break 'conn;
            }
            match hello(&router, &m, key, &conn, &addr).await {
                Hello::Refuse(l) => {
                    conn.send(l);
                    break 'conn;
                }
                Hello::Accept(req, project) => {
                    if project.inbox.send(ActorMsg::Join(*req)).await.is_err() {
                        break 'conn;
                    }
                    joined = Some(project);
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
                if joined.is_some()
                    && last_keepalive.is_none_or(|t| t.elapsed() > KEEPALIVE_EVERY) =>
            {
                last_keepalive = Some(Instant::now());
                conn.send(line(&HubMessage::Pong { ts: now_ms() }));
            }
            _ => {}
        }
    }
    if let Some(project) = joined {
        let _ = project.inbox.send(ActorMsg::Leave { key }).await;
    }
}

/// Writes queued lines, several at a time when they are small. Ends when every sender is gone (after the
/// queue drains, then a FIN), or at once when the connection is closed.
async fn write_loop<W: AsyncWrite + Unpin>(
    mut wr: W,
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
        // A TLS stream reports bytes written once they sit in its record buffer, even when the socket is
        // full; without a flush the end of a batch would wait for the next line. Free on plain TCP.
        let flushed = tokio::select! {
            biased;
            _ = closed(&mut close_rx) => return,
            r = wr.flush() => r,
        };
        if flushed.is_err() {
            let _ = close.send(true);
            return;
        }
        backlog.bytes.fetch_sub(data.len(), Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A TLS stream accepts plaintext into its record buffer and reports it written even when the socket
    /// is full; only a flush guarantees it leaves. A `BufWriter` behaves the same way.
    #[tokio::test]
    async fn write_loop_flushes_each_batch() {
        let (near, mut far) = tokio::io::duplex(1 << 20);
        let wr = tokio::io::BufWriter::with_capacity(1 << 20, near);
        let (tx, rx) = mpsc::unbounded_channel::<Line>();
        let (close, _) = watch::channel(false);
        let backlog = Arc::new(Backlog::default());
        tokio::spawn(write_loop(wr, rx, backlog.clone(), Arc::new(close)));
        backlog.bytes.fetch_add(4, Ordering::AcqRel);
        tx.send(b"ack\n".to_vec().into()).unwrap();
        let mut got = [0u8; 4];
        tokio::time::timeout(Duration::from_secs(2), far.read_exact(&mut got))
            .await
            .expect("the line reaches the peer without another line behind it")
            .unwrap();
        assert_eq!(&got, b"ack\n");
        drop(tx);
    }
}
