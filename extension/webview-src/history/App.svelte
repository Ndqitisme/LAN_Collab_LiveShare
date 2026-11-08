<script lang="ts">
  import { tick } from 'svelte';
  import { Button, EmptyState, IconButton, Tabs, VirtualList, type IconName } from '@lan-collab/ui-kit';
  import { setCatalog, t } from '../shared/catalog.svelte';
  import { loadState, onHostMessage, post, saveState } from '../shared/host';
  import RunDetail from './RunDetail.svelte';
  import RunRow from './RunRow.svelte';
  import { concerns, listPath, mergePage, rowView, sizesToAsk, type Action, type Mode, type Run } from './model';

  interface ConnectionView {
    name: string;
    tone?: 'connecting' | 'error' | 'offline';
    title?: string;
    description?: string;
    actions?: { id: string; label: string }[];
  }

  interface Snapshot {
    connection: ConnectionView;
    feature: boolean;
    activePath: string | null;
  }

  interface Page {
    type: 'page';
    gen: number;
    before: string | null;
    runs?: Run[];
    more?: boolean;
    error?: boolean;
  }

  type HostMessage =
    | ({ type: 'init'; catalog: Record<string, string> } & Snapshot)
    | ({ type: 'state' } & Snapshot)
    | Page
    | { type: 'changed'; path: string }
    | { type: 'size'; id: string; bytes: number | null };

  interface Saved {
    mode: Mode;
  }

  const ROW_HEIGHT = 48;
  const saved = loadState<Saved>();

  let ready = $state(false);
  let connection = $state.raw<ConnectionView>({ name: 'idle' });
  let feature = $state(false);
  let activePath = $state<string | null>(null);
  let mode = $state<Mode>(saved.mode === 'project' ? 'project' : 'file');
  let runs = $state.raw<Run[]>([]);
  let more = $state(false);
  let status = $state<'idle' | 'loading' | 'error' | 'done'>('idle');
  let loadingMore = $state(false);
  let selectedId = $state<string | null>(null);
  let sizes = $state.raw<Record<string, number | null>>({});
  let now = $state(Date.now());
  // Each scope (mode and file) gets a new generation; a page for an older one is dropped.
  let gen = 0;
  let loadedKey: string | null = null;

  const live = $derived(connection.name === 'live');
  const path = $derived(listPath(mode, activePath));
  const rows = $derived(runs.map((r) => rowView(r, now, t, sizes[r.id] ?? null)));
  const selected = $derived(runs.find((r) => r.id === selectedId) ?? null);
  const modeItems = $derived([
    { id: 'file', label: t('history.mode.file'), icon: 'file' as IconName },
    { id: 'project', label: t('history.mode.project'), icon: 'folder' as IconName },
  ]);
  const stateIcon = $derived<IconName>(connection.tone === 'connecting' ? 'refresh-cw' : connection.tone === 'error' ? 'wifi-off' : 'unplug');

  $effect(() => {
    saveState<Saved>({ mode });
  });

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  // Loads the first page whenever what the view shows changes: connection, feature, mode or open file.
  $effect(() => {
    const key = live && feature && (mode === 'project' || activePath) ? `${mode}:${path ?? ''}` : null;
    if (key === loadedKey) return;
    loadedKey = key;
    gen += 1;
    runs = [];
    more = false;
    selectedId = null;
    status = key ? 'loading' : 'idle';
    if (key) request(null);
  });

  function request(before: string | null) {
    performance.mark(`lc-history-request-${gen}`);
    post({ type: 'load', gen, path, before });
  }

  async function onPage(m: Page) {
    if (m.gen !== gen) return;
    if (m.before) loadingMore = false;
    if (m.error) {
      if (!m.before) status = runs.length ? 'done' : 'error';
      return;
    }
    const page = m.runs ?? [];
    // A refreshed first page with older runs below it leaves `more` as the last older page said.
    const keepTail = m.before === null && m.more && runs.length > 0;
    runs = mergePage(runs, page, m.before, m.more === true);
    if (!keepTail) more = m.more === true;
    if (selectedId && !runs.some((r) => r.id === selectedId)) selectedId = null;
    askSizes(sizesToAsk(runs, sizes));
    status = 'done';
    now = Date.now();
    await tick();
    requestAnimationFrame(() => {
      performance.mark(`lc-history-painted-${gen}`);
      performance.measure('lc-history-list', `lc-history-request-${gen}`, `lc-history-painted-${gen}`);
    });
  }

  function apply(s: Snapshot) {
    connection = s.connection;
    feature = s.feature;
    activePath = s.activePath;
  }

  onHostMessage<HostMessage>((m) => {
    if (m.type === 'init') {
      setCatalog(m.catalog);
      apply(m);
      ready = true;
    } else if (m.type === 'state') {
      apply(m);
    } else if (m.type === 'page') {
      onPage(m);
    } else if (m.type === 'changed') {
      if (status !== 'idle' && concerns(mode, activePath, m.path)) request(null);
    } else if (m.type === 'size') {
      sizes = { ...sizes, [m.id]: m.bytes };
    }
  });

  function askSizes(ids: string[]) {
    if (!ids.length) return;
    sizes = { ...sizes, ...Object.fromEntries(ids.map((id) => [id, null])) };
    for (const id of ids) post({ type: 'size', id });
  }

  function select(id: string) {
    selectedId = id;
    const run = runs.find((r) => r.id === id);
    if (run) askSizes(sizesToAsk([run], sizes));
  }

  function loadMore() {
    if (loadingMore || !runs.length) return;
    loadingMore = true;
    request(runs[runs.length - 1].id);
  }

  function retry() {
    status = 'loading';
    request(null);
  }

  const runAction = (action: Action, id: string) => post({ type: 'run', action, id });

  function openRow(id: string) {
    const run = runs.find((r) => r.id === id);
    if (run && run.kind === 'text') runAction('openAfter', id);
  }

  post({ type: 'ready' });
</script>

{#if ready}
  {#if !live}
    <div class="state" class:error={connection.tone === 'error'}>
      <EmptyState icon={stateIcon} title={connection.title ?? ''} description={connection.description}>
        {#snippet actions()}
          {#each connection.actions ?? [] as a, i (a.id)}
            <Button size="sm" variant={i === 0 ? 'primary' : 'secondary'} onclick={() => post({ type: 'action', id: a.id })}>{a.label}</Button>
          {/each}
        {/snippet}
      </EmptyState>
    </div>
  {:else if !feature}
    <div class="state">
      <EmptyState icon="history" title={t('history.unsupported.title')} description={t('history.unsupported.description')} />
    </div>
  {:else}
    <div class="history">
      <header class="bar">
        <Tabs items={modeItems} bind:value={mode} variant="pill" label={t('history.mode.label')} />
        <IconButton size="sm" icon="refresh-cw" label={t('history.refresh')} disabled={status === 'idle' || status === 'loading'} onclick={retry} />
      </header>
      {#if mode === 'file' && activePath}<p class="scope" title={activePath}>{activePath}</p>{/if}
      <div class="body">
        {#if mode === 'file' && !activePath}
          <EmptyState compact icon="file" title={t('history.noFile.title')} description={t('history.noFile.description')}>
            {#snippet actions()}
              <Button size="sm" onclick={() => (mode = 'project')}>{t('history.noFile.project')}</Button>
            {/snippet}
          </EmptyState>
        {:else if status === 'loading'}
          <EmptyState compact icon="loader-circle" title={t('history.loading')} />
        {:else if status === 'error'}
          <EmptyState compact icon="circle-alert" title={t('history.error.title')} description={t('history.error.description')}>
            {#snippet actions()}
              <Button size="sm" onclick={retry}>{t('history.retry')}</Button>
            {/snippet}
          </EmptyState>
        {:else if !runs.length}
          <EmptyState
            compact
            icon="history"
            title={mode === 'file' ? t('history.empty.file.title') : t('history.empty.project.title')}
            description={mode === 'file' ? t('history.empty.file.description') : t('history.empty.project.description')}
          />
        {:else}
          <div class="list">
            <VirtualList items={rows} rowHeight={ROW_HEIGHT} height="100%" key={(r) => r.id} label={t('history.list.label')}>
              {#snippet row(r)}
                <RunRow row={r} selected={r.id === selectedId} showPath={mode === 'project'} onselect={select} onopen={openRow} />
              {/snippet}
            </VirtualList>
          </div>
          {#if more}
            <div class="more">
              <Button size="sm" variant="ghost" block loading={loadingMore} onclick={loadMore}>{t('history.more')}</Button>
            </div>
          {/if}
        {/if}
      </div>
      {#if selected}
        <RunDetail run={selected} size={sizes[selected.id]} onaction={(a) => runAction(a, selected.id)} onclose={() => (selectedId = null)} />
      {/if}
    </div>
  {/if}
{/if}

<style>
  :global(html),
  :global(body),
  :global(#app) {
    height: 100%;
  }

  :global(body) {
    overflow: hidden;
  }

  .history {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    padding: var(--lc-space-2) var(--lc-space-3) var(--lc-space-1);
  }

  .bar :global(.lc-tabs) {
    flex: 1;
    min-width: 0;
  }

  .scope {
    margin: 0;
    padding: 0 var(--lc-space-3) var(--lc-space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--lc-muted);
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-xs);
  }

  .body {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 80px;
  }

  .list {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
  }

  .more {
    flex: none;
    padding: var(--lc-space-1) var(--lc-space-3);
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .state {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    height: 100%;
    padding: var(--lc-space-4) var(--lc-space-3);
  }

  .state.error :global(.lc-empty .icon) {
    color: var(--lc-danger);
  }
</style>
