<script lang="ts">
  import { untrack } from 'svelte';
  import { Avatar, Button, EmptyState, StatusDot } from '@lan-collab/ui-kit';
  import { num, t } from '../../i18n';
  import { api, type ClientInfo, type ProjectView } from '../../lib/api';
  import { when } from '../../lib/format';
  import { clock, errorText } from '../../lib/state.svelte';

  interface Props {
    project: ProjectView;
  }

  let { project }: Props = $props();

  // Presence (file, RTT) changes without a status event, so the list is read again every second while
  // the tab is open; one actor round trip each.
  const EVERY = 1000;

  const name = $derived(project.name);
  const running = $derived(project.state === 'running');
  let clients = $state<ClientInfo[] | null>(null);
  let loadError = $state<string | null>(null);

  async function load(n: string) {
    try {
      const next = await api.clients(n);
      next.sort((a, b) => a.joinedAt - b.joinedAt);
      clients = next;
      loadError = null;
    } catch (e) {
      loadError = errorText(e);
    }
  }

  $effect(() => {
    const n = name;
    if (!running) {
      clients = null;
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await untrack(() => load(n));
      if (!stopped) timer = setTimeout(tick, EVERY);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  });

  function rttTone(ms: number): 'live' | 'connecting' | 'error' {
    return ms < 50 ? 'live' : ms < 200 ? 'connecting' : 'error';
  }
</script>

{#if !running}
  <EmptyState
    icon="pause"
    title={t(project.state === 'failed' ? 'detail.failedTitle' : 'detail.notRunningTitle', { name })}
    description={t('members.notRunningText')}
  />
{:else if loadError && !clients}
  <EmptyState icon="circle-alert" title={loadError}>
    {#snippet actions()}
      <Button icon="refresh-cw" onclick={() => load(name)}>{t('common.retry')}</Button>
    {/snippet}
  </EmptyState>
{:else if !clients}
  <EmptyState icon="loader-circle" title={t('common.loading')} compact />
{:else if clients.length === 0}
  <EmptyState icon="users" title={t('members.emptyTitle')} description={t('members.emptyText')} />
{:else}
  <div class="summary">
    <StatusDot status="live" />
    <span>{t('members.count', { n: clients.length })}</span>
    <span class="muted">{t('members.live')}</span>
  </div>
  <div class="table" role="table" aria-label={t('members.count', { n: clients.length })} data-testid="members">
    <div class="row head" role="row">
      <span role="columnheader">{t('members.name')}</span>
      <span role="columnheader">{t('members.account')}</span>
      <span role="columnheader">{t('members.address')}</span>
      <span role="columnheader">{t('members.file')}</span>
      <span role="columnheader" class="num">{t('members.rtt')}</span>
      <span role="columnheader" class="num">{t('members.joined')}</span>
    </div>
    {#each clients as c (c.id)}
      <div class="row" role="row" data-member={c.name}>
        <span role="cell" class="who">
          <Avatar name={c.name} size="sm" />
          <span class="ellipsis" title={c.name}>{c.name}</span>
        </span>
        <span role="cell" class="ellipsis" class:muted={!c.account} title={c.account ?? ''}>
          {c.account ?? t('members.noAccount')}
        </span>
        <span role="cell" class="mono selectable">{c.addr}</span>
        <span role="cell" class="ellipsis mono" class:muted={!c.file} title={c.file ?? ''}>
          {c.file ?? t('members.noFile')}
        </span>
        <span role="cell" class="num rtt">
          {#if c.rtt === null}
            <span class="muted">{t('members.rttUnknown')}</span>
          {:else}
            <StatusDot status={rttTone(c.rtt)} size={7} />
            {t('members.rttValue', { n: num(c.rtt) })}
          {/if}
        </span>
        <span role="cell" class="num muted">{when(c.joinedAt, clock.now)}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .summary {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    font-weight: var(--lc-weight-medium);
  }

  .summary .muted {
    font-weight: normal;
  }

  .table {
    overflow: hidden;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(140px, 1.2fr) minmax(120px, 1fr) 120px minmax(140px, 1.6fr) 90px 100px;
    gap: var(--lc-space-3);
    align-items: center;
    min-height: 44px;
    padding: var(--lc-space-1) var(--lc-space-4);
  }

  .row + .row {
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .head {
    min-height: 34px;
    background: var(--lc-surface-2);
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-medium);
    color: var(--lc-muted);
  }

  .who {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
    font-weight: var(--lc-weight-medium);
  }

  .ellipsis {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mono {
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
  }

  .num {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .rtt {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--lc-space-1);
  }

  .muted {
    color: var(--lc-muted);
  }
</style>
