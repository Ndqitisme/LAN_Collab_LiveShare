import { SvelteMap } from 'svelte/reactivity';
import { post } from '../shared/host';

// Image id -> data URI, or null once the host answered that LAN Hub no longer has it. Cached for the page's
// life: rows of the virtual list mount again on every scroll, and each image is asked for once.
const sources = new SvelteMap<string, string | null>();
const asked = new Set<string>();

export function requestMedia(id: string): void {
  if (asked.has(id)) return;
  asked.add(id);
  post({ type: 'media', id });
}

export function mediaSource(id: string): string | null | undefined {
  return sources.get(id);
}

export function mediaArrived(id: string, src: string | null): void {
  sources.set(id, src);
}
