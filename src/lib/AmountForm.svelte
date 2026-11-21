<script lang="ts">
  import { untrack } from 'svelte';
  import type { Choice } from './catalog';
  import { formatAmount, formatNumber } from './dates';
  import type { Food, Meal, Portion } from './db';
  import { logDish, logFood, removeEntry, savePortions } from './diary';
  import NumberField from './NumberField.svelte';
  import NumberPad from './NumberPad.svelte';
  import { dishPer100, forAmount, isPlausible } from './nutrition';
  import { PadValue } from './pad.svelte';
  import PadDisplay from './PadDisplay.svelte';
  import { countable, formatCount, startFor, unitsOf } from './portions';
  import { t } from './texts';
  import { showToast } from './toasts.svelte';

  /**
   * Amount input for a food or dish. Opens with the last used amount,
   * typing happens on the app's own number pad. Counting is in grams or milliliters or in
   * pieces ("3 × Pastille") if the food has servings; custom servings can
   * be created here.
   */
  let {
    choice,
    meal,
    date,
    foods,
    mealNames,
    ondone,
    onvalues,
  }: {
    choice: Choice;
    meal: Meal;
    date: string;
    foods: Map<string, Food>;
    mealNames: string[];
    ondone: () => void;
    onvalues?: (food: Food) => void;
  } = $props();

  const food = $derived(choice.kind === 'food' ? choice.food : undefined);
  const name = $derived(choice.kind === 'food' ? choice.food.name : choice.dish.name);
  const unit = $derived(choice.kind === 'food' ? choice.food.unit : 'g');
  const per100 = $derived(choice.kind === 'food' ? choice.food.per100 : dishPer100(choice.dish, foods));
  const plausible = $derived(isPlausible(per100));

  /** Package size without the estimation mark from the label ("400 g e"). */
  const packSize = (quantity?: string) => quantity?.replace(/\s*(℮|\be)$/u, '');

  // Servings of the food, as stored; ones created here are added.
  let portions = $state.raw<Portion[]>(untrack(() => (choice.kind === 'food' ? choice.food.portions : [])));
  const units = $derived(unitsOf(choice, t.add.portion, portions));

  const start = untrack(() => startFor(choice, t.add.portion));
  /** Label of the selected unit; null means grams or milliliters. */
  let chosen = $state<string | null>(start.portion?.label ?? null);
  /** Typed number: pieces or grams. */
  const pad = new PadValue(start.value);
  let chosenMeal = $state<Meal>(untrack(() => meal));
  let saving = $state(false);

  const active = $derived(units.find((option) => option.label === chosen));
  const amount = $derived(pad.value === null ? null : active ? pad.value * active.amount : pad.value);
  const now = $derived(forAmount(per100, amount ?? 0));
  const valid = $derived(amount !== null && amount > 0);

  function useBase() {
    if (!active) return;
    pad.reset(amount === null ? null : Math.round(amount * 10) / 10);
    chosen = null;
  }

  function usePortion(label: string) {
    if (active?.label === label) return;
    chosen = label;
    pad.reset(1);
  }

  let adding = $state(false);
  let newLabel = $state('');
  let newAmount = $state<number | null>(null);
  let triedPortion = $state(false);

  async function addPortion() {
    triedPortion = true;
    if (!food || !newAmount || newAmount <= 0) return;
    const created: Portion = { label: newLabel.trim() || t.add.piece, amount: newAmount };
    const label = countable(created, t.add.portion).label;
    // A serving with the same label is replaced.
    portions = [...portions.filter((portion) => countable(portion, t.add.portion).label !== label), created];
    chosen = label;
    pad.reset(1);
    adding = false;
    newLabel = '';
    newAmount = null;
    triedPortion = false;
    // Update the display first, then save: anyone who keeps typing right away keeps their input.
    await savePortions(food, portions);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (adding) return void addPortion();
    if (!valid || saving) return;
    saving = true;
    const via = active ? { label: active.label, count: pad.value! } : null;
    const entry =
      choice.kind === 'food'
        ? await logFood({ ...choice.food, portions }, amount!, chosenMeal, date, undefined, via)
        : await logDish(choice.dish, amount!, chosenMeal, date, undefined, via);
    showToast(`${name} · ${via ? formatCount(via.count, via.label) : `${formatAmount(amount!)} ${unit}`}`, () =>
      removeEntry(entry.id),
    );
    ondone();
  }
</script>

<form onsubmit={submit}>
  <header>
    <h2>{name}</h2>
    {#if food?.brand || food?.quantity}
      <p class="muted">{[food.brand, packSize(food.quantity)].filter(Boolean).join(' · ')}</p>
    {/if}
  </header>

  <div class="row per">
    <p class="muted" class:warn={!plausible}>
      {formatNumber(per100.kcal)}
      {t.n.kcal} · {t.n.p}
      {formatAmount(per100.protein)} · {t.n.c}
      {formatAmount(per100.carbs)} · {t.n.f}
      {formatAmount(per100.fat)}
      <span class="nowrap">{t.common.per} {unit}</span>
    </p>
    {#if food && onvalues}
      <button type="button" class="small" class:warn={!plausible} onclick={() => onvalues(food)}>
        {plausible ? t.add.values : t.add.check}
      </button>
    {/if}
  </div>

  {#if adding}
    <div class="new stack" role="group" aria-label={t.add.newPortion}>
      <div class="grid2">
        <label>
          <span class="field-label">{t.food.portionLabel}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input type="text" autocomplete="off" autocapitalize="sentences" autofocus placeholder={t.add.piece} bind:value={newLabel} />
        </label>
        <NumberField bind:value={newAmount} label={t.food.portionAmount} {unit} invalid={triedPortion && !newAmount} />
      </div>
      <div class="grid2 sheet-actions">
        <button type="button" onclick={() => (adding = false)}>{t.common.cancel}</button>
        <button type="submit" class="primary">{t.common.save}</button>
      </div>
    </div>
  {:else}
    <div class="row line">
      <PadDisplay
        model={pad}
        label={t.common.amount}
        unit={active ? `${active.label} · ${formatAmount(amount ?? 0)} ${unit}` : unit}
      />
      <p class="now">
        <span><strong>{formatNumber(now.kcal)}</strong> {t.n.kcal}</span>
        <span class="muted">
          {t.n.p}
          {formatAmount(now.protein)} · {t.n.c}
          {formatAmount(now.carbs)} · {t.n.f}
          {formatAmount(now.fat)}
        </span>
      </p>
    </div>

    {#if units.length || food}
      <div class="chips" role="radiogroup" aria-label={t.food.unit}>
        <button type="button" class="chip" role="radio" aria-checked={!active} onclick={useBase}>{unit}</button>
        {#each units as option (option.label)}
          <button
            type="button"
            class="chip"
            role="radio"
            aria-checked={active?.label === option.label}
            onclick={() => usePortion(option.label)}
          >
            {`${option.label} · ${formatAmount(option.amount)} ${unit}`}
          </button>
        {/each}
        {#if food}
          <button type="button" class="chip" aria-label={t.add.newPortion} onclick={() => (adding = true)}>
            + {t.add.portion}
          </button>
        {/if}
      </div>
    {/if}

    <div class="chips" role="radiogroup" aria-label={t.common.meal}>
      {#each mealNames as mealName, index (index)}
        <button
          type="button"
          class="chip"
          role="radio"
          aria-checked={chosenMeal === index}
          onclick={() => (chosenMeal = index as Meal)}
        >
          {mealName}
        </button>
      {/each}
    </div>

    <div class="pad"><NumberPad model={pad} /></div>

    <!-- The button stays operable and keeps focus, so the Enter key adds the entry; without an amount it is only faded. -->
    <!-- svelte-ignore a11y_autofocus -->
    <button class="primary wide" type="submit" autofocus aria-disabled={!valid || undefined}>{t.common.add}</button>
  {/if}
</form>

<style>
  header {
    margin-bottom: 6px;
  }

  h2 {
    font-size: 18px;
    overflow-wrap: anywhere;
  }

  .per {
    margin-bottom: 14px;
    align-items: flex-start;
    min-height: 36px;
  }

  .nowrap {
    white-space: nowrap;
  }

  .warn {
    color: var(--danger);
    border-color: var(--danger);
  }

  .line {
    align-items: flex-end;
    margin-bottom: 4px;
  }

  .now {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex: none;
    font-size: 14px;
    text-align: right;
  }

  .now strong {
    font-size: 24px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .now .muted {
    font-size: 13px;
  }

  .chips {
    margin-top: 10px;
  }

  .pad {
    margin-top: 14px;
  }

  .wide {
    margin-top: 12px;
  }
</style>
