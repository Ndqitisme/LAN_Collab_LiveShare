'use strict';

// The copyable "Chẩn đoán kết nối" report: software versions, OS, IPv4 interfaces, the folder's hub and every step
// result. The member sends it to the LAN Hub administrator, so the token and any invite code become ***.
const { t } = require('../../../lib/i18n');
const { STEPS } = require('../../../lib/diagnostics');

function stepTitle(step) {
  switch (step) {
    case 'config': return t('diag.step.config');
    case 'addresses': return t('diag.step.addresses');
    case 'discovery': return t('diag.step.discovery');
    case 'network': return t('diag.step.network');
    case 'tls': return t('diag.step.tls');
    case 'handshake': return t('diag.step.handshake');
    case 'folder': return t('diag.step.folder');
    default: return t('diag.step.rtt');
  }
}

function statusLabel(status) {
  switch (status) {
    case 'ok': return t('diag.status.ok');
    case 'fixed': return t('diag.status.fixed');
    case 'failed': return t('diag.status.failed');
    default: return t('diag.status.skipped');
  }
}

// Codes pasted from chat wrap: a code may hold line breaks, or their JSON escape once inside step data.
const INVITE = /LC3?-(?:[A-Za-z0-9_-]|\r?\n|\\[rn])+/g;

// Every invite code, then every secret as written and as it appears inside JSON (escaped quotes or backslashes).
function redact(text, secrets) {
  let out = text.replace(INVITE, '***');
  for (const secret of secrets) {
    if (!secret) continue;
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) out = out.split(form).join('***');
  }
  return out;
}

// info: {time, extensionVersion, vscodeVersion, nodeVersion, os, interfaces: [{name, address, netmask}]}.
// target: as lib/diagnostics.js runChecks takes it. results: what runChecks yielded.
function buildReport({ info, target, results }) {
  const lines = [
    t('diag.report.title'),
    t('diag.report.time', { time: info.time }),
    t('diag.report.software', { extension: info.extensionVersion, vscode: info.vscodeVersion, node: info.nodeVersion }),
    t('diag.report.os', { os: info.os }),
    t('diag.report.interfaces'),
    ...(info.interfaces.length ? info.interfaces.map((a) => `  ${a.name}: ${a.address}/${a.netmask}`) : [`  ${t('diag.report.noInterfaces')}`]),
  ];
  if (target && target.folder) lines.push(t('diag.report.folder', { path: target.folder }));
  if (target && target.project) {
    const addresses = [...new Set([target.lastGood, ...(target.addresses || [])].filter(Boolean))].join(', ');
    lines.push(
      t('diag.report.hub', { project: target.project, port: target.port, addresses }),
      target.instanceId ? t('diag.report.instance', { instanceId: target.instanceId }) : t('diag.report.noInstance'),
      target.tlsFingerprint ? t('diag.report.fingerprint', { fingerprint: target.tlsFingerprint }) : t('diag.report.noTls'),
    );
  }
  lines.push('', t('diag.report.steps'));
  for (const r of results) {
    lines.push(`${STEPS.indexOf(r.step) + 1}. ${stepTitle(r.step)}: ${statusLabel(r.status)}`);
    if (r.remedy) lines.push(`   ${r.remedy.text}`);
    if (r.code || Object.keys(r.data).length) lines.push(`   ${t('diag.report.detail', { detail: JSON.stringify({ code: r.code, ...r.data }) })}`);
  }
  return redact(lines.join('\n'), [target && target.token]);
}

module.exports = { stepTitle, statusLabel, redact, buildReport };
