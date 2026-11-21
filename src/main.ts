import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { db } from './lib/db';
import { keepPack } from './lib/catalog';
import { startKeyboard } from './lib/keyboard.svelte';
import { language } from './lib/locale';
import { startPwa } from './lib/pwa.svelte';
import { keepStorage } from './lib/storage';
import { startWebhook } from './lib/webhook';

document.documentElement.lang = language;
startPwa();
startKeyboard();
void keepStorage();

// Open the database first, then render: the first view shows the real values right away.
void db
  .open()
  .catch(() => undefined)
  .then(() => {
    mount(App, { target: document.getElementById('app')! });
    startWebhook();
    void keepPack();
  });
