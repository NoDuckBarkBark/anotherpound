/**
 * PWA integration: register the service worker, apply new versions, offer installation.
 *
 * The browser loads new versions in the background. They are applied automatically only
 * as long as nothing has been tapped since the start; after that on a button press under "More" or
 * at the next start. This way the app never reloads in the middle of an input.
 */
import { keepStorage } from './storage';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

export const pwa = $state({ canInstall: false, updateReady: false });

let installPrompt: InstallPrompt | null = null;
let waiting: ServiceWorker | null = null;
let touched = false;

export async function install(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  pwa.canInstall = false;
  await prompt.prompt();
}

export function applyUpdate(): void {
  waiting?.postMessage({ type: 'SKIP_WAITING' });
}

function offer(worker: ServiceWorker): void {
  waiting = worker;
  pwa.updateReady = true;
  if (!touched) applyUpdate();
}

export function startPwa(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    pwa.canInstall = true;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    pwa.canInstall = false;
    // Browsers keep the data of installed apps: ask again right away.
    void keepStorage();
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const workers = navigator.serviceWorker;

  const markTouched = () => (touched = true);
  window.addEventListener('pointerdown', markTouched, { once: true, capture: true });
  window.addEventListener('keydown', markTouched, { once: true, capture: true });

  // If a new version has taken over, reload once. On the very first visit
  // the service worker only takes over the page, so there is nothing to reload.
  let controlled = workers.controller !== null;
  workers.addEventListener('controllerchange', () => {
    if (controlled) location.reload();
    controlled = true;
  });

  // Some browsers refuse the registration or return nothing (private window, blocked
  // service workers). The app then keeps running like an ordinary website.
  const registered: Promise<ServiceWorkerRegistration | undefined> = workers.register('./sw.js', { scope: './' });
  void registered.catch(() => undefined).then((registration) => {
    if (!registration) return;
    if (registration.waiting && workers.controller) offer(registration.waiting);

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && workers.controller) offer(worker);
      });
    });

    // When the app returns from the background, check for a new version, at most hourly.
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < 3_600_000) return;
      checked = Date.now();
      registration.update().catch(() => undefined);
    });
  });
}
