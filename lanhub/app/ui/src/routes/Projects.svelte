<script lang="ts">
  import { Button, EmptyState } from '@lan-collab/ui-kit';
  import { t } from '../i18n';
  import ProjectCard from '../lib/ProjectCard.svelte';
  import { hub } from '../lib/state.svelte';

  interface Props {
    onadd: () => void;
    onopen: (name: string, tab?: 'settings') => void;
  }

  let { onadd, onopen }: Props = $props();

  const projects = $derived(hub.snap?.projects ?? []);
  const running = $derived(projects.filter((p) => p.state === 'running').length);
  const clients = $derived(projects.reduce((n, p) => n + p.clients, 0));
  const blocked = $derived(hub.snap?.hub.state === 'configError');
</script>

<section class="page" aria-labelledby="projects-title">
  <header class="head">
    <div class="titles">
      <h1 id="projects-title">{t('projects.title')}</h1>
      {#if projects.length > 0}
        <p class="summary">{t('projects.count', { n: projects.length })}. {t('projects.summary', { running, clients })}</p>
      {/if}
    </div>
    {#if projects.length > 0}
      <Button variant="primary" icon="plus" onclick={onadd} disabled={blocked}>{t('projects.add')}</Button>
    {/if}
  </header>

  {#if !hub.snap}
    <EmptyState icon="loader-circle" title={t('projects.loading')} />
  {:else if projects.length === 0}
    <div class="empty">
      <EmptyState icon="folder-plus" title={t('projects.emptyTitle')} description={t('projects.emptyText')}>
        {#snippet actions()}
          <Button variant="primary" icon="plus" onclick={onadd} disabled={blocked}>{t('projects.add')}</Button>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <div class="grid">
      {#each projects as project (project.name)}
        <ProjectCard {project} onopen={() => onopen(project.name)} onedit={() => onopen(project.name, 'settings')} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-5);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--lc-space-4);
  }

  .titles {
    min-width: 0;
  }

  h1 {
    font-size: var(--lc-text-xl);
    font-weight: var(--lc-weight-strong);
    line-height: var(--lc-leading-tight);
  }

  .summary {
    margin-top: var(--lc-space-1);
    color: var(--lc-muted);
  }

  .empty {
    display: grid;
    place-items: center;
    min-height: 320px;
    border: var(--lc-border-width) dashed var(--lc-border-strong);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--lc-space-4);
  }
</style>
