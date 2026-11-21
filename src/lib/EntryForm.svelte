<script lang="ts">
  import { untrack } from 'svelte';
  import { formatAmount, formatNumber } from './dates';
  import type { Entry, Meal } from './db';
  import { removeEntry, restoreEntry, updateEntry } from './diary';
  import NumberField from './NumberField.svelte';
  import NumberPad from './NumberPad.svelte';
  import { scale } from './nutrition';
  import { PadValue } from './pad.svelte';
  import PadDisplay from './PadDisplay.svelte';
  import { t } from './texts';
  import { showToast } from './toasts.svelte';

  /** Change or delete an existing diary entry. */
  let { entry, mealNames, ondone }: { entry: Entry; mealNames: string[]; ondone: () => void } = $props();

  const start = untrack(() => entry);
  const quick = start.kind === 'quick';
  // Entries made in pieces are changed in pieces.
  const perPiece = start.count && start.amount ? start.amount / start.count : undefined;
  const pad = new PadValue(perPiece ? start.count! : (start.amount ?? null));
  const amount = $derived(pad.value === null ? null : perPiece ? pad.value * perPiece : pad.value);
  const baseUnit = start.unit ?? 'g';
  let meal = $state<Meal>(start.meal);
  let name = $state(start.name);
  let kcal = $state<number | null>(Math.round(start.nutrients.kcal));
  let protein = $state<number | null>(start.nutrients.protein || null);
  let carbs = $state<number | null>(start.nutrients.carbs || null);
  let fat = $state<number | null>(start.nutrients.fat || null);

  const preview = $derived(
    quick || !entry.amount || !amount ? entry.nutrients : scale(entry.nutrients, amount / entry.amount),
  );
  const valid = $derived(quick ? name.trim() !== '' && kcal !== null : amount !== null && amount > 0);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!valid) return;
    await updateEntry(
      entry,
      quick
        ? { meal, quick: { name: name.trim(), kcal: kcal!, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 } }
        : { meal, amount: amount! },
    );
    ondone();
  }

  async function remove() {
    // Keep what is being deleted: "Undo" only comes once this sheet is long closed.
    const { id, name: label } = start;
    await removeEntry(id);
    showToast(t.toast.deleted(label), () => restoreEntry(id));
    ondone();
  }
</script>

<form class="stack" onsubmit={save}>
  {#if quick}
    <h2>{t.add.quick}</h2>
    <label>
      <span class="field-label">{t.common.name}</span>
      <input type="text" autocomplete="off" aria-invalid={name.trim() === '' || undefined} bind:value={name} />
    </label>
    <NumberField bind:value={kcal} label={t.n.kcal} unit={t.n.kcal} invalid={kcal === null} />
    <div class="grid3">
      <NumberField bind:value={protein} label={t.n.protein} unit="g" />
      <NumberField bind:value={carbs} label={t.n.carbs} unit="g" />
      <NumberField bind:value={fat} label={t.n.fat} unit="g" />
    </div>
  {:else}
    <h2>{entry.name}</h2>
    <div class="row line">
      <PadDisplay
        model={pad}
        label={t.common.amount}
        unit={perPiece ? `${start.portion} · ${formatAmount(amount ?? 0)} ${baseUnit}` : baseUnit}
      />
      <p class="now"><strong>{formatNumber(preview.kcal)}</strong> {t.n.kcal}</p>
    </div>
  {/if}

  <div class="chips" role="radiogroup" aria-label={t.common.meal}>
    {#each mealNames as mealName, index (index)}
      <button type="button" class="chip" role="radio" aria-checked={meal === index} onclick={() => (meal = index as Meal)}>
        {mealName}
      </button>
    {/each}
  </div>

  {#if !quick}<NumberPad model={pad} />{/if}

  <div class="grid2 sheet-actions">
    <button type="button" onclick={remove}>{t.common.delete}</button>
    <!-- svelte-ignore a11y_autofocus -->
    <button class="primary" type="submit" autofocus={!quick} aria-disabled={!valid || undefined}>{t.common.save}</button>
  </div>
</form>

<style>
  h2 {
    font-size: 18px;
    overflow-wrap: anywhere;
  }

  .line {
    align-items: flex-end;
  }

  .now {
    flex: none;
    font-size: 14px;
  }

  .now strong {
    font-size: 24px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
</style>
