# tools/cdp

Drives VS Code (Electron) and, from A7, the LAN Hub app (WebView2) through the Chrome DevTools Protocol, to take screenshots and record videos for live verification lanes. No npm dependency except `ffmpeg-static` for video encoding.

| File | Role |
|---|---|
| `cdp.mjs` | CDP client on Node's built-in `WebSocket`: targets, sessions, evaluate, input, screenshot. |
| `vscode.mjs` | Launches VS Code with the extension under development and a debug port; module and CLI. |
| `bridge/` | Dev-only helper extension that `vscode.mjs` loads next to the real one, so `runCommand` can call extension commands. Never packaged (`tools/**` is in `.vscodeignore`). |
| `app.mjs` | Same verbs for the LAN Hub app. Exits with `LAN Hub app not built` until A7 builds it. |
| `record.mjs` | Screencast frames to `mp4` with `ffmpeg-static`; module and CLI. |
| `cdp.test.mjs` | `node --test tools/cdp/cdp.test.mjs`: drives headless Edge on a local page. |

Requires Node 22 or newer, VS Code at `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe` (or `exe`/`--exe`), and `npm install` for `ffmpeg-static`. Import with `file:` URLs or relative paths (`import { launch } from './tools/cdp/vscode.mjs'`).

## How `runCommand` reaches extension commands

Extension commands run in the extension host, a separate Node process that the workbench renderer reached over CDP cannot call. Typing in the command palette works but takes no arguments, returns nothing, and depends on the localized title. So `launch()` passes a second `--extensionDevelopmentPath` for `bridge/`. The bridge listens on a random loopback port and writes `{port, token}` to `<user-data-dir>/User/globalStorage/ndqitisme-dev.lan-collab-cdp-bridge/bridge.json`. `runCommand(id, ...args)` posts `{id, args}` with the token, and the bridge runs `vscode.commands.executeCommand`. Environment variables set on `Code.exe` do not reach the extension host of a normal window, which is why the handoff is a file. `palette(text)` remains for checks that must go through the palette UI.

## vscode.mjs module

```js
import { launch, attach } from './tools/cdp/vscode.mjs';
const vs = await launch({ folder: 'C:/scratch/alice', settings: { 'lanCollab.name': 'Alice' } });
```

### `launch(opts) -> VSCode`

Starts `Code.exe` with a scratch `--user-data-dir` and `--extensions-dir`, `--extensionDevelopmentPath=<repo>` plus the bridge, `--remote-debugging-port`, `--disable-workspace-trust`, `--skip-welcome`, `--skip-release-notes`, `--new-window` and the folder. It resolves when the workbench DOM is up.

| Option | Default | Meaning |
|---|---|---|
| `folder` | `<scratch>/workspace` | Folder opened as the workspace. Put `.vscode/settings.json` in it for workspace settings. |
| `settings` | `{}` | User settings merged over quiet defaults (no startup editor, no AI features, no telemetry or updates) and written to `<user-data-dir>/User/settings.json` before launch. |
| `scratch` | new `%TEMP%\lc-cdp-*` | Parent of `user-data`, `extensions`, `workspace`. A folder created by `launch()` is deleted on `close()`; a given one is kept. |
| `userDataDir`, `extensionsDir` | under `scratch` | Override either folder. |
| `port` | free port | DevTools port. |
| `exe` | default install path | `Code.exe` to start. |
| `extensionDevelopmentPath` | repo root | Path or array of paths of the extension(s) under development. |
| `args`, `env` | none | Extra command line arguments and environment. |
| `timeout` | 60000 | Milliseconds to wait for the workbench. |

Every launched instance is a separate VS Code main process because its user data folder is new, so several instances run side by side and never join the user's own window.

### `attach({ port, userDataDir }) -> VSCode`

Connects to a VS Code already started with `--remote-debugging-port` (for example `node test/vscode/run.js --debug-port 9333`). `close()` then only disconnects. `runCommand` works only if that instance loaded the bridge and `userDataDir` points at its profile.

### Verbs of `VSCode`

| Verb | Does |
|---|---|
| `runCommand(id, ...args)` | Runs any command through the bridge with JSON arguments and resolves to its JSON result (`null` for none). Rejects with `command <id> failed: ...` when the command throws. |
| `palette(text)` | Opens the command palette (Ctrl+Shift+P), types `text`, presses Enter on the first match. Example: `palette('LAN Collab: Xem nhật ký')`. |
| `screenshot(path)` | Writes a PNG of the whole workbench window and resolves to the buffer. Omit `path` to only get the buffer. |
| `webview(viewId)` | Runs `<viewId>.focus`, finds the webview iframe drawn over that view, attaches to its out-of-process target, and resolves to a `Webview` handle. |
| `click(selector)` | Clicks the centre of the first workbench element matching the CSS selector, with real mouse events. |
| `type(text)` | Inserts text into the focused element (`Input.insertText`), including inside a focused webview. |
| `press(key, modifiers)` | Sends a key down/up. Keys: `Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, arrows, `Home`, `End`, `F1`, letters, digits. Modifiers: `Control`, `Shift`, `Alt`, `Meta`. |
| `evaluate(exprOrFn, args)` | Runs a string or function (called with JSON `args`) in the workbench renderer and resolves to the JSON result. |
| `waitFor(exprOrFn, { timeout })` | Polls `evaluate` until truthy; resolves to that value. |
| `close()` | Kills the VS Code process tree (descendants by parent PID plus any process whose command line names the scratch user data folder) and deletes the scratch folder it created. |

Fields: `pid`, `port`, `userDataDir`, `folder`, `page` (the workbench `Session`), `cdp`.

If VS Code dies, every later verb rejects with `VS Code (pid N) exited unexpectedly (exit code X); cannot <verb>`. Call `close()` anyway to remove leftover child processes. A process exit hook kills instances that were never closed.

### Verbs of `Webview`

| Verb | Does |
|---|---|
| `evaluate(exprOrFn, args)` | Runs in the webview content document (the `active-frame` iframe), in an isolated world: full DOM access, page JS globals not visible. |
| `waitFor(exprOrFn, { timeout })` | Polls `evaluate`. |
| `click(selector)` | Clicks the element with mouse events on the workbench, at webview box + content frame offset + element centre. |
| `type(text)`, `press(key, modifiers)` | Keyboard input to the focused element. Click the target first. |

Fields: `session` (the webview target), `frameId`.

### Workbench selectors

All DOM selectors live in `SELECTORS` in `vscode.mjs`. When a VS Code update breaks a verb, fix that table. A view pane is found by its header icon class `view-<viewId with . and : as ->`.

## vscode.mjs CLI

```
node tools/cdp/vscode.mjs [--folder <dir>] [--setting key=json]... [--exe <Code.exe>] [--port <n>]
                          [--command <id>] [--palette <text>] [--webview <viewId>] [--click <css>]
                          [--type <text>] [--press <key>] [--wait <ms>] [--shot <file.png>] [--hold <seconds>]
```

Steps run in the order given. `--click`, `--type`, `--press` after `--webview` act inside that webview. `--setting` values are JSON when they parse, else strings. `--hold` keeps the window open and fails if VS Code dies meanwhile. The process exits 1 with `vscode.mjs: <message>` on any error and always closes VS Code.

```
node tools/cdp/vscode.mjs --shot out.png
node tools/cdp/vscode.mjs --command lanCollab.openChat --wait 1000 --shot chat.png
node tools/cdp/vscode.mjs --webview lanCollab.chat --click "#input" --type "xin chào" --shot type.png
node tools/cdp/vscode.mjs --setting "workbench.colorTheme=Default High Contrast" --shot hc.png
```

## record.mjs

Module:

| Export | Does |
|---|---|
| `startRecording(session, { dir, quality, fps })` | Takes a first frame, starts `Page.startScreencast`, saves JPEG frames. Resolves to `{ stop(out) }`. `stop` encodes H.264 `mp4` at `fps` (25), holding each frame until the next so the video runs in real time even when the screen is idle, and resolves to `{ out, frames, seconds }`. |
| `record(session, { seconds, out })` | `startRecording`, wait, `stop`. |
| `mediaDuration(file)` | Duration in seconds, read by ffmpeg. |
| `frameGrab(video, png, atSeconds)` | Writes one PNG frame of a video. |
| `ffmpegPath()` | Path of the `ffmpeg-static` binary. |

`session` is `vs.page`, `app.page`, or any `cdp.mjs` page session.

CLI:

```
node tools/cdp/record.mjs [--seconds 10] [--out out.mp4] [--frame grab.png] [--port <n> | vscode [--folder <dir>] | app]
```

`vscode` (default) launches a fresh VS Code, records, and closes it. `--port` attaches to the workbench (or first page) of a running instance, for example one opened by `vscode.mjs --hold` or by your own script. `--frame` writes a PNG from the middle of the video.

## app.mjs

`launch({ exe, port, args, env })` starts the LAN Hub app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<n>` and attaches to its first page target. The executable is `LANHUB_APP_EXE`, or `LanHub.exe` under `lanhub/target/{release,debug}` or `lanhub/app/src-tauri/target/{release,debug}`. With none found it throws `LAN Hub app not built`. Verbs: `screenshot(path)`, `click(selector)`, `type(text)`, `press(key, modifiers)`, `evaluate(exprOrFn, args)`, `waitFor(exprOrFn, opts)`, `close()`. The app window is itself the webview, so there is no `webview()` or `runCommand()`. CLI: `node tools/cdp/app.mjs --shot out.png`. Until A7 this path is unproven against a real WebView2 app.

## cdp.mjs

| Export | Does |
|---|---|
| `listTargets(port)`, `browserVersion(port)` | `GET /json/list`, `/json/version`. |
| `waitForEndpoint(port, { timeout, alive })` | Polls `/json/version`; `alive()` returning a message aborts early. |
| `CDP.connectPort(port)`, `CDP.connect(wsUrl)` | Opens the browser-level socket. |
| `cdp.attach(targetId) -> Session` | Flattened session on a target, with `Runtime` enabled. |
| `cdp.targets()`, `cdp.send(method, params, sessionId)`, `cdp.onEvent(fn)`, `cdp.close()` | Raw access. A closed socket rejects pending and later calls with `DevTools connection closed ... [during <method>]`. |
| `Session` | `send`, `on(event, fn)`, `evaluate(exprOrFn, args, { contextId })`, `waitFor`, `mouse(x, y)`, `rect(selector)`, `click(selector)`, `type(text)`, `press(key, modifiers)`, `screenshot(path)`. |
| `waitFor(fn, { timeout, interval, what })`, `freePort()`, `sleep(ms)` | Helpers. |

## Two VS Code members against one hub

```js
import fs from 'node:fs';
import { launch } from './tools/cdp/vscode.mjs';
// hub: node hub/hub.js --root C:/scratch/root --port 8299 --project Demo
const member = async (name) => {
  const folder = `C:/scratch/${name}`;
  fs.mkdirSync(`${folder}/.vscode`, { recursive: true });
  fs.writeFileSync(`${folder}/.vscode/settings.json`, JSON.stringify({ 'lanCollab.server': '127.0.0.1:8299', 'lanCollab.project': 'Demo' }));
  return launch({ folder, settings: { 'lanCollab.name': name } });
};
const [a, b] = await Promise.all([member('Alice'), member('Bob')]);
await a.runCommand('workbench.view.extension.lanCollab');
```
