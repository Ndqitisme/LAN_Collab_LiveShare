'use strict';

// "LAN Collab: Chẩn đoán kết nối": runs every step of lib/diagnostics.js for the open folder, shows the report in a
// read-only document and offers to copy it.
const vscode = require('vscode');
const os = require('os');
const { t } = require('../../../lib/i18n');
const { runChecks, STEPS } = require('../../../lib/diagnostics');
const config = require('../config');
const joins = require('./joins');
const { getAccount } = require('./account');
const { buildReport, stepTitle } = require('./report');
const { actionLabel, runAction } = require('./actions');

const SCHEME = 'lancollab-diagnosis';
const EXTENSION_ID = 'ndqitisme.lan-collab';

let reportText = '';
const reportChanged = new vscode.EventEmitter();
const reportProvider = { onDidChange: reportChanged.event, provideTextDocumentContent: () => reportText };

async function diagnosisTarget(app) {
  const folder = config.workspaceFolder();
  if (!folder || folder.uri.scheme !== 'file') return { folder: null };
  const conn = config.connectionFor(app.context, folder);
  if (!conn) return { folder: folder.uri.fsPath };
  const [token, account] = await Promise.all([config.tokenFor(app.context, folder), getAccount(app, false)]);
  const { state, core } = app.controller;
  const rtt = state.name === 'live' && core && core.rtt !== null ? core.rtt : undefined;
  return { ...conn, folder: folder.uri.fsPath, key: config.folderKey(folder.uri), token, account, name: config.displayName(account), rtt };
}

// Resolves {target, results}; onStep sees each result as it arrives. A hub found at a new address by rediscovery
// is stored, as the connection path would. A cancelled token stops before the next step.
async function runDiagnosis(app, onStep = () => {}, token = null) {
  const target = await diagnosisTarget(app);
  const results = [];
  for await (const r of runChecks(target)) {
    if (token && token.isCancellationRequested) break;
    results.push(r);
    if (r.status === 'fixed' && target.source === 'join') await joins.update(app.context.globalState, target.key, { lastGood: r.data.host, port: r.data.port });
    onStep(r);
  }
  app.log(`Chẩn đoán kết nối: ${results.map((r) => `${r.step}=${r.status}${r.code ? `(${r.code})` : ''}`).join(' ')}`);
  return { target, results };
}

function environmentInfo() {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || [])
    .filter((a) => (a.family === 'IPv4' || a.family === 4) && !a.internal)
    .map((a) => ({ name, address: a.address, netmask: a.netmask })));
  return {
    time: new Date().toLocaleString('vi-VN'),
    extensionVersion: ext ? ext.packageJSON.version : '',
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    interfaces,
  };
}

async function copyReport(text) {
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage(t('diag.copied'));
}

async function diagnose(app) {
  const cancelled = Symbol('cancelled');
  const run = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('diag.progress'), cancellable: true }, (progress, token) => Promise.race([
    runDiagnosis(app, (r) => {
      const n = STEPS.indexOf(r.step) + 1;
      if (n < STEPS.length) progress.report({ message: t('diag.progress.step', { n: n + 1, total: STEPS.length, title: stepTitle(STEPS[n]) }) });
    }, token),
    new Promise((resolve) => token.onCancellationRequested(() => resolve(cancelled))),
  ]));
  if (run === cancelled) {
    app.log('Chẩn đoán kết nối: đã huỷ.');
    return;
  }
  const { target, results } = run;
  reportText = buildReport({ info: environmentInfo(), target, results });
  const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${t('diag.document.name')}` });
  reportChanged.fire(uri);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });

  const report = reportText;
  const copy = t('diag.button.copy');
  const failed = results.find((r) => r.status === 'failed');
  const fixed = results.find((r) => r.status === 'fixed');
  if (failed) {
    const ids = failed.remedy.actions.slice(0, 2);
    const labels = ids.map(actionLabel);
    const pick = await vscode.window.showErrorMessage(failed.remedy.text, ...labels, copy);
    if (pick === copy) await copyReport(report);
    else if (pick) runAction(app, ids[labels.indexOf(pick)], { code: failed.code, data: failed.data });
    return;
  }
  const reconnect = t('action.reconnect');
  const offer = fixed && app.controller.state.name !== 'live' ? [reconnect] : [];
  const text = fixed ? t('diag.done.fixed', { host: fixed.data.host, port: fixed.data.port }) : t('diag.done.ok');
  const pick = await vscode.window.showInformationMessage(text, ...offer, copy);
  if (pick === copy) await copyReport(report);
  else if (pick === reconnect) app.controller.reconnect();
}

function registerDiagnose(app) {
  app.context.subscriptions.push(
    reportChanged,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, reportProvider),
    vscode.commands.registerCommand('lanCollab.diagnose', () => diagnose(app)),
  );
}

module.exports = { registerDiagnose, runDiagnosis, environmentInfo };
