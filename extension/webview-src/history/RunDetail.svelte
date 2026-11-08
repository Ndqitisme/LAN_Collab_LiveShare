<script lang="ts">
  import { Avatar, Button, IconButton } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';
  import { actionIcon, actionLabel, actionsFor, exactTime, sizeText, sourceView, type Action, type Run } from './model';

  interface Props {
    run: Run;
    size: number | null | undefined;
    onaction: (action: Action) => void;
    onclose: () => void;
  }

  let { run, size, onaction, onclose }: Props = $props();

  const actions = $derived(actionsFor(run));
  const source = $derived(sourceView(run.source, t));
  const time = $derived(exactTime(run.started_at, run.ended_at, t));
</script>

<section class="detail" aria-labelledby="detail-title">
  <header class="head">
    <Avatar name={run.author_name} color={run.color} size="sm" title="" />
    <h2 id="detail-title">{t('history.detail.title', { author: run.author_name })}</h2>
    <IconButton size="sm" icon="x" label={t('history.detail.close')} onclick={onclose} />
  </header>
  <dl>
    <dt>{t('history.detail.file')}</dt>
    <dd class="path">{run.path}</dd>
    <dt>{t('history.detail.time')}</dt>
    <dd>{time}</dd>
    <dt>{t('history.detail.source')}</dt>
    <dd>{source.label}</dd>
    {#if run.kind === 'blob'}
      <dt>{t('history.detail.size')}</dt>
      <dd>{typeof size === 'number' ? sizeText(size, t) : '…'}</dd>
    {:else}
      <dt>{t('history.detail.changes')}</dt>
      <dd>{t('history.detail.changes.value', { added: run.chars_added, removed: run.chars_removed })}</dd>
    {/if}
  </dl>
  {#if run.reverts}<p class="note">{t('history.detail.reverts', { id: run.reverts })}</p>{/if}
  {#if run.open && run.kind === 'text'}<p class="note">{t('history.detail.openRun')}</p>{/if}
  <div class="actions">
    {#each actions as a, i (a)}
      <Button size="sm" variant={i === 0 ? 'primary' : 'secondary'} icon={actionIcon(a)} data-action={a} onclick={() => onaction(a)}>{actionLabel(a, run, t)}</Button>
    {/each}
  </div>
</section>

<style>
  .detail {
    flex: none;
    max-height: 60%;
    overflow-y: auto;
    padding: var(--lc-space-2) var(--lc-space-3) var(--lc-space-3);
    border-top: var(--lc-border-width) solid var(--lc-border);
    background: var(--lc-surface);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
  }

  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-strong);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px var(--lc-space-3);
    margin: var(--lc-space-2) 0 0;
    font-size: var(--lc-text-sm);
  }

  dt {
    color: var(--lc-muted);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .path {
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-xs);
    line-height: 1.6;
  }

  .note {
    margin: var(--lc-space-2) 0 0;
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-1);
    margin-top: var(--lc-space-3);
  }
</style>
