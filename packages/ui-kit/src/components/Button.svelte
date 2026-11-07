<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { IconName } from '../icons';
  import Icon from './Icon.svelte';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    icon?: IconName;
    iconEnd?: IconName;
    /** Shows a spinner, keeps the width, and blocks clicks until the work ends. */
    loading?: boolean;
    block?: boolean;
    children?: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    icon,
    iconEnd,
    loading = false,
    block = false,
    disabled = false,
    type = 'button',
    children,
    class: className = '',
    ...rest
  }: Props = $props();

  const iconSize = $derived(size === 'lg' ? 16 : 14);
</script>

<button
  {...rest}
  {type}
  class="lc-button {variant} {size} {className}"
  class:block
  class:loading
  disabled={disabled || loading}
  aria-busy={loading || undefined}
>
  {#if loading}
    <Icon name="loader-circle" size={iconSize} spin />
  {:else if icon}
    <Icon name={icon} size={iconSize} />
  {/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
  {#if iconEnd && !loading}<Icon name={iconEnd} size={iconSize} />{/if}
</button>

<style>
  .lc-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--lc-space-1);
    height: var(--lc-control-h);
    padding: 0 var(--lc-space-3);
    border: var(--lc-border-width) solid var(--lc-control-border);
    border-radius: var(--lc-radius-md);
    font-size: var(--lc-text-md);
    font-weight: var(--lc-weight-medium);
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    transition:
      background-color var(--lc-dur) var(--lc-ease),
      border-color var(--lc-dur) var(--lc-ease),
      color var(--lc-dur) var(--lc-ease);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sm {
    height: var(--lc-control-h-sm);
    padding: 0 var(--lc-space-2);
    font-size: var(--lc-text-sm);
    border-radius: var(--lc-radius-sm);
  }

  .lg {
    height: var(--lc-control-h-lg);
    padding: 0 var(--lc-space-4);
  }

  .block {
    display: flex;
    width: 100%;
  }

  .primary {
    background: var(--lc-accent);
    color: var(--lc-accent-fg);
  }

  .primary:hover:not(:disabled) {
    background: var(--lc-accent-hover);
  }

  .secondary {
    background: var(--lc-secondary);
    color: var(--lc-secondary-fg);
  }

  .secondary:hover:not(:disabled) {
    background: var(--lc-secondary-hover);
  }

  .ghost {
    background: transparent;
    color: var(--lc-fg);
  }

  .ghost:hover:not(:disabled) {
    background: var(--lc-hover);
  }

  .danger {
    background: var(--lc-danger-soft);
    border-color: color-mix(in srgb, var(--lc-danger) 45%, transparent);
    color: var(--lc-danger);
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--lc-danger) 22%, transparent);
  }

  .lc-button:active:not(:disabled) {
    transform: translateY(0.5px);
  }

  .lc-button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .lc-button.loading:disabled {
    cursor: progress;
    opacity: 0.8;
  }
</style>
