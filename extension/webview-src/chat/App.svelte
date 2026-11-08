<script lang="ts" module>
  import { setCatalog, t } from '../shared/catalog.svelte';

  function dayLabel(ts: number): string {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t('chat.day.today');
    if (d.toDateString() === yesterday.toDateString()) return t('chat.day.yesterday');
    return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
</script>

<script lang="ts">
  import { EmptyState, Icon } from '@lan-collab/ui-kit';
  import { tick } from 'svelte';
  import { onHostMessage, post } from '../shared/host';
  import Composer from './Composer.svelte';
  import Header from './Header.svelte';
  import MessageList from './MessageList.svelte';
  import MessageRow from './MessageRow.svelte';
  import { mediaArrived } from './media.svelte';
  import { appendRow, type ChatMessage, type Person, type Row } from './model';

  type HostMessage =
    | { type: 'init'; catalog: Record<string, string>; connected: boolean; users: Person[]; messages: ChatMessage[] }
    | { type: 'people'; connected: boolean; users: Person[] }
    | { type: 'msg'; msg: ChatMessage }
    | { type: 'insert'; text: string }
    | { type: 'notice'; text: string }
    | { type: 'sendResult'; ok: boolean; reason?: string }
    | { type: 'media'; id: string; src: string | null };

  let ready = $state(false);
  let connected = $state(false);
  let users = $state.raw<Person[]>([]);
  let rows = $state.raw<Row[]>([]);
  let last: ChatMessage | null = null;
  let unseen = $state(0);
  let atBottom = $state(true);
  let list: MessageList | undefined = $state();
  let composer: Composer | undefined = $state();

  function onbottom(bottom: boolean) {
    atBottom = bottom;
    if (bottom) unseen = 0;
  }

  async function add(msg: ChatMessage) {
    const stick = !list || list.isPinned() || msg.mine;
    const next = rows.slice();
    last = appendRow(next, last, msg);
    rows = next;
    if (stick) {
      await tick();
      list?.scrollToBottom();
    } else {
      unseen += 1;
    }
  }

  onHostMessage<HostMessage>(async (m) => {
    if (m.type === 'init') {
      setCatalog(m.catalog);
      connected = m.connected;
      users = m.users;
      const next: Row[] = [];
      last = null;
      for (const msg of m.messages) last = appendRow(next, last, msg);
      rows = next;
      unseen = 0;
      ready = true;
      await tick();
      list?.scrollToBottom();
    } else if (m.type === 'people') {
      connected = m.connected;
      users = m.users;
    } else if (m.type === 'msg') {
      add(m.msg);
    } else if (m.type === 'insert') {
      composer?.insert(m.text);
    } else if (m.type === 'notice') {
      composer?.notice(m.text);
    } else if (m.type === 'sendResult') {
      composer?.sendResult(m.ok, m.reason);
    } else if (m.type === 'media') {
      mediaArrived(m.id, m.src);
    }
  });

  post({ type: 'ready' });
</script>

{#if ready}
  <div class="chat" class:offline={!connected}>
    <Header {connected} {users} onmention={(name) => composer?.insert(`@${name} `)} />
    <div class="log">
      <MessageList bind:this={list} {rows} {onbottom} label={t('chat.list.label')}>
        {#snippet row(r: Row)}
          {#if r.kind === 'day'}
            <div class="day"><span>{dayLabel(r.ts)}</span></div>
          {:else}
            <MessageRow msg={r.msg} cont={r.cont} />
          {/if}
        {/snippet}
        {#snippet empty()}
          {#if connected}
            <EmptyState icon="message-square" title={t('chat.empty.title')} description={t('chat.empty.online')} />
          {:else}
            <EmptyState icon="unplug" title={t('chat.state.offline')} description={t('chat.empty.offline')} />
          {/if}
        {/snippet}
      </MessageList>
      {#if !atBottom}
        <button type="button" class="jump" class:count={unseen > 0} title={t('chat.jump.title')} aria-label={t('chat.jump.title')} onclick={() => list?.scrollToBottom()}>
          {#if unseen}<span>{t('chat.jump.count', { count: unseen })}</span>{/if}
          <Icon name="arrow-down" size={14} />
        </button>
      {/if}
    </div>
    <Composer bind:this={composer} {connected} {users} />
  </div>
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

  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .log {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .day {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    padding: var(--lc-space-4) var(--lc-space-3) var(--lc-space-1);
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    font-weight: var(--lc-weight-medium);
  }

  .day::before,
  .day::after {
    content: '';
    flex: 1;
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .jump {
    position: absolute;
    right: var(--lc-space-4);
    bottom: var(--lc-space-3);
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-1);
    height: var(--lc-control-h);
    min-width: var(--lc-control-h);
    justify-content: center;
    padding: 0 var(--lc-space-2);
    border: var(--lc-border-width) solid var(--lc-border-strong);
    border-radius: var(--lc-radius-full);
    background: var(--lc-surface);
    color: var(--lc-fg);
    box-shadow: var(--lc-shadow-lg);
    font-size: var(--lc-text-sm);
    cursor: pointer;
    transition: background-color var(--lc-dur) var(--lc-ease);
  }

  .jump:hover {
    background: color-mix(in srgb, var(--lc-surface) 80%, var(--lc-fg));
  }

  .jump.count {
    padding: 0 var(--lc-space-3);
    border-color: var(--lc-control-border);
    background: var(--lc-accent);
    color: var(--lc-accent-fg);
  }

  .jump.count:hover {
    background: var(--lc-accent-hover);
  }
</style>
