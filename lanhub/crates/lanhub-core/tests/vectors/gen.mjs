// Writes the parity vectors of lanhub-core from lib/common.js: node lanhub/crates/lanhub-core/tests/vectors/gen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require('../../../../../lib/common.js');

// robustness.test.js section 2, the A2 plan's additions, then edge cases of each UNSAFE_SEGMENT branch.
const paths = [
  'GIT~1/hooks/pre-commit', '.git./hooks/x', 'a.txt:stream', 'docs/nul',
  'com0', 'lpt9.txt', 'GIT~1', 'x.',
  'a.txt', 'dir/sub/file.py', 'dir\\sub\\file.py', 'a\\..', '/abs', 'C:/x', 'c:x', 'z:', '1:/x', '', 'a//b', 'a/', '/', '.', '..', 'a/./b', 'a/../b',
  '...', '.a', 'a.b.c', 'a ', ' a', 'a. ', 'con', 'CON', 'Con.txt', 'con.', 'conx', 'console', 'aux.tar.gz', 'nul', 'prn', 'com1', 'COM9.log', 'com', 'comA',
  'lpt0', 'lpt', 'lpt10', 'LPT1.', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'a\tb', 'a\u0001b', 'a\u001fb', 'a\u007fb',
  'PROGRA~1', 'ABCDEF~12', 'ABCDEFG~1', '~1', 'A~', 'A~1.TXT', 'A~1.TXTX', 'A~1.T.X', 'A~1.', 'A~1x', 'A~~1', 'a b~1', '🙂🙂🙂~1', '🙂🙂🙂🙂~1', 'A~1.🙂🙂',
  'a\u2028<', 'a<\u2028', '\n\n', 'a\nb', '\r', 'con.\u2028x', 'x\u2028.', 'x.\u2028', 'A~1.\u2028', 'Đề bài.docx', 'thư mục/tệp.txt', 'a\u0000b',
];

const excludeCases = [
  { patterns: C.DEFAULT_EXCLUDE, rels: ['.git', '.git/config', 'src/.git/x', 'node_modules/a/b.js', 'a/node_modules', 'x.pyc', 'dir/x.PYC', 'a.pyc.txt', '~$book.xlsx', 'd/~$x', 'Thumbs.db', 'thumbs.DB', 'a/.DS_Store', 'venv/lib', 'myvenv/x', '.venv', '__pycache__/m.cpython.pyc', 'f.lc-tmp', 'a.txt', '.lan-collab/hub.json', '.gitignore', 'git'] },
  { patterns: ['output.csv', ' build/ ', './dist', 'docs/*.md', 'logs/**', '**/tmp', 'a?c', 'deep/**/x.txt', 'Ñame', 'ǅx', '', '   ', 'data\\raw', 'é*'],
    rels: ['output.csv', 'products/P1/output.csv', 'build', 'build/x', 'src/build', 'dist/a', 'src/dist', 'docs/a.md', 'docs/sub/a.md', 'DOCS/A.MD', 'logs', 'logs/a/b', 'x/logs/a', 'tmp', 'a/b/tmp', 'abc', 'aXc', 'a/c', 'x/abc', 'deep/x.txt', 'deep/a/b/x.txt', 'deepx.txt', 'ñame', 'ÑAME', 'ǆx', 'Ǆx', 'data/raw/1', 'ÉCOLE', 'école', 'a\u2028b/tmp'] },
];

const eolCases = ['', 'a', 'a\n', 'a\r\n', 'a\r\nb\n', 'a\r\nb\r\nc\n', 'a\nb\nc\r\n', '\r', '\r\r\n\n', 'x\r\n\r\n\n', '\n\r\n\r', 'đ\r\n🙂\n🙂\r\n'];

const out = {
  paths: paths.map((p) => ({ p, rel: C.safeRel(p) })),
  exclude: excludeCases.map(({ patterns, rels }) => {
    const ex = C.makeExcluder(patterns);
    return { patterns, results: rels.map((rel) => ({ rel, excluded: ex(rel) })) };
  }),
  eol: eolCases.map((text) => ({ text, out: C.normalizeEol(text, C.dominantEol(text)) })),
};
fs.writeFileSync(path.join(here, 'common.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`common.json: ${out.paths.length} paths, ${out.exclude.reduce((n, c) => n + c.results.length, 0)} exclude checks, ${out.eol.length} eol cases`);
