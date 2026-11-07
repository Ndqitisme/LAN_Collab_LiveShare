<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import type { IconName } from '../icons';
  import Icon from './Icon.svelte';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    value?: string;
    label?: string;
    hint?: string;
    /** Error text under the field; also marks the field invalid. */
    error?: string;
    icon?: IconName;
    mono?: boolean;
  }

  let {
    value = $bindable(''),
    label,
    hint,
    error,
    icon,
    mono = false,
    id,
    disabled = false,
    type = 'text',
    class: className = '',
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const inputId = $derived(id ?? `lc-input-${uid}`);
  const noteId = $derived(`${inputId}-note`);
  const note = $derived(error || hint);
</script>

<div class="lc-field {className}" class:disabled>
  {#if label}<label class="label" for={inputId}>{label}</label>{/if}
  <div class="box" class:invalid={!!error}>
    {#if icon}<Icon name={icon} size={14} class="lead" />{/if}
    <input
      {...rest}
      id={inputId}
      {type}
      {disabled}
      class:mono
      bind:value
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={note ? noteId : undefined}
    />
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
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    height: var(--lc-control-h);
    padding: 0 var(--lc-space-2);
    background: var(--lc-input-bg);
    color: var(--lc-input-fg);
    border: var(--lc-border-width) solid var(--lc-input-border);
    border-radius: var(--lc-radius-md);
    transition: border-color var(--lc-dur) var(--lc-ease);
  }

  .box:hover {
    border-color: var(--lc-border-strong);
  }

  .box:focus-within {
    border-color: var(--lc-focus);
    box-shadow: 0 0 0 1px var(--lc-focus);
  }

  .box.invalid {
    border-color: var(--lc-danger);
  }

  .box.invalid:focus-within {
    box-shadow: 0 0 0 1px var(--lc-danger);
  }

  .box :global(.lead) {
    color: var(--lc-muted);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: var(--lc-text-md);
  }

  input:focus-visible {
    outline: none;
  }

  input::placeholder {
    color: var(--lc-placeholder);
    opacity: 1;
  }

  input.mono {
    font-family: var(--lc-font-mono);
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

  .disabled .box:hover {
    border-color: var(--lc-input-border);
  }
</style>
