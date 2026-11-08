<script lang="ts">
  import { Avatar, StatusDot } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';
  import type { Person } from './model';

  let { connected, users, onmention }: { connected: boolean; users: Person[]; onmention: (name: string) => void } = $props();

  const SHOWN = 6;
  const state = $derived(
    !connected ? t('chat.state.offline') : users.length ? t('chat.state.online', { count: users.length }) : t('chat.state.alone'),
  );
</script>

<header class="top">
  <StatusDot status={connected ? 'live' : 'offline'} label={state} />
  <div class="faces">
    {#each users.slice(0, SHOWN) as u (u.name)}
      <button
        type="button"
        class="face"
        title={`${u.name}${u.status ? ` · ${u.status}` : ''}\n${t('chat.face.mention')}`}
        aria-label={u.name}
        onclick={() => onmention(u.name)}
      >
        <Avatar name={u.name} color={u.color} size="sm" title="" />
      </button>
    {/each}
    {#if users.length > SHOWN}
      <span class="more" title={users.slice(SHOWN).map((u) => u.name).join(', ')}>+{users.length - SHOWN}</span>
    {/if}
  </div>
</header>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--lc-space-2);
    min-height: 36px;
    padding: var(--lc-space-1) var(--lc-space-3);
    border-bottom: var(--lc-border-width) solid var(--lc-border);
  }

  .top > :global(.lc-status) {
    flex: 1;
  }

  .faces {
    display: flex;
    align-items: center;
    flex: none;
  }

  .face {
    display: inline-flex;
    margin-left: -4px;
    padding: 1px;
    border: var(--lc-border-width) solid var(--lc-control-border);
    border-radius: var(--lc-radius-full);
    background: var(--lc-bg);
    cursor: pointer;
    transition: transform var(--lc-dur-fast) var(--lc-ease);
  }

  .face:first-child {
    margin-left: 0;
  }

  .face:hover {
    position: relative;
    z-index: 1;
    transform: translateY(-1px);
  }

  .face:focus-visible {
    position: relative;
    z-index: 1;
  }

  .more {
    margin-left: var(--lc-space-1);
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    font-variant-numeric: tabular-nums;
  }
</style>
