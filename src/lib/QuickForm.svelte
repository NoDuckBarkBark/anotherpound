<script lang="ts">
  import type { Meal } from './db';
  import { formatNumber } from './dates';
  import { logQuick, removeEntry } from './diary';
  import NumberField from './NumberField.svelte';
  import { t } from './texts';
  import { showToast } from './toasts.svelte';

  /** Quick entry without a food behind it: name, kcal, optionally macros. */
  let { meal, date, ondone }: { meal: Meal; date: string; ondone: () => void } = $props();

  let name = $state('');
  let kcal = $state<number | null>(null);
  let protein = $state<number | null>(null);
  let carbs = $state<number | null>(null);
  let fat = $state<number | null>(null);
  let tried = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    if (kcal === null) return;
    const entry = await logQuick(
      { name: name.trim() || t.add.quick, kcal, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 },
      meal,
      date,
    );
    showToast(`${entry.name} · ${formatNumber(kcal)} ${t.n.kcal}`, () => removeEntry(entry.id));
    ondone();
  }
</script>

<form class="stack" onsubmit={submit}>
  <h2>{t.add.quick}</h2>
  <NumberField bind:value={kcal} label={t.n.kcal} unit={t.n.kcal} autofocus invalid={tried && kcal === null} />
  <label>
    <span class="field-label">{t.common.name}</span>
    <input type="text" autocomplete="off" autocapitalize="sentences" bind:value={name} />
  </label>
  <div class="grid3">
    <NumberField bind:value={protein} label={t.n.protein} unit="g" />
    <NumberField bind:value={carbs} label={t.n.carbs} unit="g" />
    <NumberField bind:value={fat} label={t.n.fat} unit="g" />
  </div>
  <div class="sheet-actions">
    <button class="primary wide" type="submit">{t.common.add}</button>
  </div>
</form>

<style>
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
</style>
