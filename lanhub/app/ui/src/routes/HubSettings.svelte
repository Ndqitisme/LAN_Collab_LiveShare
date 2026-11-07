<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge, Button, Card, CodeBlock, IconButton, Input, Select, Switch } from '@lan-collab/ui-kit';
  import { t } from '../i18n';
  import {
    api,
    hubApi,
    isAppError,
    type FirewallReport,
    type HubField,
    type HubSettingsView,
    type InviteView,
    type RuleCheck,
  } from '../lib/api';
  import { attempt, errorText, hub, isRemote, toast } from '../lib/state.svelte';

  interface Props {
    onback: () => void;
  }

  let { onback }: Props = $props();

  let view = $state<HubSettingsView | null>(null);
  // The form keeps its own copy: status pushes must not overwrite what is being typed.
  let name = $state('');
  let bind = $state('');
  let port = $state('');
  let discovery = $state(true);
  let discoveryPort = $state('');
  let tls = $state(false);
  let tlsSource = $state<'self' | 'own'>('self');
  let tlsCert = $state('');
  let tlsKey = $state('');
  let addresses = $state<string[]>([]);
  let saving = $state(false);
  let submitted = $state(false);
  let serverError = $state<{ field: HubField; text: string } | null>(null);

  let invites = $state<InviteView[]>([]);
  let firewall = $state<FirewallReport | null>(null);
  let checking = $state(false);
  let opening = $state(false);
  let manual = $state(false);
  let autostart = $state<boolean | null>(null);

  function fill(v: HubSettingsView) {
    view = v;
    name = v.name;
    bind = v.bind;
    port = String(v.port);
    discovery = v.discovery;
    discoveryPort = String(v.discoveryPort);
    tls = v.tls;
    tlsSource = v.tlsCert ? 'own' : 'self';
    tlsCert = v.tlsCert;
    tlsKey = v.tlsKey;
    addresses = v.publicAddress.length ? [...v.publicAddress] : [''];
  }

  async function loadInvites() {
    invites = await hubApi.invites().catch(() => []);
  }

  async function checkFirewall(): Promise<FirewallReport | null> {
    checking = true;
    try {
      firewall = await hubApi.firewallStatus();
    } catch (e) {
      toast('danger', errorText(e));
    } finally {
      checking = false;
    }
    return firewall;
  }

  // The firewall, sign-in start and file pickers act on this machine, not on a remote hub's.
  const remote = isRemote();

  onMount(() => {
    hubApi.settings().then(fill, (e) => toast('danger', errorText(e)));
    loadInvites();
    if (remote) return;
    hubApi.autostart().then(
      (on) => (autostart = on),
      () => (autostart = false),
    );
    checkFirewall();
  });

  function validPort(v: string): boolean {
    return /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 65535;
  }

  const fieldError = (field: HubField, local?: string) =>
    (submitted ? local : undefined) ?? (serverError?.field === field ? serverError.text : undefined);
  const portError = $derived(fieldError('port', validPort(port) ? undefined : t('errors.portInvalid')));
  const discoveryPortError = $derived(
    fieldError('discoveryPort', !discovery || validPort(discoveryPort) ? undefined : t('errors.portInvalid')),
  );
  const tlsError = $derived(
    fieldError('tls', tls && tlsSource === 'own' && (!tlsCert.trim() || !tlsKey.trim()) ? t('errors.tlsPair') : undefined),
  );
  const dirty = $derived(
    !!view &&
      (name !== view.name ||
        bind !== view.bind ||
        port !== String(view.port) ||
        discovery !== view.discovery ||
        discoveryPort !== String(view.discoveryPort) ||
        tls !== view.tls ||
        (tlsSource === 'own' ? tlsCert : '') !== view.tlsCert ||
        (tlsSource === 'own' ? tlsKey : '') !== view.tlsKey ||
        addresses.map((a) => a.trim()).filter(Boolean).join('\n') !== view.publicAddress.join('\n')),
  );
  const fingerprint = $derived(view?.fingerprint?.match(/.{1,4}/g)?.join(' ') ?? null);
  const listening = $derived(hub.snap?.hub.state === 'running' ? hub.snap.hub.port : null);

  async function pick(which: 'cert' | 'key') {
    const current = which === 'cert' ? tlsCert : tlsKey;
    const file = await hubApi
      .pickFile(t(which === 'cert' ? 'hubSettings.pickCert' : 'hubSettings.pickKey'), current.trim() || null)
      .catch(() => null);
    if (!file) return;
    if (which === 'cert') tlsCert = file;
    else tlsKey = file;
    if (serverError?.field === 'tls') serverError = null;
  }

  function clearError(field: HubField) {
    if (serverError?.field === field) serverError = null;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!view) return;
    submitted = true;
    serverError = null;
    if (portError || discoveryPortError || tlsError) return;
    saving = true;
    const before = view.port;
    // Files picked for a certificate stay in the file while TLS is off, once both are given.
    const own = tlsSource === 'own' && (tls || (!!tlsCert.trim() && !!tlsKey.trim()));
    try {
      const saved = await hubApi.update({
        name: name.trim(),
        bind: bind.trim(),
        port: Number(port),
        discovery,
        discoveryPort: discovery ? Number(discoveryPort) : view.discoveryPort,
        tls,
        tlsCert: own ? tlsCert.trim() : '',
        tlsKey: own ? tlsKey.trim() : '',
        publicAddress: addresses.map((a) => a.trim()).filter(Boolean),
      });
      fill(saved);
      submitted = false;
      toast('ok', t('hubSettings.saved'));
      loadInvites();
      const report = await checkFirewall();
      if (saved.port !== before && report?.commands.length) {
        toast('warn', t('hubSettings.portMoved', { port: String(saved.port) }));
      }
    } catch (err) {
      if (isAppError(err) && err.field) serverError = { field: err.field as HubField, text: errorText(err) };
      else toast('danger', errorText(err));
    } finally {
      saving = false;
    }
  }

  async function openFirewall() {
    opening = true;
    try {
      const result = await hubApi.openFirewall();
      firewall = result.report;
      manual = result.outcome === 'declined' || result.outcome === 'failed';
      const tone = result.outcome === 'done' || result.outcome === 'nothing' ? 'ok' : 'danger';
      toast(tone, t(`firewall.${result.outcome}` as const));
    } catch (e) {
      toast('danger', errorText(e));
    } finally {
      opening = false;
    }
  }

  async function toggleAutostart(on: boolean) {
    try {
      autostart = await hubApi.setAutostart(on);
      toast('ok', t(autostart ? 'autostart.on' : 'autostart.off'));
    } catch (e) {
      autostart = !on;
      toast('danger', errorText(e));
    }
  }

  function ruleLabel(r: RuleCheck): string {
    return t(r.protocol === 'TCP' ? 'firewall.tcp' : 'firewall.udp', { port: String(r.port) });
  }

  function ruleLook(r: RuleCheck): { tone: 'ok' | 'warn' | 'danger'; text: string; detail?: string } {
    switch (r.state.state) {
      case 'present':
        return { tone: 'ok', text: t('firewall.present'), detail: t('firewall.presentBy', { rule: r.state.rule }) };
      case 'disabled':
        return { tone: 'warn', text: t('firewall.disabled') };
      case 'blocked':
        return {
          tone: 'danger',
          text: t('firewall.blocked'),
          detail: r.state.program
            ? t('firewall.blockedBy', { rule: r.state.rule })
            : t('firewall.blockedOther', { rule: r.state.rule }),
        };
      default:
        return { tone: 'warn', text: t('firewall.missing') };
    }
  }

  const commandText = $derived(firewall?.commands.map((c) => `netsh ${c}`).join('\n') ?? '');
</script>

<section class="page" aria-labelledby="hub-settings-title">
  <header class="head">
    <IconButton icon="arrow-left" label={t('hubSettings.back')} onclick={onback} />
    <div>
      <h1 id="hub-settings-title">{t('hubSettings.title')}</h1>
      <p class="muted">{t('hubSettings.text')}</p>
    </div>
  </header>

  {#if !view}
    <p class="muted">{t('hubSettings.loading')}</p>
  {:else}
    <form class="column" onsubmit={submit} novalidate>
      <Card title={t('hubSettings.connection')} description={t('hubSettings.connectionText')}>
        <div class="fields">
          <Input
            label={t('hubSettings.name')}
            bind:value={name}
            placeholder={view.hostname}
            hint={t('hubSettings.nameHint', { host: view.hostname })}
            error={fieldError('name')}
            oninput={() => clearError('name')}
            maxlength={80}
            autocomplete="off"
            spellcheck={false}
            name="name"
          />
          <div class="row">
            <Input
              label={t('hubSettings.bind')}
              bind:value={bind}
              hint={t('hubSettings.bindHint')}
              error={fieldError('bind')}
              oninput={() => clearError('bind')}
              mono
              spellcheck={false}
              name="bind"
              class="grow"
            />
            <Input
              label={t('hubSettings.port')}
              bind:value={port}
              error={portError}
              oninput={() => clearError('port')}
              inputmode="numeric"
              mono
              name="port"
              class="port"
            />
          </div>
          <p class="note">
            {t('hubSettings.portHint')}
            {#if listening}{t('hubSettings.listening', { port: String(listening) })}{/if}
          </p>
        </div>
      </Card>

      <Card>
        <div class="fields">
          <Switch bind:checked={discovery} label={t('hubSettings.discovery')} description={t('hubSettings.discoveryHint')} />
          {#if discovery}
            <Input
              label={t('hubSettings.discoveryPort')}
              bind:value={discoveryPort}
              error={discoveryPortError}
              oninput={() => clearError('discoveryPort')}
              inputmode="numeric"
              mono
              name="discoveryPort"
              class="port"
            />
          {/if}
        </div>
      </Card>

      <Card title={t('hubSettings.external')} description={t('hubSettings.externalText')}>
        <div class="fields">
          <fieldset class="addresses">
            <legend>{t('hubSettings.publicAddress')}</legend>
            {#each addresses as _, i (i)}
              <div class="address-row">
                <Input
                  bind:value={addresses[i]}
                  placeholder={t('hubSettings.publicAddressPlaceholder')}
                  aria-label={t('hubSettings.publicAddress')}
                  oninput={() => clearError('publicAddress')}
                  mono
                  spellcheck={false}
                  autocomplete="off"
                  name="publicAddress"
                  class="grow"
                />
                <IconButton
                  icon="x"
                  label={t('hubSettings.removeAddress', { value: addresses[i] })}
                  onclick={() => (addresses = addresses.length > 1 ? addresses.filter((_, j) => j !== i) : [''])}
                />
              </div>
            {/each}
            <p class="note" class:error={serverError?.field === 'publicAddress'}>
              {serverError?.field === 'publicAddress' ? serverError.text : t('hubSettings.publicAddressHint')}
            </p>
            <div>
              <Button size="sm" variant="ghost" icon="plus" onclick={() => (addresses = [...addresses, ''])}>
                {t('hubSettings.addAddress')}
              </Button>
            </div>
          </fieldset>

          <div class="tls">
            <Switch bind:checked={tls} label={t('hubSettings.tls')} description={t('hubSettings.tlsHint')} onchange={() => clearError('tls')} />
            {#if tls}
              <Select
                label={t('hubSettings.tlsSource')}
                bind:value={tlsSource}
                options={[
                  { value: 'self', label: t('hubSettings.tlsSelfSigned') },
                  { value: 'own', label: t('hubSettings.tlsOwn') },
                ]}
                hint={tlsSource === 'self' ? t('hubSettings.tlsSelfSignedHint') : undefined}
                onchange={() => clearError('tls')}
                class="source"
              />
              {#if tlsSource === 'own'}
                <div class="row">
                  <Input
                    label={t('hubSettings.tlsCert')}
                    bind:value={tlsCert}
                    placeholder={t('hubSettings.tlsFilePlaceholder')}
                    oninput={() => clearError('tls')}
                    icon="file"
                    mono
                    spellcheck={false}
                    name="tlsCert"
                    class="grow"
                  />
                  {#if !remote}
                    <Button icon="folder-open" onclick={() => pick('cert')} class="pick">{t('hubSettings.pickFile')}</Button>
                  {/if}
                </div>
                <div class="row">
                  <Input
                    label={t('hubSettings.tlsKey')}
                    bind:value={tlsKey}
                    placeholder={t('hubSettings.tlsFilePlaceholder')}
                    oninput={() => clearError('tls')}
                    icon="key-round"
                    mono
                    spellcheck={false}
                    name="tlsKey"
                    class="grow"
                  />
                  {#if !remote}
                    <Button icon="folder-open" onclick={() => pick('key')} class="pick">{t('hubSettings.pickFile')}</Button>
                  {/if}
                </div>
              {/if}
              {#if tlsError}<p class="note error" role="alert">{tlsError}</p>{/if}
              <div class="fingerprint">
                <span class="label">{t('hubSettings.fingerprint')}</span>
                {#if fingerprint && view.tls}
                  <code class="selectable">{fingerprint}</code>
                  <IconButton
                    icon="copy"
                    size="sm"
                    label={t('hubSettings.copyFingerprint')}
                    onclick={() => attempt(() => api.copyText(view?.fingerprint ?? ''), ['hubSettings.fingerprintCopied'])}
                  />
                {:else}
                  <span class="muted">{t('hubSettings.fingerprintPending')}</span>
                {/if}
              </div>
            {/if}
          </div>
        </div>
        {#snippet footer()}
          <Button disabled={!dirty || saving} onclick={() => view && fill(view)}>{t('hubSettings.discard')}</Button>
          <Button variant="primary" type="submit" loading={saving} disabled={!dirty} icon="check">{t('hubSettings.save')}</Button>
        {/snippet}
      </Card>
    </form>

    <Card title={t('hubSettings.invites')} description={t('hubSettings.invitesText')} padding="none">
      {#if invites.length}
        <ul class="invites">
          {#each invites as inv (inv.name)}
            <li>
              <span class="invite-name">{inv.name}</span>
              <code class="invite-code selectable" title={inv.code}>{inv.code}</code>
              <IconButton
                icon="copy"
                size="sm"
                label={t('hubSettings.copyInvite', { name: inv.name })}
                onclick={() => attempt(() => api.copyText(inv.code), ['toast.inviteCopied'])}
              />
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty muted">{t('hubSettings.invitesEmpty')}</p>
      {/if}
    </Card>
  {/if}

  {#if !remote}
    <Card title={t('firewall.title')} description={t('firewall.text')}>
      {#snippet actions()}
        <Button size="sm" variant="ghost" icon="refresh-cw" loading={checking} onclick={checkFirewall}>{t('firewall.recheck')}</Button>
      {/snippet}
      <div class="fields">
        {#if !firewall}
          <p class="muted">{t('firewall.checking')}</p>
        {:else}
          <ul class="rules">
            {#each firewall.rules as rule (rule.protocol)}
              {@const look = ruleLook(rule)}
              <li>
                <span class="rule-port">{ruleLabel(rule)}</span>
                <Badge tone={look.tone} icon={look.tone === 'ok' ? 'circle-check' : 'triangle-alert'}>{look.text}</Badge>
                {#if look.detail}<span class="muted rule-detail">{look.detail}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if firewall?.commands.length}
          <div class="open">
            <Button variant="primary" icon="shield-check" loading={opening} onclick={openFirewall}>{t('firewall.open')}</Button>
            <span class="note">{t('firewall.openHint')}</span>
          </div>
          {#if manual}
            <div class="manual">
              <div class="manual-head">
                <span class="label">{t('firewall.manual')}</span>
                <Button size="sm" variant="ghost" icon="copy" onclick={() => attempt(() => api.copyText(commandText), ['firewall.commandsCopied'])}>
                  {t('firewall.copyCommands')}
                </Button>
              </div>
              <CodeBlock code={commandText} copyable={false} wrap />
            </div>
          {/if}
        {/if}
      </div>
    </Card>

    <Card title={t('autostart.title')}>
      <Switch
        checked={autostart ?? false}
        disabled={autostart === null}
        label={t('autostart.label')}
        description={t('autostart.hint')}
        onchange={toggleAutostart}
      />
    </Card>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-5);
    max-width: 760px;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-5);
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
  }

  h1 {
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-strong);
    line-height: var(--lc-leading-tight);
    margin-top: var(--lc-space-1);
  }

  .head p {
    margin-top: var(--lc-space-1);
  }

  .muted {
    color: var(--lc-muted);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-4);
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-3);
  }

  .row :global(.grow) {
    flex: 1;
    min-width: 0;
  }

  .fields :global(.port) {
    flex: none;
    width: 120px;
  }

  .fields :global(.source) {
    max-width: 280px;
  }

  /* Lines the button up with the input box, below the field label. */
  .row :global(.pick) {
    flex: none;
    margin-top: calc(var(--lc-text-sm) * var(--lc-leading) + var(--lc-space-1));
  }

  .note {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .note.error {
    color: var(--lc-danger);
  }

  .addresses {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend,
  .label {
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-strong);
  }

  legend {
    margin-bottom: var(--lc-space-1);
  }

  .address-row {
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
  }

  .address-row :global(.grow) {
    flex: 1;
    min-width: 0;
  }

  .tls {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-4);
    padding-top: var(--lc-space-4);
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .fingerprint {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--lc-space-2);
  }

  code {
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
  }

  .fingerprint code {
    padding: var(--lc-space-0) var(--lc-space-2);
    border-radius: var(--lc-radius-sm);
    background: var(--lc-hover);
    word-break: break-all;
  }

  .invites {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .invites li {
    display: flex;
    align-items: center;
    gap: var(--lc-space-3);
    padding: var(--lc-space-2) var(--lc-space-4);
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .invites li:first-child {
    border-top: 0;
  }

  .invite-name {
    flex: none;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--lc-weight-strong);
  }

  .invite-code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--lc-muted);
  }

  .empty {
    padding: var(--lc-space-4);
  }

  .rules {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rules li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--lc-space-3);
  }

  .rule-port {
    min-width: 120px;
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
  }

  .rule-detail {
    font-size: var(--lc-text-sm);
  }

  .open {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--lc-space-3);
  }

  .manual {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
  }

  .manual-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--lc-space-2);
  }
</style>
