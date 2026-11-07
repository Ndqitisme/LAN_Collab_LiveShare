// Launches the LAN Hub app (Tauri 2, WebView2) with a DevTools port and drives its window over CDP.
// CLI: `node tools/cdp/app.mjs [--config <lanhub.toml>] [--click <css>] [--type <text>] [--shot out.png] ...`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CDP, freePort, listTargets, sleep, waitFor, waitForEndpoint } from './cdp.mjs';
import { REPO, killTree } from './vscode.mjs';

export const NOT_BUILT = 'LAN Hub app not built';

// The page is ready once the app shell is mounted (lanhub/app/ui/src/App.svelte).
const READY = "!!document.querySelector('.shell')";

// LANHUB_APP_EXE wins; otherwise the newest LanHub.exe that cargo built (the app is a workspace member, so
// its output is lanhub/target/<profile>).
export function appExe() {
  if (process.env.LANHUB_APP_EXE) return fs.existsSync(process.env.LANHUB_APP_EXE) ? process.env.LANHUB_APP_EXE : null;
  const built = ['release', 'debug']
    .map((p) => path.join(REPO, 'lanhub', 'target', p, 'LanHub.exe'))
    .filter((p) => fs.existsSync(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return built[0] || null;
}

/**
 * Starts the app and attaches to its window. `config` passes `--config <file>`, so a test never touches
 * the real %APPDATA%\LanHub. Resolves once the app shell is in the DOM.
 */
export async function launch(opts = {}) {
  const exe = opts.exe || appExe();
  if (!exe) throw new Error(NOT_BUILT);
  const port = opts.port || await freePort();
  const args = [...(opts.config ? ['--config', opts.config] : []), ...(opts.args || [])];
  const env = { ...process.env, ...(opts.env || {}), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
  const startedAt = Date.now();
  const proc = spawn(exe, args, { env, stdio: opts.stdio || 'ignore' });
  const app = new App(proc, port, exe, startedAt);
  const timeout = opts.timeout || 30000;
  try {
    await waitForEndpoint(port, { timeout, alive: () => app.exited });
    const target = await waitFor(async () => {
      if (app.exited) throw Object.assign(new Error(app.exited), { fatal: true });
      return (await listTargets(port)).find((t) => t.type === 'page');
    }, { timeout, what: 'the LAN Hub window target' });
    app.cdp = await CDP.connectPort(port);
    app.page = await app.cdp.attach(target.id);
    await app.page.send('Page.enable');
    await app.page.waitFor(READY, { timeout });
  } catch (e) {
    await app.close();
    throw new Error(app.exited || e.message);
  }
  return app;
}

export class App {
  constructor(proc, port, exe, startedAt) {
    this.proc = proc;
    this.pid = proc.pid;
    this.port = port;
    this.exe = exe;
    this.startedAt = startedAt;
    this.exited = null;
    this.exitCode = null;
    proc.on('exit', (code) => {
      this.exitCode = code;
      this.exited = `LAN Hub app (pid ${this.pid}) exited (exit code ${code})`;
    });
    proc.on('error', (e) => { this.exited = `LAN Hub app failed to start: ${e.message}`; });
  }

  #check(op) {
    if (this.exited) throw new Error(`${this.exited}; cannot ${op}`);
  }

  screenshot(file) { this.#check('screenshot'); return this.page.screenshot(file); }

  evaluate(expr, args) { this.#check('evaluate'); return this.page.evaluate(expr, args); }

  waitFor(expr, opts) { this.#check('waitFor'); return this.page.waitFor(expr, opts); }

  click(selector) { this.#check('click'); return this.page.click(selector); }

  type(text) { this.#check('type'); return this.page.type(text); }

  press(key, modifiers) { this.#check('press'); return this.page.press(key, modifiers); }

  /** Calls a Tauri command of the app, as the UI does. */
  invoke(cmd, args = {}) {
    this.#check(`invoke ${cmd}`);
    return this.page.evaluate((c, a) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  }

  /** Resolves with the exit code once the process ends (for quit and single-instance checks). */
  async waitExit(timeout = 30000) {
    await waitFor(() => this.exited, { timeout, interval: 100, what: `LAN Hub app (pid ${this.pid}) to exit` });
    return this.exitCode;
  }

  /** Kills the process tree, WebView2 children included. */
  async close() {
    if (this.cdp) this.cdp.close();
    if (!this.exited) killTree(this.pid);
  }
}

function parseArgs(argv) {
  const o = { steps: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--shot') o.steps.push(['shot', next()]);
    else if (a === '--config') o.config = next();
    else if (a === '--exe') o.exe = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--click') o.steps.push(['click', next()]);
    else if (a === '--type') o.steps.push(['type', next()]);
    else if (a === '--press') o.steps.push(['press', next()]);
    else if (a === '--eval') o.steps.push(['eval', next()]);
    else if (a === '--wait') o.steps.push(['wait', Number(next())]);
    else if (a === '--hold') o.hold = Number(next());
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return o;
}

async function cli() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.steps.length && !o.hold) {
    console.log('Usage: node tools/cdp/app.mjs [--config <lanhub.toml>] [--exe <LanHub.exe>] [--port <n>]\n'
      + '         [--click <css>] [--type <text>] [--press <key>] [--eval <js>] [--wait <ms>] [--shot <file.png>] [--hold <seconds>]\n'
      + 'Steps run in the order given.');
    return;
  }
  const app = await launch(o);
  const stop = async (code) => { await app.close(); process.exit(code); };
  process.on('SIGINT', () => stop(130));
  try {
    console.log(`launched ${app.exe} pid ${app.pid}, debug port ${app.port}`);
    for (const [verb, arg] of o.steps) {
      if (verb === 'shot') {
        await app.screenshot(arg);
        console.log(`screenshot ${path.resolve(arg)} (${Date.now() - app.startedAt} ms after launch)`);
      } else if (verb === 'click') await app.click(arg);
      else if (verb === 'type') await app.type(arg);
      else if (verb === 'press') await app.press(arg);
      else if (verb === 'eval') console.log(JSON.stringify(await app.evaluate(arg)));
      else if (verb === 'wait') await sleep(arg);
    }
    if (o.hold) {
      console.log(`holding for ${o.hold} s`);
      const end = Date.now() + o.hold * 1000;
      while (Date.now() < end) {
        if (app.exited) throw new Error(app.exited);
        await sleep(250);
      }
    }
  } catch (e) {
    console.error(`app.mjs: ${e.message}`);
    await stop(1);
  }
  await stop(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((e) => {
    console.error(`app.mjs: ${e.message}`);
    process.exit(1);
  });
}
