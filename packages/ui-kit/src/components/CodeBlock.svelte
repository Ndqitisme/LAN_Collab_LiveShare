<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    code: string;
    /** Caption in the header, such as a file name or "PowerShell". */
    label?: string;
    copyable?: boolean;
    wrap?: boolean;
    copyLabel?: string;
    copiedLabel?: string;
  }

  let {
    code,
    label,
    copyable = true,
    wrap = false,
    copyLabel = 'Sao chép',
    copiedLabel = 'Đã sao chép',
  }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    await navigator.clipboard.writeText(code);
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1600);
  }
</script>

<div class="lc-code">
  {#if label || copyable}
    <div class="head">
      <span class="label">{label ?? ''}</span>
      {#if copyable}
        <button type="button" class="copy" onclick={copy} aria-live="polite">
          <Icon name={copied ? 'clipboard-check' : 'copy'} size={13} />
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      {/if}
    </div>
  {/if}
  <pre class:wrap><code>{code}</code></pre>
</div>

<style>
  .lc-code {
    min-width: 0;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-md);
    background: var(--lc-code-bg);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--lc-space-2);
    height: 28px;
    padding: 0 var(--lc-space-1) 0 var(--lc-space-3);
    border-bottom: var(--lc-border-width) solid var(--lc-border);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--lc-text-xs);
    color: var(--lc-muted);
  }

  .copy {
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-1);
    height: 22px;
    padding: 0 var(--lc-space-2);
    border: var(--lc-border-width) solid var(--lc-control-border);
    border-radius: var(--lc-radius-sm);
    background: transparent;
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    cursor: pointer;
  }

  .copy:hover {
    background: var(--lc-hover);
    color: var(--lc-fg);
  }

  pre {
    margin: 0;
    padding: var(--lc-space-3);
    overflow-x: auto;
    font-size: var(--lc-text-sm);
    line-height: 1.55;
    tab-size: 2;
  }

  pre:focus-visible {
    outline-offset: -2px;
  }

  pre.wrap {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
