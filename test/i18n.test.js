'use strict';

// The caption catalog against its call sites: every t() id exists, every entry is used, placeholders match the
// arguments, every protocol error code and activity kind has an entry, and tools/check-strings.mjs catches a
// stray Vietnamese literal while exempting log() arguments and comments.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const catalog = require('../extension/i18n/vi.json');
const { t } = require('../lib/i18n');

const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

// `code` values of the table in protocol.md section 4.1 and `kind` values of the second table in section 7.
function protocolNames() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'protocol.md'), 'utf8');
  const section = (start, end) => doc.slice(doc.indexOf(start), doc.indexOf(end, doc.indexOf(start)));
  const firstColumn = (text) => [...text.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
  const codes = firstColumn(section('### 4.1 error', '### 4.2')).filter((c) => c !== 'code');
  const kinds = firstColumn(section('## 7. Activity', '## 8.')).filter((k) => !['ts', 'who', 'color', 'kind', 'path', 'text', 'addr'].includes(k));
  return { codes, kinds };
}

(async () => {
  const cs = await import(pathToFileURL(path.join(ROOT, 'tools', 'check-strings.mjs')).href);
  const problems = [];
  const used = new Set();

  for (const file of cs.sourceFiles(ROOT)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    for (const call of cs.findTCalls(cs.sourceText(file))) {
      const at = `${rel}:${call.line}`;
      if (call.id === null) {
        problems.push(`${at}: t() id is not a string literal`);
        continue;
      }
      used.add(call.id);
      if (!(call.id in catalog)) {
        problems.push(`${at}: no catalog entry "${call.id}"`);
        continue;
      }
      if (call.keys === null) {
        problems.push(`${at}: t("${call.id}") arguments are not an object literal with plain keys`);
        continue;
      }
      const want = placeholders(catalog[call.id]);
      const got = [...new Set(call.keys)].sort();
      if (want.join() !== got.join()) problems.push(`${at}: t("${call.id}") passes {${got}} but the entry uses {${want}}`);
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const e of cs.manifestEntries(pkg)) {
    used.add(e.id);
    if (placeholders(catalog[e.id] || '').length) problems.push(`${e.id}: manifest entries cannot have placeholders`);
  }

  for (const id of Object.keys(catalog)) if (!used.has(id)) problems.push(`unused catalog entry "${id}"`);

  const { codes, kinds } = protocolNames();
  assert.ok(codes.includes('token_invalid') && kinds.includes('edit'), 'protocol.md tables parsed');
  for (const code of codes) {
    if (!Object.keys(catalog).some((id) => id === `error.${code}` || id.startsWith(`error.${code}.`))) problems.push(`no entry for error code ${code}`);
  }
  for (const kind of kinds) if (!(`activity.${kind}` in catalog)) problems.push(`no entry for activity kind ${kind}`);

  assert.deepStrictEqual(problems, []);

  assert.throws(() => t('no.such.id'), /no catalog entry "no\.such\.id"/);
  assert.strictEqual(t('activity.edit', { path: 'a.py' }), 'đang sửa a.py');

  // check-strings on a scratch tree: one stray literal, one log() argument, one comment, one regex.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-check-strings-'));
  try {
    fs.mkdirSync(path.join(tmp, 'extension', 'i18n'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'lib'));
    fs.writeFileSync(path.join(tmp, 'extension', 'i18n', 'vi.json'), JSON.stringify({ 'package.description': 'Mô tả' }));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ description: 'Mô tả', contributes: {} }));
    fs.writeFileSync(path.join(tmp, 'extension', 'a.js'), [
      "log(`Đã kết nối ${x}`, 'được');",
      '// chú thích',
      'const re = /[à-ỹ]/u;',
      "const s = 'Chưa kết nối';",
      'core.log(`Mất kết nối ${y}`);',
    ].join('\n'));
    const found = cs.check(tmp);
    assert.strictEqual(found.length, 1, found.join('\n'));
    assert.match(found[0], /^extension\/a\.js:4: /);

    // Webview sources: a caption typed into Svelte markup is caught at its line, t() inside markup is found,
    // and the built bundle under extension/webview/dist/ is not scanned.
    fs.mkdirSync(path.join(tmp, 'extension', 'webview-src', 'v'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'extension', 'webview', 'dist', 'v'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'extension', 'a.js'), '');
    fs.writeFileSync(path.join(tmp, 'extension', 'webview', 'dist', 'v', 'index.js'), "const s = 'Chưa kết nối';");
    const svelte = path.join(tmp, 'extension', 'webview-src', 'v', 'A.svelte');
    fs.writeFileSync(svelte, [
      '<script lang="ts">',
      "  const n: number = 1; // chú thích",
      '</script>',
      '{#each [1] as x (x)}<p title={t(\'a.b\', { n })}>{x}</p>{/each}',
      '<button>Gửi</button>',
      '<style>p { color: red; }</style>',
    ].join('\n'));
    const webview = cs.check(tmp);
    assert.deepStrictEqual(webview.map((p) => p.split(': ')[0]), ['extension/webview-src/v/A.svelte:5'], webview.join('\n'));
    assert.deepStrictEqual(cs.findTCalls(cs.sourceText(svelte)).map((c) => [c.line, c.id, c.keys]), [[4, 'a.b', ['n']]]);
    fs.rmSync(path.join(tmp, 'extension', 'webview-src'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ description: 'Mô tả khác', contributes: { commands: [{ command: 'x.y', title: 'Chạy' }] } }));
    fs.writeFileSync(path.join(tmp, 'extension', 'a.js'), '');
    const manifest = cs.check(tmp);
    assert.ok(manifest.some((p) => p.includes('description') && p.includes('differs')), manifest.join('\n'));
    assert.ok(manifest.some((p) => p.includes('no catalog entry command.x.y.title')), manifest.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`i18n: OK (${Object.keys(catalog).length} entries, ${used.size} used)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
