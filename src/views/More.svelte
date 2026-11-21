<script lang="ts">
  import {
    BackupError,
    exportData,
    importData,
    parseBackup,
    saveBackup,
    type BackupFile,
  } from '../lib/backup';
  import { formatDate, formatNumber, todayKey } from '../lib/dates';
  import { getSetting, setSetting } from '../lib/db';
  import { goalFor } from '../lib/goals';
  import { live } from '../lib/live.svelte';
  import { mealNames as namesOf, renamedMeals } from '../lib/meals';
  import { chosenLanguage, LANGUAGES, setLanguage } from '../lib/locale';
  import { applyUpdate, install, pwa } from '../lib/pwa.svelte';
  import { scannerEngine, type Engine } from '../lib/scanner';
  import { backupDue, keepStorage } from '../lib/storage';
  import { useGoals, useMealNames } from '../lib/stores.svelte';
  import WebhookCard from '../lib/WebhookCard.svelte';
  import { t } from '../lib/texts';

  const goals = useGoals();
  const goal = $derived(goalFor(todayKey(), goals.value));
  const mealNames = useMealNames();
  const chosen = chosenLanguage();

  const lastBackup = live(
    () => 0,
    () => getSetting<number>('lastExportAt'),
    undefined as number | undefined,
  );

  // Device status for testing on the phone: is the storage protected, which barcode detection is running?
  let persisted = $state<boolean | undefined>();
  let engine = $state<Engine | undefined>();
  void keepStorage().then((value) => (persisted = value));
  void scannerEngine().then((value) => (engine = value));

  const due = live(
    () => 0,
    () => backupDue(),
    false,
  );

  let message = $state('');
  let pending = $state.raw<BackupFile | null>(null);
  let dialog = $state<HTMLDialogElement>();

  async function renameMeal(index: number, input: HTMLInputElement) {
    const names = renamedMeals(await getSetting<string[]>('mealNames'), index, input.value);
    await setSetting('mealNames', names);
    // An emptied field shows the default again.
    input.value = namesOf(names)[index]!;
  }

  async function runExport() {
    message = '';
    const result = await saveBackup(await exportData());
    if (result !== 'cancelled') await setSetting('lastExportAt', Date.now());
  }

  async function pickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message = '';
    try {
      pending = parseBackup(await file.text());
      dialog?.showModal();
    } catch (error) {
      message = error instanceof BackupError ? t.more.errors[error.code] : t.more.errors.damaged;
    }
  }

  async function confirmImport() {
    const file = pending;
    dialog?.close();
    if (!file) return;
    try {
      await importData(file);
      // The data now equals that file: it counts as the last backup.
      await setSetting('lastExportAt', Date.parse(file.exportedAt) || Date.now());
      message = t.more.imported;
    } catch {
      message = t.more.errors.damaged;
    }
  }
</script>

<h1>{t.more.title}</h1>

<a class="card row link" href="#/goals">
  <span>{t.more.goals}</span>
  <span class="muted">{goal ? `${formatNumber(goal.kcal)} ${t.n.kcal}` : '–'}</span>
</a>

<section class="card">
  <h2>{t.more.mealNames}</h2>
  <div class="grid2 names">
    {#each mealNames.value as name, index (index)}
      <input
        type="text"
        autocomplete="off"
        aria-label={`${t.common.meal} ${index + 1}`}
        value={name}
        onchange={(event) => renameMeal(index, event.currentTarget)}
      />
    {/each}
  </div>
</section>

<section class="card">
  <h2>{t.more.language}</h2>
  <div class="chips names" role="radiogroup" aria-label={t.more.language}>
    <button type="button" class="chip" role="radio" aria-checked={chosen === null} onclick={() => setLanguage(null)}>
      {t.more.languageDevice}
    </button>
    {#each LANGUAGES as option (option.id)}
      <button
        type="button"
        class="chip"
        role="radio"
        lang={option.id}
        aria-checked={chosen === option.id}
        onclick={() => setLanguage(option.id)}
      >
        {option.name}
      </button>
    {/each}
  </div>
</section>

<section class="card">
  <div class="row">
    <h2>{t.more.backup}</h2>
    <span class="muted">
      {#if due.value}<span class="dot" role="img" aria-label={t.more.backupDue}></span>{/if}
      {t.more.lastBackup}:
      {lastBackup.value ? formatDate(lastBackup.value) : t.more.never}
    </span>
  </div>
  <div class="actions">
    <button onclick={runExport}>{t.more.export}</button>
    <label class="button">
      {t.more.import}
      <input class="visually-hidden" type="file" accept="application/json,.json" onchange={pickFile} />
    </label>
  </div>
  <p class="status" aria-live="polite">{message}</p>
</section>

<WebhookCard />

<section class="card">
  <h2>{t.more.sources}</h2>
  <p class="muted source">
    <a href="https://blsdb.de" target="_blank" rel="noopener">{t.sources.bls}</a>
  </p>
  <p class="muted source">
    <a href="https://openfoodfacts.org" target="_blank" rel="noopener">{t.sources.off}</a>
  </p>
</section>

<div class="row foot">
  <span class="muted">
    {t.more.version}
    {__APP_VERSION__}
    {#if persisted !== undefined && engine}
      <br />{persisted ? t.more.storage.yes : t.more.storage.no} · {t.more.scanner[engine]}
    {/if}
  </span>
  <span class="row">
    {#if pwa.updateReady}
      <button class="small" onclick={applyUpdate}>{t.more.update}</button>
    {/if}
    {#if pwa.canInstall}
      <button class="small" onclick={install}>{t.more.install}</button>
    {/if}
  </span>
</div>

<dialog bind:this={dialog} onclose={() => (pending = null)}>
  <h2>{t.more.replaceTitle}</h2>
  <div class="actions">
    <button onclick={() => dialog?.close()}>{t.common.cancel}</button>
    <button class="primary" onclick={confirmImport}>{t.more.replace}</button>
  </div>
</dialog>

<style>
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }

  .actions > * {
    flex: 1;
  }

  .status {
    margin-top: 10px;
    font-size: 14px;
  }

  .status:empty {
    display: none;
  }

  .link {
    text-decoration: none;
    min-height: 48px;
  }

  .names {
    margin-top: 10px;
  }

  .source {
    margin-top: 8px;
  }

  .foot {
    min-height: 40px;
  }
</style>
