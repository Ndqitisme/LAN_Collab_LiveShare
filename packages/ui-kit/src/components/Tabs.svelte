<script lang="ts" module>
  import type { IconName } from '../icons';

  export interface TabItem {
    id: string;
    label: string;
    icon?: IconName;
    count?: number;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    items: TabItem[];
    value?: string;
    variant?: 'line' | 'pill';
    label?: string;
    onchange?: (id: string) => void;
    /** Renders the panel for the selected tab. */
    children?: Snippet<[string]>;
  }

  let { items, value = $bindable(items[0]?.id ?? ''), variant = 'line', label, onchange, children }: Props = $props();

  const uid = $props.id();
  let list: HTMLDivElement | undefined = $state();

  function select(id: string) {
    if (id === value) return;
    value = id;
    onchange?.(id);
  }

  function onkeydown(e: KeyboardEvent) {
    const enabled = items.filter((t) => !t.disabled);
    const at = enabled.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (at + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(enabled[next].id);
    list?.querySelector<HTMLButtonElement>(`#lc-tab-${uid}-${enabled[next].id}`)?.focus();
  }
</script>

<div class="lc-tabs {variant}">
  <div class="list" role="tablist" aria-label={label} bind:this={list} tabindex="-1" {onkeydown}>
    {#each items as tab (tab.id)}
      <button
        id="lc-tab-{uid}-{tab.id}"
        type="button"
        role="tab"
        class="tab"
        aria-selected={tab.id === value}
        aria-controls="lc-panel-{uid}"
        tabindex={tab.id === value ? 0 : -1}
        disabled={tab.disabled}
        onclick={() => select(tab.id)}
      >
        {#if tab.icon}<Icon name={tab.icon} size={14} />{/if}
        <span>{tab.label}</span>
        {#if tab.count !== undefined}<span class="count">{tab.count}</span>{/if}
      </button>
    {/each}
  </div>
  {#if children}
    <div id="lc-panel-{uid}" class="panel" role="tabpanel" aria-labelledby="lc-tab-{uid}-{value}">
      {@render children(value)}
    </div>
  {/if}
</div>

<style>
  .lc-tabs {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .list {
    display: flex;
    gap: var(--lc-space-1);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .list::-webkit-scrollbar {
    display: none;
  }

  .line .list {
    border-bottom: var(--lc-border-width) solid var(--lc-border);
  }

  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-1);
    flex: none;
    height: var(--lc-control-h);
    padding: 0 var(--lc-space-2);
    border: var(--lc-border-width) solid var(--lc-control-border);
    border-radius: var(--lc-radius-md);
    background: transparent;
    color: var(--lc-muted);
    font-size: var(--lc-text-md);
    font-weight: var(--lc-weight-medium);
    white-space: nowrap;
    cursor: pointer;
    transition:
      color var(--lc-dur) var(--lc-ease),
      background-color var(--lc-dur) var(--lc-ease);
  }

  .tab:hover:not(:disabled) {
    color: var(--lc-fg);
    background: var(--lc-hover);
  }

  .tab:focus-visible {
    outline-offset: -2px;
  }

  .tab:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .line .tab {
    margin-bottom: 4px;
  }

  .line .tab[aria-selected='true'] {
    color: var(--lc-fg);
  }

  .line .tab[aria-selected='true']::after {
    content: '';
    position: absolute;
    left: var(--lc-space-2);
    right: var(--lc-space-2);
    bottom: -5px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--lc-accent);
  }

  .pill .list {
    padding: 2px;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface-2);
    align-self: flex-start;
    max-width: 100%;
  }

  .pill .tab {
    height: var(--lc-control-h-sm);
  }

  .pill .tab[aria-selected='true'] {
    background: var(--lc-surface);
    color: var(--lc-fg);
    box-shadow: var(--lc-shadow-sm);
  }

  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: var(--lc-radius-full);
    background: var(--lc-surface-2);
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .panel {
    padding-top: var(--lc-space-3);
    min-width: 0;
  }
</style>
