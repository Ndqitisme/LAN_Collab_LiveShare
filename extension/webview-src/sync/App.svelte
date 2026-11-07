<script lang="ts">
  import { Badge, Button, Icon } from '@lan-collab/ui-kit';
  import { setCatalog, t } from '../shared/catalog.svelte';
  import { onHostMessage, post } from '../shared/host';
  import ChoiceRow from './ChoiceRow.svelte';
  import FileGroup from './FileGroup.svelte';
  import {
    answer,
    canSync,
    choose,
    chooseAll,
    initialChoices,
    outcome,
    REMOVE_CONFIRM_OVER,
    rowsOf,
    unresolved,
    type Choice,
    type Choices,
    type Plan,
    type PreviewMode,
    type Row,
  } from './model';

  type HostMessage = { type: 'init'; catalog: Record<string, string>; plan: Plan };

  let plan = $state.raw<Plan | null>(null);
  let choices = $state.raw<Choices>({});
  let sending = $state(false);

  const rows = $derived(plan ? rowsOf(plan) : []);
  const conflictRows = $derived(rows.filter((r) => r.group === 'conflict'));
  const replaceRows = $derived(rows.filter((r) => r.group === 'replace'));
  const left = $derived(unresolved(choices, rows));
  const result = $derived(plan ? outcome(plan, choices) : null);
  const mergeable = $derived(conflictRows.some((r) => r.options.includes('merge')));
  const otherCount = $derived(plan ? plan.get.length + plan.overwrite.length + plan.upload.length + plan.removeLocal.length : 0);

  onHostMessage<HostMessage>((m) => {
    if (m.type !== 'init') return;
    setCatalog(m.catalog);
    plan = m.plan;
    choices = initialChoices(m.plan);
    sending = false;
    // The host times welcome to the first painted frame of the plan (B8 perf rule).
    requestAnimationFrame(() => requestAnimationFrame(() => post({ type: 'painted' })));
  });

  function pick(row: Row, c: Choice) {
    choices = choose(choices, row, c);
  }

  function pickAll(list: Row[], c: Choice) {
    choices = chooseAll(choices, list, c);
  }

  function preview(row: Row, mode: PreviewMode) {
    post({ type: 'preview', path: row.path, mode });
  }

  function sync() {
    if (!canSync(choices, rows)) return;
    sending = true;
    post({ type: 'sync', choices: answer(choices, rows) });
  }

  post({ type: 'ready' });
</script>

{#if plan && result}
  <main class="sync">
    <header class="head">
      <h1>{plan.firstTime ? t('sync.panel.title.first', { folder: plan.folder, project: plan.project }) : t('sync.panel.title', { project: plan.project })}</h1>
      {#if conflictRows.length}<p>{t('sync.panel.lead.conflicts', { count: conflictRows.length })}</p>{/if}
      {#if plan.firstTime}
        <p>{t('sync.panel.lead.join', { path: plan.path })}</p>
        {#if replaceRows.length}<p>{t('sync.panel.lead.joinChoose')}</p>{/if}
      {/if}
      {#if !conflictRows.length && !plan.firstTime && plan.removeLocal.length > REMOVE_CONFIRM_OVER}
        <p>{t('sync.panel.lead.remove', { count: plan.removeLocal.length })}</p>
      {/if}
      <p class="muted"><Icon name="info" size={14} />{t('sync.panel.nothingWritten')}</p>
    </header>

    {#if conflictRows.length}
      <section aria-labelledby="conflicts-head">
        <div class="section-head">
          <h2 id="conflicts-head">{t('sync.section.conflicts')}</h2>
          <Badge tone="warn">{conflictRows.length}</Badge>
          <div class="bulk" role="group" aria-label={t('sync.bulk.label')}>
            <span class="bulk-label">{t('sync.bulk.label')}</span>
            <Button size="sm" onclick={() => pickAll(conflictRows, 'hub')}>{t('sync.bulk.hub')}</Button>
            <Button size="sm" onclick={() => pickAll(conflictRows, 'local')}>{t('sync.bulk.local')}</Button>
            {#if mergeable}
              <Button size="sm" title={t('sync.bulk.merge.title')} onclick={() => pickAll(conflictRows, 'merge')}>{t('sync.bulk.merge')}</Button>
            {/if}
          </div>
        </div>
        <ul class="rows">
          {#each conflictRows as row, i (row.path)}
            <ChoiceRow {row} index={i} choice={choices[row.path] ?? null} onchoose={(c) => pick(row, c)} onpreview={(mode) => preview(row, mode)} />
          {/each}
        </ul>
      </section>
    {/if}

    {#if replaceRows.length}
      <section aria-labelledby="replace-head">
        <div class="section-head">
          <h2 id="replace-head">{t('sync.section.replace')}</h2>
          <Badge>{replaceRows.length}</Badge>
          <div class="bulk" role="group" aria-label={t('sync.bulk.label')}>
            <span class="bulk-label">{t('sync.bulk.label')}</span>
            <Button size="sm" onclick={() => pickAll(replaceRows, 'hub')}>{t('sync.bulk.hub')}</Button>
            <Button size="sm" onclick={() => pickAll(replaceRows, 'local')}>{t('sync.bulk.local')}</Button>
          </div>
        </div>
        <ul class="rows">
          {#each replaceRows as row, i (row.path)}
            <ChoiceRow {row} index={conflictRows.length + i} choice={choices[row.path] ?? null} onchoose={(c) => pick(row, c)} onpreview={(mode) => preview(row, mode)} />
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="other-head">
      <div class="section-head">
        <h2 id="other-head">{t('sync.section.other')}</h2>
      </div>
      {#if otherCount}
        {#if plan.get.length}<FileGroup icon="download" title={t('sync.group.get', { count: plan.get.length })} files={plan.get} />{/if}
        {#if plan.overwrite.length}<FileGroup icon="refresh-cw" title={t('sync.group.overwrite', { count: plan.overwrite.length })} files={plan.overwrite} />{/if}
        {#if plan.upload.length}<FileGroup icon="upload" title={t('sync.group.upload', { count: plan.upload.length })} files={plan.upload} />{/if}
        {#if plan.removeLocal.length}
          <FileGroup icon="trash-2" warn={plan.removeLocal.length > REMOVE_CONFIRM_OVER} title={t('sync.group.removeLocal', { count: plan.removeLocal.length })} files={plan.removeLocal} />
        {/if}
      {:else}
        <p class="empty">{t('sync.section.otherEmpty')}</p>
      {/if}
    </section>

    <footer class="bar">
      <div class="notes" aria-live="polite">
        {#if left}
          <p class="todo"><Icon name="triangle-alert" size={14} />{t('sync.footer.unresolved', { count: left })}</p>
        {:else}
          <p>{t('sync.footer.outcome', { fromHub: result.fromHub, toHub: result.toHub, merged: result.merged, removed: result.removed })}</p>
        {/if}
        <p class="muted">{t('sync.footer.backup')}</p>
      </div>
      <div class="buttons">
        <Button onclick={() => post({ type: 'cancel' })}>{t('sync.button.cancel')}</Button>
        <Button variant="primary" disabled={left > 0} loading={sending} onclick={sync}>{t('sync.button.sync')}</Button>
      </div>
    </footer>
  </main>
{/if}

<style>
  :global(html),
  :global(body),
  :global(#app) {
    height: 100%;
  }

  :global(body) {
    overflow: hidden;
  }

  .sync {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 1100px;
    margin: 0 auto;
    overflow-y: auto;
  }

  .head {
    flex: none;
    padding: var(--lc-space-5) var(--lc-space-4) var(--lc-space-3);
  }

  h1 {
    margin: 0 0 var(--lc-space-2);
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-strong);
  }

  .head p {
    margin: 0 0 var(--lc-space-1);
    max-width: 75ch;
  }

  .muted {
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  /* Sections keep their full height: the page scrolls, a long list never gets clipped. */
  section {
    flex: none;
    margin: 0 var(--lc-space-4) var(--lc-space-4);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
    overflow: hidden;
  }

  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--lc-space-2);
    min-height: 40px;
    padding: var(--lc-space-1) var(--lc-space-3);
    border-bottom: var(--lc-border-width) solid var(--lc-border);
  }

  h2 {
    margin: 0;
    font-size: var(--lc-text-md);
    font-weight: var(--lc-weight-strong);
  }

  .bulk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--lc-space-1);
    margin-left: auto;
  }

  .bulk-label {
    margin-right: var(--lc-space-1);
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rows :global(.row:last-child),
  section :global(.group:last-child) {
    border-bottom: none;
  }

  .empty {
    margin: 0;
    padding: var(--lc-space-2) var(--lc-space-3);
    color: var(--lc-muted);
  }

  .bar {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--lc-space-3);
    margin-top: auto;
    padding: var(--lc-space-3) var(--lc-space-4);
    border-top: var(--lc-border-width) solid var(--lc-border);
    background: var(--lc-bg);
  }

  .notes {
    flex: 1 1 260px;
    min-width: 0;
  }

  .notes p {
    margin: 0;
  }

  .todo {
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
    color: var(--lc-warn);
  }

  .buttons {
    display: flex;
    gap: var(--lc-space-2);
  }
</style>
