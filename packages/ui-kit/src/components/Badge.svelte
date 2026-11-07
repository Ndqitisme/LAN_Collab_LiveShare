<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../icons';
  import Icon from './Icon.svelte';

  interface Props {
    tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
    /** solid is for counts on top of other UI; soft is for labels in text. */
    variant?: 'soft' | 'solid' | 'outline';
    icon?: IconName;
    title?: string;
    children?: Snippet;
  }

  let { tone = 'neutral', variant = 'soft', icon, title, children }: Props = $props();
</script>

<span class="lc-badge {tone} {variant}" {title}>
  {#if icon}<Icon name={icon} size={12} />{/if}
  {#if children}{@render children()}{/if}
</span>

<style>
  .lc-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-1);
    height: 20px;
    min-width: 20px;
    padding: 0 var(--lc-space-2);
    border: var(--lc-border-width) solid transparent;
    border-radius: var(--lc-radius-full);
    font-size: var(--lc-text-xs);
    font-weight: var(--lc-weight-strong);
    line-height: 1;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    justify-content: center;
  }

  .soft.neutral {
    background: var(--lc-surface-2);
    border-color: var(--lc-border);
    color: var(--lc-muted);
  }

  .soft.accent {
    background: var(--lc-accent-soft);
    color: var(--lc-link);
  }

  .soft.ok {
    background: var(--lc-ok-soft);
    color: var(--lc-ok);
  }

  .soft.warn {
    background: var(--lc-warn-soft);
    color: var(--lc-warn);
  }

  .soft.danger {
    background: var(--lc-danger-soft);
    color: var(--lc-danger);
  }

  .solid {
    color: var(--lc-badge-fg);
    background: var(--lc-badge-bg);
  }

  .solid.neutral {
    background: var(--lc-muted);
    color: var(--lc-bg);
  }

  .solid.ok {
    background: var(--lc-ok);
    color: var(--lc-bg);
  }

  .solid.warn {
    background: var(--lc-warn);
    color: var(--lc-bg);
  }

  .solid.danger {
    background: var(--lc-danger);
    color: var(--lc-bg);
  }

  .outline {
    background: transparent;
    border-color: currentColor;
  }

  .outline.neutral {
    color: var(--lc-muted);
  }

  .outline.accent {
    color: var(--lc-link);
  }

  .outline.ok {
    color: var(--lc-ok);
  }

  .outline.warn {
    color: var(--lc-warn);
  }

  .outline.danger {
    color: var(--lc-danger);
  }
</style>
