// Fails when kit code bypasses the tokens:
// - a raw color anywhere in src/ except theme-app.css,
// - a --vscode-* variable anywhere in src/ except theme-vscode.css,
// - a var(--lc-*) that no kit stylesheet defines,
// - a color token that one theme defines and the other does not,
// - body text in theme-app.css below 4.5:1 contrast in the light or dark scheme.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const NAMED_COLOR = /(?<![\w-])(?:white|black|red|green|blue|yellow|orange|purple|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia|pink|brown|gold)(?![\w-])/g;
const VSCODE_VAR = /--vscode-[\w-]+/g;
const LC_USE = /var\(\s*(--lc-[\w-]+)/g;
const LC_DEF = /(--lc-[\w-]+)\s*:|style:(--lc-[\w-]+)/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(svelte|css|ts)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

// Named colors only count inside CSS: <style> blocks, style attributes, and .css files.
function cssParts(file, text) {
  if (file.endsWith('.css')) return text;
  const blocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const attrs = [...text.matchAll(/\bstyle(?::[\w-]+)?="([^"]*)"/g)].map((m) => m[1]);
  return [...blocks, ...attrs].join('\n');
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const errors = [];
const files = walk(root);
const defined = new Set();
const sources = new Map();

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  sources.set(file, text);
  for (const m of text.matchAll(LC_DEF)) defined.add(m[1] ?? m[2]);
}

for (const [file, raw] of sources) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (rel === 'icons.ts') continue;
  const text = stripComments(raw);
  if (rel !== 'theme-app.css') {
    for (const m of text.matchAll(RAW_COLOR)) errors.push(`${rel}:${lineOf(text, m.index)} raw color "${m[0]}"; use a --lc- token`);
    const css = cssParts(file, text);
    for (const m of css.matchAll(NAMED_COLOR)) errors.push(`${rel}: named color "${m[0]}"; use a --lc- token`);
  }
  if (rel !== 'theme-vscode.css') {
    for (const m of text.matchAll(VSCODE_VAR)) errors.push(`${rel}:${lineOf(text, m.index)} "${m[0]}" outside theme-vscode.css`);
  }
  for (const m of text.matchAll(LC_USE)) {
    if (!defined.has(m[1])) errors.push(`${rel}:${lineOf(text, m.index)} unknown token ${m[1]}`);
  }
}

// Both themes must define the same color tokens, or one product renders a
// fallback color the other never sees.
function themeTokens(name) {
  const text = stripComments(sources.get(path.join(root, name)));
  return new Map([...text.matchAll(/(--lc-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const app = themeTokens('theme-app.css');
const vscode = themeTokens('theme-vscode.css');
const vscodeOnly = new Set(['--lc-font', '--lc-font-mono', '--lc-font-size', '--lc-hover', '--lc-list-active-border']);
for (const t of app.keys()) if (!vscode.has(t)) errors.push(`theme-vscode.css does not map ${t}`);
for (const t of vscode.keys()) if (!app.has(t) && !vscodeOnly.has(t)) errors.push(`theme-app.css does not define ${t}`);

function rgb(hex) {
  const h = hex.slice(1);
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function scheme(token, index) {
  const value = app.get(token);
  const m = value && value.match(/light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)/);
  if (!m) throw new Error(`theme-app.css: ${token} must be light-dark(#rrggbb, #rrggbb) for the contrast check`);
  return m[index + 1];
}

// [text, background] pairs that carry body text in the kit.
const pairs = [
  ['--lc-fg', '--lc-bg'],
  ['--lc-fg', '--lc-surface'],
  ['--lc-fg', '--lc-surface-2'],
  ['--lc-muted', '--lc-bg'],
  ['--lc-muted', '--lc-surface'],
  ['--lc-muted', '--lc-surface-2'],
  ['--lc-accent-fg', '--lc-accent'],
  ['--lc-accent-fg', '--lc-accent-hover'],
  ['--lc-secondary-fg', '--lc-secondary'],
  ['--lc-input-fg', '--lc-input-bg'],
  ['--lc-placeholder', '--lc-input-bg'],
  ['--lc-link', '--lc-surface'],
  ['--lc-ok', '--lc-surface'],
  ['--lc-warn', '--lc-surface'],
  ['--lc-danger', '--lc-surface'],
  ['--lc-badge-fg', '--lc-badge-bg'],
  ['--lc-tooltip-fg', '--lc-tooltip-bg'],
  ['--lc-fg', '--lc-code-bg'],
];

const rows = [];
for (const [index, name] of [[0, 'light'], [1, 'dark']]) {
  for (const [fg, bg] of pairs) {
    const ratio = contrast(scheme(fg, index), scheme(bg, index));
    rows.push(`${name.padEnd(5)}  ${fg.padEnd(18)} on ${bg.padEnd(18)} ${ratio.toFixed(2).padStart(5)}:1${ratio < 4.5 ? '  FAIL' : ''}`);
    if (ratio < 4.5) errors.push(`contrast ${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs 4.5:1`);
  }
}

console.log('Contrast, theme-app.css');
console.log(rows.join('\n'));
console.log(`\nScanned ${files.length} files, ${defined.size} --lc- tokens defined.`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
console.log('check-tokens: OK');
