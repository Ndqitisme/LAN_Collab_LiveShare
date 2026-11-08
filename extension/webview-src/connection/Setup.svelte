<script lang="ts">
  import { Button, Card, EmptyState, Icon, Input, Select } from '@lan-collab/ui-kit';
  import { tick } from 'svelte';
  import { t } from '../shared/catalog.svelte';
  import { hubAddress, splitHostPort, validateForm, type FormErrors, type Hub, type Hubs } from './state';

  interface Props {
    hubs: Hubs;
    discoveryPort: number;
    inviteError: string;
    busy: boolean;
    collapsible: boolean;
    oninvite: (code: string) => void;
    onrescan: () => void;
    onhub: (instanceId: string, project: string, token: string) => void;
    onmanual: (host: string, port: number, project: string, token: string) => void;
    oncollapse: () => void;
  }

  let { hubs, discoveryPort, inviteError, busy, collapsible, oninvite, onrescan, onhub, onmanual, oncollapse }: Props = $props();

  let code = $state('');
  let picked = $state<string | null>(null);
  let pickProject = $state('');
  let pickToken = $state('');
  let host = $state('');
  let port = $state('8200');
  let project = $state('');
  let token = $state('');
  let errors = $state<FormErrors>({});
  let tried = $state(false);
  let pending = $state<string | null>(null);

  const pickedHub = $derived(hubs.list.find((h) => h.instanceId === picked) ?? null);

  $effect(() => {
    if (!busy) pending = null;
  });

  export async function focusInvite() {
    await tick();
    document.getElementById('invite-code')?.focus();
  }

  export async function focusManual() {
    await tick();
    document.getElementById('manual-host')?.focus();
  }

  function submitInvite(e: SubmitEvent) {
    e.preventDefault();
    pending = 'invite';
    oninvite(code);
  }

  async function pick(h: Hub) {
    picked = h.instanceId;
    pickProject = h.projects[0] ?? '';
    pickToken = '';
    await tick();
    document.getElementById('pick-token')?.focus();
  }

  function submitPick(e: SubmitEvent) {
    e.preventDefault();
    if (!pickedHub || !pickProject.trim()) return;
    pending = 'hub';
    onhub(pickedHub.instanceId, pickProject.trim(), pickToken);
  }

  function onHostInput() {
    const split = splitHostPort(host);
    if (split.port) {
      host = split.host;
      port = split.port;
    }
  }

  function submitManual(e: SubmitEvent) {
    e.preventDefault();
    tried = true;
    errors = validateForm({ host, port, project }, t);
    if (Object.keys(errors).length) return;
    pending = 'manual';
    onmanual(host.trim(), Number(port), project.trim(), token);
  }

  $effect(() => {
    if (tried) errors = validateForm({ host, port, project }, t);
  });
</script>

<Card title={t('connection.setup.title')} description={t('connection.setup.description')} class="setup">
  {#snippet actions()}
    {#if collapsible}<Button size="sm" variant="ghost" onclick={oncollapse}>{t('connection.setup.hide')}</Button>{/if}
  {/snippet}

  <section class="part" aria-labelledby="invite-head">
    <h4 id="invite-head"><Icon name="key-round" size={14} />{t('connection.invite.title')}</h4>
    <form class="row" onsubmit={submitInvite}>
      <Input
        id="invite-code"
        class="grow"
        mono
        bind:value={code}
        aria-label={t('connection.invite.label')}
        placeholder={t('connection.invite.placeholder')}
        error={inviteError || undefined}
        autocomplete="off"
        spellcheck="false"
      />
      <Button type="submit" variant="primary" disabled={busy || !code.trim()} loading={pending === 'invite'}>{t('connection.invite.submit')}</Button>
    </form>
  </section>

  <section class="part" aria-labelledby="hubs-head">
    <div class="part-head">
      <h4 id="hubs-head"><Icon name="wifi" size={14} />{t('connection.hubs.title')}</h4>
      <Button size="sm" variant="ghost" icon="refresh-cw" loading={hubs.searching} onclick={onrescan}>{t('connection.hubs.rescan')}</Button>
    </div>
    {#if hubs.list.length}
      <ul class="hubs">
        {#each hubs.list as h (h.instanceId)}
          <li class="hub" class:picked={picked === h.instanceId} data-hub={h.instanceId}>
            <div class="hub-row">
              <span class="hub-icon"><Icon name="server" size={16} /></span>
              <div class="hub-text">
                <span class="hub-name">{h.hubName || hubAddress(h)}</span>
                <span class="hub-meta">
                  <span class="mono">{hubAddress(h)}</span>
                  <span>{h.projects.length ? t('connection.hubs.projects', { projects: h.projects.join(', ') }) : t('connection.hubs.noProjects')}</span>
                </span>
                {#if h.tls}<span class="hub-note">{t('connection.hubs.tls')}</span>{/if}
              </div>
              {#if picked !== h.instanceId}
                <Button size="sm" data-pick={h.instanceId} disabled={h.tls || busy} onclick={() => pick(h)}>{t('connection.hubs.pick')}</Button>
              {/if}
            </div>
            {#if picked === h.instanceId}
              <form class="pick" onsubmit={submitPick}>
                <p class="hint">{t('connection.pick.description', { hub: h.hubName || hubAddress(h) })}</p>
                <div class="fields">
                  {#if h.projects.length > 1}
                    <Select label={t('connection.field.project')} bind:value={pickProject} options={h.projects.map((p) => ({ value: p, label: p }))} />
                  {:else if !h.projects.length}
                    <Input label={t('connection.field.project')} bind:value={pickProject} placeholder={t('connection.field.project.placeholder')} />
                  {/if}
                  <Input id="pick-token" label={t('connection.field.token')} type="password" mono bind:value={pickToken} placeholder={t('connection.field.token.placeholder')} autocomplete="off" />
                </div>
                <div class="buttons">
                  <Button type="submit" variant="primary" disabled={busy || !pickProject.trim()} loading={pending === 'hub'}>{t('connection.connect')}</Button>
                  <Button variant="ghost" onclick={() => (picked = null)}>{t('connection.pick.cancel')}</Button>
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if hubs.searching}
      <p class="searching" role="status"><Icon name="loader-circle" size={14} spin />{t('connection.hubs.searching')}</p>
    {:else}
      <EmptyState compact icon="wifi-off" title={t('connection.hubs.empty.title')} description={t('connection.hubs.empty.description', { port: discoveryPort })} />
    {/if}
  </section>

  <section class="part" aria-labelledby="manual-head">
    <h4 id="manual-head"><Icon name="pencil" size={14} />{t('connection.manual.title')}</h4>
    <form class="manual" onsubmit={submitManual} novalidate>
      <div class="fields address">
        <Input id="manual-host" class="grow" label={t('connection.field.host')} bind:value={host} oninput={onHostInput} placeholder={t('connection.field.host.placeholder')} error={errors.host} mono autocomplete="off" />
        <Input class="port" label={t('connection.field.port')} bind:value={port} inputmode="numeric" error={errors.port} mono />
      </div>
      <div class="fields">
        <Input label={t('connection.field.project')} bind:value={project} placeholder={t('connection.field.project.placeholder')} error={errors.project} />
        <Input label={t('connection.field.token')} type="password" mono bind:value={token} placeholder={t('connection.field.token.placeholder')} autocomplete="off" />
      </div>
      <div class="buttons">
        <Button type="submit" variant="primary" disabled={busy} loading={pending === 'manual'}>{t('connection.connect')}</Button>
      </div>
    </form>
  </section>
</Card>

<style>
  .part {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    padding: var(--lc-space-3) 0;
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .part:first-child {
    padding-top: 0;
    border-top: none;
  }

  .part:last-child {
    padding-bottom: 0;
  }

  h4 {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    margin: 0;
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-strong);
  }

  .part-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--lc-space-2);
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
  }

  .row :global(.grow),
  .address :global(.grow) {
    flex: 1 1 auto;
  }

  .hubs {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .hub {
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-md);
    background: var(--lc-surface);
  }

  .hub.picked {
    border-color: var(--lc-focus);
  }

  .hub-row {
    display: flex;
    align-items: center;
    gap: var(--lc-space-3);
    padding: var(--lc-space-2) var(--lc-space-3);
  }

  .hub-icon {
    display: inline-flex;
    color: var(--lc-accent);
  }

  .hub-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .hub-name {
    font-weight: var(--lc-weight-medium);
    overflow-wrap: anywhere;
  }

  .hub-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-1) var(--lc-space-3);
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .hub-note {
    color: var(--lc-warn);
    font-size: var(--lc-text-sm);
  }

  .mono {
    font-family: var(--lc-font-mono);
  }

  .pick {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    padding: 0 var(--lc-space-3) var(--lc-space-3);
  }

  .hint {
    margin: 0;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .manual {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--lc-space-2) var(--lc-space-3);
  }

  .fields.address {
    display: flex;
    flex-wrap: wrap;
  }

  .fields.address :global(.grow) {
    flex: 1 1 180px;
  }

  .fields.address :global(.port) {
    flex: 0 1 110px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-2);
  }

  .searching {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    margin: 0;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }
</style>
