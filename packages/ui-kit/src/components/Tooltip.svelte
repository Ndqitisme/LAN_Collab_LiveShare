<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    text: string;
    placement?: 'top' | 'bottom';
    /** Which edge of the trigger the bubble lines up with. Use start or end near a container edge. */
    align?: 'center' | 'start' | 'end';
    /** Delay before showing on hover. Keyboard focus shows it at once. */
    delay?: number;
    /** Keeps the tooltip visible; used by the gallery and screenshots. */
    open?: boolean;
    children: Snippet;
  }

  let { text, placement = 'top', align = 'center', delay = 400, open = false, children }: Props = $props();

  const uid = $props.id();
  const tipId = `lc-tooltip-${uid}`;
  let shown = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wrap: HTMLSpanElement | undefined = $state();

  $effect(() => {
    const target = wrap?.querySelector<HTMLElement>('button, a, input, select, textarea, [tabindex]');
    target?.setAttribute('aria-describedby', tipId);
    return () => target?.removeAttribute('aria-describedby');
  });

  function show(wait: number) {
    clearTimeout(timer);
    timer = setTimeout(() => (shown = true), wait);
  }

  function hide() {
    clearTimeout(timer);
    shown = false;
  }
</script>

<span
  class="lc-tooltip"
  bind:this={wrap}
  role="presentation"
  onpointerenter={() => show(delay)}
  onpointerleave={hide}
  onfocusin={() => show(0)}
  onfocusout={hide}
  onkeydown={(e) => e.key === 'Escape' && hide()}
>
  {@render children()}
  <span id={tipId} role="tooltip" class="bubble {placement} {align}" class:visible={shown || open}>{text}</span>
</span>

<style>
  .lc-tooltip {
    position: relative;
    display: inline-flex;
  }

  .bubble {
    position: absolute;
    --lc-tip-x: -50%;
    left: 50%;
    z-index: var(--lc-z-tooltip);
    width: max-content;
    max-width: 240px;
    padding: var(--lc-space-1) var(--lc-space-2);
    border: var(--lc-border-width) solid var(--lc-tooltip-border);
    border-radius: var(--lc-radius-sm);
    background: var(--lc-tooltip-bg);
    color: var(--lc-tooltip-fg);
    box-shadow: var(--lc-shadow-sm);
    font-size: var(--lc-text-sm);
    line-height: var(--lc-leading-tight);
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transform: translate(var(--lc-tip-x), 2px);
    transition:
      opacity var(--lc-dur-fast) var(--lc-ease),
      transform var(--lc-dur-fast) var(--lc-ease),
      visibility 0s linear var(--lc-dur-fast);
  }

  .start {
    --lc-tip-x: 0%;
    left: 0;
  }

  .end {
    --lc-tip-x: 0%;
    left: auto;
    right: 0;
  }

  .top {
    bottom: calc(100% + 6px);
  }

  .bottom {
    top: calc(100% + 6px);
    transform: translate(var(--lc-tip-x), -2px);
  }

  .visible {
    opacity: 1;
    visibility: visible;
    transform: translate(var(--lc-tip-x), 0);
    transition-delay: 0s;
  }
</style>
