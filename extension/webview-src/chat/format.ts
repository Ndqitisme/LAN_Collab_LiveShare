// Message text to display segments. Messages come from other machines, so the view renders every segment
// as text: nothing here produces HTML.

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'pre'; text: string }
  | { kind: 'url'; text: string; url: string }
  | { kind: 'mention'; text: string }
  | { kind: 'ref'; text: string; rel: string; line: number };

const URL_RE = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/y;
const REF_RE = /([A-Za-z0-9_\-./À-￿]+\.[A-Za-z0-9]+):(\d+)/y;
const MENTION_RE = /@[\p{L}\p{N}_.-]+/uy;
const CODE_RE = /`([^`\n]+)`/y;
const WORD_START = /[\s([{>"',]/;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;

function at(re: RegExp, text: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(text);
}

// `code`, http(s) URLs, @mentions and file:line references; mentions and references only at a word start.
export function inline(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain });
    plain = '';
  };
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    const wordStart = i === 0 || WORD_START.test(text[i - 1]);
    let m: RegExpExecArray | null = null;
    let seg: Segment | null = null;
    if (ch === '`' && (m = at(CODE_RE, text, i))) seg = { kind: 'code', text: m[1] };
    else if (ch === 'h' && (m = at(URL_RE, text, i))) seg = { kind: 'url', text: m[0], url: m[0] };
    else if (ch === '@' && wordStart && (m = at(MENTION_RE, text, i))) seg = { kind: 'mention', text: m[0] };
    else if (wordStart && (m = at(REF_RE, text, i))) seg = { kind: 'ref', text: m[0], rel: m[1], line: Number(m[2]) };
    if (!m || !seg) {
      plain += ch;
      i += 1;
      continue;
    }
    flush();
    out.push(seg);
    i += m[0].length;
  }
  flush();
  return out;
}

// ```fenced``` blocks become pre segments (an optional language line is dropped); an unclosed fence stays text.
export function richText(text: string): Segment[] {
  const parts = text.split('```');
  const out: Segment[] = [];
  parts.forEach((part, k) => {
    if (k % 2 === 1 && k < parts.length - 1) out.push({ kind: 'pre', text: part.replace(/^[\w+-]*\n/, '').replace(/\n$/, '') });
    else out.push(...inline(k % 2 === 1 ? '```' + part : part));
  });
  return out;
}

export function isEmojiOnly(text: string): boolean {
  return text.length > 0 && text.length <= 32 && EMOJI_ONLY.test(text);
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
