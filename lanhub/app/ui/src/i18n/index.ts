import vi from './vi.json';

type Tree = { readonly [k: string]: string | Tree };
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

/** Every key of vi.json, so a typo fails the type check. */
export type Key = Paths<typeof vi>;
export type Params = Record<string, string | number>;

const numbers = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

/** Formats with the Vietnamese decimal comma: 0,4 and 1.250. */
export function num(n: number): string {
  return numbers.format(n);
}

/** The string at `key` with each `{name}` filled; numbers use `num`. */
export function t(key: Key, params: Params = {}): string {
  let node: string | Tree = vi;
  for (const part of key.split('.')) node = typeof node === 'string' ? node : node[part];
  const text = typeof node === 'string' ? node : key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : typeof v === 'number' ? num(v) : v;
  });
}

/** For keys built at run time (error codes from the Rust side). */
export function tDynamic(key: string, params: Params = {}): string {
  return t(key as Key, params);
}
