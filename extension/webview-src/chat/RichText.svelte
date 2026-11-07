<script lang="ts">
  import { post } from '../shared/host';
  import { t } from '../shared/catalog.svelte';
  import { richText } from './format';

  let { text }: { text: string } = $props();

  const segments = $derived(richText(text));

  function open(e: MouseEvent, message: { type: string; [key: string]: unknown }) {
    e.preventDefault();
    post(message);
  }
</script>

{#each segments as s, i (i)}
  {#if s.kind === 'text'}{s.text}{:else if s.kind === 'code'}<code>{s.text}</code>{:else if s.kind === 'pre'}<pre>{s.text}</pre>{:else if s.kind === 'mention'}<span class="tag">{s.text}</span>{:else if s.kind === 'url'}<!-- svelte-ignore a11y_invalid_attribute --><a
      href="#"
      title={t('chat.link.url', { url: s.url })}
      onclick={(e) => open(e, { type: 'openUrl', url: s.url })}>{s.text}</a
    >{:else if s.kind === 'ref'}<!-- svelte-ignore a11y_invalid_attribute --><a
      href="#"
      class="ref"
      title={t('chat.link.ref', { ref: s.text })}
      onclick={(e) => open(e, { type: 'open', rel: s.rel, line: s.line })}>{s.text}</a
    >{/if}
{/each}
