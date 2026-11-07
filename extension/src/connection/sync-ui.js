'use strict';

const vscode = require('vscode');
const { t } = require('../../../lib/i18n');

// Returns false (cancel), true (go ahead; conflicting files take the hub's version) or 'local'.
async function confirmSync(folder, info) {
  const lines = [
    t('sync.confirm.title', { folder: folder.name, project: info.project }),
    '',
    t('sync.confirm.get', { get: info.get, overwrite: info.overwrite }),
    t('sync.confirm.upload', { upload: info.upload }),
    t('sync.confirm.remove', { removeLocal: info.removeLocal }),
  ];
  if (info.conflicts.length) {
    const names = info.conflicts.slice(0, 8).join(', ') + (info.conflicts.length > 8 ? ', …' : '');
    lines.push('', t('sync.confirm.conflicts', { count: info.conflicts.length, names }), t('sync.confirm.conflictsHint'));
  }
  lines.push('', t('sync.confirm.backup'));
  const keepLocal = t('sync.button.keepLocal');
  const buttons = info.conflicts.length ? [t('sync.button.useHub'), keepLocal] : [t('sync.button.sync')];
  const pick = await vscode.window.showWarningMessage(lines.join('\n'), { modal: true }, ...buttons);
  if (pick === keepLocal) return 'local';
  return Boolean(pick);
}

// After joining, files keep arriving for a moment: show it, so nobody starts editing a half-downloaded tree.
function showDownloadProgress(controller) {
  const c = controller.core;
  if (!c || c.loading.size < 3) return;
  const total = c.loading.size;
  let skipped = 0;
  const onIgnored = () => {
    skipped += 1;
  };
  c.on('ignored', onIgnored);
  vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('sync.progress.title', { project: c.project }), cancellable: true }, (progress, cancel) => new Promise((resolve) => {
    let shown = 0;
    let timer = null;
    const finish = (message) => {
      clearInterval(timer);
      c.off('ignored', onIgnored);
      if (message) vscode.window.showInformationMessage(message);
      resolve();
    };
    // Closing the notification only hides it; synchronization continues in the background.
    cancel.onCancellationRequested(() => finish(null));
    timer = setInterval(() => {
      const done = total - c.loading.size;
      progress.report({ message: t('sync.progress.count', { done, total }), increment: ((done - shown) / total) * 100 });
      shown = done;
      if (controller.core !== c) finish(null);
      else if (c.loading.size === 0) {
        finish(skipped
          ? t('sync.doneSkipped', { synced: total - skipped, total, skipped })
          : t('sync.done', { total }));
      }
    }, 200);
  }));
}

module.exports = { confirmSync, showDownloadProgress };
