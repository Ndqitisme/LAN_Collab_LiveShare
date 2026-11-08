// Builds every view folder that has a main.ts into extension/webview/dist/<view>/ (index.js, index.css).
// Usage: node extension/webview-src/build.mjs [view...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'webview', 'dist');
const all = fs.readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(here, d.name, 'main.ts')))
  .map((d) => d.name);
const views = process.argv.slice(2).length ? process.argv.slice(2) : all;

for (const view of views) {
  if (!all.includes(view)) throw new Error(`no view ${view} (have ${all.join(', ')})`);
  await build({
    configFile: path.join(here, 'vite.config.ts'),
    build: { outDir: path.join(dist, view), rolldownOptions: { input: path.join(here, view, 'main.ts') } },
  });
  const sizes = fs.readdirSync(path.join(dist, view)).map((f) => `${f} ${fs.statSync(path.join(dist, view, f)).size} B`);
  console.log(`webview ${view}: ${sizes.join(', ')}`);
}
