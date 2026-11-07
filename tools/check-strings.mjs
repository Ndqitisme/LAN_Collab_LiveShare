// Fails when a Vietnamese caption lives outside extension/i18n/vi.json (docs/copy-guide.md).
// Scans every .js file under extension/ and lib/, and the .ts and .svelte webview sources under
// extension/webview-src/ (not their tests, and not the built extension/webview/dist/). Exempt: comments and the
// arguments of log() calls, which write to the output channel. package.json cannot read the catalog, so each manifest caption must equal its
// catalog entry instead (command.<id>.title, view.<id>.name, setting.<key>.description, package.description).
// Usage: node tools/check-strings.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const CATALOG = 'extension/i18n/vi.json';

export const isVietnamese = (text) => VIETNAMESE.test(text.normalize('NFC'));

const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
const PUNCT = /^(?:\.\.\.|===|!==|\*\*=|<<=|>>>=|>>>|>>=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\*\*|[{}()[\];,<>+\-*/%&|^!~?:=.@#])/;

// Tokens: {type: 'string' | 'template' | 'regex' | 'ident' | 'num' | 'punct', value, line}. Comments are dropped.
// A template literal is one token whose value joins its text parts; tokens of its ${} expressions follow it.
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const braces = []; // per open `{`: true when it opened a template ${ } expression
  const prevAllowsRegex = () => {
    const p = tokens[tokens.length - 1];
    if (!p) return true;
    if (p.type === 'ident') return REGEX_AFTER_WORDS.has(p.value);
    if (p.type === 'punct') return ![')', ']', '}'].includes(p.value);
    return false;
  };
  const count = (text) => {
    for (const ch of text) if (ch === '\n') line += 1;
  };
  // Reads template text from i (just after ` or }) up to the closing ` or the next ${.
  const templateText = (tok) => {
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        tok.value += src.slice(i, i + 2);
        count(src.slice(i, i + 2));
        i += 2;
      } else if (ch === '`') {
        i += 1;
        return;
      } else if (ch === '$' && src[i + 1] === '{') {
        i += 2;
        braces.push(tok);
        return;
      } else {
        if (ch === '\n') line += 1;
        tok.value += ch;
        i += 1;
      }
    }
    throw new Error(`unterminated template literal at line ${tok.line}`);
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') {
      line += 1;
      i += 1;
    } else if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`unterminated comment at line ${line}`);
      count(src.slice(i, end + 2));
      i = end + 2;
    } else if (ch === '"' || ch === "'") {
      const start = line;
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\n') throw new Error(`unterminated string at line ${start}`);
        if (src[j] === '\\') {
          value += src.slice(j, j + 2);
          j += 2;
        } else value += src[j++];
      }
      tokens.push({ type: 'string', value, line: start });
      i = j + 1;
    } else if (ch === '`') {
      const tok = { type: 'template', value: '', line };
      tokens.push(tok);
      i += 1;
      templateText(tok);
    } else if (ch === '}' && braces.length && braces[braces.length - 1]) {
      i += 1;
      templateText(braces.pop());
    } else if (ch === '/' && prevAllowsRegex()) {
      const start = line;
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const c = src[j];
        if (c === '\n') throw new Error(`unterminated regex at line ${start}`);
        if (c === '\\') j += 2;
        else {
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
          j += 1;
        }
      }
      j += 1;
      while (/[a-z]/i.test(src[j] || '')) j += 1;
      tokens.push({ type: 'regex', value: src.slice(i, j), line: start });
      i = j;
    } else if (/[\p{L}_$]/u.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[\p{L}\p{N}_$]/u.test(src[j])) j += 1;
      tokens.push({ type: 'ident', value: src.slice(i, j), line });
      i = j;
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) {
      let j = i + 1;
      while (j < src.length && /[0-9a-zA-Z_.]/.test(src[j])) j += 1;
      tokens.push({ type: 'num', value: src.slice(i, j), line });
      i = j;
    } else {
      const m = PUNCT.exec(src.slice(i, i + 4));
      if (!m) throw new Error(`unexpected character ${JSON.stringify(ch)} at line ${line}`);
      if (m[0] === '{') braces.push(null);
      else if (m[0] === '}') braces.pop();
      tokens.push({ type: 'punct', value: m[0], line });
      i += m[0].length;
    }
  }
  return tokens;
}

// Marks tokens inside the parentheses of log(...) / x.log(...) calls with `exempt: true`.
function markLogArguments(tokens) {
  let depth = 0;
  const open = []; // paren depths at which a log call's argument list started
  tokens.forEach((tok, k) => {
    if (open.length) tok.exempt = true;
    if (tok.type !== 'punct') return;
    if (tok.value === '(') {
      depth += 1;
      const callee = tokens[k - 1];
      if (callee && callee.type === 'ident' && callee.value === 'log') open.push(depth);
    } else if (tok.value === ')') {
      if (open.length && open[open.length - 1] === depth) open.pop();
      depth -= 1;
    }
  });
  return tokens;
}

// Vietnamese string or template literals outside log() arguments: [{line, value}].
export function findCaptions(src) {
  return markLogArguments(tokenize(src))
    .filter((tok) => (tok.type === 'string' || tok.type === 'template') && !tok.exempt && isVietnamese(tok.value))
    .map(({ line, value }) => ({ line, value }));
}

// Every t(...) call: {line, id (null when the first argument is not a plain string), keys (null when the second
// argument is not an object literal), hasArgs}.
export function findTCalls(src) {
  const tokens = tokenize(src);
  const calls = [];
  for (let k = 0; k < tokens.length - 1; k += 1) {
    const tok = tokens[k];
    const before = tokens[k - 1];
    if (tok.type !== 'ident' || tok.value !== 't' || tokens[k + 1].value !== '(') continue;
    if (before && (before.value === '.' || before.value === 'function')) continue;
    const first = tokens[k + 2];
    const id = first && first.type === 'string' && tokens[k + 3] && [')', ','].includes(tokens[k + 3].value) ? first.value : null;
    const call = { line: tok.line, id, keys: [], hasArgs: false };
    if (id !== null && tokens[k + 3].value === ',') {
      call.hasArgs = true;
      call.keys = objectKeys(tokens, k + 4);
    }
    calls.push(call);
  }
  return calls;
}

// Top-level keys of the object literal starting at tokens[start], or null when it is not one.
function objectKeys(tokens, start) {
  if (!tokens[start] || tokens[start].value !== '{') return null;
  const keys = [];
  let depth = 0;
  let expectKey = true;
  for (let k = start; k < tokens.length; k += 1) {
    const tok = tokens[k];
    if (tok.type === 'punct' && ['{', '(', '['].includes(tok.value)) {
      depth += 1;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (tok.type === 'punct' && ['}', ')', ']'].includes(tok.value)) {
      depth -= 1;
      if (depth === 0) return keys;
      continue;
    }
    if (depth !== 1) continue;
    if (tok.value === ',') {
      expectKey = true;
    } else if (expectKey) {
      expectKey = false;
      if (tok.value === '...') return null;
      if (tok.type === 'ident' || tok.type === 'string') keys.push(tok.value);
      else return null;
    }
  }
  return null;
}

// Manifest captions and the catalog id each must equal.
export function manifestEntries(pkg) {
  const entries = [{ where: 'description', id: 'package.description', value: pkg.description }];
  const c = pkg.contributes || {};
  for (const cmd of c.commands || []) entries.push({ where: `command ${cmd.command}`, id: `command.${cmd.command}.title`, value: cmd.title });
  for (const views of Object.values(c.views || {})) {
    for (const v of views) entries.push({ where: `view ${v.id}`, id: `view.${v.id}.name`, value: v.name });
  }
  for (const [key, prop] of Object.entries((c.configuration && c.configuration.properties) || {})) {
    entries.push({ where: `setting ${key}`, id: `setting.${key}.description`, value: prop.markdownDescription ?? prop.description });
  }
  return entries;
}

const SOURCE = /\.(c|m)?js$|\.svelte$|(?<!\.d|\.test)\.ts$/;

function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' || d.name === 'dist' ? [] : jsFiles(p);
    return SOURCE.test(d.name) ? [p] : [];
  });
}

// Script text of a source file for the tokenizer, with line numbers kept. A .svelte file becomes its
// <script> blocks plus each {expression} of the markup; markup text in between becomes a string literal
// only when it is Vietnamese, so a caption typed straight into the markup is still caught.
export function sourceText(file) {
  const src = fs.readFileSync(file, 'utf8');
  return file.endsWith('.svelte') ? svelteScript(src) : src;
}

export function svelteScript(src) {
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  let out = '';
  let markup = '';
  const flushMarkup = () => {
    const first = [...markup].findIndex((ch) => isVietnamese(ch));
    if (first < 0) out += blank(markup);
    else {
      const head = markup.slice(0, markup.lastIndexOf('\n', first) + 1);
      const rest = markup.slice(head.length);
      out += `${blank(head)}${JSON.stringify(rest.replace(/\s+/g, ' '))};${rest.replace(/[^\n]/g, '')}`;
    }
    markup = '';
  };
  let i = 0;
  while (i < src.length) {
    const block = /^<(script|style)\b[^>]*>/.exec(src.slice(i, i + 200));
    if (block) {
      flushMarkup();
      const close = src.indexOf(`</${block[1]}>`, i);
      if (close < 0) throw new Error(`unterminated <${block[1]}>`);
      const body = src.slice(i + block[0].length, close);
      out += blank(block[0]) + (block[1] === 'script' ? `${body};` : blank(body)) + blank(`</${block[1]}>`);
      i = close + block[1].length + 3;
    } else if (src.startsWith('<!--', i)) {
      flushMarkup();
      const close = src.indexOf('-->', i);
      out += blank(src.slice(i, close + 3));
      i = close + 3;
    } else if (src[i] === '{') {
      flushMarkup();
      let depth = 0;
      let j = i;
      for (; j < src.length; j += 1) {
        const ch = src[j];
        if (ch === '"' || ch === "'" || ch === '`') {
          const end = src.indexOf(ch, j + 1);
          if (end < 0) throw new Error('unterminated string in markup expression');
          j = end;
        } else if (ch === '{') depth += 1;
        else if (ch === '}' && --depth === 0) break;
      }
      // {#each ...}, {:else ...}, {/if}, {@render ...}: drop the block keyword, keep the expression.
      const expr = src.slice(i + 1, j).replace(/^\s*[#:/@][a-z]+/, '');
      out += `(${expr});`;
      i = j + 1;
    } else {
      markup += src[i];
      i += 1;
    }
  }
  flushMarkup();
  return out;
}

export function sourceFiles(root) {
  return ['extension', 'lib'].flatMap((d) => jsFiles(path.join(root, d)));
}

// Every other Vietnamese string in package.json is a caption with no catalog entry.
function manifestStrayStrings(pkg, mapped) {
  const stray = [];
  const walk = (v, where) => {
    if (typeof v === 'string') {
      if (isVietnamese(v) && !mapped.has(v)) stray.push(where);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, where ? `${where}.${k}` : k);
    }
  };
  walk(pkg, '');
  return stray;
}

export function check(root) {
  const problems = [];
  const catalog = JSON.parse(fs.readFileSync(path.join(root, CATALOG), 'utf8'));
  for (const file of sourceFiles(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    let found;
    try {
      found = findCaptions(sourceText(file));
    } catch (e) {
      problems.push(`${rel}: cannot scan: ${e.message}`);
      continue;
    }
    for (const f of found) problems.push(`${rel}:${f.line}: Vietnamese literal outside ${CATALOG}: ${JSON.stringify(f.value.slice(0, 80))}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const entries = manifestEntries(pkg);
  for (const e of entries) {
    if (!(e.id in catalog)) problems.push(`package.json ${e.where}: no catalog entry ${e.id}`);
    else if (catalog[e.id] !== e.value) problems.push(`package.json ${e.where}: ${JSON.stringify(e.value)} differs from ${e.id} ${JSON.stringify(catalog[e.id])}`);
  }
  for (const where of manifestStrayStrings(pkg, new Set(entries.map((e) => e.value)))) problems.push(`package.json ${where}: Vietnamese caption with no catalog entry`);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const problems = check(root);
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(`check-strings: ${problems.length} problem(s). Move captions to ${CATALOG} (docs/copy-guide.md).`);
    process.exit(1);
  }
  console.log(`check-strings: OK (${sourceFiles(root).length} files, ${CATALOG})`);
}
