'use strict';

const vscode = require('vscode');
const { t } = require('../../../lib/i18n');

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

module.exports = { showDownloadProgress };
