import '@lan-collab/ui-kit/vscode.css';
import { mount, type Component } from 'svelte';

// The host page (extension/src/views/webview-host.js) holds an empty #app and nothing inline,
// so the strict CSP needs no 'unsafe-inline': Svelte sets dynamic styles through the CSSOM.
export function mountView(App: Component): void {
  const target = document.getElementById('app');
  if (!target) throw new Error('webview page has no #app');
  mount(App, { target });
}
