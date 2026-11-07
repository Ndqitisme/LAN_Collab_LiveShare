import { mount } from 'svelte';
import tokens from '../src/tokens.css?inline';
import themeApp from '../src/theme-app.css?inline';
import themeVscode from '../src/theme-vscode.css?inline';
import base from '../src/base.css?inline';
import galleryCss from './gallery.css?inline';
import App from './App.svelte';
import { vscodeDark, vscodeHighContrast } from './vscode-vars';
import { themes, type GalleryTheme } from './themes';

const requested = new URLSearchParams(location.search).get('theme');
const theme: GalleryTheme = themes.find((t) => t.id === requested)?.id ?? 'light';
const isVscode = theme.startsWith('vscode');

// A webview gets its variables on <html> and a theme class on <body>; the
// VS Code variants reproduce that so theme-vscode.css runs as it would there.
if (isVscode) {
  const vars = theme === 'vscode-hc' ? vscodeHighContrast : vscodeDark;
  for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(name, value);
  document.body.classList.add(theme === 'vscode-hc' ? 'vscode-high-contrast' : 'vscode-dark');
} else {
  document.documentElement.dataset.theme = theme;
}

const style = document.createElement('style');
style.textContent = [tokens, isVscode ? themeVscode : themeApp, base, galleryCss].join('\n');
document.head.append(style);

mount(App, { target: document.getElementById('app')!, props: { theme } });
