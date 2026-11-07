<script lang="ts">
  import { Button, Icon } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';
  import { previewMode, splitPath, type Choice, type PreviewMode, type Row } from './model';

  interface Props {
    row: Row;
    index: number;
    choice: Choice | null;
    onchoose: (choice: Choice) => void;
    onpreview: (mode: PreviewMode) => void;
  }

  let { row, index, choice, onchoose, onpreview }: Props = $props();

  const parts = $derived(splitPath(row.path));
  const mode = $derived(previewMode(row, choice));
  // A conflict always shows the merge choice, disabled with the reason when it cannot apply.
  const shown = $derived<Choice[]>(row.group === 'conflict' ? ['hub', 'local', 'merge'] : ['hub', 'local']);

  function label(c: Choice): string {
    if (c === 'hub') return t('sync.choice.hub');
    if (c === 'local') return t('sync.choice.local');
    return t('sync.choice.merge');
  }

  function title(c: Choice): string {
    if (c === 'hub') return t('sync.choice.hub.title');
    if (c === 'local') return t('sync.choice.local.title');
    if (row.options.includes('merge')) return t('sync.choice.merge.title');
    return row.text ? t('sync.choice.merge.noBase') : t('sync.choice.merge.binary');
  }
</script>

<li class="row" class:unset={!choice}>
  <div class="file" title={row.path}>
    <Icon name={row.text ? 'file-text' : 'image'} size={14} />
    <span class="base">{parts.base}</span>
    {#if parts.dir}<span class="dir">{parts.dir}</span>{/if}
  </div>
  <div class="choices" role="radiogroup" aria-label={t('sync.row.group', { path: row.path })}>
    {#each shown as c (c)}
      {@const allowed = row.options.includes(c)}
      <label class="seg" class:on={choice === c} class:off={!allowed} title={title(c)}>
        <input type="radio" name="choice-{index}" value={c} checked={choice === c} disabled={!allowed} onchange={() => onchoose(c)} />
        <span>{label(c)}</span>
      </label>
    {/each}
  </div>
  <div class="preview">
    {#if mode}
      <Button
        size="sm"
        variant="ghost"
        icon="eye"
        title={mode === 'merge' ? t('sync.row.previewMerge.title') : t('sync.row.preview.title')}
        onclick={() => onpreview(mode)}
      >
        {mode === 'merge' ? t('sync.row.previewMerge') : t('sync.row.preview')}
      </Button>
    {:else}
      <span class="nopreview">{t('sync.row.preview.binary')}</span>
    {/if}
  </div>
</li>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) auto 128px;
    grid-template-areas: "file choices preview";
    align-items: center;
    gap: var(--lc-space-3);
    min-height: 40px;
    padding: var(--lc-space-1) var(--lc-space-3);
    border-bottom: var(--lc-border-width) solid var(--lc-border);
  }

  .row.unset {
    box-shadow: inset 2px 0 0 var(--lc-warn);
  }

  .file {
    grid-area: file;
    display: flex;
    align-items: baseline;
    gap: var(--lc-space-2);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .file :global(svg) {
    flex: none;
    align-self: center;
    color: var(--lc-muted);
  }

  .base {
    font-weight: var(--lc-weight-medium);
  }

  .dir {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .choices {
    grid-area: choices;
    display: inline-flex;
    border: var(--lc-border-width) solid var(--lc-control-border, var(--lc-border));
    border-radius: var(--lc-radius-md);
    overflow: hidden;
  }

  .seg {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: var(--lc-control-h-sm);
    padding: 0 var(--lc-space-3);
    background: var(--lc-secondary);
    color: var(--lc-secondary-fg);
    font-size: var(--lc-text-sm);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }

  .seg + .seg {
    border-left: var(--lc-border-width) solid var(--lc-control-border, var(--lc-border));
  }

  .seg:hover:not(.off):not(.on) {
    background: var(--lc-secondary-hover);
  }

  .seg.on {
    background: var(--lc-accent);
    color: var(--lc-accent-fg);
    font-weight: var(--lc-weight-medium);
  }

  .seg.off {
    cursor: default;
    opacity: 0.5;
  }

  /* The native radio keeps keyboard and screen reader behavior; the label draws it. */
  .seg input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .seg:has(input:focus-visible) {
    outline: var(--lc-focus-width) solid var(--lc-focus);
    outline-offset: -2px;
  }

  :global(body.vscode-high-contrast) .seg.on,
  :global(body.vscode-high-contrast-light) .seg.on {
    outline: 1px dashed var(--lc-focus);
    outline-offset: -3px;
  }

  .preview {
    grid-area: preview;
    display: flex;
    justify-content: flex-end;
  }

  .nopreview {
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    text-align: right;
  }

  @media (max-width: 620px) {
    .row {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        "file preview"
        "choices choices";
    }

    .choices {
      justify-self: start;
    }
  }
</style>
