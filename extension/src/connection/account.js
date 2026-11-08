'use strict';

const vscode = require('vscode');
const { t } = require('../../../lib/i18n');

// The GitHub or Microsoft account already signed in to VS Code (as Live Share shows). Only the account name is
// used — authentication.getAccounts lists signed-in accounts without asking for a token, whereas getSession only
// finds a session whose scopes match exactly and otherwise starts a new browser sign-in.
const PROVIDERS = [
  { id: 'github', label: '$(github) GitHub', scopes: ['read:user'] },
  { id: 'microsoft', label: '$(account) Microsoft', scopes: ['openid', 'profile', 'email', 'offline_access'] },
];

async function signedInAccounts() {
  const out = [];
  for (const p of PROVIDERS) {
    try {
      for (const a of await vscode.authentication.getAccounts(p.id)) out.push({ provider: p.id, label: a.label });
    } catch {
      // provider not installed / not available
    }
  }
  return out;
}

function providerName(id) {
  return id === 'github' ? 'GitHub' : 'Microsoft';
}

async function getAccount(app, interactive) {
  const chosen = app.context.globalState.get('lanCollab.account');
  const accounts = await signedInAccounts();
  const same = (a) => chosen && a.provider === chosen.provider && a.label === chosen.label;
  if (!interactive) return accounts.find(same) || accounts[0] || null;

  const items = accounts.map((a) => ({
    label: `${a.provider === 'github' ? '$(github)' : '$(account)'} ${a.label}`,
    description: same(a) ? t('account.pick.current', { provider: a.provider }) : a.provider,
    account: a,
  }));
  for (const p of PROVIDERS) items.push({ label: `$(sign-in) ${t('account.pick.signIn', { provider: providerName(p.id) })}`, provider: p });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('account.pick.placeholder') });
  if (!pick) return null;
  let account = pick.account;
  if (!account) {
    try {
      const s = await vscode.authentication.getSession(pick.provider.id, pick.provider.scopes, { createIfNone: true, clearSessionPreference: true });
      account = { provider: pick.provider.id, label: s.account.label };
    } catch (e) {
      app.log(`Đăng nhập ${pick.provider.id} lỗi: ${e.message}`, 'error');
      const retry = t('action.retry');
      if ((await vscode.window.showErrorMessage(t('account.signInFailed', { provider: providerName(pick.provider.id) }), retry)) === retry) return getAccount(app, true);
      return null;
    }
  }
  await app.context.globalState.update('lanCollab.account', account);
  return account;
}

async function signIn(app) {
  const account = await getAccount(app, true);
  if (!account) return;
  vscode.window.showInformationMessage(t('account.chosen', { account: `${account.provider}:${account.label}` }));
  app.controller.reconnect();
}

module.exports = { getAccount, signIn };
