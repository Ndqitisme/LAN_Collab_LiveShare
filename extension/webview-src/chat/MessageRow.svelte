<script lang="ts">
  import { Avatar } from '@lan-collab/ui-kit';
  import ImageShot from './ImageShot.svelte';
  import RichText from './RichText.svelte';
  import { isEmojiOnly } from './format';
  import type { ChatMessage } from './model';

  let { msg, cont }: { msg: ChatMessage; cont: boolean } = $props();

  const text = $derived(msg.text || '');
  const big = $derived(isEmojiOnly(text));
  const time = $derived(new Date(msg.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
  const stamp = $derived(new Date(msg.ts).toLocaleString('vi-VN'));
</script>

<div class="row" class:mine={msg.mine} class:cont>
  {#if !msg.mine}
    {#if cont}
      <span class="avatar-gap"></span>
    {:else}
      <Avatar name={msg.from} color={msg.color} />
    {/if}
  {/if}
  <div class="col">
    {#if !cont}
      <div class="head">
        {#if !msg.mine}
          <span class="who" style:color={msg.color} title={msg.account ? `${msg.account.provider}: ${msg.account.label}` : undefined}
            >{msg.from}</span
          >
        {/if}
        <span class="time">{time}</span>
      </div>
    {/if}
    {#if text}
      <div class="bubble" class:big class:mention={msg.mention} title={stamp}><RichText {text} /></div>
    {/if}
    {#if msg.image?.id}<ImageShot image={msg.image} />{/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
    padding: var(--lc-space-3) var(--lc-space-3) 0;
  }

  .row.cont {
    padding-top: var(--lc-space-0);
  }

  .row.mine {
    justify-content: flex-end;
  }

  .avatar-gap {
    flex: none;
    width: 28px;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
    min-width: 0;
    max-width: calc(100% - 36px);
  }

  .mine .col {
    align-items: flex-end;
    max-width: 88%;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--lc-space-2);
    padding: 0 var(--lc-space-0);
    font-size: var(--lc-text-sm);
    line-height: var(--lc-leading-tight);
  }

  .who {
    overflow: hidden;
    font-weight: var(--lc-weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .bubble {
    max-width: 100%;
    padding: 6px 10px;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-sm) var(--lc-radius-lg) var(--lc-radius-lg) var(--lc-radius-lg);
    background: var(--lc-surface);
    line-height: var(--lc-leading);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .mine .bubble {
    border-color: var(--lc-control-border);
    border-radius: var(--lc-radius-lg) var(--lc-radius-sm) var(--lc-radius-lg) var(--lc-radius-lg);
    background: var(--lc-accent);
    color: var(--lc-accent-fg);
  }

  .bubble.mention {
    border-color: var(--lc-warn);
    background: color-mix(in srgb, var(--lc-warn) 10%, var(--lc-surface));
    box-shadow: inset 3px 0 0 var(--lc-warn);
  }

  .bubble.big,
  .mine .bubble.big {
    padding: 0 var(--lc-space-0);
    border-color: transparent;
    background: none;
    box-shadow: none;
    color: inherit;
    font-size: 1.9em;
    line-height: 1.2;
  }

  .bubble :global(a) {
    color: var(--lc-link);
    border-radius: 2px;
  }

  .mine .bubble :global(a) {
    color: inherit;
    text-decoration: underline;
  }

  .bubble :global(a.ref) {
    font-family: var(--lc-font-mono);
    font-size: 0.95em;
  }

  .bubble :global(.tag) {
    color: var(--lc-link);
    font-weight: var(--lc-weight-strong);
  }

  .mine .bubble :global(.tag) {
    color: inherit;
  }

  .bubble :global(code),
  .bubble :global(pre) {
    border-radius: var(--lc-radius-sm);
    background: var(--lc-code-bg);
    color: inherit;
    font-family: var(--lc-font-mono);
    font-size: 0.92em;
  }

  .bubble :global(code) {
    padding: 1px 4px;
  }

  .bubble :global(pre) {
    margin: var(--lc-space-1) 0;
    padding: 6px var(--lc-space-2);
    overflow-x: auto;
    white-space: pre;
  }

  .mine .bubble :global(code),
  .mine .bubble :global(pre) {
    background: rgba(0, 0, 0, 0.22);
  }
</style>
