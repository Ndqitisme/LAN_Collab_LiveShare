<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLTextareaAttributes, 'value'> {
    value?: string;
    label?: string;
    hint?: string;
    error?: string;
    /** Grows with its content up to maxRows, then scrolls. */
    autoresize?: boolean;
    maxRows?: number;
    mono?: boolean;
  }

  let {
    value = $bindable(''),
    label,
    hint,
    error,
    autoresize = false,
    rows = 3,
    maxRows = 10,
    mono = false,
    id,
    disabled = false,
    maxlength,
    class: className = '',
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const areaId = $derived(id ?? `lc-textarea-${uid}`);
  const noteId = $derived(`${areaId}-note`);
  const note = $derived(error || hint);
  let el: HTMLTextAreaElement | undefined = $state();

  $effect(() => {
    if (!autoresize || !el) return;
    void value;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 18;
    const border = el.offsetHeight - el.clientHeight;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + border, line * maxRows + padding + border)}px`;
  });
</script>

<div class="lc-field {className}" class:disabled>
  {#if label}<label class="label" for={areaId}>{label}</label>{/if}
  <textarea
    {...rest}
    bind:this={el}
    bind:value
    id={areaId}
    {rows}
    {disabled}
    {maxlength}
    class:mono
    class:invalid={!!error}
    class:autoresize
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={note ? noteId : undefined}
  ></textarea>
  {#if note || maxlength}
    <div class="foot">
      {#if note}<p id={noteId} class="note" class:error={!!error}>{note}</p>{/if}
      {#if maxlength}<span class="count">{value.length}/{maxlength}</span>{/if}
    </div>
  {/if}
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

  textarea {
    display: block;
    width: 100%;
    padding: 5px var(--lc-space-2);
    background: var(--lc-input-bg);
    color: var(--lc-input-fg);
    border: var(--lc-border-width) solid var(--lc-input-border);
    border-radius: var(--lc-radius-md);
    font-size: var(--lc-text-md);
    line-height: var(--lc-leading);
    resize: vertical;
    transition: border-color var(--lc-dur) var(--lc-ease);
  }

  textarea.autoresize {
    resize: none;
  }

  textarea:hover {
    border-color: var(--lc-border-strong);
  }

  textarea:focus-visible {
    outline: none;
    border-color: var(--lc-focus);
    box-shadow: 0 0 0 1px var(--lc-focus);
  }

  textarea.invalid {
    border-color: var(--lc-danger);
  }

  textarea::placeholder {
    color: var(--lc-placeholder);
    opacity: 1;
  }

  textarea.mono {
    font-family: var(--lc-font-mono);
  }

  .foot {
    display: flex;
    gap: var(--lc-space-2);
    align-items: baseline;
  }

  .note {
    flex: 1;
    margin: 0;
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .note.error {
    color: var(--lc-danger);
  }

  .count {
    margin-left: auto;
    font-size: var(--lc-text-xs);
    color: var(--lc-muted);
    font-variant-numeric: tabular-nums;
  }

  .disabled {
    opacity: 0.55;
  }
</style>
