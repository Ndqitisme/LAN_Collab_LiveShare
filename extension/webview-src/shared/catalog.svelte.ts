// Captions arrive from the host in each view's init message (catalogFor('<view>.') in lib/i18n.js).
// Call t() with a literal id and an object literal of plain keys: test/i18n.test.js checks both statically.
let entries: Record<string, string> = $state({});

export function setCatalog(next: Record<string, string>): void {
  entries = next;
}

export function t(id: string, args?: Record<string, string | number>): string {
  const text = entries[id];
  if (typeof text !== 'string') return id;
  return args ? text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(args, k) ? String(args[k]) : m)) : text;
}
