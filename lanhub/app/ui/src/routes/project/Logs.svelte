<script lang="ts">
  import { Badge, Button, EmptyState, Input, Select, VirtualList } from '@lan-collab/ui-kit';
  import { t } from '../../i18n';
  import { api, type LogLevel, type ProjectView } from '../../lib/api';
  import { logLines, logState, startLogs, stamp, type LogLine } from '../../lib/logs.svelte';
  import { errorText, toast } from '../../lib/state.svelte';

  interface Props {
    project: ProjectView;
  }

  let { project }: Props = $props();

  startLogs();

  let level = $state<'all' | LogLevel>('all');
  let scope = $state<'project' | 'all'>('project');
  let query = $state('');
  let exporting = $state(false);

  const name = $derived(project.name);
  const total = $derived.by(() => {
    void logState.version;
    return logLines().length;
  });

  // Newest first. One pass over at most 50 000 lines; search compares against a lowercased copy made once
  // per line when it arrived.
  const shown = $derived.by(() => {
    void logState.version;
    const all = logLines();
    const key = name.toLowerCase();
    const needle = query.trim().toLowerCase();
    const out: LogLine[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const l = all[i];
      if (level !== 'all' && l.level !== level) continue;
      if (scope === 'project' && l.project?.toLowerCase() !== key) continue;
      if (needle && !l.haystack.includes(needle)) continue;
      out.push(l);
    }
    return out;
  });

  const filtered = $derived(level !== 'all' || scope !== 'project' || query.trim() !== '');

  const levelOptions = [
    { value: 'all', label: t('logs.levelAll') },
    { value: 'info', label: t('logs.levelInfo') },
    { value: 'warn', label: t('logs.levelWarn') },
    { value: 'error', label: t('logs.levelError') },
  ];
  const scopeOptions = [
    { value: 'project', label: t('logs.scopeProject') },
    { value: 'all', label: t('logs.scopeAll') },
  ];

  const levelLook: Record<LogLevel, { tone: 'neutral' | 'warn' | 'danger'; label: string }> = {
    info: { tone: 'neutral', label: t('logs.levelInfo') },
    warn: { tone: 'warn', label: t('logs.levelWarn') },
    error: { tone: 'danger', label: t('logs.levelError') },
  };

  function clear() {
    level = 'all';
    scope = 'project';
    query = '';
  }

  async function exportLines() {
    exporting = true;
    // The file reads like the hub's stdout, oldest first.
    const lines = shown.map((l) => l.raw).reverse();
    const date = stamp(Date.now()).slice(0, 10);
    const safe = name.replace(/[^\p{L}\p{N}_-]+/gu, '-');
    try {
      const path = await api.exportLogs(
        t('logs.exportTitle'),
        t('logs.exportFilter'),
        `lanhub-${safe}-${date}.log`,
        lines.join('\r\n') + '\r\n',
      );
      if (path) toast('ok', t('logs.exported', { n: lines.length }), path);
    } catch (e) {
      toast('danger', errorText(e));
    } finally {
      exporting = false;
    }
  }
</script>

<div class="logs">
  <div class="toolbar">
    <Input
      icon="search"
      bind:value={query}
      placeholder={t('logs.search')}
      aria-label={t('logs.search')}
      class="search"
      type="search"
      spellcheck={false}
      name="log-search"
    />
    <Select bind:value={level} options={levelOptions} aria-label={t('logs.level')} name="log-level" />
    <Select bind:value={scope} options={scopeOptions} aria-label={t('logs.scope')} name="log-scope" />
    <span class="count" aria-live="polite">{t('logs.count', { shown: shown.length, total })}</span>
    <Button icon="download" loading={exporting} disabled={shown.length === 0} onclick={exportLines}>
      {t('logs.export')}
    </Button>
  </div>

  {#if total === 0}
    <EmptyState icon="file-text" title={t('logs.emptyTitle')} description={t('logs.emptyText')} />
  {:else if shown.length === 0}
    <EmptyState icon="search" title={t('logs.noMatchTitle')} description={t('logs.noMatchText')}>
      {#snippet actions()}
        {#if filtered}<Button icon="x" onclick={clear}>{t('logs.clearFilter')}</Button>{/if}
      {/snippet}
    </EmptyState>
  {:else}
    <div class="list" data-testid="log-list">
      <VirtualList items={shown} rowHeight={28} height="calc(100vh - 290px)" key={(l) => l.seq} label={t('logs.listLabel')}>
        {#snippet row(l)}
          <div class="line {l.level}" title={l.text}>
            <span class="ts">{stamp(l.ts).slice(11)}</span>
            <span class="lvl"><Badge tone={levelLook[l.level].tone}>{levelLook[l.level].label}</Badge></span>
            <span class="proj">{l.project ?? t('logs.hub')}</span>
            <span class="msg selectable">{l.text}</span>
          </div>
        {/snippet}
      </VirtualList>
    </div>
  {/if}
</div>

<style>
  .logs {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-3);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    flex-wrap: wrap;
  }

  .toolbar :global(.search) {
    flex: 1;
    min-width: 200px;
  }

  .count {
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .list {
    min-height: 240px;
    overflow: hidden;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
  }

  .line {
    display: grid;
    grid-template-columns: 96px 88px 120px minmax(0, 1fr);
    gap: var(--lc-space-2);
    align-items: center;
    width: 100%;
    height: 100%;
    padding: 0 var(--lc-space-3);
    font-size: var(--lc-text-sm);
    border-bottom: var(--lc-border-width) solid color-mix(in srgb, var(--lc-border) 55%, transparent);
  }

  .line.error {
    background: color-mix(in srgb, var(--lc-danger) 6%, transparent);
  }

  .line.warn {
    background: color-mix(in srgb, var(--lc-warn) 6%, transparent);
  }

  .ts {
    font-family: var(--lc-font-mono);
    color: var(--lc-muted);
    font-variant-numeric: tabular-nums;
  }

  .proj {
    color: var(--lc-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .msg {
    font-family: var(--lc-font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
