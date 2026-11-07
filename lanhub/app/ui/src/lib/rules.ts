// Client-side checks that mirror config_file.rs, so the editors mark a line while it is typed. The Rust side
// checks again before it writes.

/** `provider:label` or a bare label, without spaces or `#`, like `allow_entry_ok` in config_file.rs. */
export function allowEntryOk(entry: string): boolean {
  if (!entry || /\s|#/.test(entry)) return false;
  const colon = entry.indexOf(':');
  if (colon < 0) return true;
  const provider = entry.slice(0, colon);
  const label = entry.slice(colon + 1);
  return /^[A-Za-z0-9_-]+$/.test(provider) && label.length > 0 && !label.includes(':');
}

/** 1-based numbers of the non-blank lines that fail `ok`, after trimming. */
export function badLines(text: string, ok: (line: string) => boolean): number[] {
  const bad: number[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line && !ok(line)) bad.push(i + 1);
  });
  return bad;
}

/** The trimmed non-blank lines, as the Rust side stores them. */
export function entries(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
