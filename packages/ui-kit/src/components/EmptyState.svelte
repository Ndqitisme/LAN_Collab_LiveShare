<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../icons';
  import Icon from './Icon.svelte';

  interface Props {
    icon?: IconName;
    title: string;
    description?: string;
    compact?: boolean;
    actions?: Snippet;
  }

  let { icon = 'inbox', title, description, compact = false, actions }: Props = $props();
</script>

<div class="lc-empty" class:compact>
  <span class="icon"><Icon name={icon} size={compact ? 18 : 22} strokeWidth={1.75} /></span>
  <p class="title">{title}</p>
  {#if description}<p class="description">{description}</p>{/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .lc-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--lc-space-1);
    padding: var(--lc-space-8) var(--lc-space-4);
    text-align: center;
  }

  .compact {
    padding: var(--lc-space-4) var(--lc-space-3);
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-bottom: var(--lc-space-2);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface-2);
    color: var(--lc-muted);
  }

  .compact .icon {
    width: 36px;
    height: 36px;
  }

  p {
    margin: 0;
    max-width: 320px;
  }

  .title {
    font-weight: var(--lc-weight-strong);
  }

  .description {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--lc-space-2);
    margin-top: var(--lc-space-3);
  }
</style>
