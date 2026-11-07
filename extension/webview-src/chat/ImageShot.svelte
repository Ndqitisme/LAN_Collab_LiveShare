<script lang="ts">
  import { Icon } from '@lan-collab/ui-kit';
  import { post } from '../shared/host';
  import { t } from '../shared/catalog.svelte';
  import { formatSize } from './format';
  import { mediaSource, requestMedia } from './media.svelte';
  import type { ChatImage } from './model';

  let { image }: { image: ChatImage } = $props();

  let loaded = $state(false);
  const src = $derived(mediaSource(image.id));

  $effect(() => requestMedia(image.id));
</script>

{#if src === null}
  <div class="shot missing">
    <Icon name="image" size={14} />
    <span>{t('chat.image.gone')}</span>
  </div>
{:else}
  <button
    type="button"
    class="shot"
    class:loading={!loaded}
    title={t('chat.image.open', { size: formatSize(image.size) })}
    style:aspect-ratio={image.w && image.h ? `${image.w} / ${image.h}` : undefined}
    style:width={image.w ? `${Math.min(image.w, 260)}px` : undefined}
    onclick={() => post({ type: 'openImage', id: image.id })}
  >
    {#if src}<img {src} alt={t('chat.image.alt')} onload={() => (loaded = true)} />{/if}
  </button>
{/if}

<style>
  .shot {
    display: block;
    max-width: 100%;
    max-height: 260px;
    min-width: 60px;
    min-height: 40px;
    padding: 0;
    overflow: hidden;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
    cursor: zoom-in;
    transition: border-color var(--lc-dur) var(--lc-ease);
  }

  .shot:hover {
    border-color: var(--lc-border-strong);
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    max-height: 260px;
    object-fit: contain;
  }

  .loading {
    background: linear-gradient(90deg, var(--lc-surface), var(--lc-hover), var(--lc-surface));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }

  .loading img {
    visibility: hidden;
  }

  .missing {
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-height: 0;
    padding: var(--lc-space-2) var(--lc-space-3);
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
    cursor: default;
  }

  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading {
      animation: none;
    }
  }
</style>
