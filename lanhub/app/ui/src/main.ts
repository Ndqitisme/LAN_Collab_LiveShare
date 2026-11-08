import '@lan-collab/ui-kit/app.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { api } from './lib/api';
import { applyTheme, connect } from './lib/state.svelte';

applyTheme();
// The first snapshot is in before the first render, so the window never shows a loading flash.
connect()
  .catch((e) => console.error('status connection failed', e))
  .finally(() => {
    mount(App, { target: document.getElementById('app')! });
    api.uiReady().catch(() => {});
  });
