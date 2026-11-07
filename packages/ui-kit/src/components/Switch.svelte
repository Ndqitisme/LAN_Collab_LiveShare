<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    checked?: boolean;
    label?: string;
    description?: string;
    disabled?: boolean;
    id?: string;
    onchange?: (checked: boolean) => void;
    children?: Snippet;
  }

  let {
    checked = $bindable(false),
    label,
    description,
    disabled = false,
    id,
    onchange,
    children,
  }: Props = $props();

  const uid = $props.id();
  const switchId = $derived(id ?? `lc-switch-${uid}`);

  function toggle() {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<div class="lc-switch" class:disabled>
  <button
    id={switchId}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={label || children ? `${switchId}-label` : undefined}
    aria-describedby={description ? `${switchId}-desc` : undefined}
    {disabled}
    class="track"
    class:on={checked}
    onclick={toggle}
  >
    <span class="thumb"></span>
  </button>
  {#if label || children || description}
    <div class="text">
      {#if label || children}
        <label id="{switchId}-label" for={switchId}>{#if children}{@render children()}{:else}{label}{/if}</label>
      {/if}
      {#if description}<span id="{switchId}-desc" class="desc">{description}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .lc-switch {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
    min-width: 0;
  }

  .track {
    position: relative;
    flex: none;
    width: 30px;
    height: 18px;
    margin-top: 1px;
    padding: 0;
    border: var(--lc-border-width) solid var(--lc-input-border);
    border-radius: var(--lc-radius-full);
    background: var(--lc-surface-2);
    cursor: pointer;
    transition:
      background-color var(--lc-dur) var(--lc-ease),
      border-color var(--lc-dur) var(--lc-ease);
  }

  .track:hover:not(:disabled) {
    border-color: var(--lc-border-strong);
  }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: var(--lc-radius-full);
    background: var(--lc-muted);
    transition:
      transform var(--lc-dur) var(--lc-ease),
      background-color var(--lc-dur) var(--lc-ease);
  }

  .track.on {
    background: var(--lc-accent);
    border-color: var(--lc-accent);
    box-shadow: 0 0 0 1px var(--lc-control-border);
  }

  .track.on .thumb {
    background: var(--lc-accent-fg);
    transform: translateX(12px);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-0);
    min-width: 0;
  }

  label {
    cursor: pointer;
  }

  .desc {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .disabled {
    opacity: 0.55;
  }

  .disabled .track,
  .disabled label {
    cursor: default;
  }
</style>
