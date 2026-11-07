// Records a CDP page as mp4: Page.startScreencast frames on disk, encoded with ffmpeg-static.
// CLI: `node tools/cdp/record.mjs --seconds 10 vscode` (launches VS Code) or `--port <n>` (attaches).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CDP, listTargets, sleep } from './cdp.mjs';

const require = createRequire(import.meta.url);

export function ffmpegPath() {
  const p = require('ffmpeg-static');
  if (!p || !fs.existsSync(p)) throw new Error('ffmpeg-static binary missing: run npm install');
  return p;
}

function ffmpeg(args) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${r.stderr}`);
  return r;
}

// Duration in seconds, read from ffmpeg's own probe of the file.
export function mediaDuration(file) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr || '');
  if (!m) throw new Error(`cannot read duration of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Writes one PNG frame taken at `atSeconds` of a video.
export function frameGrab(video, png, atSeconds) {
  fs.mkdirSync(path.dirname(path.resolve(png)), { recursive: true });
  ffmpeg(['-ss', String(atSeconds), '-i', video, '-frames:v', '1', png]);
}

// Starts recording `session` (a cdp.mjs Session of a page target). Returns { stop(out) } which encodes the
// frames to `out` and resolves to { out, frames, seconds }. Screencast only emits frames when the page
// repaints, so each frame is held until the next one (concat demuxer durations) to keep real time.
export async function startRecording(session, { dir, quality = 80, fps = 25 } = {}) {
  const frameDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'lc-cdp-frames-'));
  fs.mkdirSync(frameDir, { recursive: true });
  const frames = [];
  const save = (b64) => {
    const file = path.join(frameDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    frames.push({ file, t: Date.now() });
  };
  const startedAt = Date.now();
  const first = await session.send('Page.captureScreenshot', { format: 'jpeg', quality });
  save(first.data);
  const off = session.on('Page.screencastFrame', (p) => {
    save(p.data);
    session.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality, everyNthFrame: 1 });

  return {
    frameDir,
    async stop(out) {
      const stoppedAt = Date.now();
      off();
      await session.send('Page.stopScreencast').catch(() => {});
      const lines = [];
      frames.forEach((f, i) => {
        const end = i + 1 < frames.length ? frames[i + 1].t : stoppedAt;
        lines.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, (end - f.t) / 1000).toFixed(3)}`);
      });
      lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
      const list = path.join(frameDir, 'frames.txt');
      fs.writeFileSync(list, `${lines.join('\n')}\n`);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
      if (!dir) fs.rmSync(frameDir, { recursive: true, force: true });
      return { out: path.resolve(out), frames: frames.length, seconds: (stoppedAt - startedAt) / 1000 };
    },
  };
}

export async function record(session, { seconds = 10, out = 'out.mp4', ...opts } = {}) {
  const rec = await startRecording(session, opts);
  await sleep(seconds * 1000);
  return rec.stop(out);
}

function parseArgs(argv) {
  const o = { seconds: 10, out: 'out.mp4' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--frame') o.frame = argv[++i];
    else if (a === '--folder') o.folder = argv[++i];
    else if (a === 'vscode' || a === 'app') o.target = a;
    else throw new Error(`Unknown argument ${a}`);
  }
  return o;
}

async function cli() {
  const o = parseArgs(process.argv.slice(2));
  let session;
  let cleanup = async () => {};
  if (o.port) {
    const targets = await listTargets(o.port);
    const page = targets.find((t) => t.type === 'page' && t.url.includes('/workbench/workbench.html')) || targets.find((t) => t.type === 'page');
    if (!page) throw new Error(`no page target on port ${o.port}`);
    const cdp = await CDP.connectPort(o.port);
    session = await cdp.attach(page.id);
    cleanup = async () => cdp.close();
  } else if (o.target === 'app') {
    const { launch } = await import('./app.mjs');
    const app = await launch({});
    session = app.page;
    cleanup = () => app.close();
  } else {
    const { launch } = await import('./vscode.mjs');
    const vs = await launch({ folder: o.folder });
    session = vs.page;
    cleanup = () => vs.close();
  }
  try {
    const r = await record(session, o);
    const dur = mediaDuration(r.out);
    console.log(`recorded ${r.out}: ${r.frames} screencast frames over ${r.seconds.toFixed(1)} s, mp4 duration ${dur.toFixed(2)} s`);
    if (o.frame) {
      frameGrab(r.out, o.frame, dur / 2);
      console.log(`frame grab ${path.resolve(o.frame)}`);
    }
  } finally {
    await cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((e) => {
    console.error(`record.mjs: ${e.message}`);
    process.exit(1);
  });
}
