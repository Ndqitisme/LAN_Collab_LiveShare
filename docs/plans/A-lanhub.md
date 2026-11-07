# A LAN Hub plan

Track A replaces the Node.js hub with LAN Hub, written in Rust. It ships two binaries from one Cargo workspace, the headless `lanhub-cli` and a Tauri 2 desktop app that embeds the same core. One hub serves many projects on one TCP port, keeps a per-user edit-run history, and runs on the LAN by default with optional TLS for an external host. The rule this track enforces is that the Rust hub passes the same black-box conformance suite as the Node hub before any GUI work starts. Decisions live in `docs/plans/README.md` sections 5.1, 5.2, 5.4, 5.5, 5.6, 5.9, and 5.10. PR ids in order are A1, A2, A3, A4, A5, A6, A7, A8, A9, A10.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator merges every PR into `upgrade/hub`. Agents build, verify, and stop at merge-ready. A1 through A10 are all operator items that stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Confirm that `upgrade/hub` exists and points at the `main` SHA that holds P0-4. Record the SHA in the decision trail.
- [ ] Read these from the pinned pstack clone at program start. Re-read them at every tick. The clone is `cursor/plugins` at `C:\Users\BDT-QUY\src\cursor-plugins`, checked out at `6b03002` and never fetched, so `origin/main` stays at `6b03002`. Each read is `git show origin/main:<path>` run inside the clone, written below with `git -C`.
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-make-operations-idempotent/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-prove-it-works/SKILL.md`
  - [ ] Read `tools/cdp/README.md` from `upgrade/hub`. It replaces the `control-ui` skill for this repo.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `claude-opus-5-5`. The A2, A4, A5, and A6 owners run at effort `high` because they touch the wire protocol, concurrency, storage, or authentication. The others run at effort `medium`.
- [ ] Follow this dependency graph. Base each PR on its parent's branch until the parent merges into `upgrade/hub`, then rebase onto `upgrade/hub`.
  - [ ] A1 is first. It branches from `upgrade/hub`.
  - [ ] A2 after A1.
  - [ ] A3 after A2.
  - [ ] A4 after A3.
  - [ ] A5 and A6 after A4. They are independent of each other.
  - [ ] A7 after A4. It runs in parallel with A5 and A6.
  - [ ] A8 after A7 and A5.
  - [ ] A9 after A7 and A6.
  - [ ] A10 after A9.
- [ ] Hold the file boundaries. Track A touches only `lanhub/**`, `packages/protocol/**`, `docs/protocol.md`, `docs/lanhub-server.md`, `tools/gen-ot-vectors.mjs`, `tools/package-lanhub.mjs`, `tools/cdp/app.mjs`, `test/conformance/**`, and `.github/workflows/ci.yml`. Shared files (`test/support/**`, `tools/loadgen.mjs`, root `package.json` scripts) follow the additive rule in README section 3.
  - [ ] No track A PR edits `extension/**`, `lib/**`, or the root `package.json` manifest fields. Those belong to track B.
  - [ ] A change to `docs/protocol.md` adds messages only. It never changes a message that P0-2 defined, because track B builds against that text.
  - [ ] A change to `packages/ui-kit/**` needed by A7 or A8 lands in that PR and is listed in its merge-ready report, so I1 can reconcile it with track B.
- [ ] Hold the review gate. A7, A8, A9, and A10 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. `gh` is not installed on this machine and `origin` CLI is absent. The owner commits on a local branch named `a/<pr-id>` and the operator pushes and merges. Record this fallback in the decision trail.
- [ ] Open the PR ready, never draft, per **Opening a PR**, once the operator pushes the branch. The PR targets `upgrade/hub`. Until it is pushed, the merge-ready report carries the branch name, head SHA, and PR body.
- [ ] Run `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, `cargo test --workspace`, and `npm test` once before the merge-ready report. Commit with hooks on.
- [ ] Run a deslop pass before each commit and a no-comments pass before review. Both are manual reads of the diff against `pstack/skills/no-comments/SKILL.md` and the comment rules in `C:\Users\BDT-QUY\.claude\CLAUDE.md`.
- [ ] Triage reviewer comments per `../references/bugbot-triage.md` from the pstack clone. This repo has no Bugbot. A2, A4, A5, A6, and A10 each get one reviewer on `claude-opus-5-5` at effort `high` in a fresh context. The reviewer reports only merge-blocking defects, each with file and line, why it is wrong, and how to prove it fails.
- [ ] Rebase onto current `upgrade/hub` before the code-ready report. Rebase again only at merge prep or on a conflict.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. A full swarm here is one verifier agent on `claude-opus-5-5` that runs the gates lane, the ten live lanes from the PR's **Verify, live** block in order, the perf lane, and two audit lanes that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR.
- [ ] Stop at merge-ready with a clean verdict at the exact head SHA. The operator lands the PR. A rebase that keeps the patch-id unchanged keeps the verdict, per the patch-id rule in `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on this Windows 10 machine at the PR head, in its own scratch folder under the session scratchpad.

- [ ] Run `git worktree add <scratch>/a-<pr-id> <head SHA>`.
- [ ] Run `npm install` in the worktree, then `cargo build -p lanhub-cli --release` inside `lanhub/`. Wait for the build to finish without errors.
- [ ] Start the Rust hub with `lanhub/target/release/lanhub-cli --root <scratch>/root --port 0 --log-format json` (A2 and A3) or `lanhub-cli --config <scratch>/lanhub.toml --port 0 --log-format json` (A4 onward). Read the port from the `{"event":"listening","port":N}` line.
- [ ] Run the conformance suite against the Rust hub with `LANHUB_CMD="<worktree>/lanhub/target/release/lanhub-cli" npm run test:conformance`.
- [ ] Drive VS Code only through `tools/cdp/vscode.mjs`, with `--extensionDevelopmentPath` set to the same worktree. Its `lib/client-core.js` speaks proto 2 after P0-2.
- [ ] From A7 onward, build the app with `npm run tauri build -- --debug` inside `lanhub/app` and drive it only through `tools/cdp/app.mjs`.
- [ ] Read-only diagnostics are the hub's JSON log lines on stdout, files under `<root>/.lan-collab/`, `netstat -ano`, and `Get-Process`.
- [ ] Save every screenshot or log to `<scratch>/swarm-<pr-id>/worker-<n>/<slug>.<png or txt>` and return the paths with the report.

## Scaffold the Cargo workspace and port the OT library (A1)

**Depends on.** None.

**Files.**

- [ ] Create `lanhub/Cargo.toml` as a workspace with members `crates/lanhub-ot`, `crates/lanhub-protocol`, `crates/lanhub-core`, `crates/lanhub-cli`, and a placeholder `app/` excluded until A7.
- [ ] Create `lanhub/rust-toolchain.toml` pinning `stable-x86_64-pc-windows-msvc`. The machine default is the `gnu` toolchain, and Tauri 2 plus the release artifact names need MSVC.
- [ ] Create `lanhub/crates/lanhub-ot/src/lib.rs`, `src/operation.rs`, `src/diff.rs`, and `tests/vectors.rs`.
- [ ] Create empty library crates `lanhub-protocol`, `lanhub-core`, and a `lanhub-cli` binary that prints its version.
- [ ] Create `tools/gen-ot-vectors.mjs`.
- [ ] Create `lanhub/crates/lanhub-ot/tests/vectors/` holding the generated JSON files.
- [ ] Edit `.github/workflows/ci.yml` to add a `rust` job.

**Build.**

- [ ] `TextOperation` in `operation.rs` stores components as an enum of retain, delete, and insert with lengths in UTF-16 code units. It mirrors `lib/ot.js` for `from_json`, `to_json`, `apply`, `compose`, `transform`, `base_length`, and `target_length`.
- [ ] `transform(a, b)` puts the insert of `a` first when both insert at the same index, because the hub calls `transform(incoming, logOp)` and the incoming insert wins.
- [ ] `apply` works on `&[u16]` and returns `Vec<u16>`. It rejects an operation whose `base_length` differs from the text length.
- [ ] `diff(a, b)` in `diff.rs` strips the common prefix and suffix without splitting a surrogate pair or a CRLF, runs a character Myers diff when the middle is at most 8000 units with a cap of 1000 edits, otherwise a line Myers diff capped at 3000 with per-block character refinement, and falls back to delete-all and insert-all.
- [ ] `tools/gen-ot-vectors.mjs` runs `lib/ot.js` over 3000 seeds and writes JSON cases for `transform`, `compose`, `apply`, `diff`, and `fromJSON` rejections, including CRLF and surrogate-pair boundaries.
- [ ] `tests/vectors.rs` loads every case and asserts the Rust output serializes to the same JSON bytes as the JavaScript output.
- [ ] The CI `rust` job runs `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, and `cargo test --workspace` on `windows-latest` and `ubuntu-latest`.

**You see.**

- [ ] `node tools/gen-ot-vectors.mjs` writes five JSON files and prints the case count per file.
- [ ] `cargo test -p lanhub-ot` prints every vector file as passed with the same case counts.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/vectors.rs` covers all generated cases. Run `cargo test -p lanhub-ot`.
- [ ] A property test in `lanhub-ot` checks transform convergence, `apply(compose(a, b)) == apply(b, apply(a))`, and diff round-trip over random UTF-16 strings that include surrogate pairs. Run `cargo test -p lanhub-ot -- --include-ignored`.
- [ ] Flip the tie-break in a scratch edit and rerun. The vector test must fail. Restore the edit.
- [ ] `npm test` still passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no Rust code. Record that fact, then run `node test/ot.test.js` at trunk and head. Save `a1-regression.txt`. Pass when both print 15010 checks OK, which proves `lib/ot.js` did not change.
- [ ] Lane 2. Regenerate vectors at head and run `git diff --stat lanhub/crates/lanhub-ot/tests/vectors`. Save `a1-vectors-stable.txt`. Pass when the diff is empty, which proves generation is deterministic.
- [ ] Lane 3. Run the vector test on a 1 MiB text that contains CRLF line endings and emoji. Save `a1-large.txt`. Pass when Rust and JavaScript agree on `apply` output byte for byte.
- [ ] Lane 4. Run `diff` on two 20000-line files that differ in 50 places. Save `a1-linediff.txt`. Pass when the Rust op equals the JavaScript op.
- [ ] Lane 5. Feed `from_json` the rejected inputs from `lib/ot.js` (zero retain, float, nested array, non-array). Save `a1-reject.txt`. Pass when Rust rejects exactly the inputs JavaScript rejects.
- [ ] Lane 6. Build `lanhub-cli` in release mode and run `lanhub-cli --version`. Save `a1-version.txt`. Pass when it prints the workspace version and exits 0.
- [ ] Lane 7. Run `cargo clippy --workspace -- -D warnings`. Save `a1-clippy.txt`. Pass when it reports no warning.
- [ ] Lane 8. Run the CI workflow commands by hand in a clean worktree on Windows and on the Linux host. Save `a1-ci.txt`. Pass when every command exits 0 on each available platform.
- [ ] Lane 9. Run `cargo build --release` with a cold `target/` and record the time. Save `a1-build-time.txt`. Pass when the build completes and the time is recorded for the perf block.
- [ ] Lane 10. Run `npm run package` at head. Save `a1-vsix.txt`. Pass when the `.vsix` file list contains nothing under `lanhub/`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time for 100000 `transform` plus `apply` steps on a 100 KiB text in Rust and in `lib/ot.js`.
- [ ] Probe. Run `cargo bench -p lanhub-ot --bench transform` and `node tools/gen-ot-vectors.mjs --bench` five times each, interleaved.
- [ ] Baseline. Record the JavaScript median first. Trunk has no Rust, so the JavaScript run is the baseline.
- [ ] Rule. A Rust median slower than the JavaScript median fails.

**Review gate.** None. A1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Build the single-project Rust hub at protocol parity (A2)

**Depends on.** A1.

**Files.**

- [ ] Create `lanhub/crates/lanhub-protocol/src/lib.rs`, `src/messages.rs`, `src/errors.rs`, `src/activity.rs`.
- [ ] Create `packages/protocol/package.json` and `packages/protocol/src/generated/` (written by `ts-rs`, never by hand).
- [ ] Create `lanhub/crates/lanhub-core/src/lib.rs`, `src/framing.rs`, `src/session.rs`, `src/project.rs`, `src/files.rs`, `src/paths.rs`, `src/exclude.rs`, `src/flush.rs`, `src/presence.rs`.
- [ ] Edit `lanhub/crates/lanhub-cli/src/main.rs`.
- [ ] Edit `.github/workflows/ci.yml` to run the conformance suite against the Rust hub.

**Build.**

- [ ] `messages.rs` defines every v2 message from `docs/protocol.md` as a serde enum tagged by `t`. `errors.rs` defines the error code enum. `activity.rs` defines the activity kinds. `cargo test -p lanhub-protocol` exports TypeScript types to `packages/protocol/src/generated/` with `ts-rs`.
- [ ] `framing.rs` reads NDJSON lines with a 64 KiB limit before authentication and a limit equal to `MAX_LINE` after it, counted in UTF-16 units to match `lib/common.js`. An over-limit line closes the socket. A malformed line is skipped.
- [ ] `session.rs` runs one reader task and one writer task per connection on the tokio multi-thread runtime. The writer task owns a bounded channel, so a slow client never blocks the project actor. It enforces the 15 second hello timeout.
- [ ] The handshake accepts only `proto` 2. It checks proto, project (case-insensitive), token, then account, in that order, and replies with a coded `error` or `probe_result`. A wrong proto gets `protocol_version` with `hubMin` 2 and `hubMax` 2. A proto 1 hello also gets a `message` field reading `Phiên bản giao thức khác hub (máy: 1, hub: 2). Cập nhật extension LAN Collab lên 0.2.` It is the one legacy text the hub sends, because 0.1 clients read only `message`.
- [ ] `project.rs` is the project actor. It owns the file map, per-file text as `Vec<u16>`, rev, op log (trim from 2000 to 1000), `lastSeq` per uid and path, clients, presence, and activity. It handles `get`, `op`, `create`, `put`, `delete`, `check`, `presence`, `status`, and `ping`.
- [ ] `op` replies `ack` with the post-apply rev and broadcasts `op` with the pre-apply rev and `by`. A missing or non-text file replies `nack`. A bad op or rev outside the log replies `resync`.
- [ ] `create` retires every other key equal under case-insensitive comparison and broadcasts `deleted` for each, then follows the 0.1 rules for text onto text (diff as op, `file` to the creator, `op` to the others) and for new files (`file` to everyone). `put` replies `stored` to the sender and `file` to the others.
- [ ] `files.rs` loads the root at start, classifies text or blob with the same rules as `classify` in `lib/common.js` (extension list, 1 MiB, NUL byte, UTF-8 round trip), and normalizes EOL to the dominant ending with a tie going to LF.
- [ ] `flush.rs` runs on a blocking thread fed by a channel. A dirty file is written at most once per 500 ms after the first edit, through a temp file `<abs>.<8 hex>.lc-tmp` and a rename, with an in-place write when the rename fails on a locked file.
- [ ] `paths.rs` ports `safeRel` and `UNSAFE_SEGMENT` from `lib/common.js` character for character. `exclude.rs` ports `makeExcluder` and `DEFAULT_EXCLUDE`.
- [ ] Each message handler runs inside `catch_unwind`. A panic logs the message type and the client, resyncs that file for that client, and keeps the actor alive.
- [ ] `lanhub-cli` accepts `--root`, `--port`, `--host`, `--project`, `--token`, `--allow-file`, `--history`, `--exclude`, `--log-format`, and `--no-discovery`, with the Node hub defaults. With `--port 0 --log-format json` it prints the `listening` line. Ctrl+C, SIGTERM, and `--stop-on-stdin-close` flush every dirty file before exit. `--discovery-port` is accepted and ignored until A3.

**You see.**

- [ ] `LANHUB_CMD=lanhub-cli npm run test:conformance` prints `sync.test.js`, `exclude.test.js`, `robustness.test.js`, and the `protocol-v2.test.js` cases that need no allow list and no TLS as OK. The account cases, `chat.test.js`, and `discovery.test.js` are skipped by a feature check until A3, and the `tls_required` case until A6.
- [ ] `packages/protocol/src/generated/Message.ts` exists and lists every message type.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `lanhub-core/tests/paths.rs` runs every path from `robustness.test.js` section 2 plus `com0`, `lpt9.txt`, `a.txt:stream`, `GIT~1`, and `x.` against both `paths.rs` and a vector file produced by `safeRel`. Run `cargo test -p lanhub-core paths`.
- [ ] `lanhub-core/tests/framing.rs` covers split chunks, a 64 KiB pre-auth line, empty lines, and malformed JSON. Run `cargo test -p lanhub-core framing`.
- [ ] `lanhub-core/tests/panic.rs` injects a panic into one handler and asserts the next op on another file still gets `ack`. Run `cargo test -p lanhub-core panic`.
- [ ] Run the conformance suite against the Rust hub three times in a row. All three pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the conformance suite against the Node hub (trunk) and against `lanhub-cli` (head). Save `a2-regression.txt`. Pass when every file that passes on the Node hub, other than chat and discovery, passes on the Rust hub.
- [ ] Lane 2. Open two VS Code instances through `tools/cdp/vscode.mjs` against `lanhub-cli`, type 200 characters in each into the same `a.py`. Save `a2-two-editors.png`. Pass when both editors and the hub disk hold the same text with 400 new characters.
- [ ] Lane 3. Write to `a.py` from a script on one client's disk while the other client types. Save `a2-disk-write.png`. Pass when the external write merges and the activity feed shows kind `edit_disk`.
- [ ] Lane 4. Send a raw hello with `proto` 1. Save `a2-proto1.txt`. Pass when the reply is `protocol_version` with `hubMin` 2 and `hubMax` 2 and the socket closes.
- [ ] Lane 5. Send 256 KB without a newline before hello. Save `a2-preauth.txt`. Pass when the hub closes the socket within 2 seconds and logs one warning line.
- [ ] Lane 6. Create `README.md` and then `readme.md` from two clients. Save `a2-case.txt`. Pass when the hub keeps one key, broadcasts `deleted` for the retired key, and the disk holds one file.
- [ ] Lane 7. Open `a.py` in another program that holds a write lock (`notepad` with the file open in exclusive mode via a PowerShell `FileStream`), then edit from a client. Save `a2-locked.txt`. Pass when the hub falls back to the in-place write and the disk content matches the hub.
- [ ] Lane 8. Edit from a client, then press Ctrl+C on the hub within 300 ms. Save `a2-shutdown.txt`. Pass when the last edit is on disk after exit.
- [ ] Lane 9. Start the hub on a folder with a mixed-EOL file. Save `a2-eol.txt`. Pass when the file is rewritten to the dominant EOL within 1 second, matching the Node hub behavior on the same folder.
- [ ] Lane 10. Run `tools/loadgen.mjs` with 20 clients at 20 ops per second for 120 seconds. Save `a2-soak.txt`. Pass when every op gets `ack`, the hub never logs a panic, and hub memory at the end is within 10 percent of memory at 30 seconds.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `ackRttP99` with 10 clients at 20 ops per second, and `fanoutP99` with 20 clients at 20 ops per second, from `tools/loadgen.mjs` on loopback.
- [ ] Probe. Run the loadgen five times against the Node hub and five times against `lanhub-cli`, interleaved, with the same seed and duration of 60 seconds.
- [ ] Baseline. Record the Node hub medians first.
- [ ] Rule. A Rust median above the Node median fails. A Rust `ackRttP99` above 5 ms fails. A Rust `fanoutP99` above 10 ms fails.

**Review gate.** None. A2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add chat, media, the allow list, and LAN discovery (A3)

**Depends on.** A2.

**Files.**

- [ ] Create `lanhub/crates/lanhub-core/src/chat.rs`, `src/allow.rs`, `src/discovery.rs`.
- [ ] Edit `lanhub/crates/lanhub-core/src/project.rs` and `src/session.rs`.
- [ ] Edit `lanhub/crates/lanhub-cli/src/main.rs`.

**Build.**

- [ ] `chat.rs` appends to `<history>/chat.jsonl` on the flush thread, keeps 500 messages in memory, sends the last 200 in `welcome`, trims text to 4000 characters, and broadcasts `chat` to every client including the sender. On start it reads the file and skips a torn last line.
- [ ] Images keep the 0.1 rules. MIME is one of PNG, JPEG, GIF, WebP. Decoded size is at most 4 MiB. The file is `<history>/chat-media/<sha1>.<ext>`, written once. A bad image replies `chat_rejected`. `media` replies with the bytes or `missing`.
- [ ] The chat `key` stays `sha1("chat:" + (device or uid or random))` truncated to 16 hex characters, so clients recognize their own messages across a hub swap.
- [ ] `allow.rs` re-reads the allow file on each join, strips comments, lowercases, and matches `provider:label` or the bare label. A missing, unreadable, or empty file allows everyone, as in 0.1.
- [ ] `discovery.rs` binds UDP 8201 on every interface, answers `lanhub_discover` with `lanhub_here`, and rate-limits replies to 20 per second per source address. `--no-discovery` disables it.

**You see.**

- [ ] `LANHUB_CMD=lanhub-cli npm run test:conformance` passes every file with no expected failures left.
- [ ] `chat.jsonl` written by the Node hub loads in the Rust hub and its last 200 messages appear in a new client's `welcome`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `lanhub-core/tests/chat.rs` covers the torn-line case, the 4000 character trim, and the key derivation against values computed by `lib/common.js` `sha1`. Run `cargo test -p lanhub-core chat`.
- [ ] `lanhub-core/tests/allow.rs` covers comment lines, case, provider prefix, empty file, and missing file. Run `cargo test -p lanhub-core allow`.
- [ ] Run the full conformance suite against the Rust hub three times. All three pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `chat.test.js` and `discovery.test.js` against the Node hub and against `lanhub-cli`. Save `a3-regression.txt`. Pass when both pass on both hubs.
- [ ] Lane 2. Copy a `.lan-collab/history` folder written by the Node hub with 600 chat messages and start `lanhub-cli` on it. Open chat in VS Code. Save `a3-history.png`. Pass when the chat view shows the last 200 messages in order.
- [ ] Lane 3. Paste a 3 MB PNG into the chat composer in VS Code. Save `a3-image.png`. Pass when the second VS Code instance shows the image and one file exists under `chat-media/`.
- [ ] Lane 4. Send a 5 MB image through a raw client. Save `a3-image-reject.txt`. Pass when the reply is `chat_rejected` and nothing is written.
- [ ] Lane 5. Reconnect a VS Code instance after a hub restart and send a message. Save `a3-own-message.png`. Pass when the message renders as the sender's own message.
- [ ] Lane 6. Add `github:alice` to the allow file while the hub runs, then join as `github:bob`. Save `a3-allow.png`. Pass when VS Code shows the account-denied message and the allow file was not reloaded by a restart.
- [ ] Lane 7. Delete the allow file while the hub runs and join as `github:bob`. Save `a3-allow-open.txt`. Pass when the join succeeds.
- [ ] Lane 8. Send `lanhub_discover` from loopback and from a second LAN machine if the operator provides one. Save `a3-discovery.txt`. Pass when each reply carries the hub `instanceId` within 500 ms.
- [ ] Lane 9. Flood UDP 8201 with 1000 discover packets in one second. Save `a3-flood.txt`. Pass when the hub sends at most 20 replies per second to that source and op latency during the flood stays within the A2 budget.
- [ ] Lane 10. Run `lanhub-cli --no-discovery` and check `netstat -ano`. Save `a3-nodisc.txt`. Pass when UDP 8201 is not bound.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Chat fan-out time from send to receipt on 20 clients, and `ackRttP99` while chat runs at 5 messages per second.
- [ ] Probe. Run `tools/loadgen.mjs --chat 5` five times against the Node hub and five times against `lanhub-cli`, interleaved.
- [ ] Baseline. Record the Node hub medians first.
- [ ] Rule. A Rust median above the Node median on either number fails.

**Review gate.** None. A3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Serve many projects from one hub with a config file (A4)

**Depends on.** A3.

**Files.**

- [ ] Create `lanhub/crates/lanhub-core/src/config.rs`, `src/registry.rs`, `src/router.rs`, `src/admin.rs`.
- [ ] Edit `lanhub/crates/lanhub-core/src/project.rs` and `src/session.rs`.
- [ ] Edit `lanhub/crates/lanhub-cli/src/main.rs`.
- [ ] Create `test/conformance/multi-project.test.js`.
- [ ] Create `lanhub/examples/lanhub.toml`.

**Build.**

- [ ] `config.rs` parses `lanhub.toml` into typed structs with the fields from README section 5.5. A parse error names the file, line, column, and key. Defaults fill missing fields. The parsed config is the only input the rest of the core reads.
- [ ] `registry.rs` holds one actor handle per enabled project, keyed by lowercased project name. `apply(config)` compares the new config with the running set and starts, stops, or updates only the projects that differ. Running `apply` twice with the same config changes nothing.
- [ ] Updating token, allow list, exclude, or advertise reaches the running actor without a restart. Changing `root` stops the actor, flushes it, and starts a new one on the new root.
- [ ] `router.rs` reads `hello.project` and hands the session to the matching actor. An unknown name replies `project_unknown` with the names of projects that have `advertise = true`.
- [ ] Each project actor runs under its own supervisor task. A panic that escapes an actor stops only that project, logs it, and marks it failed in the registry. Other projects keep serving.
- [ ] Each project keeps its `id` from `<root>/.lan-collab/hub.json` and sends it as `welcome.hubId`. The hub-level `instanceId` lives in the config folder as `instance.json` and goes in `lanhub_here` and invite codes.
- [ ] `admin.rs` defines the `AdminApi` trait with `list_projects`, `project_status`, `apply_config`, `rotate_token`, `clients`, and `logs`. The local implementation calls the registry directly. A7 and A10 use it.
- [ ] `lanhub-cli --config <file>` loads the file, applies it, watches the file, and re-applies on change after a 300 ms debounce. A config with a parse error keeps the previous config running and logs the error.
- [ ] The single-project flags from A2 still work and build a one-project config in memory.

**You see.**

- [ ] `lanhub-cli --config lanhub/examples/lanhub.toml` logs one line per project with name, root, and file count, then one `listening` line.
- [ ] Editing the file to add a project logs `project started` for the new one and nothing for the others.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `lanhub-core/tests/config.rs` covers defaults, every field, a duplicate project name, a missing root, and an error message with line and column. Run `cargo test -p lanhub-core config`.
- [ ] `lanhub-core/tests/registry.rs` applies configs A, B, B, A and asserts the start and stop events for each step. Run `cargo test -p lanhub-core registry`.
- [ ] `multi-project.test.js` runs three projects on one port with ten clients each and asserts no op crosses projects. Run `LANHUB_CMD=lanhub-cli node --test test/conformance/multi-project.test.js`.
- [ ] The full conformance suite still passes against the Rust hub.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no multi-project hub. Record that fact, then run the single-project conformance suite against the Node hub and against `lanhub-cli` started with `--config` holding one project. Save `a4-regression.txt`. Pass when both pass.
- [ ] Lane 2. Start three projects and open one VS Code instance per project. Save `a4-three.png`. Pass when each editor syncs only with its own project folder on the hub.
- [ ] Lane 3. Add a fourth project to the file while clients edit the first three. Save `a4-hot-add.txt`. Pass when no client of the first three reconnects and the fourth accepts a join within 1 second.
- [ ] Lane 4. Rotate the token of project 2 in the file. Save `a4-rotate.txt`. Pass when new joins to project 2 need the new token and sessions in project 1 and 3 are untouched.
- [ ] Lane 5. Write a config with a syntax error on line 7. Save `a4-bad-config.txt`. Pass when the log names line 7 and the previous projects keep serving.
- [ ] Lane 6. Trigger a panic inside the project 2 actor through a debug-only test hook. Save `a4-isolation.txt`. Pass when project 2 is marked failed, and projects 1 and 3 keep acking ops.
- [ ] Lane 7. Join with an unknown project name from VS Code. Save `a4-unknown.png`. Pass when the client receives `project_unknown` listing only projects with `advertise = true`.
- [ ] Lane 8. Point a project at a root that a 0.1 hub used. Save `a4-hubid.txt`. Pass when `welcome.hubId` equals the `id` in that root's `.lan-collab/hub.json`, and a 0.2 client that had synced before does not show the first-sync dialog.
- [ ] Lane 9. Change project 1 `root` in the file. Save `a4-root-change.txt`. Pass when the old root is flushed, clients of project 1 resync on the new root, and the other projects are untouched.
- [ ] Lane 10. Apply the same config file ten times by touching it. Save `a4-idempotent.txt`. Pass when the log shows no start or stop event after the first apply.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Per-project `ackRttP99` with three projects of ten clients each at 20 ops per second, compared with one project of ten clients.
- [ ] Probe. Run `tools/loadgen.mjs --projects 3` and `tools/loadgen.mjs --projects 1` five times each, interleaved, against the head binary. Run the single-project case against the Node hub too.
- [ ] Baseline. Record the Node hub single-project median first, then the Rust single-project median.
- [ ] Rule. A three-project per-project median more than 20 percent above the Rust single-project median fails. A Rust single-project median above the Node median fails.

**Review gate.** None. A4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Record edit runs and serve them over the protocol (A5)

**Depends on.** A4.

**Files.**

- [ ] Create `lanhub/crates/lanhub-core/src/history/mod.rs`, `history/store.rs`, `history/blobs.rs`, `history/runs.rs`, `history/retention.rs`.
- [ ] Edit `lanhub/crates/lanhub-core/src/project.rs` and `src/config.rs`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs`.
- [ ] Edit `docs/protocol.md` to add the history messages.
- [ ] Create `test/conformance/history.test.js`.

**Build.**

- [ ] `store.rs` opens `<root>/.lan-collab/history/history.db` with bundled SQLite in WAL mode and creates the `runs` and `checkpoints` tables. The `runs` columns are `id, path, author_uid, author_name, color, source, started_at, ended_at, op_count, chars_added, chars_removed, start_blob, end_blob, reverts`.
- [ ] `blobs.rs` stores content under `history/blobs/<first 2 hex>/<sha256>.zst` with zstd level 3. It writes through a temp file and a rename, so a crash never leaves a partial blob under the final name. An existing blob is never rewritten.
- [ ] `runs.rs` is a pure state machine per file. Inputs are op applied (author, source, time), file deleted, file renamed, checkpoint created, and hub stopping. It closes the open run on another author, an idle gap of `idle_minutes`, a checkpoint, a delete or rename, or shutdown. A delete run keeps the last content as `end_blob`.
- [ ] Sources are `editor`, `disk`, `revert`, and `merge`. The project actor reads `src` from the op message. A `revert` op carries the reverted run id in `op.reverts`.
- [ ] Blob files get runs too. Each `create` or `put` of a blob is one closed run whose start and end blobs are the old and new file, so binary history and restore work in B7.
- [ ] The project actor sends run events to one history writer thread per project through a channel. The actor never waits on SQLite.
- [ ] `retention.rs` runs every hour and at start. It deletes runs older than `keep_days`, then the oldest runs until the folder is under `max_mb`, then blobs no run references. Running it twice in a row deletes nothing the second time.
- [ ] The actor handles `history_list {path?, before?, limit}` with `history_runs {path, runs, more}`, `history_blob {blob}` with the content as text or base64, and `checkpoint_create {name}` and `checkpoint_list`. It broadcasts `history_changed {path}` when a run closes.
- [ ] `welcome.features` includes `history`.
- [ ] `docs/protocol.md` gains the history section. No P0-2 message changes.

**You see.**

- [ ] Two clients that take turns on `a.py` produce one run per turn in `history_runs`.
- [ ] `history_blob` for a run's `end_blob` returns the exact file text at the end of that run.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `history/runs.rs` tests cover each boundary rule, an idle gap of exactly `idle_minutes`, interleaved files, and shutdown with an open run. Run `cargo test -p lanhub-core history::runs`.
- [ ] `history/retention.rs` tests cover age, size, shared blobs, and the second run deleting nothing. Run `cargo test -p lanhub-core history::retention`.
- [ ] `history.test.js` drives two clients through ten turns, a delete, a checkpoint, and an idle gap shortened by config, and asserts the run list and blob contents. Run `LANHUB_CMD=lanhub-cli node --test test/conformance/history.test.js`.
- [ ] Kill the hub with `taskkill /F` in the middle of a blob write in a test hook build. On restart `PRAGMA integrity_check` returns `ok` and no blob has a wrong hash.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no edit-run history. Record that fact, then run the full conformance suite against the Node hub and against the head binary with history on. Save `a5-regression.txt`. Pass when every pre-existing file passes on both and `history.test.js` passes on the head binary.
- [ ] Lane 2. Two VS Code instances take five turns each on `a.py`. Query `history_list` with a raw client. Save `a5-turns.txt`. Pass when there are ten runs with alternating authors and correct `chars_added`.
- [ ] Lane 3. One VS Code instance edits `a.py` for 2 minutes with `idle_minutes = 1` and a 70 second pause in the middle. Save `a5-idle.txt`. Pass when the history holds two runs by the same author.
- [ ] Lane 4. A script on one client writes `b.py` on disk. Save `a5-disk-source.txt`. Pass when the run has source `disk`.
- [ ] Lane 5. Delete `c.py` from VS Code. Save `a5-delete.txt`. Pass when the last run for `c.py` is a delete run whose `end_blob` holds the deleted text.
- [ ] Lane 6. Create checkpoint `before-refactor` while `a.py` has an open run. Save `a5-checkpoint.txt`. Pass when the open run closes at the checkpoint time and `checkpoint_list` returns the name.
- [ ] Lane 7. Set `keep_days = 0` and `max_mb = 1` in the config, then wait for retention. Save `a5-retention.txt`. Pass when old runs and unreferenced blobs are gone and the newest run of each file remains.
- [ ] Lane 8. Restart the hub during an open run. Save `a5-restart.txt`. Pass when the run is closed with the shutdown time and the next edit opens a new run.
- [ ] Lane 9. Put the project root on a mapped network drive if the operator provides one, otherwise a local folder, and run lane 2. Save `a5-network-drive.txt`. Pass when history works, or the hub logs a clear warning that history is disabled on that root.
- [ ] Lane 10. Run `tools/loadgen.mjs` with 20 clients at 20 ops per second on 50 files for 10 minutes. Save `a5-soak.txt`. Pass when the history writer queue never exceeds 1000 events and the database size grows linearly with run count.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `ackRttP99` with 10 clients at 20 ops per second, history on and history off, plus `history_list` latency for 500 runs and `history_blob` latency for a 1 MiB blob.
- [ ] Probe. Run `tools/loadgen.mjs` five times with history on and five times with history off, interleaved, then time 100 `history_list` and 100 `history_blob` calls.
- [ ] Baseline. Record the history-off median first. Trunk lacks history, so the history-off run is the baseline.
- [ ] Rule. A history-on median more than 10 percent above the history-off median fails. `history_list` above 50 ms p99 or `history_blob` above 100 ms p99 fails.

**Review gate.** None. A5 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add optional TLS, the HTTP diagnostic page, and a self-check command (A6)

**Depends on.** A4.

**Files.**

- [ ] Create `lanhub/crates/lanhub-core/src/tls.rs`, `src/http_diag.rs`, `src/diagnose.rs`.
- [ ] Edit `lanhub/crates/lanhub-core/src/session.rs`, `src/config.rs`.
- [ ] Edit `lanhub/crates/lanhub-cli/src/main.rs`.
- [ ] Create `test/conformance/tls.test.js`.

**Build.**

- [ ] `tls.rs` wraps accepted sockets with `tokio-rustls` when `[hub.tls] enabled = true`. With no cert path it generates a self-signed certificate with `rcgen` into the config folder once and reuses it. It exposes the SHA-256 fingerprint of the certificate.
- [ ] Invite codes printed by the hub are v3 and carry the fingerprint in field `f` when TLS is on.
- [ ] `[hub] public_address` takes one or more host names or IP addresses. They go first in the invite `a` list, before interface addresses, so a hub behind NAT or on a cloud VM prints a usable code.
- [ ] With TLS on, a plain TCP hello is refused with a single `error` line coded `tls_required`, then closed. `docs/protocol.md` already lists `features`, and the hub adds `tls` to `welcome.features`.
- [ ] `http_diag.rs` peeks the first four bytes of a plain connection. `GET ` gets an HTTP/1.1 response with a small HTML page that states hub name, version, uptime, and the names of projects with `advertise = true`, then closes. It never returns tokens, roots, or client lists.
- [ ] `diagnose.rs` backs `lanhub-cli --diagnose`. It checks that the config parses, that the port and UDP 8201 can be bound, lists IPv4 interfaces with their addresses, and on Windows runs `netsh advfirewall firewall show rule name=all` read-only to report whether inbound TCP for the port and UDP 8201 are allowed. It prints one line per check with `ok` or `fail` and a fix hint.

**You see.**

- [ ] With TLS on, the hub log prints `TLS fingerprint SHA256 <hex>` and the invite code decodes with the same fingerprint.
- [ ] Opening `http://127.0.0.1:<port>/` in Edge shows the hub name and project list.
- [ ] `lanhub-cli --diagnose` prints one line per check and exits 0 when all pass.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tls.test.js` connects with Node `tls.connect` pinned to the fingerprint and passes sync, then connects with a wrong pin and expects a failure. Run `LANHUB_CMD=lanhub-cli node --test test/conformance/tls.test.js`.
- [ ] `lanhub-core/tests/http_diag.rs` asserts the page contains no token, root path, or uid. Run `cargo test -p lanhub-core http_diag`.
- [ ] `lanhub-core/tests/diagnose.rs` runs the checks against a port already bound by another socket and expects a `fail` line for the port. Run `cargo test -p lanhub-core diagnose`.
- [ ] The full conformance suite still passes with TLS off.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no TLS. Record that fact, then run the full conformance suite against the Node hub and against the head binary with TLS off. Save `a6-regression.txt`. Pass when both pass.
- [ ] Lane 2. Turn TLS on and run the conformance sync file over TLS. Save `a6-tls-sync.txt`. Pass when it passes.
- [ ] Lane 3. Restart the hub with TLS on twice. Save `a6-cert-stable.txt`. Pass when the fingerprint is the same after both restarts.
- [ ] Lane 4. Send a plain hello to a TLS hub. Save `a6-plain-refused.txt`. Pass when the reply is `tls_required` and the socket closes.
- [ ] Lane 5. Open `http://<LAN IP>:<port>/` in Edge through `tools/cdp`. Save `a6-diag-page.png`. Pass when the page shows hub name, version, and only advertised projects.
- [ ] Lane 6. Send `GET /../../etc/passwd HTTP/1.1` and a 1 MB request line. Save `a6-diag-abuse.txt`. Pass when the hub returns the same fixed page or closes, and never reads a file.
- [ ] Lane 7. Run `lanhub-cli --diagnose` with no firewall rule for the port. Save `a6-diagnose-fw.txt`. Pass when the firewall line says `fail` and prints the exact `netsh` command to add the rule.
- [ ] Lane 8. Run `lanhub-cli --diagnose` while another process holds the port. Save `a6-diagnose-port.txt`. Pass when the port line says `fail` and names the owning process id.
- [ ] Lane 9. Run `lanhub-cli --diagnose` with a config that has a syntax error. Save `a6-diagnose-config.txt`. Pass when the config line says `fail` with the line number.
- [ ] Lane 10. Run `lanhub-cli --diagnose` in a non-elevated shell. Save `a6-diagnose-nonadmin.txt`. Pass when every check runs without asking for elevation and nothing is changed on the system.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `ackRttP50` and `ackRttP99` with 10 clients at 20 ops per second, TLS on and TLS off.
- [ ] Probe. Run `tools/loadgen.mjs --tls <fingerprint>` five times and `tools/loadgen.mjs` five times against the head binary, interleaved.
- [ ] Baseline. Record the TLS-off medians first. Trunk lacks TLS, so the TLS-off run is the baseline.
- [ ] Rule. TLS adding more than 1 ms to the `ackRttP50` median fails. The TLS-on `ackRttP99` above the A2 budget of 5 ms fails.

**Review gate.** None. A6 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Build the LAN Hub desktop app shell (A7)

**Depends on.** A4.

**Files.**

- [ ] Create `lanhub/app/src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/tray.rs`, `src-tauri/icons/`.
- [ ] Create `lanhub/app/ui/package.json`, `ui/vite.config.ts`, `ui/src/main.ts`, `ui/src/App.svelte`, `ui/src/routes/Projects.svelte`, `ui/src/routes/ProjectForm.svelte`, `ui/src/lib/api.ts`, `ui/src/i18n/vi.json`, `ui/src/i18n/index.ts`.
- [ ] Edit `lanhub/Cargo.toml` to add `app/src-tauri` to the workspace.
- [ ] Edit `tools/cdp/app.mjs` to replace the stub with a real launcher.

**Build.**

- [ ] `main.rs` starts the tokio runtime, loads `lanhub.toml` from `%APPDATA%\LanHub\`, creates the registry, and exposes the local `AdminApi` through Tauri commands in `commands.rs`. The app uses the stable Tauri 2 release that is at least two weeks old when A7 starts.
- [ ] Single instance through `tauri-plugin-single-instance`. A second launch focuses the existing window.
- [ ] Closing the window hides it. The hub keeps running. The tray icon shows the hub state and has the menu items to open the window, pause or resume a project, copy an invite code, and quit. Quit flushes every project before exit.
- [ ] `Projects.svelte` shows one card per project with status dot, name, connected clients, file count, last activity time, and ops per second over the last 10 seconds. The core pushes a status event at most every 500 ms and only on change.
- [ ] `ProjectForm.svelte` adds or edits a project. Fields are name, root folder (native folder picker), and enabled. Validation happens before saving and names the field. Saving writes `lanhub.toml` and calls `apply_config`.
- [ ] Every component comes from `packages/ui-kit` with `theme-app.css`. Every visible string comes from `ui/src/i18n/vi.json` and follows `docs/copy-guide.md`.
- [ ] Icons for the app and the tray come from `media/icon.svg` through `tauri icon`.
- [ ] `tools/cdp/app.mjs` launches the built app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<n>` and exposes `screenshot`, `click`, `type`, `evaluate`, and `close`.

**You see.**

- [ ] Launching the app opens a window titled `LAN Hub` with the project list. With no config it shows an empty state with one button to add a project.
- [ ] Adding a project with an existing root shows a card that turns green and counts files within 2 seconds.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `lanhub/app/src-tauri/tests/commands.rs` calls each Tauri command against a temp config and asserts the file content after save. Run `cargo test -p lanhub-app`.
- [ ] `npx svelte-check` in `lanhub/app/ui` reports 0 errors and 0 warnings.
- [ ] A string check script in `lanhub/app/ui/scripts/check-i18n.mjs` fails when a `.svelte` file contains a Vietnamese literal. Prove it with a scratch edit.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no app. Record that fact, then gate the added behavior. Start the app with a three-project config and connect one VS Code instance to each project. Save `a7-regression.png`. Pass when all three cards show one client and edits sync, matching `lanhub-cli` on the same config.
- [ ] Lane 2. Launch the app with no config. Save `a7-empty.png`. Pass when the empty state shows one add-project button and no error.
- [ ] Lane 3. Add a project through the form with the folder picker. Save `a7-add.png`. Pass when the card appears and `lanhub.toml` contains the project.
- [ ] Lane 4. Submit the form with an empty name and with a duplicate name. Save `a7-validate.png`. Pass when each error names the field and nothing is written.
- [ ] Lane 5. Close the window while a VS Code client edits. Save `a7-tray.png`. Pass when the tray icon remains and the client keeps syncing.
- [ ] Lane 6. Launch the app a second time. Save `a7-single.png`. Pass when the first window comes to the front and only one `LanHub.exe` process runs.
- [ ] Lane 7. Choose Quit from the tray right after an edit. Save `a7-quit.txt`. Pass when the edit is on disk after the process exits.
- [ ] Lane 8. Disable a project from its card. Save `a7-disable.png`. Pass when its clients receive a disconnect and the other projects keep serving.
- [ ] Lane 9. Switch Windows to dark mode. Save `a7-dark.png`. Pass when the app follows the system theme with custom scrollbars visible in the project list.
- [ ] Lane 10. Run 20 loadgen clients on one project and watch the card. Save `a7-live.png`. Pass when the ops per second value updates at least once per second and the window stays responsive to clicks.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Cold start time from process launch to first paint of the project list, and idle working set of the app process tree including WebView2 after 60 seconds.
- [ ] Probe. Launch the release build five times through `tools/cdp/app.mjs`, read `performance.timing` plus process start time, and sum `Get-Process` working sets for the app and its `msedgewebview2` children.
- [ ] Baseline. Trunk lacks the app. Record that the baseline is absent and use the absolute budgets.
- [ ] Rule. A median cold start above 1.5 seconds fails. A median idle working set above 120 MB fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 3, 4, 5, and 9 screenshots into `docs/plans/media/a7-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of adding a project, connecting a client, and closing to tray with `tools/cdp/record.mjs`. Save it as `docs/plans/media/a7-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it after the review.

## Add the project administration screens (A8)

**Depends on.** A7 and A5.

**Files.**

- [ ] Create `lanhub/app/ui/src/routes/project/Access.svelte`, `Sync.svelte`, `History.svelte`, `Invite.svelte`, `Members.svelte`, `Logs.svelte`.
- [ ] Create `lanhub/app/ui/src/routes/ImportLegacy.svelte`.
- [ ] Edit `lanhub/app/src-tauri/src/commands.rs`.
- [ ] Edit `lanhub/crates/lanhub-core/src/admin.rs` to add `history_usage`, `invite_codes`, and `import_legacy`.
- [ ] Edit `lanhub/app/ui/src/i18n/vi.json`.

**Build.**

- [ ] Access shows the token masked with buttons to reveal, copy, and rotate. Rotate asks for confirmation, writes the config, and lists the clients that will need the new code. The allow list editor validates each line as `provider:label` or a bare label and shows the line number of an invalid entry.
- [ ] Sync edits extra exclude patterns and previews which existing files they match before saving.
- [ ] History edits `idle_minutes`, `keep_days`, and `max_mb`, shows disk usage of `history.db` and `blobs/`, and has a button to run retention now.
- [ ] Invite lists one v3 code per project with all addresses inside, shows a QR code rendered in Svelte from the code, and copies on click.
- [ ] Members lists connected clients with name, account, IP address, file, and the RTT each client reports in `presence.p.rtt`, refreshed on change.
- [ ] Logs shows structured log lines in a VirtualList with level filter, project filter, text search, and export to a `.log` file.
- [ ] Import reads a 0.1 hub folder, finds each `token-<project>.txt` and `allowed-accounts-<project>.txt`, asks for the root of each project, and adds them to the config. Importing the same folder again adds nothing.

**You see.**

- [ ] Each project card opens a detail page with tabs Truy cập, Đồng bộ, Lịch sử, Mã mời, Thành viên, Nhật ký.
- [ ] Importing a 0.1 hub folder with two token files adds two projects with their tokens and allow lists.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `lanhub-core/tests/import_legacy.rs` covers two projects, a missing allow file, a token file with trailing whitespace, and running the import twice. Run `cargo test -p lanhub-core import_legacy`.
- [ ] `lanhub-core/tests/admin.rs` covers `rotate_token`, `history_usage`, and `invite_codes`. Run `cargo test -p lanhub-core admin`.
- [ ] `npx svelte-check` and `node scripts/check-i18n.mjs` in `lanhub/app/ui` pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has the A7 shell without admin screens. Run the A7 lane 1 scenario at trunk and head. Save `a8-regression.png`. Pass when both pass, and at head the detail page opens from each card.
- [ ] Lane 2. Rotate the token of a project with one VS Code client connected. Save `a8-rotate.png`. Pass when the dialog lists the client, and a new join with the old code fails with `token_invalid`.
- [ ] Lane 3. Enter `github alice` (with a space) in the allow list. Save `a8-allow-invalid.png`. Pass when the editor marks that line and Save is disabled.
- [ ] Lane 4. Add exclude `build/**` to a project that has `build/out.js`. Save `a8-exclude-preview.png`. Pass when the preview lists `build/out.js` before saving.
- [ ] Lane 5. Open History after lane 2 of A5 ran on the same root. Save `a8-history.png`. Pass when disk usage shows non-zero sizes and Run retention completes.
- [ ] Lane 6. Copy an invite code from the Invite tab and paste it into the VS Code join command. Save `a8-invite.png`. Pass when VS Code joins the project.
- [ ] Lane 7. Scan the QR code image with a QR decoder script. Save `a8-qr.txt`. Pass when the decoded text equals the copied code.
- [ ] Lane 8. Connect three VS Code instances and open Members. Save `a8-members.png`. Pass when three rows show names, files, and RTT values under 10 ms on loopback.
- [ ] Lane 9. Generate 5000 log lines with loadgen and filter by level warn and search `resync`. Save `a8-logs.png`. Pass when filtering returns within 200 ms and export writes a file with the filtered lines.
- [ ] Lane 10. Import a 0.1 hub folder copied from `dist/lan-collab-hub-0.1.1.zip` with two configured projects. Save `a8-import.png`. Pass when both projects appear with their tokens, and a 0.1.1 era invite token joins with the new hub.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to open a project detail page and switch between tabs, and Logs scroll frame time with 50000 lines.
- [ ] Probe. Measure tab switches and scrolling through `tools/cdp/app.mjs` with the Performance domain, five runs each at trunk and head where trunk has the page.
- [ ] Baseline. Record the trunk project list render time first. Trunk lacks the detail pages, so they use absolute budgets.
- [ ] Rule. A tab switch above 100 ms fails. A Logs scroll frame above 16 ms at p95 fails. The project list render at head more than 10 percent above trunk fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 4, 5, 8, and 10 screenshots into `docs/plans/media/a8-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of rotating a token, editing the allow list, and importing a 0.1 folder with `tools/cdp/record.mjs`. Save it as `docs/plans/media/a8-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it after the review.

## Integrate with Windows and package the releases (A9)

**Depends on.** A7 and A6.

**Files.**

- [ ] Create `lanhub/app/src-tauri/src/firewall.rs`, `src-tauri/src/autostart.rs`.
- [ ] Create `lanhub/app/ui/src/routes/HubSettings.svelte`.
- [ ] Edit `lanhub/app/src-tauri/tauri.conf.json` for the NSIS bundle and the WebView2 bootstrapper.
- [ ] Create `tools/package-lanhub.mjs`.
- [ ] Edit `package.json` scripts to add `package:lanhub`.

**Build.**

- [ ] `firewall.rs` reads the current rules with `netsh advfirewall firewall show rule`. If inbound TCP for the hub port or inbound UDP 8201 is missing, it runs one elevated `netsh advfirewall firewall add rule` per missing rule through `ShellExecuteW` with the `runas` verb. It never adds a rule that exists. A refused UAC prompt leaves a clear state in the UI.
- [ ] `autostart.rs` uses `tauri-plugin-autostart` to start the app minimized to tray at login.
- [ ] `HubSettings.svelte` edits hub name, bind address, port, discovery, and TLS. Changing the port rebinds the listener, offers to update the firewall rule, and shows the new invite codes. Turning TLS on generates the certificate and shows its fingerprint.
- [ ] The NSIS installer embeds the WebView2 bootstrapper and installs per user without admin rights.
- [ ] `tools/package-lanhub.mjs` builds the four artifacts from README section 7 into `dist/`. They are `LanHub_<ver>_x64-setup.exe`, `lanhub-cli-<ver>-x86_64-pc-windows-msvc.zip`, `lanhub-cli-<ver>-x86_64-unknown-linux-gnu.tar.gz` (built on the Linux host named in README section 8 or CI), and the matching SHA-256 sums file.

**You see.**

- [ ] Clicking Mở tường lửa on a machine without rules shows one UAC prompt, then the settings page shows both rules as present.
- [ ] `npm run package:lanhub` writes the artifacts and prints their sizes.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `firewall.rs` tests parse captured `netsh` output in Vietnamese and English Windows locales and detect present and missing rules. Run `cargo test -p lanhub-app firewall`.
- [ ] A test in `commands.rs` changes the port in config and asserts the listener moved. Run `cargo test -p lanhub-app port_change`.
- [ ] `node tools/package-lanhub.mjs --dry-run` lists the four artifact paths.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no installer or firewall helper. Record that fact, then gate the added behavior. Install the head installer on this machine, start the app, and connect a VS Code client from a second machine if the operator provides one, otherwise from loopback. Save `a9-regression.png`. Pass when the client syncs through the installed app.
- [ ] Lane 2. Remove both firewall rules, then click Mở tường lửa and accept UAC. Save `a9-firewall.png`. Pass when `netsh` shows exactly one TCP rule and one UDP 8201 rule.
- [ ] Lane 3. Click Mở tường lửa again. Save `a9-firewall-again.txt`. Pass when no UAC prompt appears and the rule count does not change.
- [ ] Lane 4. Decline the UAC prompt. Save `a9-firewall-declined.png`. Pass when the page shows the rules as missing with the exact command to run by hand.
- [ ] Lane 5. Change the port from 8200 to 8210 with a client connected. Save `a9-port.png`. Pass when the client reconnects on 8210 after it rediscovers the hub, and the invite codes show 8210.
- [ ] Lane 6. Turn TLS on in settings. Save `a9-tls.png`. Pass when the fingerprint shows, the invite code carries it, and a client with the new code connects.
- [ ] Lane 7. Enable autostart and sign out and back in. Save `a9-autostart.png`. Pass when the app is in the tray and the hub serves without opening the window.
- [ ] Lane 8. Install on a Windows profile where WebView2 is absent, using a VM if the operator provides one. Save `a9-webview2.png`. Pass when the installer installs WebView2 and the app starts.
- [ ] Lane 9. Uninstall the app. Save `a9-uninstall.txt`. Pass when the program files are removed and `%APPDATA%\LanHub\lanhub.toml` and every project's `.lan-collab/` stay on disk.
- [ ] Lane 10. Run the Linux `lanhub-cli` from the tarball on the Linux host named in README section 8 with a config and connect a VS Code client from Windows. Save `a9-linux.png`. Pass when the client syncs.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Installer size, `lanhub-cli` zip size, and time from installer launch to a running hub.
- [ ] Probe. Build the artifacts three times and read the sizes, then time three silent installs with `/S`.
- [ ] Baseline. Trunk lacks the installer. Record the 0.1.1 hub zip size from `dist/` as context only, not as a ratio.
- [ ] Rule. An installer above 15 MB fails. A `lanhub-cli` zip above 10 MB fails. A silent install above 60 seconds fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 4, 5, and 6 screenshots into `docs/plans/media/a9-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of installing, opening the firewall, and changing the port with `tools/cdp/record.mjs` plus a screen recorder for the UAC prompt. Save it as `docs/plans/media/a9-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it after the review.

## Manage a remote headless hub from the app (A10)

**Depends on.** A9.

**Files.**

- [ ] Create `lanhub/crates/lanhub-core/src/admin_remote.rs`.
- [ ] Edit `lanhub/crates/lanhub-core/src/admin.rs`, `src/session.rs`, `src/config.rs`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs`.
- [ ] Create `lanhub/app/ui/src/routes/RemoteHubs.svelte`.
- [ ] Edit `lanhub/app/src-tauri/src/commands.rs`.
- [ ] Create `docs/lanhub-server.md`.
- [ ] Create `test/conformance/admin.test.js`.

**Build.**

- [ ] `[hub.admin] remote = true` with a `token` enables the admin channel on the same port. A connection whose first message is `admin_hello {token}` becomes an admin session. Without TLS the hub accepts `admin_hello` only from loopback addresses.
- [ ] The admin channel carries the `AdminApi` calls as request and response messages with ids. A wrong token closes the socket after a 1 second delay. Five failures from one address in a minute block that address for 5 minutes.
- [ ] `admin_remote.rs` implements `AdminApi` over that channel. The app holds a list of hubs, local first. `RemoteHubs.svelte` adds a remote hub by address, port, admin token, and fingerprint, and every screen from A7 and A8 works against it.
- [ ] Remote admin tokens are stored in the Windows Credential Manager through the `keyring` crate, never in `lanhub.toml`.
- [ ] `docs/lanhub-server.md` is a how-to for running `lanhub-cli` on a Linux server with a systemd unit and on Windows Server as a service created with `sc.exe`, with TLS and remote admin turned on.

**You see.**

- [ ] The app sidebar lists `Máy này` and each remote hub. Selecting a remote hub shows its projects with live status.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `admin.test.js` covers a correct token, a wrong token, a non-loopback plain connection, the rate limit, and each `AdminApi` call. Run `LANHUB_CMD=lanhub-cli node --test test/conformance/admin.test.js`.
- [ ] `lanhub-core/tests/admin_remote.rs` runs the same scenario set through both `AdminApi` implementations and asserts equal results. Run `cargo test -p lanhub-core admin_remote`.
- [ ] The full conformance suite still passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no remote admin. Record that fact, then run the A8 lane 2 scenario against the local hub at trunk and head. Save `a10-regression.png`. Pass when both pass, which proves the local `AdminApi` still works.
- [ ] Lane 2. Run `lanhub-cli` on the Linux host with TLS and remote admin, then add it in the app. Save `a10-add-remote.png`. Pass when its projects list with live status.
- [ ] Lane 3. Add a project to the remote hub from the app. Save `a10-remote-add-project.png`. Pass when the remote `lanhub.toml` contains it and a VS Code client can join.
- [ ] Lane 4. Rotate a token on the remote hub. Save `a10-remote-rotate.png`. Pass when old codes fail and new codes join.
- [ ] Lane 5. Enter a wrong admin token five times. Save `a10-ratelimit.txt`. Pass when the sixth attempt within the minute is refused without a token check and the log names the address.
- [ ] Lane 6. Connect with `admin_hello` over plain TCP from a non-loopback address. Save `a10-plain-refused.txt`. Pass when the hub refuses it.
- [ ] Lane 7. Enter a wrong fingerprint for the remote hub. Save `a10-fingerprint.png`. Pass when the app refuses to connect and shows the expected and received fingerprints.
- [ ] Lane 8. Inspect `lanhub.toml` and the Credential Manager after adding a remote hub. Save `a10-secret.txt`. Pass when the admin token is in the Credential Manager and absent from every file.
- [ ] Lane 9. Follow `docs/lanhub-server.md` step by step on the Linux host with systemd. Save `a10-doc.txt`. Pass when the service starts and survives `systemctl restart`.
- [ ] Lane 10. Stop the remote hub while its page is open in the app. Save `a10-offline.png`. Pass when the app marks the hub offline with a retry button and reconnects when the hub returns.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Round trip of `project_status` through the remote `AdminApi` compared with the local one, and op latency on the remote hub while an admin session polls.
- [ ] Probe. Call `project_status` 200 times locally and 200 times remotely over loopback TLS, interleaved, and run `tools/loadgen.mjs` with and without an open admin session.
- [ ] Baseline. Record the local call median and the loadgen median without an admin session first.
- [ ] Rule. A remote call median above 20 ms on loopback fails. An open admin session adding more than 5 percent to `ackRttP99` fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 7, and 10 screenshots into `docs/plans/media/a10-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of adding a remote hub and editing one of its projects with `tools/cdp/record.mjs`. Save it as `docs/plans/media/a10-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `upgrade/hub` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it after the review.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Report the `upgrade/hub` head SHA that holds A10 to the operator as the input for I1.
- [ ] List every change to `packages/ui-kit/**` and `docs/protocol.md` made on this track, so I1 can reconcile them with track B.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

No prototype ran during planning. These questions stay unproven, and the owner of the named PR settles each one first with a throwaway sketch per `playbooks/prototype.md`.

- A1 and A2. Whether `Vec<u16>` text with a full copy per `apply` stays inside the latency budget on a 1 MiB file at 20 ops per second. If not, the owner moves to a rope that indexes in UTF-16 units and records the measurement.
- A2. Whether counting the line limit in UTF-16 units on a byte stream costs a measurable amount. The fallback is a byte limit of four times the unit limit, which accepts every line the Node hub accepts.
- A5. Whether SQLite in WAL mode works on a root that sits on a mapped network drive. If not, the hub disables history for that project with a logged warning, which lane 9 of A5 checks.
- A7. Whether `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` reaches the WebView2 instance that Tauri creates. P0-4 proved only the stub. If it fails, `tools/cdp/app.mjs` uses the `additionalBrowserArgs` option in `tauri.conf.json` for debug builds.
- A9. Whether a per-user NSIS install can trigger UAC for `netsh` only, without elevating the whole app. The firewall helper elevates a single `netsh` call, and lane 2 proves it.

## Appendix B. Alternatives rejected

- One actor per file instead of one per project. It allows more parallel work inside a project, but the create path must see every file for case-collision retirement, and cross-file activity ordering gets harder. One actor per project already spreads load across cores when several projects run. Revisit only if A4 perf shows one project saturating a core.
- `tokio::sync::Mutex` around a shared file map. A lock shared by every session is the pattern the separate-before-serializing principle warns against. The actor owns the state and sessions talk to it through channels.
- `sled` or a flat JSON index for history. SQLite is the most tested embedded store, handles crash recovery, and gives indexed queries by path and time.
- A separate admin port. One port keeps one firewall rule. The admin channel is chosen by the first message, as the HTTP diag page is chosen by the first bytes.
- Running the hub as a Windows service controlled by the app. Two processes need a local admin API and service install rights. The in-process hub plus autostart covers a desktop host. Servers use `lanhub-cli` per `docs/lanhub-server.md`.
- Porting `lib/ot.js` by reading it and writing equivalent Rust without vectors. Byte-for-byte vectors are the only proof that clients and the Rust hub transform the same way.

## Appendix C. Risks

- A1. A tie-break or surrogate mistake in the port silently diverges clients. The owner watches the vector test and lane 3.
- A2. The writer task per client must never block the actor. A slow client with a full channel is disconnected, not waited on. The owner watches lane 10 memory and the soak log.
- A2. `safeRel` drift between Rust and `lib/common.js` opens a path traversal. The owner keeps the path vectors generated from `lib/common.js`.
- A3. A different chat `key` makes clients mislabel their own messages. Lane 5 watches it.
- A4. Hot apply of a root change while clients edit can lose edits. The owner flushes before stopping the actor, and lane 9 checks it.
- A5. History writes on the actor thread would add latency. Events go through a channel to the writer thread, and the perf rule checks the cost.
- A5. Retention bugs delete data users expect to keep. The owner keeps the newest run of every file and tests the second retention run.
- A6. The HTTP diag page leaks configuration. The unit test asserts the page holds no token, root, or uid.
- A7. WebView2 memory pushes idle RAM over budget. The owner measures in lane perf and trims the UI bundle first.
- A9. `netsh` output differs by Windows display language. The parser tests use captured Vietnamese and English output.
- A10. Remote admin is a new attack surface. TLS is mandatory off loopback, failures are rate-limited, and tokens live in the Credential Manager.

## Appendix D. Links and reading list

- `docs/plans/README.md` sections 5.1, 5.2, 5.4, 5.5, 5.6, 5.9, and 5.10 for the decisions this track implements.
- `docs/protocol.md` from P0-2 as the wire contract, and `test/conformance/` as its executable form.
- `hub/hub.js`, `lib/common.js`, and `lib/ot.js` as the behavior to port. The fragile points list in the hub survey (revs per process, pre-apply broadcast rev, create versus put replies, fail-open allow list, chat key, EOL rewrite at start) is the checklist for A2 and A3.
- A2, A4, and A5 get `pstack/skills/how/SKILL.md` before design and `pstack/skills/interrogate/SKILL.md` on the finished design. A5 also gets `pstack/skills/statechart/SKILL.md` for the run boundary state machine.
- The decision trail follows `pstack/skills/show-me-your-work/SKILL.md` and lives at `docs/plans/trail/A.tsv`.
