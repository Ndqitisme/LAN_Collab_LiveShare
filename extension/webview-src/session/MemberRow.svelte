<script lang="ts">
  import { Avatar, Badge, Icon, IconButton } from '@lan-collab/ui-kit';
  import { t } from '../shared/catalog.svelte';
  import { rttLabel, rttQuality, type Member } from './feed';

  interface Props {
    member: Member;
    self?: boolean;
    following?: boolean;
    ongoto: (id: string) => void;
    onfollow: (id: string | null) => void;
    onopen: (path: string, line: number) => void;
  }

  let { member, self = false, following = false, ongoto, onfollow, onopen }: Props = $props();

  const quality = $derived(rttQuality(member.rtt));
  const qualityText = $derived(rttLabel(member.rtt, t));
  const qualityIcon = $derived(quality === 'good' ? 'signal-high' : quality === 'fair' ? 'signal-medium' : quality === 'poor' ? 'signal-low' : 'signal');
  const slash = $derived(member.file ? member.file.lastIndexOf('/') : -1);
  const base = $derived(member.file ? member.file.slice(slash + 1) : '');
  const dir = $derived(member.file && slash > 0 ? member.file.slice(0, slash) : '');

  function openFile() {
    if (!member.file) return;
    if (self) onopen(member.file, member.line || 1);
    else ongoto(member.id);
  }
</script>

<div class="member" class:self class:following role="listitem" style:--member={member.color ?? undefined}>
  <span class="face"><Avatar name={member.name} color={member.color ?? undefined} title="" /></span>
  <div class="body">
    <div class="head">
      <span class="name" title={member.name}>{member.name}</span>
      {#if self}<Badge tone="accent">{t('session.member.me')}</Badge>{/if}
      {#if member.account}
        <span class="account" title={t('session.member.account', { account: `${member.account.provider}:${member.account.label}` })}>
          <Icon name="shield-check" size={12} label={t('session.member.account', { account: `${member.account.provider}:${member.account.label}` })} />
        </span>
      {/if}
      <span class="quality {quality}" title={qualityText}><Icon name={qualityIcon} size={16} label={qualityText} /></span>
    </div>
    {#if member.file}
      <button type="button" class="file" title={t('session.member.openFile', { file: member.file, line: member.line })} onclick={openFile}>
        <span class="base">{base}</span><span class="line">:{member.line}</span>
        {#if dir}<span class="dir">{dir}</span>{/if}
      </button>
    {:else}
      <span class="nofile">{t('session.member.noFile')}</span>
    {/if}
    {#if member.debug}
      <span class="debug" title={t('session.member.debugging', { target: member.debug })}>
        <Icon name="bug" size={12} /><span>{t('session.member.debugging', { target: member.debug })}</span>
      </span>
    {/if}
    {#if member.status}<span class="status" title={member.status}>{member.status}</span>{/if}
    {#if following}<span class="tag"><Badge tone="accent" variant="outline" icon="eye">{t('session.member.following')}</Badge></span>{/if}
  </div>
  {#if !self}
    <div class="actions">
      <IconButton
        size="sm"
        icon={following ? 'eye-off' : 'eye'}
        variant={following ? 'primary' : 'ghost'}
        pressed={following}
        label={following ? t('session.member.unfollow') : t('session.member.follow')}
        onclick={() => onfollow(following ? null : member.id)}
      />
      <IconButton size="sm" icon="locate-fixed" label={t('session.member.goTo')} disabled={!member.file} onclick={() => ongoto(member.id)} />
    </div>
  {/if}
</div>

<style>
  .member {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--lc-space-2);
    padding: var(--lc-space-2) var(--lc-space-2) var(--lc-space-2) var(--lc-space-3);
    transition: background-color var(--lc-dur-fast) var(--lc-ease);
  }

  .member:hover,
  .member:focus-within {
    background: var(--lc-hover);
  }

  /* A bar in the member's color marks the member being followed; high contrast keeps it as a solid edge. */
  .member.following::before {
    content: '';
    position: absolute;
    inset: var(--lc-space-1) auto var(--lc-space-1) 0;
    width: 3px;
    border-radius: 0 var(--lc-radius-sm) var(--lc-radius-sm) 0;
    background: var(--member, var(--lc-accent));
  }

  .face {
    display: inline-flex;
    flex: none;
    margin-top: 1px;
    border-radius: var(--lc-radius-full);
    box-shadow: 0 0 0 1.5px var(--member, var(--lc-border-strong));
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
    min-width: 0;
    min-height: 20px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--lc-weight-strong);
  }

  .account,
  .quality {
    display: inline-flex;
    flex: none;
    color: var(--lc-muted);
  }

  .quality {
    margin-left: auto;
    padding-left: var(--lc-space-1);
  }

  .quality.good {
    color: var(--lc-ok);
  }

  .quality.fair {
    color: var(--lc-warn);
  }

  .quality.poor {
    color: var(--lc-danger);
  }

  .quality.unknown {
    opacity: 0.4;
  }

  .file {
    display: flex;
    align-items: baseline;
    min-width: 0;
    max-width: 100%;
    margin: 0 0 0 calc(-1 * var(--lc-space-1));
    padding: 0 var(--lc-space-1);
    border: none;
    border-radius: var(--lc-radius-sm);
    background: none;
    color: var(--lc-link);
    font-size: var(--lc-text-sm);
    text-align: left;
    cursor: pointer;
  }

  .file:hover .base {
    text-decoration: underline;
  }

  .base {
    flex: 0 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--lc-font-mono);
  }

  .line {
    flex: none;
    font-family: var(--lc-font-mono);
    font-variant-numeric: tabular-nums;
  }

  .dir {
    flex: 1 1 0;
    min-width: 0;
    margin-left: var(--lc-space-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--lc-muted);
    font-size: var(--lc-text-xs);
  }

  .nofile,
  .debug,
  .status {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--lc-text-sm);
    color: var(--lc-muted);
  }

  .debug {
    display: flex;
    align-items: center;
    gap: var(--lc-space-1);
    color: var(--lc-warn);
  }

  .debug > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .debug :global(.lc-icon) {
    flex: none;
  }

  .status {
    font-style: italic;
    color: var(--lc-fg);
  }

  .status::before {
    content: '“';
  }

  .status::after {
    content: '”';
  }

  .tag {
    display: flex;
    margin-top: var(--lc-space-1);
  }

  .actions {
    display: flex;
    flex: none;
    gap: var(--lc-space-0);
  }
</style>
