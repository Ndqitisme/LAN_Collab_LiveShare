<script lang="ts">
  interface Props {
    status: 'live' | 'connecting' | 'offline' | 'error' | 'idle';
    /** Visible text next to the dot. Without it, pass srLabel so the state is not color-only. */
    label?: string;
    srLabel?: string;
    size?: number;
  }

  let { status, label, srLabel, size = 8 }: Props = $props();
</script>

<span class="lc-status {status}" style:--lc-dot-size="{size}px">
  <span class="dot" aria-hidden="true"></span>
  {#if label}<span class="label">{label}</span>{:else if srLabel}<span class="lc-sr-only">{srLabel}</span>{/if}
</span>

<style>
  .lc-status {
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
    --lc-dot: var(--lc-muted);
  }

  .live {
    --lc-dot: var(--lc-ok);
  }

  .connecting {
    --lc-dot: var(--lc-warn);
  }

  .error {
    --lc-dot: var(--lc-danger);
  }

  .offline {
    --lc-dot: var(--lc-muted);
  }

  .idle {
    --lc-dot: var(--lc-border-strong);
  }

  .dot {
    position: relative;
    flex: none;
    width: var(--lc-dot-size);
    height: var(--lc-dot-size);
    border-radius: var(--lc-radius-full);
    background: var(--lc-dot);
  }

  .offline .dot {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--lc-dot);
  }

  .connecting .dot::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--lc-dot);
    animation: lc-pulse 1.4s var(--lc-ease) infinite;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  @keyframes lc-pulse {
    from {
      transform: scale(1);
      opacity: 0.6;
    }
    to {
      transform: scale(2.4);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .connecting .dot::after {
      animation: none;
    }
  }
</style>
