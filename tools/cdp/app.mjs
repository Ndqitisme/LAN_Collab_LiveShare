// Launches the LAN Hub app (Tauri 2, WebView2) with a DevTools port and drives its window over CDP.
// Until A7 builds the app this resolves no executable and fails with "LAN Hub app not built".
// CLI: `node tools/cdp/app.mjs --shot out.png`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CDP, freePort, listTargets, waitFor, waitForEndpoint } from './cdp.mjs';
import { REPO, killTree } from './vscode.mjs';

export const NOT_BUILT = 'LAN Hub app not built';

// LANHUB_APP_EXE wins; otherwise the cargo output folders A7 is expected to produce.
export function appExe() {
  const candidates = [
    process.env.LANHUB_APP_EXE,
    ...['release', 'debug'].flatMap((p) => [
      path.join(REPO, 'lanhub', 'target', p, 'LanHub.exe'),
      path.join(REPO, 'lanhub', 'app', 'src-tauri', 'target', p, 'LanHub.exe'),
    ]),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export async function launch(opts = {}) {
  const exe = opts.exe || appExe();
  if (!exe) throw new Error(NOT_BUILT);
  const port = opts.port || await freePort();
  const env = { ...process.env, ...(opts.env || {}), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
  const proc = spawn(exe, opts.args || [], { env, stdio: 'ignore' });
  const app = new App(proc, port);
  try {
    await waitForEndpoint(port, { timeout: opts.timeout || 30000, alive: () => app.exited });
    const target = await waitFor(async () => (await listTargets(port)).find((t) => t.type === 'page'), { what: 'the LAN Hub window target' });
    app.cdp = await CDP.connectPort(port);
    app.page = await app.cdp.attach(target.id);
    await app.page.send('Page.enable');
  } catch (e) {
    await app.close();
    throw e;
  }
  return app;
}

export class App {
  constructor(proc, port) {
    this.proc = proc;
    this.pid = proc.pid;
    this.port = port;
    this.exited = null;
    proc.on('exit', (code) => { this.exited = `LAN Hub app (pid ${this.pid}) exited (exit code ${code})`; });
  }

  screenshot(file) { return this.page.screenshot(file); }

  evaluate(expr, args) { return this.page.evaluate(expr, args); }

  waitFor(expr, opts) { return this.page.waitFor(expr, opts); }

  click(selector) { return this.page.click(selector); }

  type(text) { return this.page.type(text); }

  press(key, modifiers) { return this.page.press(key, modifiers); }

  async close() {
    if (this.cdp) this.cdp.close();
    killTree(this.pid);
  }
}

async function cli() {
  const argv = process.argv.slice(2);
  const shot = argv[argv.indexOf('--shot') + 1];
  const app = await launch({});
  try {
    if (argv.includes('--shot')) {
      await app.screenshot(shot);
      console.log(`screenshot ${path.resolve(shot)}`);
    }
  } finally {
    await app.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((e) => {
    console.error(`app.mjs: ${e.message}`);
    process.exit(1);
  });
}
