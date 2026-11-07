<script lang="ts">
  import { Badge, Button, Card, Icon, type IconName } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';
  import { diagSummary, stepRows, type Diagnosis, type RowState, type StepResult } from './state';

  interface Props {
    diag: Diagnosis;
    onrun: () => void;
    oncopy: () => void;
    onlog: () => void;
    onaction: (id: string, result: StepResult | null) => void;
  }

  let { diag, onrun, oncopy, onlog, onaction }: Props = $props();

  const rows = $derived(stepRows(diag, t));
  const summary = $derived(diagSummary(diag, t));
  const failed = $derived(diag.results.some((r) => r.status === 'failed'));

  const ICONS: Record<RowState, IconName> = {
    ok: 'circle-check',
    fixed: 'triangle-alert',
    failed: 'circle-alert',
    skipped: 'minus',
    running: 'loader-circle',
    pending: 'minus',
  };
  const BADGE = { ok: 'ok', warn: 'warn', danger: 'danger', muted: 'neutral', accent: 'accent' } as const;
</script>

<Card title={t('connection.diag.title')} description={t('connection.diag.description')}>
  {#snippet actions()}
    <Button size="sm" variant={diag.results.length ? 'secondary' : 'primary'} icon="stethoscope" loading={diag.running} onclick={onrun}>{t('connection.diag.run')}</Button>
  {/snippet}
  <p class="summary" class:bad={failed && !diag.running} role="status" aria-live="polite">{summary ?? t('connection.diag.notRun')}</p>
  <ol class="steps" aria-label={t('connection.diag.list')}>
    {#each rows as row, i (row.step)}
      <li class="step tone-{row.tone}" data-step={row.step} data-state={row.state}>
        <span class="icon"><Icon name={ICONS[row.state]} size={16} spin={row.state === 'running'} /></span>
        <div class="body">
          <div class="line">
            <span class="title"><span class="n">{i + 1}.</span> {row.title}</span>
            {#if row.state !== 'pending'}<Badge tone={BADGE[row.tone]}>{row.label}</Badge>{/if}
          </div>
          {#if row.remedy}<p class="remedy">{row.remedy}</p>{/if}
          {#if row.actions.length}
            <div class="actions">
              {#each row.actions as a, j (a.id)}
                <Button size="sm" variant={j === 0 ? 'primary' : 'secondary'} data-action={a.id} onclick={() => onaction(a.id, row.result)}>{a.label}</Button>
              {/each}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
  {#snippet footer()}
    <Button size="sm" variant="ghost" icon="copy" disabled={!diag.results.length || diag.running} onclick={oncopy}>{t('connection.diag.copy')}</Button>
    <Button size="sm" variant="ghost" icon="file-text" onclick={onlog}>{t('connection.diag.log')}</Button>
  {/snippet}
</Card>

<style>
  .summary {
    margin: 0 0 var(--lc-space-3);
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .summary.bad {
    color: var(--lc-danger);
  }

  .steps {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: flex;
    gap: var(--lc-space-2);
    padding: var(--lc-space-2) 0;
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .step:first-child {
    border-top: none;
  }

  .icon {
    display: inline-flex;
    flex: none;
    padding-top: 1px;
    color: var(--lc-muted);
  }

  .tone-ok .icon {
    color: var(--lc-ok);
  }

  .tone-warn .icon {
    color: var(--lc-warn);
  }

  .tone-danger .icon {
    color: var(--lc-danger);
  }

  .tone-accent .icon {
    color: var(--lc-accent);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--lc-space-1);
    min-width: 0;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--lc-space-2);
  }

  .title {
    font-weight: var(--lc-weight-medium);
  }

  .tone-muted .title {
    color: var(--lc-muted);
    font-weight: normal;
  }

  .n {
    color: var(--lc-muted);
    font-variant-numeric: tabular-nums;
  }

  .remedy {
    margin: 0;
    font-size: var(--lc-text-sm);
    line-height: var(--lc-leading);
    overflow-wrap: anywhere;
  }

  .tone-ok .remedy,
  .tone-muted .remedy {
    color: var(--lc-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-2);
    padding-top: var(--lc-space-1);
  }
</style>
