<script lang="ts">
  import { untrack } from 'svelte';
  import { Badge, Button, Card, EmptyState, Icon } from '@lan-collab/ui-kit';
  import { t } from '../../i18n';
  import { api, isAppError, type ExcludePreview, type ProjectSettings, type ProjectView } from '../../lib/api';
  import LineEditor from '../../lib/LineEditor.svelte';
  import { badLines, entries } from '../../lib/rules';
  import { errorText, toast } from '../../lib/state.svelte';

  interface Props {
    project: ProjectView;
  }

  let { project }: Props = $props();

  const name = $derived(project.name);
  let settings = $state<ProjectSettings | null>(null);
  let loadError = $state<string | null>(null);
  let text = $state('');
  let saved = $state<string[]>([]);
  let saving = $state(false);
  let serverError = $state<string | null>(null);
  let preview = $state<ExcludePreview | null>(null);
  let previewError = $state<string | null>(null);
  let previewing = $state(false);

  const patterns = $derived(entries(text));
  const bad = $derived(badLines(text, (l) => !/[\u0000-\u001f\u007f]/.test(l)));
  const dirty = $derived(patterns.join('\n') !== saved.join('\n'));
  const error = $derived(bad.length ? t('errors.excludeInvalid', { line: bad[0] }) : (serverError ?? undefined));

  async function load(n = name) {
    loadError = null;
    try {
      const s = await api.projectSettings(n);
      settings = s;
      saved = s.exclude;
      text = s.exclude.join('\n');
    } catch (e) {
      loadError = errorText(e);
    }
  }

  $effect(() => {
    const n = name;
    untrack(() => load(n));
  });

  // The preview follows the editor, 300 ms after the last keystroke; a newer request wins.
  let ticket = 0;
  $effect(() => {
    const list = patterns;
    const n = name;
    if (!settings) return;
    const mine = ++ticket;
    if (list.length === 0) {
      preview = null;
      previewing = false;
      return;
    }
    previewing = true;
    const timer = setTimeout(async () => {
      try {
        const p = await api.previewExclude(n, list);
        if (mine === ticket) {
          preview = p;
          previewError = null;
        }
      } catch (e) {
        if (mine === ticket) previewError = errorText(e);
      } finally {
        if (mine === ticket) previewing = false;
      }
    }, 300);
    return () => clearTimeout(timer);
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!dirty || bad.length) return;
    saving = true;
    serverError = null;
    try {
      await api.setExclude(name, text.split('\n'));
      saved = patterns;
      text = patterns.join('\n');
      toast('ok', t('sync.saved'));
    } catch (err) {
      if (isAppError(err) && err.field === 'exclude') serverError = errorText(err);
      else toast('danger', errorText(err));
    } finally {
      saving = false;
    }
  }
</script>

{#if loadError}
  <EmptyState icon="circle-alert" title={loadError}>
    {#snippet actions()}
      <Button icon="refresh-cw" onclick={() => load()}>{t('common.retry')}</Button>
    {/snippet}
  </EmptyState>
{:else if !settings}
  <EmptyState icon="loader-circle" title={t('common.loading')} compact />
{:else}
  <form onsubmit={save} novalidate>
    <Card title={t('sync.title')} description={t('sync.text')}>
      <div class="layout">
        <div class="editor">
          <LineEditor
            bind:value={text}
            label={t('sync.label')}
            placeholder={t('sync.placeholder')}
            {bad}
            {error}
            rows={10}
            name="exclude"
          />
          <div class="defaults">
            <span class="caption">{t('sync.defaults')}</span>
            <div class="chips">
              {#each settings.defaultExclude as d (d)}
                <Badge>{d}</Badge>
              {/each}
            </div>
          </div>
        </div>
        <section class="preview" aria-labelledby="exclude-preview-title" aria-busy={previewing}>
          <header>
            <h3 id="exclude-preview-title">{t('sync.previewTitle')}</h3>
            {#if previewing}<span class="muted"><Icon name="loader-circle" size={14} spin /></span>{/if}
          </header>
          {#if patterns.length === 0}
            <p class="muted">{t('sync.previewEmpty')}</p>
          {:else if previewError}
            <p class="problem">{previewError}</p>
          {:else if !preview}
            <p class="muted">{t('sync.previewing')}</p>
          {:else if preview.total === 0}
            <p class="muted">{t('sync.previewNone')}</p>
          {:else}
            <p class="count">{t('sync.previewCount', { total: preview.total, scanned: preview.scanned })}</p>
            <ul class="files" data-testid="exclude-preview">
              {#each preview.files as f (f)}
                <li class="selectable" title={f}><Icon name="file" size={12} />{f}</li>
              {/each}
            </ul>
            {#if preview.total > preview.files.length}
              <p class="muted">{t('sync.previewMore', { n: preview.total - preview.files.length })}</p>
            {/if}
          {/if}
        </section>
      </div>
      {#snippet footer()}
        <Button disabled={!dirty || saving} onclick={() => ((text = saved.join('\n')), (serverError = null))}>
          {t('common.discard')}
        </Button>
        <Button variant="primary" type="submit" icon="check" loading={saving} disabled={!dirty || bad.length > 0}>
          {t('sync.save')}
        </Button>
      {/snippet}
    </Card>
  </form>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--lc-space-5);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-3);
  }

  .defaults {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
  }

  .caption {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-1);
  }

  .preview {
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    min-width: 0;
    padding: var(--lc-space-3);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-md);
    background: var(--lc-surface-2);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
  }

  h3 {
    margin: 0;
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-strong);
  }

  .count {
    font-weight: var(--lc-weight-medium);
  }

  .files {
    max-height: 236px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
  }

  .files li {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
    padding: 2px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--lc-fg);
  }

  .files li :global(svg) {
    flex: none;
    color: var(--lc-muted);
  }

  .muted {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .problem {
    font-size: var(--lc-text-sm);
    color: var(--lc-danger);
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
