<script lang="ts">
  import { Badge, Button, Card, Checkbox, EmptyState, Icon, Input } from '@lan-collab/ui-kit';
  import { t } from '../i18n';
  import { api, isAppError, type LegacyProject } from '../lib/api';
  import { errorText, isRemote, toast } from '../lib/state.svelte';

  interface Props {
    /** After an import; the project list then shows what was added. */
    ondone: () => void;
    oncancel: () => void;
  }

  let { ondone, oncancel }: Props = $props();

  // A remote hub reads the 0.1 folder and the project folders on its own machine: typed, not picked here.
  const remote = isRemote();

  interface Row {
    project: LegacyProject;
    include: boolean;
    root: string;
    fromBat: boolean;
    error?: string;
  }

  let folder = $state('');
  let scanning = $state(false);
  let scanError = $state<string | null>(null);
  let rows = $state<Row[] | null>(null);
  let importing = $state(false);

  const chosen = $derived((rows ?? []).filter((r) => r.include && !r.project.exists));
  const ready = $derived(chosen.length > 0 && chosen.every((r) => r.root.trim()));

  async function pickFolder() {
    const dir = await api.pickFolder(t('import.pickTitle'), folder.trim() || null).catch(() => null);
    if (!dir) return;
    folder = dir;
    await scan(true);
  }

  // The folder field scans on Enter and on change. Leaving it for the import button fires change, which must
  // not scan the same folder again and replace the list under the click.
  let scannedDir = '';

  async function scan(force = false) {
    const dir = folder.trim();
    if (!dir || (!force && dir === scannedDir)) return;
    scannedDir = dir;
    scanning = true;
    scanError = null;
    try {
      const found = await api.scanLegacy(dir);
      rows = found.map((p) => ({ project: p, include: !p.exists, root: p.root ?? '', fromBat: !!p.root }));
    } catch (e) {
      rows = null;
      scanError = errorText(e);
    } finally {
      scanning = false;
    }
  }

  async function pickRoot(row: Row) {
    const dir = await api.pickFolder(t('import.pickRootTitle', { name: row.project.name }), row.root.trim() || null).catch(() => null);
    if (!dir) return;
    row.root = dir;
    row.fromBat = false;
    row.error = undefined;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!rows || !ready) return;
    for (const r of rows) r.error = undefined;
    importing = true;
    try {
      const added = await api.importLegacy(
        chosen.map((r) => ({ name: r.project.name, root: r.root.trim(), token: r.project.token, allow: r.project.allow })),
      );
      if (added.length) toast('ok', t('import.done', { n: added.length }));
      else toast('info', t('import.nothing'));
      ondone();
    } catch (err) {
      const row = isAppError(err) ? rows.find((r) => r.project.name === err.params.project) : undefined;
      if (row) row.error = errorText(err);
      else toast('danger', errorText(err));
    } finally {
      importing = false;
    }
  }
</script>

<form class="import" onsubmit={submit} novalidate>
  <Card>
    <div class="folder">
      <Input
        label={t('import.folder')}
        bind:value={folder}
        placeholder={t('import.folderPlaceholder')}
        hint={remote ? t('import.folderRemoteHint') : undefined}
        icon="folder"
        mono
        spellcheck={false}
        name="legacy-folder"
        class="grow"
        onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), scan(true))}
        onchange={() => scan()}
      />
      {#if !remote}
        <Button icon="folder-open" onclick={pickFolder} class="pick">{t('import.pick')}</Button>
      {/if}
    </div>
  </Card>

  {#if scanning}
    <EmptyState icon="loader-circle" title={t('import.scanning')} compact />
  {:else if scanError}
    <EmptyState icon="circle-alert" title={scanError}>
      {#snippet actions()}
        <Button icon="refresh-cw" onclick={() => scan(true)}>{t('common.retry')}</Button>
      {/snippet}
    </EmptyState>
  {:else if rows && rows.length === 0}
    <EmptyState icon="folder" title={t('import.noneTitle')} description={t('import.noneText')} />
  {:else if rows}
    <Card title={t('import.found', { n: rows.length })} padding="none">
      <ul class="rows" data-testid="legacy-rows">
        {#each rows as row (row.project.name)}
          <li class:dim={row.project.exists}>
            <div class="top">
              <Checkbox
                bind:checked={row.include}
                disabled={row.project.exists}
                label={t('import.include', { name: row.project.name })}
              />
              {#if row.project.exists}<Badge tone="neutral" icon="check">{t('import.exists')}</Badge>{/if}
            </div>
            <div class="facts">
              <span><Icon name="key-round" size={13} /><code>{row.project.token.slice(0, 6)}…</code></span>
              <span>
                <Icon name="shield-check" size={13} />
                {row.project.allow.length
                  ? t('import.allowCount', { n: row.project.allow.length })
                  : t('import.allowNone')}
              </span>
            </div>
            {#if row.include && !row.project.exists}
              <div class="folder">
                <Input
                  label={t('import.root', { name: row.project.name })}
                  bind:value={row.root}
                  placeholder={t('import.rootPlaceholder')}
                  hint={row.fromBat ? t('import.rootFromBat') : remote ? t('form.folderRemoteHint') : undefined}
                  error={row.error}
                  oninput={() => ((row.fromBat = false), (row.error = undefined))}
                  icon="folder"
                  mono
                  spellcheck={false}
                  class="grow"
                />
                {#if !remote}
                  <Button icon="folder-open" onclick={() => pickRoot(row)} class="pick">{t('import.pickRoot')}</Button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      {#snippet footer()}
        <Button onclick={oncancel}>{t('form.cancel')}</Button>
        <Button variant="primary" type="submit" icon="download" loading={importing} disabled={!ready}>
          {t('import.submit', { n: chosen.length })}
        </Button>
      {/snippet}
    </Card>
  {/if}
</form>

<style>
  .import {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-4);
    max-width: 760px;
  }

  .folder {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
  }

  .folder :global(.grow) {
    flex: 1;
    min-width: 0;
  }

  .folder :global(.pick) {
    flex: none;
    margin-top: calc(var(--lc-text-sm) * var(--lc-leading) + var(--lc-space-1));
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rows li {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    padding: var(--lc-space-4);
  }

  .rows li + li {
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .rows li.dim {
    opacity: 0.7;
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-4);
    padding-left: var(--lc-space-6);
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .facts span {
    display: inline-flex;
    align-items: center;
    gap: var(--lc-space-1);
  }

  code {
    font-family: var(--lc-font-mono);
  }

  .rows .folder {
    padding-left: var(--lc-space-6);
  }
</style>
