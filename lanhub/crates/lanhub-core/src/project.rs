//! The project actor: one task owns the files, their OT state, the members and the activity feed of a
//! project, and handles every member message in arrival order. Handlers follow `hub/hub.js` line for line.
//! Disk work goes to the project's IO thread; a handler that needs its result returns a continuation and
//! the actor waits for it before the next message, keeping the Node hub's ordering.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;

use lanhub_ot::{Component, TextOperation, diff};
use lanhub_protocol::json::{self, JsStr, Json};
use lanhub_protocol::{
    Account, Activity, ActivityKind, ChatRejectCode, ChatRejectData, FileBody, FileContent,
    FileInfo, FileKind, FileMessage, HistoryBlobBody, HubMessage, IgnoredReason, MediaReply,
    Presence, User, Welcome, WireOp,
};
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Instant, Interval, MissedTickBehavior, interval, sleep_until};

use crate::chat::{self, CHAT_KEEP, IMAGE_MAX, WELCOME_CHAT};
use crate::config::{DebugHooks, HistorySettings};
use crate::exclude::Excluder;
use crate::files::{abs_path, uniform_eol};
use crate::flush::{FlushSchedule, Io, IoJob, IoResult};
use crate::history::{
    self, Author, BlobRecord, Closed, Content, Counters, Edit, History, HistoryUsage, Job, OpenRun,
    Reply, RetentionReport, Runs, Source, StartBlob,
};
use crate::paths::safe_rel;
use crate::presence;
use crate::session::Conn;
use crate::util::{base64_decode_lenient, base64_encode, log, now_ms, random_hex, sha1_hex};

const COLORS: [&str; 10] = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#0fa3b1", "#f032e6", "#9a6324",
    "#808000", "#000075",
];
const LOG_KEEP: usize = 2000;
const EDIT_NOTE: Duration = Duration::from_secs(120);
const ACTIVITY_KEEP: usize = 200;
const WELCOME_ACTIVITY: usize = 60;
const UID_FORGET: Duration = Duration::from_secs(3600);
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// One serialized message, LF included, shared by every member it goes to.
pub type Line = Arc<[u8]>;

pub fn line(msg: &HubMessage) -> Line {
    json::to_line(msg).into()
}

/// The project's settings as sessions and the actor see them. A config change that needs no restart
/// replaces the whole value, in the router's table and through `ActorMsg::Reconfigure`.
#[derive(Debug, Clone)]
pub struct ProjectInfo {
    pub name: String,
    pub token: String,
    pub hub_id: String,
    pub instance_id: String,
    pub hub_name: String,
    pub hub_version: String,
    /// `welcome.exclude`: the default patterns plus the project's own, as given.
    pub exclude: Vec<String>,
    pub features: Vec<String>,
    /// Inline allow entries, normalized as `allow::entries` does.
    pub allow: Vec<String>,
    /// Read on every hello (`allow.rs`).
    pub allow_file: Option<PathBuf>,
    pub advertise: bool,
    pub history: HistorySettings,
}

/// A connected member, as `AdminApi::clients` reports it.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub id: String,
    pub name: String,
    /// `provider:label`.
    pub account: Option<String>,
    pub addr: String,
    pub joined_at: u64,
    /// Milliseconds, as the client last reported it in `presence.p.rtt`.
    pub rtt: Option<f64>,
    /// The file open in the member's editor, from `presence.p.file`.
    pub file: Option<String>,
}

/// A hello the session accepted.
pub struct JoinRequest {
    pub key: u64,
    pub conn: Conn,
    pub uid: JsStr,
    pub name: JsStr,
    pub account: Option<Account>,
    pub chat_key: String,
    pub addr: String,
}

pub enum ActorMsg {
    Join(JoinRequest),
    Client {
        key: u64,
        msg: Json,
    },
    Leave {
        key: u64,
    },
    /// Writes every pending file, closes every member and stops the actor.
    Shutdown {
        done: oneshot::Sender<()>,
    },
    Reconfigure {
        info: Arc<ProjectInfo>,
        excluder: Excluder,
    },
    Clients {
        reply: oneshot::Sender<Vec<ClientInfo>>,
    },
    /// `None` when the project runs without history.
    HistoryUsage {
        reply: oneshot::Sender<Option<HistoryUsage>>,
    },
    RunRetention {
        reply: oneshot::Sender<Option<Result<RetentionReport, String>>>,
    },
}

struct Member {
    key: u64,
    id: String,
    uid: JsStr,
    chat_key: String,
    name: JsStr,
    account: Option<Account>,
    color: String,
    presence: Option<Presence>,
    status: JsStr,
    conn: Conn,
    addr: String,
    joined_at: u64,
}

impl Member {
    fn client_info(&self) -> ClientInfo {
        ClientInfo {
            id: self.id.clone(),
            name: self.name.to_utf8_lossy().into_owned(),
            account: self
                .account
                .as_ref()
                .map(|a| format!("{}:{}", a.provider.to_utf8_lossy(), a.label.to_utf8_lossy())),
            addr: self.addr.clone(),
            joined_at: self.joined_at,
            rtt: self.presence.as_ref().and_then(|p| p.rtt).map(|n| n.0),
            file: self
                .presence
                .as_ref()
                .and_then(|p| p.file.as_ref())
                .map(|f| f.to_utf8_lossy().into_owned()),
        }
    }

    fn public(&self) -> User {
        User {
            id: self.id.clone(),
            name: self.name.clone(),
            color: self.color.clone(),
            account: self.account.clone(),
            presence: self.presence.clone(),
            status: self.status.clone(),
        }
    }
}

struct TextFile {
    text: Vec<u16>,
    rev: u64,
    log: VecDeque<TextOperation>,
    log_start: u64,
    /// SHA-1 of `text`, computed on demand and dropped on every change.
    hash: Option<String>,
}

impl TextFile {
    fn new(text: Vec<u16>) -> TextFile {
        TextFile {
            text,
            rev: 0,
            log: VecDeque::new(),
            log_start: 0,
            hash: None,
        }
    }

    fn hash(&mut self) -> &str {
        let text = &self.text;
        self.hash
            .get_or_insert_with(|| sha1_hex(String::from_utf16_lossy(text).as_bytes()))
    }
}

enum FileEntry {
    Text(TextFile),
    Blob { hash: String },
}

/// The rest of a handler, run once the IO thread has answered.
enum Then {
    BlobRead {
        key: u64,
        rel: String,
        hash: String,
    },
    Created {
        key: u64,
        rel: String,
        text: Option<Vec<u16>>,
        bytes_hash: String,
        b64: String,
        existed: bool,
    },
    Put {
        key: u64,
        rel: String,
        hash: String,
        b64: String,
    },
    Deleted {
        key: u64,
        rel: String,
    },
    ChatImage {
        key: u64,
        text: JsStr,
        image: Json,
    },
    Media {
        key: u64,
        id: String,
        mime: Json,
    },
}

struct Pending {
    rx: oneshot::Receiver<IoResult<Vec<u8>>>,
    then: Then,
}

/// `TextOperation.fromJSON`. Integers above 2^53 - 1 are refused (they cannot describe any text).
pub fn op_from_json(v: &Json) -> Option<TextOperation> {
    let Json::Arr(items) = v else {
        return None;
    };
    let mut op = TextOperation::new();
    for item in items {
        match item {
            Json::Str(s) => {
                op.insert(&s.units());
            }
            Json::Num(n)
                if n.is_finite()
                    && n.fract() == 0.0
                    && n.abs() <= MAX_SAFE_INTEGER
                    && *n != 0.0 =>
            {
                if *n > 0.0 {
                    op.retain(*n as usize);
                } else {
                    op.delete((-*n) as usize);
                }
            }
            _ => return None,
        }
    }
    Some(op)
}

pub struct Project {
    info: Arc<ProjectInfo>,
    root: PathBuf,
    excluder: Excluder,
    session: String,
    files: HashMap<String, FileEntry>,
    members: Vec<Member>,
    last_seq: HashMap<JsStr, BTreeMap<String, Json>>,
    uid_gone: HashMap<JsStr, Instant>,
    edit_notes: HashMap<(String, String), Instant>,
    activity: VecDeque<Activity>,
    /// `<history>`: `chat.jsonl` and `chat-media/`.
    history: PathBuf,
    chat: VecDeque<Json>,
    color_index: usize,
    schedule: FlushSchedule,
    io: Io,
    /// Members whose queue was full during the last handler, closed once it returns.
    slow: Vec<u64>,
    debug: DebugHooks,
    /// Read by `AdminApi` without a round trip to the actor.
    member_count: Arc<AtomicUsize>,
    /// `None` when history is off or its store could not be opened.
    edit_history: Option<History>,
    history_replies: Option<mpsc::UnboundedReceiver<Reply>>,
    runs: Runs,
    /// When `history_changed` last went out for a path, and the paths whose next one waits for its second.
    changed_sent: HashMap<String, Instant>,
    changed_due: HashSet<String>,
    /// Text files whose text the history thread holds (`history` module docs).
    mirrored: HashSet<String>,
    stats: Arc<ProjectStats>,
}

/// Counters the actor keeps current for a live status view, read without a round trip to the actor.
#[derive(Debug, Default)]
pub struct ProjectStats {
    pub files: AtomicUsize,
    /// Operations applied since the project started.
    pub ops: AtomicU64,
    /// Milliseconds since the epoch of the last applied operation or member activity; 0 for none yet.
    pub last_activity: AtomicU64,
}

pub struct LoadedFile {
    pub rel: String,
    pub text: Option<Vec<u16>>,
    pub blob_hash: Option<String>,
    /// The text differs from the bytes on disk (line endings were made uniform), so it is written back.
    pub rewrite: bool,
}

impl Project {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        info: Arc<ProjectInfo>,
        root: PathBuf,
        excluder: Excluder,
        loaded: Vec<LoadedFile>,
        history: PathBuf,
        chat: VecDeque<Json>,
        store: Option<history::Store>,
        debug: DebugHooks,
    ) -> Project {
        let mut files = HashMap::new();
        let mut schedule = FlushSchedule::default();
        let now = Instant::now();
        for f in loaded {
            if f.rewrite {
                schedule.mark(&f.rel, now);
            }
            let entry = match (f.text, f.blob_hash) {
                (Some(text), _) => FileEntry::Text(TextFile::new(text)),
                (None, hash) => FileEntry::Blob {
                    hash: hash.unwrap_or_default(),
                },
            };
            files.insert(f.rel, entry);
        }
        let (history_log, history_replies) = match store {
            Some(store) => {
                let (tx, rx) = mpsc::unbounded_channel();
                let h = History::start(&info.name, store, history::limits(&info.history), tx);
                (Some(h), Some(rx))
            }
            None => (None, None),
        };
        let stats = Arc::new(ProjectStats::default());
        stats.files.store(files.len(), Ordering::Relaxed);
        Project {
            runs: Runs::new(info.history.idle_ms()),
            changed_sent: HashMap::new(),
            changed_due: HashSet::new(),
            mirrored: HashSet::new(),
            edit_history: history_log,
            history_replies,
            io: Io::start(&info.name),
            info,
            root,
            excluder,
            session: random_hex::<6>(),
            files,
            members: Vec::new(),
            last_seq: HashMap::new(),
            uid_gone: HashMap::new(),
            edit_notes: HashMap::new(),
            activity: VecDeque::new(),
            history,
            chat,
            color_index: 0,
            schedule,
            slow: Vec::new(),
            debug: if cfg!(debug_assertions) {
                debug
            } else {
                DebugHooks::default()
            },
            member_count: Arc::default(),
            stats,
        }
    }

    /// The number of members, kept current by the actor.
    pub fn member_count(&self) -> Arc<AtomicUsize> {
        self.member_count.clone()
    }

    pub fn stats(&self) -> Arc<ProjectStats> {
        self.stats.clone()
    }

    pub async fn run(mut self, mut inbox: mpsc::Receiver<ActorMsg>) {
        let mut sweep = interval(Duration::from_secs(60));
        let mut replies = self.history_replies.take();
        let mut idle_tick = idle_interval(self.runs.idle_ms());
        let mut changed_tick = interval(CHANGED_TICK);
        changed_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            let next_flush = self.schedule.next();
            tokio::select! {
                msg = inbox.recv() => match msg {
                    Some(ActorMsg::Shutdown { done }) => {
                        self.stop().await;
                        let _ = done.send(());
                        return;
                    }
                    Some(ActorMsg::Reconfigure { info, excluder }) => {
                        let idle = self.runs.idle_ms();
                        self.reconfigure_history(&info);
                        self.info = info;
                        self.excluder = excluder;
                        if self.runs.idle_ms() != idle {
                            idle_tick = idle_interval(self.runs.idle_ms());
                        }
                    }
                    Some(ActorMsg::Clients { reply }) => {
                        let _ = reply.send(self.members.iter().map(Member::client_info).collect());
                    }
                    Some(ActorMsg::HistoryUsage { reply }) => match &self.edit_history {
                        Some(h) => h.send(Job::Usage { reply }),
                        None => {
                            let _ = reply.send(None);
                        }
                    },
                    Some(ActorMsg::RunRetention { reply }) => match &self.edit_history {
                        Some(h) => h.send(Job::Retain { reply }),
                        None => {
                            let _ = reply.send(None);
                        }
                    },
                    Some(msg) => {
                        self.crash_hook(&msg);
                        self.dispatch(msg).await;
                    }
                    None => {
                        self.stop().await;
                        return;
                    }
                },
                _ = sleep_until(next_flush.unwrap_or_else(Instant::now)), if next_flush.is_some() => {
                    for rel in self.schedule.take_due(Instant::now()) {
                        self.flush(&rel);
                    }
                }
                _ = sweep.tick() => self.forget_uids(),
                Some(reply) = next_reply(&mut replies) => {
                    match reply {
                        Reply::To { key, line } => self.send_line(key, line),
                        Reply::All { line } => self.broadcast_line(line, None),
                        Reply::Changed { path } => self.history_changed(&path),
                    }
                    self.close_slow();
                }
                _ = idle_tick.tick(), if self.edit_history.is_some() => {
                    let closed = self.runs.expire(now_ms());
                    self.end_runs(closed);
                    self.close_slow();
                }
                _ = changed_tick.tick(), if !self.changed_due.is_empty() => {
                    self.flush_changed();
                    self.close_slow();
                }
            }
        }
    }

    /// Debug builds: a panic outside the handlers' `catch_unwind`, so it ends the actor.
    fn crash_hook(&self, msg: &ActorMsg) {
        if let (Some(p), ActorMsg::Client { msg, .. }) = (&self.debug.crash_path, msg)
            && msg.get("path").and_then(Json::as_str) == Some(p.as_str())
        {
            panic!("test hook: actor crash on {p}");
        }
    }

    async fn stop(&mut self) {
        for m in &self.members {
            m.conn.close();
        }
        self.members.clear();
        self.member_count.store(0, Ordering::Relaxed);
        for rel in self.schedule.take_all() {
            self.flush(&rel);
        }
        if self.edit_history.is_some() {
            let closed = self.runs.close_all(now_ms());
            self.end_runs(closed);
        }
        let mut io = self.io.detach();
        // The IO thread may still hand blob runs to the history thread, so it finishes first.
        let mut history = self.edit_history.as_mut().map(History::detach);
        let _ = tokio::task::spawn_blocking(move || {
            io.finish();
            if let Some(h) = history.as_mut() {
                h.finish();
            }
        })
        .await;
    }

    async fn dispatch(&mut self, msg: ActorMsg) {
        let (what, key, path) = match &msg {
            ActorMsg::Client { key, msg } => (
                msg.get("t").and_then(Json::as_str).unwrap_or("").to_owned(),
                *key,
                msg.get("path").and_then(Json::as_str).map(str::to_owned),
            ),
            ActorMsg::Join(j) => ("hello".to_owned(), j.key, None),
            ActorMsg::Leave { key } => ("leave".to_owned(), *key, None),
            ActorMsg::Shutdown { .. }
            | ActorMsg::Reconfigure { .. }
            | ActorMsg::Clients { .. }
            | ActorMsg::HistoryUsage { .. }
            | ActorMsg::RunRetention { .. } => {
                unreachable!("handled by run")
            }
        };
        let result = catch_unwind(AssertUnwindSafe(|| self.handle(msg)));
        let pending = match result {
            Ok(p) => p,
            Err(_) => {
                self.recover(&what, key, path.as_deref());
                None
            }
        };
        if let Some(p) = pending {
            let outcome =
                p.rx.await
                    .unwrap_or_else(|_| Err("IO thread stopped".into()));
            if catch_unwind(AssertUnwindSafe(|| self.finish(p.then, outcome))).is_err() {
                self.recover(&what, key, path.as_deref());
            }
        }
        self.stats.files.store(self.files.len(), Ordering::Relaxed);
        self.close_slow();
    }

    /// After a panic in a handler: log it, and send the member a resync of the file it was about.
    fn recover(&mut self, what: &str, key: u64, path: Option<&str>) {
        let who = self
            .member(key)
            .map(|m| m.name.to_utf8_lossy().into_owned())
            .unwrap_or_default();
        log(format!("[LỖI] xử lý \"{what}\" từ {who}: handler panicked"));
        if let Some(path) = path {
            self.send(
                key,
                &HubMessage::Resync {
                    path: path.to_owned(),
                },
            );
        }
    }

    fn handle(&mut self, msg: ActorMsg) -> Option<Pending> {
        match msg {
            ActorMsg::Join(req) => {
                self.join(req);
                None
            }
            ActorMsg::Leave { key } => {
                self.leave(key);
                None
            }
            ActorMsg::Client { key, msg } => {
                self.member(key)?;
                if let (Some(p), Some(path)) = (
                    &self.debug.panic_path,
                    msg.get("path").and_then(Json::as_str),
                ) && p == path
                {
                    panic!("test hook: panic on {path}");
                }
                match msg.get("t").and_then(Json::as_str)? {
                    "get" => self.on_get(key, &msg),
                    "op" => {
                        self.on_op(key, &msg);
                        None
                    }
                    "create" => self.on_create(key, &msg),
                    "put" => self.on_put(key, &msg),
                    "delete" => self.on_delete(key, &msg),
                    "check" => {
                        self.on_check(key, &msg);
                        None
                    }
                    "presence" => {
                        self.on_presence(key, &msg);
                        None
                    }
                    "status" => {
                        self.on_status(key, &msg);
                        None
                    }
                    "chat" => self.on_chat(key, &msg),
                    "media" => self.on_media(key, &msg),
                    "ping" => {
                        self.send(key, &HubMessage::Pong { ts: now_ms() });
                        None
                    }
                    "history_list" => {
                        self.on_history_list(key, &msg);
                        None
                    }
                    "history_blob" => {
                        self.on_history_blob(key, &msg);
                        None
                    }
                    "checkpoint_create" => {
                        self.on_checkpoint_create(key, &msg);
                        None
                    }
                    "checkpoint_list" => {
                        if let Some(h) = &self.edit_history {
                            h.send(Job::Checkpoints { key });
                        }
                        None
                    }
                    _ => None,
                }
            }
            ActorMsg::Shutdown { .. }
            | ActorMsg::Reconfigure { .. }
            | ActorMsg::Clients { .. }
            | ActorMsg::HistoryUsage { .. }
            | ActorMsg::RunRetention { .. } => None,
        }
    }

    fn member(&self, key: u64) -> Option<&Member> {
        self.members.iter().find(|m| m.key == key)
    }

    fn send(&mut self, key: u64, msg: &HubMessage) {
        self.send_line(key, line(msg));
    }

    fn send_line(&mut self, key: u64, l: Line) {
        if let Some(m) = self.members.iter().find(|m| m.key == key) {
            Self::queue(&mut self.slow, m, l);
        }
    }

    fn broadcast(&mut self, msg: &HubMessage, except: Option<u64>) {
        self.broadcast_line(line(msg), except);
    }

    fn broadcast_line(&mut self, l: Line, except: Option<u64>) {
        for m in &self.members {
            if Some(m.key) != except {
                Self::queue(&mut self.slow, m, l.clone());
            }
        }
    }

    /// A member too slow to keep is closed rather than waited for, so one slow link never holds up the
    /// project.
    fn queue(slow: &mut Vec<u64>, m: &Member, l: Line) {
        if !m.conn.send(l) && !slow.contains(&m.key) {
            slow.push(m.key);
        }
    }

    fn close_slow(&mut self) {
        while let Some(key) = self.slow.pop() {
            if let Some(m) = self.member(key) {
                log(format!(
                    "[CẢNH BÁO] {} nhận không kịp, đóng kết nối",
                    m.name.to_utf8_lossy()
                ));
                m.conn.close();
                self.leave(key);
            }
        }
    }

    fn add_activity(
        &mut self,
        who: JsStr,
        color: String,
        kind: ActivityKind,
        path: Option<String>,
        text: Option<JsStr>,
        addr: Option<String>,
    ) {
        let a = Activity {
            ts: now_ms(),
            who,
            color,
            kind,
            path,
            text,
            addr,
        };
        log(format!("{} {}", a.who.to_utf8_lossy(), kind.sentence(&a)));
        self.stats.last_activity.store(a.ts, Ordering::Relaxed);
        self.activity.push_back(a.clone());
        while self.activity.len() > ACTIVITY_KEEP {
            self.activity.pop_front();
        }
        self.broadcast(&HubMessage::Activity { a }, None);
    }

    fn member_activity(
        &mut self,
        key: u64,
        kind: ActivityKind,
        path: Option<String>,
        text: Option<JsStr>,
    ) {
        if let Some(m) = self.member(key) {
            let (who, color) = (m.name.clone(), m.color.clone());
            self.add_activity(who, color, kind, path, text, None);
        }
    }

    /// `noteEdit`: one `edit` or `edit_disk` record per member and path, unless the same member edited the
    /// same path during the previous two minutes.
    fn note_edit(&mut self, key: u64, rel: &str, disk: bool) {
        let Some(id) = self.member(key).map(|m| m.id.clone()) else {
            return;
        };
        let now = Instant::now();
        let k = (id, rel.to_owned());
        let quiet = self
            .edit_notes
            .get(&k)
            .is_none_or(|last| now.duration_since(*last) > EDIT_NOTE);
        self.edit_notes.insert(k, now);
        if quiet {
            let kind = if disk {
                ActivityKind::EditDisk
            } else {
                ActivityKind::Edit
            };
            self.member_activity(key, kind, Some(rel.to_owned()), None);
        }
    }

    fn join(&mut self, req: JoinRequest) {
        let mut id = random_hex::<4>();
        while self.members.iter().any(|m| m.id == id) {
            id = random_hex::<4>();
        }
        let color = COLORS[self.color_index % COLORS.len()].to_owned();
        self.color_index += 1;
        self.uid_gone.remove(&req.uid);
        let member = Member {
            key: req.key,
            id,
            uid: req.uid,
            chat_key: req.chat_key,
            name: req.name,
            account: req.account,
            color,
            presence: None,
            status: JsStr::from(""),
            conn: req.conn,
            addr: req.addr.clone(),
            joined_at: now_ms(),
        };
        let welcome = self.welcome(&member);
        let key = member.key;
        let user = member.public();
        let (who, color) = (member.name.clone(), member.color.clone());
        self.members.push(member);
        self.member_count
            .store(self.members.len(), Ordering::Relaxed);
        self.send(key, &HubMessage::Welcome(welcome));
        self.broadcast(&HubMessage::Joined { user }, Some(key));
        self.add_activity(who, color, ActivityKind::Join, None, None, Some(req.addr));
    }

    fn welcome(&mut self, me: &Member) -> Welcome {
        let files = self
            .files
            .iter_mut()
            .map(|(rel, f)| {
                let info = match f {
                    FileEntry::Text(t) => FileInfo {
                        kind: FileKind::Text,
                        rev: t.rev,
                        hash: t.hash().to_owned(),
                    },
                    FileEntry::Blob { hash } => FileInfo {
                        kind: FileKind::Blob,
                        rev: 0,
                        hash: hash.clone(),
                    },
                };
                (rel.clone(), info)
            })
            .collect();
        let skip = self.activity.len().saturating_sub(WELCOME_ACTIVITY);
        Welcome {
            id: me.id.clone(),
            color: me.color.clone(),
            hub_id: self.info.hub_id.clone(),
            session: self.session.clone(),
            project: self.info.name.clone(),
            files,
            applied: self.last_seq.get(&me.uid).cloned().unwrap_or_default(),
            users: self.members.iter().map(Member::public).collect(),
            activity: self.activity.iter().skip(skip).cloned().collect(),
            features: {
                let mut f = self.info.features.clone();
                if self.edit_history.is_some() {
                    f.push("history".to_owned());
                }
                f
            },
            key: me.chat_key.clone(),
            exclude: self.info.exclude.clone(),
            chat: self
                .chat
                .iter()
                .skip(self.chat.len().saturating_sub(WELCOME_CHAT))
                .cloned()
                .collect(),
            proto: 2,
            instance_id: self.info.instance_id.clone(),
            hub_name: self.info.hub_name.clone(),
            hub_version: self.info.hub_version.clone(),
        }
    }

    fn leave(&mut self, key: u64) {
        let Some(at) = self.members.iter().position(|m| m.key == key) else {
            return;
        };
        let m = self.members.remove(at);
        self.member_count
            .store(self.members.len(), Ordering::Relaxed);
        if !self.members.iter().any(|o| o.uid == m.uid) {
            self.uid_gone.insert(m.uid.clone(), Instant::now());
        }
        self.edit_notes.retain(|(id, _), _| *id != m.id);
        self.broadcast(&HubMessage::Left { id: m.id.clone() }, None);
        self.add_activity(m.name, m.color, ActivityKind::Leave, None, None, None);
    }

    /// Applied-op sequence numbers only matter to a client reconnecting with the same uid, so the entries of
    /// a uid with no connection for an hour are dropped.
    fn forget_uids(&mut self) {
        let now = Instant::now();
        let expired: Vec<JsStr> = self
            .uid_gone
            .iter()
            .filter(|(_, at)| now.duration_since(**at) >= UID_FORGET)
            .map(|(uid, _)| uid.clone())
            .collect();
        for uid in expired {
            self.uid_gone.remove(&uid);
            self.last_seq.remove(&uid);
        }
    }

    fn flush(&mut self, rel: &str) {
        if let Some(FileEntry::Text(t)) = self.files.get(rel) {
            self.io.send(IoJob::FlushText {
                rel: rel.to_owned(),
                abs: abs_path(&self.root, rel),
                text: t.text.clone(),
            });
        }
    }

    fn io(
        &self,
        job: impl FnOnce(oneshot::Sender<IoResult<Vec<u8>>>) -> IoJob,
        then: Then,
    ) -> Option<Pending> {
        let (tx, rx) = oneshot::channel();
        self.io.send(job(tx));
        Some(Pending { rx, then })
    }

    /// The `file` message for a path the hub holds as text or does not hold; blobs are read from disk.
    fn text_or_missing(&mut self, rel: &str) -> Option<HubMessage> {
        let body = match self.files.get(rel) {
            None => FileBody::Missing { missing: true },
            Some(FileEntry::Text(t)) => FileBody::Content(FileContent::Text {
                rev: t.rev,
                text: JsStr::from_units(&t.text),
            }),
            Some(FileEntry::Blob { .. }) => return None,
        };
        Some(HubMessage::File(FileMessage {
            path: rel.to_owned(),
            body,
        }))
    }

    fn blob_msg(rel: &str, hash: String, b64: String) -> HubMessage {
        HubMessage::File(FileMessage {
            path: rel.to_owned(),
            body: FileBody::Content(FileContent::Blob { hash, b64 }),
        })
    }

    fn safe_path(msg: &Json) -> Option<String> {
        msg.get("path")
            .and_then(Json::as_str)
            .and_then(crate::paths::safe_rel)
    }

    fn on_get(&mut self, key: u64, msg: &Json) -> Option<Pending> {
        let rel = Self::safe_path(msg)?;
        if let Some(m) = self.text_or_missing(&rel) {
            self.send(key, &m);
            return None;
        }
        let Some(FileEntry::Blob { hash }) = self.files.get(&rel) else {
            return None;
        };
        let (abs, hash) = (abs_path(&self.root, &rel), hash.clone());
        self.io(
            |done| IoJob::Read { abs, done },
            Then::BlobRead { key, rel, hash },
        )
    }

    fn on_op(&mut self, key: u64, msg: &Json) {
        let rel = Self::safe_path(msg);
        let is_text = rel
            .as_ref()
            .is_some_and(|r| matches!(self.files.get(r), Some(FileEntry::Text(_))));
        let Some(rel) = rel.filter(|_| is_text) else {
            self.send(
                key,
                &HubMessage::Nack {
                    path: msg.get("path").cloned(),
                },
            );
            return;
        };
        let op = msg.get("op").and_then(op_from_json);
        let rev = msg.get("rev").and_then(Json::as_js_integer);
        let src = Source::from_wire(msg.get("src").and_then(Json::as_str));
        let reverts = msg
            .get("reverts")
            .and_then(Json::as_str)
            .filter(|r| src == Source::Revert && r.len() <= REVERTS_MAX);
        let applied = match (op, rev) {
            (Some(op), Some(rev)) => {
                self.apply_op(key, &rel, op, rev, msg.get("seq").cloned(), src, reverts)
            }
            _ => None,
        };
        match applied {
            Some(rev) => self.send(key, &HubMessage::Ack { path: rel, rev }),
            None => self.send(key, &HubMessage::Resync { path: rel }),
        }
    }

    /// `applyOp`: transforms `op` from `rev` to the current revision, applies it, broadcasts it, and returns
    /// the new revision; `None` when it does not fit.
    #[allow(clippy::too_many_arguments)]
    fn apply_op(
        &mut self,
        key: u64,
        rel: &str,
        mut op: TextOperation,
        rev: f64,
        seq: Option<Json>,
        src: Source,
        reverts: Option<&str>,
    ) -> Option<u64> {
        let Some(FileEntry::Text(f)) = self.files.get_mut(rel) else {
            return None;
        };
        if rev < f.log_start as f64 || rev > f.rev as f64 {
            return None;
        }
        let from = (rev as u64 - f.log_start) as usize;
        for s in f.log.iter().skip(from) {
            op = TextOperation::transform(&op, s).ok()?.0;
        }
        if op.base_length() != f.text.len() {
            return None;
        }
        let text = op.apply(&f.text).ok()?;
        let boundary = match (
            &self.edit_history,
            self.members.iter().find(|m| m.key == key),
        ) {
            (Some(h), Some(m)) => record_edit(
                &mut self.runs,
                &mut self.mirrored,
                h,
                rel,
                m,
                &op,
                src,
                reverts,
                &f.text,
            ),
            _ => false,
        };
        f.text = text;
        f.hash = None;
        f.log.push_back(op.clone());
        f.rev += 1;
        if f.log.len() > LOG_KEEP {
            let drop = f.log.len() - LOG_KEEP / 2;
            f.log.drain(..drop);
            f.log_start += drop as u64;
        }
        let new_rev = f.rev;
        self.stats.ops.fetch_add(1, Ordering::Relaxed);
        self.stats.last_activity.store(now_ms(), Ordering::Relaxed);
        let Some(m) = self.member(key) else {
            return Some(new_rev);
        };
        let (by, uid) = (m.id.clone(), m.uid.clone());
        if let Some(seq) = seq {
            self.last_seq
                .entry(uid)
                .or_default()
                .insert(rel.to_owned(), seq);
        }
        self.schedule.mark(rel, Instant::now());
        self.broadcast(
            &HubMessage::Op {
                path: rel.to_owned(),
                rev: new_rev - 1,
                op: WireOp(op),
                by,
            },
            Some(key),
        );
        self.note_edit(key, rel, src == Source::Disk);
        if boundary {
            self.history_changed(rel);
        }
        Some(new_rev)
    }

    fn on_create(&mut self, key: u64, msg: &Json) -> Option<Pending> {
        let rel = Self::safe_path(msg);
        let is_text = msg.get("kind").and_then(Json::as_str) == Some("text");
        let text_field = msg.get("text").and_then(Json::as_js_str);
        let excluded = rel.as_ref().is_some_and(|r| self.excluder.is_excluded(r));
        let (Some(rel), false, false) = (rel, excluded, is_text && text_field.is_none()) else {
            let reason = if excluded {
                IgnoredReason::Excluded
            } else {
                IgnoredReason::Invalid
            };
            self.send(
                key,
                &HubMessage::Ignored {
                    path: msg.get("path").cloned(),
                    reason,
                },
            );
            return None;
        };
        let by = self.member(key)?.id.clone();
        // Paths that differ only in letter case are one file on Windows: retire the old name.
        let lower = rel.to_lowercase();
        let retired: Vec<String> = self
            .files
            .keys()
            .filter(|o| **o != rel && o.to_lowercase() == lower)
            .cloned()
            .collect();
        for other in retired {
            self.schedule.cancel(&other);
            self.close_path(&other);
            self.files.remove(&other);
            self.broadcast(
                &HubMessage::Deleted {
                    path: other,
                    by: by.clone(),
                },
                Some(key),
            );
        }
        let text = text_field
            .map(|t| uniform_eol(&t.units()))
            .filter(|_| is_text);
        if let (Some(text), Some(FileEntry::Text(f))) = (&text, self.files.get(&rel)) {
            // Someone else created it first: ours becomes an edit so both clients converge.
            let edit = (f.text != *text).then(|| (diff(&f.text, text), f.rev as f64));
            if let Some((op, rev)) = edit {
                self.apply_op(key, &rel, op, rev, None, Source::Disk, None);
            }
            if let Some(m) = self.text_or_missing(&rel) {
                self.send(key, &m);
            }
            return None;
        }
        let bytes = match &text {
            Some(t) => String::from_utf16_lossy(t).into_bytes(),
            None => {
                let b64 = msg
                    .get("b64")
                    .filter(|v| v.truthy())
                    .map(Json::to_js_string)
                    .unwrap_or_else(|| "".into());
                base64_decode_lenient(&b64.to_utf8_lossy())
            }
        };
        let existed = self.files.contains_key(&rel);
        if existed {
            self.schedule.cancel(&rel);
        }
        let record = match text {
            Some(_) => None,
            None => {
                self.close_path(&rel);
                self.blob_record(key, &rel)
            }
        };
        let then = Then::Created {
            key,
            rel: rel.clone(),
            bytes_hash: sha1_hex(&bytes),
            b64: if text.is_some() {
                String::new()
            } else {
                base64_encode(&bytes)
            },
            text,
            existed,
        };
        let abs = abs_path(&self.root, &rel);
        self.io(|done| write_job(abs, bytes, done, record), then)
    }

    fn on_put(&mut self, key: u64, msg: &Json) -> Option<Pending> {
        let rel = Self::safe_path(msg);
        let Some(rel) = rel.filter(|r| !self.excluder.is_excluded(r)) else {
            let reason = if Self::safe_path(msg).is_some() {
                IgnoredReason::Excluded
            } else {
                IgnoredReason::Invalid
            };
            self.send(
                key,
                &HubMessage::Ignored {
                    path: msg.get("path").cloned(),
                    reason,
                },
            );
            return None;
        };
        // `Buffer.from(m.b64 || '', 'base64')`; any other truthy value throws in the Node hub.
        let bytes = match msg.get("b64").filter(|v| v.truthy()) {
            None => Vec::new(),
            Some(Json::Str(s)) => base64_decode_lenient(&s.to_utf8_lossy()),
            Some(_) => {
                let who = self
                    .member(key)
                    .map(|m| m.name.to_utf8_lossy().into_owned())
                    .unwrap_or_default();
                log(format!("[LỖI] xử lý \"put\" từ {who}: b64 is not a string"));
                return None;
            }
        };
        if self.files.contains_key(&rel) {
            self.schedule.cancel(&rel);
        }
        self.close_path(&rel);
        let record = self.blob_record(key, &rel);
        let then = Then::Put {
            key,
            rel: rel.clone(),
            hash: sha1_hex(&bytes),
            b64: base64_encode(&bytes),
        };
        let abs = abs_path(&self.root, &rel);
        self.io(|done| write_job(abs, bytes, done, record), then)
    }

    fn on_delete(&mut self, key: u64, msg: &Json) -> Option<Pending> {
        let rel = Self::safe_path(msg).filter(|r| self.files.contains_key(r))?;
        self.schedule.cancel(&rel);
        let abs = abs_path(&self.root, &rel);
        let record = match self.files.get(&rel) {
            Some(FileEntry::Blob { .. }) => self.blob_record(key, &rel),
            _ => None,
        };
        self.io(
            |done| match record {
                Some(record) => IoJob::RemoveRecorded { abs, done, record },
                None => IoJob::Remove { abs, done },
            },
            Then::Deleted { key, rel },
        )
    }

    fn on_check(&mut self, key: u64, msg: &Json) {
        let Some(path) = msg.get("path").and_then(Json::as_str) else {
            return;
        };
        let Some(FileEntry::Text(f)) = self.files.get_mut(path) else {
            return;
        };
        if msg.get("rev").and_then(Json::as_f64) != Some(f.rev as f64) {
            return;
        }
        if msg.get("hash").and_then(Json::as_str) == Some(f.hash()) {
            return;
        }
        let path = path.to_owned();
        if let Some(m) = self.member(key) {
            let rev = msg
                .get("rev")
                .map(Json::to_js_string)
                .unwrap_or_else(|| "".into());
            log(format!(
                "[CẢNH BÁO] {} lệch nội dung {path} ở rev {} → đồng bộ lại",
                m.name.to_utf8_lossy(),
                rev.to_utf8_lossy()
            ));
        }
        self.send(key, &HubMessage::Resync { path });
    }

    fn on_presence(&mut self, key: u64, msg: &Json) {
        let p = presence::normalize(msg.get("p"));
        let Some(m) = self.members.iter_mut().find(|m| m.key == key) else {
            return;
        };
        let change = presence::debug_change(m.presence.as_ref(), &p);
        m.presence = Some(p.clone());
        let id = m.id.clone();
        self.broadcast(&HubMessage::Presence { id, p }, Some(key));
        match change {
            Some(Some(target)) => {
                self.member_activity(key, ActivityKind::DebugStart, None, Some(target))
            }
            Some(None) => self.member_activity(key, ActivityKind::DebugStop, None, None),
            None => {}
        }
    }

    fn on_status(&mut self, key: u64, msg: &Json) {
        let text = msg
            .get("text")
            .filter(|v| v.truthy())
            .map(Json::to_js_string)
            .unwrap_or_else(|| "".into())
            .truncate_units(200);
        let Some(m) = self.members.iter_mut().find(|m| m.key == key) else {
            return;
        };
        m.status = text.clone();
        let id = m.id.clone();
        self.broadcast(
            &HubMessage::Status {
                id,
                text: text.clone(),
            },
            Some(key),
        );
        if text.is_empty() {
            self.member_activity(key, ActivityKind::StatusClear, None, None);
        } else {
            self.member_activity(key, ActivityKind::StatusSet, None, Some(text));
        }
    }

    fn on_chat(&mut self, key: u64, msg: &Json) -> Option<Pending> {
        let text = chat::text(msg.get("text"));
        let Some(upload) = msg.get("image").filter(|v| v.is_js_object()) else {
            if !text.is_empty() {
                self.post_chat(key, text, None);
            }
            return None;
        };
        let Some(image) = chat::check_image(upload) else {
            self.send(key, &Self::image_rejected());
            return None;
        };
        let abs = chat::media_path(&self.history, &image.id, image.ext);
        let bytes = image.bytes;
        self.io(
            |done| IoJob::WriteNew { abs, bytes, done },
            Then::ChatImage {
                key,
                text,
                image: image.meta,
            },
        )
    }

    fn image_rejected() -> HubMessage {
        HubMessage::ChatRejected {
            code: ChatRejectCode::ImageInvalid,
            data: ChatRejectData {
                max_bytes: IMAGE_MAX as u64,
            },
        }
    }

    /// Records an accepted message and sends it to every member, the sender included.
    fn post_chat(&mut self, key: u64, text: JsStr, image: Option<Json>) {
        let Some(m) = self.member(key) else {
            return;
        };
        let account = match &m.account {
            Some(a) => Json::Obj(vec![
                ("provider".into(), Json::Str(a.provider.clone())),
                ("label".into(), Json::Str(a.label.clone())),
            ]),
            None => Json::Null,
        };
        let mut fields = vec![
            ("id".into(), Json::Str(random_hex::<6>().into())),
            ("ts".into(), Json::Num(now_ms() as f64)),
            ("from".into(), Json::Str(m.name.clone())),
            ("fromId".into(), Json::Str(m.id.clone().into())),
            ("fromKey".into(), Json::Str(m.chat_key.clone().into())),
            ("color".into(), Json::Str(m.color.clone().into())),
            ("account".into(), account),
            ("text".into(), Json::Str(text)),
        ];
        if let Some(image) = image {
            fields.push(("image".into(), image));
        }
        let msg = Json::Obj(fields);
        self.io.send(IoJob::Append {
            abs: chat::log_path(&self.history),
            bytes: json::to_line(&msg),
            what: "chat",
        });
        self.chat.push_back(msg.clone());
        while self.chat.len() > CHAT_KEEP {
            self.chat.pop_front();
        }
        self.broadcast(&HubMessage::Chat { msg }, None);
    }

    fn on_media(&mut self, key: u64, msg: &Json) -> Option<Pending> {
        let id = msg
            .get("id")
            .and_then(Json::as_str)
            .filter(|id| chat::is_media_id(id));
        let found = match id.map(|id| chat::find_image(&self.chat, id)) {
            Some(Err(chat::NullLine)) => {
                self.log_failure("media", key, "a chat history line is null");
                return None;
            }
            Some(Ok(found)) => found,
            None => None,
        };
        let (Some(id), Some(image)) = (id, found) else {
            let echo = msg
                .get("id")
                .filter(|v| v.truthy())
                .map(Json::to_js_string)
                .unwrap_or_else(|| "".into())
                .truncate_units(40);
            self.send(
                key,
                &HubMessage::Media(MediaReply::Missing {
                    id: echo,
                    missing: true,
                }),
            );
            return None;
        };
        let mime = image.get("mime").cloned().unwrap_or(Json::Null);
        let abs = chat::media_path(
            &self.history,
            id,
            chat::image_ext(image.get("mime")).unwrap_or("undefined"),
        );
        let id = id.to_owned();
        self.io(
            |done| IoJob::Read { abs, done },
            Then::Media { key, id, mime },
        )
    }

    fn log_failure(&self, what: &str, key: u64, e: &str) {
        let who = self
            .member(key)
            .map(|m| m.name.to_utf8_lossy().into_owned())
            .unwrap_or_default();
        log(format!("[LỖI] xử lý \"{what}\" từ {who}: {e}"));
    }

    fn finish(&mut self, then: Then, outcome: IoResult<Vec<u8>>) {
        match then {
            Then::BlobRead { key, rel, hash } => match outcome {
                Ok(bytes) => self.send(key, &Self::blob_msg(&rel, hash, base64_encode(&bytes))),
                Err(e) => self.log_failure("get", key, &e),
            },
            Then::Created {
                key,
                rel,
                text,
                bytes_hash,
                b64,
                existed,
            } => {
                if let Err(e) = outcome {
                    log(format!("[LỖI] không ghi được {rel}: {e}"));
                    self.send(
                        key,
                        &HubMessage::Ignored {
                            path: Some(Json::Str(rel.into())),
                            reason: IgnoredReason::WriteFailed,
                        },
                    );
                    return;
                }
                if text.is_none() && self.edit_history.is_some() {
                    self.history_changed(&rel);
                }
                let msg = match text {
                    Some(text) => {
                        self.files
                            .insert(rel.clone(), FileEntry::Text(TextFile::new(text)));
                        self.text_or_missing(&rel)
                            .expect("a text file was just stored")
                    }
                    None => {
                        self.files.insert(
                            rel.clone(),
                            FileEntry::Blob {
                                hash: bytes_hash.clone(),
                            },
                        );
                        Self::blob_msg(&rel, bytes_hash, b64)
                    }
                };
                self.broadcast(&msg, None);
                if !existed {
                    self.member_activity(key, ActivityKind::Create, Some(rel), None);
                }
            }
            Then::Put {
                key,
                rel,
                hash,
                b64,
            } => {
                if let Err(e) = outcome {
                    log(format!("[LỖI] không ghi được {rel}: {e}"));
                    self.send(
                        key,
                        &HubMessage::Ignored {
                            path: Some(Json::Str(rel.into())),
                            reason: IgnoredReason::WriteFailed,
                        },
                    );
                    return;
                }
                self.files
                    .insert(rel.clone(), FileEntry::Blob { hash: hash.clone() });
                if self.edit_history.is_some() {
                    self.history_changed(&rel);
                }
                self.send(
                    key,
                    &HubMessage::Stored {
                        path: rel.clone(),
                        hash: hash.clone(),
                    },
                );
                self.broadcast(&Self::blob_msg(&rel, hash, b64), Some(key));
                self.note_edit(key, &rel, true);
            }
            Then::ChatImage { key, text, image } => match outcome {
                Ok(_) => self.post_chat(key, text, Some(image)),
                Err(e) => {
                    log(format!("[LỖI] không lưu được ảnh chat: {e}"));
                    self.send(key, &Self::image_rejected());
                }
            },
            Then::Media { key, id, mime } => {
                // `b64 ? found : missing`: an empty file reads as missing in the Node hub.
                let reply = match outcome {
                    Ok(bytes) if !bytes.is_empty() => MediaReply::Found {
                        id,
                        mime,
                        b64: base64_encode(&bytes),
                    },
                    _ => MediaReply::Missing {
                        id: id.into(),
                        missing: true,
                    },
                };
                self.send(key, &HubMessage::Media(reply));
            }
            Then::Deleted { key, rel } => {
                if let Err(e) = outcome {
                    self.log_failure("delete", key, &e);
                    return;
                }
                self.record_delete(key, &rel);
                self.files.remove(&rel);
                if let Some(by) = self.member(key).map(|m| m.id.clone()) {
                    self.broadcast(
                        &HubMessage::Deleted {
                            path: rel.clone(),
                            by,
                        },
                        Some(key),
                    );
                }
                self.member_activity(key, ActivityKind::Delete, Some(rel), None);
            }
        }
    }

    // Edit-run history (`history` module).

    /// At most one `history_changed` per path per `CHANGED_EVERY`: when several members type in one file,
    /// almost every op is a run boundary, and a message per op would double the fan-out.
    fn history_changed(&mut self, path: &str) {
        let now = Instant::now();
        let recent = self
            .changed_sent
            .get(path)
            .is_some_and(|at| now.duration_since(*at) < CHANGED_EVERY);
        if recent {
            self.changed_due.insert(path.to_owned());
            return;
        }
        self.changed_sent.insert(path.to_owned(), now);
        self.broadcast(
            &HubMessage::HistoryChanged {
                path: path.to_owned(),
            },
            None,
        );
    }

    fn flush_changed(&mut self) {
        let now = Instant::now();
        let ready: Vec<String> = self
            .changed_due
            .iter()
            .filter(|p| {
                self.changed_sent
                    .get(*p)
                    .is_none_or(|at| now.duration_since(*at) >= CHANGED_EVERY)
            })
            .cloned()
            .collect();
        for path in ready {
            self.changed_due.remove(&path);
            self.changed_sent.insert(path.clone(), now);
            self.broadcast(&HubMessage::HistoryChanged { path }, None);
        }
        self.changed_sent
            .retain(|_, at| now.duration_since(*at) < CHANGED_EVERY);
    }

    fn reconfigure_history(&mut self, info: &ProjectInfo) {
        let (old, new) = (&self.info.history, &info.history);
        self.runs.set_idle_ms(new.idle_ms());
        if let Some(h) = &self.edit_history
            && history::limits(old) != history::limits(new)
        {
            h.send(Job::Limits(history::limits(new)));
        }
    }

    /// Sends the history thread the text of `rel` unless it already holds it.
    fn ensure_mirror(&mut self, rel: &str) {
        if self.mirrored.contains(rel) {
            return;
        }
        if let (Some(h), Some(FileEntry::Text(t))) = (&self.edit_history, self.files.get(rel)) {
            h.send(Job::Text {
                path: rel.to_owned(),
                text: Arc::from(t.text.as_slice()),
            });
            self.mirrored.insert(rel.to_owned());
        }
    }

    fn forget_mirror(&mut self, rel: &str) {
        if self.mirrored.remove(rel)
            && let Some(h) = &self.edit_history
        {
            h.send(Job::Forget {
                path: rel.to_owned(),
            });
        }
    }

    /// Ends runs at the file's current text, drops the mirrors they needed, and tells every member.
    fn end_runs(&mut self, closed: Vec<Closed>) {
        for c in closed {
            if let Some(h) = &self.edit_history {
                h.send(close_job(&c));
            }
            self.forget_mirror(&c.path);
            self.history_changed(&c.path);
        }
    }

    /// The file is about to be deleted, renamed or replaced: its open run ends now.
    fn close_path(&mut self, rel: &str) {
        if self.edit_history.is_none() {
            return;
        }
        if let Some(c) = self.runs.close(rel, now_ms()) {
            self.end_runs(vec![c]);
        }
    }

    fn author(&self, key: u64) -> Option<Author> {
        self.member(key).map(|m| Author {
            uid: m.uid.to_utf8_lossy().into_owned(),
            name: m.name.to_utf8_lossy().into_owned(),
            color: m.color.clone(),
        })
    }

    fn blob_record(&self, key: u64, rel: &str) -> Option<BlobRecord> {
        Some(BlobRecord {
            tx: self.edit_history.as_ref()?.sender()?,
            path: rel.to_owned(),
            author: self.author(key)?,
            before: match self.files.get(rel) {
                Some(FileEntry::Text(t)) => Some(String::from_utf16_lossy(&t.text).into_bytes()),
                _ => None,
            },
        })
    }

    /// A deletion is a run of its own that keeps the deleted content (a blob's is recorded by the IO
    /// thread). Called before the file leaves `files`.
    fn record_delete(&mut self, key: u64, rel: &str) {
        if self.edit_history.is_none() {
            return;
        }
        if let Some(c) = self.runs.close(rel, now_ms())
            && let Some(h) = &self.edit_history
        {
            h.send(close_job(&c));
        }
        let len = match self.files.get(rel) {
            Some(FileEntry::Text(t)) => Some(t.text.len() as u64),
            _ => None,
        };
        if let (Some(len), Some(author)) = (len, self.author(key)) {
            self.ensure_mirror(rel);
            if let Some(h) = &self.edit_history {
                h.send(Job::Closed {
                    path: rel.to_owned(),
                    author,
                    source: Source::Delete,
                    kind: FileKind::Text,
                    at: now_ms(),
                    chars_removed: len,
                    start: StartBlob::SameAsEnd,
                    end: Content::Mirror,
                });
            }
        }
        self.forget_mirror(rel);
        self.history_changed(rel);
    }

    fn on_history_list(&mut self, key: u64, msg: &Json) {
        let Some(h) = &self.edit_history else { return };
        let path = match msg.get("path") {
            None | Some(Json::Null) => None,
            Some(v) => match v.as_str().and_then(safe_rel) {
                Some(p) => Some(p),
                None => return,
            },
        };
        let (before, before_text) = match msg.get("before") {
            None | Some(Json::Null) => (None, None),
            Some(v) => match v
                .as_str()
                .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            {
                // Beyond i64 is newer than any id.
                Some(s) => (
                    Some(s.parse::<i64>().unwrap_or(i64::MAX)),
                    Some(s.to_owned()),
                ),
                None => return,
            },
        };
        let limit = msg
            .get("limit")
            .and_then(Json::as_js_integer)
            .map_or(history::LIST_DEFAULT, |n| {
                n.clamp(1.0, history::LIST_MAX as f64) as usize
            });
        h.send(Job::List {
            key,
            path,
            before,
            before_text,
            limit,
        });
    }

    fn on_history_blob(&mut self, key: u64, msg: &Json) {
        let Some(h) = &self.edit_history else { return };
        let Some(blob) = msg.get("blob").and_then(Json::as_str) else {
            return;
        };
        if history::blobs::is_sha256(blob) {
            h.send(Job::Blob {
                key,
                blob: blob.to_owned(),
            });
        } else {
            let reply = HubMessage::HistoryBlob {
                blob: blob.to_owned(),
                body: HistoryBlobBody::Missing { missing: true },
            };
            self.send(key, &reply);
        }
    }

    /// Ends every open run now, then records the checkpoint; the history thread sends every member the
    /// new `checkpoint_list`.
    fn on_checkpoint_create(&mut self, key: u64, msg: &Json) {
        if self.edit_history.is_none() {
            return;
        }
        let name = msg
            .get("name")
            .and_then(Json::as_js_str)
            .map(|n| n.trim().truncate_units(history::CHECKPOINT_NAME_MAX))
            .filter(|n| !n.is_empty());
        let (Some(name), Some(author)) = (name, self.author(key)) else {
            return;
        };
        let at = now_ms();
        let closed = self.runs.close_all(at);
        self.end_runs(closed);
        if let Some(h) = &self.edit_history {
            h.send(Job::Checkpoint {
                name: name.to_utf8_lossy().into_owned(),
                author,
                at,
            });
        }
    }
}

const REVERTS_MAX: usize = 64;
const CHANGED_EVERY: Duration = Duration::from_secs(1);
const CHANGED_TICK: Duration = Duration::from_millis(200);

fn counters(run: &OpenRun) -> Counters {
    Counters {
        last_at: run.last_at,
        op_count: run.op_count,
        chars_added: run.chars_added,
        chars_removed: run.chars_removed,
    }
}

fn close_job(c: &Closed) -> Job {
    Job::Close {
        key: c.run.key,
        path: c.path.clone(),
        ended_at: c.ended_at,
        counters: counters(&c.run),
    }
}

/// Feeds one applied op to the run state machine; `before` is the text the op applies to. Returns true
/// when a run started or ended.
#[allow(clippy::too_many_arguments)]
fn record_edit(
    runs: &mut Runs,
    mirrored: &mut HashSet<String>,
    h: &History,
    rel: &str,
    m: &Member,
    op: &TextOperation,
    source: Source,
    reverts: Option<&str>,
    before: &[u16],
) -> bool {
    let (mut added, mut removed) = (0u64, 0u64);
    for c in op.ops() {
        match c {
            Component::Insert(s) => added += s.len() as u64,
            Component::Delete(n) => removed += *n as u64,
            Component::Retain(_) => {}
        }
    }
    let (uid, name) = (m.uid.to_utf8_lossy(), m.name.to_utf8_lossy());
    let out = runs.edit(
        rel,
        Edit {
            uid: &uid,
            name: &name,
            color: &m.color,
            source,
            reverts,
            at: now_ms(),
            added,
            removed,
        },
    );
    if !mirrored.contains(rel) {
        h.send(Job::Text {
            path: rel.to_owned(),
            text: Arc::from(before),
        });
        mirrored.insert(rel.to_owned());
    }
    if let Some(c) = &out.closed {
        h.send(close_job(c));
    }
    let run = runs.get(rel).expect("an edit leaves its run open");
    if out.opened {
        h.send(Job::Open {
            key: run.key,
            path: rel.to_owned(),
            author: run.author.clone(),
            source: run.source,
            reverts: run.reverts.clone(),
            started_at: run.started_at,
        });
    }
    h.send(Job::Op {
        key: run.key,
        path: rel.to_owned(),
        op: op.clone(),
        counters: counters(run),
    });
    out.closed.is_some() || out.opened
}

fn write_job(
    abs: PathBuf,
    bytes: Vec<u8>,
    done: oneshot::Sender<IoResult<Vec<u8>>>,
    record: Option<BlobRecord>,
) -> IoJob {
    match record {
        Some(record) => IoJob::WriteRecorded {
            abs,
            bytes,
            done,
            record,
        },
        None => IoJob::Write { abs, bytes, done },
    }
}

/// How often idle runs are looked for: a quarter of the idle time, between 50 ms and 30 s.
fn idle_interval(idle_ms: u64) -> Interval {
    let mut i = interval(Duration::from_millis((idle_ms / 4).clamp(50, 30_000)));
    i.set_missed_tick_behavior(MissedTickBehavior::Delay);
    i
}

async fn next_reply(rx: &mut Option<mpsc::UnboundedReceiver<Reply>>) -> Option<Reply> {
    match rx {
        Some(rx) => rx.recv().await,
        None => std::future::pending().await,
    }
}
