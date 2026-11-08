# LAN Collab protocol 2

This is the wire contract between a LAN Collab hub and its clients. The Node hub (`hub/hub.js`, until I1) and the Rust hub (`lanhub`) implement the hub side, and `lib/client-core.js` and the extension implement the client side. The black-box suite in `test/conformance/` checks a hub against this document. `docs/plans/README.md` section 5.4 records why each part looks the way it does.

Words: **must** is required for conformance, **should** is expected unless there is a stated reason, **may** is optional. "Hub" alone means any hub. "Node hub" and "lanhub" name one implementation.

Contents: [1 Transport](#1-transport) · [2 Paths, text and operations](#2-paths-text-and-operations) · [3 Handshake](#3-handshake) · [4 Errors and refusals](#4-errors-and-refusals) · [5 Client to hub](#5-client-to-hub) · [6 Hub to client](#6-hub-to-client) · [7 Activity](#7-activity) · [8 Presence and RTT](#8-presence-and-rtt) · [9 Features](#9-features) · [10 LAN discovery](#10-lan-discovery) · [11 Invite codes](#11-invite-codes) · [12 History](#12-history) · [13 lanhub-only transport features](#13-lanhub-only-transport-features) · [14 Protocol 1 compatibility](#14-protocol-1-compatibility) · [15 Client rendering](#15-client-rendering) · [16 CLI contract for tests](#16-cli-contract-for-tests)

## 1. Transport

- TCP, default port **8200**. One connection is one member, or one probe.
- Framing is NDJSON: each message is one JSON object encoded as UTF-8 on one line ending with `\n` (LF). A sender must not put a raw LF inside a message (JSON escapes it). A receiver skips empty lines and lines that are not valid JSON, and keeps the connection.
- Every message is an object with a string field `t`, its type. Field order carries no meaning, except in the protocol 1 compatibility rule of section 14.
- Line length limits, counted in UTF-16 code units of the decoded line, as `String.length` in JavaScript:
  - Before the hello is accepted: **65 536** (64 Ki). A line still unterminated past this limit closes the connection.
  - After it: **419 430 400** (400 Mi, `MAX_LINE` in `lib/common.js`). Files travel inside one message as text or base64, so this limit is the largest file a hub accepts. A client must not send a longer line, because the hub drops the connection and resending after reconnect would loop.
- The first message must be `hello` (section 3). Any other first message, or a first line that parses to something other than an object with a string `t`, closes the connection. A connection that has not sent an accepted `hello` within **15 seconds** is closed.
- After the hello is accepted, a message whose `t` the hub does not know is ignored. So is a message that is not an object with a string `t`. A hub must not close a member's connection for either.
- The hub sets TCP no-delay and keep-alive (10 s) on every connection. Clients should do the same.
- Liveness: the client sends `ping` every 3 seconds and treats a connection with no received bytes for 35 seconds as dead. While the hub is still receiving one large line from a member, it sends that member `pong` at most every 5 seconds, so the client's watchdog does not fire during a large upload.

## 2. Paths, text and operations

**Paths.** Every `path` is relative to the project root, uses `/` as separator, and is checked with `safeRel` in `lib/common.js`, which is normative. A hub converts `\` to `/` and refuses an empty path, a leading `/`, a drive letter, an empty segment, `.` or `..`, a segment with `< > : " | ? *` or a control character, a segment ending in `.` or space, an 8.3 short name such as `GIT~1`, and the Windows device names (`con`, `prn`, `aux`, `nul`, `com0`-`com9`, `lpt0`-`lpt9`, with or without an extension). A client applies the same check to every path the hub sends (the hub is not authenticated to the client).

**Exclusion.** A path is excluded when it, or any folder above it, matches a pattern. The patterns are `DEFAULT_EXCLUDE` in `lib/common.js` plus the hub's own (`--exclude`, or `exclude` in `lanhub.toml`). Glob rules are those of `makeExcluder`: case-insensitive, `*` and `?` stay inside one segment, `**/` spans folders, and a pattern without `/` matches at any depth. The hub never stores an excluded path and sends its full pattern list in `welcome.exclude`, so clients skip the same files.

**Text or blob.** A file is text when its extension is not in `BLOB_EXT`, it is at most 1 MiB, it has no NUL byte, and its bytes survive a UTF-8 decode and re-encode unchanged (`classify` in `lib/common.js`). Everything else is a blob. A hub stores each text file with one line-ending style, the one most of its lines already use (a tie goes to LF), and applies the same rule to text arriving in `create`.

**Hashes.** `hash` is the lowercase hex SHA-1 of the UTF-8 bytes of a text, or of the raw bytes of a blob.

**Operations.** An `op` is the JSON form of a `TextOperation` from `lib/ot.js`, which is normative for apply, compose and transform: an array whose items are a positive integer (retain that many units), a non-empty string (insert it), or a negative integer (delete that many units). Positions and lengths count UTF-16 code units. When two inserts meet at the same position during transform, the op that arrives at the hub first keeps its place before the other.

**Revisions.** Each text file has a revision number `rev` that starts at 0 when the hub loads or creates the file and grows by one for every applied op. Revisions restart at 0 whenever the hub restarts. A client detects a restart through `welcome.session` and reconciles by hash, never by rev alone. A hub keeps at least the last 1000 ops of each file so it can transform an op sent against a recent rev. The Node hub keeps up to 2000 and trims back to 1000.

## 3. Handshake

The client opens the connection and sends `hello`. The hub answers with exactly one of `welcome` (member accepted), `error` (refused, section 4), or `probe_result` (probe, below). After an `error` or a `probe_result` the hub closes the connection.

### 3.1 hello (client to hub)

| Field | Type | Meaning |
|---|---|---|
| `proto` | integer | Protocol version. 2 for this document. |
| `project` | string | Project to join. Compared case-insensitively. |
| `token` | string | The project's secret. Ignored when the project has no token. |
| `name` | string | Display name. The hub truncates it to 60 characters. When missing, the hub uses the account label, else `ẩn danh`. |
| `uid` | string | Id of this client session. A reconnect of the same session sends the same `uid`, which selects `welcome.applied`. |
| `device` | string or null | Stable id of the machine, used only to derive `welcome.key`. |
| `account` | object or null | `{provider, label}` of the VS Code account, for example `{"provider":"github","label":"alice"}`. Taken into account only when `label` is a non-empty string. The hub truncates `provider` to 20 and `label` to 100 characters. |
| `probe` | boolean | `true` asks for a `probe_result` instead of joining. |

### 3.2 Version selection

- A hello whose `proto` is an integer of 2 or more follows this document.
- Any other hello (proto 1, missing, not an integer) follows protocol 1, section 14. The Node hub answers it as hub 0.1.1 did. lanhub refuses it with the legacy message of section 14.2.

### 3.3 Checks, in order

The hub checks the hello in this order and stops at the first failure. The order matters because a token belongs to a project, so the project must be known before the token can be judged, and an account is judged only for a holder of the token.

1. **proto.** Must be a version the hub speaks. Otherwise `protocol_version`.
2. **project.** Must name a project the hub serves, compared case-insensitively. Otherwise `project_unknown`.
3. **token.** When the project has a token, `hello.token` must equal it exactly. Otherwise `token_invalid`.
4. **account.** When the project has a non-empty allow list, `hello.account` must match an entry. Otherwise `account_required` (no account sent) or `account_denied` (account not in the list).

Allow list rules (Node hub `--allow-file`, lanhub `allow` in `lanhub.toml`): one entry per line, `#` starts a comment, surrounding spaces are ignored, matching is case-insensitive, and an entry matches either `provider:label` or the bare `label`. A missing, unreadable or empty list lets every token holder in. The Node hub re-reads the file on every hello.

### 3.4 probe_result (hub to client)

A probe runs the same checks without joining. It is how "join by code" and the connection diagnosis test a code before touching any folder. The hub answers, then closes the connection. A probe is not a member: no `joined`, no activity.

| Field | Type | Meaning |
|---|---|---|
| `proto_ok` | boolean | Step 1 passed. |
| `project_ok` | boolean or null | Step 2 passed. `null` when not checked because an earlier step failed. |
| `token_ok` | boolean or null | Step 3, same convention. |
| `account_ok` | boolean or null | Step 4, same convention. |
| `account_error` | object | Only when `account_ok` is `false`: `{code, data}` exactly as the `error` a join would get (`account_required` or `account_denied`). |
| `projects` | string array | Projects the hub advertises (section 10). The Node hub always lists its one project. |
| `hubId` | string or null | The project's `hubId` (section 6.1) when `project_ok` is true, else `null`. |
| `hubName` | string | The hub's display name. |
| `instanceId` | string | The hub's instance id (section 6.1). |
| `hubMin`, `hubMax` | integer | Protocol versions the hub accepts. |

A probe sent without an account to a project with an allow list gets `account_ok: false`. The extension's join-by-code treats that as passing and lets the real join judge the account it then sends.

## 4. Errors and refusals

There are two kinds of refusal, and they never mix.

- **`error`** refuses the connection. It is only sent in answer to `hello` (or, for `tls_required`, to the first bytes), and the hub closes the connection right after it. A client must not reconnect automatically after an `error`; it shows the reason and waits for the user.
- **Per-message refusals** concern one message and keep the connection: `ignored`, `nack`, `resync`, `chat_rejected`, and the generic `rejected` reserved for C5. They are described with the message that triggers them (sections 5 and 6).

### 4.1 error (hub to client)

`{"t":"error","code":<string>,"data":<object>}`. `data` is always present, `{}` when the code has no fields. A protocol 2 error carries no display text: no `message`, no sentence in `data`. The client renders the text from `code` and `data` (section 15).

| `code` | `data` | Sent when |
|---|---|---|
| `protocol_version` | `{hubMin, hubMax}` integers | `hello.proto` is outside `hubMin`..`hubMax`. Node hub: `{1, 2}`. lanhub: `{2, 2}`. |
| `project_unknown` | `{projects}` string array | No served project matches `hello.project`. `projects` lists the advertised projects, possibly empty. |
| `token_invalid` | `{}` | The project has a token and `hello.token` differs. |
| `account_required` | `{}` | The project has a non-empty allow list and the hello has no usable account. |
| `account_denied` | `{account, entry, file?}` | The account matches no entry. `account` is `provider:label` as sent. `entry` is the line the administrator adds to let it in, today equal to `account`. `file` is optional: the Node hub sends the base name of its allow file so the client can name it; lanhub omits it. |
| `tls_required` | `{}` | lanhub with TLS on received a plain TCP connection (section 13.1). |

Example: `{"t":"error","code":"token_invalid","data":{}}`.

### 4.2 rejected (hub to client, reserved)

`{"t":"rejected","code":<string>,"path":<string, optional>,"data":<object, optional>}` refuses one message and keeps the connection. No hub sends it before C5, whose first code is `role_denied` (a viewer's write). A client shows it as a notice for that action only and never treats it as a connection failure. A client ignores a `rejected` code it does not know.

## 5. Client to hub

Messages a member may send after `welcome`. Before `welcome` only `hello` is valid.

| `t` | Fields | Hub reaction |
|---|---|---|
| `get` | `path` | Replies `file` for that path (text, blob, or `missing`). An unsafe path gets no reply. |
| `op` | `path`, `rev`, `op`, `seq?`, `src?`, `reverts?` | See 5.1. |
| `create` | `path`, `kind` (`"text"` or `"blob"`), `text` (text) or `b64` (blob) | See 5.2. |
| `put` | `path`, `b64` | Stores the bytes as a blob, replacing any file at that path. Replies `stored {path, hash}` to the sender and sends `file` to every other member. Activity `edit_disk` (throttled, section 7). An unsafe path replies `ignored` with reason `invalid`, an excluded one with `excluded`, a failed disk write with `write-failed`. |
| `delete` | `path` | Removes the file from memory and disk, sends `deleted {path, by}` to every other member, activity `delete`. No reply to the sender. An unknown path is ignored. |
| `check` | `path`, `rev`, `hash` | When the hub holds that text file at the same `rev` and its hash differs, replies `resync {path}`. Otherwise nothing. Clients send it after each change of their confirmed rev, so a silent divergence heals. |
| `presence` | `p` | See section 8. |
| `status` | `text` | Sets the member's status (truncated to 200 characters, empty clears it). Sends `status {id, text}` to every other member. Activity `status_set` or `status_clear`, on every `status` message. |
| `chat` | `text`, `image?` | See 5.3. |
| `media` | `id` | Replies `media {id, mime, b64}` with the bytes of a chat image, or `media {id, missing: true}` when the id is malformed or the file is gone. |
| `ping` | none | Replies `pong {ts}` (section 6). |
| `history_list`, `history_blob`, `checkpoint_create`, `checkpoint_list` | see section 12 | Only with feature `history`. |

### 5.1 op

- `rev` is the revision the op was made against. `op` is relative to the file's text at that rev.
- `seq` is the client's own counter for its ops. When present, the hub records the last `seq` it applied for this (`hello.uid`, path) and returns it in `welcome.applied` on the next join of the same uid. A client uses it after a reconnect to tell whether its unacknowledged op was applied before the link dropped. The Node hub forgets the entries of a uid that has had no connection for one hour.
- `src` says where the change came from. It is recorded, not enforced, and an unknown value counts as `editor`.

  | `src` | Meaning |
  |---|---|
  | `editor` | Typed in the editor. The default when absent. |
  | `disk` | Written to the file on disk outside the editor (an AI tool, a script, git) and merged by the client. Activity kind `edit_disk` instead of `edit`. |
  | `revert` | Produced by undoing one edit run (B7). Comes with `reverts`. |
  | `merge` | The client's unsent local changes merged into the hub's text after a reconnect or a resync (a three-way merge). `lib/client-core.js` sends it since P0-2. |

- `reverts` is a string, the id of the edit run being undone. Sent only with `src: "revert"`. The Node hub ignores it. lanhub records it from A5 on.
- When the path has no text file, the hub replies `nack {path}` (the path as sent). The client then recreates the file from its own text.
- When `op` is not a valid operation, `rev` is not an integer, `rev` is older than the oldest kept op or newer than the current rev, or the op does not fit the text at `rev`, the hub replies `resync {path}`. The client fetches the file and merges.
- Otherwise the hub transforms the op over every op applied since `rev`, applies it, replies `ack {path, rev}` with the new current rev, and sends `op {path, rev, op, by}` to every other member, where `rev` is the revision the transformed op applies to (new rev minus one) and `by` is the sender's connection id. Activity `edit` or `edit_disk` (throttled).
- Order guarantee: a member receives `ack` and `op` messages for one file in the order the hub applied them.

### 5.2 create

- An unsafe path, an excluded path, or `kind: "text"` without a string `text` replies `ignored {path, reason}` with the path as sent and reason `invalid` or `excluded`. The hub always answers a `create`, so the client never waits for a file the hub will not take.
- Paths that differ only in letter case are one file on Windows. The hub retires every other stored path equal to this one ignoring case: it forgets it and sends `deleted {path: <old>, by}` to every other member.
- Text onto an existing text file: someone created it first. When the texts differ, the hub applies the difference as an op from this member (`src` `disk`, so `op` to the others and activity `edit_disk`), then replies `file` with the result to this member only.
- Otherwise the hub writes the file (text after line-ending normalization, or the decoded `b64`) and sends `file` to every member including the sender. A failed write replies `ignored` with reason `write-failed`. Activity `create` only when the path did not exist before.

### 5.3 chat

- `text` is trimmed and truncated to 4000 characters. A message with neither text nor image is ignored.
- `image` is `{mime, b64, w?, h?}`. `mime` must be `image/png`, `image/jpeg`, `image/gif` or `image/webp`, and the decoded size must be between 1 byte and 4 MiB. The hub stores the bytes once as `<history>/chat-media/<sha1>.<ext>`.
- An invalid image replies `chat_rejected {code: "image_invalid", data: {maxBytes: 4194304}}` and nothing is sent to others.
- An accepted message is appended to `<history>/chat.jsonl` and sent as `chat {msg}` to every member including the sender, in hub order. `msg` is `{id, ts, from, fromId, fromKey, color, account, text, image?}`: `id` 12 hex characters, `ts` hub time in ms, `from` the sender's name, `fromId` its connection id, `fromKey` its `welcome.key`, `account` as in `hello` or null, and `image` `{id, mime, size, w, h}` where `id` is the SHA-1 of the bytes and `w`, `h` are 0 unless the client sent positive integers below 100000.
- The hub keeps the last 500 messages and sends the last 200 in `welcome.chat`, including after a restart.

## 6. Hub to client

| `t` | Fields | When |
|---|---|---|
| `welcome` | see 6.1 | Answer to an accepted `hello`. |
| `probe_result` | see 3.4 | Answer to a probe. |
| `error` | `code`, `data` | Refused hello (section 4). |
| `file` | `path`, then `kind: "text"`, `rev`, `text`; or `kind: "blob"`, `hash`, `b64`; or `missing: true` | Answer to `get`, result of `create`, others' `put`. |
| `op` | `path`, `rev`, `op`, `by` | Another member's op, transformed (5.1). |
| `ack` | `path`, `rev` | Own op applied; `rev` is the file's new rev. |
| `nack` | `path` | Op for a file the hub does not hold as text. |
| `resync` | `path` | The client must fetch the file and merge (5.1, `check`). |
| `stored` | `path`, `hash` | Own `put` stored; the client may treat this blob version as synced. |
| `ignored` | `path`, `reason` (`invalid`, `excluded`, `write-failed`) | The hub did not take a `create` or `put`. The client stops offering that path for the session. |
| `deleted` | `path`, `by` | Another member deleted the file, or a case-only rename retired the old name. |
| `joined` | `user` (6.2) | A member joined. Not sent to the joiner. |
| `left` | `id` | A member's connection closed. |
| `presence` | `id`, `p` | Another member's presence (section 8). |
| `status` | `id`, `text` | Another member's status. |
| `activity` | `a` | One activity record (section 7), sent to every member including the one who caused it. |
| `chat` | `msg` | A chat message (5.3). |
| `chat_rejected` | `code`, `data` | Own chat image refused (5.3). |
| `media` | `id`, `mime`, `b64` or `id`, `missing` | Answer to `media`. |
| `pong` | `ts` | Answer to `ping`, and the keep-alive during a large upload (section 1). `ts` is the hub's clock in ms since the Unix epoch. |
| `rejected` | `code`, `path?`, `data?` | Reserved for C5 (4.2). |
| `history_runs`, `history_blob`, `history_changed`, `checkpoint_list` | see section 12 | Only with feature `history`. |

### 6.1 welcome

| Field | Type | Meaning |
|---|---|---|
| `id` | string | This connection's member id (8 hex characters in the Node hub). Changes on every connection. |
| `color` | string | `#rrggbb` assigned to this member. |
| `hubId` | string | The project's stable id, read from `<root>/.lan-collab/hub.json` field `id`, written on first start and never changed. Clients key their per-project state on it (`lanCollab.known:<hubId>` and friends), so a hub must keep the value hub 0.1 wrote, or every client syncs from scratch. |
| `session` | string | Random per hub start (12 hex characters in the Node hub). A new value tells the client the hub restarted and revs restarted. |
| `project` | string | The project's name as the hub spells it. |
| `files` | object | Manifest `{<path>: {kind, rev, hash}}` of every stored file. Blobs have `rev` 0. |
| `applied` | object | `{<path>: seq}`, the last applied `seq` per path for this `hello.uid` (5.1). |
| `users` | array | The other members, as 6.2. |
| `activity` | array | The last 60 activity records (section 7). |
| `features` | string array | Section 9. |
| `key` | string | 16 hex characters, `sha1("chat:" + (device or uid or random))`. Marks this machine's own chat messages across reconnects, restarts and a hub swap without revealing the device id. |
| `exclude` | string array | The hub's full exclude list (section 2). |
| `chat` | array | The last 200 chat messages. |
| `proto` | integer | 2. Added in protocol 2. |
| `instanceId` | string | Stable id of the hub as a whole, the same for every project it serves. Discovery replies and invite v3 carry it so a client can find this hub again at a new address. The Node hub stores it as field `instance` in `<root>/.lan-collab/hub.json`, next to `id`; lanhub stores it in its config folder (`instance.json`). Added in protocol 2. |
| `hubName` | string | Display name of the hub. The Node hub uses `--name`, else the host name. Added in protocol 2. |
| `hubVersion` | string | Free-form version of the hub software, for diagnostics only. Clients must not branch on it; they use `features`. Added in protocol 2. |

### 6.2 User record

`{id, name, color, account, presence, status}`: `account` is `{provider, label}` or null, `presence` is the last presence `p` (section 8) or null before the member sent one, `status` is a string, empty when none.

## 7. Activity

An activity record says what a member did. The hub keeps the last 200 in memory, sends the last 60 in `welcome.activity`, and sends each new one as `activity {a}` to every member. Records are not kept across a hub restart.

`a` is `{ts, who, color, kind, path?, text?, addr?}`:

| Field | Meaning |
|---|---|
| `ts` | Hub time in ms since the Unix epoch. |
| `who` | The member's name. |
| `color` | The member's color. |
| `kind` | One of the kinds below. |
| `path` | The file, for `edit`, `edit_disk`, `create`, `delete`. |
| `text` | The debug target for `debug_start` (a project path or a debug session name), the new status for `status_set`. |
| `addr` | The member's remote IP address as the hub sees it (for example `192.168.1.20` or `::ffff:192.168.1.20`), for `join`. |

A field not listed for a kind is absent. The hub never sends a sentence; the client renders one per kind (section 15).

| `kind` | Emitted when |
|---|---|
| `join` | A hello is accepted. |
| `leave` | A member's connection closes. |
| `edit` | A member's op is applied with `src` other than `disk`. Throttled, see below. |
| `edit_disk` | A member's op with `src: "disk"` is applied, a `create` onto an existing text file changes it, or a `put` is stored. Throttled. |
| `create` | A `create` stores a path that did not exist. |
| `delete` | A `delete` removes a file. |
| `debug_start` | A presence sets `debug` to a new non-empty value. |
| `debug_stop` | A presence clears `debug`. |
| `status_set` | A `status` with non-empty text. |
| `status_clear` | A `status` with empty text. |

Throttle: an `edit` or `edit_disk` record is emitted only when the same connection has not edited the same path during the previous 2 minutes. Every edit restarts that 2-minute window.

## 8. Presence and RTT

`presence {p}` from a member sets its presence and the hub relays `presence {id, p}` to every other member. The hub normalizes `p` before storing and relaying it:

| Field | Normalized to | Meaning |
|---|---|---|
| `file` | string or null | Project path of the active editor, null when none. |
| `sel` | array, at most 20 items | Selections as `[anchor, active]` offsets in UTF-16 units into the shared text (a BOM counts). |
| `line` | number, 0 when invalid | 1-based line of the main caret. |
| `debug` | string or null | Debug target when a debug session runs (activity `debug_start` / `debug_stop` on change). |
| `rtt` | non-negative integer, or absent | The member's last measured round trip to the hub in ms. The hub rounds it, and drops it when it is not a finite non-negative number. |

RTT: a client measures the time from sending `ping` to receiving the next `pong` and puts the last value in `p.rtt` of every presence it sends. It also re-sends its presence every **5 seconds** while connected once it has a measurement, so other members and the LAN Hub Members screen see a current value. `lib/client-core.js` does both since P0-2. `pong.ts` lets a client relate the hub's clock to its own; RTT itself is measured on the client's clock.

Because of the 5-second repeat, a client must not treat a presence whose `file`, `sel`, `line` and `debug` are unchanged as movement (for example, it must not scroll a follower's editor). `lib/client-core.js` emits its `presence` event only when one of those changed.

## 9. Features

`welcome.features` lists optional abilities. A client checks a feature before using it and degrades when it is missing. A hub lists only what works right now.

| Feature | Meaning | Node hub | lanhub |
|---|---|---|---|
| `chat-image` | `chat.image` and `media` work. | yes | from A3 |
| `discovery` | The hub answers UDP discovery (section 10). Absent when discovery is off or its port could not be bound. | when bound | from A3 |
| `history` | The history messages of section 12 work. | no | from A5 |
| `tls` | This connection is TLS (section 13.1). | no | from A6, on a TLS connection |
| `http-diag` | The TCP port answers `GET ` with a diagnosis page (section 13.2). | no | from A6 |
| `admin` | The port also serves the admin channel of section 13.3 (it may still be turned off). | no | from A10 |
| `multi-project` | The hub serves several projects on this port, chosen by `hello.project`, each with its own token, allow list and `hubId`, and adds, changes or removes projects (from `lanhub.toml`) without restarting the others. `project_unknown` and `probe_result.projects` list only advertised projects. | no | from A4 |

## 10. LAN discovery

A client that cannot reach any known address looks for the hub on the LAN over UDP.

- The hub listens on UDP port **8201** on `0.0.0.0` (every interface, whatever address the TCP side binds, because broadcasts reach only a socket bound to every interface). `--discovery-port <n>` changes the port and `--no-discovery` turns discovery off. A failed bind logs one warning that names the port, the TCP hub keeps running, and `discovery` stays out of `features`.
- Request, client to hub: the datagram `{"t":"lanhub_discover","v":2}` sent to the broadcast address of each IPv4 interface (and, optionally, unicast to known addresses). The hub ignores datagrams over 512 bytes, datagrams that are not JSON, and any `t` other than `lanhub_discover`.
- Reply `lanhub_here`, hub to the request's source address and port:

  `{"t":"lanhub_here","v":2,"instanceId":<string>,"hubName":<string>,"port":<integer>,"tls":<boolean>,"projects":<string array>}`

  `port` is the hub's TCP port. `tls` says whether that port expects TLS. `projects` lists only projects with advertising on (`advertise = true` in `lanhub.toml`); lanhub omits the field when none is advertised. The Node hub always lists its one project. A reply never carries a token.
- The client keeps the reply whose `instanceId` equals the one it stored (from `welcome` or the invite) and connects to the reply's source address on `port`.
- A hub sends at most 20 replies per second to one source address, so the responder cannot be used to flood a third party with spoofed requests.
- The firewall must allow inbound UDP on the discovery port. The LAN Hub app adds the rule (A9).

## 11. Invite codes

An invite code carries everything needed to join. It contains the token, so it is shared only inside the team.

### 11.1 Version 3 (`LC3-`)

`LC3-` followed by the base64url (RFC 4648 section 5, no padding) of the UTF-8 JSON object:

| Key | Type | Meaning |
|---|---|---|
| `v` | integer | 3. |
| `i` | string | The hub's `instanceId`. |
| `a` | non-empty string array | Addresses to try, in order: configured public addresses first (lanhub `public_address`, section 5.9 of the plan), then every non-internal IPv4 address of the hub machine. A client tries them in parallel. |
| `p` | integer 1-65535 | TCP port. |
| `n` | non-empty string | Project name. |
| `t` | string | Token, `""` for a project without one. |
| `f` | string, optional | TLS certificate fingerprint: the SHA-256 of the DER certificate as 64 lowercase hex characters, no separators. Present only when the hub uses TLS. The client pins it. |

Decoding (`decodeInviteV3` in `lib/common.js`, normative) removes all whitespace first (codes pasted from chat wrap), then rejects any code that does not match `^LC3-[A-Za-z0-9_-]+$`, is not JSON, or breaks one of the type rules above. It returns `{instanceId, hosts, port, project, token, fingerprint?}`. `encodeInviteV3` takes the same object.

Example: `{"v":3,"i":"0b6f2c7e-6f0e-4c3a-9a51-2f1d8e7c4b10","a":["192.168.1.10","10.0.0.5"],"p":8200,"n":"MyProject","t":"5f0c9e"}` encodes to `LC3-eyJ2IjozLCJpIjoiMGI2ZjJjN2UtNmYwZS00YzNhLTlhNTEtMmYxZDhlN2M0YjEwIiwiYSI6WyIxOTIuMTY4LjEuMTAiLCIxMC4wLjAuNSJdLCJwIjo4MjAwLCJuIjoiTXlQcm9qZWN0IiwidCI6IjVmMGM5ZSJ9`. Keys are written in the order above, but a decoder must not depend on key order.

The Node hub prints one line `Mã mời: LC3-...` at start with every non-internal IPv4 address in `a`.

### 11.2 Versions 1 and 2 (`LC-`, legacy)

`LC-` codes hold one address. `decodeInvite` in `lib/common.js` reads both: version 1 is the binary form (byte 1, four IPv4 bytes, big-endian port, token length, token bytes as hex, project as UTF-8) and version 2 is byte 2 followed by JSON `{h, p, n, t}`. The Node hub still prints one `Mã mời (<ip>): LC-...` line per address so 0.1.1 extensions can join. I1 removes both forms.

## 12. History

Edit-run history (plan README section 5.6). These messages work only when `welcome.features` lists `history`. A hub that does not list it ignores them as unknown messages, and a client must not send them to such a hub. lanhub lists `history` from A5 for every project whose history store opened. It leaves it out, and logs one warning naming the folder, when the store cannot be opened (for example SQLite cannot use WAL on a network drive), and when history is turned off (`[project.history] enabled = false` or `--no-history`). The Node hub never lists it.

| `t` | Direction | Purpose |
|---|---|---|
| `history_list` | client to hub | List edit runs, of one file or of the project. Answered by `history_runs`. |
| `history_runs` | hub to client | A page of run records. |
| `history_blob` | client to hub, hub reply (same `t`) | Fetch the content stored for a run boundary, by its SHA-256. |
| `history_changed` | hub to client | The runs of a file changed: a run started or ended, or retention removed some. |
| `checkpoint_create` | client to hub | Create a named restore point. Every member then receives `checkpoint_list`. |
| `checkpoint_list` | client to hub, hub reply (same `t`) | List restore points. |

### 12.1 Edit runs

- A **run** is the consecutive ops of one author on one file. The author is the member's `hello.uid`, so a reconnect of the same client session continues its run and a new session (a VS Code window reload) starts a new one.
- The hub ends the open run of a file when another author's op is applied to it, when its author has not edited it for `idle_minutes` (default 15; a gap of exactly `idle_minutes` ends it), when any member creates a checkpoint, when the file is deleted, renamed (a case-only rename retires the old name, section 5.2) or replaced by a blob, and when the hub stops. An op whose `src`, or whose `reverts`, differs from the open run's also starts a new run, so every run has one source.
- Times are the hub's clock in milliseconds since the Unix epoch. A run that ended because another author edited or because of the idle gap has `ended_at` at its own last op. A run ended by a checkpoint, a delete, a rename, a replacement or a hub stop has `ended_at` at that event. A hub killed without a stop ends the runs it left open when it starts again: `ended_at` keeps the last op it had recorded and `end_blob` is the file as the restarted hub loaded it from disk.
- `source` is the op's `src` (`editor`, `disk`, `revert`, `merge`; unknown or absent is `editor`), or `delete` for a deletion run.
- A **deletion** is a run of its own by the member who deleted the file: `source` `delete`, `op_count` 1, `start_blob` and `end_blob` both the content the file had (so it can be restored), `chars_removed` its length for a text file.
- A **blob file** gets one closed run for every `create` or `put` that stores it: `kind` `blob`, `source` `disk`, `op_count` 1, `start_blob` the bytes the file held before (`null` when it did not exist), `end_blob` the new bytes, character counts 0. Deleting a blob file records a deletion run with `kind` `blob`.
- Text runs record the file's text at their start and end, encoded as UTF-8. The ops themselves are not stored.
- lanhub keeps the index in `<history>/history.db` (SQLite, WAL) and contents in `<history>/blobs/<first 2 hex>/<sha256>.zst` (zstd), where `<history>` is `--history` or `<root>/.lan-collab/history`. Files the Node hub wrote in that folder (snapshots, `chat.jsonl`, `chat-media/`) stay as they are.

### 12.2 Run record

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Decimal digits. Unique within the project's history and never reused; a larger id is a later run. |
| `path` | string | The file. A deleted file keeps its runs under its path. |
| `author_uid` | string | The author's `hello.uid`. |
| `author_name` | string | The author's display name when the run started. |
| `color` | string | The author's member color when the run started. |
| `source` | string | `editor`, `disk`, `revert`, `merge` or `delete` (12.1). |
| `kind` | string | `text` or `blob`. |
| `started_at` | integer | First op, in ms. |
| `ended_at` | integer | End of the run (12.1). For an open run, the time of its latest op so far. |
| `op_count` | integer | Ops applied in the run. |
| `chars_added` | integer | UTF-16 code units inserted, counted on the ops as the hub applied them (after transform). |
| `chars_removed` | integer | UTF-16 code units deleted, same counting. |
| `start_blob` | string or null | SHA-256 (64 lowercase hex) of the content before the run. `null` only for a blob run that created the file. |
| `end_blob` | string or null | SHA-256 of the content after the run. `null` while the run is open. |
| `reverts` | string or null | The `op.reverts` of a `revert` run: the id of the run it undoes. |
| `open` | boolean | The run has not ended yet (it is the file's current run). |

### 12.3 history_list and history_runs

`{"t":"history_list","path"?:<string>,"before"?:<string>,"limit"?:<integer>}`

- `path` selects one file; without it (or `null`) the runs of every file are listed. An unsafe path (section 2) is ignored with no reply.
- Runs come newest first (descending `id`). `before` is a run id; only runs with a smaller id are listed. A `before` that is not a string of decimal digits is ignored with no reply.
- `limit` defaults to 50 and is clamped to 1-200.

Reply to the sender only: `{"t":"history_runs","path":<string or null>,"before":<string or null>,"runs":[<run record>...],"more":<boolean>}`. `path` and `before` echo the request, so a client can match replies to requests. `more` is true when older runs exist; the next page is asked with `before` set to the `id` of the last run received.

A request sent after an op or a `history_changed` sees that op's effect: the hub answers history requests in order with the run changes before them.

### 12.4 history_blob

`{"t":"history_blob","blob":<sha256>}` asks for the content stored under `blob`, a `start_blob` or `end_blob` of some run.

Reply to the sender only, one of:

- `{"t":"history_blob","blob":<sha256>,"kind":"text","text":<string>}` when the bytes are UTF-8 with no NUL byte. The UTF-8 encoding of `text` is exactly the stored bytes.
- `{"t":"history_blob","blob":<sha256>,"kind":"blob","b64":<base64>}` otherwise.
- `{"t":"history_blob","blob":<as sent>,"missing":true}` when no content is stored under that hash (never stored, removed by retention, or not a 64-character lowercase hex string).

A `blob` that is not a string is ignored with no reply. The `kind` of the reply describes the bytes, not the file: a blob file whose bytes happen to be UTF-8 comes back as `text`, and its UTF-8 encoding gives the bytes back.

### 12.5 history_changed

`{"t":"history_changed","path":<string>}` goes to every member, the cause included, when a run of `path` starts or ends (an author switch does both), a blob run or a deletion run is recorded, or retention removes runs of `path`. The hub sends at most one per path per second: a change within a second of the previous message for that path is announced once, when that second is over (several members typing in one file make almost every op a boundary). It carries no records: a client showing that file's history asks `history_list` again. No message is sent for the counters of an open run growing.

### 12.6 checkpoint_create and checkpoint_list

`{"t":"checkpoint_create","name":<string>}` creates a restore point. The hub trims `name` and truncates it to 100 characters; an empty or missing name is ignored with no reply. The hub first ends every open run of the project, at the checkpoint time (each gets a `history_changed`), then stores the checkpoint and sends `checkpoint_list` with every checkpoint to every member, the creator included.

`{"t":"checkpoint_list"}` gets the same reply to the sender only:

`{"t":"checkpoint_list","checkpoints":[{"id":<string>,"name":<string>,"created_at":<integer>,"author_uid":<string>,"author_name":<string>,"color":<string>,"last_run":<string or null>}...]}`, oldest first. `last_run` is the newest run id when the checkpoint was made (`null` when there was no run), so the state of a file at the checkpoint is the `end_blob` of its newest run with an id up to `last_run`, and the runs after it are those with a larger id.

### 12.7 Retention

lanhub prunes each project's history when the project starts, every hour, when `keep_days` or `max_mb` changes in `lanhub.toml`, and between the hourly passes once the history is over `max_mb` and a tenth of `max_mb` has been written since the last pass. It removes closed runs that ended more than `keep_days` (default 30) days ago, then the oldest closed runs until `history.db` plus the blobs the remaining runs reference fit in `max_mb` (default 2048) MiB, then every blob no run references. The newest run of each path (so a deleted file stays restorable) and every open run are never removed. A pass right after another removes nothing. Checkpoints are kept; a `last_run` may name a removed run. Removing runs of a path sends `history_changed` for it.

### 12.8 Using runs (informative)

- **View a run.** Fetch `end_blob` (the file after the run) and `start_blob` (before it) and show them side by side read-only, or diff either against the current text. Copying from them needs nothing from the hub.
- **Undo a run** (B7) is a three-way merge like `git revert`: base is the run's `end_blob`, "theirs" its `start_blob`, "ours" the client's current text. The result is applied as a normal edit whose ops carry `src: "revert"` and `reverts: <run id>`, so it syncs to everyone and is recorded as a new `revert` run. History is never rewritten, so OT convergence is unaffected. A blob run is undone by a `put` of its `start_blob`.
- **Restore a deleted file.** The deletion run's `end_blob` holds the deleted content; the client creates the file from it (`create`).

## 13. lanhub-only transport features

### 13.1 TLS (A6)

With `[hub.tls] enabled = true` the TCP port expects a TLS handshake. A connection whose first byte is not a TLS handshake record (0x16) gets the single plain-text line `{"t":"error","code":"tls_required","data":{}}` and is closed, unless it opens with an HTTP request line, which gets the page of section 13.2 so a browser pointed at `http://` still learns the hub runs. On a TLS connection the protocol is unchanged and `welcome.features` includes `tls`. The certificate fingerprint travels in invite v3 field `f` and the client pins it; a mismatch stops the connection and is never skipped automatically.

The fingerprint is the SHA-256 of the DER leaf certificate as 64 lowercase hex characters, the value `lib/diagnostics.js` computes from `getPeerCertificate().raw`. lanhub uses the PEM certificate and key that `[hub.tls] cert` and `key` name, or else generates a self-signed ECDSA P-256 certificate once (`rcgen`, names `lanhub` and `localhost`) into `.lan-collab/tls-selfsigned.pem` next to `lanhub.toml` (single-project mode: `<root>/.lan-collab/`; `.lan-collab` is never synced) and reuses it, so the fingerprint stays the same across restarts. The certificate names never follow `public_address`, because clients pin the fingerprint and skip host-name checks. The hub logs `TLS fingerprint SHA256 <hex>` at start. TLS 1.2 and 1.3 are offered (rustls with the ring provider).

### 13.2 HTTP diagnosis page (A6)

When a connection starts with the bytes `GET `, lanhub answers with an HTTP/1.1 response holding an HTML page that says the hub runs, its version, and its advertised projects, then closes. A user opens `http://<ip>:8200/` in a browser to tell a network fault from an extension fault. The feature is listed as `http-diag`.

Details: the page also shows the hub name, uptime, and whether TLS is on with its fingerprint; it never holds a token, a folder, an instance id or a member. Every path gets the same page and no file is read. `HEAD ` gets the headers only; any other method (`POST `, `PUT `, `DELETE `, `OPTIONS `, `PATCH `, `CONNECT `, `TRACE `) gets `405`. The hub reads at most 8 KiB of the request head before it answers and closes. On a TLS hub the page answers inside TLS (`https://`) and on a plain connection alike (section 13.1).

### 13.3 Admin channel (A10)

lanhub serves a second kind of session on the same port: an admin session that manages the hub the way the LAN Hub app manages the hub in its own process. A connection whose first message is `admin_hello` asks for one; this is the one exception to the first-message rule of section 1. It is a lanhub-only feature listed as `admin`, and only `lanhub-cli` answers it; the LAN Hub app's own hub refuses every `admin_hello` with `disabled`. The TypeScript form of these messages is `packages/protocol/src/generated/AdminMessage.ts`.

**Turning it on.** `[hub.admin]` in `lanhub.toml`, or `lanhub-cli --admin-token` (section 16):

```toml
[hub.admin]
remote = true
token = "a long random secret"     # at least 16 characters
# or, so the file never holds the token itself:
# token_sha256 = "<64 hex characters, the SHA-256 of the UTF-8 token>"
```

`remote = true` needs exactly one of `token` and `token_sha256`. The hub keeps only the SHA-256 of the token in memory, never logs the token, and compares hashes in constant time. A change of `[hub.admin]` at apply takes effect for the next `admin_hello`, and an open admin session whose token no longer matches is closed before its next call.

**Opening.** The hub checks an `admin_hello` in this order and answers the first failure with `admin_refused`, then closes the connection.

1. The channel is on: otherwise `disabled`.
2. The connection is TLS (section 13.1), or comes from a loopback address: otherwise `tls_required`. A hub without TLS therefore takes admin sessions from the same machine only.
3. The address is not blocked: otherwise `rate_limited` with `retryAfterMs`, answered at once and without looking at the token.
4. The token matches: otherwise `token_invalid`, sent 1 second after the `admin_hello` arrived. Five wrong tokens from one IP address within 60 seconds block that address for 5 minutes. The block, the check and the count happen under one lock, so parallel connections cannot try more tokens than that. A correct token clears the address's count.

The hub logs every refusal with the address, and the block with its length.

| Message | Direction | Fields |
|---|---|---|
| `admin_hello` | client to hub, first line | `token` string |
| `admin_welcome` | hub to client | `hubName`, `hubVersion`, `instanceId` strings, `configPath` string or `null` (the `lanhub.toml` that edits write; `null` when the hub runs from command-line flags and refuses edits) |
| `admin_refused` | hub to client, then close | `code`: `disabled`, `tls_required`, `token_invalid` or `rate_limited`; `retryAfterMs` integer with `rate_limited` |
| `admin_call` | client to hub | `id` integer chosen by the client, `method` string, `params` object (`{}` when the method takes none) |
| `admin_result` | hub to client | `id` of the call, `ok` boolean, `value` (the result, `null` when there is none), `error` `{code, field, params}` when `ok` is false |

**Calls.** Calls may overlap; each result carries the id of its call and results may arrive in any order. Lines of an admin session may be up to 1 MiB. A line that is not a valid `admin_call` is ignored; an unknown method or malformed `params` gets an `admin_result` with error `badRequest`.

| `method` | `params` | `value` |
|---|---|---|
| `list_projects` | `{}` | array of project status objects (`name`, `root`, `state` of `running`, `disabled` or `failed`, `error`, `hubId`, `files`, `clients`, `ops`, `lastActivity`, `advertise`, `token`, `startedAt`), in config order |
| `project_status` | `{name}` | one status object, or `null` for an unknown project (names ignore case) |
| `clients` | `{name}` | array of `{id, name, account, addr, joinedAt, rtt}` |
| `logs` | `{after, limit}` | up to `limit` (at most 2000) log records `{seq, ts, level, project, msg}` with `seq > after`, oldest first |
| `rotate_token` | `{name}` | the new token, written to `lanhub.toml` and in force for the next join; members already in stay. From flags, it lasts until the hub restarts. |
| `apply_config` | `{config}` | `{events}`: makes the running hub match `config` without writing the file. The hub keeps its own `[hub.admin]` and state folder. |
| `add_project` | `{input: {name, root, enabled, advertise}}` | `null`; the hub writes a new `[[project]]` with a random token |
| `update_project` | `{original, input}` | `null`; the token and keys the input does not name stay as written |
| `set_project_enabled` | `{name, enabled}` | `null` |
| `remove_project` | `{name}` | `null` |
| `hub_settings` | `{}` | `{name, hostname, bind, port, discovery, discoveryPort, tls, tlsCert, tlsKey, publicAddress, fingerprint}` |
| `update_hub` | `{input}` | the new `hub_settings` value; `input` has the fields of that value without `hostname` and `fingerprint` |
| `all_invite_codes` | `{}` | `[{name, code}]` for the running projects |
| `invite_code` | `{name}` | the `LC3-` code of one project (section 11.1); the addresses are the hub's `public_address` values, then its own IPv4 addresses |
| `invite_codes` | `{name}` | `{code, hosts, port, tls, legacy}`: `code` is the `invite_code` value or `null` when the hub knows no address, `hosts` the addresses inside it in order, `legacy` one `{host, code}` `LC-` code per IPv4 address for 0.1 clients (empty with TLS on) |
| `project_settings` | `{name}` | `{token, allow, allowFile, exclude, defaultExclude, historyEnabled, history: {idleMinutes, keepDays, maxMb}}` as the hub runs the project |
| `set_allow` | `{name, lines}` | `null`; one allow entry per line, blank lines dropped, an empty list removes `allow`. A bad line fails with `allowInvalid {line}`, field `allow` |
| `set_exclude` | `{name, lines}` | `null`; the extra exclude patterns, as `set_allow`; `excludeInvalid {line}`, field `exclude` |
| `preview_exclude` | `{name, lines}` | `{files, total, scanned}`: the files under the project folder on the hub's machine that `lines` would stop syncing (the first 200 of `total`, sorted), among the `scanned` files the default patterns leave in |
| `set_history` | `{name, history: {idleMinutes, keepDays, maxMb}}` | `null`; writes the limits into `[project.history]`, keeping `enabled` and other keys. Out of range fails with `outOfRange {min, max}`, field `idleMinutes`, `keepDays` or `maxMb` |
| `history_usage` | `{name}` | `{dbBytes, blobBytes, blobCount, runs}`, or `null` when the project runs without history; `notRunning {name}` when it is not running |
| `run_retention` | `{name}` | `{runsDeleted, blobsDeleted, bytesBefore, bytesAfter}`; `historyOff` when the project runs without history, `retentionFailed {detail}` when the pass failed |
| `import_legacy` | `{dir}` | array of `{name, token, allow, root, exists}`: the projects of a 0.1 hub folder `dir` on the hub's machine (`token-<name>.txt`, `allowed-accounts-<name>.txt`, `ROOT` of its `.bat` launchers); `exists` when a project of that name is configured. `legacyUnreadable {path}` when the folder cannot be read |
| `import_projects` | `{items: [{name, root, token, allow}]}` | array of the names added, in one write; a name that exists is skipped. A bad item fails with the project form's error and param `project` |

Edits re-read `lanhub.toml`, change only the table they are about (comments and unknown keys stay), validate the result with the hub's own parser and the checks the app runs (a root that must exist on the hub's machine, a port it can open, a certificate it can load), write it atomically, then apply it. A hub started from command-line flags refuses them with `configReadOnly`. Error codes are the keys of `errors` in `lanhub/app/ui/src/i18n/vi.json`, for example `unknownProject {name}`, `rootMissing` with field `root`, `nameDuplicate {name}` with field `name`, `portBusy {port}`, `configInvalid`.

Example:

```
→ {"t":"admin_hello","token":"…"}
← {"t":"admin_welcome","hubName":"srv","hubVersion":"lanhub 0.2.0","instanceId":"…","configPath":"/etc/lanhub/lanhub.toml"}
→ {"t":"admin_call","id":1,"method":"project_status","params":{"name":"web"}}
← {"t":"admin_result","id":1,"ok":true,"value":{"name":"web","state":"running",…}}
→ {"t":"admin_call","id":2,"method":"clients","params":{"name":"nope"}}
← {"t":"admin_result","id":2,"ok":false,"value":null,"error":{"code":"unknownProject","field":null,"params":{"name":"nope"}}}
```

## 14. Protocol 1 compatibility

### 14.1 Node hub (until I1)

The Node hub records the version per connection and answers a protocol 1 hello (section 3.2) exactly as hub 0.1.1 did, byte for byte, so installed 0.1.1 extensions keep working in a room shared with protocol 2 members:

- Checks in the 0.1 order: proto, token, project, account. A refusal is `{"t":"error","message":<Vietnamese sentence>,"code":<"" or "account">}`, for example `{"t":"error","message":"Sai lanCollab.token.","code":""}`.
- A successful probe gets `probe-ok`, the line `{"t":"probe-ok"}`; a refused probe gets the same `error` as a join.
- `welcome` has exactly the 0.1 fields (no `proto`, `instanceId`, `hubName`, `hubVersion`), `features` is `["chat-image"]`, and `activity` holds 0.1 records.
- Activity records are `{ts, who, color, text}` with the 0.1 sentence in `text` (the same sentences as section 15).
- `pong` is `{"t":"pong"}`, without `ts`.
- `chat_rejected` is `{reason}` with the 0.1 sentence.
- Presence relayed to a protocol 1 member never has `rtt`, and a protocol 2 member's presence that changed only `rtt` is not relayed to it.

### 14.2 lanhub

lanhub accepts only protocol 2. A hello with `proto` 1 gets one exception to the no-display-text rule, because a 0.1 client reads only `message`:

`{"t":"error","code":"protocol_version","data":{"hubMin":2,"hubMax":2},"message":"Phiên bản giao thức khác hub (máy: 1, hub: 2). Cập nhật extension LAN Collab lên 0.2."}`

### 14.3 New client, old hub

A protocol 2 client that reaches hub 0.1.1 gets that hub's 0.1 refusal (`message` set, `code` empty). A client shows `message` when it is present and renders from `code` otherwise.

## 15. Client rendering

Display text lives on the client. Until B1 moves the strings to `extension/i18n/vi.json`, `renderHubMessage(code, data)` in `lib/client-core.js` is the one table, and it reproduces the 0.1.1 sentences so users see the same words. For errors `data` is the hub's `data` plus the client's own `project` and `proto`; for activity `data` is the record, and the extension shows `<who> <text>`.

| Code or kind | Sentence |
|---|---|
| `protocol_version` | `Phiên bản giao thức khác hub (máy: <proto>, hub: <hubMax, or hubMin-hubMax>) — cập nhật extension.` |
| `token_invalid` | `Sai lanCollab.token.` |
| `project_unknown` | `Hub này phục vụ dự án "<p1>", "<p2>", máy đang mở "<project>".`, or `Hub này không phục vụ dự án "<project>".` when `projects` is empty |
| `account_required` | `Hub chỉ cho các tài khoản trong danh sách vào. Đăng nhập GitHub hoặc Microsoft trong VS Code (biểu tượng tài khoản ở góc dưới bên trái), rồi chạy lệnh "LAN Collab: Dùng tài khoản VS Code".` |
| `account_denied` | `Tài khoản <account> chưa được phép vào. Nhờ người quản lý hub thêm dòng "<entry>" vào <file, or danh sách tài khoản được phép của dự án>.` |
| `tls_required` | `Hub yêu cầu kết nối mã hoá (TLS).` |
| `image_invalid` | `Ảnh không hợp lệ hoặc lớn hơn <maxBytes in MB> MB.` |
| `join` | `vào phòng (<addr>)` |
| `leave` | `rời phòng` |
| `edit` | `đang sửa <path>` |
| `edit_disk` | `đang sửa <path> (AI/công cụ ngoài editor)` |
| `create` | `tạo <path>` |
| `delete` | `xoá <path>` |
| `debug_start` | `bắt đầu debug <text>` |
| `debug_stop` | `dừng debug` |
| `status_set` | `đặt trạng thái: <text>` |
| `status_clear` | `xoá trạng thái` |
| anything else | the code itself |

`lib/client-core.js` keeps the structured record and adds the sentence as `text` in `client.activity` and in its `activity` event. Its `fatal` event carries `(sentence, code)` with the protocol 2 code.

## 16. CLI contract for tests

Not part of the wire protocol. Both hubs implement it so `test/conformance/` and `tools/loadgen.mjs` can drive either one through `LANHUB_CMD`.

| Flag | Meaning |
|---|---|
| `--root <dir>` | Project folder (single-project mode). Required. |
| `--port <n>` | TCP port, default 8200. `0` picks a free port. |
| `--host <addr>` | TCP bind address, default `0.0.0.0`. |
| `--project <name>` | Project name, default the folder's base name. |
| `--token <secret>` | Project token. The Node hub also reads `LAN_COLLAB_TOKEN`. |
| `--allow-file <file>` | Account allow list (3.3). |
| `--history <dir>` | History folder, default `<root>/.lan-collab/history`. |
| `--no-history` | lanhub only: no edit-run history (`history` stays out of `features`). In `--config` mode it applies to every project. |
| `--history-idle-ms <n>` | lanhub only, for tests: a run ends after `n` ms without an edit by its author instead of `idle_minutes`. In `--config` mode it applies to every project. |
| `--exclude "a,b"` | Extra exclude patterns, comma-separated. |
| `--name <name>` | Hub display name (`hubName`). |
| `--log-format json` | With it, the hub prints `{"event":"listening","port":N}` as one stdout line once the TCP port and, when enabled, the discovery port are bound. Other stdout lines are human logs and never start with `{"event"`. |
| `--stop-on-stdin-close` | When stdin closes, the hub writes every pending file and exits with code 0. On Windows a SIGINT sent from Node is a forced kill, so this is the graceful stop for tests. |
| `--discovery-port <n>` | UDP discovery port, default 8201. |
| `--no-discovery` | No UDP socket at all. `test/support/hub-process.js` passes it unless a test sets `discoveryPort`, so parallel test files never compete for UDP 8201. |
| `--tls` | lanhub only (A6), single-project mode: TLS with the self-signed certificate of section 13.1, kept in `<root>/.lan-collab/`. The hub logs `TLS fingerprint SHA256 <hex>` before the listening line. `test/conformance/tls.test.js` and the `tls_required` case run only when `LANHUB_TLS=1`. |
| `--tls-cert <file>`, `--tls-key <file>` | lanhub only (A6), single-project mode, always together: TLS with this PEM certificate chain and private key. |
| `--diagnose` | lanhub only (A6): read-only self-check, one line per check (`ok`, `fail` or `skip`, the check name, details, and a fix hint on `fail`) for the config, the TCP port, the discovery port, the IPv4 interfaces, TLS, and on Windows the inbound firewall rules for both ports (`netsh advfirewall firewall show rule name=all dir=in verbose`, never changed). Takes `--config` or `--root` and the port, host, discovery and TLS flags. Exits 0 when no check fails, else 1. |
| `--admin-token <secret>` | lanhub only (feature `admin`): turns the admin channel of section 13.3 on with this token (at least 16 characters), in either mode, over `[hub.admin]`. The environment variable `LANHUB_ADMIN_TOKEN` does the same without putting the token on the command line. From flags, admin sessions read and rotate but refuse edits. |
| `--hash-admin-token <secret>` | lanhub only: prints the `token_sha256 = "…"` line for `[hub.admin]` and exits. |
| `--config <file>` | lanhub only (feature `multi-project`), instead of `--root`: serve the projects of a `lanhub.toml` and apply the file again whenever it changes. `--port`, `--host`, `--name`, `--discovery-port` and `--no-discovery` override its `[hub]` values. A file that does not parse at start exits with code 1; later, it is logged and the running projects stay. |

A flag given without a value (followed by another `--flag` or nothing) is `true`.
