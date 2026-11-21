import { defineConfig } from '@playwright/test';

// The tests run against the built site at phone size (Android, Chrome).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 412, height: 915 },
    locale: 'en-GB',
    // The flows fake the data files and Open Food Facts, which only works without a service worker.
    // The PWA tests switch it on for themselves.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    // Always build fresh: a reused server would serve an old build.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
