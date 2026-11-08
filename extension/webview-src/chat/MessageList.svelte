<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import type { Row } from './model';

  // A virtual list for rows of different heights. The kit's VirtualList needs one fixed row height, which a
  // chat with wrapped text, code blocks and images does not have. Rows are measured once rendered and
  // estimated until then; the list keeps the bottom pinned while the reader is at the bottom.
  interface Props {
    rows: Row[];
    row: Snippet<[Row]>;
    label: string;
    onbottom?: (atBottom: boolean) => void;
    empty?: Snippet;
  }

  let { rows, row, label, onbottom, empty }: Props = $props();

  const OVERSCAN_PX = 400;
  const BOTTOM_SLACK = 40;
  const BOTTOM_PAD = 12;

  let viewport: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let measured = $state(0); // bumps when a measured height changes
  const heights = new Map<string, number>();
  let pinned = true;
  let raf = 0;

  function estimate(r: Row): number {
    if (r.kind === 'day') return 38;
    const image = r.msg.image ? 200 : 0;
    return (r.cont ? 30 : 58) + image;
  }

  const offsets = $derived.by(() => {
    void measured;
    const out = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i += 1) out[i + 1] = out[i] + (heights.get(rows[i].key) ?? estimate(rows[i]));
    return out;
  });
  const total = $derived(offsets[rows.length]);

  function indexAt(y: number): number {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const start = $derived(Math.max(0, indexAt(scrollTop - OVERSCAN_PX)));
  const end = $derived(Math.min(rows.length, indexAt(scrollTop + viewportHeight + OVERSCAN_PX) + 1));
  const slice = $derived(rows.slice(start, end));

  function atBottom(): boolean {
    return !viewport || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < BOTTOM_SLACK;
  }

  function setPinned(next: boolean) {
    if (next === pinned) return;
    pinned = next;
    onbottom?.(next);
  }

  function onscroll() {
    if (!viewport) return;
    setPinned(atBottom());
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (viewport) scrollTop = viewport.scrollTop;
    });
  }

  export async function scrollToBottom() {
    pinned = true;
    onbottom?.(true);
    await tick();
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
    scrollTop = viewport.scrollTop;
  }

  export function isPinned(): boolean {
    return pinned;
  }

  // Rows above the first visible row that change height would push the text the reader is looking at;
  // the scroll position moves by the same amount, or to the bottom while pinned.
  const observer = new ResizeObserver((entries) => {
    if (!viewport) return;
    const first = indexAt(viewport.scrollTop);
    let shift = 0;
    let changed = false;
    for (const e of entries) {
      const el = e.target as HTMLElement;
      const key = el.dataset.key!;
      const h = e.borderBoxSize[0]?.blockSize ?? el.offsetHeight;
      if (!h) continue; // hidden view: keep the last real height
      const index = Number(el.dataset.index);
      const old = heights.get(key) ?? (rows[index] ? estimate(rows[index]) : h);
      if (Math.abs(old - h) < 0.5) continue;
      heights.set(key, h);
      changed = true;
      if (index < first) shift += h - old;
    }
    if (!changed) return;
    measured += 1;
    const vp = viewport;
    tick().then(() => {
      if (pinned) vp.scrollTop = vp.scrollHeight;
      else if (shift) vp.scrollTop += shift;
      scrollTop = vp.scrollTop;
    });
  });

  function measure(el: HTMLElement) {
    observer.observe(el);
    return { destroy: () => observer.unobserve(el) };
  }

  $effect(() => () => observer.disconnect());
</script>

<div class="viewport" bind:this={viewport} bind:clientHeight={viewportHeight} {onscroll} role="log" aria-label={label} aria-live="polite">
  {#if rows.length}
    <div class="spacer" style:height="{total + BOTTOM_PAD}px">
      <div class="window" style:transform="translateY({offsets[start]}px)">
        {#each slice as r, i (r.key)}
          <div class="item" data-key={r.key} data-index={start + i} use:measure>{@render row(r)}</div>
        {/each}
      </div>
    </div>
  {:else if empty}
    {@render empty()}
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .spacer {
    position: relative;
  }

  .window {
    position: absolute;
    inset: 0 0 auto;
  }
</style>
