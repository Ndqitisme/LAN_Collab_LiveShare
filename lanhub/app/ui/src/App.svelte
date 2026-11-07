<script lang="ts">
  import { Button, IconButton, StatusDot, Toast } from '@lan-collab/ui-kit';
  import { t } from './i18n';
  import { api } from './lib/api';
  import { attempt, cycleTheme, dismiss, hub, theme, toasts } from './lib/state.svelte';
  import HubSettings from './routes/HubSettings.svelte';
  import ProjectDetail, { type DetailTab } from './routes/ProjectDetail.svelte';
  import ProjectForm from './routes/ProjectForm.svelte';
  import Projects from './routes/Projects.svelte';

  type Route = { view: 'list' } | { view: 'add' } | { view: 'detail'; name: string; tab: DetailTab } | { view: 'hub' };

  let route = $state<Route>({ view: 'list' });
  let main: HTMLElement | undefined = $state();

  function go(next: Route) {
    route = next;
    main?.scrollTo({ top: 0 });
  }

  const info = $derived(hub.snap?.hub);
  // A hub bound to every interface is reached on this machine's LAN address; otherwise on the bound one.
  const host = $derived(info && (info.bind === '0.0.0.0' || info.bind === '' ? info.addresses[0] : info.bind));
  const address = $derived(info && host ? `${host}:${info.port}` : null);
  const themeIcon = $derived(theme.choice === 'light' ? 'sun' : theme.choice === 'dark' ? 'moon' : 'monitor');
  const themeLabel = $derived(
    theme.choice === 'light' ? t('app.themeLight') : theme.choice === 'dark' ? t('app.themeDark') : t('app.themeSystem'),
  );
</script>

<div class="shell">
  <header class="bar">
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#1e40af" />
            <stop offset="1" stop-color="#0e9f9a" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill="url(#logo-bg)" />
        <g transform="translate(3.6 3.6) scale(0.7)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8" cy="8" r="3" />
          <circle cx="16.5" cy="9.5" r="2.5" />
          <path d="M2.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
          <path d="M13.8 14.6c.8-.6 1.7-.9 2.7-.9 2.2 0 3.9 1.5 4.4 4.3" />
        </g>
      </svg>
      <span class="product">{t('app.name')}</span>
    </div>
    {#if info}
      <div class="hubinfo">
        {#if info.state === 'running'}
          <StatusDot status="live" srLabel={t('status.running')} />
          {#if address}
            <button class="address" type="button" title={t('app.copyAddress')} onclick={() => attempt(() => api.copyText(address), ['app.addressCopied'])}>
              <span class="lc-sr-only">{t('app.hubAt')}</span>{address}
            </button>
          {:else}
            <span class="muted">{t('app.noAddress')}</span>
          {/if}
        {:else if info.state === 'starting'}
          <StatusDot status="connecting" label={t('app.hubStarting')} />
        {:else}
          <StatusDot status="error" srLabel={t('status.failed')} />
        {/if}
      </div>
    {/if}
    <span class="spacer"></span>
    <IconButton icon="settings" label={t('hubSettings.open')} pressed={route.view === 'hub'} onclick={() => go({ view: 'hub' })} />
    <IconButton icon={themeIcon} label={themeLabel} onclick={cycleTheme} />
  </header>

  {#if info?.state === 'bindError' || info?.state === 'configError'}
    <div class="banner" role="alert">
      <p>
        {#if info.state === 'bindError'}
          {t('hubError.bind', { port: String(info.port) })}
        {:else}
          {t('hubError.config', { path: info.configPath })}
          {#if info.configLine && info.configMessage}
            <span class="detail">{t('hubError.configLine', { line: String(info.configLine), message: info.configMessage })}</span>
          {/if}
        {/if}
      </p>
      <div class="banner-actions">
        {#if info.state === 'configError'}
          <Button size="sm" variant="ghost" icon="folder-open" onclick={() => attempt(() => api.openFolder(info.configPath.replace(/[\\/][^\\/]*$/, '')))}>
            {t('hubError.openFolder')}
          </Button>
        {/if}
        <Button size="sm" icon="refresh-cw" onclick={() => attempt(api.reload)}>
          {info.state === 'bindError' ? t('hubError.retry') : t('hubError.reload')}
        </Button>
      </div>
    </div>
  {/if}

  <main class="scroll" bind:this={main}>
    <div class="content">
      {#if route.view === 'list'}
        <Projects onadd={() => go({ view: 'add' })} onopen={(name, tab) => go({ view: 'detail', name, tab: tab ?? 'overview' })} />
      {:else if route.view === 'hub'}
        <HubSettings onback={() => go({ view: 'list' })} />
      {:else if route.view === 'add'}
        <section class="page" aria-labelledby="add-title">
          <header class="head">
            <IconButton icon="arrow-left" label={t('detail.back')} onclick={() => go({ view: 'list' })} />
            <div>
              <h1 id="add-title">{t('form.addTitle')}</h1>
              <p class="muted">{t('form.addText')}</p>
            </div>
          </header>
          <ProjectForm ondone={(name) => go(name ? { view: 'detail', name, tab: 'overview' } : { view: 'list' })} oncancel={() => go({ view: 'list' })} />
        </section>
      {:else}
        {@const current = route}
        <ProjectDetail
          name={current.name}
          tab={current.tab}
          onback={() => go({ view: 'list' })}
          ontab={(tab) => (route = { ...current, tab })}
          onsaved={(name) => go(name ? { view: 'detail', name, tab: current.tab } : { view: 'list' })}
        />
      {/if}
    </div>
  </main>

  <div class="toasts" aria-live="polite">
    {#each toasts as item (item.id)}
      <Toast tone={item.tone} title={item.title} message={item.message} onclose={() => dismiss(item.id)} closeLabel={t('toast.close')} />
    {/each}
  </div>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--lc-space-4);
    flex: none;
    height: 48px;
    padding: 0 var(--lc-space-4) 0 var(--lc-space-5);
    border-bottom: var(--lc-border-width) solid var(--lc-border);
    background: var(--lc-surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
  }

  .logo {
    width: 22px;
    height: 22px;
  }

  .product {
    font-size: var(--lc-text-lg);
    font-weight: var(--lc-weight-strong);
  }

  .hubinfo {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    min-width: 0;
    padding-left: var(--lc-space-4);
    border-left: var(--lc-border-width) solid var(--lc-border);
    color: var(--lc-muted);
  }

  .address {
    padding: var(--lc-space-0) var(--lc-space-2);
    border: 0;
    border-radius: var(--lc-radius-sm);
    background: none;
    color: var(--lc-fg);
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    cursor: pointer;
    transition: background var(--lc-dur-fast) var(--lc-ease);
  }

  .address:hover {
    background: var(--lc-hover);
  }

  .spacer {
    flex: 1;
  }

  .muted {
    color: var(--lc-muted);
  }

  .banner {
    display: flex;
    align-items: center;
    gap: var(--lc-space-3);
    flex: none;
    padding: var(--lc-space-2) var(--lc-space-5);
    border-bottom: var(--lc-border-width) solid color-mix(in srgb, var(--lc-danger) 30%, transparent);
    background: var(--lc-danger-soft);
  }

  .banner p {
    flex: 1;
    min-width: 0;
  }

  .banner .detail {
    display: block;
    margin-top: var(--lc-space-0);
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .banner-actions {
    display: flex;
    flex: none;
    gap: var(--lc-space-2);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .content {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--lc-space-6) var(--lc-space-6) var(--lc-space-8);
  }

  .page {
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

  .toasts {
    position: fixed;
    right: var(--lc-space-4);
    bottom: var(--lc-space-4);
    z-index: var(--lc-z-toast);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--lc-space-2);
    width: min(380px, calc(100vw - 32px));
    pointer-events: none;
  }

  .toasts :global(.lc-toast) {
    pointer-events: auto;
  }
</style>
