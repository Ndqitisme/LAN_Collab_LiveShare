<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  interface Props {
    items: T[];
    key: (item: T) => string;
    row: Snippet<[T]>;
    /** Key of the selected item. Setting onselect or selected makes rows selectable. */
    selected?: string | null;
    onselect?: (item: T) => void;
    label?: string;
    dense?: boolean;
    divided?: boolean;
  }

  let { items, key, row, selected = $bindable(null), onselect, label, dense = false, divided = false }: Props = $props();

  const selectable = $derived(onselect !== undefined || selected !== null);
  let root: HTMLElement | undefined = $state();

  function choose(item: T) {
    selected = key(item);
    onselect?.(item);
  }

  function focusRow(index: number) {
    root?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus();
  }

  function onkeydown(e: KeyboardEvent, index: number, item: T) {
    if (e.key === 'ArrowDown') focusRow(Math.min(index + 1, items.length - 1));
    else if (e.key === 'ArrowUp') focusRow(Math.max(index - 1, 0));
    else if (e.key === 'Home') focusRow(0);
    else if (e.key === 'End') focusRow(items.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(item);
    else return;
    e.preventDefault();
  }
</script>

{#if selectable}
  <div class="lc-list" class:dense class:divided role="listbox" aria-label={label} bind:this={root}>
    {#each items as item, i (key(item))}
      {@const isSelected = key(item) === selected}
      <div
        class="row interactive"
        class:selected={isSelected}
        role="option"
        aria-selected={isSelected}
        tabindex={isSelected || (selected === null && i === 0) ? 0 : -1}
        onclick={() => choose(item)}
        onkeydown={(e) => onkeydown(e, i, item)}
      >
        {@render row(item)}
      </div>
    {/each}
  </div>
{:else}
  <ul class="lc-list" class:dense class:divided aria-label={label}>
    {#each items as item (key(item))}
      <li class="row">{@render row(item)}</li>
    {/each}
  </ul>
{/if}

<style>
  .lc-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-height: 32px;
    padding: var(--lc-space-1) var(--lc-space-2);
    border: var(--lc-border-width) solid transparent;
    border-radius: var(--lc-radius-md);
    min-width: 0;
  }

  .dense .row {
    min-height: 24px;
    padding: var(--lc-space-0) var(--lc-space-2);
  }

  .divided {
    gap: 0;
  }

  .divided .row {
    border-radius: 0;
    border-bottom-color: var(--lc-border);
  }

  .divided .row:last-child {
    border-bottom-color: transparent;
  }

  .interactive {
    border-color: var(--lc-control-border);
    cursor: pointer;
    transition: background-color var(--lc-dur-fast) var(--lc-ease);
  }

  .interactive:hover {
    background: var(--lc-hover);
  }

  .interactive:focus-visible {
    outline-offset: -2px;
  }

  .selected,
  .selected:hover {
    background: var(--lc-list-active);
    color: var(--lc-list-active-fg);
  }

  .selected {
    border-color: var(--lc-list-active-border);
  }
</style>
