<script lang="ts">
  interface Props {
    /** 0 to 1. Leave undefined for work of unknown length. */
    value?: number;
    label?: string;
    /** Text on the right of the label, such as "12/40 file". Defaults to a percentage. */
    detail?: string;
    tone?: 'accent' | 'ok' | 'warn' | 'danger';
    size?: 'sm' | 'md';
  }

  let { value, label, detail, tone = 'accent', size = 'md' }: Props = $props();

  const pct = $derived(value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100));
  const uid = $props.id();
</script>

<div class="lc-progress {tone} {size}">
  {#if label}
    <div class="meta">
      <span id="lc-progress-{uid}" class="label">{label}</span>
      {#if detail ?? pct !== undefined}<span class="detail">{detail ?? `${pct}%`}</span>{/if}
    </div>
  {/if}
  <div
    class="track"
    role="progressbar"
    aria-labelledby={label ? `lc-progress-${uid}` : undefined}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={pct}
    aria-valuetext={detail}
  >
    <div class="fill" class:indeterminate={pct === undefined} style:width={pct === undefined ? undefined : `${pct}%`}></div>
  </div>
</div>

<style>
  .lc-progress {
    --lc-bar: var(--lc-progress);
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
    min-width: 0;
  }

  .ok {
    --lc-bar: var(--lc-ok);
  }

  .warn {
    --lc-bar: var(--lc-warn);
  }

  .danger {
    --lc-bar: var(--lc-danger);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: var(--lc-space-2);
    font-size: var(--lc-text-sm);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    flex: none;
    color: var(--lc-muted);
    font-variant-numeric: tabular-nums;
  }

  .track {
    position: relative;
    height: 6px;
    overflow: hidden;
    border-radius: var(--lc-radius-full);
    background: var(--lc-surface-2);
    box-shadow: inset 0 0 0 1px var(--lc-border);
  }

  .sm .track {
    height: 3px;
  }

  .fill {
    height: 100%;
    border-radius: inherit;
    background: var(--lc-bar);
    transition: width var(--lc-dur-slow) var(--lc-ease);
  }

  .indeterminate {
    position: absolute;
    width: 35%;
    animation: lc-indeterminate 1.3s var(--lc-ease) infinite;
  }

  @keyframes lc-indeterminate {
    from {
      left: -35%;
    }
    to {
      left: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .indeterminate {
      animation-duration: 3s;
    }
  }
</style>
