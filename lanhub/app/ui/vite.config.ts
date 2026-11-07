import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri serves `dist/` from its own protocol; the dev server port matches `build.devUrl` in tauri.conf.json.
export default defineConfig({
  base: './',
  plugins: [svelte({ configFile: false })],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    modulePreload: false,
  },
});
