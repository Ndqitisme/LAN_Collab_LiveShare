# Integration and 0.2.0 release plan

This plan joins the two upgrade branches into `main` and ships 0.2.0. `upgrade/hub` brings the Rust LAN Hub and `upgrade/extension` brings extension 0.2. After the merge the Node hub and the old invite formats are deleted, the conformance suite runs only against `lanhub-cli`, and the README describes the new install and join flow. Users get one release where the LAN Hub app, the headless server, and the extension all speak protocol v2. Decisions and the impact map live in `docs/plans/README.md`. PR ids in order are I1 and I2.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator merges every PR and pushes every tag. Agents build, verify, and stop at merge-ready. I1 and I2 are both operator items that stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from the pinned pstack clone at program start. Re-read them at every tick. The clone is `cursor/plugins` at `C:\Users\BDT-QUY\src\cursor-plugins`, checked out at `6b03002` and never fetched, so `origin/main` stays at `6b03002`. Each read is `git show origin/main:<path>` run inside the clone, written below with `git -C`.
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/shipping.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/technical-writing/SKILL.md`
  - [ ] `git -C "C:\Users\BDT-QUY\src\cursor-plugins" show origin/main:pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md`
  - [ ] Read `tools/cdp/README.md` from `main`. It replaces the `control-ui` skill for this repo.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `claude-opus-5-5`. The I1 owner runs at effort `high` because I1 deletes the old hub and changes the default test target.
- [ ] Follow this dependency graph.
  - [ ] I1 after A10 merges into `upgrade/hub` and B9 merges into `upgrade/extension`.
  - [ ] I2 after I1 merges into `main`.
- [ ] Hold the file boundaries.
  - [ ] I1 touches only the merge result of both branches, `test/support/hub-process.js`, `lib/common.js`, the callers of `decodeInvite` in `extension/src/**`, `README.md`, `README.en.md`, `docs/upgrade-0.2.md`, `package.json` scripts, and the deletions it names.
  - [ ] I2 touches only version fields in `package.json`, `lanhub/Cargo.toml`, `lanhub/app/src-tauri/tauri.conf.json`, `CHANGELOG.md`, and `tools/package-lanhub.mjs` if the smoke install finds a packaging defect.
- [ ] Hold the review gate. I1 and I2 change interactions. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. `gh` is not installed on this machine and `origin` CLI is absent. The owner commits on a local branch named `i/<pr-id>` and the operator pushes and merges. Record this fallback in the decision trail.
- [ ] Open the PR ready, never draft, per **Opening a PR**, once the operator pushes the branch. Until then the merge-ready report carries the branch name, head SHA, and PR body.
- [ ] Run `npm test` and `cargo test --workspace --manifest-path lanhub/Cargo.toml` once before the merge-ready report. Commit with hooks on.
- [ ] Run a deslop pass before each commit and a no-comments pass before review. Both are manual reads of the diff against `pstack/skills/no-comments/SKILL.md` and the comment rules in `C:\Users\BDT-QUY\.claude\CLAUDE.md`.
- [ ] Triage reviewer comments per `../references/bugbot-triage.md` from the pstack clone. This repo has no Bugbot. I1 gets one reviewer on `claude-opus-5-5` at effort `high` in a fresh context.
- [ ] Do not rebase I1. It is a merge, so it is never rebased. I2 rebases onto current `main` before its code-ready report. A conflict found at merge prep is resolved by a new merge commit on `i/I1`.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. A full swarm here is one verifier agent on `claude-opus-5-5` that runs the gates lane, the ten live lanes from the PR's **Verify, live** block in order, the perf lane, and two audit lanes that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR.
- [ ] Stop at merge-ready with a clean verdict at the exact head SHA. The operator lands the PR. A rebase that keeps the patch-id unchanged keeps the verdict, per the patch-id rule in `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on this Windows 10 machine at the PR head, in its own scratch folder under the session scratchpad.

- [ ] Run `git worktree add <scratch>/i-<pr-id> <head SHA>`, then `npm install` in the worktree.
- [ ] Run `cargo build -p lanhub-cli --release --manifest-path lanhub/Cargo.toml`. Start a hub with `lanhub/target/release/lanhub-cli --config <scratch>/lanhub.toml --port 0 --log-format json` and read the port from the `listening` line.
- [ ] Start the LAN Hub app through `node tools/cdp/app.mjs` and each VS Code member through `node tools/cdp/vscode.mjs` with its own `--user-data-dir`. Deliver input only through `tools/cdp/` verbs. Read-only diagnostics are the hub log, the Output channel "LAN Collab", and the project folders on disk.
- [ ] Save every screenshot or log to `<scratch>/swarm-<pr-id>/worker-<n>/<slug>.<png or txt>` and return the paths with the report.

## Merge both branches and remove the Node hub (I1)

**Depends on.** A10 and B9.

**Files.**

- [ ] Edit `test/support/hub-process.js` so the default `LANHUB_CMD` is `lanhub/target/release/lanhub-cli`.
- [ ] Edit `lib/common.js` to delete `decodeInvite` for v1 and v2 codes and the binary invite writer.
- [ ] Edit every caller of the deleted functions under `extension/src/**`.
- [ ] Edit `README.md` and `README.en.md`.
- [ ] Create `docs/upgrade-0.2.md`.
- [ ] Edit `package.json` scripts `hub`, `package:hub`, and `package:all`.
- [ ] Delete `hub/hub.js`, `hub/start-hub.bat`, `hub/start-hub.sh`, `tools/package-hub.js`.

**Build.**

- [ ] Merge `upgrade/hub` into `i/I1` with `git merge --no-ff`, then merge `upgrade/extension` the same way. Keep both histories. Record each conflict and its resolution in the decision trail.
- [ ] Point the conformance suite at `lanhub-cli` by default. Keep `LANHUB_CMD` so a developer can still point it elsewhere.
- [ ] Delete the Node hub files and the proto 1 code path they carried. Replace the `hub` script with `cargo run -p lanhub-cli --manifest-path lanhub/Cargo.toml --` and `package:hub` with `node tools/package-lanhub.mjs`.
- [ ] Delete invite v1 and v2 decoding per the **migrate-callers-then-delete-legacy-apis** principle. A pasted `LC-` code now gets the catalog message `invite.legacy`, which says the code comes from LAN Hub 0.1 and asks for a new code from the LAN Hub app.
- [ ] Rewrite both READMEs in this order. Install the LAN Hub app, add a project, open the firewall from the app, run the headless server, install the extension, join with an invite code, read the connection diagnostics, use the edit-run history, troubleshoot. The Vietnamese README follows `docs/copy-guide.md`. The English README follows `pstack/skills/technical-writing/SKILL.md`.
- [ ] Write `docs/upgrade-0.2.md` as a how-to. Install the LAN Hub app, use the import button on the old hub folder to read `token-<project>.txt` and `allowed-accounts-<project>.txt`, let the app add the TCP and UDP firewall rules, update every member to extension 0.2. It states that the project folder and `.lan-collab/` stay where they are and that `hub.json` keeps its id, so members do not resync from scratch.

**You see.**

- [ ] `npm test` runs every conformance file against `lanhub-cli` and prints OK for each.
- [ ] `git ls-files hub` prints nothing.
- [ ] Pasting an `LC-` code in the join box shows the `invite.legacy` message and changes no file.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `npm test`, `npm run test:vscode`, and `cargo test --workspace --manifest-path lanhub/Cargo.toml`. All pass.
- [ ] `test/ot.test.js` loses the v1 and v2 invite cases and gains one case that asserts an `LC-` code decodes to `null`. Run `node test/ot.test.js`.
- [ ] `node tools/check-strings.mjs` passes after the README and catalog edits.
- [ ] `git grep -n "hub/hub.js\|start-hub\|decodeInvite(" -- . ":!docs/plans" ":!CHANGELOG.md"` prints nothing.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the load-bearing scenario at trunk (Node hub, extension 0.1.1) and at head (LAN Hub app, extension 0.2). Three members open `a.py`, each types 200 characters at once, then one closes VS Code and edits the file on disk. Save `i1-regression.png`. Pass when every member and the hub disk hold the same text at both trunk and head.
- [ ] Lane 2. Add a project in the LAN Hub app, copy its invite code, and join from an empty folder in a fresh VS Code profile. Save `i1-join.png`. Pass when the folder holds every project file and the status bar shows the live state.
- [ ] Lane 3. Use the import button on a copy of a 0.1 hub folder with `token-MyProject.txt` and `allowed-accounts-MyProject.txt`. Save `i1-import.png`. Pass when the project appears with the same token and allow list, and a member that joined the 0.1 hub reconnects without a first-time sync dialog.
- [ ] Lane 4. Stop the hub, change the machine's IP with a second network adapter, start the hub. Save `i1-rediscover.png`. Pass when members reconnect through UDP discovery with no user action.
- [ ] Lane 5. Run `lanhub-cli` headless with TLS on, join with a v3 invite carrying the fingerprint. Save `i1-tls.png`. Pass when the member reaches the live state and the diagnostics panel shows the pinned fingerprint.
- [ ] Lane 6. Edit `a.py` as member A, then as member B, then open the history panel on member C. Save `i1-history.png`. Pass when two runs show with the right authors and reverting A's run keeps B's text.
- [ ] Lane 7. Paste an old `LC-` invite code. Save `i1-legacy.png`. Pass when the `invite.legacy` message shows and the folder is unchanged.
- [ ] Lane 8. Open `http://127.0.0.1:<port>/` in Edge while the hub runs. Save `i1-diag-page.png`. Pass when the page shows the hub version and the advertised projects.
- [ ] Lane 9. Follow every step of `docs/upgrade-0.2.md` on a scratch copy of a 0.1 setup. Save `i1-upgrade.txt`. Pass when each step produces the result the doc states, with no step missing.
- [ ] Lane 10. Follow every step of the Vietnamese README install section on a clean Windows user profile. Save `i1-readme.png`. Pass when the reader reaches a joined project without reading any other doc.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `ackRttP99` and `fanoutP99` from `tools/loadgen.mjs` with 10 clients at 20 ops per second, and initial sync time for a 5000-file, 200 MB project into an empty folder.
- [ ] Probe. Run the loadgen and the sync five times against the trunk Node hub and five times against head `lanhub-cli`, interleaved.
- [ ] Baseline. Record the trunk medians first.
- [ ] Rule. A head `ackRttP99` above trunk or above 5 ms fails. A head initial sync slower than trunk fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 3, and lane 6 screenshots into `docs/plans/media/I1-review-join.png`, `docs/plans/media/I1-review-import.png`, and `docs/plans/media/I1-review-history.png`.
- [ ] Record a 30 to 60 second video of lane 2 with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/I1-review.mp4`.
- [ ] Post the screenshots, the video, and the rendered README diff in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done, with the `high` reviewer's findings answered.
- [ ] Both merge commits present in `git log --merges` at head.
- [ ] The root reports merge-ready and the operator lands it with a merge commit, not a squash.

## Release 0.2.0 (I2)

**Depends on.** I1.

**Files.**

- [ ] Edit `package.json` version to `0.2.0`.
- [ ] Edit `lanhub/Cargo.toml` workspace version to `0.2.0`.
- [ ] Edit `lanhub/app/src-tauri/tauri.conf.json` version to `0.2.0`.
- [ ] Edit `CHANGELOG.md`.

**Build.**

- [ ] Bump the three versions in one commit. `welcome.hubVersion` and the extension's reported version come from these fields.
- [ ] Write the `0.2.0` CHANGELOG entry per `docs/copy-guide.md`. Group it under LAN Hub, Extension, Connection and diagnostics, Edit-run history, Interface, and Breaking changes. Breaking changes state that extension 0.2 and LAN Hub 0.1 do not work together and link `docs/upgrade-0.2.md`.
- [ ] Run `npm run package:all`. It writes `dist/lan-collab-0.2.0.vsix`, `dist/LanHub_0.2.0_x64-setup.exe`, `dist/lanhub-cli-0.2.0-x86_64-pc-windows-msvc.zip`, and `dist/lanhub-cli-0.2.0-x86_64-unknown-linux-gnu.tar.gz`. The Linux archive builds in CI on `ubuntu-latest`. The release report notes where each file came from.
- [ ] Write the tag instructions for the operator in the merge-ready report. The commands are `git tag -a v0.2.0 -m "LAN Collab 0.2.0"` and `git push origin v0.2.0`. The agent does not push.

**You see.**

- [ ] `dist/` holds the four artifacts and the vsix, each named with `0.2.0`.
- [ ] The LAN Hub about screen and the extension Output channel both report `0.2.0`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `node tools/check-versions.mjs` (scratch) reads the three version fields and fails unless all equal `0.2.0`. Run it at head.
- [ ] Run `npm test` and `cargo test --workspace --manifest-path lanhub/Cargo.toml`. Both pass.
- [ ] `npx vsce ls` lists no file under `packages/`, `lanhub/`, or `extension/webview-src/`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claude-opus-5-5` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the I1 lane 1 scenario with the packaged artifacts instead of the dev build. Trunk has no packaged 0.2 artifacts, so record that and gate the packaged scenario plus the end state where all members converge. Save `i2-regression.png`. Pass when all members and the hub disk converge.
- [ ] Lane 2. Run `LanHub_0.2.0_x64-setup.exe` on a clean Windows user profile. Save `i2-install.png`. Pass when the app starts from the Start menu and shows an empty project list.
- [ ] Lane 3. Run the installer on a machine without the WebView2 runtime, or simulate one by blocking the runtime path. Save `i2-webview2.png`. Pass when the bootstrapper installs WebView2 and the app starts.
- [ ] Lane 4. Install `lan-collab-0.2.0.vsix` with `code --install-extension` in a clean profile. Save `i2-vsix.png`. Pass when the LAN Collab view opens with the setup panel.
- [ ] Lane 5. Unzip `lanhub-cli-0.2.0-x86_64-pc-windows-msvc.zip` and run `lanhub-cli --version`. Save `i2-cli-win.txt`. Pass when it prints `0.2.0`.
- [ ] Lane 6. Extract the Linux archive on the Linux host named in README section 8 or the CI runner and run `lanhub-cli --version`. Save `i2-cli-linux.txt`. Pass when it prints `0.2.0`.
- [ ] Lane 7. Uninstall the LAN Hub app. Save `i2-uninstall.png`. Pass when the app is gone and `%APPDATA%\LanHub\lanhub.toml` and every project folder remain.
- [ ] Lane 8. Read the CHANGELOG entry against `docs/copy-guide.md`. Save `i2-changelog.txt`. Pass when no line uses a banned pattern and every breaking change links the upgrade doc.
- [ ] Lane 9. Connect an extension 0.1.1 to LAN Hub 0.2.0. Save `i2-old-client.png`. Pass when the 0.1.1 toast says the protocol version differs and no file changes.
- [ ] Lane 10. Run the installer over an existing 0.2.0 install. Save `i2-reinstall.png`. Pass when projects and settings survive and the hub starts.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Installer size, app cold start time to first paint, and app idle memory with one project and three members.
- [ ] Probe. Measure each value five times on the packaged build at head and on the I1 dev build, interleaved.
- [ ] Baseline. Record the I1 dev build values first. Trunk has no installer, so installer size is an absolute budget.
- [ ] Rule. An installer above 15 MB fails. A cold start above 1.5 seconds fails. Idle memory above 120 MB fails.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 4 screenshots into `docs/plans/media/I2-review-install.png` and `docs/plans/media/I2-review-vsix.png`.
- [ ] Record a 30 to 60 second video of the clean install and first join with `node tools/cdp/record.mjs`. Save it as `docs/plans/media/I2-review.mp4`.
- [ ] Post the screenshots, the video, the artifact list with sizes, and the tag commands in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Reviewer triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The operator lands I2, then tags and publishes the artifacts.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Report the `main` SHA of the 0.2.0 release to the operator as the base for `docs/plans/C-collab.md`.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

No prototype ran during planning. Three questions stay unproven.

- Whether the two branches merge with few conflicts. The file boundaries in `docs/plans/README.md` section 3 keep them apart, but `package.json` and `.gitignore` are touched by both P0 follow-ups. I1 records each conflict.
- Whether the Linux `lanhub-cli` archive can be built on this Windows machine. The plan builds it in CI. If CI is not pushed yet, the operator provides the archive or I2 ships without it and says so.
- Whether the WebView2 bootstrapper path can be tested on this machine, which already has WebView2 157. Lane 3 may need a second machine or a VM.

## Appendix B. Alternatives rejected

- Squash-merging each branch. It erases the per-PR history that the verdicts reference by SHA.
- Keeping the Node hub in the repo as a fallback. Two hubs drift, and the conformance suite would need to keep proving both. The README section 5.11 decision stands.
- Keeping v1 and v2 invite decoding. A v1 or v2 code points at a proto 1 hub that `lanhub` cannot serve, so decoding it only delays the error.
- Publishing the release from the agent. Pushing tags and uploading artifacts are outward actions, so the operator does them.

## Appendix C. Risks

- I1. Merge conflicts in `lib/client-core.js` if A-side fixes touched the client. The owner resolves them toward the B-side state machine and records each hunk.
- I1. `test:vscode` timing changes with the faster Rust hub can expose races in the extension. The owner runs the VS Code suites five times.
- I1. The README rewrite is long. The review gate covers it, and lane 10 proves a reader can follow it.
- I2. The NSIS installer may be flagged by SmartScreen because it is unsigned. The upgrade doc states this and how to proceed. Code signing is out of scope.
- I2. An uninstall that deletes `%APPDATA%\LanHub` would lose every project config. Lane 7 guards it.

## Appendix D. Links and reading list

- `docs/plans/README.md` for decisions, the impact map, and the pstack mapping.
- `docs/plans/A-lanhub.md` and `docs/plans/B-extension.md` for what each branch delivers.
- `docs/protocol.md` and `docs/copy-guide.md` from P0.
- I1 gets `pstack/skills/interrogate/SKILL.md` on the finished README and upgrade doc.
- The decision trail follows `pstack/skills/show-me-your-work/SKILL.md` and lives at `docs/plans/trail/I.tsv`.
