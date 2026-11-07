import { describe, expect, it } from 'vitest';
import { inline, isEmojiOnly, richText } from './format';
import { appendRow, GROUP_MS, type ChatMessage, type Row } from './model';

describe('inline', () => {
  it('keeps plain text as one segment', () => {
    expect(inline('hello world')).toEqual([{ kind: 'text', text: 'hello world' }]);
  });

  it('formats code spans and leaves an unclosed backtick as text', () => {
    expect(inline('run `npm test` now')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ' now' },
    ]);
    expect(inline('a `b')).toEqual([{ kind: 'text', text: 'a `b' }]);
  });

  it('does not format inside a code span', () => {
    expect(inline('`@bob a.py:3 https://x.io`')).toEqual([{ kind: 'code', text: '@bob a.py:3 https://x.io' }]);
  });

  it('links http and https URLs and drops trailing punctuation', () => {
    expect(inline('see https://example.com/a?b=1.')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'url', text: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' },
      { kind: 'text', text: '.' },
    ]);
    expect(inline('(http://h:8200/x)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'url', text: 'http://h:8200/x', url: 'http://h:8200/x' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('never links other schemes', () => {
    for (const text of ['javascript:alert(1)', 'file:///c:/x', 'vscode://x/y', 'data:text/html,hi']) {
      expect(inline(text).some((s) => s.kind === 'url')).toBe(false);
    }
  });

  it('links file:line references at a word start', () => {
    expect(inline('look at src/app.ts:42 please')).toEqual([
      { kind: 'text', text: 'look at ' },
      { kind: 'ref', text: 'src/app.ts:42', rel: 'src/app.ts', line: 42 },
      { kind: 'text', text: ' please' },
    ]);
    expect(inline('(a.py:1)')[1]).toEqual({ kind: 'ref', text: 'a.py:1', rel: 'a.py', line: 1 });
    expect(inline('thư_mục/tệp.py:7')).toEqual([{ kind: 'ref', text: 'thư_mục/tệp.py:7', rel: 'thư_mục/tệp.py', line: 7 }]);
  });

  it('does not take a reference from the middle of a word or a bare word', () => {
    expect(inline('x=a.py:3').some((s) => s.kind === 'ref')).toBe(false);
    expect(inline('time 10:30').some((s) => s.kind === 'ref')).toBe(false);
    expect(inline('README:4').some((s) => s.kind === 'ref')).toBe(false);
  });

  it('marks mentions at a word start only', () => {
    expect(inline('@all hi @Minh_Anh.')).toEqual([
      { kind: 'mention', text: '@all' },
      { kind: 'text', text: ' hi ' },
      { kind: 'mention', text: '@Minh_Anh.' },
    ]);
    expect(inline('mail me@host.vn')).toEqual([{ kind: 'text', text: 'mail me@host.vn' }]);
    expect(inline('@Đức')).toEqual([{ kind: 'mention', text: '@Đức' }]);
  });

  it('keeps markup as text', () => {
    expect(inline('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('richText', () => {
  it('turns a fenced block into pre and drops the language line', () => {
    expect(richText('before\n```js\nconst a = 1;\n```\nafter')).toEqual([
      { kind: 'text', text: 'before\n' },
      { kind: 'pre', text: 'const a = 1;' },
      { kind: 'text', text: '\nafter' },
    ]);
  });

  it('does not format inside a fence', () => {
    expect(richText('```\n@bob a.py:1 `x`\n```')).toEqual([{ kind: 'pre', text: '@bob a.py:1 `x`' }]);
  });

  it('keeps an unclosed fence as text and still formats it', () => {
    expect(richText('a ```b @c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'text', text: '```b ' },
      { kind: 'mention', text: '@c' },
    ]);
  });
});

describe('isEmojiOnly', () => {
  it('is true for short emoji-only text, including joined and flag sequences', () => {
    expect(isEmojiOnly('👍')).toBe(true);
    expect(isEmojiOnly('🎉 🚀')).toBe(true);
    expect(isEmojiOnly('👍🏽')).toBe(true);
    expect(isEmojiOnly('👨‍💻')).toBe(true);
    expect(isEmojiOnly('🇻🇳')).toBe(true);
    expect(isEmojiOnly('❤️')).toBe(true);
  });

  it('is false with text, when empty, or over 32 code units', () => {
    expect(isEmojiOnly('ok 👍')).toBe(false);
    expect(isEmojiOnly('')).toBe(false);
    expect(isEmojiOnly('😀'.repeat(17))).toBe(false);
  });
});

describe('appendRow', () => {
  const base = new Date(2026, 10, 7, 9, 0).getTime();
  const msg = (from: string, minutes: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    from,
    ts: base + minutes * 60 * 1000,
    text: 'x',
    ...extra,
  });
  const build = (list: ChatMessage[]) => {
    const rows: Row[] = [];
    let last: ChatMessage | null = null;
    for (const m of list) last = appendRow(rows, last, m);
    return rows.map((r) => (r.kind === 'day' ? 'day' : `${r.msg.from}${r.cont ? '+' : ''}`));
  };

  it('groups one sender within five minutes and starts a new group after', () => {
    expect(build([msg('a', 0), msg('a', 4), msg('a', 4 + GROUP_MS / 60000)])).toEqual(['day', 'a', 'a+', 'a']);
  });

  it('starts a new group when the sender changes, by key before name', () => {
    expect(build([msg('a', 0, { fromKey: 'k1' }), msg('a', 1, { fromKey: 'k2' }), msg('b', 2, { fromKey: 'k2' })])).toEqual([
      'day',
      'a',
      'a',
      'b+',
    ]);
  });

  it('puts a day divider before the first message of each day', () => {
    expect(build([msg('a', 0), msg('a', 24 * 60), msg('a', 24 * 60 + 1)])).toEqual(['day', 'a', 'day', 'a', 'a+']);
  });
});
