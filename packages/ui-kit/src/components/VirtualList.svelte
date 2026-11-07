<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { visibleRange } from '../virtual';

  interface Props {
    items: T[];
    /** Every row has this height in pixels. */
    rowHeight: number;
    /** Height of the scroll area, any CSS length. */
    height?: string;
    overscan?: number;
    key?: (item: T, index: number) => string | number;
    row: Snippet<[T, number]>;
    label?: string;
  }

  let { items, rowHeight, height = '320px', overscan = 6, key = (_, i) => i, row, label }: Props = $props();

  let scrollTop = $state(0);
  let viewport = $state(0);
  let raf = 0;
  let pending = 0;

  const range = $derived(visibleRange(scrollTop, viewport, rowHeight, items.length, overscan));
  const slice = $derived(items.slice(range.start, range.end));

  // Coalesce scroll events to one update per frame.
  function onscroll(e: Event) {
    pending = (e.currentTarget as HTMLElement).scrollTop;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      scrollTop = pending;
    });
  }
</script>

<div
  class="lc-virtual"
  style:height
  role="list"
  aria-label={label}
  bind:clientHeight={viewport}
  {onscroll}
>
  <div class="spacer" style:height="{items.length * rowHeight}px">
    <div class="window" style:transform="translateY({range.start * rowHeight}px)">
      {#each slice as item, i (key(item, range.start + i))}
        <div class="row" role="listitem" style:height="{rowHeight}px">
          {@render row(item, range.start + i)}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .lc-virtual {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    contain: strict;
    min-width: 0;
  }

  .lc-virtual:focus-visible {
    outline-offset: -2px;
  }

  .spacer {
    position: relative;
  }

  .window {
    position: absolute;
    inset: 0 0 auto;
    will-change: transform;
  }

  .row {
    display: flex;
    align-items: center;
    min-width: 0;
    overflow: hidden;
  }
</style>
