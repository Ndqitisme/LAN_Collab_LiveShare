<script lang="ts">
  import { Badge, Card, Icon, IconButton, StatusDot, Switch } from '@lan-collab/ui-kit';
  import { t, num } from '../i18n';
  import { api, type ProjectView } from './api';
  import { ago, shortPath } from './format';
  import { attempt, clock } from './state.svelte';
  import { stateLook } from './look';

  interface Props {
    project: ProjectView;
    onopen: () => void;
    onedit: () => void;
  }

  let { project, onopen, onedit }: Props = $props();

  const look = $derived(stateLook(project.state));
  const live = $derived(project.state === 'running');
  // Bumped when a toggle fails, so the switch drops its local flip and shows the real state again.
  let resync = $state(0);

  async function toggle(on: boolean) {
    const ok = await attempt(() => api.setEnabled(project.name, on), [
      on ? 'toast.resumed' : 'toast.paused',
      { name: project.name },
    ]);
    if (!ok) resync++;
  }

  function copyInvite() {
    attempt(() => api.copyInvite(project.name), ['toast.inviteCopied']);
  }
</script>

<Card padding="none" class="project-card {project.state}">
  <div class="card" data-project={project.name}>
    <div class="top">
      <StatusDot status={look.dot} size={9} />
      <button class="name" type="button" onclick={onopen} aria-label={t('card.open', { name: project.name })}>
        {project.name}
      </button>
      <Badge tone={look.tone}>{t(look.label)}</Badge>
    </div>
    <p class="root" title={project.root}>{shortPath(project.root)}</p>
    {#if project.state === 'failed'}
      <p class="problem" title={project.error ?? ''}>
        <Icon name="circle-alert" size={14} />
        {project.rootMissing ? t('status.rootMissing') : t('status.failedDetail')}
      </p>
    {/if}
    <dl class="metrics" class:dim={!live}>
      <div>
        <dt>{t('card.clients')}</dt>
        <dd data-metric="clients">{live ? num(project.clients) : '–'}</dd>
      </div>
      <div>
        <dt>{t('card.files')}</dt>
        <dd data-metric="files">{project.files === null ? '–' : num(project.files)}</dd>
      </div>
      <div>
        <dt>{t('card.lastActivity')}</dt>
        <dd data-metric="activity">{live ? ago(project.lastActivity, clock.now) : '–'}</dd>
      </div>
      <div>
        <dt>{t('card.rate')}</dt>
        <dd data-metric="rate">{live ? num(project.rate) : '–'}</dd>
      </div>
    </dl>
    <div class="foot">
      {#key `${project.enabled}:${resync}`}
        <Switch checked={project.enabled} label={t('card.serve')} onchange={toggle} />
      {/key}
      <span class="spacer"></span>
      <IconButton icon="copy" label={t('card.copyInvite')} disabled={!live} onclick={copyInvite} />
      <IconButton icon="pencil" label={t('card.edit')} onclick={onedit} />
    </div>
  </div>
</Card>

<style>
  .card {
    container-type: inline-size;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    padding: var(--lc-space-4) var(--lc-space-4) var(--lc-space-3);
    border-radius: var(--lc-radius-lg);
    transition: background var(--lc-dur) var(--lc-ease);
  }

  .card:hover {
    background: var(--lc-hover);
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--lc-fg);
    font-size: var(--lc-text-lg);
    font-weight: var(--lc-weight-strong);
    line-height: var(--lc-leading-tight);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  /* The name button covers the whole card, so a click anywhere opens the project; controls sit above it. */
  .name::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--lc-radius-lg);
  }

  .name:focus-visible {
    outline: none;
  }

  .name:focus-visible::after {
    outline: var(--lc-focus-width) solid var(--lc-focus);
    outline-offset: -1px;
  }

  .root {
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .problem {
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
    font-size: var(--lc-text-sm);
    color: var(--lc-danger);
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--lc-space-3);
    margin: var(--lc-space-2) 0 0;
    padding: var(--lc-space-3) 0 0;
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .metrics div {
    min-width: 0;
  }

  /* Two columns of two when the card is too narrow for four labels side by side. */
  @container (max-width: 420px) {
    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: var(--lc-space-2);
    }
  }

  dt {
    font-size: var(--lc-text-xs);
    color: var(--lc-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  dd {
    margin: var(--lc-space-0) 0 0;
    font-size: var(--lc-text-lg);
    font-weight: var(--lc-weight-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .metrics.dim dd {
    color: var(--lc-muted);
  }

  .foot {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
    margin-top: var(--lc-space-1);
  }

  .spacer {
    flex: 1;
  }
</style>
