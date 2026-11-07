<script lang="ts">
  import StatusDot from './StatusDot.svelte';

  interface Props {
    name: string;
    /** The member color assigned by LAN Hub. Defaults to the accent token. */
    color?: string;
    size?: 'sm' | 'md' | 'lg';
    src?: string;
    status?: 'live' | 'connecting' | 'offline' | 'error' | 'idle';
    title?: string;
  }

  let { name, color, size = 'md', src, status, title }: Props = $props();

  const initials = $derived.by(() => {
    const words = name.split('@')[0].trim().split(/[\s._-]+/).filter(Boolean);
    if (!words.length) return '?';
    const first = Array.from(words[0])[0] ?? '';
    const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
    return (first + last).toLocaleUpperCase('vi');
  });
</script>

<span class="lc-avatar {size}" style:--lc-avatar={color} title={title ?? name}>
  {#if src}
    <img {src} alt={name} />
  {:else}
    <span class="initials" aria-label={name} role="img">{initials}</span>
  {/if}
  {#if status}<span class="status"><StatusDot {status} size={size === 'lg' ? 10 : 8} /></span>{/if}
</span>

<style>
  .lc-avatar {
    --lc-avatar-base: var(--lc-avatar, var(--lc-accent));
    position: relative;
    display: inline-flex;
    flex: none;
    width: 28px;
    height: 28px;
    font-size: var(--lc-text-xs);
  }

  .sm {
    width: 20px;
    height: 20px;
    font-size: 9px;
  }

  .lg {
    width: 40px;
    height: 40px;
    font-size: var(--lc-text-md);
  }

  .initials,
  img {
    width: 100%;
    height: 100%;
    border-radius: var(--lc-radius-full);
  }

  .initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--lc-avatar-base) 24%, var(--lc-surface));
    color: color-mix(in srgb, var(--lc-avatar-base) 45%, var(--lc-fg));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lc-avatar-base) 40%, transparent);
    font-weight: var(--lc-weight-strong);
    letter-spacing: 0.02em;
    user-select: none;
  }

  img {
    object-fit: cover;
  }

  .status {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: inline-flex;
    padding: 2px;
    border-radius: var(--lc-radius-full);
    background: var(--lc-bg);
  }
</style>
