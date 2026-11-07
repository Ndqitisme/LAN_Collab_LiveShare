// Zero-dependency Chrome DevTools Protocol client (Node 22+ global WebSocket).
// One browser-level socket, one flattened session per attached target.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function getJson(port, route, host = '127.0.0.1') {
  const res = await fetch(`http://${host}:${port}${route}`);
  if (!res.ok) throw new Error(`GET ${route}: HTTP ${res.status}`);
  return res.json();
}

export const listTargets = (port, host) => getJson(port, '/json/list', host);
export const browserVersion = (port, host) => getJson(port, '/json/version', host);

// Polls /json/version until it answers. `alive()` returning a string aborts with that message
// (used to fail fast when the launched process has already exited).
export async function waitForEndpoint(port, { timeout = 30000, alive = () => null } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    const dead = alive();
    if (dead) throw new Error(dead);
    try {
      return await browserVersion(port);
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`DevTools endpoint on port ${port} did not answer within ${timeout} ms (${last && last.message})`);
}

export async function waitFor(fn, { timeout = 15000, interval = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out after ${timeout} ms waiting for ${what}${last ? ` (last error: ${last.message})` : ''}`);
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = null;
    ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
    ws.addEventListener('close', () => this.#fail('DevTools connection closed (the target process exited or closed the socket)'));
    ws.addEventListener('error', () => this.#fail('DevTools connection error'));
  }

  static async connect(wsUrl, { timeout = 10000 } = {}) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`WebSocket connect timeout: ${wsUrl}`)), timeout);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); reject(new Error(`WebSocket connect failed: ${wsUrl}`)); }, { once: true });
    });
    return new CDP(ws);
  }

  // Connects to the browser-level endpoint of a DevTools port.
  static async connectPort(port, host) {
    const v = await browserVersion(port, host);
    return CDP.connect(v.webSocketDebuggerUrl);
  }

  #fail(msg) {
    if (this.closed) return;
    this.closed = msg;
    for (const { reject, method } of this.pending.values()) reject(new Error(`${msg} [during ${method}]`));
    this.pending.clear();
  }

  #onMessage(data) {
    const msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    if (msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else p.resolve(msg.result);
      return;
    }
    for (const fn of this.listeners) fn(msg);
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error(`${this.closed} [during ${method}]`));
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(msg));
    });
  }

  // fn({method, params, sessionId}); returns an unsubscribe function.
  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const s = new Session(this, sessionId, targetId);
    await s.send('Runtime.enable');
    return s;
  }

  async targets() {
    return (await this.send('Target.getTargets')).targetInfos;
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  F1: { code: 'F1', keyCode: 112 },
};
const MODS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };

function keyInfo(key) {
  if (KEYS[key]) return { key, ...KEYS[key] };
  if (/^[a-zA-Z0-9]$/.test(key)) {
    const up = key.toUpperCase();
    return { key, code: /\d/.test(key) ? `Digit${key}` : `Key${up}`, keyCode: up.charCodeAt(0), text: key };
  }
  throw new Error(`Unknown key "${key}"`);
}

// One attached target (page, iframe, webview). Every helper runs in this target's default context
// unless `contextId` is given.
export class Session {
  constructor(cdp, sessionId, targetId) {
    this.cdp = cdp;
    this.id = sessionId;
    this.targetId = targetId;
  }

  send(method, params) {
    return this.cdp.send(method, params, this.id);
  }

  on(method, fn) {
    return this.cdp.onEvent((m) => {
      if (m.sessionId === this.id && m.method === method) fn(m.params);
    });
  }

  // expr: a string, or a function called with JSON-serialisable args.
  async evaluate(expr, args = [], { contextId } = {}) {
    const expression = typeof expr === 'function' ? `(${expr})(...${JSON.stringify(args)})` : expr;
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true, contextId });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`evaluate failed: ${(d.exception && (d.exception.description || d.exception.value)) || d.text}`);
    }
    return r.result.value;
  }

  waitFor(expr, opts = {}) {
    return waitFor(() => this.evaluate(expr, [], opts), { what: typeof expr === 'string' ? expr : 'page condition', ...opts });
  }

  async mouse(x, y, { button = 'left', clickCount = 1 } = {}) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
  }

  // Centre of the first element matching selector, in this target's viewport coordinates.
  async rect(selector, opts) {
    const r = await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    }, [selector], opts);
    if (!r) throw new Error(`No element matches ${selector}`);
    return r;
  }

  async click(selector, opts) {
    const r = await this.rect(selector, opts);
    await this.mouse(r.x + r.width / 2, r.y + r.height / 2);
  }

  type(text) {
    return this.send('Input.insertText', { text });
  }

  // press('Enter'), press('p', ['Control', 'Shift'])
  async press(key, modifiers = []) {
    const k = keyInfo(key);
    const mods = modifiers.reduce((a, m) => a | (MODS[m] || 0), 0);
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: mods };
    const text = mods & ~MODS.Shift ? undefined : k.text;
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text, unmodifiedText: text });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(data, 'base64');
    if (file) {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, buf);
    }
    return buf;
  }
}
