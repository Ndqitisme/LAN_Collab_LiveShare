<script lang="ts">
  import { Avatar, Button, Icon, IconButton, Tabs, Textarea, Tooltip } from '@lan-collab/ui-kit';
  import { tick } from 'svelte';
  import { post, loadState, saveState } from '../shared/host';
  import { t } from '../shared/catalog.svelte';
  import { EMOJI, RECENT_MAX } from './emoji';
  import { formatSize } from './format';
  import { prepareImage, type Attachment } from './images';
  import type { Person } from './model';

  let { connected, users }: { connected: boolean; users: Person[] } = $props();

  interface Saved {
    draft: string;
    recent: string[];
  }

  const MAX_LENGTH = 4000;
  const COUNT_FROM = 3500;
  const INPUT_ID = 'chat-input';
  const saved = loadState<Saved>();

  let value = $state(typeof saved.draft === 'string' ? saved.draft : '');
  let recent = $state<string[]>(Array.isArray(saved.recent) ? saved.recent : []);
  let attachment = $state<Attachment | null>(null);
  let sending = $state(false);
  let noticeText = $state('');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  let suggestions = $state<{ name: string; color?: string; note?: string }[]>([]);
  let active = $state(0);
  let emojiOpen = $state(false);
  let emojiTab = $state(saved.recent?.length ? 'recent' : EMOJI[0].id);
  let fileInput: HTMLInputElement | undefined = $state();
  let emojiButton: HTMLElement | undefined = $state();
  let emojiBox: HTMLElement | undefined = $state();

  const input = () => document.getElementById(INPUT_ID) as HTMLTextAreaElement | null;
  const empty = $derived(!value.trim() && !attachment);
  const disabled = $derived(sending || !connected || empty);
  const sendHint = $derived(
    !connected ? t('chat.send.offline') : sending ? t('chat.send.sending') : empty ? t('chat.send.empty') : t('chat.composer.sendTitle'),
  );
  const emojiTabs = $derived([
    ...(recent.length ? [{ id: 'recent', label: t('chat.emoji.recent') }] : []),
    ...EMOJI.map((g) => ({ id: g.id, label: g.label() })),
  ]);
  const emojiItems = $derived(emojiTab === 'recent' ? recent : (EMOJI.find((g) => g.id === emojiTab) ?? EMOJI[0]).items);

  $effect(() => {
    const el = input();
    if (el) el.maxLength = MAX_LENGTH;
  });

  function save() {
    saveState<Saved>({ draft: value, recent: $state.snapshot(recent) });
  }

  export function notice(text: string) {
    noticeText = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (noticeText = ''), 6000);
  }

  export function insert(text: string) {
    const el = input();
    const s = el ? el.selectionStart : value.length;
    const e = el ? el.selectionEnd : value.length;
    value = value.slice(0, s) + text + value.slice(e);
    changed();
    tick().then(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = s + text.length;
    });
  }

  export function sendResult(ok: boolean, reason?: string) {
    sending = false;
    if (ok) {
      value = '';
      attachment = null;
      changed();
    } else {
      notice(reason || t('chat.send.failed'));
    }
  }

  function changed() {
    save();
    suggest();
  }

  function send() {
    if (disabled) return;
    sending = true;
    const a = attachment;
    post({ type: 'send', text: value.trim(), image: a && { mime: a.mime, b64: a.b64, w: a.w, h: a.h } });
  }

  async function attach(file: File | null) {
    if (!file) return;
    try {
      attachment = await prepareImage(file);
    } catch (e) {
      notice(e instanceof Error && e.message ? e.message : t('chat.image.unreadable'));
      return;
    }
    input()?.focus();
  }

  // ---------------------------------------------------------------- @-mentions

  function mentionQuery(): { q: string; start: number } | null {
    const el = input();
    const before = value.slice(0, el ? el.selectionStart : value.length);
    const m = /(^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(before);
    return m ? { q: m[2].toLowerCase(), start: before.length - m[2].length - 1 } : null;
  }

  function suggest() {
    const mq = mentionQuery();
    const all = [...users.map((u) => ({ name: u.name, color: u.color })), { name: 'all', note: t('chat.suggest.all') }];
    suggestions = mq ? all.filter((o) => o.name.toLowerCase().includes(mq.q)).slice(0, 8) : [];
    active = Math.min(active, Math.max(0, suggestions.length - 1));
  }

  function pick(k: number) {
    const mq = mentionQuery();
    const el = input();
    if (!mq || !el) return;
    const name = suggestions[k].name;
    const end = el.selectionStart;
    value = value.slice(0, mq.start) + '@' + name + ' ' + value.slice(end);
    suggestions = [];
    save();
    const caret = mq.start + name.length + 2;
    tick().then(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = caret;
    });
  }

  function onkeydown(e: KeyboardEvent) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length;
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
        e.preventDefault();
        pick(active);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        suggestions = [];
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function onpaste(e: ClipboardEvent) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    attach(item.getAsFile());
  }

  function ondrop(e: DragEvent) {
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    attach(file);
  }

  // ---------------------------------------------------------------- emoji

  async function toggleEmoji(e: MouseEvent) {
    e.stopPropagation();
    emojiOpen = !emojiOpen;
    if (!emojiOpen) return;
    // A keyboard press (detail 0) moves focus into the picker so Tab and arrows reach the emoji.
    if (e.detail === 0) {
      await tick();
      emojiBox?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    }
  }

  function closeEmoji(refocus: boolean) {
    if (!emojiOpen) return;
    emojiOpen = false;
    if (refocus) emojiButton?.querySelector('button')?.focus();
  }

  function pickEmoji(e: MouseEvent, em: string) {
    insert(em);
    recent = [em, ...recent.filter((x) => x !== em)].slice(0, RECENT_MAX);
    save();
    if (!e.shiftKey) closeEmoji(false);
  }

  function ondocclick(e: MouseEvent) {
    // composedPath, not contains(): a tab click re-renders the tabs, so its target can leave the box.
    if (emojiOpen && emojiBox && !e.composedPath().includes(emojiBox)) closeEmoji(false);
  }

  function ondockeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeEmoji(true);
  }
</script>

<svelte:document onclick={ondocclick} onkeydown={ondockeydown} ondragover={(e) => e.preventDefault()} {ondrop} />

<footer class="composer">
  {#if noticeText}
    <div class="notice" role="status">
      <Icon name="triangle-alert" size={14} />
      <span>{noticeText}</span>
    </div>
  {/if}

  {#if attachment}
    <div class="attach">
      <img src={attachment.src} alt="" />
      <span class="info">{attachment.w}×{attachment.h} · {formatSize(attachment.size)}</span>
      <IconButton icon="x" size="sm" label={t('chat.attach.remove')} onclick={() => (attachment = null)} />
    </div>
  {/if}

  {#if suggestions.length}
    <div class="popup suggest" role="listbox" id="chat-suggest" aria-label={t('chat.suggest.label')}>
      {#each suggestions as o, k (o.name)}
        <div
          id="chat-suggest-{k}"
          class="opt"
          class:active={k === active}
          role="option"
          tabindex="-1"
          aria-selected={k === active}
          onmousedown={(e) => {
            e.preventDefault();
            pick(k);
          }}
        >
          <Avatar name={o.name} color={o.color} size="sm" title="" />
          <span class="name">{o.name}</span>
          {#if o.note}<span class="note">{o.note}</span>{/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if emojiOpen}
    <div class="popup emoji" bind:this={emojiBox} role="dialog" aria-label={t('chat.composer.emoji')}>
      <Tabs items={emojiTabs} bind:value={emojiTab} variant="pill" label={t('chat.composer.emoji')} />
      <div class="grid">
        {#each emojiItems as em (em)}
          <button type="button" class="em" onclick={(e) => pickEmoji(e, em)}>{em}</button>
        {/each}
      </div>
      <p class="hint">{t('chat.emoji.keepOpen')}</p>
    </div>
  {/if}

  <Textarea
    id={INPUT_ID}
    bind:value
    rows={1}
    maxRows={6}
    autoresize
    placeholder={t('chat.composer.placeholder')}
    aria-label={t('chat.composer.label')}
    aria-autocomplete="list"
    aria-controls={suggestions.length ? 'chat-suggest' : undefined}
    aria-activedescendant={suggestions.length ? `chat-suggest-${active}` : undefined}
    oninput={(e) => {
      value = e.currentTarget.value;
      changed();
    }}
    onclick={suggest}
    onblur={() => setTimeout(() => (suggestions = []), 100)}
    {onkeydown}
    {onpaste}
  />

  <div class="tools">
    <span bind:this={emojiButton} class="slot">
      <IconButton icon="smile" label={t('chat.composer.emoji')} pressed={emojiOpen} onclick={toggleEmoji} />
    </span>
    <IconButton icon="image" label={t('chat.composer.image')} onclick={() => fileInput?.click()} />
    <IconButton icon="map-pin" label={t('chat.composer.location')} onclick={() => post({ type: 'location' })} />
    <span class="grow"></span>
    {#if value.length > COUNT_FROM}<span class="count">{value.length}/{MAX_LENGTH}</span>{/if}
    <Tooltip text={sendHint} align="end">
      <Button variant="primary" size="sm" icon="send" {disabled} aria-label={t('chat.composer.send')} onclick={send}
        >{t('chat.composer.send')}</Button
      >
    </Tooltip>
  </div>
  <input
    bind:this={fileInput}
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp"
    hidden
    onchange={() => {
      const f = fileInput?.files?.[0] ?? null;
      if (fileInput) fileInput.value = '';
      attach(f);
    }}
  />
</footer>

<style>
  .composer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--lc-space-2);
    padding: var(--lc-space-2) var(--lc-space-3) var(--lc-space-3);
    border-top: var(--lc-border-width) solid var(--lc-border);
  }

  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
    padding: var(--lc-space-1) var(--lc-space-2);
    border: var(--lc-border-width) solid color-mix(in srgb, var(--lc-warn) 45%, transparent);
    border-radius: var(--lc-radius-md);
    background: var(--lc-warn-soft);
    font-size: var(--lc-text-sm);
  }

  .notice :global(.lc-icon) {
    margin-top: 2px;
    color: var(--lc-warn);
  }

  .attach {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    padding: var(--lc-space-1);
    border: var(--lc-border-width) solid var(--lc-border);
    border-radius: var(--lc-radius-md);
    background: var(--lc-surface);
  }

  .attach img {
    width: 44px;
    height: 44px;
    border-radius: var(--lc-radius-sm);
    object-fit: cover;
  }

  .info {
    flex: 1;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
    font-variant-numeric: tabular-nums;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: var(--lc-space-0);
  }

  .slot {
    display: inline-flex;
  }

  /* Toolbar icons sit borderless like VS Code's own; high contrast keeps the kit's contrast border. */
  :global(body:not(.vscode-high-contrast):not(.vscode-high-contrast-light)) .tools :global(.lc-icon-button.ghost) {
    border-color: transparent;
  }

  .grow {
    flex: 1;
  }

  .count {
    margin-right: var(--lc-space-2);
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
    font-variant-numeric: tabular-nums;
  }

  .popup {
    position: absolute;
    right: var(--lc-space-3);
    bottom: calc(100% - var(--lc-space-1));
    left: var(--lc-space-3);
    z-index: var(--lc-z-tooltip);
    border: var(--lc-border-width) solid var(--lc-border-strong);
    border-radius: var(--lc-radius-lg);
    background: var(--lc-surface);
    box-shadow: var(--lc-shadow-lg);
  }

  .suggest {
    max-height: 220px;
    padding: var(--lc-space-1);
    overflow-y: auto;
  }

  .opt {
    display: flex;
    align-items: center;
    gap: var(--lc-space-2);
    padding: var(--lc-space-1) var(--lc-space-2);
    border: var(--lc-border-width) solid transparent;
    border-radius: var(--lc-radius-sm);
    cursor: pointer;
  }

  .opt:hover {
    background: var(--lc-hover);
  }

  .opt.active {
    border-color: var(--lc-list-active-border);
    background: var(--lc-list-active);
    color: var(--lc-list-active-fg);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    margin-left: auto;
    color: var(--lc-muted);
    font-size: var(--lc-text-sm);
  }

  .opt.active .note {
    color: inherit;
    opacity: 0.8;
  }

  .emoji {
    padding: var(--lc-space-2);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
    max-height: min(190px, 40vh);
    margin-top: var(--lc-space-2);
    overflow-y: auto;
  }

  .em {
    height: 32px;
    padding: 0;
    border: var(--lc-border-width) solid transparent;
    border-radius: var(--lc-radius-sm);
    background: none;
    font-size: 19px;
    line-height: 1;
    cursor: pointer;
    transition: background-color var(--lc-dur-fast) var(--lc-ease);
  }

  .em:hover {
    border-color: var(--lc-control-border);
    background: var(--lc-hover);
  }

  .hint {
    margin: var(--lc-space-1) 0 0;
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
  }

  .em:focus-visible {
    outline-offset: -2px;
  }
</style>
