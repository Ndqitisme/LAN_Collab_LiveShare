<script lang="ts">
  import { Button, Card, IconButton, Input } from '@lan-collab/ui-kit';
  import { tick, untrack } from 'svelte';
  import { t } from '../shared/catalog.svelte';
  import { splitHostPort, validateForm, type Conn, type FormErrors } from './state';

  interface Props {
    conn: Conn;
    revealedToken: string | null;
    busy: boolean;
    onsave: (host: string, port: number, project: string, token: string | undefined) => void;
    onreveal: () => void;
  }

  let { conn, revealedToken, busy, onsave, onreveal }: Props = $props();

  let host = $state('');
  let port = $state('');
  let project = $state('');
  let token = $state('');
  let tokenTouched = $state(false);
  let shown = $state(false);
  let errors = $state<FormErrors>({});
  let pending = $state(false);

  let base = $state.raw<Conn | null>(null);

  const dirty = $derived(base !== null && (host !== base.host || port !== String(base.port) || project !== base.project || tokenTouched));

  // A new saved connection replaces the fields unless the member is editing them.
  $effect(() => {
    const c = conn;
    untrack(() => {
      const keep = dirty;
      base = c;
      if (keep) return;
      host = c.host;
      port = String(c.port);
      project = c.project;
    });
  });

  $effect(() => {
    if (!busy) pending = false;
  });

  $effect(() => {
    if (shown && !tokenTouched && revealedToken !== null) token = revealedToken;
  });

  function toggleShown() {
    shown = !shown;
    if (shown && !tokenTouched) onreveal();
    if (!shown && !tokenTouched) token = '';
  }

  function onHostInput() {
    const split = splitHostPort(host);
    if (split.port) {
      host = split.host;
      port = split.port;
    }
  }

  export function isDirty(): boolean {
    return dirty;
  }

  export async function focus(field: 'host' | 'token') {
    await tick();
    document.getElementById(field === 'token' ? 'editor-token' : 'editor-host')?.focus();
  }

  export function submit() {
    errors = validateForm({ host, port, project }, t);
    if (Object.keys(errors).length) return;
    pending = true;
    onsave(host.trim(), Number(port), project.trim(), tokenTouched ? token : undefined);
    tokenTouched = false;
    shown = false;
    token = '';
  }

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    submit();
  }
</script>

<Card title={t('connection.editor.title')} description={conn.source === 'settings' ? t('connection.editor.source.settings') : t('connection.editor.source.join')}>
  <form class="editor" {onsubmit} novalidate>
    <div class="fields address">
      <Input id="editor-host" class="grow" label={t('connection.field.host')} bind:value={host} oninput={onHostInput} error={errors.host} mono autocomplete="off" />
      <Input id="editor-port" class="port" label={t('connection.field.port')} bind:value={port} inputmode="numeric" error={errors.port} mono />
    </div>
    {#if conn.addresses.length > 1}
      <p class="note">{t('connection.editor.addresses', { addresses: conn.addresses.join(', ') })}</p>
    {/if}
    <div class="fields">
      <Input id="editor-project" label={t('connection.field.project')} bind:value={project} error={errors.project} />
      <div class="token">
        <Input
          id="editor-token"
          class="grow"
          label={t('connection.field.token')}
          type={shown ? 'text' : 'password'}
          mono
          bind:value={token}
          oninput={() => (tokenTouched = true)}
          placeholder={conn.hasToken ? '••••••••' : t('connection.field.token.placeholder')}
          hint={conn.hasToken && !tokenTouched && !shown ? t('connection.field.token.saved') : undefined}
          autocomplete="off"
        />
        <IconButton
          class="eye"
          icon={shown ? 'eye-off' : 'eye'}
          label={shown ? t('connection.field.token.hide') : t('connection.field.token.show')}
          pressed={shown}
          onclick={toggleShown}
        />
      </div>
    </div>
    <div class="fingerprint">
      <span class="label">{t('connection.field.fingerprint')}</span>
      {#if conn.fingerprint}
        <code class="fp">{conn.fingerprint}</code>
      {:else}
        <span class="note">{t('connection.field.fingerprint.none')}</span>
      {/if}
    </div>
    <div class="buttons">
      <Button type="submit" variant={dirty ? 'primary' : 'secondary'} icon="plug" disabled={busy} loading={pending}>{t('connection.editor.save')}</Button>
    </div>
  </form>
</Card>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-3);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--lc-space-2) var(--lc-space-3);
  }

  .fields.address {
    display: flex;
    flex-wrap: wrap;
  }

  .fields.address :global(.grow) {
    flex: 1 1 200px;
  }

  .fields.address :global(.port) {
    flex: 0 1 110px;
  }

  .token {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-1);
  }

  .token :global(.grow) {
    flex: 1;
  }

  /* Lines the button up with the input under its label. */
  .token :global(.eye) {
    margin-top: calc(var(--lc-text-sm) * 1.4 + var(--lc-space-1));
  }

  .note {
    margin: 0;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .fingerprint {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-1);
  }

  .label {
    font-size: var(--lc-text-sm);
    font-weight: var(--lc-weight-medium);
  }

  .fp {
    font-family: var(--lc-font-mono);
    font-size: var(--lc-text-xs);
    overflow-wrap: anywhere;
    color: var(--lc-muted);
  }

  .buttons {
    display: flex;
    gap: var(--lc-space-2);
  }
</style>
