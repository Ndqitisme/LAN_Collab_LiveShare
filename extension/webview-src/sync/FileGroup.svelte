<script lang="ts">
  import { Icon, VirtualList, type IconName } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';

  interface Props {
    icon: IconName;
    title: string;
    files: string[];
    warn?: boolean;
  }

  let { icon, title, files, warn = false }: Props = $props();

  const ROW_HEIGHT = 22;
  let open = $state(false);
  const height = $derived(`${Math.min(files.length, 10) * ROW_HEIGHT}px`);
</script>

<details class="group" class:warn bind:open>
  <summary>
    <Icon name="chevron-right" size={14} class="chevron" />
    <Icon name={icon} size={14} />
    <span>{title}</span>
  </summary>
  {#if open}
    <!-- Only an opened group renders its list: a project of 5000 files would otherwise build every row up front. -->
    <VirtualList items={files} rowHeight={ROW_HEIGHT} {height} label={t('sync.list.label')}>
      {#snippet row(file: string)}
        <span class="path" title={file}>{file}</span>
      {/snippet}
    </VirtualList>
  {/if}
</details>

<style>
  .group {
    border-bottom: var(--lc-border-width) solid var(--lc-border);
  }

  summary {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-height: 32px;
    padding: 0 var(--lc-space-3);
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    background: var(--lc-hover);
  }

  summary :global(.chevron) {
    color: var(--lc-muted);
    transition: transform var(--lc-dur) var(--lc-ease);
  }

  .group[open] summary :global(.chevron) {
    transform: rotate(90deg);
  }

  .warn summary {
    color: var(--lc-warn);
  }

  .path {
    overflow: hidden;
    padding: 0 var(--lc-space-3) 0 48px;
    color: var(--lc-muted);
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
