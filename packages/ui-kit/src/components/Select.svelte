<script lang="ts" module>
  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';

  interface Props extends Omit<HTMLSelectAttributes, 'value'> {
    value?: string;
    options: SelectOption[];
    label?: string;
    hint?: string;
    error?: string;
    /** Shown as a disabled first option while value is empty. */
    placeholder?: string;
  }

  let {
    value = $bindable(''),
    options,
    label,
    hint,
    error,
    placeholder,
    id,
    disabled = false,
    class: className = '',
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const selectId = $derived(id ?? `lc-select-${uid}`);
  const noteId = $derived(`${selectId}-note`);
  const note = $derived(error || hint);
</script>

<div class="lc-field {className}" class:disabled>
  {#if label}<label class="label" for={selectId}>{label}</label>{/if}
  <div class="box">
    <select
      {...rest}
      id={selectId}
      {disabled}
      bind:value
      class:invalid={!!error}
      class:empty={!value}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={note ? noteId : undefined}
    >
      {#if placeholder}<option value="" disabled>{placeholder}</option>{/if}
      {#each options as option (option.value)}
        <option value={option.value} disabled={option.disabled}>{option.label}</option>
      {/each}
    </select>
    <Icon name="chevron-down" size={14} class="chevron" />
  </div>
  {#if note}<p id={noteId} class="note" class:error={!!error}>{note}</p>{/if}
</div>

<style>
  .lc-field {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
    min-width: 0;
  }

  .label {
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-medium);
  }

  .box {
    position: relative;
    display: flex;
  }

  select {
    appearance: none;
    width: 100%;
    height: var(--lc-control-h);
    padding: 0 28px 0 var(--lc-space-2);
    background: var(--lc-input-bg);
    color: var(--lc-input-fg);
    border: var(--lc-border-width) solid var(--lc-input-border);
    border-radius: var(--lc-radius-md);
    font-size: var(--lc-text-md);
    text-overflow: ellipsis;
    cursor: pointer;
    transition: border-color var(--lc-dur) var(--lc-ease);
  }

  select.empty {
    color: var(--lc-placeholder);
  }

  select:hover:not(:disabled) {
    border-color: var(--lc-border-strong);
  }

  select:focus-visible {
    outline: none;
    border-color: var(--lc-focus);
    box-shadow: 0 0 0 1px var(--lc-focus);
  }

  select.invalid {
    border-color: var(--lc-danger);
  }

  option {
    background: var(--lc-surface);
    color: var(--lc-fg);
  }

  .box :global(.chevron) {
    position: absolute;
    right: var(--lc-space-2);
    top: 50%;
    transform: translateY(-50%);
    color: var(--lc-muted);
    pointer-events: none;
  }

  .note {
    margin: 0;
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .note.error {
    color: var(--lc-danger);
  }

  .disabled {
    opacity: 0.55;
  }

  .disabled select {
    cursor: default;
  }
</style>
