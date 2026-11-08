<script lang="ts">
  import { untrack } from 'svelte';
  import { Button, Card, EmptyState, Input, ProgressBar } from '@lan-collab/ui-kit';
  import { num, t } from '../../i18n';
  import { api, isAppError, type HistoryUsage, type ProjectSettings, type ProjectView } from '../../lib/api';
  import { bytes } from '../../lib/format';
  import { errorText, toast } from '../../lib/state.svelte';

  interface Props {
    project: ProjectView;
  }

  let { project }: Props = $props();

  type Field = 'idleMinutes' | 'keepDays' | 'maxMb';
  const RANGES: Record<Field, [number, number]> = {
    idleMinutes: [1, 1440],
    keepDays: [1, 3650],
    maxMb: [1, 1048576],
  };

  const name = $derived(project.name);
  const running = $derived(project.state === 'running');
  let settings = $state<ProjectSettings | null>(null);
  let loadError = $state<string | null>(null);
  let form = $state<Record<Field, string>>({ idleMinutes: '', keepDays: '', maxMb: '' });
  let saving = $state(false);
  let serverError = $state<{ field: Field; text: string } | null>(null);
  let usage = $state<HistoryUsage | null | undefined>(undefined);
  let usageError = $state<string | null>(null);
  let retaining = $state(false);

  function fieldError(f: Field): string | undefined {
    const raw = form[f].trim();
    const [min, max] = RANGES[f];
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < min || n > max) return t('errors.outOfRange', { min, max });
    return serverError?.field === f ? serverError.text : undefined;
  }

  const errors = $derived({
    idleMinutes: fieldError('idleMinutes'),
    keepDays: fieldError('keepDays'),
    maxMb: fieldError('maxMb'),
  });
  const valid = $derived(!errors.idleMinutes && !errors.keepDays && !errors.maxMb);
  const dirty = $derived(
    !!settings &&
      (Number(form.idleMinutes) !== settings.history.idleMinutes ||
        Number(form.keepDays) !== settings.history.keepDays ||
        Number(form.maxMb) !== settings.history.maxMb),
  );
  const total = $derived(usage ? usage.dbBytes + usage.blobBytes : 0);
  const maxBytes = $derived((settings?.history.maxMb ?? 0) * 1024 * 1024);

  function fill(s: ProjectSettings) {
    form = {
      idleMinutes: String(s.history.idleMinutes),
      keepDays: String(s.history.keepDays),
      maxMb: String(s.history.maxMb),
    };
  }

  async function load(n = name) {
    loadError = null;
    try {
      const s = await api.projectSettings(n);
      settings = s;
      fill(s);
    } catch (e) {
      loadError = errorText(e);
    }
  }

  async function measure(n = name) {
    usageError = null;
    try {
      usage = await api.historyUsage(n);
    } catch (e) {
      usageError = errorText(e);
    }
  }

  $effect(() => {
    const n = name;
    untrack(() => load(n));
  });

  $effect(() => {
    const n = name;
    if (running) untrack(() => measure(n));
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || !dirty) return;
    saving = true;
    serverError = null;
    const history = { idleMinutes: Number(form.idleMinutes), keepDays: Number(form.keepDays), maxMb: Number(form.maxMb) };
    try {
      await api.setHistory(name, history);
      if (settings) settings.history = history;
      toast('ok', t('history.saved'));
      if (running) measure();
    } catch (err) {
      if (isAppError(err) && err.field && err.field in RANGES) serverError = { field: err.field as Field, text: errorText(err) };
      else toast('danger', errorText(err));
    } finally {
      saving = false;
    }
  }

  async function retain() {
    retaining = true;
    try {
      const r = await api.runRetention(name);
      toast(
        'ok',
        r.runsDeleted || r.blobsDeleted
          ? t('history.retained', { runs: r.runsDeleted, blobs: r.blobsDeleted })
          : t('history.retainedNone'),
      );
      await measure();
    } catch (err) {
      toast('danger', errorText(err));
    } finally {
      retaining = false;
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
  <Card title={t('history.usageTitle')} description={t('history.usageText')}>
    {#snippet actions()}
      {#if running && usage}
        <Button size="sm" variant="ghost" icon="refresh-cw" onclick={() => measure()}>{t('common.refresh')}</Button>
      {/if}
    {/snippet}
    {#if !settings.historyEnabled}
      <EmptyState icon="history" title={t('history.offTitle')} description={t('history.offText')} compact />
    {:else if !running}
      <EmptyState
        icon="pause"
        title={t(project.state === 'failed' ? 'detail.failedTitle' : 'detail.notRunningTitle', { name })}
        description={t('history.notRunningText')}
        compact
      />
    {:else if usageError}
      <EmptyState icon="circle-alert" title={usageError} compact>
        {#snippet actions()}
          <Button icon="refresh-cw" onclick={() => measure()}>{t('common.retry')}</Button>
        {/snippet}
      </EmptyState>
    {:else if usage === undefined}
      <EmptyState icon="loader-circle" title={t('history.measuring')} compact />
    {:else if usage === null}
      <EmptyState icon="history" title={t('history.offTitle')} description={t('history.offText')} compact />
    {:else}
      <div class="usage" data-testid="history-usage">
        <div class="stat">
          <span class="label">{t('history.db')}</span>
          <span class="value">{bytes(usage.dbBytes)}</span>
          <span class="sub">history.db</span>
        </div>
        <div class="stat">
          <span class="label">{t('history.blobs')}</span>
          <span class="value">{bytes(usage.blobBytes)}</span>
          <span class="sub">{t('history.blobCount', { n: usage.blobCount })}</span>
        </div>
        <div class="stat">
          <span class="label">{t('history.runs')}</span>
          <span class="value">{num(usage.runs)}</span>
        </div>
      </div>
      <div class="meter">
        <ProgressBar
          value={maxBytes ? total / maxBytes : 0}
          label={t('history.total')}
          detail={t('history.usageOf', { used: bytes(total), max: bytes(maxBytes) })}
          tone={total > maxBytes ? 'danger' : total > maxBytes * 0.8 ? 'warn' : 'accent'}
        />
      </div>
    {/if}
    {#snippet footer()}
      <Button icon="trash-2" loading={retaining} disabled={!running || !usage} onclick={retain}>
        {retaining ? t('history.retaining') : t('history.retain')}
      </Button>
    {/snippet}
  </Card>

  <form onsubmit={save} novalidate>
    <Card title={t('history.limitsTitle')} description={t('history.limitsText')}>
      <div class="fields">
        <Input
          label={t('history.idle')}
          hint={t('history.idleHint')}
          error={errors.idleMinutes}
          bind:value={form.idleMinutes}
          inputmode="numeric"
          name="idleMinutes"
          oninput={() => serverError?.field === 'idleMinutes' && (serverError = null)}
        />
        <Input
          label={t('history.keep')}
          hint={t('history.keepHint')}
          error={errors.keepDays}
          bind:value={form.keepDays}
          inputmode="numeric"
          name="keepDays"
          oninput={() => serverError?.field === 'keepDays' && (serverError = null)}
        />
        <Input
          label={t('history.max')}
          hint={t('history.maxHint')}
          error={errors.maxMb}
          bind:value={form.maxMb}
          inputmode="numeric"
          name="maxMb"
          oninput={() => serverError?.field === 'maxMb' && (serverError = null)}
        />
      </div>
      {#snippet footer()}
        <Button disabled={!dirty || saving} onclick={() => settings && fill(settings)}>{t('common.discard')}</Button>
        <Button variant="primary" type="submit" icon="check" loading={saving} disabled={!dirty || !valid}>
          {t('history.save')}
        </Button>
      {/snippet}
    </Card>
  </form>
{/if}

<style>
  .usage {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--lc-space-3);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-0);
    min-width: 0;
    padding: var(--lc-space-3) var(--lc-space-4);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface-2);
  }

  .label,
  .sub {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .value {
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-medium);
    font-variant-numeric: tabular-nums;
  }

  .meter {
    margin-top: var(--lc-space-4);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--lc-space-4);
  }

  @media (max-width: 860px) {
    .fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
