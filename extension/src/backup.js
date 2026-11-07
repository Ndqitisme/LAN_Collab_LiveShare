'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const C = require('../../lib/common');
const { t } = require('../../lib/i18n');
const config = require('./config');

// Folders lib/client-core.js writes: .lan-collab/backup/<YYYYMMDD-HHMMSS>/<path>. A restore made in the same second
// as an existing folder gets a -<n> suffix.
const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/;

function backupRoot(root) {
  return path.join(root, '.lan-collab', 'backup');
}

function stampTime(name) {
  const m = STAMP.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

// Newest first: [{name, time, files: Map rel -> absolute path}].
function listStamps(root) {
  let names = [];
  try {
    names = fs.readdirSync(backupRoot(root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, time: stampTime(name) }))
    .filter((s) => s.time)
    .map((s) => ({ ...s, files: C.walk(path.join(backupRoot(root), s.name), () => false) }))
    .filter((s) => s.files.size)
    .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
}

const timeLabel = (time) => time.toLocaleString('vi-VN');

// How the backed-up copy compares with the file in the folder now; size first so most files cost a stat.
function compareWithCurrent(src, abs) {
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return t('backup.file.missing');
  }
  if (st.size !== fs.statSync(src).size) return '';
  return fs.readFileSync(src).equals(fs.readFileSync(abs)) ? t('backup.file.same') : '';
}

async function restoreBackup(app) {
  const folder = config.workspaceFolder();
  if (!folder || folder.uri.scheme !== 'file') {
    vscode.window.showWarningMessage(t('connect.noFolder'));
    return;
  }
  const root = folder.uri.fsPath;
  const stamps = listStamps(root);
  if (!stamps.length) {
    vscode.window.showInformationMessage(t('backup.none'));
    return;
  }
  const pickedStamp = await vscode.window.showQuickPick(
    stamps.map((s) => ({ label: `$(history) ${timeLabel(s.time)}`, description: t('backup.stamp.description', { count: s.files.size }), stamp: s })),
    { placeHolder: t('backup.stamp.placeholder') },
  );
  if (!pickedStamp) return;
  const stamp = pickedStamp.stamp;
  const time = timeLabel(stamp.time);
  const rels = [...stamp.files.keys()].sort();
  const pick = await vscode.window.showQuickPick([
    { label: `$(history) ${t('backup.file.all', { count: rels.length })}`, all: true },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    ...rels.map((rel) => ({ label: `$(file) ${rel}`, description: compareWithCurrent(stamp.files.get(rel), path.join(root, rel)), rel })),
  ], { placeHolder: t('backup.file.placeholder', { time }), matchOnDescription: true });
  if (!pick) return;
  const restorer = new Restorer(app, root);
  if (pick.all) {
    const go = await vscode.window.showWarningMessage(t('backup.confirm.all', { count: rels.length, time }), { modal: true, detail: t('backup.confirm.detail') }, t('backup.button.restore'));
    if (!go) return;
    let done = 0;
    for (const rel of rels) if (await restorer.restore(rel, stamp.files.get(rel))) done += 1;
    vscode.window.showInformationMessage(t('backup.restoredAll', { count: done }));
    return;
  }
  fileActions(restorer, pick.rel, stamp.files.get(pick.rel), time);
}

// Compare and restore for one file. The pick stays open while the diff is shown, so the member reads it first.
function fileActions(restorer, rel, src, time) {
  const qp = vscode.window.createQuickPick();
  qp.title = t('backup.action.placeholder', { path: rel, time });
  qp.ignoreFocusOut = true;
  const compare = { label: `$(diff) ${t('backup.action.compare')}` };
  const restore = { label: `$(history) ${t('backup.action.restore')}` };
  qp.items = [compare, restore];
  qp.onDidAccept(async () => {
    const [item] = qp.selectedItems;
    if (item === compare) {
      const abs = path.join(restorer.root, rel);
      const opts = { preview: true, preserveFocus: true };
      if (fs.existsSync(abs)) await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(src), vscode.Uri.file(abs), t('backup.diff.title', { name: path.posix.basename(rel), time }), opts);
      else await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(src), opts);
      return;
    }
    qp.hide();
    if (await restorer.restore(rel, src)) vscode.window.showInformationMessage(t('backup.restored', { path: rel }));
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

// Writes a backed-up file back through the paths a member's own change takes, so it syncs like an edit: an open
// editor gets a whole-document edit and is saved, any other file is written on disk for the watcher. The content
// it replaces goes to a new backup folder first.
class Restorer {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.keepDir = null;
  }

  async restore(rel, src) {
    const abs = path.join(this.root, rel);
    try {
      const data = fs.readFileSync(src);
      let cur = null;
      try {
        cur = fs.readFileSync(abs);
      } catch {
        // not in the folder any more
      }
      if (cur && cur.equals(data)) return true;
      if (cur) this._keep(rel, cur);
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath.toLowerCase() === abs.toLowerCase());
      if (doc && C.classify(data, rel) === 'text') {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), data.toString('utf8').replace(/^﻿/, ''));
        if (!(await vscode.workspace.applyEdit(edit)) || !(await doc.save())) throw new Error('the editor refused the edit or the save');
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, data);
      }
      this.app.log(`Đã khôi phục ${rel} từ ${src}`);
      return true;
    } catch (err) {
      this.app.log(`[LỖI] không khôi phục được ${rel}: ${err.message}`);
      vscode.window.showErrorMessage(t('backup.failed', { path: rel }));
      return false;
    }
  }

  _keep(rel, data) {
    if (!this.keepDir) {
      const base = C.stamp();
      let name = base;
      for (let n = 2; fs.existsSync(path.join(backupRoot(this.root), name)); n++) name = `${base}-${n}`;
      this.keepDir = path.join(backupRoot(this.root), name);
    }
    const dst = path.join(this.keepDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, data);
  }
}

module.exports = { restoreBackup };
