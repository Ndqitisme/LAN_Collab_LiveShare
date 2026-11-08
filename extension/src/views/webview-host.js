'use strict';

const vscode = require('vscode');
const crypto = require('crypto');

// Every webview loads the bundle that extension/webview-src/build.mjs writes to extension/webview/dist/<view>/.
function distRoot(extensionUri) {
  return vscode.Uri.joinPath(extensionUri, 'extension', 'webview', 'dist');
}

function webviewOptions(extensionUri) {
  return { enableScripts: true, localResourceRoots: [distRoot(extensionUri)] };
}

// The page holds no inline script or style: the bundle mounts into #app, and the kit's CSS comes in the
// bundle's stylesheet. Captions arrive later in the view's init message.
function webviewHtml(webview, extensionUri, view, { bodyClass = 'lc-sidebar' } = {}) {
  const dir = vscode.Uri.joinPath(distRoot(extensionUri), view);
  const css = webview.asWebviewUri(vscode.Uri.joinPath(dir, 'index.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(dir, 'index.js'));
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = `default-src 'none'; img-src data: ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head>
<body class="${bodyClass}">
<div id="app"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

module.exports = { webviewOptions, webviewHtml };
