<script lang="ts">
  import { Button, EmptyState, Icon, Select, VirtualList, type IconName } from '@lan-collab/ui-kit';
  import { setCatalog, t } from '../shared/catalog.svelte';
  import { loadState, onHostMessage, post, saveState } from '../shared/host';
  import FeedRow from './FeedRow.svelte';
  import MemberRow from './MemberRow.svelte';
  import {
    feedMembers,
    filterFeed,
    KIND_FILTERS,
    kindLabel,
    newestFirst,
    prepend,
    sortMembers,
    type ConnectionView,
    type FeedEntry,
    type KindFilter,
    type Member,
  } from './feed';

  interface Snapshot {
    connection: ConnectionView;
    me: Member | null;
    members: Member[];
    following: string | null;
  }

  type HostMessage =
    | ({ type: 'init'; catalog: Record<string, string>; activity: FeedEntry[] } & Snapshot)
    | ({ type: 'members' } & Snapshot)
    | { type: 'activity'; entry: FeedEntry };

  interface Saved {
    kind: string;
    who: string;
  }

  const ROW_HEIGHT = 44;
  const saved = loadState<Saved>();

  let ready = $state(false);
  let connection = $state.raw<ConnectionView>({ name: 'idle' });
  let me = $state.raw<Member | null>(null);
  let members = $state.raw<Member[]>([]);
  let following = $state<string | null>(null);
  let feed = $state.raw<FeedEntry[]>([]);
  let kind = $state(KIND_FILTERS.includes(saved.kind as KindFilter) ? (saved.kind as string) : 'all');
  let who = $state(typeof saved.who === 'string' ? saved.who : '');
  let now = $state(Date.now());

  const live = $derived(connection.name === 'live' && me !== null);
  const others = $derived(sortMembers(members));
  const shown = $derived(filterFeed(feed, kind as KindFilter, who));
  const kindOptions = $derived(KIND_FILTERS.map((k) => ({ value: k, label: kindLabel(k, t) })));
  const whoOptions = $derived.by(() => {
    const names = feedMembers(feed, [...(me ? [me.name] : []), ...members.map((m) => m.name)]);
    if (who && !names.includes(who)) names.push(who);
    return [{ value: '', label: t('session.filter.member.all') }, ...names.map((n) => ({ value: n, label: n }))];
  });
  const stateIcon = $derived<IconName>(connection.tone === 'connecting' ? 'refresh-cw' : connection.tone === 'error' ? 'wifi-off' : 'unplug');

  $effect(() => {
    saveState<Saved>({ kind, who });
  });

  // Relative times move on their own.
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  function apply(s: Snapshot) {
    connection = s.connection;
    me = s.me;
    members = s.members;
    following = s.following;
  }

  onHostMessage<HostMessage>((m) => {
    if (m.type === 'init') {
      setCatalog(m.catalog);
      apply(m);
      feed = newestFirst(m.activity);
      now = Date.now();
      ready = true;
    } else if (m.type === 'members') {
      apply(m);
    } else if (m.type === 'activity') {
      feed = prepend(feed, m.entry);
      now = Date.now();
    }
  });

  const goTo = (id: string) => post({ type: 'goTo', id });
  const follow = (id: string | null) => post({ type: 'follow', id });
  const open = (path: string, line = 1) => post({ type: 'open', path, line });

  function clearFilters() {
    kind = 'all';
    who = '';
  }

  post({ type: 'ready' });
</script>

{#if ready}
  {#if live && me}
    <div class="session">
      <section class="members" aria-labelledby="members-head">
        <header class="section-head">
          <h2 id="members-head">{t('session.members.count', { count: members.length + 1 })}</h2>
        </header>
        <div class="member-list" role="list">
          <MemberRow member={me} self ongoto={goTo} onfollow={follow} onopen={open} />
          {#each others as m (m.id)}
            <MemberRow member={m} following={m.id === following} ongoto={goTo} onfollow={follow} onopen={open} />
          {/each}
        </div>
        {#if !others.length}<p class="alone">{t('session.members.alone')}</p>{/if}
      </section>
      <section class="feed" aria-labelledby="feed-head">
        <header class="section-head">
          <h2 id="feed-head">{t('session.feed.title')}</h2>
          {#if shown !== feed}
            <button type="button" class="clear" onclick={clearFilters}><Icon name="x" size={12} />{t('session.feed.clearFilter')}</button>
          {/if}
        </header>
        <div class="filters">
          <span class="filter-icon"><Icon name="funnel" size={14} /></span>
          <Select class="filter" bind:value={kind} options={kindOptions} aria-label={t('session.filter.kind.label')} title={t('session.filter.kind.label')} />
          <Select class="filter" bind:value={who} options={whoOptions} aria-label={t('session.filter.member.label')} title={t('session.filter.member.label')} />
        </div>
        <div class="feed-body">
          {#if shown.length}
            <VirtualList items={shown} rowHeight={ROW_HEIGHT} height="100%" label={t('session.feed.label')}>
              {#snippet row(entry: FeedEntry)}
                <FeedRow {entry} {now} onopen={(path) => open(path)} />
              {/snippet}
            </VirtualList>
          {:else if feed.length}
            <EmptyState compact icon="funnel" title={t('session.feed.filtered.title')}>
              {#snippet actions()}
                <Button size="sm" onclick={clearFilters}>{t('session.feed.clearFilter')}</Button>
              {/snippet}
            </EmptyState>
          {:else}
            <EmptyState compact icon="activity" title={t('session.feed.empty.title')} description={t('session.feed.empty.description')} />
          {/if}
        </div>
      </section>
    </div>
  {:else}
    <div class="state" class:error={connection.tone === 'error'}>
      <EmptyState icon={stateIcon} title={connection.title ?? ''} description={connection.description}>
        {#snippet actions()}
          {#each connection.actions ?? [] as a, i (a.id)}
            <Button size="sm" variant={i === 0 ? 'primary' : 'secondary'} onclick={() => post({ type: 'action', id: a.id })}>{a.label}</Button>
          {/each}
        {/snippet}
      </EmptyState>
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

  .session {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .members {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    max-height: 55%;
    min-height: 0;
  }

  .member-list {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: var(--lc-space-1);
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-height: 28px;
    padding: var(--lc-space-1) var(--lc-space-3);
  }

  .section-head h2 {
    margin: 0;
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-strong);
  }

  .alone {
    margin: 0;
    padding: var(--lc-space-1) var(--lc-space-3) var(--lc-space-2);
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .feed {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 140px;
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .clear {
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-1);
    margin-left: auto;
    padding: 0 var(--lc-space-1);
    border: none;
    border-radius: var(--lc-radius-sm);
    background: none;
    color: var(--lc-link);
    font-size: var(--lc-text-xs);
    cursor: pointer;
  }

  .clear:hover {
    background: var(--lc-hover);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--lc-space-1);
    padding: 0 var(--lc-space-3) var(--lc-space-2);
    min-width: 0;
  }

  .filter-icon {
    display: inline-flex;
    flex: none;
    color: var(--lc-muted);
  }

  /* Below about 260 px the two filters stack instead of truncating their captions. */
  .filters :global(.filter) {
    flex: 1 1 100px;
    min-width: 0;
  }

  .feed-body {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
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
