// Fails when a .svelte or .ts file under src/ holds a Vietnamese literal: every visible string of the app
// lives in src/i18n/vi.json (docs/copy-guide.md). Comments are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
// Letters only Vietnamese uses among the scripts this UI shows: đ, ă, ơ, ư and the tone-marked vowels.
const VIETNAMESE = /[đĐăĂơƠưƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĩĨũŨ]/;

function stripComments(text, file) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (file.endsWith('.svelte')) out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return out.replace(/(^|[^:'"`])\/\/.*$/gm, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p !== path.join(src, 'i18n')) yield* files(p);
    } else if (/\.(svelte|ts)$/.test(e.name)) yield p;
  }
}

const hits = [];
for (const file of files(src)) {
  const lines = stripComments(fs.readFileSync(file, 'utf8'), file).split('\n');
  lines.forEach((line, i) => {
    if (VIETNAMESE.test(line)) hits.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
  });
}

if (hits.length) {
  console.error(`check-i18n: Vietnamese text outside src/i18n/vi.json\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('check-i18n: OK');
