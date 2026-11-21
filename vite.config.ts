import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// The update test builds several versions in a row and sets the version number from outside.
const version = process.env.APP_VERSION ?? pkg.version;

export default defineConfig({
  // Relative paths: runs under any address (GitHub Pages, a domain of its own).
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      // src/lib/pwa.svelte.ts registers the service worker and takes over new versions.
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        name: 'AnotherPound',
        short_name: 'AnotherPound',
        description: 'Calorie and macro tracker',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        // Splash screen and system bars during start: dark, so it does not glare in the evening.
        // If the app runs light, the light colour from index.html takes over afterwards.
        background_color: '#151514',
        theme_color: '#151514',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything, food data and barcode detection included: the app starts and searches offline.
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
