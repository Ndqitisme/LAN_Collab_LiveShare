'use strict';

const vscode = require('vscode');
const { t } = require('../../../lib/i18n');

function describe(p, status) {
  const parts = [];
  if (p && p.file) parts.push(`${p.file}:${p.line}`);
  if (p && p.debug) parts.push(t('tree.debugging', { target: p.debug }));
  if (status) parts.push(`“${status}”`);
  return parts.join(' · ');
}

class PeopleTree {
  constructor(app) {
    this.app = app;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.timer = null;
  }

  refresh() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.emitter.fire();
    }, 150);
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(parent) {
    const core = this.app.controller.core;
    const following = this.app.follow.following;
    if (!core) {
      const item = new vscode.TreeItem(t('tree.disconnected'));
      item.iconPath = new vscode.ThemeIcon('plug');
      item.command = { command: 'lanCollab.connect', title: t('command.lanCollab.connect.title') };
      return [item];
    }
    if (parent && parent.contextValue === 'activity') {
      return core.activity.slice(-50).reverse().map((a) => {
        const item = new vscode.TreeItem(`${a.who} ${a.text}`);
        item.description = new Date(a.ts).toLocaleTimeString('vi-VN');
        return item;
      });
    }
    if (parent) return [];
    const items = [];
    const me = new vscode.TreeItem(t('tree.me', { name: core.name }));
    me.description = describe(core.presence, core.status);
    me.tooltip = core.account ? t('tree.account', { account: `${core.account.provider}:${core.account.label}` }) : t('tree.me.noAccount');
    me.iconPath = new vscode.ThemeIcon(core.account && core.account.provider === 'github' ? 'github' : 'account');
    items.push(me);
    for (const u of core.users.values()) {
      const item = new vscode.TreeItem(u.name);
      item.description = describe(u.presence, u.status) || t('tree.member.noFile');
      const acc = u.account ? t('tree.account', { account: `${u.account.provider}:${u.account.label}` }) : t('tree.member.noAccount');
      item.tooltip = [u.id === following ? t('tree.member.following', { name: u.name }) : u.name, acc, t('tree.member.goTo')].join('\n');
      item.iconPath = new vscode.ThemeIcon(u.id === following ? 'eye' : u.account && u.account.provider === 'github' ? 'github' : 'person');
      item.command = { command: 'lanCollab.goTo', title: t('tree.member.goToTitle'), arguments: [u.id] };
      items.push(item);
    }
    const act = new vscode.TreeItem(t('tree.activity'), vscode.TreeItemCollapsibleState.Collapsed);
    act.contextValue = 'activity';
    act.iconPath = new vscode.ThemeIcon('history');
    items.push(act);
    return items;
  }
}

module.exports = { PeopleTree, describe };
