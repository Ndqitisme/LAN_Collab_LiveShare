<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { IconName } from '../icons';
  import Icon from './Icon.svelte';

  interface Props extends HTMLButtonAttributes {
    icon: IconName;
    /** Required: it is the accessible name and the hover title. */
    label: string;
    variant?: 'ghost' | 'secondary' | 'primary';
    size?: 'sm' | 'md' | 'lg';
    /** Set for toggle buttons; renders aria-pressed. */
    pressed?: boolean;
    loading?: boolean;
  }

  let {
    icon,
    label,
    variant = 'ghost',
    size = 'md',
    pressed,
    loading = false,
    disabled = false,
    type = 'button',
    class: className = '',
    ...rest
  }: Props = $props();

  const iconSize = $derived(size === 'sm' ? 14 : size === 'lg' ? 18 : 16);
</script>

<button
  {...rest}
  {type}
  class="lc-icon-button {variant} {size} {className}"
  class:pressed
  aria-label={label}
  title={label}
  aria-pressed={pressed}
  aria-busy={loading || undefined}
  disabled={disabled || loading}
>
  <Icon name={loading ? 'loader-circle' : icon} size={iconSize} spin={loading} />
</button>

<style>
  .lc-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--lc-control-h);
    height: var(--lc-control-h);
    padding: 0;
    border: var(--lc-border-width) solid var(--lc-control-border);
    border-radius: var(--lc-radius-md);
    cursor: pointer;
    transition:
      background-color var(--lc-dur) var(--lc-ease),
      color var(--lc-dur) var(--lc-ease);
  }

  .sm {
    width: var(--lc-control-h-sm);
    height: var(--lc-control-h-sm);
    border-radius: var(--lc-radius-sm);
  }

  .lg {
    width: var(--lc-control-h-lg);
    height: var(--lc-control-h-lg);
  }

  .ghost {
    background: transparent;
    color: var(--lc-muted);
  }

  .ghost:hover:not(:disabled) {
    background: var(--lc-hover);
    color: var(--lc-fg);
  }

  .ghost.pressed {
    background: var(--lc-active);
    color: var(--lc-fg);
  }

  .secondary {
    background: var(--lc-secondary);
    color: var(--lc-secondary-fg);
  }

  .secondary:hover:not(:disabled) {
    background: var(--lc-secondary-hover);
  }

  .primary {
    background: var(--lc-accent);
    color: var(--lc-accent-fg);
  }

  .primary:hover:not(:disabled) {
    background: var(--lc-accent-hover);
  }

  .lc-icon-button:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
