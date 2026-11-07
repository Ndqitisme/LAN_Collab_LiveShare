<script lang="ts" module>
  import type { TabItem } from '@lan-collab/ui-kit';
  import { t } from '../i18n';

  /** The tabs of a project. A tab is an id here plus a branch in the panel below. */
  export type DetailTab = 'overview' | 'access' | 'sync' | 'history' | 'invite' | 'members' | 'logs' | 'settings';

  export const detailTabs = (): (TabItem & { id: DetailTab })[] => [
    { id: 'overview', label: t('detail.overview'), icon: 'activity' },
    { id: 'access', label: t('detail.access'), icon: 'key-round' },
    { id: 'sync', label: t('detail.sync'), icon: 'refresh-cw' },
    { id: 'history', label: t('detail.history'), icon: 'history' },
    { id: 'invite', label: t('detail.invite'), icon: 'link' },
    { id: 'members', label: t('detail.members'), icon: 'users' },
    { id: 'logs', label: t('detail.logs'), icon: 'file-text' },
    { id: 'settings', label: t('detail.settings'), icon: 'settings' },
  ];
</script>

<script lang="ts">
  import { Badge, Button, Card, EmptyState, IconButton, StatusDot, Tabs } from '@lan-collab/ui-kit';
  import { num } from '../i18n';
  import { api } from '../lib/api';
  import { ago, when } from '../lib/format';
  import { stateLook } from '../lib/look';
  import { attempt, clock, hub } from '../lib/state.svelte';
  import ProjectForm from './ProjectForm.svelte';
  import Access from './project/Access.svelte';
  import History from './project/History.svelte';
  import Invite from './project/Invite.svelte';
  import Logs from './project/Logs.svelte';
  import Members from './project/Members.svelte';
  import Sync from './project/Sync.svelte';

  interface Props {
    name: string;
    tab: DetailTab;
    onback: () => void;
    ontab: (tab: DetailTab) => void;
    /** After a save that may have renamed the project, or after a delete (null). */
    onsaved: (name: string | null) => void;
  }

  let { name, tab, onback, ontab, onsaved }: Props = $props();

  const project = $derived(hub.snap?.projects.find((p) => p.name.toLowerCase() === name.toLowerCase()));
  const look = $derived(project && stateLook(project.state));
  const live = $derived(project?.state === 'running');

  function toggle() {
    if (!project) return;
    const on = !project.enabled;
    attempt(() => api.setEnabled(project.name, on), [on ? 'toast.resumed' : 'toast.paused', { name: project.name }]);
  }
</script>

{#if !project || !look}
  <div class="missing">
    <EmptyState icon="folder" title={t('detail.notFound', { name })} description={t('detail.notFoundText')}>
      {#snippet actions()}
        <Button icon="arrow-left" onclick={onback}>{t('detail.back')}</Button>
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <section class="page" aria-labelledby="detail-title">
    <header class="head">
      <IconButton icon="arrow-left" label={t('detail.back')} onclick={onback} />
      <StatusDot status={look.dot} size={10} />
      <h1 id="detail-title">{project.name}</h1>
      <Badge tone={look.tone}>{t(look.label)}</Badge>
      <span class="spacer"></span>
      <Button icon={project.enabled ? 'pause' : 'play'} onclick={toggle}>
        {project.enabled ? t('card.pauseAction') : t('card.resumeAction')}
      </Button>
      <Button icon="copy" disabled={!live} onclick={() => attempt(() => api.copyInvite(project.name), ['toast.inviteCopied'])}>
        {t('card.copyInvite')}
      </Button>
    </header>

    <Tabs items={detailTabs()} value={tab} label={t('detail.tabsLabel')} onchange={(id) => ontab(id as DetailTab)}>
      {#snippet children(selected)}
        <div class="panel">
          {#if selected === 'overview'}
            <div class="stats">
              <div class="stat">
                <span class="label">{t('card.clients')}</span>
                <span class="value">{live ? num(project.clients) : '–'}</span>
              </div>
              <div class="stat">
                <span class="label">{t('card.files')}</span>
                <span class="value">{project.files === null ? '–' : num(project.files)}</span>
              </div>
              <div class="stat">
                <span class="label">{t('card.lastActivity')}</span>
                <span class="value">{live ? ago(project.lastActivity, clock.now) : '–'}</span>
              </div>
              <div class="stat">
                <span class="label">{t('card.rate')}</span>
                <span class="value">{live ? num(project.rate) : '–'}</span>
              </div>
            </div>
            <Card padding="none">
              <dl class="facts">
                <div class="fact">
                  <dt>{t('detail.folder')}</dt>
                  <dd class="path">
                    <span class="selectable" title={project.root}>{project.root}</span>
                    <Button size="sm" variant="ghost" icon="external-link" onclick={() => attempt(() => api.openFolder(project.root))}>
                      {t('detail.openFolder')}
                    </Button>
                  </dd>
                </div>
                <div class="fact">
                  <dt>{t('detail.state')}</dt>
                  <dd>
                    {t(look.label)}
                    {#if project.state === 'failed'}
                      <span class="problem">{project.rootMissing ? t('status.rootMissing') : t('status.failedDetail')}</span>
                    {/if}
                  </dd>
                </div>
                <div class="fact">
                  <dt>{t('detail.startedAt')}</dt>
                  <dd>{project.startedAt ? when(project.startedAt, clock.now) : t('detail.notStarted')}</dd>
                </div>
                <div class="fact">
                  <dt>{t('detail.advertise')}</dt>
                  <dd>{project.advertise ? t('detail.advertiseOn') : t('detail.advertiseOff')}</dd>
                </div>
              </dl>
            </Card>
          {:else if selected === 'access'}
            <Access {project} />
          {:else if selected === 'sync'}
            <Sync {project} />
          {:else if selected === 'history'}
            <History {project} />
          {:else if selected === 'invite'}
            <Invite {project} />
          {:else if selected === 'members'}
            <Members {project} />
          {:else if selected === 'logs'}
            <Logs {project} />
          {:else if selected === 'settings'}
            {#key project.name}
              <ProjectForm {project} ondone={onsaved} oncancel={() => ontab('overview')} />
            {/key}
          {/if}
        </div>
      {/snippet}
    </Tabs>
  </section>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-4);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
  }

  h1 {
    min-width: 0;
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-strong);
    line-height: var(--lc-leading-tight);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spacer {
    flex: 1;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-4);
    padding-top: var(--lc-space-4);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--lc-space-3);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
    min-width: 0;
    padding: var(--lc-space-3) var(--lc-space-4);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
  }

  .label {
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .value {
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .facts {
    margin: 0;
  }

  .fact {
    display: grid;
    grid-template-columns: 160px minmax(0, 1fr);
    gap: var(--lc-space-4);
    align-items: center;
    min-height: 44px;
    padding: var(--lc-space-2) var(--lc-space-4);
  }

  .fact + .fact {
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  dt {
    color: var(--lc-muted);
  }

  dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
    margin: 0;
  }

  .path span {
    min-width: 0;
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    overflow-wrap: anywhere;
  }

  .problem {
    color: var(--lc-danger);
  }

  .missing {
    display: grid;
    place-items: center;
    min-height: 360px;
  }
</style>
