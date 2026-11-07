<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    description?: string;
    padding?: 'none' | 'sm' | 'md';
    /** Header area on the right, for buttons or a badge. */
    actions?: Snippet;
    footer?: Snippet;
    children?: Snippet;
    class?: string;
  }

  let { title, description, padding = 'md', actions, footer, children, class: className = '' }: Props = $props();
</script>

<section class="lc-card pad-{padding} {className}">
  {#if title || actions}
    <header>
      <div class="heading">
        {#if title}<h3>{title}</h3>{/if}
        {#if description}<p>{description}</p>{/if}
      </div>
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  {#if children}<div class="body">{@render children()}</div>{/if}
  {#if footer}<footer>{@render footer()}</footer>{/if}
</section>

<style>
  .lc-card {
    --lc-card-pad: var(--lc-space-4);
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
    color: var(--lc-fg);
  }

  .pad-sm {
    --lc-card-pad: var(--lc-space-3);
  }

  .pad-none {
    --lc-card-pad: 0px;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-3);
    padding: var(--lc-space-3) var(--lc-space-4);
    border-bottom: var(--lc-border-width) solid var(--lc-border);
  }

  .heading {
    flex: 1;
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-size: var(--lc-text-md);
    font-weight: var(--lc-weight-strong);
    line-height: var(--lc-leading-tight);
  }

  .heading p {
    margin: var(--lc-space-0) 0 0;
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--lc-space-1);
  }

  .body {
    padding: var(--lc-card-pad);
    min-width: 0;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--lc-space-2);
    padding: var(--lc-space-3) var(--lc-space-4);
    border-top: var(--lc-border-width) solid var(--lc-border);
  }
</style>
