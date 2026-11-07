# B extension plan

Branch B turns LAN Collab into extension 0.2 on `upgrade/extension`, in parallel with the hub branch. Members get a connection flow that diagnoses and repairs itself and tells them exactly what to do when it cannot, webviews built on the shared UI kit, captions from one catalog in neutral professional Vietnamese, and a history panel that opens, compares, copies, and reverts one member's edit run. The rule the branch enforces is that no connection state lacks an exit and no visible string lives outside `extension/i18n/vi.json`. Decisions live in `docs/plans/README.md` sections 5.3, 5.6, 5.7, and 5.8. PR ids in order are B1, B2, B3, B4, B5, B6, B7, B8, B9.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator merges every PR into `upgrade/extension`. Agents build, verify, and stop at merge-ready. B1 through B9 are all operator items that stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Confirm that P0-1 through P0-4 are on `main` and that `upgrade/extension` starts from the `main` SHA that holds P0-4.
- [ ] Read these from the pinned pstack clone at program start. Re-read them at every tick. The clone is `cursor/plugins` at `C:\Users\BDT-QUY\src\cursor-plugins`, checked out at `6b03002` and never fetched, so `origin/main` stays at `6b03002`. Each read is `git show origin/main:<path>` run inside the clone, written below with `git -C`.
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-model-the-domain/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-experience-first/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-prove-it-works/SKILL.md`
  - [ ] Read `tools/cdp/README.md` on `upgrade/extension`. It replaces the `control-ui` skill for this repo.
  - [ ] Read `docs/copy-guide.md` and `docs/protocol.md` on `upgrade/extension`.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `claude-opus-5-5` at effort `medium`. The B3, B4, B7, and B8 owners run at effort `high` because they change sync state, secret storage, or concurrent editor writes.
- [ ] Follow this dependency graph. Base each PR on its parent branch when the parent is not merged yet, as the execution playbook stacks.
  - [ ] B1 is first. It branches from `upgrade/extension`.
  - [ ] B2 after B1.
  - [ ] B3 after B1. B2 and B3 are independent of each other.
  - [ ] B4 after B3.
  - [ ] B5 after B4 and B2.
  - [ ] B6 after B2 and B3.
  - [ ] B7 after B6 and after A5 lands on `upgrade/hub`. B7 depends on A5 only through the `lanhub-cli` binary, never through code. The B7 owner records the `upgrade/hub` SHA it built.
  - [ ] B8 after B3 and B2.
  - [ ] B9 after B5, B6, and B7, because its menu has a history group.
- [ ] Hold the file boundaries. Branch B touches only `extension/**`, `lib/**`, `package.json`, `test/**`, `tools/check-strings.mjs`, and `docs/plans/trail/B.tsv`. Shared files (`packages/ui-kit/**`, `test/support/**`, `test/conformance/**`, `tools/loadgen.mjs`, `package.json` scripts) follow the additive rule in README section 3 and are listed in the PR body, so I1 can see them.
  - [ ] B1 touches only `extension/**`, `lib/client-core.js` (rendering table only), `package.json` contributes, `test/**` pinned strings, and `tools/check-strings.mjs`.
  - [ ] B2 touches only `extension/webview-src/**`, `extension/src/views/chat.js`, `extension/chat-view.js` (delete), `extension/webview/**`, `package.json` scripts, `.vscodeignore`.
  - [ ] B3 touches only `lib/connection-machine.js`, `lib/client-core.js`, `extension/extension.js` (delete after the split), `extension/src/**`, `test/connection-machine.test.js`.
  - [ ] B4 touches only `lib/diagnostics.js`, `lib/client-core.js`, `lib/common.js` (address helpers only), `extension/src/connection/**`, `test/diagnostics.test.js`, `test/secrets.test.js`, `test/report.test.js`, `package.json`.
  - [ ] B5, B6, B7, B8 touch only their own view folders under `extension/src/views/` and `extension/webview-src/`, plus the `lib/` module each names.
  - [ ] B9 touches only `extension/src/**` and `package.json` contributes.
- [ ] Hold the review gate. B1 through B9 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. `gh` is not installed on this machine and `origin` CLI is absent. The owner commits on a local branch named `b/<pr-id>` and the operator pushes and merges. Record this fallback in the decision trail.
- [ ] Open the PR ready, never draft, per **Opening a PR**, once the operator pushes the branch. The PR targets `upgrade/extension`, or its parent branch when stacked. Until then the merge-ready report carries the branch name, head SHA, and PR body.
- [ ] Run `npm test` and `npm run test:vscode` once before the merge-ready report. Commit with hooks on.
- [ ] Run a deslop pass before each commit and a no-comments pass before review. Both are manual reads of the diff against `pstack/skills/no-comments/SKILL.md` and the comment rules in `C:\Users\BDT-QUY\.claude\CLAUDE.md`.
- [ ] Triage reviewer comments per `../references/bugbot-triage.md` from the pstack clone. This repo has no Bugbot. B3, B4, B7, and B8 each get one reviewer on `claude-opus-5-5` at effort `high` in a fresh context. Other PRs get a self-review of the diff.
- [ ] Rebase onto current `upgrade/extension` before the code-ready report. Rebase again only at merge prep or on a conflict.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. A full swarm here is one verifier agent on `claude-opus-5-5` that runs the gates lane, the ten live lanes from the PR's **Verify, live** block in order, the perf lane, and two audit lanes that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR.
- [ ] Stop at merge-ready with a clean verdict at the exact head SHA and the operator's review done. The operator lands the PR. A rebase that keeps the patch-id unchanged keeps the verdict, per the patch-id rule in `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on this Windows 10 machine at the PR head, in its own scratch folder under the session scratchpad.

- [ ] Run `git worktree add <scratch>/b-<pr-id> <head SHA>`, then `npm install` and `npm run build:webviews` in the worktree once B2 lands.
- [ ] Start the hub with `node hub/hub.js --root <scratch>/root --port 0 --log-format json --project Demo --token tk` and read the port from the `listening` line. The hub speaks proto 2 after P0-2. B7 lanes start `lanhub-cli` built from `upgrade/hub` at the SHA the PR records, with the same flags.
- [ ] Start each member as one VS Code instance through `node tools/cdp/vscode.mjs` with its own `--user-data-dir` and its own client folder. Deliver input only through the `tools/cdp/` verbs and `runCommand` with `lanCollab.*` ids. Read-only diagnostics are the `LAN Collab` output channel, the hub stdout, and the files on disk.
- [ ] Simulate network faults without touching the system firewall. Stop the hub process for "hub down". Start the hub with `--host 127.0.0.1` and connect through the machine's LAN address for "port blocked". Use an unused port for "refused". Use a non-routed address in `192.0.2.0/24` for "timeout".
- [ ] Save every screenshot or log to `<scratch>/swarm-<pr-id>/worker-<n>/<slug>.<png or txt>` and return the paths with the report.

## Move every caption into one catalog and rewrite it (B1)

**Depends on.** None.

**Files.**

- [ ] Create `extension/i18n/vi.json`.
- [ ] Create `lib/i18n.js` with `t(id, args)`.
- [ ] Create `tools/check-strings.mjs`.
- [ ] Edit `extension/extension.js`, `extension/chat-view.js`, `extension/webview/chat.js`, `lib/client-core.js`, `lib/editor-binding.js`.
- [ ] Edit `package.json` contributes (command titles, view names, setting descriptions) and the `test` script.
- [ ] Edit `test/conformance/exclude.test.js` and `test/conformance/chat.test.js`, which pin `loại trừ` and `Hub đang chạy bản cũ`.
- [ ] Edit `test/vscode/suite.js` and `test/vscode/join-suite.js` where they assert visible text.

**Build.**

- [ ] `vi.json` is a flat map from a dotted id (`connect.error.refused`, `activity.edit`, `chat.composer.placeholder`) to a string with `{name}` placeholders. One file serves the host and every webview. The host posts the catalog to a webview in its `init` message.
- [ ] `t(id, args)` substitutes placeholders and throws in tests when an id is missing, so a typo fails `npm test` instead of showing an id to a member.
- [ ] Rewrite each of the roughly 180 strings from the client survey per `docs/copy-guide.md`. Use the glossary terms LAN Hub, dự án, thành viên, mã mời, đồng bộ, bản trên hub, bản trên máy này, lượt chỉnh sửa, điểm khôi phục, chẩn đoán kết nối. Drop "phòng", "đồng đội", the `LAN Collab:` toast prefix, setting ids, raw `e.message` text, and the `[LỖI]` and `[CẢNH BÁO]` tags from every notification.
- [ ] Replace the P0-2 `renderHubMessage(code, data)` table in `lib/client-core.js` with catalog ids `error.<code>` and `activity.<kind>`. Activity text is rendered on the client from structured activity.
- [ ] Output channel lines stay technical and are not in the catalog. `tools/check-strings.mjs` treats `log()` arguments as exempt.
- [ ] `tools/check-strings.mjs` scans `extension/**`, `lib/**`, and `package.json` and fails on any string literal with Vietnamese letters outside `extension/i18n/vi.json`, `log()` calls, and comments. `npm test` runs it first.
- [ ] Update `package.json` contributes to the catalog wording. The manifest cannot read `vi.json`, so `check-strings.mjs` also checks that each command title equals its catalog entry `command.<id>.title`.

**You see.**

- [ ] With the hub stopped, `lanCollab.connect` shows the status bar tooltip `Không kết nối được LAN Hub. Đang thử lại.` instead of the 0.1.1 text about merging when the network returns.
- [ ] A wrong token shows `Token không hợp lệ cho dự án "Demo".` with no `lanCollab.token` text. B1 adds no new buttons. The action lists arrive in B3.
- [ ] The view that was named `Đồng đội` is named `Thành viên`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `node tools/check-strings.mjs` exits 0. Add a Vietnamese literal to `extension/extension.js` in a scratch edit and see it exit 1 with the file and line.
- [ ] `test/i18n.test.js` asserts that every `t()` id used in `extension/**` and `lib/**` exists in `vi.json`, that no catalog entry is unused, and that placeholders in each entry match the arguments at each call site. Run `node test/i18n.test.js`.
- [ ] `npm test` passes with the updated pinned strings.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Connect two members, edit one file from both, and send one chat message, at trunk and at head. Save `b1-regression.png`. Pass when both runs converge and the head screenshot shows only catalog wording.
- [ ] Lane 2. Stop the hub, then run `lanCollab.connect`. Save `b1-hub-down.png`. Pass when the status bar tooltip reads `Không kết nối được LAN Hub. Đang thử lại.`
- [ ] Lane 3. Connect with token `wrong`. Save `b1-token.png`. Pass when the notification reads `Token không hợp lệ cho dự án "Demo".` and shows no setting id.
- [ ] Lane 4. Connect with project `Other`. Save `b1-project.png`. Pass when the notification names both `Other` and `Demo`.
- [ ] Lane 5. Start the hub with an allow file that lists only `github:alice` and connect as another account. Save `b1-account.png`. Pass when the notification names the account and the line to add, and its one existing button reads `Đổi tài khoản` instead of `Dùng tài khoản VS Code`.
- [ ] Lane 6. Edit, create, and delete a file on member 1. Save `b1-activity.png`. Pass when member 2 sees the activity lines rendered from the catalog, such as `đã sửa a.py`.
- [ ] Lane 7. Open the chat view and the command palette filtered to `LAN Collab`. Save `b1-palette.png`. Pass when every title matches `vi.json` and none says "phòng".
- [ ] Lane 8. Open Settings filtered to `lanCollab`. Save `b1-settings.png`. Pass when every description uses the glossary terms.
- [ ] Lane 9. Paste an invalid invite through `lanCollab.join`. Save `b1-invite.png`. Pass when the validation text says why the code is invalid instead of `Mã không hợp lệ`.
- [ ] Lane 10. Read the `LAN Collab` output channel after lanes 2 to 6. Save `b1-log.txt`. Pass when technical detail such as `ECONNREFUSED` appears there and in no notification.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Extension activation time from `onStartupFinished` to `activate()` return, which now loads the catalog.
- [ ] Probe. Read `Developer: Show Running Extensions` activation time for LAN Collab five times at trunk and five times at head, interleaved, through `tools/cdp/vscode.mjs`.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. A head median above trunk median plus 20 ms fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 5, and 7 screenshots into `docs/plans/media/b1-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of lanes 2 to 6 with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b1-review.mp4`.
- [ ] Post the screenshots, the video, and the before and after string table in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Rebuild the webviews on Svelte and the UI kit, starting with chat (B2)

**Depends on.** B1.

**Files.**

- [ ] Create `extension/webview-src/vite.config.ts`, `extension/webview-src/shared/` (host bridge, catalog store, CSP-safe mount), and `extension/webview-src/chat/`.
- [ ] Create `extension/src/views/chat.js` and `extension/src/views/webview-host.js`.
- [ ] Delete `extension/chat-view.js`, `extension/webview/chat.js`, `extension/webview/chat.css`.
- [ ] Edit `package.json` scripts (`build:webviews`, `vscode:prepublish`) and `.vscodeignore` (ship `extension/webview/dist/`, exclude `extension/webview-src/`).

**Build.**

- [ ] `webview-host.js` builds the HTML for any view with a fresh nonce, the CSP `default-src 'none'; img-src data: ${cspSource}; style-src ${cspSource}; script-src 'nonce-...'`, the UI kit CSS, and `theme-vscode.css`. Every later webview uses it.
- [ ] Vite builds one entry per view into `extension/webview/dist/<view>/` with hashed file names off, so the host references fixed paths.
- [ ] Port chat to Svelte 5 with the same host message protocol (`ready`, `send`, `location`, `open`, `media`, `openImage`, `openUrl` in, `init`, `people`, `msg`, `sendResult`, `insert`, `notice`, `media` out). Keep every 0.1.1 feature. Grouping, day dividers, code and link formatting, `file:line` links, mentions, image paste and drop and pick with resize, emoji picker with recent tab, jump to latest, draft persistence, people strip, and unread badge all stay.
- [ ] Keep the security rules. Remote text goes into the DOM as text only, `openUrl` accepts only `http` and `https`, and image ids match `/^[0-9a-f]{40}$/`.
- [ ] Use UI kit components for the composer, buttons, tooltips, popups, and the message list (VirtualList), with custom scrollbars from `base.css`.

**You see.**

- [ ] The chat view renders with the UI kit look in the current VS Code theme and switches theme live without a reload.
- [ ] `npm run package` produces a `.vsix` that contains `extension/webview/dist/chat/` and no `webview-src` file.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `extension/webview-src/chat/format.test.ts` covers code spans, fenced blocks, URLs, `file:line`, mentions, and emoji-only messages, ported from the 0.1.1 formatter cases. Run `npx vitest run extension/webview-src`.
- [ ] `npx svelte-check --workspace extension/webview-src` reports 0 errors.
- [ ] `npm test` and `npm run test:vscode` pass. The chat assertions in `test/vscode/suite.js` still pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Send text, a mention, a `file:line` reference, and an image between two members at trunk and at head. Save `b2-regression.png`. Pass when all four render and work at head as they do at trunk.
- [ ] Lane 2. Paste a 3 MB PNG with Ctrl+V. Save `b2-image.png`. Pass when the image is resized below 1.5 MB, sent, and shown to member 2.
- [ ] Lane 3. Type `@` and pick a member. Save `b2-mention.png`. Pass when member 2 gets the mention badge and toast.
- [ ] Lane 4. Click a `file:line` link. Save `b2-link.png`. Pass when the editor opens that file at that line.
- [ ] Lane 5. Load 500 messages of history and scroll to the top. Save `b2-scroll.png`. Pass when the custom scrollbar shows and the DOM holds fewer than 80 message rows.
- [ ] Lane 6. Switch VS Code to Light, Dark, and High Contrast. Save `b2-themes.png`. Pass when the chat follows each theme and every control in High Contrast has a visible border.
- [ ] Lane 7. Send `<img src=x onerror=alert(1)>` as text. Save `b2-xss.png`. Pass when it shows as literal text and the console has no CSP violation from extension code.
- [ ] Lane 8. Type a draft, hide and reopen the view, then reload the window. Save `b2-draft.png`. Pass when the draft survives both.
- [ ] Lane 9. Stop the hub with the chat open. Save `b2-offline.png`. Pass when the header shows the disconnected state from the catalog and the send button is disabled with a tooltip that says why.
- [ ] Lane 10. Use the chat with the keyboard only (Tab, Enter, Shift+Enter, Escape on popups). Save `b2-keyboard.png`. Pass when every action works and the focus ring is visible.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from the `init` message to the first painted frame with 500 messages, and the gzipped size of the chat bundle.
- [ ] Probe. Post `init` with a fixed 500-message fixture and read `performance.now()` marks through CDP, five times at trunk and five times at head, interleaved. Read bundle sizes from `vite build` output.
- [ ] Baseline. Record the trunk median render time and the trunk `chat.js` plus `chat.css` gzipped size first.
- [ ] Rule. Head render above 150 ms fails, and head render above trunk median plus 30 ms fails. Chat bundle above 80 KB gzipped fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 5, and 6 screenshots into `docs/plans/media/b2-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of a chat session between two members with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Replace the connection booleans with one state machine (B3)

**Depends on.** B1.

**Files.**

- [ ] Create `lib/connection-machine.js`.
- [ ] Create `test/connection-machine.test.js`.
- [ ] Create `extension/src/activate.js`, `extension/src/connection/controller.js`, `extension/src/status-bar.js`, `extension/src/commands.js`, `extension/src/decorations.js`, `extension/src/follow.js`, `extension/src/config.js`.
- [ ] Delete `extension/extension.js` after its code moves. Point `package.json` `main` at `./extension/src/activate.js`.
- [ ] Edit `lib/client-core.js` to emit machine events instead of `status` strings.

**Build.**

- [ ] `connection-machine.js` exports `initial`, `transition(state, event)`, and `STATES`. States are `idle`, `resolving`, `connecting`, `handshaking`, `syncing`, `live`, `reconnecting`, `needs_action`, `stopped`. A `needs_action` state always carries `{code, data, actions}`. `transition` is pure and returns the same state for an event that does not apply.
- [ ] The machine owns the facts that 0.1.1 spread over `core`, `connecting`, `lastState`, `closed`, `ready`, `queue`, and `retryTimer`. The controller is the only writer. The status bar, the menu, the people view, and the chat header read the state through one `onDidChange` event.
- [ ] Fix the cancelled sync dialog. Cancel moves to `stopped`, disposes the core and the tick timer, and lets `lanCollab.connect` start again (fragile behavior 2 kept, because `stopped` never auto-retries).
- [ ] `lanCollab.connect` during `connecting` or `handshaking` focuses the status instead of showing a second toast. `lanCollab.join` checks the machine instead of `core` only.
- [ ] A first connection that never reached `live` shows `connect.firstAttempt` text. Only a session that was `live` shows the reconnecting text that mentions offline edits.
- [ ] Hub errors move to `needs_action` with an action list per code instead of a toast followed by `disconnect()`. The `queue` gate between `welcome` and `live` stays as it is (fragile behavior 1).
- [ ] `lanCollab.autoSave`, `lanCollab.exclude`, and `lanCollab.name` apply on `onDidChangeConfiguration` without a reconnect. Server, project, and token changes move to `needs_action` with the action `Kết nối lại`.

**You see.**

- [ ] Cancel the first-sync dialog, then run `lanCollab.connect`. The connection starts again with no manual disconnect.
- [ ] The status bar never flickers between `connecting` and `offline` during retries. It shows `reconnecting` with the next attempt time in the tooltip.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/connection-machine.test.js` is table-driven over every pair of state and event. It asserts the next state for each pair, that every `needs_action` carries a code and at least one action, and that `stopped` is reached only by explicit user events. Run `node test/connection-machine.test.js`.
- [ ] Break the machine on purpose in a scratch edit (drop the actions from `token_invalid`) and see the test fail.
- [ ] `npm test` and `npm run test:vscode` pass. `activate()` still returns `{core}` for the VS Code suites.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Cancel the first-sync dialog, then run `lanCollab.connect`, at trunk and at head. Save `b3-regression.png`. Pass when trunk answers that it is already connecting and head starts a new connection.
- [ ] Lane 2. Connect two members, edit, stop the hub, edit offline, start the hub. Save `b3-offline.png`. Pass when the state goes `live`, `reconnecting`, `syncing`, `live` and both members converge.
- [ ] Lane 3. Start a member with the hub stopped and never start it. Save `b3-first.png`. Pass when the tooltip shows the first-attempt text and does not mention merging offline edits.
- [ ] Lane 4. Run `lanCollab.connect` five times quickly. Save `b3-repeat.png`. Pass when one connection exists in the hub log and no duplicate toast appears.
- [ ] Lane 5. Connect with a wrong token. Save `b3-token.png`. Pass when the state is `needs_action` with code `token_invalid` and the status bar offers the actions from the machine.
- [ ] Lane 6. Change `lanCollab.exclude` while `live`. Save `b3-exclude.png`. Pass when the new pattern applies without a reconnect in the hub log.
- [ ] Lane 7. Change `lanCollab.server` while `live`. Save `b3-server.png`. Pass when the state is `needs_action` with the action `Kết nối lại`.
- [ ] Lane 8. Kill VS Code with `taskkill /F` during `syncing`, then start it again. Save `b3-kill.png`. Pass when the member reaches `live` and the hub has no duplicate member.
- [ ] Lane 9. Follow member 2, then stop member 2. Save `b3-follow.png`. Pass when follow clears and the status bar drops the follow text.
- [ ] Lane 10. Run `lanCollab.disconnect` during `reconnecting`. Save `b3-disconnect.png`. Pass when the state is `stopped`, no retry runs for 60 seconds, and no timer is left in the extension host per a CDP heap check.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from the hub's `welcome` to the status bar showing `live`, and op round trip seen by the extension.
- [ ] Probe. Connect and disconnect ten times at trunk and ten times at head, interleaved, reading timestamps from the output channel. Run `tools/loadgen.mjs` with one VS Code member attached.
- [ ] Baseline. Record the trunk medians first.
- [ ] Rule. A head median above trunk median by more than 10 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 2, and 5 screenshots into `docs/plans/media/b3-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of lane 2 with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b3-review.mp4`.
- [ ] Post the screenshots, the video, and the state table in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] The `high` reviewer's findings answered.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Diagnose and repair connections before asking the member (B4)

**Depends on.** B3.

**Files.**

- [ ] Create `lib/diagnostics.js`.
- [ ] Create `test/diagnostics.test.js`.
- [ ] Create `extension/src/connection/secrets.js`, `extension/src/connection/joins.js`, `extension/src/connection/report.js`.
- [ ] Edit `lib/client-core.js` (connect through the diagnostics resolver), `lib/common.js` (address helpers only), `extension/src/connection/controller.js`, `package.json` (command `lanCollab.diagnose`).

**Build.**

- [ ] `diagnostics.js` exports `runChecks(target, env)` that yields one result per step in the order of README section 5.7. Each result is `{step, status, code, data, remedy}` with status `ok`, `fixed`, `failed`, or `skipped`. `env` injects sockets, UDP, the clock, and the file system so tests run without a network.
- [ ] Step 2 connects to every known address in parallel. The known addresses are those in the invite v3 code plus the last address that reached `live`. Each address waits at most 3 seconds and the first success wins.
- [ ] Step 3 broadcasts `lanhub_discover` on every IPv4 interface and accepts the reply whose `instanceId` matches. A match at a new address is stored as the last-known-good address and the result is `fixed`.
- [ ] Step 4 maps `ECONNREFUSED` to `refused`, `ETIMEDOUT` and the 3 second timeout to `timeout`, and `EHOSTUNREACH` or `ENETUNREACH` to `unreachable`. Each code has its own catalog guidance.
- [ ] When the joins record has `tlsFingerprint`, the client opens the socket with `tls.connect` and replaces host-name checking with an exact SHA-256 fingerprint compare of the peer certificate. `lib/client-core.js` takes a socket factory, so plain TCP and TLS share one code path.
- [ ] Step 5 compares the TLS fingerprint to the one in the joins store and stops with `tls_mismatch` on a difference. It never skips the check.
- [ ] On every successful `welcome`, the client stores `welcome.instanceId` in the joins record. Folders migrated from 0.1 have no `instanceId` and gain it on their first connection, so rediscovery works for them afterwards.
- [ ] A `rejected` message shows a notification for that action only and never moves the machine to `needs_action`. Only `error` does.
- [ ] Step 6 sends a probe and reads `probe_result`. Each false field maps to an error code with actions. `project_unknown` lists the hub's projects for the member to pick.
- [ ] Step 7 checks that the folder is writable and that `.lan-collab` does not belong to another `hubId`.
- [ ] While `live`, the controller reads RTT from `pong.ts` and reconnects with backoff 1, 2, 5, 10, and 30 seconds plus up to 20 percent jitter. Each attempt reruns steps 2 and 3.
- [ ] `secrets.js` moves tokens into `context.secrets` under `lanCollab.token:<folderKey>`. On first activation of 0.2 it migrates tokens from `globalState` `lanCollab.joins` and from the `lanCollab.token` setting, verifies each read back, then deletes the old copy. The migration is idempotent.
- [ ] `joins.js` stores schema version 2 per folder as `{v:2, instanceId, addresses, lastGood, port, project, tlsFingerprint}` with no token.
- [ ] `lanCollab.diagnose` runs every step and writes the result to a read-only document. `report.js` builds the copyable report with versions, OS, interfaces, and step results, and replaces tokens and invite codes with `***`.

**You see.**

- [ ] After the hub machine changes IP address, the member reconnects without any prompt and the output channel logs the new address.
- [ ] `LAN Collab: Chẩn đoán kết nối` with the hub stopped shows step 2 and step 3 failed, step 4 as `refused`, and the guidance `LAN Hub chưa chạy hoặc sai cổng. Kiểm tra LAN Hub trên máy chủ.`

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/diagnostics.test.js` covers each step with a fake `env` for success, each failure code, auto-fix by rediscovery, the parallel race where the second address answers first, and the TLS mismatch stop. Run `node test/diagnostics.test.js`.
- [ ] `test/secrets.test.js` covers migration from both sources, a crash between write and delete (rerun converges), and an empty source. Run `node test/secrets.test.js`.
- [ ] `test/report.test.js` asserts that no token or `LC3-` code survives redaction. Run `node test/report.test.js`.
- [ ] `npm test` and `npm run test:vscode` pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Stop the hub and run `lanCollab.connect` at trunk and at head. Save `b4-regression.png`. Pass when trunk shows only the reconnecting status and head shows the failed steps with guidance.
- [ ] Lane 2. Join with an invite whose first address is `192.0.2.1` and second address is the real one. Save `b4-multi.png`. Pass when the member reaches `live` within 4 seconds.
- [ ] Lane 3. Join, stop the hub, restart it on another local address and port reachable by discovery. Save `b4-moved.png`. Pass when the member reconnects without a prompt and the joins store holds the new `lastGood`.
- [ ] Lane 4. Start the hub with `--host 127.0.0.1` and connect through the LAN address. Save `b4-blocked.png`. Pass when the result is `refused` or `timeout` with the firewall guidance and a `Chẩn đoán` button.
- [ ] Lane 5. Connect with a wrong token. Save `b4-token.png`. Pass when the actions `Dán mã mời mới` and `Nhập token` appear, and entering the right token reaches `live` without reloading the window.
- [ ] Lane 6. Connect with project `Other`. Save `b4-project.png`. Pass when a quick pick lists `Demo` and choosing it reaches `live`.
- [ ] Lane 7. Connect with an account missing from the allow file. Save `b4-account.png`. Pass when the guidance shows the exact line `github:<label>` to send to the administrator and `Đổi tài khoản` switches accounts.
- [ ] Lane 8. Start 0.2 with a 0.1.1 user data folder that holds a token in `lanCollab.joins` and in `lanCollab.token`. Save `b4-migrate.png`. Pass when the token is in SecretStorage, both old copies are gone, and the member reaches `live`.
- [ ] Lane 9. Run `lanCollab.diagnose` and copy the report. Save `b4-report.txt`. Pass when every step appears and the report has no token and no invite code.
- [ ] Lane 10. Drop the hub for 40 seconds while `live`. Save `b4-backoff.txt`. Pass when the output channel shows attempts at about 1, 2, 5, 10, and 30 seconds with jitter and the member returns to `live`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from `lanCollab.connect` to `live` when the first address is dead, and time from hub restart at a new address to `live`. Trunk lacks both behaviors, so this records trunk's time to give up or never connect and sets absolute budgets.
- [ ] Probe. Run lane 2 and lane 3 five times each at head, and the same scenarios at trunk, interleaved, reading timestamps from the output channel.
- [ ] Baseline. Record the trunk results first, including "no connection after 60 seconds" where that happens.
- [ ] Rule. Head above 4 seconds for a dead first address fails. Head above 3 seconds from discovery reply to `live` fails. A normal connection to a live first address slower than trunk by more than 10 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 4, 5, and 7 screenshots into `docs/plans/media/b4-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of lanes 3 and 5 with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b4-review.mp4`.
- [ ] Post the screenshots, the video, and a redacted report in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] The `high` reviewer's findings answered, covering secret migration and redaction.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add the connection panel for setup and repair (B5)

**Depends on.** B4 and B2.

**Files.**

- [ ] Create `extension/webview-src/connection/` and `extension/src/views/connection.js`.
- [ ] Edit `package.json` to add the command `lanCollab.openConnection`, `contributes.walkthroughs` for first use, and `viewsWelcome` for the unconnected state.
- [ ] Edit `extension/src/connection/controller.js` to expose diagnostics results and actions to the panel.

**Build.**

- [ ] The panel opens in the editor area with three sections. Setup offers paste an invite, pick a hub found on the LAN, or enter an address. The connection editor shows address, port, project, token (masked), and TLS fingerprint. Status shows the machine state, RTT, and the last diagnostics run.
- [ ] The discovered hub list comes from one `lanhub_discover` broadcast when the panel opens and on `Tìm lại`. Each row shows hub name, address, and the projects the hub advertises.
- [ ] Each diagnostics step renders as a row with status, the catalog guidance, and its action buttons. The actions are `Thử lại`, `Tìm lại LAN Hub`, `Hướng dẫn mở tường lửa`, `Đăng nhập`, `Chọn dự án`, and `Dán mã mời mới`. Every action calls the controller and reruns the affected steps.
- [ ] `Đặt lại kết nối cho thư mục này` clears the joins entry and the secret for this folder after a confirmation, and leaves project files untouched.
- [ ] The firewall guide is a catalog page with the exact PowerShell command for the port the member uses, shown for the administrator of the hub machine.
- [ ] `viewsWelcome` shows `Chưa kết nối LAN Hub.` with buttons for the panel and for joining by invite. The walkthrough has three steps (get an invite, join, check the connection).

**You see.**

- [ ] A fresh VS Code with an empty folder shows the welcome content in the LAN Collab views and opens the panel from it.
- [ ] Pasting a valid invite in the panel runs the steps live and ends in `live` with all rows marked ok.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `extension/webview-src/connection/state.test.ts` covers rendering of each step status and the action list per error code from a fixture. Run `npx vitest run extension/webview-src/connection`.
- [ ] `npm test` and `npm run test:vscode` pass, including `check-strings.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no panel. Record that, then join an empty folder by invite through `lanCollab.join` at trunk and through the panel at head. Save `b5-regression.png`. Pass when both end with every hub file on disk.
- [ ] Lane 2. Open a fresh profile with an empty folder. Save `b5-welcome.png`. Pass when the welcome content shows `Chưa kết nối LAN Hub.` and its buttons open the panel.
- [ ] Lane 3. Open the panel with the hub running and discovery on. Save `b5-discover.png`. Pass when the hub row shows its name and `Demo`, and picking it asks only for the token.
- [ ] Lane 4. Enter a manual address with a typo in the port. Save `b5-manual.png`. Pass when the step row shows `refused` with guidance and `Thử lại` after fixing the port reaches `live`.
- [ ] Lane 5. Stop the hub while the panel is open. Save `b5-live-status.png`. Pass when the status section switches to `reconnecting` within 5 seconds.
- [ ] Lane 6. Trigger `account_denied` and press `Đăng nhập`. Save `b5-signin.png`. Pass when the account picker opens and a permitted account reaches `live`.
- [ ] Lane 7. Press `Hướng dẫn mở tường lửa`. Save `b5-firewall.png`. Pass when the page shows the PowerShell command with the real port.
- [ ] Lane 8. Press `Đặt lại kết nối cho thư mục này` and confirm. Save `b5-reset.png`. Pass when the joins entry and the secret are gone and project files are unchanged on disk.
- [ ] Lane 9. Walk through the walkthrough steps. Save `b5-walkthrough.png`. Pass when each step's command runs and the step is marked done.
- [ ] Lane 10. Use the panel in High Contrast with the keyboard only. Save `b5-hc.png`. Pass when every action is reachable and visible.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from `lanCollab.openConnection` to the panel's first paint, and time from opening to the discovered hub list filled. Trunk lacks the panel, so these are absolute budgets.
- [ ] Probe. Open the panel ten times at head and read CDP timing marks.
- [ ] Baseline. Trunk has no panel. Record that the baseline is absent.
- [ ] Rule. First paint above 400 ms fails. Hub list above 1.5 seconds with the hub on loopback fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 4, and 7 screenshots into `docs/plans/media/b5-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of setup from an empty folder to `live` with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Replace the member tree with a session view (B6)

**Depends on.** B2 and B3.

**Files.**

- [ ] Create `extension/webview-src/session/` and `extension/src/views/session.js`.
- [ ] Delete the `PeopleTree` code that moved into `extension/src/` in B3.
- [ ] Edit `package.json` to replace the tree view `lanCollab.people` with the webview view `lanCollab.session` named `Thành viên`.

**Build.**

- [ ] Each member row shows avatar and color, name, account provider icon, current file and line, debug session, status text, connection quality from RTT, and buttons `Đi theo` and `Đến vị trí`. The own row is first and marked.
- [ ] The activity feed renders structured activity with catalog text per `kind`, relative times, and filters by kind and by member. It holds the last 200 entries in a VirtualList.
- [ ] Clicking a file in a row or in the feed opens it, as `lanCollab.goTo` did.
- [ ] The view reads members and activity from the controller, so it shows the disconnected state from the machine when not `live`.

**You see.**

- [ ] The `Thành viên` view lists every connected member with file and line updating as they move.
- [ ] Filtering the feed to one member shows only that member's entries.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `extension/webview-src/session/feed.test.ts` covers rendering of each activity kind and the filters. Run `npx vitest run extension/webview-src/session`.
- [ ] `npm test` and `npm run test:vscode` pass. The `goTo` and presence assertions in `test/vscode/suite.js` move to the new view and still pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. With three members, read the member tree at trunk and the session view at head. Save `b6-regression.png`. Pass when head shows every fact trunk shows (name, file, line, debug, status).
- [ ] Lane 2. Member 2 moves through three files. Save `b6-presence.png`. Pass when member 1's row for member 2 updates within 300 ms each time.
- [ ] Lane 3. Press `Đi theo` on member 2. Save `b6-follow.png`. Pass when member 1's editor tracks member 2 and the button shows the following state.
- [ ] Lane 4. Press `Đến vị trí`. Save `b6-goto.png`. Pass when the editor opens member 2's file at the line.
- [ ] Lane 5. Member 2 starts and stops a debug session. Save `b6-debug.png`. Pass when the row and the feed show both events.
- [ ] Lane 6. Filter the feed by kind `create`. Save `b6-filter.png`. Pass when only file creation entries remain.
- [ ] Lane 7. Add 30 simulated members with `tools/loadgen.mjs`. Save `b6-thirty.png`. Pass when the view scrolls with the custom scrollbar and stays responsive.
- [ ] Lane 8. Stop the hub. Save `b6-offline.png`. Pass when the view shows the machine's disconnected text and no stale members.
- [ ] Lane 9. Set a status text on member 2 with `lanCollab.setStatus`. Save `b6-status.png`. Pass when member 1 sees it in the row and the feed.
- [ ] Lane 10. Switch theme to High Contrast. Save `b6-hc.png`. Pass when member colors keep a visible border and text stays readable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from a `presence` message to the updated row painted, with 30 members.
- [ ] Probe. Send presence updates through loadgen members and read CDP paint marks, at trunk for the tree refresh and at head for the webview, interleaved.
- [ ] Baseline. Record the trunk median first. The trunk tree refresh is debounced at 150 ms.
- [ ] Rule. A head median above 200 ms fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 3, and 7 screenshots into `docs/plans/media/b6-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of three members moving and following with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b6-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Add the edit-run history panel with compare, copy, and revert (B7)

**Depends on.** B6 and A5. A5 is on `upgrade/hub`, and B7 uses only the `lanhub-cli` binary built from it.

**Files.**

- [ ] Create `lib/history-client.js` and `test/history-client.test.js`.
- [ ] Create `extension/webview-src/history/` and `extension/src/views/history.js`.
- [ ] Create `extension/src/history/provider.js` for the `lancollab-history:` scheme and `extension/src/history/commands.js`.
- [ ] Edit `lib/client-core.js` to send `history_list` and `history_blob` and to emit `history_changed`.
- [ ] Edit `package.json` to add the `lanCollab.history` webview view named `Lịch sử chỉnh sửa` and the history commands.

**Build.**

- [ ] `history-client.js` wraps the A5 messages. `list(path, before, limit)` returns runs, `blob(hash)` returns content with an LRU cache of 50 blobs, and the client emits `changed(path)` on `history_changed`.
- [ ] The panel shows runs for the active file, newest first, with author color and name, time range, source (`editor`, `disk`, `revert`, `merge`), and characters added and removed. A toggle switches to the project timeline across files.
- [ ] `provider.js` serves `lancollab-history:/<runId>/<start or end>/<path>` as read-only documents from blobs.
- [ ] Commands per run are `Mở trạng thái sau lượt` (side by side), `So sánh với bản hiện tại`, `So sánh với trước lượt`, and `Sao chép nội dung`. All diffs use `vscode.diff`.
- [ ] `Hoàn tác lượt này` computes the three-way merge with base equal to the run end, theirs equal to the run start, and ours equal to the current text, using `diff` and `transform` from `lib/ot.js`. It opens a diff preview of current against result and applies the result as one local edit only after the member confirms. The edit syncs as a normal op, and the hub records it as a `revert` run.
- [ ] For a deleted file, `Khôi phục file` recreates it from the run's end blob through the normal create path.
- [ ] The panel refreshes on `history_changed` for the shown path only.
- [ ] Binary files show runs with sizes and offer only `Khôi phục phiên bản này`, because text diff and merge do not apply.

**You see.**

- [ ] After member 1 types, then member 2 types, then member 1 types in `a.py`, the panel shows three runs in order with the right authors.
- [ ] Reverting member 2's run removes only member 2's text, keeps both of member 1's runs, and member 2 sees the change.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/history-client.test.js` runs against `lanhub-cli` and covers listing, paging with `before`, blob fetch and cache, and `changed` events. Run `LANHUB_CMD=<lanhub-cli path> node test/history-client.test.js`.
- [ ] `test/revert.test.js` covers the three-way revert on fixtures where later edits by others overlap the run, sit before it, and sit after it, and asserts that no text from other runs is lost. Run `node test/revert.test.js`.
- [ ] `npm test` and `npm run test:vscode` pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no history panel. Record that, then run two members editing `a.py` for 60 seconds against `lanhub-cli` at head and confirm convergence at trunk and at head. Save `b7-regression.png`. Pass when both converge and head lists the runs.
- [ ] Lane 2. Alternate edits between member 1 and member 2 three times. Save `b7-runs.png`. Pass when the panel shows six runs with alternating authors.
- [ ] Lane 3. Open `Mở trạng thái sau lượt` on run 3. Save `b7-side.png`. Pass when a read-only editor beside the current file shows the file as it was after run 3.
- [ ] Lane 4. Member 1 deletes a function by mistake, then member 2 edits elsewhere. Member 1 opens the run before the delete and copies the function back. Save `b7-copy.png`. Pass when the function is back and member 2's edit is intact.
- [ ] Lane 5. Revert member 2's run while member 1 kept typing after it. Save `b7-revert.png`. Pass when the preview shows only member 2's changes removed, applying it syncs to both members, and a `revert` run appears.
- [ ] Lane 6. Delete `b.py`, then press `Khôi phục file` on its last run. Save `b7-restore.png`. Pass when `b.py` exists on every member's disk with the old content.
- [ ] Lane 7. Have a script write to `a.py` on member 1's disk. Save `b7-disk.png`. Pass when the run shows source `disk` with member 1 as author.
- [ ] Lane 8. Keep the panel open while member 2 types. Save `b7-live.png`. Pass when the newest run updates within 1 second of `history_changed`.
- [ ] Lane 9. Toggle the project timeline. Save `b7-timeline.png`. Pass when runs from several files show in time order.
- [ ] Lane 10. Replace a `.png` file twice and open its history. Save `b7-binary.png`. Pass when only `Khôi phục phiên bản này` is offered and restoring writes the old bytes.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to list 500 runs for one file, and time to open a run's side-by-side document. Trunk lacks the panel, so these are absolute budgets, plus op round trip with the panel open against trunk.
- [ ] Probe. Seed 500 runs with a loadgen script that alternates two authors, then open the panel ten times and read CDP marks. Run `tools/loadgen.mjs` with the panel open at head and with no panel at trunk, interleaved.
- [ ] Baseline. Record the trunk loadgen median first.
- [ ] Rule. Listing 500 runs above 300 ms fails. Opening a run document above 500 ms fails. Loadgen `ackRttP99` worse than trunk by more than 10 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 4, and 5 screenshots into `docs/plans/media/b7-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of lanes 4 and 5 with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b7-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA, with the `upgrade/hub` SHA of the binary recorded.
- [ ] The `high` reviewer's findings answered, covering the revert merge and concurrent edits.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Resolve sync conflicts file by file (B8)

**Depends on.** B3 and B2.

**Files.**

- [ ] Create `extension/webview-src/sync/` and `extension/src/views/sync.js`.
- [ ] Create `extension/src/backup.js`.
- [ ] Edit `lib/client-core.js` so `_sync` asks for a per-file decision map instead of one global choice.
- [ ] Create `test/sync-plan.test.js`.

**Build.**

- [ ] `_sync` builds the same plan as 0.1.1 and, when confirmation is needed, awaits `decide(plan)` that returns a choice per conflicting file. The choices are `hub` (bản trên hub), `local` (bản trên máy này), and `merge` (gộp ba chiều, text files only). Messages that arrive meanwhile stay queued until the plan runs (fragile behavior 1).
- [ ] The sync panel lists every file in the plan grouped by action, with a diff preview per conflicting file through `vscode.diff`, bulk buttons for each choice, and `Đồng bộ` and `Huỷ`. Closing the panel equals `Huỷ` and moves the machine to `stopped`.
- [ ] First-sync safety stays. Confirmation is mandatory when `firstTime` and local files would change, when there are conflicts, or when more than 5 local files would be removed (fragile behavior 5).
- [ ] Join into a non-empty folder opens the same panel instead of the modal warning, so the member sees each file that will be replaced or uploaded before anything is written.
- [ ] `backup.js` lists `.lan-collab/backup/<stamp>/` folders in a quick pick and restores one file or a whole stamp. A restore goes through the normal disk path, so it syncs.

**You see.**

- [ ] Two files changed on both sides while offline show as two rows, and choosing `hub` for one and `local` for the other keeps exactly those versions.
- [ ] `LAN Collab: Khôi phục từ bản sao lưu` lists backup folders by time.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/sync-plan.test.js` drives `lib/client-core.js` against the Node hub and covers mixed per-file choices, merge on a text conflict, cancel, and messages queued during the decision. Run `node test/sync-plan.test.js`.
- [ ] Break the queue gate in a scratch edit (process live ops before the plan) and see the test fail.
- [ ] `npm test` and `npm run test:vscode` pass, including the 8-seed convergence test.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Create two offline conflicts and reconnect at trunk and at head. Save `b8-regression.png`. Pass when trunk offers only the global choice and head offers a row per file.
- [ ] Lane 2. Choose `hub` for `a.py` and `local` for `b.py`. Save `b8-mixed.png`. Pass when the hub and every member hold hub `a.py` and local `b.py`.
- [ ] Lane 3. Choose `merge` for a text conflict where both sides edited different lines. Save `b8-merge.png`. Pass when both edits survive.
- [ ] Lane 4. Close the panel without choosing. Save `b8-cancel.png`. Pass when the machine is `stopped`, no file changed, and `lanCollab.connect` reopens the panel.
- [ ] Lane 5. Have member 2 type while member 1 has the panel open. Save `b8-queue.png`. Pass when member 2's edits apply on member 1 after the plan runs and nothing is lost.
- [ ] Lane 6. Join a folder that already holds 10 files, 4 of them different from the hub. Save `b8-join.png`. Pass when the panel lists the 4 replacements and the uploads before any write.
- [ ] Lane 7. Delete 6 files on the hub while member 1 is offline, then reconnect. Save `b8-remove.png`. Pass when confirmation is required for the 6 removals.
- [ ] Lane 8. Restore one file from a backup stamp. Save `b8-restore.png`. Pass when the file is restored and synced to member 2.
- [ ] Lane 9. Kill VS Code while the panel is open, then start again. Save `b8-kill.png`. Pass when the panel shows again with the same plan and no file was written.
- [ ] Lane 10. Use the panel with the keyboard only in High Contrast. Save `b8-hc.png`. Pass when every choice and the diff preview are reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from `welcome` to the panel painted for a project of 5000 files with 50 conflicts, and total sync time after confirming.
- [ ] Probe. Seed the project with a script, then reconnect five times at trunk and five times at head, interleaved, reading output channel timestamps.
- [ ] Baseline. Record the trunk medians first, using the modal dialog time for trunk.
- [ ] Rule. Panel paint above 1 second fails. Total sync time worse than trunk by more than 10 percent fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 2, and 6 screenshots into `docs/plans/media/b8-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of lanes 2 and 3 with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b8-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] The `high` reviewer's findings answered, covering the queue gate and first-sync safety.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Polish the native VS Code surfaces (B9)

**Depends on.** B5 and B6.

**Files.**

- [ ] Edit `extension/src/status-bar.js`, `extension/src/commands.js`, `extension/src/activate.js`.
- [ ] Create `extension/src/log.js`.
- [ ] Edit `package.json` contributes (menus, `when` clauses, keybindings, setting descriptions and order).

**Build.**

- [ ] The status bar shows one icon and short text per machine state, with a tooltip that names the project, the hub address, member count, RTT, and the next step. `needs_action` uses the warning background.
- [ ] The menu quick pick groups items under separators (connection, team, history, help) with codicons and hides items that do not apply to the current state.
- [ ] Every notification has explicit action buttons from the catalog. No notification asks the member to open the log. Long-running steps use progress notifications with cancel where cancel is real.
- [ ] Command palette `when` clauses hide commands that cannot run, using the context key `lanCollab.state`.
- [ ] Keybindings are `ctrl+alt+l c` for chat, `ctrl+alt+l f` for follow, and `ctrl+alt+l h` for history. They are documented in the walkthrough.
- [ ] `log.js` writes `2026-11-07T09:15:02.123Z [warn] <area> <message>` lines to the output channel and is the only writer. Levels are `debug`, `info`, `warn`, and `error`. `LAN_COLLAB_DEBUG` enables `debug`.

**You see.**

- [ ] The status bar in each state matches the table in the PR body.
- [ ] The command palette filtered to `LAN Collab` shows only the commands that apply to the current state.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/status-bar.test.js` asserts text, icon, tooltip, and background for every machine state. Run `node test/status-bar.test.js`.
- [ ] `test/when-clauses.test.js` asserts that every contributed command has a `when` clause that references `lanCollab.state` or is listed as always available. Run `node test/when-clauses.test.js`.
- [ ] `npm test` and `npm run test:vscode` pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run connect, follow, chat, and disconnect from the menu at trunk and at head. Save `b9-regression.png`. Pass when each command works at head as at trunk.
- [ ] Lane 2. Screenshot the status bar in `idle`, `connecting`, `live`, `reconnecting`, and `needs_action`. Save `b9-statusbar.png`. Pass when each matches the PR table.
- [ ] Lane 3. Hover the status bar while `live`. Save `b9-tooltip.png`. Pass when the tooltip names project, address, member count, and RTT.
- [ ] Lane 4. Open the menu while `idle` and while `live`. Save `b9-menu.png`. Pass when items are grouped with codicons and only applicable items show.
- [ ] Lane 5. Filter the command palette to `LAN Collab` while `idle`. Save `b9-palette.png`. Pass when follow and copy invite are hidden.
- [ ] Lane 6. Press each keybinding. Save `b9-keys.png`. Pass when chat, follow, and history open.
- [ ] Lane 7. Trigger each error code from B4 once. Save `b9-notifications.png`. Pass when every notification has at least one action button and none mentions the log.
- [ ] Lane 8. Read the output channel after lane 7. Save `b9-log.txt`. Pass when every line has an ISO timestamp and a level.
- [ ] Lane 9. Open Settings filtered to `lanCollab`. Save `b9-settings.png`. Pass when settings appear in the declared order with catalog wording.
- [ ] Lane 10. Run with `LAN_COLLAB_DEBUG=1`. Save `b9-debug.txt`. Pass when `debug` lines appear only in the output channel.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Extension activation time and the time from a machine state change to the status bar update.
- [ ] Probe. Measure activation five times at trunk and five times at head, interleaved, through `Developer: Show Running Extensions`, and read state change timestamps from the output channel.
- [ ] Baseline. Record the trunk medians first.
- [ ] Rule. Activation above trunk median plus 20 ms fails. A status bar update above 50 ms after the state change fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 4, and 7 screenshots into `docs/plans/media/b9-review-<slug>.png`.
- [ ] Record a 30 to 60 second video that walks the states and the menu with `tools/cdp/record.mjs`. Save it as `docs/plans/media/b9-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `upgrade/extension` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Report the head SHA of `upgrade/extension` and the list of `packages/ui-kit` changes made on this branch, for I1.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

No prototype ran during planning. These questions stay unproven and the owners settle them first.

- Whether `retainContextWhenHidden` on four webviews (chat, session, history, connection) costs too much memory. B6 measures extension host and webview memory with all four open and drops `retainContextWhenHidden` on any view whose state restores fast from the host.
- Whether VS Code's undo stack must be overridden for remote edits. Remote edits enter the undo stack through `workspace.applyEdit` today. This branch does not change undo. C1 owns it. B7 revert applies one local edit, so one Ctrl+Z undoes a revert today, which lane 5 records.
- Whether UDP broadcast from the extension host reaches the hub on the operator's LAN. P0-2 lane 6 settles the network side. B4 lane 3 runs on loopback only unless the operator provides a second machine.
- Whether `vscode.diff` on `lancollab-history:` documents allows copying with the normal editor selection. B7 lane 4 settles it.
- Whether a 5000-file project fits the B8 perf budget. B8 measures it first and reports before building the panel.

## Appendix B. Alternatives rejected

- A tree view for history and members. Tree items cannot show diffs inline, avatars, or custom controls, and README section 5.3 moves dense views to webviews.
- Running diagnostics only on demand. Members would still get stuck at a silent retry loop, which is the 0.1.1 failure. The checks run on every connection attempt and the command shows the same results.
- Storing the token in settings or `globalState`. Both are plain text on disk. SecretStorage uses the OS credential store.
- Reverting a run by inverting and transforming its ops. README section 5.11 records why. The three-way merge on blobs is the same method `git revert` uses.
- A modal dialog with per-file choices. A modal cannot show diffs and blocks the editor. The sync panel keeps the editor usable while the plan waits.
- Keeping `extension/extension.js` as one file. Nine PRs edit it, and splitting it in B3 removes most conflicts between B4 to B9.

## Appendix C. Risks

- B1. Rewording breaks strings pinned by tests and by members' habits. The owner updates every pinned test and posts the before and after table for the operator.
- B2. The Svelte build adds a build step to packaging. A missing `vscode:prepublish` run ships an empty view. Lane 1 packages and installs the `.vsix` to catch it.
- B3. Splitting `extension.js` while changing state handling can drop a listener. The owner diffs the list of registered commands, events, and disposables before and after.
- B4. Secret migration that deletes before verifying loses tokens. The migration reads back before deleting and lane 8 proves it.
- B4. Parallel connects can leave sockets open. The losing sockets are destroyed and lane 2 checks the hub log for one session only.
- B7. A5's message shapes may change on `upgrade/hub` after B7 starts. B7 pins the SHA and I1 reruns `test/history-client.test.js` on the merged tree.
- B7. A revert of an old run on a file with heavy later edits can produce surprising text. The preview is mandatory and lane 5 checks it.
- B8. Changing `_sync` touches the most fragile code in the client. The 8-seed convergence test and lane 5 guard the queue gate.
- B9. `when` clauses can hide a command a member needs to recover. The connection panel and `lanCollab.diagnose` are always available.

## Appendix D. Links and reading list

- `docs/plans/README.md` sections 5.3, 5.6, 5.7, 5.8, and 5.11.
- `docs/protocol.md` from P0-2 and the A5 history messages on `upgrade/hub`.
- `docs/copy-guide.md` from P0-3 before any caption change.
- `lib/client-core.js` `_sync`, `_reconcile`, `_on_file`, and the queue handling before B3, B4, and B8.
- B3 and B8 get `pstack/skills/how/SKILL.md` before editing `_sync`. B4 and B7 get `pstack/skills/interrogate/SKILL.md` on the finished design.
- The decision trail follows `pstack/skills/show-me-your-work/SKILL.md` and lives at `docs/plans/trail/B.tsv`.
