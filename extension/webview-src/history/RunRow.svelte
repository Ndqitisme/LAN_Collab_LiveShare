<script lang="ts">
  import { Avatar, Icon } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';
  import type { RowView } from './model';

  interface Props {
    row: RowView;
    selected: boolean;
    showPath: boolean;
    onselect: (id: string) => void;
    onopen: (id: string) => void;
  }

  let { row, selected, showPath, onselect, onopen }: Props = $props();

  const slash = $derived(row.path.lastIndexOf('/'));
  const base = $derived(row.path.slice(slash + 1));
  const dir = $derived(slash > 0 ? row.path.slice(0, slash) : '');
</script>

<button
  type="button"
  class="run"
  class:selected
  data-run={row.id}
  aria-pressed={selected}
  onclick={() => onselect(row.id)}
  ondblclick={() => onopen(row.id)}
>
  <Avatar name={row.author} color={row.color} size="sm" title="" />
  <span class="body">
    <span class="top">
      <span class="who">{row.author}</span>
      {#if row.open}<span class="open" title={t('history.open.tooltip')}><span class="dot"></span>{t('history.open')}</span>{/if}
      <time class="time" datetime={new Date(row.start).toISOString()} title={row.timeTitle}>{row.time}</time>
    </span>
    <span class="bottom">
      <span class="source {row.source.tone}" title={row.source.tooltip}><Icon name={row.source.icon} size={12} />{row.source.label}</span>
      {#if showPath}
        <span class="path" title={row.path}><span class="base">{base}</span>{#if dir}<span class="dir">{dir}</span>{/if}</span>
      {/if}
      {#if row.binary}
        <span class="counts binary" title={t('history.binary')}>{row.size ?? t('history.binary')}</span>
      {:else if row.added || row.removed}
        <span class="counts" title={t('history.counts.tooltip', { added: row.added, removed: row.removed })}>
          {#if row.added}<span class="added">+{row.added}</span>{/if}
          {#if row.removed}<span class="removed">−{row.removed}</span>{/if}
        </span>
      {/if}
    </span>
  </span>
</button>

<style>
  .run {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    width: 100%;
    height: 100%;
    min-width: 0;
    margin: 0;
    padding: 0 var(--lc-space-3);
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--lc-dur-fast) var(--lc-ease);
  }

  .run:hover {
    background: var(--lc-hover);
  }

  .run:focus-visible {
    outline-offset: -2px;
  }

  .run.selected {
    border-left-color: var(--lc-list-active-border);
    background: var(--lc-list-active);
    color: var(--lc-list-active-fg);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    line-height: var(--lc-leading-tight);
  }

  .top,
  .bottom {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
  }

  .who {
    flex: 0 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-strong);
  }

  .open {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--lc-space-1);
    color: var(--lc-ok);
    font-size: var(--lc-text-xs);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--lc-radius-full);
    background: currentColor;
  }

  .time {
    flex: none;
    margin-left: auto;
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    font-variant-numeric: tabular-nums;
  }

  .source {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 3px;
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
  }

  .source.warn {
    color: var(--lc-warn);
  }

  .source.accent {
    color: var(--lc-link);
  }

  .source.danger {
    color: var(--lc-danger);
  }

  .path {
    display: flex;
    flex: 0 1 auto;
    align-items: baseline;
    gap: var(--lc-space-1);
    min-width: 0;
    overflow: hidden;
    font-size: var(--lc-text-xs);
    white-space: nowrap;
  }

  .base {
    flex: none;
  }

  .dir {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--lc-muted);
  }

  .counts {
    display: inline-flex;
    flex: none;
    gap: var(--lc-space-1);
    margin-left: auto;
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-xs);
    font-variant-numeric: tabular-nums;
  }

  .counts.binary {
    color: var(--lc-muted);
    font-family: inherit;
  }

  .added {
    color: var(--lc-ok);
  }

  .removed {
    color: var(--lc-danger);
  }

  .run.selected .time,
  .run.selected .source,
  .run.selected .dir {
    color: inherit;
    opacity: 0.85;
  }
</style>
