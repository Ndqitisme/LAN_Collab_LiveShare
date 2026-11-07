<script lang="ts">
  interface Props {
    value: string;
    label: string;
    /** 1-based numbers of the lines to mark invalid. */
    bad?: number[];
    placeholder?: string;
    hint?: string;
    error?: string;
    rows?: number;
    name?: string;
  }

  let { value = $bindable(''), label, bad = [], placeholder, hint, error, rows = 8, name }: Props = $props();

  const uid = $props.id();
  const LINE = 20;
  let scroll = $state(0);

  const count = $derived(Math.max(rows, value.split('\n').length));
  const badSet = $derived(new Set(bad));
  const note = $derived(error || hint);
</script>

<div class="field">
  <label class="label" for="line-editor-{uid}">{label}</label>
  <div class="box" class:invalid={bad.length > 0} style:--line="{LINE}px" style:height="{rows * LINE + 12}px">
    <div class="gutter" aria-hidden="true">
      <div class="numbers" style:transform="translateY({-scroll}px)">
        {#each { length: count } as _, i}
          <span class:bad={badSet.has(i + 1)}>{i + 1}</span>
        {/each}
      </div>
    </div>
    <div class="area">
      <div class="marks" aria-hidden="true" style:transform="translateY({-scroll}px)">
        {#each bad as n (n)}
          <span style:top="{(n - 1) * LINE}px"></span>
        {/each}
      </div>
      <textarea
        id="line-editor-{uid}"
        bind:value
        {placeholder}
        {name}
        wrap="off"
        spellcheck="false"
        autocomplete="off"
        aria-invalid={bad.length > 0 ? 'true' : undefined}
        aria-describedby={note ? `line-editor-${uid}-note` : undefined}
        onscroll={(e) => (scroll = e.currentTarget.scrollTop)}
      ></textarea>
    </div>
  </div>
  {#if note}
    <p id="line-editor-{uid}-note" class="note" class:error={!!error}>{note}</p>
  {/if}
</div>

<style>
  .field {
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
    min-width: 0;
    overflow: hidden;
    border: var(--lc-border-width) solid var(--lc-input-border);
    border-radius: var(--lc-radius-md);
    background: var(--lc-input-bg);
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    line-height: var(--line);
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

  .gutter {
    flex: none;
    min-width: 40px;
    padding: 6px 0;
    overflow: hidden;
    border-right: var(--lc-border-width) solid var(--lc-border);
    background: var(--lc-surface-2);
    color: var(--lc-muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .numbers span {
    display: block;
    padding: 0 var(--lc-space-2);
  }

  .numbers span.bad {
    color: var(--lc-danger);
    font-weight: var(--lc-weight-strong);
  }

  .area {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .marks {
    position: absolute;
    inset: 6px 0 auto;
    pointer-events: none;
  }

  .marks span {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--line);
    background: var(--lc-danger-soft);
    border-left: 2px solid var(--lc-danger);
  }

  textarea {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 6px var(--lc-space-2);
    border: 0;
    background: transparent;
    color: var(--lc-input-fg);
    font: inherit;
    line-height: var(--line);
    white-space: pre;
    resize: none;
    outline: none;
  }

  textarea::placeholder {
    color: var(--lc-placeholder);
    opacity: 1;
  }

  .note {
    margin: 0;
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .note.error {
    color: var(--lc-danger);
  }
</style>
