<script lang="ts">
  import { Avatar, Icon, type IconName } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';
  import { activityText, fullTime, openablePath, relativeTime, type FeedEntry } from './feed';

  let { entry, now, onopen }: { entry: FeedEntry; now: number; onopen: (path: string) => void } = $props();

  const ICONS: Record<string, IconName> = {
    join: 'log-in',
    leave: 'log-out',
    edit: 'pencil',
    edit_disk: 'terminal',
    create: 'file-plus',
    delete: 'file-minus',
    debug_start: 'bug',
    debug_stop: 'square',
    status_set: 'message-square',
    status_clear: 'message-square',
  };

  const text = $derived(activityText(entry, t));
  const path = $derived(openablePath(entry));
  const icon = $derived(ICONS[entry.kind ?? ''] ?? 'activity');
</script>

{#snippet content()}
  <Avatar name={entry.who} color={entry.color ?? undefined} size="sm" title="" />
  <span class="text">
    <span class="top">
      <span class="who">{entry.who}</span>
      <time class="time" datetime={new Date(entry.ts).toISOString()} title={fullTime(entry.ts)}>{relativeTime(entry.ts, now, t)}</time>
    </span>
    <span class="what"><Icon name={icon} size={12} /><span class="sentence">{text}</span></span>
  </span>
{/snippet}

{#if path}
  <button type="button" class="entry link" title={t('session.feed.open', { path })} onclick={() => onopen(path)}>{@render content()}</button>
{:else}
  <div class="entry" title={`${entry.who} ${text}`}>{@render content()}</div>
{/if}

<style>
  .entry {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    width: 100%;
    height: 100%;
    min-width: 0;
    margin: 0;
    padding: 0 var(--lc-space-3);
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .entry.link {
    cursor: pointer;
    transition: background-color var(--lc-dur-fast) var(--lc-ease);
  }

  .entry.link:hover {
    background: var(--lc-hover);
  }

  .entry.link:focus-visible {
    outline-offset: -2px;
  }

  .entry.link:hover .sentence {
    color: var(--lc-link);
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    line-height: var(--lc-leading-tight);
  }

  .top {
    display: flex;
    align-items: baseline;
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

  .time {
    flex: none;
    margin-left: auto;
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    font-variant-numeric: tabular-nums;
  }

  .what {
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
    min-width: 0;
    margin-top: 2px;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .what :global(.lc-icon) {
    flex: none;
  }

  .sentence {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
