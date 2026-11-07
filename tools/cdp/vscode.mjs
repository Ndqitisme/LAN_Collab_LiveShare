// Launches VS Code (Electron) with the LAN Collab extension under development and drives it over CDP.
// Module: `const vs = await launch({ folder }); await vs.runCommand('lanCollab.openChat'); await vs.close();`
// CLI: `node tools/cdp/vscode.mjs --shot out.png [--folder <dir>]` (see README.md for every flag).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CDP, freePort, listTargets, sleep, waitFor, waitForEndpoint } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const BRIDGE = path.join(HERE, 'bridge');
export const DEFAULT_CODE_EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
const BRIDGE_ID = 'ndqitisme-dev.lan-collab-cdp-bridge';

// Every workbench DOM selector the driver depends on. VS Code updates may move these; fix them here.
export const SELECTORS = {
  workbench: '.monaco-workbench',
  quickInput: '.quick-input-widget',
  quickInputBox: '.quick-input-widget .quick-input-box input',
  quickInputRow: '.quick-input-widget .monaco-list-row',
  webviewFrame: 'iframe.webview',
  // The pane header icon carries `view-<viewId with . and : as ->`; the pane has no view id attribute.
  viewPane: (viewId) => `.pane:has(> .pane-header .view-${viewId.replace(/[.:]/g, '-')}) > .pane-body`,
};

// Quiet defaults for a scratch profile; callers' `settings` override them.
const BASE_SETTINGS = {
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'chat.disableAIFeatures': true,
  // With telemetry fully off VS Code hands every profile the same machineId, so two members would look like one.
  'telemetry.telemetryLevel': 'crash',
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'git.openRepositoryInParentFolders': 'never',
  'security.workspace.trust.enabled': false,
  // Native message boxes are invisible to CDP and block the window; custom dialogs are workbench DOM.
  'window.dialogStyle': 'custom',
};

// Kills `rootPid` and every descendant (Windows does not reparent, so a dead root's children are still
// found by ParentProcessId), plus any Code.exe whose command line names `marker` (the scratch profile).
export function killTree(rootPid, marker) {
  if (process.platform !== 'win32') {
    try { process.kill(rootPid, 'SIGKILL'); } catch { /* gone */ }
    return [];
  }
  const ps = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine
$set = [System.Collections.Generic.HashSet[int]]::new()
[void]$set.Add(${Number(rootPid) || -1})
$m = $env:LC_CDP_MARKER
if ($m) { foreach ($p in $all) { if ($p.CommandLine -and $p.CommandLine.Contains($m)) { [void]$set.Add([int]$p.ProcessId) } } }
do { $n = $set.Count; foreach ($p in $all) { if ($set.Contains([int]$p.ParentProcessId)) { [void]$set.Add([int]$p.ProcessId) } } } while ($set.Count -ne $n)
$live = @($all | Where-Object { $set.Contains([int]$_.ProcessId) })
foreach ($p in $live) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
($live | ForEach-Object { $_.ProcessId }) -join ','`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, LC_CDP_MARKER: marker || '' }, encoding: 'utf8', windowsHide: true,
  });
  return (r.stdout || '').trim().split(',').filter(Boolean).map(Number);
}

// Code.exe processes still alive whose command line contains `marker`.
export function processesWith(marker) {
  if (process.platform !== 'win32') return [];
  const ps = `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:LC_CDP_MARKER) } | ForEach-Object { $_.ProcessId }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, LC_CDP_MARKER: marker }, encoding: 'utf8', windowsHide: true,
  });
  return (r.stdout || '').split(/\s+/).filter(Boolean).map(Number);
}

// Which of `pids` the OS process list still shows.
export function stillListed(pids) {
  if (!pids.length || process.platform !== 'win32') return [];
  const ps = `Get-CimInstance Win32_Process -Filter "${pids.map((p) => `ProcessId=${Number(p)}`).join(' OR ')}" | ForEach-Object { $_.ProcessId }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').split(/\s+/).filter(Boolean).map(Number);
}

const live = new Set();
process.on('exit', () => {
  for (const vs of live) vs.killSync();
});

export async function launch(opts = {}) {
  const exe = opts.exe || DEFAULT_CODE_EXE;
  if (!fs.existsSync(exe)) throw new Error(`VS Code not found at ${exe} (pass exe or --exe)`);
  const scratch = opts.scratch || fs.mkdtempSync(path.join(os.tmpdir(), 'lc-cdp-'));
  const userDataDir = path.resolve(opts.userDataDir || path.join(scratch, 'user-data'));
  const extensionsDir = path.resolve(opts.extensionsDir || path.join(scratch, 'extensions'));
  const folder = path.resolve(opts.folder || path.join(scratch, 'workspace'));
  for (const d of [userDataDir, extensionsDir, folder]) fs.mkdirSync(d, { recursive: true });
  const userDir = path.join(userDataDir, 'User');
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify({ ...BASE_SETTINGS, ...(opts.settings || {}) }, null, 2));
  fs.rmSync(path.join(userDir, 'globalStorage', BRIDGE_ID, 'bridge.json'), { force: true });

  const port = opts.port || await freePort();
  const devPaths = [].concat(opts.extensionDevelopmentPath || REPO, BRIDGE);
  const args = [
    ...devPaths.map((p) => `--extensionDevelopmentPath=${path.resolve(p)}`),
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--remote-debugging-port=${port}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--new-window',
    ...(opts.args || []),
    folder,
  ];
  const env = { ...process.env, ...(opts.env || {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const startedAt = Date.now();
  const proc = spawn(exe, args, { env, stdio: 'ignore', windowsHide: false });
  const vs = new VSCode({ proc, port, userDataDir, extensionsDir, folder, scratch, ownsScratch: !opts.scratch, startedAt });
  live.add(vs);
  try {
    await vs.connect(opts.timeout || 60000);
    // The bridge writes its port once the extension host has activated the development extensions, so
    // waiting for it means contributed views and the activity bar icon are on screen.
    await vs.bridge(opts.timeout || 60000);
  } catch (e) {
    await vs.close();
    throw e;
  }
  return vs;
}

// Attaches to a VS Code already running with --remote-debugging-port (no process ownership; close()
// only disconnects). runCommand needs `userDataDir` to find the bridge.
export async function attach({ port, userDataDir, timeout = 30000 }) {
  const vs = new VSCode({ proc: null, port, userDataDir });
  await vs.connect(timeout);
  return vs;
}

export class VSCode {
  constructor(o) {
    Object.assign(this, o);
    this.pid = o.proc ? o.proc.pid : null;
    this.exited = null;
    if (o.proc) {
      o.proc.on('exit', (code, signal) => {
        this.exited = `VS Code (pid ${this.pid}) exited unexpectedly (exit code ${code}${signal ? `, signal ${signal}` : ''})`;
      });
      o.proc.on('error', (e) => { this.exited = `VS Code failed to start: ${e.message}`; });
    }
  }

  #check(op) {
    if (this.exited) throw new Error(`${this.exited}; cannot ${op}`);
    if (this.cdp && this.cdp.closed) throw new Error(`${this.cdp.closed}; cannot ${op}`);
  }

  // Runs fn, turning a process death during it into one clear error. A dropped DevTools socket usually means
  // the process is dying; Windows reports the exit only after teardown, so wait for it before blaming CDP.
  async #op(op, fn) {
    try {
      if (this.cdp && this.cdp.closed) throw new Error(this.cdp.closed);
      this.#check(op);
      return await fn();
    } catch (e) {
      if (this.proc && !this.exited) {
        await waitFor(() => this.exited, { timeout: this.cdp && this.cdp.closed ? 10000 : 300, interval: 100 }).catch(() => {});
      }
      if (this.exited) throw new Error(`${this.exited}; cannot ${op}`);
      throw e;
    }
  }

  async connect(timeout) {
    const alive = () => this.exited;
    await waitForEndpoint(this.port, { timeout, alive });
    const target = await waitFor(async () => {
      if (this.exited) throw Object.assign(new Error(this.exited), { fatal: true });
      return (await listTargets(this.port)).find((t) => t.type === 'page' && t.url.includes('/workbench/workbench.html'));
    }, { timeout, what: 'the workbench window target' }).catch((e) => { throw new Error(this.exited || e.message); });
    this.cdp = await CDP.connectPort(this.port);
    this.page = await this.cdp.attach(target.id);
    await this.page.send('Page.enable');
    await this.page.send('DOM.enable');
    await this.#op('wait for the workbench', () => this.page.waitFor(
      `!!document.querySelector('${SELECTORS.workbench}') && !!document.querySelector('.part.activitybar, .part.statusbar')`,
      { timeout },
    ));
  }

  async bridge(timeout = 30000) {
    if (this.bridgeInfo) return this.bridgeInfo;
    if (!this.userDataDir) throw new Error('runCommand needs userDataDir to locate the CDP bridge');
    const file = path.join(this.userDataDir, 'User', 'globalStorage', BRIDGE_ID, 'bridge.json');
    this.bridgeInfo = await waitFor(() => {
      this.#check('reach the command bridge');
      return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'));
    }, { timeout, what: `the CDP bridge extension (${file})` });
    return this.bridgeInfo;
  }

  // Executes any VS Code command (built-in or extension) through the dev-only bridge extension, with
  // JSON-serialisable args. Resolves to the command's JSON-serialisable result.
  runCommand(id, ...args) {
    return this.#op(`run command ${id}`, async () => {
      const { port, token } = await this.bridge();
      const res = await fetch(`http://127.0.0.1:${port}/command`, {
        method: 'POST', headers: { 'x-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ id, args }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(`command ${id} failed: ${body.error}`);
      return body.result;
    });
  }

  // Types into the command palette the way a user does and picks the first match ("LAN Collab: Mở chat").
  // The palette is opened by command, not Ctrl+Shift+P: a key event lands in whatever frame has focus,
  // and a focused webview does not pass it on to the workbench.
  palette(text) {
    return this.#op(`run "${text}" from the command palette`, async () => {
      await this.runCommand('workbench.action.showCommands');
      await this.page.waitFor(`!!document.querySelector('${SELECTORS.quickInputBox}') && document.querySelector('${SELECTORS.quickInput}').style.display !== 'none'`, { timeout: 5000 });
      await this.page.type(text);
      await this.page.waitFor(`document.querySelectorAll('${SELECTORS.quickInputRow}').length > 0`, { timeout: 5000 });
      await sleep(150);
      await this.page.press('Enter');
    });
  }

  screenshot(file) {
    return this.#op(`screenshot ${file || ''}`.trim(), () => this.page.screenshot(file));
  }

  evaluate(expr, args) {
    return this.#op('evaluate in the workbench', () => this.page.evaluate(expr, args));
  }

  click(selector) {
    return this.#op(`click ${selector}`, () => this.page.click(selector));
  }

  type(text) {
    return this.#op('type', () => this.page.type(text));
  }

  press(key, modifiers) {
    return this.#op(`press ${key}`, () => this.page.press(key, modifiers));
  }

  waitFor(expr, opts) {
    return this.#op('wait in the workbench', () => this.page.waitFor(expr, opts));
  }

  // Opens a webview view (`<viewId>.focus`) and returns a handle whose verbs run inside its content frame.
  webview(viewId, { timeout = 15000 } = {}) {
    return this.#op(`enter webview ${viewId}`, async () => {
      await this.runCommand(`${viewId}.focus`);
      const frameId = await waitFor(() => this.#webviewFrameId(viewId), { timeout, what: `webview frame for ${viewId}` });
      const target = await waitFor(async () => (await this.cdp.targets()).find((t) => t.targetId === frameId), { timeout, what: `webview target ${frameId}` });
      const session = await this.cdp.attach(target.targetId);
      await session.send('Page.enable');
      const wv = new Webview(this, session, frameId);
      await wv.contentContext(timeout);
      return wv;
    });
  }

  // The webview iframe drawn over the view pane: VS Code renders webviews in an overlay positioned on top of
  // the pane, so match by geometry. Its frame id is also its CDP target id (out-of-process iframe).
  async #webviewFrameId(viewId) {
    const idx = await this.page.evaluate((sel, paneSel) => {
      const pane = document.querySelector(paneSel);
      if (!pane) return -1;
      const p = pane.getBoundingClientRect();
      const frames = [...document.querySelectorAll(sel)];
      let best = -1;
      let bestArea = 0;
      frames.forEach((f, i) => {
        const r = f.getBoundingClientRect();
        const w = Math.min(r.right, p.right) - Math.max(r.left, p.left);
        const h = Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top);
        if (w > 0 && h > 0 && w * h > bestArea) { best = i; bestArea = w * h; }
      });
      return best;
    }, [SELECTORS.webviewFrame, SELECTORS.viewPane(viewId)]);
    if (idx < 0) return null;
    const { root } = await this.page.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await this.page.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: SELECTORS.webviewFrame });
    const { node } = await this.page.send('DOM.describeNode', { nodeId: nodeIds[idx] });
    return node.frameId || null;
  }

  killSync() {
    if (this.pid && !this.killed) {
      this.killed = true;
      this.killedPids = killTree(this.pid, this.userDataDir);
    }
  }

  // Kills the VS Code process tree started by launch() and removes the scratch profile it created.
  async close() {
    live.delete(this);
    if (this.cdp) this.cdp.close();
    if (!this.proc) return;
    this.killSync();
    // A killed process reports an exit code at once but stays in the process list for a few seconds while
    // Windows tears it down; wait until the list no longer shows any, so callers can assert "no orphan".
    const listed = () => stillListed(this.killedPids || []);
    await waitFor(() => listed().length === 0, { timeout: 30000, interval: 300 }).catch(() => {
      const left = listed();
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "${left.map((p) => `ProcessId=${p}`).join(' OR ')}" | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name) $($_.CommandLine)" }`], { encoding: 'utf8' });
      throw new Error(`VS Code processes still running after kill: ${left.join(', ')}\n${r.stdout}`);
    });
    if (this.ownsScratch && this.scratch) {
      try { fs.rmSync(this.scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* locked files: leave the temp folder */ }
    }
  }
}

// A webview's content document (VS Code nests it in an `active-frame` iframe inside the webview target).
export class Webview {
  constructor(vs, session, frameId) {
    this.vs = vs;
    this.session = session;
    this.frameId = frameId;
  }

  // Scripts run in an isolated world of the content frame: full DOM access, but the page's own JS globals
  // are not visible. VS Code swaps the content frame when the webview reloads, so the world is re-created
  // whenever the frame id changes.
  async contentContext(timeout = 15000) {
    return waitFor(async () => {
      const { frameTree } = await this.session.send('Page.getFrameTree');
      const child = (frameTree.childFrames || []).find((c) => c.frame.name === 'active-frame');
      if (!child) return null;
      if (this.ctx && this.ctx.frameId === child.frame.id) return this.ctx.id;
      const { executionContextId } = await this.session.send('Page.createIsolatedWorld', { frameId: child.frame.id, worldName: 'lc-cdp' });
      const ready = await this.session.evaluate('document.readyState === "complete" && !!document.body', [], { contextId: executionContextId });
      if (!ready) return null;
      this.ctx = { frameId: child.frame.id, id: executionContextId };
      return executionContextId;
    }, { timeout, what: 'the webview content frame' });
  }

  async evaluate(expr, args) {
    try {
      return await this.session.evaluate(expr, args, { contextId: await this.contentContext() });
    } catch (e) {
      if (!/context/i.test(e.message)) throw e;
      this.ctx = null;
      return this.session.evaluate(expr, args, { contextId: await this.contentContext() });
    }
  }

  waitFor(expr, opts = {}) {
    return waitFor(() => this.evaluate(expr), { what: typeof expr === 'string' ? expr : 'webview condition', ...opts });
  }

  // Input goes to the workbench page in its coordinates: webview iframe box + content frame offset + element.
  // Focusable targets are clicked until they hold focus: right after the webview is revealed (or a quick
  // input closes) the workbench moves focus asynchronously and can take it back from the first click.
  async click(selector) {
    const focusable = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && el.tabIndex >= 0 && !el.disabled; })()`;
    const focused = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return document.hasFocus() && !!el && el.contains(document.activeElement); })()`;
    for (let attempt = 0; ; attempt++) {
      const { model } = await this.vs.page.send('DOM.getBoxModel', {
        backendNodeId: (await this.vs.page.send('DOM.getFrameOwner', { frameId: this.frameId })).backendNodeId,
      });
      const [ox, oy] = model.content;
      const inner = await this.session.evaluate(`(() => { const r = document.getElementById('active-frame').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
      const contextId = await this.contentContext();
      const r = await this.session.rect(selector, { contextId });
      await this.vs.page.mouse(ox + inner.x + r.x + r.width / 2, oy + inner.y + r.y + r.height / 2);
      if (!await this.evaluate(focusable)) return;
      const ok = await waitFor(() => this.evaluate(focused), { timeout: 1000, interval: 50 }).then(() => true, () => false);
      if (ok) return;
      if (attempt === 2) throw new Error(`click ${selector}: the element did not keep focus after 3 clicks`);
    }
  }

  type(text) {
    return this.vs.page.type(text);
  }

  press(key, modifiers) {
    return this.vs.page.press(key, modifiers);
  }
}

function parseArgs(argv) {
  const o = { settings: {}, commands: [], steps: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--shot') o.steps.push(['shot', next()]);
    else if (a === '--folder') o.folder = next();
    else if (a === '--exe') o.exe = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--user-data-dir') o.userDataDir = next();
    else if (a === '--command') o.steps.push(['command', next()]);
    else if (a === '--palette') o.steps.push(['palette', next()]);
    else if (a === '--webview') o.steps.push(['webview', next()]);
    else if (a === '--click') o.steps.push(['click', next()]);
    else if (a === '--type') o.steps.push(['type', next()]);
    else if (a === '--press') o.steps.push(['press', next()]);
    else if (a === '--wait') o.steps.push(['wait', Number(next())]);
    else if (a === '--hold') o.hold = Number(next());
    else if (a === '--setting') {
      const kv = next();
      const eq = kv.indexOf('=');
      const raw = kv.slice(eq + 1);
      let v;
      try { v = JSON.parse(raw); } catch { v = raw; }
      o.settings[kv.slice(0, eq)] = v;
    } else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return o;
}

async function cli() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.steps.length && !o.hold) {
    console.log('Usage: node tools/cdp/vscode.mjs [--folder <dir>] [--setting key=json]... [--command <id>] [--palette <text>]\n'
      + '         [--webview <viewId>] [--click <css>] [--type <text>] [--press <key>] [--wait <ms>] [--shot <file.png>] [--hold <seconds>]\n'
      + 'Steps run in the order given; --click/--type/--press after --webview act inside that webview.');
    return;
  }
  const t0 = Date.now();
  const vs = await launch(o);
  let scope = vs;
  const stop = async (code) => { await vs.close(); process.exit(code); };
  process.on('SIGINT', () => stop(130));
  try {
    console.log(`launched pid ${vs.pid}, debug port ${vs.port}, user data ${vs.userDataDir}`);
    for (const [verb, arg] of o.steps) {
      if (verb === 'shot') {
        await vs.screenshot(arg);
        console.log(`screenshot ${path.resolve(arg)} (${Date.now() - t0} ms after launch)`);
      } else if (verb === 'command') console.log(`command ${arg} ->`, JSON.stringify(await vs.runCommand(arg)));
      else if (verb === 'palette') await vs.palette(arg);
      else if (verb === 'webview') scope = await vs.webview(arg);
      else if (verb === 'click') await scope.click(arg);
      else if (verb === 'type') await scope.type(arg);
      else if (verb === 'press') await scope.press(arg);
      else if (verb === 'wait') await sleep(arg);
    }
    if (o.hold) {
      console.log(`holding for ${o.hold} s`);
      const end = Date.now() + o.hold * 1000;
      while (Date.now() < end) {
        if (vs.exited) throw new Error(vs.exited);
        await sleep(250);
      }
    }
  } catch (e) {
    console.error(`vscode.mjs: ${e.message}`);
    await stop(1);
  }
  await stop(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((e) => {
    console.error(`vscode.mjs: ${e.message}`);
    process.exit(1);
  });
}
