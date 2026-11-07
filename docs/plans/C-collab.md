# Team collaboration features plan (0.3)

This plan adds seven team features on top of 0.2.0, one PR each, chosen from the survey in `docs/plans/README.md` section 6. Members get an undo that touches only their own edits, line authorship, named checkpoints, comment threads on code, viewer and editor roles, a check for diverged workspaces, and richer presence. Each PR ships a 0.3.x version with its own CHANGELOG entry. The rule the program enforces is that a feature never changes another member's text without that member's or a reviewer's explicit action. PR ids in order are C1, C2, C3, C4, C5, C6, C7.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator merges every PR. Agents build, verify, and stop at merge-ready. C1 through C7 are all operator items that stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from the pinned pstack clone at program start. Re-read them at every tick. The clone is `cursor/plugins` at `C:\Users\BDT-QUY\src\cursor-plugins`, checked out at `6b03002` and never fetched, so `origin/main` stays at `6b03002`. Each read is `git show origin/main:<path>` run inside the clone, written below with `git -C`.
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-model-the-domain/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-test-behavior-not-implementation/SKILL.md`
  - [ ] Read `tools/cdp/README.md` from `main`. It replaces the `control-ui` skill for this repo.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `claude-opus-5-5` at effort `medium`. The C1 owner runs at effort `high` because C1 changes how local edits and remote edits interact in the editor.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges.
  - [ ] C1, C4, C5, C6, and C7 are independent and first after I2. All branch from the 0.2.0 `main`.
  - [ ] C2 after I2. It is independent of C1.
  - [ ] C3 after C2.
  - [ ] Two PRs that both add messages to `docs/protocol.md` merge one at a time, and the second rebases before its code-ready report.
- [ ] Hold the file boundaries.
  - [ ] C1 touches only `lib/editor-binding.js`, `extension/src/undo/**`, `package.json` keybindings and context keys, `test/conformance/undo.test.js`, `test/vscode/**`.
  - [ ] C2 touches only `lanhub/crates/lanhub-core/src/history/blame.rs`, `lanhub/crates/lanhub-protocol/**`, `docs/protocol.md`, `extension/src/authorship/**`, `extension/i18n/vi.json`, `package.json` contributions.
  - [ ] C3 touches only the history module of `lanhub-core`, `lanhub-protocol`, `docs/protocol.md`, `extension/webview-src/history/**`, `extension/src/views/history.js`, `extension/i18n/vi.json`.
  - [ ] C4 touches only `lanhub/crates/lanhub-core/src/comments/**`, `lanhub-protocol`, `docs/protocol.md`, `extension/src/comments/**`, `extension/i18n/vi.json`, `package.json` contributions.
  - [ ] C5 touches only the config and auth modules of `lanhub-core`, `lanhub/app/ui/src/routes/project/Access.svelte`, `lanhub-protocol`, `docs/protocol.md`, `extension/src/roles/**`, `extension/i18n/vi.json`.
  - [ ] C6 touches only `extension/src/drift/**`, `extension/webview-src/session/**`, `lanhub-protocol`, `docs/protocol.md`, the presence relay in `lanhub-core`, `extension/i18n/vi.json`.
  - [ ] C7 touches only `extension/src/presence/**`, `extension/webview-src/session/**`, `lanhub-protocol`, `docs/protocol.md`, the presence relay in `lanhub-core`, `extension/i18n/vi.json`.
  - [ ] C2, C4, C5, C6, and C7 also edit `lib/client-core.js` to send and receive their new messages.
  - [ ] Every PR also edits `package.json` version, `lanhub/Cargo.toml` version when it touches the hub, and `CHANGELOG.md`.
- [ ] Hold the review gate. C1 through C7 all change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. `gh` is not installed on this machine and `origin` CLI is absent. The owner commits on a local branch named `c/<pr-id>` and the operator pushes and merges. Record this fallback in the decision trail.
- [ ] Open the PR ready, never draft, per **Opening a PR**, once the operator pushes the branch. Until then the merge-ready report carries the branch name, head SHA, and PR body.
- [ ] Run `npm test`, `node tools/check-strings.mjs`, and `cargo test --workspace --manifest-path lanhub/Cargo.toml` once before the merge-ready report. Commit with hooks on.
- [ ] Run a deslop pass before each commit and a no-comments pass before review. Both are manual reads of the diff against `pstack/skills/no-comments/SKILL.md` and the comment rules in `C:\Users\BDT-QUY\.claude\CLAUDE.md`.
- [ ] Triage reviewer comments per `../references/bugbot-triage.md` from the pstack clone. This repo has no Bugbot. C1, C4, and C5 get one reviewer on `claude-opus-5-5` at effort `high` in a fresh context, because they touch concurrency, stored data, or authorization.
- [ ] Rebase onto current `main` before the code-ready report. Rebase again only at merge prep or on a conflict.
- [ ] Bump the version to the next 0.3.x in merge order and write the CHANGELOG entry per `docs/copy-guide.md`.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. A full swarm here is one verifier agent on `claude-opus-5-5` that runs the gates lane, the ten live lanes from the PR's **Verify, live** block in order, the perf lane, and two audit lanes that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR.
- [ ] Stop at merge-ready with a clean verdict at the exact head SHA. The operator lands the PR. A rebase that keeps the patch-id unchanged keeps the verdict, per the patch-id rule in `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on this Windows 10 machine at the PR head, in its own scratch folder under the session scratchpad.

- [ ] Run `git worktree add <scratch>/c-<pr-id> <head SHA>`, then `npm install` in the worktree.
- [ ] Run `cargo build -p lanhub-cli --release --manifest-path lanhub/Cargo.toml`. Start the hub with `lanhub/target/release/lanhub-cli --config <scratch>/lanhub.toml --port 0 --log-format json` and read the port from the `listening` line. Lanes that change hub settings start the LAN Hub app through `node tools/cdp/app.mjs` instead.
- [ ] Start three members A, B, and C through `node tools/cdp/vscode.mjs`, each with its own `--user-data-dir` and project folder, joined with one invite code. Deliver input only through `tools/cdp/` verbs. Read-only diagnostics are the hub log, each Output channel "LAN Collab", and the project folders on disk.
- [ ] Save every screenshot or log to `<scratch>/swarm-<pr-id>/worker-<n>/<slug>.<png or txt>` and return the paths with the report.

## Give each member an undo that reverts only their own edits (C1)

**Depends on.** I2.

**Files.**

- [ ] Edit `lib/editor-binding.js`.
- [ ] Create `extension/src/undo/commands.js`.
- [ ] Edit `package.json` to add keybindings for `lanCollab.undo` and `lanCollab.redo` on `ctrl+z`, `ctrl+y`, and `ctrl+shift+z` with `when` set to `editorTextFocus && lanCollab.boundEditor`.
- [ ] Create `test/conformance/undo.test.js`.
- [ ] Edit `test/vscode/suite.js`.

**Build.**

- [ ] Model the stack as data first. `UndoGroup` is `{ops, cursorBefore, cursorAfter, openedAt, lastAt}`. `EditorBinding` holds `undoStack` and `redoStack` of `UndoGroup` per bound document. A local op joins the top group when it arrives within 500 ms of `lastAt` and is adjacent to the previous op, otherwise it opens a new group.
- [ ] When a remote op arrives, transform every op in both stacks through it with the existing client transform, so each stored op stays valid against the current text. A stored op that the transform reduces to a no-op is dropped.
- [ ] `undo()` pops the top group, composes the inverses of its ops, applies the result as a local op through the normal send path, and pushes the group onto `redoStack`. `redo()` does the reverse. A new local edit clears `redoStack`.
- [ ] Set the context key `lanCollab.boundEditor` when the active editor's document has a binding. When it is unset, the native `undo` and `redo` run unchanged.
- [ ] Keep remote edits out of the user's view of history. The native undo stack still receives them, but the keybinding no longer reaches native undo while bound.

**You see.**

- [ ] Member A types `hello`, member B types `world` on the next line, member A presses Ctrl+Z. `hello` disappears on every member and `world` stays.
- [ ] Ctrl+Y on member A restores `hello` at its transformed position.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `undo.test.js` covers "A types, B types, A undoes", "A types inside B's insert, A undoes", "A deletes a range B edited, A undoes", redo after a remote op, and redo cleared by a new edit. Run `node --test test/conformance/undo.test.js`.
- [ ] `undo.test.js` runs a fuzz of 400 random steps per seed over 8 seeds with three clients that edit, undo, and redo at random. Every client, the hub memory, and the hub disk converge, and no client's undo ever removes a character another client inserted. Run it three times.
- [ ] Prove the test bites. Make `undo()` skip the transform step in a scratch edit and see "A types, B types, A undoes" fail.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run "A types, B types, A presses Ctrl+Z" at trunk and at head. Trunk lacks the feature, so record the trunk result (B's text may be removed) and gate the head behavior plus the end state where all three members hold A's removal and B's text. Save `c1-regression.png`. Pass when head removes only A's text on every member.
- [ ] Lane 2. A types three words with pauses longer than 500 ms between them, then presses Ctrl+Z three times. Save `c1-groups.png`. Pass when each press removes one word.
- [ ] Lane 3. A types a word, B deletes the line around it, A presses Ctrl+Z. Save `c1-deleted.png`. Pass when nothing changes and no error shows.
- [ ] Lane 4. A presses Ctrl+Z then Ctrl+Y while B types continuously. Save `c1-redo.png`. Pass when A's text returns and B's typing is intact.
- [ ] Lane 5. A opens a file excluded from sync and uses Ctrl+Z. Save `c1-native.png`. Pass when native undo runs.
- [ ] Lane 6. A disconnects from the hub, types, presses Ctrl+Z, reconnects. Save `c1-offline.png`. Pass when the undo result syncs after reconnect.
- [ ] Lane 7. A uses Edit, Undo from the menu instead of the keyboard. Save `c1-menu.png`. Pass when the menu path behaves the same as the keybinding.
- [ ] Lane 8. A pastes 2000 lines and presses Ctrl+Z once. Save `c1-paste.png`. Pass when the paste disappears in one step on every member.
- [ ] Lane 9. A and B both press Ctrl+Z at the same moment on edits in the same line. Save `c1-race.png`. Pass when both undos apply and all members converge.
- [ ] Lane 10. A edits with multiple cursors, then presses Ctrl+Z. Save `c1-multicursor.png`. Pass when every cursor's edit reverts in one step.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from the Ctrl+Z keypress to the editor change on the pressing member, and `ackRttP99` from `tools/loadgen.mjs` with stack transforms active.
- [ ] Probe. Measure 50 undos through `tools/cdp/vscode.mjs` with stacks of 10 and 200 groups, and run the loadgen five times at trunk and five times at head, interleaved.
- [ ] Baseline. Record the trunk native undo latency and the trunk `ackRttP99` first.
- [ ] Rule. Undo latency above 50 ms at p95 fails. A head `ackRttP99` above trunk by more than 10 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, lane 2, and lane 4 screenshots into `docs/plans/media/C1-review-own.png`, `docs/plans/media/C1-review-groups.png`, and `docs/plans/media/C1-review-redo.png`.
- [ ] Record a 30 to 60 second video of lane 1 at head with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/C1-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Show who wrote each line and list runs in the Timeline (C2)

**Depends on.** I2.

**Files.**

- [ ] Create `lanhub/crates/lanhub-core/src/history/blame.rs`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs` to add `blame_get` and `blame`.
- [ ] Edit `docs/protocol.md`.
- [ ] Create `extension/src/authorship/decorations.js`, `extension/src/authorship/hover.js`, `extension/src/authorship/timeline.js`.
- [ ] Edit `package.json` to add the command `lanCollab.toggleAuthorship` and the Timeline provider.
- [ ] Edit `extension/i18n/vi.json`.

**Build.**

- [ ] `blame(path)` walks the file's runs oldest first. For each run it diffs `start_blob` against `end_blob` by line and assigns the run id to every inserted or changed line, carrying earlier assignments through unchanged lines. The result for the current text is a list of `{lineStart, lineEnd, runId}` spans. Cache the result keyed by the newest `end_blob`.
- [ ] `blame_get {path}` answers `blame {path, spans, runs}` where `runs` holds author name, color, source, and end time for every run id in `spans`.
- [ ] `toggleAuthorship` draws a colored gutter bar and a faint line background per span in the author's color. A hover shows the author, the time, and the source, with a command link that opens the run in the history panel.
- [ ] Spans move with local edits through the binding's transform until the next `history_changed` refreshes them.
- [ ] The TimelineProvider lists runs for the active file with author and relative time. Selecting an entry opens the diff of that run with the native diff editor.

**You see.**

- [ ] After A and B edit different lines, member C toggles authorship and sees A's lines in A's color and B's lines in B's color.
- [ ] The Timeline view for the file lists one entry per run with the author name.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `blame.rs` tests cover a single run, interleaved runs on separate lines, a run that rewrites another author's line, a deletion run, and a revert run that restores lines to the reverter. Run `cargo test -p lanhub-core blame`.
- [ ] `test/conformance/blame.test.js` edits through three clients and asserts the spans the hub returns. Run `node --test test/conformance/blame.test.js`.
- [ ] `npm test` passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk lacks authorship. Record that, run the C1 lane 1 scenario at head to prove editing is unchanged, then gate the added behavior where C toggles authorship and every line carries its author's color. Save `c2-regression.png`. Pass when both hold.
- [ ] Lane 2. A writes lines 1 to 10, B rewrites line 5. C toggles authorship. Save `c2-rewrite.png`. Pass when line 5 shows B and the rest show A.
- [ ] Lane 3. C hovers line 5. Save `c2-hover.png`. Pass when the hover names B, the time, and the source, and its link opens B's run.
- [ ] Lane 4. A reverts B's run from the history panel. Save `c2-revert.png`. Pass when line 5 shows A as the author with source `revert`.
- [ ] Lane 5. Open the Timeline view for the file on member C. Save `c2-timeline.png`. Pass when it lists A's and B's runs in order.
- [ ] Lane 6. Select B's Timeline entry. Save `c2-timeline-diff.png`. Pass when the native diff shows B's change only.
- [ ] Lane 7. A types while C has authorship on. Save `c2-live.png`. Pass when the new text takes A's color within one `history_changed` round.
- [ ] Lane 8. A writes a file with a script on disk while the editor is closed. Save `c2-disk.png`. Pass when the hover shows source `disk`.
- [ ] Lane 9. Toggle authorship off. Save `c2-off.png`. Pass when every decoration disappears.
- [ ] Lane 10. Switch VS Code to a light theme with authorship on. Save `c2-light.png`. Pass when every color stays readable against the editor background.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Hub time to answer `blame_get` for a 5000-line file with 300 runs, cold and cached.
- [ ] Probe. Generate the file and its runs with a scratch script, then time 20 cold and 20 cached requests through a raw client.
- [ ] Baseline. Trunk has no blame. Record that the baseline is absent and that this is an absolute budget.
- [ ] Rule. A cold p95 above 200 ms fails. A cached p95 above 10 ms fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 3, and lane 5 screenshots into `docs/plans/media/C2-review-blame.png`, `docs/plans/media/C2-review-hover.png`, and `docs/plans/media/C2-review-timeline.png`.
- [ ] Record a 30 to 60 second video of lanes 2 and 3 with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/C2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add named checkpoints and a checkpoint before every restore (C3)

**Depends on.** C2.

**Files.**

- [ ] Edit the history module of `lanhub/crates/lanhub-core` to store checkpoints in `history.db`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs` to complete `checkpoint_create`, `checkpoint_list`, and `checkpoint_files`.
- [ ] Edit `docs/protocol.md`.
- [ ] Edit `extension/webview-src/history/` and `extension/src/views/history.js`.
- [ ] Edit `extension/i18n/vi.json`.

**Build.**

- [ ] A checkpoint is `{id, name, author, createdAt, auto, files: [{path, blob}]}`. `checkpoint_create {name}` closes every open run in the project, records each file's current blob, and broadcasts `history_changed`.
- [ ] The history panel gains a checkpoint list with name, author, and time, a "Tạo điểm khôi phục" button with a name box, and per checkpoint the actions "So sánh với hiện tại" and "Khôi phục".
- [ ] Restoring a checkpoint shows the list of changed files and a diff per file, then applies each file as a normal edit, so the restore syncs and creates runs with source `revert`.
- [ ] Before every run revert and every checkpoint restore, the client creates an automatic checkpoint named from the catalog entry `checkpoint.autoBeforeRestore` with `auto` set.
- [ ] Retention never deletes a blob that a checkpoint references. A checkpoint older than `keep_days` is deleted with its references, except checkpoints created by hand, which stay until deleted from the panel.

**You see.**

- [ ] Member A creates "Trước khi tách module". The checkpoint shows on every member's history panel.
- [ ] Reverting any run adds an automatic checkpoint above the revert.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Hub tests cover create, list, open runs closed by create, retention keeping referenced blobs, and deletion of automatic checkpoints by age. Run `cargo test -p lanhub-core checkpoint`.
- [ ] `test/conformance/checkpoint.test.js` creates a checkpoint, edits, restores through a client, and asserts every file equals the checkpoint blob on every client. Run `node --test test/conformance/checkpoint.test.js`.
- [ ] `npm test` passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run "A edits, B edits, C reverts A's run" at trunk and at head. Trunk has no checkpoints, so record that and gate the added automatic checkpoint plus the end state where B's text survives. Save `c3-regression.png`. Pass when head shows the automatic checkpoint and every member holds B's text.
- [ ] Lane 2. A creates a named checkpoint. Save `c3-create.png`. Pass when B and C see it within one second.
- [ ] Lane 3. Edit five files, then compare the checkpoint with the current state. Save `c3-compare.png`. Pass when the list shows exactly the five files.
- [ ] Lane 4. Restore the checkpoint on member B. Save `c3-restore.png`. Pass when all five files match the checkpoint on every member and the hub disk.
- [ ] Lane 5. Undo the restore by restoring the automatic checkpoint above it. Save `c3-undo-restore.png`. Pass when the five files return to their pre-restore text.
- [ ] Lane 6. Delete a file, then restore a checkpoint taken before the delete. Save `c3-deleted.png`. Pass when the file comes back on every member.
- [ ] Lane 7. Create a checkpoint while A is typing. Save `c3-typing.png`. Pass when A's run splits at the checkpoint and no keystroke is lost.
- [ ] Lane 8. Set `keep_days` to 0 in the LAN Hub app and run retention. Save `c3-retention.png`. Pass when automatic checkpoints are gone and the named one stays.
- [ ] Lane 9. Try to create a checkpoint with an empty name. Save `c3-empty.png`. Pass when the button stays disabled and the box shows the catalog hint.
- [ ] Lane 10. Restart the hub. Save `c3-restart.png`. Pass when every checkpoint is still listed.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time for `checkpoint_create` on a project of 5000 files, and `ackRttP99` from `tools/loadgen.mjs` while a checkpoint is created.
- [ ] Probe. Time ten creates on the generated project, and run the loadgen five times at trunk and five times at head with one create in the middle, interleaved.
- [ ] Baseline. Record the trunk `ackRttP99` first. Trunk has no checkpoints, so create time is an absolute budget.
- [ ] Rule. A create above 2 seconds fails. A head `ackRttP99` above trunk by more than 20 percent during the create fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 3, and lane 4 screenshots into `docs/plans/media/C3-review-create.png`, `docs/plans/media/C3-review-compare.png`, and `docs/plans/media/C3-review-restore.png`.
- [ ] Record a 30 to 60 second video of lanes 2 to 4 with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/C3-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add comment threads anchored to code ranges (C4)

**Depends on.** I2.

**Files.**

- [ ] Create `lanhub/crates/lanhub-core/src/comments/mod.rs`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs` to add `comment_thread_create`, `comment_reply`, `comment_resolve`, `comment_list`, and the broadcast `comment_changed`.
- [ ] Edit `docs/protocol.md`.
- [ ] Create `extension/src/comments/controller.js` and `extension/src/comments/inbox.js`.
- [ ] Edit `package.json` to add the inbox view and comment commands.
- [ ] Edit `extension/i18n/vi.json`.

**Build.**

- [ ] A thread is `{id, path, anchor: {start, end}, status, comments: [{id, author, ts, body}]}` stored in `history.db`. `anchor` uses UTF-16 offsets like every op.
- [ ] The project actor transforms every open anchor of a file through each applied op, in the same step that applies the op. An anchor whose range is fully deleted collapses to its start and is marked `orphaned`.
- [ ] Persist anchors on the history writer thread at run boundaries, not per op, so the op path does no disk work.
- [ ] The extension uses `vscode.comments.createCommentController`. Threads render in the editor, replies and resolve map to the protocol messages, and markdown bodies render with links disabled for `command:` URIs.
- [ ] The inbox webview view lists open threads across the project, with filters for "mentions me" and "unresolved", and opens a thread at its anchor.
- [ ] A comment that contains `@name` notifies that member through the existing mention path.

**You see.**

- [ ] Member A selects lines 3 to 5 and starts a thread. B and C see it at the same lines.
- [ ] B inserts ten lines above line 3. The thread moves to lines 13 to 15 on every member.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Hub tests cover anchor transform for insert before, insert inside, delete across the start, delete of the whole range, and persistence across restart. Run `cargo test -p lanhub-core comments`.
- [ ] `test/conformance/comments.test.js` runs the 8-seed random edit fuzz with five threads and asserts every client reports the same anchors as the hub after each step. Run `node --test test/conformance/comments.test.js`.
- [ ] `npm test` passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk lacks comments. Record that, run the I1 lane 1 convergence scenario at head to prove editing is unchanged, then gate the added behavior where a thread created on A shows on B and C at the right lines. Save `c4-regression.png`. Pass when both hold.
- [ ] Lane 2. B inserts ten lines above the thread. Save `c4-move.png`. Pass when the thread sits at lines 13 to 15 on all members.
- [ ] Lane 3. C replies, then A resolves. Save `c4-resolve.png`. Pass when every member shows the reply and the resolved state.
- [ ] Lane 4. B deletes the whole commented range. Save `c4-orphan.png`. Pass when the thread shows as orphaned at the cut point and stays in the inbox.
- [ ] Lane 5. A writes `@B` in a comment. Save `c4-mention.png`. Pass when B gets the mention notification with an action that opens the thread.
- [ ] Lane 6. Open the inbox and filter "mentions me" on B. Save `c4-inbox.png`. Pass when only threads naming B show.
- [ ] Lane 7. Restart the hub. Save `c4-restart.png`. Pass when every thread returns at its last anchor.
- [ ] Lane 8. C goes offline, A edits around the thread, C reconnects. Save `c4-offline.png`. Pass when C shows the thread at the hub's anchor.
- [ ] Lane 9. Post a comment body with a `command:` link. Save `c4-command-link.png`. Pass when the link does not run a command.
- [ ] Lane 10. Create 50 threads in one file and scroll. Save `c4-many.png`. Pass when every thread renders and the editor stays responsive.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `ackRttP99` from `tools/loadgen.mjs` on a file that holds 200 open threads, which measures the anchor transform cost on the op path.
- [ ] Probe. Run the loadgen five times at trunk without threads and five times at head with 200 threads, interleaved.
- [ ] Baseline. Record the trunk `ackRttP99` first.
- [ ] Rule. A head `ackRttP99` above trunk by more than 10 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 3, and lane 6 screenshots into `docs/plans/media/C4-review-move.png`, `docs/plans/media/C4-review-resolve.png`, and `docs/plans/media/C4-review-inbox.png`.
- [ ] Record a 30 to 60 second video of lanes 1 to 3 with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/C4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add viewer and editor roles with read-only paths (C5)

**Depends on.** I2.

**Files.**

- [ ] Edit the config module of `lanhub/crates/lanhub-core` so `allow` entries accept `{account, role}` and projects accept `readonly = ["glob"]`.
- [ ] Edit the auth module of `lanhub/crates/lanhub-core` to enforce roles on `op`, `create`, `put`, and `delete`.
- [ ] Edit `lanhub/app/ui/src/routes/project/Access.svelte`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs` to add `role` and `readonly` to `welcome`.
- [ ] Edit `docs/protocol.md`.
- [ ] Create `extension/src/roles/readonly.js`.
- [ ] Edit `extension/i18n/vi.json`.

**Build.**

- [ ] Model access as one table. `Role` is `editor` or `viewer`. A plain string entry in `allow` keeps meaning `editor`, so 0.2 configs load unchanged. `can_write(role, path)` is a pure function of the role and the `readonly` globs.
- [ ] The hub answers a write it refuses with `{t:"rejected", code:"role_denied", path}` for that message only. The connection stays open.
- [ ] `welcome` carries `role` and `readonly`. The extension sets each refused document read-only with `vscode.workspace.fs` permissions where the API allows, and otherwise reverts the local edit with the existing resync path. A status bar item and the session view state the member's role.
- [ ] Disk writes on a viewer's machine to synced files are not sent. The next sync restores the hub's version and the activity log records the attempt.
- [ ] The access screen in the LAN Hub app edits the role per entry and the read-only globs with validation.

**You see.**

- [ ] Member C, set as viewer, opens `a.py`. The editor is read-only and the status bar reads the catalog text for the viewer role.
- [ ] A editor member gets a read-only editor on a path matching `readonly`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `can_write` table tests cover every role and glob combination, plus a 0.2 config with plain strings. Run `cargo test -p lanhub-core auth`.
- [ ] `test/conformance/roles.test.js` sends `op`, `create`, `put`, and `delete` as a viewer and asserts each gets `role_denied` and changes nothing on disk. Run `node --test test/conformance/roles.test.js`.
- [ ] `npm test` passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Load a 0.2 `lanhub.toml` with plain allow entries at trunk and at head and run the three-member edit scenario. Trunk lacks roles, so gate the added behavior on a viewer member plus the end state where editors converge. Save `c5-regression.png`. Pass when editors converge at both and head blocks the viewer.
- [ ] Lane 2. Set C as viewer in the LAN Hub app access screen. Save `c5-app.png`. Pass when the change applies without a hub restart and C's editor turns read-only.
- [ ] Lane 3. C tries to type in `a.py`. Save `c5-type.png`. Pass when no text changes on any member and C sees why.
- [ ] Lane 4. A script on C's machine writes `a.py` on disk. Save `c5-disk.png`. Pass when the hub keeps its text and C's file is restored after sync.
- [ ] Lane 5. Add `readonly = ["docs/**"]`. A opens `docs/x.md`. Save `c5-glob.png`. Pass when A's editor is read-only for that file only.
- [ ] Lane 6. C follows A and opens every file A opens. Save `c5-follow.png`. Pass when follow mode works for the viewer.
- [ ] Lane 7. C sends a chat message and starts a comment thread. Save `c5-chat.png`. Pass when both work for the viewer.
- [ ] Lane 8. Change C back to editor. Save `c5-promote.png`. Pass when C can type without reconnecting.
- [ ] Lane 9. Enter an invalid glob in the access screen. Save `c5-invalid.png`. Pass when the screen refuses it with the catalog message and the config file is unchanged.
- [ ] Lane 10. C runs the connection diagnostics. Save `c5-diag.png`. Pass when the report shows the viewer role as information, not as a failure.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `ackRttP99` from `tools/loadgen.mjs` with 20 `readonly` globs configured, which measures the role check on the op path.
- [ ] Probe. Run the loadgen five times at trunk and five times at head, interleaved.
- [ ] Baseline. Record the trunk `ackRttP99` first.
- [ ] Rule. A head `ackRttP99` above trunk by more than 5 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 3, and lane 5 screenshots into `docs/plans/media/C5-review-app.png`, `docs/plans/media/C5-review-viewer.png`, and `docs/plans/media/C5-review-glob.png`.
- [ ] Record a 30 to 60 second video of lanes 2 and 3 with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/C5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Detect diverged workspaces across members (C6)

**Depends on.** I2.

**Files.**

- [ ] Create `extension/src/drift/git-state.js` and `extension/src/drift/check.js`.
- [ ] Edit `extension/webview-src/session/`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs` to add `workspace` to presence.
- [ ] Edit `docs/protocol.md`.
- [ ] Edit the presence relay in `lanhub/crates/lanhub-core`.
- [ ] Edit `extension/i18n/vi.json`.

**Build.**

- [ ] `git-state.js` reads `{branch, head, dirty}` through the built-in `vscode.git` extension API, with no shell call. It reports on join and when the repository state changes, debounced by 1 second.
- [ ] Presence carries `workspace`. The hub relays it unchanged and includes it in `welcome.users`.
- [ ] `check.js` compares each member's branch and HEAD with the local ones. A different branch raises a warning with the actions "Mở bảng phiên làm việc" and "Bỏ qua cho nhánh này". A different HEAD on the same branch is shown in the session view without a warning.
- [ ] The session view gains a "Trạng thái đồng bộ" section that lists files whose local hash differs from the hub manifest, with an action that runs a resync of that file.

**You see.**

- [ ] Member B checks out another branch. A and C get one warning naming B and the branch.
- [ ] The session view shows B's branch in the warning color.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/drift.test.js` covers the comparison table for same branch, different branch, detached HEAD, missing git, and dismissal per branch. Run `node test/drift.test.js`.
- [ ] `test/conformance/protocol-v2.test.js` gains a case that `workspace` in presence reaches other clients and `welcome.users`. Run `node --test test/conformance/protocol-v2.test.js`.
- [ ] `npm test` passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run "B runs git checkout of another branch" at trunk and at head. Trunk lacks the check, so record that nobody is told, then gate the head warning plus the end state where every member's files still match the hub. Save `c6-regression.png`. Pass when head warns A and C once.
- [ ] Lane 2. Open the session view on A. Save `c6-session.png`. Pass when B's branch and HEAD show with the warning color.
- [ ] Lane 3. B commits on the same branch as A. Save `c6-head.png`. Pass when the session view shows the HEAD difference and no warning appears.
- [ ] Lane 4. A dismisses the warning for that branch, then B switches away and back. Save `c6-dismiss.png`. Pass when no second warning appears for the same branch.
- [ ] Lane 5. C opens a project folder without git. Save `c6-nogit.png`. Pass when C's row shows that no repository was found and no warning fires.
- [ ] Lane 6. Edit a file on C's disk while C is offline, then reconnect. Save `c6-filestate.png`. Pass when the file appears in "Trạng thái đồng bộ" until the merge completes.
- [ ] Lane 7. Run the resync action on a listed file. Save `c6-resync.png`. Pass when the file leaves the list and matches the hub.
- [ ] Lane 8. B detaches HEAD. Save `c6-detached.png`. Pass when B's row shows the short SHA instead of a branch name.
- [ ] Lane 9. B makes 30 changes in quick succession through git. Save `c6-debounce.txt`. Pass when the hub log shows at most one presence update per second from B.
- [ ] Lane 10. Run the connection diagnostics on A. Save `c6-diag.png`. Pass when the report lists members whose branch differs.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Extension host CPU time spent in `git-state.js` during a 1000-file checkout, and presence messages per second per member.
- [ ] Probe. Profile the extension host with `--inspect-extensions` during the checkout at head, and count presence messages in the hub log at trunk and head, interleaved over five runs.
- [ ] Baseline. Record the trunk presence rate first. Trunk has no git reads, so CPU time is an absolute budget.
- [ ] Rule. CPU time above 100 ms fails. A presence rate above trunk plus one message per second fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, lane 2, and lane 6 screenshots into `docs/plans/media/C6-review-warning.png`, `docs/plans/media/C6-review-session.png`, and `docs/plans/media/C6-review-filestate.png`.
- [ ] Record a 30 to 60 second video of lanes 1 and 2 with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/C6-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add summon, Explorer badges, and per-member connection state (C7)

**Depends on.** I2.

**Files.**

- [ ] Create `extension/src/presence/summon.js` and `extension/src/presence/explorer-badges.js`.
- [ ] Edit `extension/webview-src/session/`.
- [ ] Edit `lanhub/crates/lanhub-protocol/src/messages.rs` to add `summon` and `connection` to presence.
- [ ] Edit `docs/protocol.md`.
- [ ] Edit the presence relay in `lanhub/crates/lanhub-core`.
- [ ] Edit `package.json` to add the command `lanCollab.summon`.
- [ ] Edit `extension/i18n/vi.json`.

**Build.**

- [ ] `lanCollab.summon` sends `summon {path, line}` to every member. Each receiver gets a notification naming the sender and the file, with the actions "Đi theo" and "Mở vị trí". Nobody's editor moves without a click.
- [ ] `explorer-badges.js` registers a `FileDecorationProvider` that marks files other members have open with the first letter of each name and a tooltip listing them. It refreshes from presence events, debounced by 200 ms.
- [ ] Presence carries `connection` with the values `live`, `reconnecting`, and `offline_editing`, taken from the B3 connection machine. The hub keeps the last value for 60 seconds after a disconnect so others see `reconnecting` instead of a silent removal.
- [ ] The session view shows each member's connection state with a status dot and the catalog text.

**You see.**

- [ ] Member A runs summon on line 40. B and C get a notification and "Đi theo" puts them on line 40 following A.
- [ ] The Explorer shows letters on files B and C have open.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/conformance/protocol-v2.test.js` gains cases for `summon` delivery and for the 60-second `reconnecting` state after a socket drop. Run `node --test test/conformance/protocol-v2.test.js`.
- [ ] `test/presence.test.js` covers badge text for one, two, and five members on a file. Run `node test/presence.test.js`.
- [ ] `npm test` passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run "B follows A through the follow command" at trunk and at head to prove follow is unchanged. Trunk lacks summon, so gate the added summon flow plus the end state where B follows A. Save `c7-regression.png`. Pass when follow works at both and summon works at head.
- [ ] Lane 2. A summons from line 40. Save `c7-summon.png`. Pass when B and C get the notification and nobody's editor moves.
- [ ] Lane 3. B clicks "Đi theo". Save `c7-follow.png`. Pass when B shows `a.py` at line 40 and follows A's next move.
- [ ] Lane 4. C clicks "Mở vị trí". Save `c7-open.png`. Pass when C opens line 40 and does not follow.
- [ ] Lane 5. B and C open `a.py` and `b.py`. Save `c7-badges.png`. Pass when A's Explorer marks both files with the right letters and tooltip names.
- [ ] Lane 6. B closes `a.py`. Save `c7-badge-clear.png`. Pass when A's badge for B on `a.py` disappears within one second.
- [ ] Lane 7. Pull B's network cable or disable B's adapter for 20 seconds. Save `c7-reconnecting.png`. Pass when A's session view shows B as reconnecting and then live again.
- [ ] Lane 8. B edits while disconnected. Save `c7-offline.png`. Pass when A's session view shows B as offline editing after B's machine reports it on reconnect.
- [ ] Lane 9. Keep B disconnected for 90 seconds. Save `c7-left.png`. Pass when B leaves A's member list after 60 seconds.
- [ ] Lane 10. Open 30 files on B and C. Save `c7-many.png`. Pass when every badge shows and the Explorer stays responsive.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Extension host time per presence event spent in badge refresh with 20 members and 200 open files, and `fanoutP99` from `tools/loadgen.mjs` with presence traffic.
- [ ] Probe. Replay 1000 presence events into the provider at head, and run the loadgen five times at trunk and five times at head, interleaved.
- [ ] Baseline. Record the trunk `fanoutP99` first. Trunk has no badges, so refresh time is an absolute budget.
- [ ] Rule. A refresh above 5 ms at p95 fails. A head `fanoutP99` above trunk by more than 10 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 5, and lane 7 screenshots into `docs/plans/media/C7-review-summon.png`, `docs/plans/media/C7-review-badges.png`, and `docs/plans/media/C7-review-state.png`.
- [ ] Record a 30 to 60 second video of lanes 2 and 3 with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/C7-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Every C PR shipped its 0.3.x CHANGELOG entry and version bump.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

No prototype ran during planning. These questions stay unproven, and each owner settles its own first with a throwaway sketch per `playbooks/prototype.md`.

- C1. Whether a keybinding with `when` set to `lanCollab.boundEditor` wins over the native `undo` binding in every editor, including the diff editor and notebooks. The sketch registers the binding and presses Ctrl+Z in each editor type.
- C1. Whether Edit, Undo from the menu routes through the keybinding or calls native undo directly. Lane 7 depends on the answer. If the menu bypasses it, the owner contributes a menu override for `editor/context` and records the gap for the title-bar menu.
- C4. Whether the VS Code Comments API renders threads on a read-only document, which C5 viewers need.
- C5. Whether VS Code exposes a per-document read-only flag to extensions in the pinned engine version. If it does not, C5 uses the revert path and says so in the review.
- C6. Whether the built-in `vscode.git` API reports branch changes made by an external `git checkout` without a window focus event.

## Appendix B. Alternatives rejected

- C1. Classic OT selective undo for arbitrary past groups. Cherif and Imine (arXiv 1512.07684, 2015) report that several published selective-undo algorithms diverge. C1 undoes only the top of the member's own stack, transformed through later remote ops, which the existing transform already proves convergent.
- C1. Keeping native undo and filtering remote edits out of its stack. VS Code offers no API to apply an edit outside the undo stack, and the y-prosemirror report shows that mixing an editor's own history with a shared document makes "A types, B types, A undoes" misbehave.
- C1. Positional reverse edits computed at undo time without transform. Yorkie issue 652 rejected this because positions shift after syncing with peers.
- C2. Storing an op log for blame. Run blobs already give per-line authorship by line diff, as README section 5.6 decided.
- C2. Grouping Timeline entries by save with a merge window like VS Code Local History (`workbench.localHistory.mergeWindow`, 10 seconds). Runs already group by author, which is the unit members ask about.
- C3. Checkpoints that store their own copy of every file. Content-addressed blobs make a checkpoint a list of references.
- C4. Anchors stored as line numbers. Lines shift with every insert above. UTF-16 ranges transformed by the hub match how cursors already move.
- C5. Enforcing roles only in the extension. A modified client could still write. The hub is the boundary.
- C7. Moving members' editors on summon without consent. It takes control of another person's screen, which the survey rejected for Tuple-style remote control.

## Appendix C. Risks

- C1. Undo becomes wrong silently if a remote op path forgets to transform the stacks. The fuzz in `undo.test.js` asserts that no undo removes another client's insert, and the owner runs it three times.
- C1. Users with custom undo keybindings keep their binding, which may bypass `lanCollab.undo`. The CHANGELOG and the session view state the command id to rebind.
- C2. Blame cost grows with run count on hot files. The cache and the perf rule guard it, and retention bounds run count.
- C3. Restoring a checkpoint while others type creates many runs at once. Lane 7 and the automatic pre-restore checkpoint limit the damage.
- C4. Anchor persistence lags the op stream until the next run boundary, so a hub crash can lose the last anchor moves. The anchors are recomputable from the run blobs and the owner documents that recovery.
- C5. A viewer's local disk drifts from the hub when tools write files. The sync restores it, and lane 4 proves it.
- C6. Git state reveals branch names to every member. That is expected inside one team and is stated in the CHANGELOG.
- C7. Presence traffic grows with badges and connection state. The perf rule on `fanoutP99` guards it.

## Appendix D. Links and reading list

- `docs/plans/README.md` section 6 for the feature selection and section 5.6 for the run model.
- Zed per-participant undo, `https://zed.dev/blog/crdts`.
- Cherif and Imine 2015, `https://arxiv.org/abs/1512.07684`.
- Yorkie issue 652, `https://github.com/yorkie-team/yorkie/issues/652`.
- y-prosemirror undo failure, `https://discuss.yjs.dev/t/avoiding-y-prosemirror-undo/985`.
- VS Code Local History merge window, `https://code.visualstudio.com/updates/v1_66`.
- Replit inline threads, `https://docs.replit.com/replit-workspace/workspace-features/inline-threads`.
- Live Share focus and follow, `https://learn.microsoft.com/en-au/visualstudio/liveshare/use/coedit-follow-focus-visual-studio-code`.
- C1 and C4 get `pstack/skills/how/SKILL.md` before design and `pstack/skills/interrogate/SKILL.md` on the finished design.
- The decision trail follows `pstack/skills/show-me-your-work/SKILL.md` and lives at `docs/plans/trail/C.tsv`.
