<script lang="ts">
  import { Button, Card, CodeBlock, Dialog, StatusDot } from '@lan-collab/ui-kit';
  import { tick } from 'svelte';
  import { setCatalog, t } from '../shared/catalog.svelte';
  import { onHostMessage, post } from '../shared/host';
  import Diagnostics from './Diagnostics.svelte';
  import Editor from './Editor.svelte';
  import Setup from './Setup.svelte';
  import { ACTIVE, firewallPort, statusView, type Diagnosis, type Hubs, type Snapshot, type Status, type StepResult } from './state';

  type HostMessage =
    | { type: 'init'; catalog: Record<string, string>; snapshot: Snapshot; diag: Diagnosis; hubs: Hubs }
    | { type: 'snapshot'; snapshot: Snapshot }
    | { type: 'status'; status: Status }
    | { type: 'diag'; diag: Diagnosis }
    | { type: 'diagStep'; result: StepResult }
    | { type: 'hubs'; hubs: Hubs }
    | { type: 'inviteError'; text: string }
    | { type: 'token'; token: string };

  let snapshot = $state.raw<Snapshot | null>(null);
  let diag = $state.raw<Diagnosis>({ running: false, results: [], at: null });
  let hubs = $state.raw<Hubs>({ searching: false, list: [] });
  let inviteError = $state('');
  let revealedToken = $state<string | null>(null);
  let setupOpen = $state(false);
  let firewallOpen = $state(false);
  let setup: ReturnType<typeof Setup> | undefined = $state();
  let editor: ReturnType<typeof Editor> | undefined = $state();

  const conn = $derived(snapshot?.conn ?? null);
  const status = $derived(snapshot?.status ?? null);
  const view = $derived(status ? statusView(status, t) : null);
  const active = $derived(status ? ACTIVE.has(status.name) : false);
  const port = $derived(firewallPort(diag, conn));
  const discoveryPort = $derived(snapshot?.discoveryPort ?? 8201);
  const command = $derived(t('connection.firewall.command', { port, discoveryPort }));

  onHostMessage<HostMessage>((m) => {
    if (m.type === 'init') {
      setCatalog(m.catalog);
      snapshot = m.snapshot;
      diag = m.diag;
      hubs = m.hubs;
    } else if (m.type === 'snapshot') {
      if (JSON.stringify(m.snapshot.conn) !== JSON.stringify(snapshot?.conn)) {
        setupOpen = false;
        inviteError = '';
        revealedToken = null;
      }
      snapshot = m.snapshot;
    } else if (m.type === 'status' && snapshot) {
      snapshot = { ...snapshot, status: m.status };
    } else if (m.type === 'diag') {
      diag = m.diag;
    } else if (m.type === 'diagStep') {
      diag = { ...diag, results: [...diag.results, m.result] };
    } else if (m.type === 'hubs') {
      hubs = m.hubs;
    } else if (m.type === 'inviteError') {
      inviteError = m.text;
    } else if (m.type === 'token') {
      revealedToken = m.token;
    }
  });

  async function openSetup(focus: 'invite' | 'manual') {
    setupOpen = true;
    await tick();
    if (focus === 'invite') setup?.focusInvite();
    else setup?.focusManual();
  }

  // Actions that point at a field of this panel move focus there; Thử lại with unsaved edits saves them first.
  function runAction(id: string, result: StepResult | null) {
    if (id === 'firewall') firewallOpen = true;
    else if (id === 'paste_invite') openSetup('invite');
    else if ((id === 'enter_token' || id === 'open_settings') && conn && editor) editor.focus(id === 'enter_token' ? 'token' : 'host');
    else if (id === 'enter_token' || id === 'open_settings') openSetup('manual');
    else if (id === 'retry' && editor?.isDirty()) editor.submit();
    else post({ type: 'action', id, code: result?.code ?? null, data: result?.data ?? {} });
  }

  function invite(code: string) {
    inviteError = '';
    post({ type: 'invite', code });
  }

  post({ type: 'ready' });
</script>

{#if snapshot && status && view}
  <main class="page">
    <header class="head">
      <h1>{t('connection.title')}</h1>
      <p class="folder">{snapshot.folder ? t('connection.folder', { path: snapshot.folder.path }) : t('connection.folder.none')}</p>
    </header>

    <div class="grid">
      <div class="col">
        {#snippet setupCard()}
          <Setup
            bind:this={setup}
            {hubs}
            {discoveryPort}
            {inviteError}
            busy={diag.running}
            collapsible={!!conn}
            oninvite={invite}
            onrescan={() => post({ type: 'rescan' })}
            onhub={(instanceId, project, token) => post({ type: 'connectHub', instanceId, project, token })}
            onmanual={(host, port, project, token) => post({ type: 'manual', host, port, project, token })}
            oncollapse={() => (setupOpen = false)}
          />
        {/snippet}

        {#if !conn}{@render setupCard()}{/if}

        <Card title={t('connection.status.title')}>
          <div class="status" data-state={status.name}>
            <div class="state-line">
              <StatusDot status={view.dot} label={view.label} size={10} />
            </div>
            {#if view.detail}<p class="detail" class:error={view.dot === 'error'}>{view.detail}</p>{/if}
            {#if !conn}<p class="detail">{t('connection.status.unbound')}</p>{/if}
            {#if status.target || status.rtt !== null || status.members !== null}
              <ul class="facts">
                {#if status.target}<li data-fact="target">{t('connection.status.target', { host: status.target.host, port: status.target.port, project: status.target.project })}</li>{/if}
                {#if status.rtt !== null}<li data-fact="rtt">{t('connection.status.rtt', { ms: status.rtt })}</li>{/if}
                {#if status.members !== null}<li data-fact="members">{t('connection.status.members', { count: status.members })}</li>{/if}
              </ul>
            {/if}
            <div class="buttons">
              {#if active}
                <Button size="sm" icon="unplug" onclick={() => post({ type: 'disconnect' })}>{t('connection.status.disconnect')}</Button>
              {:else if conn}
                <Button size="sm" variant={status.name === 'needs_action' ? 'secondary' : 'primary'} icon="plug" onclick={() => post({ type: 'connect' })}>{t('connection.connect')}</Button>
              {/if}
            </div>
          </div>
        </Card>

        {#if conn}
          <Editor bind:this={editor} {conn} {revealedToken} busy={diag.running} onreveal={() => post({ type: 'revealToken' })} onsave={(host, port, project, token) => post({ type: 'save', host, port, project, token })} />
          {#if setupOpen}
            {@render setupCard()}
          {:else}
            <div class="change">
              <Button variant="ghost" icon="link" onclick={() => openSetup('invite')}>{t('connection.setup.change')}</Button>
            </div>
          {/if}
        {/if}
      </div>

      <div class="col">
        <Diagnostics
          {diag}
          onrun={() => post({ type: 'diagnose' })}
          oncopy={() => post({ type: 'copyReport' })}
          onlog={() => post({ type: 'openLog' })}
          onaction={runAction}
        />
        {#if conn}
          <Card title={t('connection.reset.title')} description={t('connection.reset.description')}>
            <Button variant="danger" icon="rotate-ccw" onclick={() => post({ type: 'reset' })}>{t('connection.reset.open')}</Button>
          </Card>
        {/if}
      </div>
    </div>
  </main>

  <Dialog bind:open={firewallOpen} title={t('connection.firewall.title')} description={t('connection.firewall.description', { port, discoveryPort })} closeLabel={t('connection.firewall.close')} size="lg">
    <CodeBlock code={command} label="PowerShell" copyable={false} wrap />
    <p class="note">{t('connection.firewall.note')}</p>
    {#snippet footer()}
      <Button variant="primary" icon="copy" onclick={() => post({ type: 'copy', text: command })}>{t('connection.firewall.copy')}</Button>
      <Button onclick={() => (firewallOpen = false)}>{t('connection.firewall.close')}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .page {
    box-sizing: border-box;
    max-width: 1180px;
    margin: 0 auto;
    padding: var(--lc-space-5) var(--lc-space-5) var(--lc-space-8);
  }

  .head {
    margin-bottom: var(--lc-space-4);
  }

  h1 {
    margin: 0 0 var(--lc-space-1);
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-strong);
  }

  .folder {
    margin: 0;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
    overflow-wrap: anywhere;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--lc-space-4);
    align-items: start;
  }

  @media (min-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    }
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-4);
    min-width: 0;
  }

  .status {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
  }

  .state-line {
    font-size: var(--lc-text-md);
    font-weight: var(--lc-weight-medium);
  }

  .detail {
    margin: 0;
    font-size: var(--lc-text-sm);
    line-height: var(--lc-leading);
  }

  .detail.error {
    color: var(--lc-danger);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-1) var(--lc-space-4);
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lc-space-2);
  }

  .buttons:empty {
    display: none;
  }

  .change {
    display: flex;
  }

  .note {
    margin: var(--lc-space-2) 0 0;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  @media (max-width: 480px) {
    .page {
      padding: var(--lc-space-3);
    }
  }
</style>
