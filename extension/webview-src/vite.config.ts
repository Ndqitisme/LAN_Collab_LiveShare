import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Shared by every webview. build.mjs adds the entry and output folder of each view, so every view is one
// self-contained classic script plus one stylesheet at fixed names: the host references
// dist/<view>/index.js under a CSP nonce, which a module graph of hashed chunks would complicate.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  logLevel: 'warn',
  plugins: [svelte({ configFile: false })],
  build: {
    target: 'es2022',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'index.js',
        assetFileNames: 'index[extname]',
      },
    },
  },
});
