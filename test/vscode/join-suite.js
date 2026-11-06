'use strict';

// A newcomer opens an empty folder, runs "Tham gia bằng mã" with the invite code and must end up with
// exactly the hub's files, connected and ready to edit.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(`Hết giờ chờ: ${what}`);
}

function listFiles(root, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.name === '.lan-collab') continue;
    if (d.isDirectory()) out.push(...listFiles(root, r));
    else out.push(r);
  }
  return out.sort();
}

exports.run = async function run() {
  const api = await vscode.extensions.getExtension('ndqitisme.lan-collab').activate();
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  if (api.core()) throw new Error('chưa nhập mã mà đã kết nối');

  await vscode.commands.executeCommand('lanCollab.join', process.env.LC_INVITE);
  await waitFor(() => api.core() && api.core().ready && api.core().loading.size === 0, 20000, 'tham gia + tải xong');

  const hubRoot = process.env.LC_HUB_ROOT;
  const want = listFiles(hubRoot);
  const got = listFiles(folder);
  const problems = [];
  if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`danh sách file khác hub:\n    hub=${want}\n    máy=${got}`);
  for (const rel of want) {
    if (got.includes(rel) && !fs.readFileSync(path.join(hubRoot, rel)).equals(fs.readFileSync(path.join(folder, rel)))) problems.push(`${rel}: nội dung khác hub`);
  }

  // Bad codes are refused before anything happens.
  const before = listFiles(folder).length;
  await vscode.commands.executeCommand('lanCollab.disconnect');
  await vscode.commands.executeCommand('lanCollab.join', 'LC-AQoAAAEAAQAAWA');
  await sleep(500);
  if (api.core()) problems.push('mã sai mà vẫn kết nối');
  if (listFiles(folder).length !== before) problems.push('mã sai mà file thay đổi');

  if (problems.length) throw new Error(`\n  ${problems.join('\n  ')}`);
  console.log(`[join-suite] OK: ${got.length} file tải về từ mã mời`);
};
