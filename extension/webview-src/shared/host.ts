// The one channel between a webview and its extension host. acquireVsCodeApi may be called only once per page.
const api = acquireVsCodeApi();

export function post(message: { type: string; [key: string]: unknown }): void {
  api.postMessage(message);
}

export function onHostMessage<M extends { type: string }>(handle: (message: M) => void): void {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data && typeof e.data.type === 'string') handle(e.data as M);
  });
}

// Survives hiding the view and reloading the window; VS Code keeps it per view.
export function loadState<S extends object>(): Partial<S> {
  const s = api.getState();
  return s && typeof s === 'object' ? (s as Partial<S>) : {};
}

export function saveState<S extends object>(state: S): void {
  api.setState(state);
}
