// Builds the LAN Hub release artifacts into dist/ (plan README section 7) and prints their sizes:
//   LanHub_<ver>_x64-setup.exe                     NSIS installer of the desktop app (Windows host)
//   lanhub-cli-<ver>-<target>.zip                   headless hub for Windows (Windows host)
//   lanhub-cli-<ver>-x86_64-unknown-linux-gnu.tar.gz headless hub for Linux (Linux host, the CI job)
//   SHA256SUMS                                      sums of the files this run wrote
// <target> is the host triple of the pinned toolchain (`rustc -vV` in lanhub/), x86_64-pc-windows-gnu here.
// Usage: node tools/package-lanhub.mjs [--dry-run]
// Uses only Node.js built-ins.
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANHUB = path.join(ROOT, 'lanhub');
const DIST = path.join(ROOT, 'dist');
const MB = 1000 * 1000;
// The offline installer carries the WebView2 standalone runtime installer, for machines without Internet.
const BUDGET = { setup: 15 * MB, offlineSetup: 250 * MB, cliZip: 10 * MB };
const dryRun = process.argv.includes('--dry-run');
const windows = process.platform === 'win32';

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(' ')}  (in ${path.relative(ROOT, cwd) || '.'})`);
  // npm is a .cmd on Windows, which only a shell starts; the arguments here are fixed words.
  if (cmd === 'npm') execSync(`npm ${args.join(' ')}`, { cwd, stdio: 'inherit' });
  else execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

function version() {
  const conf = JSON.parse(fs.readFileSync(path.join(LANHUB, 'app/src-tauri/tauri.conf.json'), 'utf8')).version;
  const cargo = /\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(LANHUB, 'Cargo.toml'), 'utf8'))?.[1];
  if (conf !== cargo) throw new Error(`version mismatch: tauri.conf.json ${conf}, Cargo.toml ${cargo}`);
  return conf;
}

function hostTarget() {
  const out = execFileSync('rustc', ['-vV'], { cwd: LANHUB, encoding: 'utf8' });
  const host = /^host:\s*(\S+)/m.exec(out)?.[1];
  if (!host) throw new Error(`rustc -vV printed no host:\n${out}`);
  return host;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip of `entries` ([name, Buffer]), deflated. */
function zip(entries) {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [entry, data] of entries) {
    const name = Buffer.from(entry, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** A gzipped ustar archive of `entries` ([name, Buffer, mode]). */
function tarGz(entries) {
  const blocks = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const [name, data, mode] of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    const sum = h.reduce((n, b) => n + b, 0);
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}

const ver = version();
const target = hostTarget();
const names = {
  setup: `LanHub_${ver}_x64-setup.exe`,
  offlineSetup: `LanHub_${ver}_x64-offline-setup.exe`,
  cliZip: `lanhub-cli-${ver}-${windows ? target : 'x86_64-pc-windows-msvc'}.zip`,
  cliTar: `lanhub-cli-${ver}-${windows ? 'x86_64-unknown-linux-gnu' : target}.tar.gz`,
  sums: 'SHA256SUMS',
};
const here = windows ? ['setup', 'offlineSetup', 'cliZip', 'sums'] : ['cliTar', 'sums'];

if (dryRun) {
  for (const [key, name] of Object.entries(names)) {
    const where = here.includes(key) ? 'built here' : windows ? 'built on Linux by the CI job lanhub.yml package-linux' : 'built on Windows';
    console.log(`${path.join('dist', name)}  (${where})`);
  }
  process.exit(0);
}

fs.mkdirSync(DIST, { recursive: true });
const written = [];
run('cargo', ['build', '-p', 'lanhub-cli', '--release'], LANHUB);
const license = fs.readFileSync(path.join(ROOT, 'LICENSE'));
if (windows) {
  const bundle = path.join(LANHUB, 'target/release/bundle/nsis');
  const copyInstaller = (key) => {
    const built = fs.readdirSync(bundle).find((f) => f.endsWith(`_${ver}_x64-setup.exe`));
    if (!built) throw new Error(`no ${ver} installer in ${bundle}`);
    fs.copyFileSync(path.join(bundle, built), path.join(DIST, names[key]));
    written.push(key);
  };
  run('npm', ['run', 'tauri', 'build'], path.join(LANHUB, 'app'));
  copyInstaller('setup');
  // Same binary, bundled again with the WebView2 runtime inside the installer.
  run('npm', ['run', 'tauri', '--', 'bundle', '--bundles', 'nsis', '--config', 'src-tauri/tauri.offline.conf.json'], path.join(LANHUB, 'app'));
  copyInstaller('offlineSetup');
  const exe = fs.readFileSync(path.join(LANHUB, 'target/release/lanhub-cli.exe'));
  fs.writeFileSync(path.join(DIST, names.cliZip), zip([['lanhub-cli/lanhub-cli.exe', exe], ['lanhub-cli/LICENSE', license]]));
  written.push('cliZip');
} else {
  const exe = fs.readFileSync(path.join(LANHUB, 'target/release/lanhub-cli'));
  fs.writeFileSync(path.join(DIST, names.cliTar), tarGz([['lanhub-cli/lanhub-cli', exe, 0o755], ['lanhub-cli/LICENSE', license, 0o644]]));
  written.push('cliTar');
}

const sums = written.map((key) => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(DIST, names[key]))).digest('hex');
  return `${hash}  ${names[key]}\n`;
});
fs.writeFileSync(path.join(DIST, names.sums), sums.join(''));

let over = false;
for (const key of [...written, 'sums']) {
  const size = fs.statSync(path.join(DIST, names[key])).size;
  const budget = BUDGET[key];
  const note = budget ? ` (budget ${budget / MB} MB${size > budget ? ', OVER' : ''})` : '';
  over ||= !!budget && size > budget;
  console.log(`${path.join('dist', names[key])}  ${(size / MB).toFixed(2)} MB  ${size} bytes${note}`);
}
if (!windows) console.log('The Windows installer and zip are built on Windows.');
else console.log(`${path.join('dist', names.cliTar)} is built on Linux by the CI job lanhub.yml package-linux.`);
if (over) process.exit(1);
