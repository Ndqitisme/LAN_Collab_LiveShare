<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    open?: boolean;
    title: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg';
    /** Close on a click outside the panel. Escape always closes. */
    dismissible?: boolean;
    closeLabel?: string;
    onclose?: () => void;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    open = $bindable(false),
    title,
    description,
    size = 'md',
    dismissible = true,
    closeLabel = 'Đóng',
    onclose,
    children,
    footer,
  }: Props = $props();

  const uid = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();
  let opener: HTMLElement | null = null;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  // Chromium restores focus on close only in some cases, so the opener is
  // focused explicitly to keep keyboard users where they were.
  function handleClose() {
    open = false;
    opener?.focus();
    opener = null;
    onclose?.();
  }

  function handleClick(e: MouseEvent) {
    if (dismissible && e.target === dialog) open = false;
  }
</script>

<dialog
  bind:this={dialog}
  class="lc-dialog {size}"
  aria-labelledby="lc-dialog-{uid}-title"
  aria-describedby={description ? `lc-dialog-${uid}-desc` : undefined}
  onclose={handleClose}
  onclick={handleClick}
>
  <div class="panel">
    <header>
      <div class="heading">
        <h2 id="lc-dialog-{uid}-title">{title}</h2>
        {#if description}<p id="lc-dialog-{uid}-desc">{description}</p>{/if}
      </div>
      <IconButton icon="x" label={closeLabel} size="sm" onclick={() => (open = false)} />
    </header>
    {#if children}<div class="content">{@render children()}</div>{/if}
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
  .lc-dialog {
    width: min(440px, calc(100vw - 2 * var(--lc-space-4)));
    max-height: calc(100vh - 2 * var(--lc-space-6));
    padding: 0;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
    color: var(--lc-fg);
    box-shadow: var(--lc-shadow-lg);
    overflow: hidden;
  }

  .sm {
    width: min(340px, calc(100vw - 2 * var(--lc-space-4)));
  }

  .lg {
    width: min(640px, calc(100vw - 2 * var(--lc-space-4)));
  }

  .lc-dialog::backdrop {
    background: var(--lc-overlay);
  }

  .lc-dialog[open] {
    animation: lc-dialog-in var(--lc-dur-slow) var(--lc-ease);
  }

  .panel {
    display: flex;
    flex-direction: column;
    max-height: inherit;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-3);
    padding: var(--lc-space-4) var(--lc-space-4) 0;
  }

  .heading {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--lc-text-lg);
    font-weight: var(--lc-weight-strong);
    line-height: var(--lc-leading-tight);
  }

  .heading p {
    margin: var(--lc-space-1) 0 0;
    color: var(--lc-muted);
  }

  .content {
    padding: var(--lc-space-4);
    overflow: auto;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--lc-space-2);
    padding: var(--lc-space-3) var(--lc-space-4);
    border-top: var(--lc-border-width) solid var(--lc-border);
    background: var(--lc-bg);
  }

  @keyframes lc-dialog-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }
</style>
