//! The client side of the admin channel (docs/protocol.md section 13.3): `RemoteAdmin` implements
//! `AdminApi`, and the config edits of the app, over one connection to a headless hub. Over TLS the hub's
//! certificate must match the pinned SHA-256 fingerprint; without a fingerprint the token is only ever sent
//! to a loopback address, as the hub itself requires.
//!
//! Every failure is an `AdminFailure` whose `code` names it the way the app's `errors` strings do.

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub use lanhub_protocol::AdminFailure;
use lanhub_protocol::{AdminClientMessage, AdminHubMessage, AdminRefusal};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::crypto::{self, CryptoProvider, ring};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};

use crate::admin::{AdminApi, LegacyProject};
use crate::admin_server::AdminRequest;
use crate::config::Config;
use crate::config_file::{
    ExcludePreview, HistoryInput, HubInput, HubSettingsView, ImportInput, InviteView, ProjectInput,
    ProjectSettings,
};
use crate::history::{HistoryUsage, RetentionReport};
use crate::logs::LogRecord;
use crate::project::ClientInfo;
use crate::registry::{AdminError, ApplyReport, InviteCodes, ProjectStatus};
use crate::tls;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Covers the hub's one-second delay before it answers a wrong token.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// An apply that starts a large project loads its files before it answers.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_LINE: usize = 64 * 1024 * 1024;

fn fail(code: &str, params: &[(&str, String)]) -> AdminFailure {
    AdminFailure {
        code: code.to_owned(),
        field: None,
        params: params
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect(),
    }
}

/// `host:port`, with brackets around an IPv6 literal.
pub fn address(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

/// The fingerprint as 64 lowercase hex characters, accepting the `AB:CD:…` form and spaces.
pub fn normalize_fingerprint(text: &str) -> Option<String> {
    let hex: String = text
        .chars()
        .filter(|c| !matches!(c, ':' | ' ' | '-'))
        .flat_map(char::to_lowercase)
        .collect();
    (hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())).then_some(hex)
}

pub fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.to_canonical().is_loopback())
}

/// Where a remote hub listens and the certificate it must present (`None`: plain TCP, loopback only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTarget {
    pub host: String,
    pub port: u16,
    pub fingerprint: Option<String>,
}

impl RemoteTarget {
    pub fn address(&self) -> String {
        address(&self.host, self.port)
    }
}

/// What `probe` learned without sending any secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub tls: bool,
    /// The certificate the hub presented, for the user to confirm.
    pub fingerprint: Option<String>,
}

/// Accepts the certificate whose fingerprint is `expected` (any, when `None`) and records the one seen.
/// Handshake signatures are still verified, so only the holder of the certificate's key gets through.
#[derive(Debug)]
struct Pin {
    expected: Option<String>,
    seen: Mutex<Option<String>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Pin {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, tokio_rustls::rustls::Error> {
        let got = tls::fingerprint(end_entity);
        *self.seen.lock().unwrap_or_else(|e| e.into_inner()) = Some(got.clone());
        match &self.expected {
            Some(want) if *want != got => Err(tokio_rustls::rustls::Error::General(
                "certificate fingerprint differs from the pinned one".into(),
            )),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

async fn tcp(host: &str, port: u16) -> Result<TcpStream, AdminFailure> {
    let addr = address(host, port);
    let stream = match tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((host, port))).await
    {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            crate::logs::log_in(None, &format!("[LỖI] Không kết nối được {addr}: {e}"));
            return Err(fail("remoteUnreachable", &[("address", addr)]));
        }
        Err(_) => return Err(fail("remoteTimeout", &[("address", addr)])),
    };
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

type TlsStream = tokio_rustls::client::TlsStream<TcpStream>;

/// The TLS handshake against `expected`; also returns the fingerprint seen.
async fn tls_connect(
    stream: TcpStream,
    expected: Option<String>,
    addr: &str,
) -> Result<(TlsStream, String), AdminFailure> {
    let provider = Arc::new(ring::default_provider());
    let pin = Arc::new(Pin {
        expected: expected.clone(),
        seen: Mutex::new(None),
        provider: provider.clone(),
    });
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| fail("generic", &[("detail", e.to_string())]))?
        .dangerous()
        .with_custom_certificate_verifier(pin.clone())
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(config));
    let name = ServerName::try_from("lanhub").expect("a valid DNS name");
    let result = tokio::time::timeout(HANDSHAKE_TIMEOUT, connector.connect(name, stream)).await;
    let seen = pin.seen.lock().unwrap_or_else(|e| e.into_inner()).clone();
    match result {
        Ok(Ok(s)) => Ok((s, seen.unwrap_or_default())),
        Ok(Err(e)) => match (expected, seen) {
            (Some(want), Some(got)) if want != got => Err(fail(
                "remoteFingerprint",
                &[
                    ("address", addr.to_owned()),
                    ("expected", want),
                    ("received", got),
                ],
            )),
            _ => {
                crate::logs::log_in(None, &format!("[LỖI] Bắt tay TLS với {addr}: {e}"));
                Err(fail("remoteNotLanHub", &[("address", addr.to_owned())]))
            }
        },
        Err(_) => Err(fail("remoteTimeout", &[("address", addr.to_owned())])),
    }
}

async fn first_line<S: AsyncRead + Unpin>(
    reader: &mut BufReader<S>,
    addr: &str,
) -> Result<String, AdminFailure> {
    let mut line = String::new();
    match tokio::time::timeout(HANDSHAKE_TIMEOUT, reader.read_line(&mut line)).await {
        Ok(Ok(n)) if n > 0 => Ok(line),
        Ok(_) => Err(fail("remoteClosed", &[("address", addr.to_owned())])),
        Err(_) => Err(fail("remoteTimeout", &[("address", addr.to_owned())])),
    }
}

/// Tells a TLS hub from a plain one with a probe `hello`, and reads the certificate fingerprint of a TLS
/// hub. Sends no token.
pub async fn probe(host: &str, port: u16) -> Result<Probe, AdminFailure> {
    let addr = address(host, port);
    let mut stream = tcp(host, port).await?;
    stream
        .write_all(b"{\"t\":\"hello\",\"proto\":2,\"probe\":true}\n")
        .await
        .map_err(|_| fail("remoteClosed", &[("address", addr.clone())]))?;
    let mut reader = BufReader::new(stream);
    let line = first_line(&mut reader, &addr).await?;
    let m: serde_json::Value = serde_json::from_str(&line)
        .map_err(|_| fail("remoteNotLanHub", &[("address", addr.clone())]))?;
    match (m["t"].as_str(), m["code"].as_str()) {
        (Some("probe_result"), _) => Ok(Probe {
            tls: false,
            fingerprint: None,
        }),
        (Some("error"), Some("tls_required")) => {
            let (_, fingerprint) = tls_connect(tcp(host, port).await?, None, &addr).await?;
            Ok(Probe {
                tls: true,
                fingerprint: Some(fingerprint),
            })
        }
        _ => Err(fail("remoteNotLanHub", &[("address", addr)])),
    }
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, AdminFailure>>>>>;

/// What the hub said about itself in `admin_welcome`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub hub_name: String,
    pub hub_version: String,
    pub instance_id: String,
    pub config_path: Option<String>,
}

struct Shared {
    address: String,
    info: RemoteInfo,
    next_id: AtomicU64,
    pending: Pending,
    out: mpsc::UnboundedSender<Vec<u8>>,
    closed: Arc<AtomicBool>,
}

/// One admin session with a remote hub. Calls may overlap; each waits for the result with its id. Once
/// the connection is gone every call fails with `remoteClosed` and the caller connects again.
#[derive(Clone)]
pub struct RemoteAdmin {
    shared: Arc<Shared>,
}

fn refused(code: AdminRefusal, retry_after_ms: Option<u64>, addr: &str) -> AdminFailure {
    let a = ("address", addr.to_owned());
    match code {
        AdminRefusal::Disabled => fail("remoteDisabled", &[a]),
        AdminRefusal::TlsRequired => fail("remoteTlsRequired", &[a]),
        AdminRefusal::TokenInvalid => fail("remoteTokenInvalid", &[a]),
        AdminRefusal::RateLimited => {
            let minutes = retry_after_ms.unwrap_or(0).div_ceil(60_000).max(1);
            fail("remoteRateLimited", &[a, ("minutes", minutes.to_string())])
        }
    }
}

impl RemoteAdmin {
    /// Connects, pins the certificate when `target` has a fingerprint, and opens an admin session.
    pub async fn connect(target: &RemoteTarget, token: &str) -> Result<RemoteAdmin, AdminFailure> {
        let addr = target.address();
        let stream = match &target.fingerprint {
            None if !is_loopback_host(&target.host) => {
                return Err(fail("remoteTlsRequired", &[("address", addr)]));
            }
            None => tcp(&target.host, target.port).await?,
            Some(fp) => {
                let want = normalize_fingerprint(fp)
                    .ok_or_else(|| fail("fingerprintInvalid", &[("address", addr.clone())]))?;
                let (s, _) =
                    tls_connect(tcp(&target.host, target.port).await?, Some(want), &addr).await?;
                return Self::open(s, token, addr).await;
            }
        };
        Self::open(stream, token, addr).await
    }

    async fn open<S>(stream: S, token: &str, addr: String) -> Result<RemoteAdmin, AdminFailure>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (rd, mut wr) = tokio::io::split(stream);
        let hello = AdminClientMessage::AdminHello {
            token: token.to_owned(),
        };
        let mut bytes = serde_json::to_vec(&hello).expect("admin_hello serializes");
        bytes.push(b'\n');
        let sent = async {
            wr.write_all(&bytes).await?;
            wr.flush().await
        };
        sent.await
            .map_err(|_| fail("remoteClosed", &[("address", addr.clone())]))?;
        let mut reader = BufReader::new(rd);
        let line = first_line(&mut reader, &addr).await?;
        let info = match serde_json::from_str::<AdminHubMessage>(&line) {
            Ok(AdminHubMessage::AdminWelcome {
                hub_name,
                hub_version,
                instance_id,
                config_path,
            }) => RemoteInfo {
                hub_name,
                hub_version,
                instance_id,
                config_path,
            },
            Ok(AdminHubMessage::AdminRefused {
                code,
                retry_after_ms,
            }) => return Err(refused(code, retry_after_ms, &addr)),
            _ => {
                // A plain connection to a TLS hub gets its `tls_required` line.
                let tls_on = serde_json::from_str::<serde_json::Value>(&line)
                    .is_ok_and(|m| m["code"] == "tls_required");
                let code = if tls_on {
                    "remoteTlsOn"
                } else {
                    "remoteNotLanHub"
                };
                return Err(fail(code, &[("address", addr)]));
            }
        };
        let pending: Pending = Arc::default();
        let closed = Arc::new(AtomicBool::new(false));
        let (out, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let shared = Arc::new(Shared {
            address: addr,
            info,
            next_id: AtomicU64::new(1),
            pending: pending.clone(),
            out,
            closed: closed.clone(),
        });
        let writer_closed = closed.clone();
        tokio::spawn(async move {
            while let Some(line) = out_rx.recv().await {
                if wr.write_all(&line).await.is_err() || wr.flush().await.is_err() {
                    break;
                }
            }
            writer_closed.store(true, Ordering::SeqCst);
            let _ = wr.shutdown().await;
        });
        tokio::spawn(read_results(reader, pending, closed));
        Ok(RemoteAdmin { shared })
    }

    pub fn info(&self) -> &RemoteInfo {
        &self.shared.info
    }

    pub fn address(&self) -> &str {
        &self.shared.address
    }

    /// The connection is gone; calls fail until the caller connects again.
    pub fn is_closed(&self) -> bool {
        self.shared.closed.load(Ordering::SeqCst)
    }

    fn closed_failure(&self) -> AdminFailure {
        fail("remoteClosed", &[("address", self.shared.address.clone())])
    }

    /// One call: sends `request` with a new id and waits for its result.
    pub async fn call<T: DeserializeOwned>(
        &self,
        request: AdminRequest,
    ) -> Result<T, AdminFailure> {
        if self.is_closed() {
            return Err(self.closed_failure());
        }
        let id = self.shared.next_id.fetch_add(1, Ordering::Relaxed);
        let body = serde_json::to_value(&request).expect("an admin request serializes");
        let msg = AdminClientMessage::AdminCall {
            id,
            method: body["method"].as_str().unwrap_or_default().to_owned(),
            params: body.get("params").cloned().unwrap_or_else(|| json!({})),
        };
        let mut bytes = serde_json::to_vec(&msg).expect("admin_call serializes");
        bytes.push(b'\n');
        let (tx, rx) = oneshot::channel();
        self.shared
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        // The reader may have ended between the first check and the insert; it cleared what it saw.
        if self.is_closed() || self.shared.out.send(bytes).is_err() {
            self.forget(id);
            return Err(self.closed_failure());
        }
        let value = match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(result)) => result?,
            Ok(Err(_)) => return Err(self.closed_failure()),
            Err(_) => {
                self.forget(id);
                return Err(fail(
                    "remoteTimeout",
                    &[("address", self.shared.address.clone())],
                ));
            }
        };
        serde_json::from_value(value).map_err(|e| {
            crate::logs::log_in(
                None,
                &format!(
                    "[LỖI] Kết quả không đọc được từ {}: {e}",
                    self.shared.address
                ),
            );
            fail(
                "remoteNotLanHub",
                &[("address", self.shared.address.clone())],
            )
        })
    }

    fn forget(&self, id: u64) {
        self.shared
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    }

    pub async fn add_project(&self, input: &ProjectInput) -> Result<(), AdminFailure> {
        self.call(AdminRequest::AddProject {
            input: input.clone(),
        })
        .await
    }

    pub async fn update_project(
        &self,
        original: &str,
        input: &ProjectInput,
    ) -> Result<(), AdminFailure> {
        self.call(AdminRequest::UpdateProject {
            original: original.to_owned(),
            input: input.clone(),
        })
        .await
    }

    pub async fn set_enabled(&self, name: &str, enabled: bool) -> Result<(), AdminFailure> {
        self.call(AdminRequest::SetProjectEnabled {
            name: name.to_owned(),
            enabled,
        })
        .await
    }

    pub async fn remove_project(&self, name: &str) -> Result<(), AdminFailure> {
        self.call(AdminRequest::RemoveProject {
            name: name.to_owned(),
        })
        .await
    }

    pub async fn hub_settings(&self) -> Result<HubSettingsView, AdminFailure> {
        self.call(AdminRequest::HubSettings {}).await
    }

    pub async fn update_hub(&self, input: &HubInput) -> Result<HubSettingsView, AdminFailure> {
        self.call(AdminRequest::UpdateHub {
            input: input.clone(),
        })
        .await
    }

    /// The invite code of every running project.
    pub async fn all_invite_codes(&self) -> Result<Vec<InviteView>, AdminFailure> {
        self.call(AdminRequest::AllInviteCodes {}).await
    }

    pub async fn invite_code(&self, name: &str) -> Result<String, AdminFailure> {
        self.call(AdminRequest::InviteCode {
            name: name.to_owned(),
        })
        .await
    }

    pub async fn project_settings(&self, name: &str) -> Result<ProjectSettings, AdminFailure> {
        self.call(AdminRequest::ProjectSettings {
            name: name.to_owned(),
        })
        .await
    }

    pub async fn set_allow(&self, name: &str, lines: &[String]) -> Result<(), AdminFailure> {
        self.call(AdminRequest::SetAllow {
            name: name.to_owned(),
            lines: lines.to_vec(),
        })
        .await
    }

    pub async fn set_exclude(&self, name: &str, lines: &[String]) -> Result<(), AdminFailure> {
        self.call(AdminRequest::SetExclude {
            name: name.to_owned(),
            lines: lines.to_vec(),
        })
        .await
    }

    /// Walks the project folder on the hub's machine.
    pub async fn preview_exclude(
        &self,
        name: &str,
        lines: &[String],
    ) -> Result<ExcludePreview, AdminFailure> {
        self.call(AdminRequest::PreviewExclude {
            name: name.to_owned(),
            lines: lines.to_vec(),
        })
        .await
    }

    pub async fn set_history(
        &self,
        name: &str,
        history: &HistoryInput,
    ) -> Result<(), AdminFailure> {
        self.call(AdminRequest::SetHistory {
            name: name.to_owned(),
            history: *history,
        })
        .await
    }

    /// Adds the projects whose names are new to the hub's file, in one write. Returns the names added.
    pub async fn import_projects(
        &self,
        items: &[ImportInput],
    ) -> Result<Vec<String>, AdminFailure> {
        self.call(AdminRequest::ImportProjects {
            items: items.to_vec(),
        })
        .await
    }
}

/// Hands each `admin_result` to the call waiting for its id. When the connection ends, every waiting call
/// gets `remoteClosed` through its dropped sender.
async fn read_results<R: AsyncRead + Unpin>(
    mut reader: BufReader<R>,
    pending: Pending,
    closed: Arc<AtomicBool>,
) {
    let mut line = Vec::new();
    loop {
        line.clear();
        let mut limited = (&mut reader).take(MAX_LINE as u64);
        match limited.read_until(b'\n', &mut line).await {
            Ok(n) if n > 0 && line.ends_with(b"\n") => {}
            _ => break,
        }
        if let Ok(AdminHubMessage::AdminResult {
            id,
            ok,
            value,
            error,
        }) = serde_json::from_slice::<AdminHubMessage>(&line)
        {
            let waiter = pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            if let Some(tx) = waiter {
                let result = if ok {
                    Ok(value)
                } else {
                    Err(error.unwrap_or_else(|| fail("generic", &[])))
                };
                let _ = tx.send(result);
            }
        }
    }
    closed.store(true, Ordering::SeqCst);
    pending.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// A failure of the remote hub as the local hub would report it, so both implementations of `AdminApi`
/// return equal results.
fn admin_error(f: AdminFailure) -> AdminError {
    let name = f.params.get("name").cloned().unwrap_or_default();
    match f.code.as_str() {
        "unknownProject" => AdminError::UnknownProject(name),
        "notRunning" => AdminError::NotRunning(name),
        _ => AdminError::Remote(f),
    }
}

impl AdminApi for RemoteAdmin {
    async fn list_projects(&self) -> Result<Vec<ProjectStatus>, AdminError> {
        self.call(AdminRequest::ListProjects {})
            .await
            .map_err(admin_error)
    }

    async fn project_status(&self, name: &str) -> Result<Option<ProjectStatus>, AdminError> {
        self.call(AdminRequest::ProjectStatus {
            name: name.to_owned(),
        })
        .await
        .map_err(admin_error)
    }

    async fn apply_config(&self, config: Config) -> Result<ApplyReport, AdminError> {
        self.call(AdminRequest::ApplyConfig { config })
            .await
            .map_err(admin_error)
    }

    async fn rotate_token(&self, name: &str) -> Result<String, AdminError> {
        self.call(AdminRequest::RotateToken {
            name: name.to_owned(),
        })
        .await
        .map_err(admin_error)
    }

    async fn clients(&self, name: &str) -> Result<Vec<ClientInfo>, AdminError> {
        self.call(AdminRequest::Clients {
            name: name.to_owned(),
        })
        .await
        .map_err(admin_error)
    }

    async fn logs(&self, after: u64, limit: usize) -> Result<Vec<LogRecord>, AdminError> {
        self.call(AdminRequest::Logs { after, limit })
            .await
            .map_err(admin_error)
    }

    async fn history_usage(&self, name: &str) -> Result<Option<HistoryUsage>, AdminError> {
        self.call(AdminRequest::HistoryUsage {
            name: name.to_owned(),
        })
        .await
        .map_err(admin_error)
    }

    async fn run_retention(
        &self,
        name: &str,
    ) -> Result<Option<Result<RetentionReport, String>>, AdminError> {
        let result = self
            .call(AdminRequest::RunRetention {
                name: name.to_owned(),
            })
            .await;
        match result {
            Ok(report) => Ok(Some(Ok(report))),
            Err(f) if f.code == "historyOff" => Ok(None),
            Err(f) if f.code == "retentionFailed" => Ok(Some(Err(f
                .params
                .get("detail")
                .cloned()
                .unwrap_or_default()))),
            Err(f) => Err(admin_error(f)),
        }
    }

    async fn invite_codes(&self, name: &str) -> Result<InviteCodes, AdminError> {
        self.call(AdminRequest::InviteCodes {
            name: name.to_owned(),
        })
        .await
        .map_err(admin_error)
    }

    /// `dir` is a folder on the hub's machine.
    async fn import_legacy(
        &self,
        dir: &Path,
    ) -> Result<std::io::Result<Vec<LegacyProject>>, AdminError> {
        let result = self
            .call(AdminRequest::ImportLegacy {
                dir: dir.to_string_lossy().into_owned(),
            })
            .await;
        match result {
            Ok(found) => Ok(Ok(found)),
            Err(f) if f.code == "legacyUnreadable" => Ok(Err(std::io::Error::other(format!(
                "LAN Hub tại {} không đọc được thư mục, chi tiết có trong nhật ký của LAN Hub đó",
                self.shared.address
            )))),
            Err(f) => Err(admin_error(f)),
        }
    }
}
