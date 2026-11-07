<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../icons';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    tone?: 'info' | 'ok' | 'warn' | 'danger';
    title: string;
    message?: string;
    /** Buttons that act on the message, such as "Thử lại". */
    actions?: Snippet;
    /** Renders a close button when set. */
    onclose?: () => void;
    closeLabel?: string;
  }

  let { tone = 'info', title, message, actions, onclose, closeLabel = 'Đóng' }: Props = $props();

  const icon: Record<NonNullable<Props['tone']>, IconName> = {
    info: 'info',
    ok: 'circle-check',
    warn: 'triangle-alert',
    danger: 'circle-alert',
  };
</script>

<div class="lc-toast {tone}" role={tone === 'danger' ? 'alert' : 'status'}>
  <span class="icon"><Icon name={icon[tone]} size={16} /></span>
  <div class="body">
    <p class="title">{title}</p>
    {#if message}<p class="message">{message}</p>{/if}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
  {#if onclose}<IconButton icon="x" label={closeLabel} size="sm" onclick={onclose} />{/if}
</div>

<style>
  .lc-toast {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-3);
    width: 100%;
    max-width: 380px;
    padding: var(--lc-space-3);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
    color: var(--lc-fg);
    box-shadow: var(--lc-shadow-lg);
  }

  .icon {
    display: inline-flex;
    margin-top: 1px;
  }

  .info .icon {
    color: var(--lc-link);
  }

  .ok .icon {
    color: var(--lc-ok);
  }

  .warn .icon {
    color: var(--lc-warn);
  }

  .danger .icon {
    color: var(--lc-danger);
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .title {
    font-weight: var(--lc-weight-strong);
  }

  .message {
    margin-top: var(--lc-space-0);
    color: var(--lc-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-2);
    margin-top: var(--lc-space-3);
  }
</style>
