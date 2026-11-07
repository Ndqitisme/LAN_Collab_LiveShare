<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    checked?: boolean;
    /** Mixed state for a parent of partly checked items. Cleared on the next click. */
    indeterminate?: boolean;
    label?: string;
    description?: string;
    disabled?: boolean;
    id?: string;
    name?: string;
    value?: string;
    onchange?: (checked: boolean) => void;
    children?: Snippet;
  }

  let {
    checked = $bindable(false),
    indeterminate = $bindable(false),
    label,
    description,
    disabled = false,
    id,
    name,
    value,
    onchange,
    children,
  }: Props = $props();

  const uid = $props.id();
  const boxId = $derived(id ?? `lc-checkbox-${uid}`);
</script>

<label class="lc-checkbox" class:disabled for={boxId}>
  <span class="control">
    <input
      id={boxId}
      type="checkbox"
      {name}
      {value}
      {disabled}
      bind:checked
      bind:indeterminate
      aria-describedby={description ? `${boxId}-desc` : undefined}
      onchange={(e) => onchange?.(e.currentTarget.checked)}
    />
    <span class="box" aria-hidden="true">
      {#if indeterminate}
        <Icon name="minus" size={12} strokeWidth={3} />
      {:else if checked}
        <Icon name="check" size={12} strokeWidth={3} />
      {/if}
    </span>
  </span>
  {#if label || children || description}
    <span class="text">
      {#if label || children}<span>{#if children}{@render children()}{:else}{label}{/if}</span>{/if}
      {#if description}<span id="{boxId}-desc" class="desc">{description}</span>{/if}
    </span>
  {/if}
</label>

<style>
  .lc-checkbox {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
    min-width: 0;
    cursor: pointer;
  }

  .control {
    position: relative;
    display: inline-flex;
    flex: none;
    margin-top: 2px;
  }

  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: var(--lc-border-width) solid var(--lc-input-border);
    border-radius: var(--lc-radius-sm);
    background: var(--lc-input-bg);
    color: var(--lc-accent-fg);
    transition:
      background-color var(--lc-dur-fast) var(--lc-ease),
      border-color var(--lc-dur-fast) var(--lc-ease);
  }

  .lc-checkbox:hover:not(.disabled) .box {
    border-color: var(--lc-border-strong);
  }

  input:checked + .box,
  input:indeterminate + .box {
    background: var(--lc-accent);
    border-color: var(--lc-accent);
    box-shadow: 0 0 0 1px var(--lc-control-border);
  }

  input:focus-visible + .box {
    outline: var(--lc-focus-width) solid var(--lc-focus);
    outline-offset: 1px;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-0);
    min-width: 0;
  }

  .desc {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
