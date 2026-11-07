<script lang="ts">
  import { untrack } from 'svelte';
  import { Button, Card, Dialog, Input, Switch } from '@lan-collab/ui-kit';
  import { t } from '../i18n';
  import { api, isAppError, type ProjectView } from '../lib/api';
  import { attempt, errorText, hub, toast } from '../lib/state.svelte';

  interface Props {
    /** The project to edit; absent when adding one. */
    project?: ProjectView;
    /** Called after a save with the saved name, or after a delete with null. */
    ondone: (name: string | null) => void;
    oncancel: () => void;
  }

  let { project, ondone, oncancel }: Props = $props();

  // The form keeps its own copy: status pushes must not overwrite what is being typed.
  const initial = untrack(() => project);
  const editing = !!initial;
  let name = $state(initial?.name ?? '');
  let root = $state(initial?.root ?? '');
  let enabled = $state(initial?.enabled ?? true);
  let advertise = $state(initial?.advertise ?? true);
  let saving = $state(false);
  let submitted = $state(false);
  let serverError = $state<{ field: 'name' | 'root'; text: string } | null>(null);
  let confirmDelete = $state(false);
  let deleting = $state(false);

  const others = $derived((hub.snap?.projects ?? []).filter((p) => p.name.toLowerCase() !== initial?.name.toLowerCase()));

  function localNameError(): string | undefined {
    const n = name.trim();
    if (!n) return t('errors.nameEmpty');
    const dup = others.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (dup) return t('errors.nameDuplicate', { name: dup.name });
    return undefined;
  }

  function localRootError(): string | undefined {
    return root.trim() ? undefined : t('errors.rootEmpty');
  }

  const nameError = $derived(
    (submitted ? localNameError() : undefined) ?? (serverError?.field === 'name' ? serverError.text : undefined),
  );
  const rootError = $derived(
    (submitted ? localRootError() : undefined) ?? (serverError?.field === 'root' ? serverError.text : undefined),
  );

  async function pick() {
    const dir = await api.pickFolder(t('form.pickTitle'), root.trim() || null).catch(() => null);
    if (!dir) return;
    root = dir;
    serverError = serverError?.field === 'root' ? null : serverError;
    if (!name.trim()) name = dir.split(/[\\/]/).filter(Boolean).pop() ?? '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    submitted = true;
    serverError = null;
    if (localNameError() || localRootError()) return;
    saving = true;
    const input = { name: name.trim(), root: root.trim(), enabled, advertise };
    try {
      if (initial) await api.updateProject(initial.name, input);
      else await api.addProject(input);
      toast('ok', t(initial ? 'form.saved' : 'form.created', { name: input.name }));
      ondone(input.name);
    } catch (err) {
      if (isAppError(err) && err.field) serverError = { field: err.field, text: errorText(err) };
      else toast('danger', errorText(err));
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!initial) return;
    deleting = true;
    const ok = await attempt(() => api.removeProject(initial.name), ['form.deleted', { name: initial.name }]);
    deleting = false;
    confirmDelete = false;
    if (ok) ondone(null);
  }
</script>

<form class="form" onsubmit={submit} novalidate>
  <Card>
    <div class="fields">
      <Input
        label={t('form.name')}
        bind:value={name}
        placeholder={t('form.namePlaceholder')}
        hint={t('form.nameHint')}
        error={nameError}
        oninput={() => serverError?.field === 'name' && (serverError = null)}
        maxlength={80}
        autocomplete="off"
        spellcheck={false}
        name="name"
      />
      <div class="folder">
        <Input
          label={t('form.folder')}
          bind:value={root}
          placeholder={t('form.folderPlaceholder')}
          hint={t('form.folderHint')}
          error={rootError}
          oninput={() => serverError?.field === 'root' && (serverError = null)}
          icon="folder"
          mono
          spellcheck={false}
          name="root"
          class="grow"
        />
        <Button icon="folder-open" onclick={pick} class="pick">{t('form.pickFolder')}</Button>
      </div>
      <div class="switches">
        <Switch bind:checked={enabled} label={t('form.enabled')} description={t('form.enabledHint')} />
        <Switch bind:checked={advertise} label={t('form.advertise')} description={t('form.advertiseHint')} />
      </div>
    </div>
    {#snippet footer()}
      {#if !editing}<Button onclick={oncancel}>{t('form.cancel')}</Button>{/if}
      <Button variant="primary" type="submit" loading={saving} icon={editing ? 'check' : 'plus'}>
        {editing ? t('form.save') : t('form.create')}
      </Button>
    {/snippet}
  </Card>
</form>

{#if initial}
  <section class="danger">
    <div class="danger-text">
      <h2>{t('form.deleteTitle')}</h2>
      <p>{t('form.deleteText')}</p>
    </div>
    <Button variant="danger" icon="trash-2" onclick={() => (confirmDelete = true)}>{t('form.delete')}</Button>
  </section>

  <Dialog bind:open={confirmDelete} title={t('form.deleteConfirm', { name: initial.name })} size="sm" closeLabel={t('toast.close')}>
    <p class="confirm-text">{t('form.deleteText')}</p>
    {#snippet footer()}
      <Button onclick={() => (confirmDelete = false)}>{t('form.cancel')}</Button>
      <Button variant="danger" loading={deleting} onclick={remove}>{t('form.delete')}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .form {
    max-width: 680px;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-5);
  }

  .folder {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
  }

  .folder :global(.grow) {
    flex: 1;
    min-width: 0;
  }

  /* Lines the button up with the input box, below the field label. */
  .folder :global(.pick) {
    flex: none;
    margin-top: calc(var(--lc-text-sm) * var(--lc-leading) + var(--lc-space-1));
  }

  .switches {
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-4);
    padding-top: var(--lc-space-4);
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .danger {
    display: flex;
    align-items: center;
    gap: var(--lc-space-4);
    max-width: 680px;
    margin-top: var(--lc-space-5);
    padding: var(--lc-space-4);
    border: var(--lc-border-width) solid color-mix(in srgb, var(--lc-danger) 35%, var(--lc-border));
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
  }

  .danger-text {
    flex: 1;
    min-width: 0;
  }

  h2 {
    font-size: var(--lc-text-md);
    font-weight: var(--lc-weight-strong);
  }

  .confirm-text {
    color: var(--lc-muted);
  }

  .danger-text p {
    margin-top: var(--lc-space-0);
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }
</style>
