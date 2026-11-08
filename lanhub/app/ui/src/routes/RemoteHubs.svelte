<script lang="ts">
  import { Button, Card, Input } from '@lan-collab/ui-kit';
  import { t } from '../i18n';
  import { hubsApi, isAppError, type AppError } from '../lib/api';
  import { errorText, hub, loadHubs, toast } from '../lib/state.svelte';

  interface Props {
    ondone: () => void;
    oncancel: () => void;
  }

  let { ondone, oncancel }: Props = $props();

  type Field = 'host' | 'port' | 'token' | 'fingerprint';

  let label = $state('');
  let host = $state('');
  let port = $state('8200');
  let token = $state('');
  let fingerprint = $state('');
  let busy = $state(false);
  let submitted = $state(false);
  let failure = $state<AppError | null>(null);
  /** The fingerprint the hub presented, waiting for the user to trust it. */
  let offered = $state<string | null>(null);

  const validPort = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 65535;
  const fieldOf = (e: AppError | null): Field | null => (e?.field as Field | null) ?? null;
  const fieldError = (field: Field, local?: string) =>
    (submitted ? local : undefined) ?? (fieldOf(failure) === field && failure ? errorText(failure) : undefined);

  const hostError = $derived(fieldError('host', host.trim() ? undefined : t('errors.remoteHostInvalid')));
  const portError = $derived(fieldError('port', validPort(port) ? undefined : t('errors.portInvalid')));
  const tokenError = $derived(fieldError('token', token.trim() ? undefined : t('errors.remoteTokenEmpty')));
  const fingerprintError = $derived(fieldError('fingerprint'));
  const address = $derived(host.includes(':') ? `[${host.trim()}]:${port.trim()}` : `${host.trim()}:${port.trim()}`);
  const grouped = (fp: string) => fp.match(/.{1,4}/g)?.join(' ') ?? fp;

  function edited(field: Field) {
    if (fieldOf(failure) === field || !fieldOf(failure)) failure = null;
    offered = null;
  }

  async function connect(pin: string) {
    busy = true;
    failure = null;
    try {
      hub.snap = await hubsApi.add({ label, host, port: Number(port), token, fingerprint: pin });
      await loadHubs();
      toast('ok', t('remote.added', { name: label.trim() || host.trim() }));
      ondone();
    } catch (e) {
      failure = isAppError(e) ? e : { code: 'generic', field: null, params: {} };
      offered = null;
    } finally {
      busy = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    submitted = true;
    if (!host.trim() || !validPort(port) || !token.trim()) return;
    if (fingerprint.trim()) return connect(fingerprint);
    busy = true;
    failure = null;
    try {
      const probe = await hubsApi.probe(host, Number(port));
      if (probe.tls && probe.fingerprint) offered = probe.fingerprint;
      else await connect('');
    } catch (err) {
      failure = isAppError(err) ? err : { code: 'generic', field: null, params: {} };
    } finally {
      busy = false;
    }
  }
</script>

<section class="page" aria-labelledby="remote-title">
  <header class="head">
    <div>
      <h1 id="remote-title">{t('remote.addTitle')}</h1>
      <p class="muted">{t('remote.addText')}</p>
    </div>
  </header>

  <form class="column" onsubmit={submit} novalidate>
    <Card>
      <div class="fields">
        <Input label={t('remote.label')} bind:value={label} placeholder={t('remote.labelPlaceholder')} hint={t('remote.labelHint')} maxlength={80} name="label" />
        <div class="row">
          <Input
            label={t('remote.host')}
            bind:value={host}
            placeholder={t('remote.hostPlaceholder')}
            error={hostError}
            oninput={() => edited('host')}
            icon="server"
            mono
            spellcheck={false}
            autocomplete="off"
            name="host"
            class="grow"
          />
          <Input label={t('remote.port')} bind:value={port} error={portError} oninput={() => edited('port')} inputmode="numeric" mono name="port" class="port" />
        </div>
        <Input
          label={t('remote.token')}
          type="password"
          bind:value={token}
          hint={t('remote.tokenHint')}
          error={tokenError}
          oninput={() => edited('token')}
          icon="key-round"
          mono
          autocomplete="off"
          name="token"
        />
        <Input
          label={t('remote.fingerprint')}
          bind:value={fingerprint}
          placeholder={t('remote.fingerprintPlaceholder')}
          hint={t('remote.fingerprintHint')}
          error={fingerprintError}
          oninput={() => edited('fingerprint')}
          icon="shield-check"
          mono
          spellcheck={false}
          autocomplete="off"
          name="fingerprint"
        />
      </div>
    </Card>

    {#if offered}
      <Card title={t('remote.confirmTitle')}>
        <div class="fields">
          <p>{t('remote.confirmText', { address })}</p>
          <code class="fp selectable">{grouped(offered)}</code>
          <div class="actions">
            <Button variant="primary" icon="shield-check" loading={busy} onclick={() => offered && connect(offered)}>{t('remote.trust')}</Button>
            <Button variant="ghost" onclick={() => (offered = null)}>{t('remote.cancel')}</Button>
          </div>
        </div>
      </Card>
    {:else if failure && !fieldOf(failure)}
      <div class="alert" role="alert">
        <p>{errorText(failure)}</p>
        {#if failure.code === 'remoteFingerprint'}
          <dl class="pins">
            <dt>{t('remote.expected')}</dt>
            <dd><code class="selectable">{grouped(failure.params.expected ?? '')}</code></dd>
            <dt>{t('remote.received')}</dt>
            <dd><code class="selectable">{grouped(failure.params.received ?? '')}</code></dd>
          </dl>
        {/if}
      </div>
    {/if}

    {#if !offered}
      <div class="actions">
        <Button type="submit" variant="primary" icon="plug" loading={busy}>{t('remote.connect')}</Button>
        <Button variant="ghost" onclick={oncancel}>{t('remote.cancel')}</Button>
      </div>
    {/if}
  </form>
</section>

<style>
  .page,
  .column,
  .fields {
    display: flex;
    flex-direction: column;
  }

  .page {
    gap: var(--lc-space-5);
    max-width: 720px;
  }

  .column {
    gap: var(--lc-space-4);
  }

  .fields {
    gap: var(--lc-space-4);
  }

  h1 {
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-strong);
    line-height: var(--lc-leading-tight);
  }

  .head p {
    margin-top: var(--lc-space-1);
  }

  .muted {
    color: var(--lc-muted);
  }

  .row {
    display: flex;
    gap: var(--lc-space-3);
  }

  .row :global(.grow) {
    flex: 1;
    min-width: 0;
  }

  .row :global(.port) {
    width: 120px;
    flex: none;
  }

  .actions {
    display: flex;
    gap: var(--lc-space-2);
  }

  .fp,
  .pins code {
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    word-break: break-all;
  }

  .fp {
    padding: var(--lc-space-2) var(--lc-space-3);
    border-radius: var(--lc-radius-sm);
    background: var(--lc-hover);
  }

  .alert {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    padding: var(--lc-space-3) var(--lc-space-4);
    border: var(--lc-border-width) solid color-mix(in srgb, var(--lc-danger) 30%, transparent);
    border-radius: var(--lc-radius-md);
    background: var(--lc-danger-soft);
  }

  .pins {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--lc-space-1) var(--lc-space-3);
  }

  .pins dt {
    color: var(--lc-muted);
  }
</style>
