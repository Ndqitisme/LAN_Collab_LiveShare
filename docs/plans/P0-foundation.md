# P0 foundation plan

P0 lands on `main` before the two upgrade branches split. It gives both branches one contract and one set of tools. The hub tests become black-box tests that any hub binary must pass, the protocol moves to v2 with a written spec, a shared UI kit and copy guide exist, and a CDP tool can drive and screenshot VS Code and the LAN Hub app. Every later PR verifies itself with these tools. Decisions and the impact map live in `docs/plans/README.md`. PR ids in order are P0-1, P0-2, P0-3, P0-4.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator merges every PR. Agents build, verify, and stop at merge-ready. P0-1, P0-2, P0-3, and P0-4 are all operator items that stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from the pinned pstack clone at program start. Re-read them at every tick. The clone is `cursor/plugins` at `C:\Users\BDT-QUY\src\cursor-plugins`, checked out at `6b03002` and never fetched, so `origin/main` stays at `6b03002`. Each read is `git show origin/main:<path>` run inside the clone, written below with `git -C`.
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-prove-it-works/SKILL.md`
  - [ ] Read `tools/cdp/README.md` once P0-4 lands. It replaces the `control-ui` skill for this repo.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `claude-opus-5-5`. The P0-2 owner runs at effort `high` because it changes the wire protocol.
- [ ] Follow this dependency graph.
  - [ ] P0-1, P0-3, and P0-4 are independent and first. All three branch from `main`.
  - [ ] P0-2 after P0-1, because P0-2 proves itself with the conformance suite.
- [ ] Hold the file boundaries.
  - [ ] P0-1 touches only `test/**`, `tools/loadgen.mjs`, `.github/workflows/ci.yml`, `package.json` scripts, and the `--port 0` parsing fix in `hub/hub.js`.
  - [ ] P0-2 touches only `docs/protocol.md`, `hub/hub.js`, `lib/common.js`, `lib/client-core.js` (handshake, error rendering, activity rendering), and `test/conformance/**`.
  - [ ] P0-3 touches only `packages/ui-kit/**`, `docs/copy-guide.md`, `package.json` workspaces and devDependencies, `.gitignore`, `.vscodeignore`, `.gitattributes`. Shared files follow the additive rule in README section 3.
  - [ ] P0-4 touches only `tools/cdp/**`, `test/vscode/run.js`, `package.json` devDependencies.
- [ ] Hold the review gate. No P0 PR changes an interaction. None is review-gated.

### PR mechanics, for every PR

- [ ] Resolve the forge once. `gh` is not installed on this machine and `origin` CLI is absent. The owner commits on a local branch named `p0/<pr-id>` and the operator pushes and merges. Record this fallback in the decision trail.
- [ ] Open the PR ready, never draft, per **Opening a PR**, once the operator pushes the branch. Until then the merge-ready report carries the branch name, head SHA, and PR body.
- [ ] Run `npm test` once before the merge-ready report. Commit with hooks on.
- [ ] Run a deslop pass before each commit and a no-comments pass before review. Both are manual reads of the diff against `pstack/skills/no-comments/SKILL.md` and the comment rules in `C:\Users\BDT-QUY\.claude\CLAUDE.md`.
- [ ] Triage reviewer comments per `../references/bugbot-triage.md` from the pstack clone. This repo has no Bugbot. P0-2 gets one reviewer on `claude-opus-5-5` at effort `high` in a fresh context.
- [ ] Rebase onto current `main` before the code-ready report. Rebase again only at merge prep or on a conflict.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. A full swarm here is one verifier agent on `claude-opus-5-5` that runs the gates lane, the ten live lanes from the PR's **Verify, live** block in order, the perf lane, and two audit lanes that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR.
- [ ] Stop at merge-ready with a clean verdict at the exact head SHA. The operator lands the PR. A rebase that keeps the patch-id unchanged keeps the verdict, per the patch-id rule in `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on this Windows 10 machine at the PR head, in its own scratch folder under the session scratchpad.

- [ ] `git fetch` is not needed for local branches. Run `git worktree add <scratch>/p0-<pr-id> <head SHA>`.
- [ ] Run `npm install` in the worktree when the PR adds devDependencies. Start a hub with `node hub/hub.js --root <scratch>/root --port 0 --log-format json` and read the port from the `listening` line once P0-1 lands.
- [ ] Deliver input to VS Code and the LAN Hub app only through `tools/cdp/` commands once P0-4 lands. Before that, CLI lanes read stdout and disk only.
- [ ] Save every screenshot or log to `<scratch>/swarm-<pr-id>/worker-<n>/<slug>.<png or txt>` and return the paths with the report.

## Convert the hub tests into a black-box conformance suite (P0-1)

**Depends on.** None.

**Files.**

- [ ] Create `test/support/hub-process.js`.
- [ ] Create `test/conformance/sync.test.js`, `test/conformance/chat.test.js`, `test/conformance/exclude.test.js`, `test/conformance/robustness.test.js`.
- [ ] Delete `test/sync.test.js`, `test/chat.test.js`, `test/exclude.test.js`, `test/robustness.test.js` after their cases move.
- [ ] Keep `test/ot.test.js` unchanged. It tests `lib/ot.js` and needs no hub.
- [ ] Create `tools/loadgen.mjs`.
- [ ] Create `.github/workflows/ci.yml`.
- [ ] Edit `hub/hub.js` so `--log-format json` prints `{"event":"listening","port":N}` on stdout and `--stop-on-stdin-close` flushes every dirty file and exits 0 when stdin closes. `--port 0` already parses to an ephemeral port at `hub/hub.js:576`.
- [ ] Edit `package.json` scripts `test`, `test:conformance`, and `loadgen`.

**Build.**

- [ ] `startHubProcess(opts)` in `test/support/hub-process.js` spawns `LANHUB_CMD` (default `node hub/hub.js`) with `--root`, `--port 0`, `--log-format json`, `--project`, `--token`, `--allow-file`, `--exclude`, waits for the `listening` line, and returns `{port, root, stop()}`. `stop()` closes the child's stdin and waits for exit, so pending writes reach disk. Node's SIGINT on Windows is a forced kill and skips the flush, so the helper does not use it.
- [ ] Replace every read of `hub.files` with protocol evidence. A fresh probe client reads the `welcome.files` manifest, and disk assertions read `<root>` after `stop()`.
- [ ] Replace `hub.flushAll()` with `stop()` followed by disk reads.
- [ ] Move all cases of the four test files without dropping one. Keep the fake-hub section of `robustness.test.js` as it is, because it tests the client.
- [ ] `tools/loadgen.mjs` connects N raw protocol clients, creates one text file, sends ops at a fixed rate per client for a fixed duration, and prints JSON with `ackRttP50`, `ackRttP99`, `fanoutP50`, `fanoutP99`, `opsPerSec`, and `hubRssMb` (read from the child process).
- [ ] CI runs `npm test` on `windows-latest` and `ubuntu-latest` with Node 22.

**You see.**

- [ ] `npm test` prints `ot.test.js` with 15010 checks, then each conformance file prints OK, against the Node hub started as a child process.
- [ ] `LANHUB_CMD="node hub/hub.js" node --test test/conformance` passes, which proves the variable path works before any Rust hub exists.
- [ ] `node tools/loadgen.mjs --clients 10 --rate 20 --seconds 30` prints one JSON line with all six fields.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Count test cases before and after with `node tools/count-cases.mjs` (a scratch script kept out of the repo). Every case name at trunk exists at head.
- [ ] Break the hub on purpose in a scratch copy (make `applyOp` drop every tenth op) and run `npm test`. `sync.test.js` must fail. Restore the copy.
- [ ] Run `npm test` three times in a row. All three pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the four hub test files at trunk with `npm test` and the four conformance files at head. Save `p0-1-regression.txt`. Pass when both runs pass and head lists every trunk case name.
- [ ] Lane 2. Start `node hub/hub.js --root <scratch>/r2 --port 0 --log-format json --stop-on-stdin-close`, edit a file through a client, and close stdin within 100 ms. Save `p0-1-port0.txt`. Pass when stdout holds one `listening` line, the process exits 0, and the edit is on disk.
- [ ] Lane 3. Start the hub with `--port 8299` and no `--log-format`. Save `p0-1-human-log.txt`. Pass when the human log lines match trunk word for word.
- [ ] Lane 4. Run `sync.test.js` alone with seed 101. Save `p0-1-seed101.txt`. Pass when it reports convergence for hub disk, every client, and every editor.
- [ ] Lane 5. Run `robustness.test.js` alone. Save `p0-1-robust.txt`. Pass when the 256 KB pre-auth line closes within 2 seconds and the Windows alias paths are refused.
- [ ] Lane 6. Run `chat.test.js` alone. Save `p0-1-chat.txt`. Pass when the image file exists under `<history>/chat-media/` after `stop()`.
- [ ] Lane 7. Kill the hub child with `taskkill /F` during `sync.test.js`. Save `p0-1-kill.txt`. Pass when the test fails with a clear "hub exited" error and leaves no orphan `node.exe` process.
- [ ] Lane 8. Run `loadgen.mjs` with 1 client and with 20 clients. Save `p0-1-loadgen.txt`. Pass when both print valid JSON and `ackRttP99` is a finite number.
- [ ] Lane 9. Run the CI workflow locally with `act` if installed, otherwise run its two commands by hand in a clean worktree. Save `p0-1-ci.txt`. Pass when both commands exit 0.
- [ ] Lane 10. Run `npm run test:vscode` at head. Save `p0-1-vscode.txt`. Pass when the VS Code suites still pass, which proves the hub CLI change did not break `test/vscode/run.js`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of the full hub test run. Trunk runs in-process, head runs a child process, so head pays a spawn cost per file.
- [ ] Probe. Run `npm test` five times at trunk and five times at head, interleaved, and record each wall time with `Measure-Command`.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head median above trunk median plus 5 seconds fails. Record the first loadgen numbers on the Node hub as the absolute baseline that A2 and later PRs compare against.

**Review gate.** None. P0-1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Write protocol v2 and move the Node hub onto it (P0-2)

**Depends on.** P0-1.

**Files.**

- [ ] Create `docs/protocol.md`.
- [ ] Edit `hub/hub.js`.
- [ ] Edit `lib/common.js`.
- [ ] Edit `lib/client-core.js` (handshake, error rendering, activity rendering).
- [ ] Create `test/conformance/protocol-v2.test.js`.
- [ ] Create `test/conformance/discovery.test.js`.
- [ ] Edit `test/support/hub-process.js`.

**Build.**

- [ ] Write `docs/protocol.md` as reference. It lists framing, limits, the handshake, every message in both directions with fields, the error code table, structured activity kinds, `probe_result`, `pong.ts`, UDP discovery on port 8201, invite v3, the `features` list, and the history messages reserved for A5. Section 5.4 of `docs/plans/README.md` is the source.
- [ ] In `hub/hub.js`, record `proto` per client. Accept 1 and 2. For proto 2 clients send coded errors, structured activity, `probe_result`, and `pong.ts`. For proto 1 clients keep the 0.1 messages unchanged.
- [ ] Add the UDP discovery responder to `hub/hub.js`, bound to port 8201 by default, answering `lanhub_discover` with `lanhub_here`. `--discovery-port <n>` changes the port and `--no-discovery` disables it. A failed UDP bind logs one warning and the TCP hub keeps running.
- [ ] Edit `test/support/hub-process.js` to pass `--no-discovery` unless a test asks for discovery, so parallel test files never fight over UDP 8201. `discovery.test.js` passes a random free port to `--discovery-port`.
- [ ] For proto 2 clients, check in the order proto, project, token, account, as README section 5.4 states.
- [ ] Document `op.src` values `editor`, `disk`, `revert`, `merge` and the field `op.reverts`. `lib/client-core.js` sends `src` set to `merge` for the op it resends after a reconnect merge.
- [ ] Add `instanceId` to `welcome` and `rtt` to `presence.p`. The client sends its last measured RTT in presence every 5 seconds.
- [ ] In `lib/common.js`, add `PROTO_V2 = 2`, `encodeInviteV3`, and `decodeInviteV3`. Keep `decodeInvite` for v1 and v2 codes until I1. The hub prints v3 invite codes with every IPv4 address in one code.
- [ ] In `lib/client-core.js`, send proto 2 and render the 0.1.1 Vietnamese texts on the client from error codes and activity kinds, in one table `renderHubMessage(code, data)`. The text moves from the hub to the client unchanged, so users of `main` see the same words. B1 rewrites the words later. Proto 2 on the client is required because the conformance suite drives `lib/client-core.js`, and `lanhub` accepts only proto 2.
- [ ] Installed 0.1.1 extensions keep working because the Node hub still answers proto 1 with the 0.1 messages.

**You see.**

- [ ] The hub prints one line `Mã mời: LC3-...` that decodes to every IPv4 address of the machine.
- [ ] A proto 2 hello with a wrong token gets `{"t":"error","code":"token_invalid"}` and no Vietnamese text.
- [ ] A proto 1 hello with a wrong token gets the 0.1 message `Sai lanCollab.token.`

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `protocol-v2.test.js` covers each error code, `probe_result` for each failing step, structured activity for each kind, and `pong.ts`. Run `node --test test/conformance/protocol-v2.test.js`.
- [ ] `discovery.test.js` sends `lanhub_discover` to `127.0.0.1:8201` and gets `lanhub_here` with the right `instanceId`. Run `node --test test/conformance/discovery.test.js`.
- [ ] `test/ot.test.js` gains invite v3 round-trip cases for 1, 4, and 8 addresses and a TLS fingerprint. Run `node test/ot.test.js`.
- [ ] The full suite still passes with `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Install the 0.1.1 extension from `dist/lan-collab-0.1.1.vsix` into a fresh VS Code profile and connect it to the trunk hub, then to the head hub. Save `p0-2-regression.png`. Pass when both connections reach the online status bar state and an edit syncs.
- [ ] Lane 2. Connect the 0.1.1 extension to the head hub with a wrong token. Save `p0-2-v1-token.png`. Pass when the toast shows the 0.1 text `Sai lanCollab.token.`
- [ ] Lane 3. Send a raw proto 2 hello with an unknown project. Save `p0-2-project.txt`. Pass when the reply is `project_unknown` with `projects` listing the hub's project.
- [ ] Lane 4. Send a raw proto 2 probe with a valid token and no account against a hub with an allow file. Save `p0-2-probe.txt`. Pass when `probe_result` has `token_ok` true and `account_ok` false.
- [ ] Lane 5. Send a raw proto 3 hello. Save `p0-2-version.txt`. Pass when the reply is `protocol_version` with `hubMin` 1 and `hubMax` 2.
- [ ] Lane 6. Run discovery from a second machine on the LAN if the operator provides one, otherwise from loopback. Save `p0-2-discovery.txt`. Pass when `lanhub_here` arrives within 500 ms.
- [ ] Lane 7. Start the hub with `--no-discovery`. Save `p0-2-nodisc.txt`. Pass when UDP 8201 is not bound.
- [ ] Lane 8. Decode the printed `LC3-` code with `decodeInviteV3`. Save `p0-2-invite.txt`. Pass when it lists every non-internal IPv4 address from `ipconfig`.
- [ ] Lane 9. Connect a proto 2 raw client and a 0.1.1 extension at the same time, then edit from each. Save `p0-2-mixed.png`. Pass when the extension shows the activity text and the raw client receives structured activity for the same edit.
- [ ] Lane 10. Run `docs/protocol.md` through a link and heading check (`node tools/check-md.mjs`, scratch). Save `p0-2-doc.txt`. Pass when every message the hub sends appears in the spec.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `ackRttP99` and `fanoutP99` from `tools/loadgen.mjs` with 10 clients at 20 ops per second.
- [ ] Probe. Run the loadgen five times against the trunk hub and five times against the head hub, interleaved.
- [ ] Baseline. Record the trunk medians first.
- [ ] Rule. A head median above trunk median by more than 10 percent fails.

**Review gate.** None. P0-2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Create the shared UI kit and the copy guide (P0-3)

**Depends on.** None.

**Files.**

- [ ] Create `packages/ui-kit/package.json`, `packages/ui-kit/src/tokens.css`, `packages/ui-kit/src/theme-vscode.css`, `packages/ui-kit/src/theme-app.css`, `packages/ui-kit/src/base.css`.
- [ ] Create one `.svelte` file per component under `packages/ui-kit/src/components/` for Button, IconButton, Input, Textarea, Select, Switch, Checkbox, Badge, Avatar, StatusDot, Tooltip, Toast, Dialog, Tabs, Card, List, VirtualList, ProgressBar, EmptyState, CodeBlock, Icon.
- [ ] Create `packages/ui-kit/gallery/` with a Vite page that renders every component in both themes.
- [ ] Create `docs/copy-guide.md`.
- [ ] Edit `package.json` to add `"workspaces": ["packages/*"]` and devDependencies `svelte`, `vite`, `@sveltejs/vite-plugin-svelte`, `typescript`, `svelte-check`, `vitest`.
- [ ] Edit `.gitignore` (add `target/`, `node_modules/`, `extension/webview/dist/`, `docs/plans/media/`), `.vscodeignore` (add `packages/**`, `lanhub/**`, `docs/**`, `extension/webview-src/**`), `.gitattributes` (add `*.rs text eol=lf`).

**Build.**

- [ ] `tokens.css` defines the semantic tokens from README section 5.3 as CSS custom properties with the `--lc-` prefix.
- [ ] `theme-vscode.css` maps each token to a `--vscode-*` variable and adds a `body.vscode-high-contrast` block.
- [ ] `theme-app.css` defines light and dark palettes keyed on `prefers-color-scheme` and on `[data-theme]`.
- [ ] `base.css` styles scrollbars with `::-webkit-scrollbar` (8 px, rounded thumb, 12 px on hover), the focus ring, text selection, and the system font stack.
- [ ] Each component uses Svelte 5 runes, takes typed props, and reads only `--lc-` tokens. Icon embeds a fixed Lucide subset as inline SVG.
- [ ] `docs/copy-guide.md` holds the glossary, tone rules, the error message pattern, banned patterns, and before and after examples taken from the 0.1.1 strings listed in the client survey.
- [ ] `vsce package` keeps working. The extension package gains no `packages/` files.

**You see.**

- [ ] `npm run -w packages/ui-kit gallery` serves a page with every component in light, dark, VS Code dark, and VS Code high contrast.
- [ ] `npx vsce ls` lists no file under `packages/`, `lanhub/`, or `docs/`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `npx svelte-check --workspace packages/ui-kit` reports 0 errors and 0 warnings.
- [ ] `node packages/ui-kit/scripts/check-tokens.mjs` fails when a component uses a raw color or a `--vscode-*` variable outside `theme-vscode.css`. Prove it by adding a raw color in a scratch edit and seeing the failure.
- [ ] `npm test` still passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no UI kit. Record that fact, then run `npm run package` at trunk and head. Save `p0-3-regression.txt`. Pass when both produce a `.vsix` and the head file list equals the trunk file list.
- [ ] Lane 2. Open the gallery in light theme and screenshot it with headless Edge. Save `p0-3-light.png`. Pass when every component renders and no text overflows its box.
- [ ] Lane 3. Gallery in dark theme. Save `p0-3-dark.png`. Pass when text contrast is at least 4.5 to 1 on body text per the check script output.
- [ ] Lane 4. Gallery with the VS Code dark variable set. Save `p0-3-vscode-dark.png`. Pass when colors come from the injected `--vscode-*` values.
- [ ] Lane 5. Gallery in VS Code high contrast. Save `p0-3-hc.png`. Pass when every interactive element has a visible border.
- [ ] Lane 6. Scroll a 500-row VirtualList. Save `p0-3-scroll.png`. Pass when the custom scrollbar shows and the DOM holds fewer than 60 rows.
- [ ] Lane 7. Tab through the gallery with the keyboard only. Save `p0-3-focus.png`. Pass when every control shows the focus ring in order.
- [ ] Lane 8. Open a Dialog and press Escape. Save `p0-3-dialog.png`. Pass when focus returns to the opener.
- [ ] Lane 9. Resize the gallery to 320 px wide. Save `p0-3-narrow.png`. Pass when no horizontal scroll appears.
- [ ] Lane 10. Read `docs/copy-guide.md` against `pstack/skills/technical-writing/SKILL.md`. Save `p0-3-copy.txt`. Pass when every glossary term from README section 5.8 appears with one meaning.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Gzipped size of the UI kit CSS plus the JS of one page that uses every component. Trunk lacks the kit, so this is an absolute budget.
- [ ] Probe. Build the gallery with `vite build` three times and read the gzipped sizes from the build output.
- [ ] Baseline. Trunk has no kit. Record that the baseline is zero.
- [ ] Rule. More than 60 KB gzipped for CSS plus JS fails.

**Review gate.** None. P0-3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Build the CDP driver for VS Code and the LAN Hub app (P0-4)

**Depends on.** None.

**Files.**

- [ ] Create `tools/cdp/cdp.mjs`, `tools/cdp/vscode.mjs`, `tools/cdp/app.mjs`, `tools/cdp/record.mjs`, `tools/cdp/README.md`.
- [ ] Edit `test/vscode/run.js` to accept `--debug-port <n>` and pass `--remote-debugging-port` to VS Code.
- [ ] Edit `package.json` devDependencies to add `ffmpeg-static`.

**Build.**

- [ ] `cdp.mjs` connects to a DevTools endpoint with the built-in `WebSocket` of Node 22, lists targets, evaluates script, sends input events, and captures screenshots. It has no npm dependency.
- [ ] `vscode.mjs` launches VS Code with a scratch `--user-data-dir`, `--extensionDevelopmentPath`, and a debug port. It exposes `runCommand(id, ...args)`, `screenshot(path)`, `webview(viewId)` (enters the webview iframe), `click(selector)`, `type(text)`, and `close()`.
- [ ] `app.mjs` launches the LAN Hub app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<n>` and exposes the same verbs. It is a stub that errors with "LAN Hub app not built" until A7.
- [ ] `record.mjs` starts a CDP screencast, writes frames, and encodes `out.mp4` with `ffmpeg-static`.
- [ ] `README.md` documents each verb as reference.

**You see.**

- [ ] `node tools/cdp/vscode.mjs --shot out.png` opens VS Code with the extension and writes a screenshot of the workbench.
- [ ] `node tools/cdp/record.mjs --seconds 10 vscode` writes a playable `out.mp4`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `node --test tools/cdp/cdp.test.mjs` starts headless Edge on a local page, clicks a button, and asserts the DOM changed.
- [ ] `npm test` still passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `npm run test:vscode` at trunk and at head without `--debug-port`. Save `p0-4-regression.txt`. Pass when both pass.
- [ ] Lane 2. Launch VS Code through `vscode.mjs` and screenshot. Save `p0-4-workbench.png`. Pass when the LAN Collab activity bar icon is visible.
- [ ] Lane 3. Run `lanCollab.openChat` through `runCommand`. Save `p0-4-chat.png`. Pass when the chat view shows "Chưa kết nối hub".
- [ ] Lane 4. Enter the chat webview iframe and type into the composer. Save `p0-4-type.png`. Pass when the typed text appears in the textarea.
- [ ] Lane 5. Run two VS Code instances with separate user data folders against one hub. Save `p0-4-two.png`. Pass when each sees the other in the member list.
- [ ] Lane 6. Record 10 seconds while lane 5 edits. Save `p0-4-record.png` (a frame grab) and `p0-4.mp4`. Pass when the mp4 plays and lasts at least 9 seconds.
- [ ] Lane 7. Kill VS Code mid-session. Save `p0-4-kill.txt`. Pass when `vscode.mjs` exits with a clear error and no orphan `Code.exe`.
- [ ] Lane 8. Run `app.mjs`. Save `p0-4-app.txt`. Pass when it exits with "LAN Hub app not built".
- [ ] Lane 9. Screenshot VS Code in high contrast theme set through settings. Save `p0-4-hc.png`. Pass when the screenshot reflects the theme.
- [ ] Lane 10. Run every verb listed in `tools/cdp/README.md`. Save `p0-4-verbs.txt`. Pass when each verb runs once without error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from `vscode.mjs` launch to the first screenshot written. Trunk lacks the tool, so this is an absolute budget.
- [ ] Probe. Launch and screenshot five times and record each time.
- [ ] Baseline. Trunk has no tool. Record that the baseline is absent.
- [ ] Rule. A median above 20 seconds fails, because every later live lane pays this cost.

**Review gate.** None. P0-4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root reports merge-ready and the operator lands it.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Create the branches `upgrade/hub` and `upgrade/extension` from the `main` SHA that holds P0-4, and report the SHA to the operator.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

No prototype ran during planning. Three questions stay unproven and the owners settle them first.

- Whether WebView2 accepts `--remote-debugging-port` through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` inside a Tauri 2 app on this machine. P0-4 lane 8 only proves the stub. A7 proves the real path.
- Whether `vsce package --no-dependencies` works with npm workspaces at the repo root. P0-3 lane 1 settles it.
- Whether UDP broadcast reaches other machines on the operator's LAN. Some access points isolate clients. P0-2 lane 6 settles it when the operator provides a second machine.

## Appendix B. Alternatives rejected

- Keeping the in-process hub tests and writing a second suite for the Rust hub. Two suites drift. One black-box suite proves both hubs behave the same.
- Playwright for the CDP driver. It downloads its own browsers and does not attach to VS Code's Electron cleanly. A 300-line CDP client with Node's built-in WebSocket is enough.
- Writing the v2 spec without changing the Node hub. Branch B would then have no hub to test against until A2 lands, and the branches would not run in parallel.
- Putting the copy guide inside the extension. LAN Hub needs the same glossary, so it lives in `docs/`.

## Appendix C. Risks

- P0-1. Spawning a child hub per test file makes the suite slower and adds orphan-process risk on Windows. The owner watches lane 7 and the perf rule.
- P0-2. The Node hub carries two protocol versions until I1. The owner keeps the proto 1 branch byte-identical to 0.1.1 output, proven by lane 1 and lane 2.
- P0-2. UDP port 8201 needs a firewall rule. The LAN Hub app adds it in A9. Until then the operator adds it by hand for lane 6.
- P0-3. The UI kit is designed before its first consumer. B2 and A7 may need changes. Changes to the kit after P0-3 land on the branch that needs them and merge back at I1.
- P0-4. VS Code updates can change workbench DOM selectors. The driver selects by command and view id where it can and keeps DOM selectors in one table.

## Appendix D. Links and reading list

- `docs/plans/README.md` for decisions, the impact map, and the pstack mapping.
- The client and hub survey findings are summarized in README section 4. Owners re-read `hub/hub.js`, `lib/common.js`, and `lib/client-core.js` before editing.
- P0-2 gets `pstack/skills/how/SKILL.md` before the spec is written and `pstack/skills/interrogate/SKILL.md` on the finished spec.
- The decision trail follows `pstack/skills/show-me-your-work/SKILL.md` and lives at `docs/plans/trail/P0.tsv`.
