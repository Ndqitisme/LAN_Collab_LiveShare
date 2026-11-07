'use strict';

// What a member does with one edit run from "Lịch sử chỉnh sửa": open the file after the run beside the current
// editor, compare it, copy it, undo the run, or bring back a deleted file or a stored version of a binary file.
// Each command takes a run id from the view (docs/protocol.md section 12.8).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { t } = require('../../../lib/i18n');
const C = require('../../../lib/common');
const { diff } = require('../../../lib/ot');
const { revertRun, bufferOf } = require('../../../lib/history-client');
const { SCHEME, HistoryDocuments, runUri } = require('./provider');

// An op of this file still waiting for its ack holds the revert back; on a LAN that lasts milliseconds.
const REVERT_WAIT_MS = 5000;

class Refusal extends Error {}

function registerHistory(app) {
  const docs = new HistoryDocuments(app);
  const cmd = (id, fn) => vscode.commands.registerCommand(id, async (arg) => {
    const history = app.history;
    if (!history || !history.available()) {
      vscode.window.showWarningMessage(app.controller.core ? t('history.unavailable') : t('connect.notConnected'));
      return;
    }
    const runId = arg && typeof arg === 'object' ? arg.id : arg;
    const listed = typeof runId === 'string' ? history.run(runId) : null;
    if (!listed || !C.safeRel(listed.path)) {
      vscode.window.showWarningMessage(t('history.runGone'));
      return;
    }
    let run = listed;
    try {
      // An open run ends at today's text, which is only true while it is still open: a record listed earlier may
      // have ended since, and undoing it up to today's text would take later edits by others with it.
      if (run.open) {
        await history.list(run.path);
        run = history.run(run.id);
      }
      await fn(app, docs, run);
    } catch (err) {
      if (err instanceof Refusal) {
        vscode.window.showWarningMessage(err.message);
        return;
      }
      app.log(`[LỖI] ${id} ${run.path} lượt ${run.id}: ${err.stack || err}`);
      vscode.window.showErrorMessage(t('history.loadFailed'));
    }
  });
  app.context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, docs),
    vscode.commands.registerCommand('lanCollab.showHistory', () => vscode.commands.executeCommand('lanCollab.history.focus')),
    cmd('lanCollab.history.openAfter', openAfter),
    cmd('lanCollab.history.diffCurrent', diffCurrent),
    cmd('lanCollab.history.diffBefore', diffBefore),
    cmd('lanCollab.history.copy', copy),
    cmd('lanCollab.history.revert', revert),
    cmd('lanCollab.history.restoreFile', restoreFile),
    cmd('lanCollab.history.restoreVersion', restoreVersion),
  );
}

async function content(app, hash) {
  const c = hash ? await app.history.blob(hash) : null;
  if (!c) throw new Refusal(t('history.blobMissing'));
  return c;
}

// The text of a file at a run boundary. An open run has no end stored yet: it ends at today's text.
async function textAt(app, run, side) {
  const hash = side === 'start' ? run.start_blob : run.end_blob;
  if (side === 'end' && !hash) return currentEntry(app, run).text;
  const c = await content(app, hash);
  return c.kind === 'text' ? c.text : Buffer.from(c.b64, 'base64').toString('utf8');
}

function currentEntry(app, run) {
  const core = app.controller.core;
  const e = core && core.entries.get(run.path);
  if (!e || e.kind !== 'text') throw new Refusal(t('history.fileGone', { file: run.path }));
  return e;
}

function runTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${time} ${d.toLocaleDateString('vi-VN')}`;
}

async function openAfter(app, docs, run) {
  const source = vscode.window.activeTextEditor || app.lastEditor;
  const doc = await vscode.workspace.openTextDocument(runUri(run, 'end'));
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  // Start at the lines the member is reading in that file, so both sides line up.
  const core = app.controller.core;
  if (source && !source.document.isClosed && source.document.uri.scheme === 'file' && core && core.relOf(source.document.uri.fsPath) === run.path && source.visibleRanges[0]) {
    editor.revealRange(source.visibleRanges[0], vscode.TextEditorRevealType.AtTop);
  }
}

async function diffCurrent(app, docs, run) {
  const abs = app.controller.core.abs(run.path);
  if (!fs.existsSync(abs)) throw new Refusal(t('history.fileGone', { file: run.path }));
  const title = t('history.diff.current.title', { file: path.posix.basename(run.path), author: run.author_name });
  await vscode.commands.executeCommand('vscode.diff', runUri(run, 'end'), vscode.Uri.file(abs), title, { preview: true });
}

async function diffBefore(app, docs, run) {
  const title = t('history.diff.before.title', { file: path.posix.basename(run.path), author: run.author_name, time: runTime(run.started_at) });
  await vscode.commands.executeCommand('vscode.diff', runUri(run, 'start'), runUri(run, 'end'), title, { preview: true });
}

async function copy(app, docs, run) {
  const text = await textAt(app, run, 'end');
  await vscode.env.clipboard.writeText(text.replace(/^﻿/, ''));
  vscode.window.showInformationMessage(t('history.copied', { file: run.path, author: run.author_name }));
}

// Three-way merge (lib/history-client.js revertRun), shown as a diff of today's text against the result, applied as
// one local edit with src "revert" after the member confirms. The merge runs again on the text of that moment.
async function revert(app, docs, run) {
  const [start, end] = await Promise.all([textAt(app, run, 'start'), textAt(app, run, 'end')]);
  const current = currentEntry(app, run).text;
  const planned = revertRun(start, end, current);
  if (planned.text === current) {
    vscode.window.showInformationMessage(planned.conflicts ? t('history.revert.allConflicts') : t('history.revert.nothing'));
    return;
  }
  const file = path.posix.basename(run.path);
  const left = docs.previewUri(run.path, current.replace(/^﻿/, ''));
  const right = docs.previewUri(run.path, planned.text.replace(/^﻿/, ''));
  await vscode.commands.executeCommand('vscode.diff', left, right, t('history.preview.title', { file, author: run.author_name }), { preview: false });
  const confirm = t('history.action.revert');
  const detail = planned.conflicts ? t('history.revert.detail.conflicts', { count: planned.conflicts }) : t('history.revert.detail');
  const pick = await vscode.window.showWarningMessage(t('history.revert.confirm', { author: run.author_name, file: run.path }), { modal: true, detail }, confirm);
  await closeDiffs(left, right);
  docs.dropPreviews(left, right);
  if (pick !== confirm) return;

  let status;
  for (const deadline = Date.now() + REVERT_WAIT_MS; ;) {
    const core = app.controller.core;
    status = core ? core.revertEdit(run.path, (text) => diff(text, revertRun(start, end, text).text), run.id) : 'unavailable';
    if (status !== 'busy' || Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  app.log(`Hoàn tác lượt ${run.id} của ${run.author_name} trong ${run.path}: ${status}`);
  if (status === 'applied') vscode.window.showInformationMessage(t('history.revert.done', { author: run.author_name, file: run.path }));
  else if (status === 'noop') vscode.window.showInformationMessage(t('history.revert.nothing'));
  else vscode.window.showErrorMessage(t('history.revert.failed', { file: run.path }));
}

async function closeDiffs(...uris) {
  const keys = new Set(uris.map((u) => u.toString()));
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputTextDiff && (keys.has(tab.input.original.toString()) || keys.has(tab.input.modified.toString())));
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

// A deletion run keeps the deleted content as its end; the file is created again through the normal create path.
async function restoreFile(app, docs, run) {
  const core = app.controller.core;
  const abs = core.abs(run.path);
  if (core.entries.has(run.path) || fs.existsSync(abs)) throw new Refusal(t('history.restoreFile.exists', { file: run.path }));
  const buf = bufferOf(await content(app, run.end_blob));
  if (!core.writeFileVersion(run.path, buf)) throw new Refusal(t('history.restore.failed', { file: run.path }));
  app.log(`Khôi phục ${run.path} từ lượt ${run.id}`);
  const open = t('history.button.openFile');
  const pick = await vscode.window.showInformationMessage(t('history.restoreFile.done', { file: run.path }), ...(run.kind === 'text' ? [open] : []));
  if (pick === open) await vscode.window.showTextDocument(vscode.Uri.file(abs));
}

// Binary files have no text to merge: the version a run stored replaces the file, as a new run.
async function restoreVersion(app, docs, run) {
  const time = runTime(run.ended_at);
  const confirm = t('history.action.restoreVersion');
  const pick = await vscode.window.showWarningMessage(t('history.restoreVersion.confirm', { file: run.path, time }), { modal: true, detail: t('history.restoreVersion.detail') }, confirm);
  if (pick !== confirm) return;
  const buf = bufferOf(await content(app, run.end_blob));
  if (!app.controller.core.writeFileVersion(run.path, buf)) throw new Refusal(t('history.restore.failed', { file: run.path }));
  app.log(`Khôi phục phiên bản ${run.end_blob} của ${run.path} từ lượt ${run.id}`);
  vscode.window.showInformationMessage(t('history.restoreVersion.done', { file: run.path, time }));
}

module.exports = { registerHistory };
