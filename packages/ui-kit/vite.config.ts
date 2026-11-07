import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'gallery',
  base: './',
  plugins: [svelte({ configFile: false })],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
