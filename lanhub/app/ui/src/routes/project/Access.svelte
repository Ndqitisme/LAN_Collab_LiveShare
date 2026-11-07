<script lang="ts">
  import { untrack } from 'svelte';
  import { Avatar, Button, Card, Dialog, EmptyState, IconButton } from '@lan-collab/ui-kit';
  import { t } from '../../i18n';
  import { api, isAppError, type ClientInfo, type ProjectSettings, type ProjectView } from '../../lib/api';
  import LineEditor from '../../lib/LineEditor.svelte';
  import { allowEntryOk, badLines, entries } from '../../lib/rules';
  import { attempt, errorText, toast } from '../../lib/state.svelte';

  interface Props {
    project: ProjectView;
  }

  let { project }: Props = $props();

  let settings = $state<ProjectSettings | null>(null);
  let loadError = $state<string | null>(null);
  let revealed = $state(false);
  let allowText = $state('');
  let savedAllow = $state<string[]>([]);
  let saving = $state(false);
  let serverError = $state<string | null>(null);
  let confirmRotate = $state(false);
  let rotating = $state(false);
  let affected = $state<ClientInfo[]>([]);

  const bad = $derived(badLines(allowText, allowEntryOk));
  const current = $derived(entries(allowText));
  const dirty = $derived(current.join('\n') !== savedAllow.join('\n'));
  const allowError = $derived(bad.length ? t('errors.allowInvalid', { line: bad[0] }) : (serverError ?? undefined));

  // Status pushes replace `project` twice a second; only a new name reloads.
  const name = $derived(project.name);

  async function load(n = name) {
    loadError = null;
    try {
      const s = await api.projectSettings(n);
      settings = s;
      savedAllow = s.allow;
      allowText = s.allow.join('\n');
    } catch (e) {
      loadError = errorText(e);
    }
  }

  $effect(() => {
    const n = name;
    untrack(() => load(n));
  });

  async function saveAllow(e: SubmitEvent) {
    e.preventDefault();
    if (bad.length || !dirty) return;
    saving = true;
    serverError = null;
    try {
      await api.setAllow(project.name, allowText.split('\n'));
      savedAllow = current;
      allowText = current.join('\n');
      toast('ok', t('access.allowSaved'), t('access.allowLive'));
    } catch (err) {
      if (isAppError(err) && err.field === 'allow') serverError = errorText(err);
      else toast('danger', errorText(err));
    } finally {
      saving = false;
    }
  }

  async function openRotate() {
    affected = project.state === 'running' ? await api.clients(project.name).catch(() => []) : [];
    confirmRotate = true;
  }

  async function rotate() {
    rotating = true;
    try {
      const token = await api.rotateToken(project.name);
      if (settings) settings.token = token;
      confirmRotate = false;
      toast('ok', t('access.rotated', { name: project.name }), t('access.rotatedText'));
    } catch (err) {
      toast('danger', errorText(err));
    } finally {
      rotating = false;
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
  <Card title={t('access.tokenTitle')} description={t('access.tokenText')}>
    <div class="token-row">
      <code class="token selectable" class:masked={!revealed} aria-label={t('access.tokenLabel')} data-testid="token">
        {revealed ? settings.token : '•'.repeat(Math.min(settings.token.length, 32))}
      </code>
      <IconButton
        icon={revealed ? 'eye-off' : 'eye'}
        label={revealed ? t('access.hide') : t('access.reveal')}
        onclick={() => (revealed = !revealed)}
      />
      <IconButton
        icon="copy"
        label={t('access.copy')}
        onclick={() => settings && attempt(() => api.copyText(settings!.token), ['access.copied'])}
      />
      <span class="spacer"></span>
      <Button icon="refresh-cw" variant="danger" onclick={openRotate}>{t('access.rotate')}</Button>
    </div>
  </Card>

  <form onsubmit={saveAllow} novalidate>
    <Card title={t('access.allowTitle')} description={t('access.allowText')}>
      <div class="allow">
        <LineEditor
          bind:value={allowText}
          label={t('access.allowLabel')}
          placeholder={t('access.allowPlaceholder')}
          {bad}
          error={allowError}
          hint={current.length ? t('access.allowCount', { n: current.length }) : t('access.allowOpen')}
          rows={8}
          name="allow"
        />
        {#if settings.allowFile}
          <p class="note">{t('access.allowFile', { path: settings.allowFile })}</p>
        {/if}
      </div>
      {#snippet footer()}
        <Button disabled={!dirty || saving} onclick={() => ((allowText = savedAllow.join('\n')), (serverError = null))}>
          {t('common.discard')}
        </Button>
        <Button variant="primary" type="submit" icon="check" loading={saving} disabled={!dirty || bad.length > 0}>
          {t('access.allowSave')}
        </Button>
      {/snippet}
    </Card>
  </form>

  <Dialog bind:open={confirmRotate} title={t('access.rotateTitle', { name: project.name })} size="sm" closeLabel={t('toast.close')}>
    <div class="rotate">
      <p>{t('access.rotateText')}</p>
      {#if affected.length}
        <p class="strong">{t('access.rotateClients', { n: affected.length })}</p>
        <ul class="affected" data-testid="rotate-clients">
          {#each affected as c (c.id)}
            <li>
              <Avatar name={c.name} size="sm" />
              <span class="who">{c.name}</span>
              <span class="muted">{c.account ?? c.addr}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">{t('access.rotateNoClients')}</p>
      {/if}
    </div>
    {#snippet footer()}
      <Button onclick={() => (confirmRotate = false)}>{t('form.cancel')}</Button>
      <Button variant="danger" loading={rotating} onclick={rotate}>{t('access.rotate')}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .token-row {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
  }

  .token {
    min-width: 0;
    padding: var(--lc-space-1) var(--lc-space-3);
    border-radius: var(--lc-radius-md);
    background: var(--lc-code-bg);
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-md);
    overflow-wrap: anywhere;
  }

  .token.masked {
    letter-spacing: 1px;
    color: var(--lc-muted);
    user-select: none;
  }

  .spacer {
    flex: 1;
  }

  .allow {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    max-width: 640px;
  }

  .note,
  .muted {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .rotate {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-3);
  }

  .strong {
    font-weight: var(--lc-weight-medium);
  }

  .affected {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    max-height: 200px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .affected li {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
  }

  .who {
    font-weight: var(--lc-weight-medium);
  }
</style>
