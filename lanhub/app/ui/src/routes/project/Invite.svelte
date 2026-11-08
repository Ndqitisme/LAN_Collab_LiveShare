<script lang="ts">
  import { untrack } from 'svelte';
  import { Badge, Button, Card, EmptyState, Icon, IconButton } from '@lan-collab/ui-kit';
  import { t } from '../../i18n';
  import { api, hubApi, type InviteCodes, type ProjectView } from '../../lib/api';
  import QrCode from '../../lib/QrCode.svelte';
  import { attempt, errorText, hub, isRemote } from '../../lib/state.svelte';

  interface Props {
    project: ProjectView;
  }

  let { project }: Props = $props();

  const name = $derived(project.name);
  // The codes change with the LAN addresses and the port, and cannot be made until the hub runs.
  const network = $derived(`${hub.snap?.hub.state}|${hub.snap?.hub.port}|${hub.snap?.hub.addresses.join(',')}`);
  let codes = $state<InviteCodes | null>(null);
  // A remote hub's own addresses are not this machine's: there the hosts that are not public are the LAN ones.
  let publicHosts = $state<Set<string> | null>(null);
  let loadError = $state<string | null>(null);

  async function load(n = name) {
    loadError = null;
    try {
      codes = await api.inviteCodes(n);
      publicHosts = isRemote() ? new Set((await hubApi.settings()).publicAddress) : null;
    } catch (e) {
      loadError = errorText(e);
    }
  }

  $effect(() => {
    const n = name;
    void network;
    untrack(() => load(n));
  });

  function copy(code: string) {
    attempt(() => api.copyText(code), ['toast.inviteCopied']);
  }

  const lan = $derived(new Set(hub.snap?.hub.addresses ?? []));
  const isLan = (host: string) => (publicHosts ? !publicHosts.has(host) : lan.has(host));
</script>

{#if loadError}
  <EmptyState icon="circle-alert" title={loadError}>
    {#snippet actions()}
      <Button icon="refresh-cw" onclick={() => load()}>{t('common.retry')}</Button>
    {/snippet}
  </EmptyState>
{:else if !codes}
  <EmptyState icon="loader-circle" title={t('common.loading')} compact />
{:else if !codes.code}
  <EmptyState icon="wifi-off" title={t('app.noAddress')} description={t('invite.noAddressText')} />
{:else}
  {@const code = codes.code}
  <Card title={t('invite.title')} description={t('invite.text')}>
    {#if project.state !== 'running'}
      <p class="paused"><Icon name="pause" size={14} />{t('invite.paused')}</p>
    {/if}
    <div class="main">
      <div class="code-side">
        <button
          type="button"
          class="code selectable"
          title={t('invite.copy')}
          aria-label={t('invite.codeLabel', { name })}
          data-testid="invite-code"
          onclick={() => copy(code)}
        >
          {code}
        </button>
        <div class="actions">
          <Button variant="primary" icon="copy" onclick={() => copy(code)}>{t('invite.copy')}</Button>
          {#if codes.tls}<Badge tone="ok" icon="shield-check">{t('invite.tls')}</Badge>{/if}
        </div>
        <div class="hosts">
          <h3>{t('invite.addresses')}</h3>
          <p class="muted">{t('invite.addressesText', { port: String(codes.port) })}</p>
          <ol>
            {#each codes.hosts as host, i (host)}
              <li>
                <span class="index">{i + 1}</span>
                <span class="host selectable">{host}</span>
                <Badge tone={isLan(host) ? 'neutral' : 'accent'}>
                  {isLan(host) ? t('invite.lan') : t('invite.public')}
                </Badge>
              </li>
            {/each}
          </ol>
        </div>
      </div>
      <figure class="qr-side">
        <button type="button" class="qr-button" title={t('invite.copy')} onclick={() => copy(code)} data-testid="invite-qr">
          <QrCode text={code} label={t('invite.qr')} size={232} />
        </button>
        <figcaption class="muted">{t('invite.qrHint')}</figcaption>
      </figure>
    </div>
  </Card>

{/if}

<style>
  .paused {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    margin-bottom: var(--lc-space-4);
    padding: var(--lc-space-2) var(--lc-space-3);
    border-radius: var(--lc-radius-md);
    background: var(--lc-warn-soft);
    font-size: var(--lc-text-sm);
  }

  .main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--lc-space-6);
    align-items: start;
  }

  .code-side {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-3);
    min-width: 0;
  }

  .code {
    display: block;
    width: 100%;
    max-height: 132px;
    padding: var(--lc-space-3);
    overflow-y: auto;
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-md);
    background: var(--lc-code-bg);
    color: var(--lc-fg);
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    line-height: var(--lc-leading);
    text-align: left;
    word-break: break-all;
    cursor: copy;
    transition: border-color var(--lc-dur-fast) var(--lc-ease);
  }

  .code:hover {
    border-color: var(--lc-border-strong);
  }

  .code:focus-visible,
  .qr-button:focus-visible {
    outline: var(--lc-focus-width) solid var(--lc-focus);
    outline-offset: 2px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
  }

  .hosts {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
    padding-top: var(--lc-space-3);
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  h3 {
    margin: 0;
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-strong);
  }

  ol {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
    margin: var(--lc-space-1) 0 0;
    padding: 0;
    list-style: none;
  }

  ol li {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
  }

  .index {
    width: 18px;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .host {
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
  }

  .qr-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--lc-space-2);
    max-width: 248px;
    margin: 0;
    text-align: center;
  }

  .qr-button {
    padding: var(--lc-space-1);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: #fff;
    cursor: copy;
  }

  .muted {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }


  @media (max-width: 760px) {
    .main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
