//! Optional TLS on the hub port (docs/protocol.md section 13.1). The certificate is either the one
//! `[hub.tls]` names or a self-signed one generated once into the hub's state folder, so its fingerprint,
//! which invite codes carry and clients pin, survives restarts. The fingerprint is the SHA-256 of the DER
//! leaf certificate as 64 lowercase hex characters, the form `lib/diagnostics.js` compares.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rcgen::generate_simple_self_signed;
use sha2::{Digest, Sha256};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::rustls::crypto::ring;
use tokio_rustls::rustls::pki_types::pem::PemObject;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};

use crate::config::TlsSettings;
use crate::util::{hex, random_hex};

/// The generated certificate and its key, in one PEM file inside the state folder.
pub const GENERATED_FILE: &str = "tls-selfsigned.pem";

/// The first byte of a TLS handshake record.
pub const HANDSHAKE_RECORD: u8 = 0x16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CertSource {
    /// `[hub.tls] cert` and `key`.
    Provided(PathBuf),
    /// The self-signed file in the state folder.
    Generated(PathBuf),
}

impl CertSource {
    pub fn path(&self) -> &Path {
        match self {
            CertSource::Provided(p) | CertSource::Generated(p) => p,
        }
    }
}

pub struct TlsIdentity {
    pub acceptor: TlsAcceptor,
    pub fingerprint: String,
    pub source: CertSource,
}

impl std::fmt::Debug for TlsIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TlsIdentity")
            .field("fingerprint", &self.fingerprint)
            .field("source", &self.source)
            .finish_non_exhaustive()
    }
}

pub fn fingerprint(cert: &CertificateDer<'_>) -> String {
    hex(&Sha256::digest(cert.as_ref()))
}

pub fn generated_path(state_dir: &Path) -> PathBuf {
    state_dir.join(GENERATED_FILE)
}

/// The certificate chain from `cert_pem` and the private key from `key_pem` (one file may hold both).
fn identity(
    (cert_pem, cert_path): (&[u8], &Path),
    (key_pem, key_path): (&[u8], &Path),
    source: CertSource,
) -> Result<TlsIdentity, String> {
    let chain = CertificateDer::pem_slice_iter(cert_pem)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("{}: {e}", cert_path.display()))?;
    let key = PrivateKeyDer::from_pem_slice(key_pem)
        .map_err(|e| format!("{}: no private key ({e})", key_path.display()))?;
    let Some(leaf) = chain.first() else {
        return Err(format!("{}: no certificate", source.path().display()));
    };
    let fingerprint = fingerprint(leaf);
    let config = ServerConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .map_err(|e| format!("{}: {e}", source.path().display()))?;
    Ok(TlsIdentity {
        acceptor: TlsAcceptor::from(Arc::new(config)),
        fingerprint,
        source,
    })
}

fn load_provided(cert: &Path, key: &Path) -> Result<TlsIdentity, String> {
    let read = |p: &Path| std::fs::read(p).map_err(|e| format!("{}: {e}", p.display()));
    identity(
        (&read(cert)?, cert),
        (&read(key)?, key),
        CertSource::Provided(cert.to_owned()),
    )
}

/// The identity `settings` describe, without writing anything: `Ok(None)` when the self-signed file has
/// not been generated yet. For `lanhub-cli --diagnose`.
pub fn inspect(
    settings: &TlsSettings,
    state_dir: Option<&Path>,
) -> Result<Option<TlsIdentity>, String> {
    if let (Some(cert), Some(key)) = (&settings.cert, &settings.key) {
        return load_provided(cert, key).map(Some);
    }
    let file = generated_path(state_dir.ok_or("no folder for the self-signed certificate")?);
    match std::fs::read(&file) {
        Ok(pem) => identity(
            (&pem, &file),
            (&pem, &file),
            CertSource::Generated(file.clone()),
        )
        .map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", file.display())),
    }
}

/// The identity `settings` describe, generating the self-signed certificate on first use.
pub fn load_or_create(
    settings: &TlsSettings,
    state_dir: Option<&Path>,
) -> Result<TlsIdentity, String> {
    if let Some(id) = inspect(settings, state_dir)? {
        return Ok(id);
    }
    let dir = state_dir.expect("inspect checked the folder");
    let file = generated_path(dir);
    // The names are fixed so the certificate never depends on settings that may change (a public address);
    // clients pin the fingerprint and skip name checks.
    let generated = generate_simple_self_signed(vec!["lanhub".to_owned(), "localhost".to_owned()])
        .map_err(|e| e.to_string())?;
    let pem = format!(
        "{}{}",
        generated.signing_key.serialize_pem(),
        generated.cert.pem()
    );
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    // Written whole under a temporary name, then linked in place: a hub started at the same instant on the
    // same folder either wins the link or reads the winner's file, so both serve one certificate.
    let tmp = dir.join(format!("{GENERATED_FILE}.{}.tmp", random_hex::<6>()));
    write_private(&tmp, pem.as_bytes()).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let linked = std::fs::hard_link(&tmp, &file);
    let _ = std::fs::remove_file(&tmp);
    match linked {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("{}: {e}", file.display())),
    }
    inspect(settings, state_dir)?.ok_or_else(|| format!("{}: not written", file.display()))
}

/// Creates `path` readable by its owner only where the OS has file modes. On Windows the state folder
/// (`%APPDATA%` or the project's `.lan-collab`) carries the user's own permissions.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}
