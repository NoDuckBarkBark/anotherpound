<script lang="ts">
  import { untrack } from 'svelte';
  import { db, fresh, type Food, type Nutrients, type Unit } from './db';
  import NumberField from './NumberField.svelte';
  import { t } from './texts';

  /** Prefill: an existing food (to change or correct) or individual values. */
  export interface FoodDraft {
    food?: Food;
    name?: string;
    brand?: string;
    barcode?: string;
    quantity?: string;
    unit?: Unit;
    per100?: Partial<Nutrients>;
  }

  /**
   * Create or change a food of your own. If an entry from a database
   * is corrected, a food of your own with the same barcode is created; the
   * database entry stays unchanged.
   */
  let { draft, ondone }: { draft: FoodDraft; ondone: (food: Food | null) => void } = $props();

  const start = untrack(() => draft);
  const base = start.food;
  const own = base?.source === 'own';
  const from = base?.per100 ?? start.per100 ?? {};
  const firstPortion = base?.portions[0];

  let name = $state(base?.name ?? start.name ?? '');
  let brand = $state(base?.brand ?? start.brand ?? '');
  let barcode = $state(base?.barcode ?? start.barcode ?? '');
  let unit = $state<Unit>(base?.unit ?? start.unit ?? 'g');
  let kcal = $state<number | null>(from.kcal ?? null);
  let fat = $state<number | null>(from.fat ?? null);
  let satFat = $state<number | null>(from.satFat ?? null);
  let carbs = $state<number | null>(from.carbs ?? null);
  let sugar = $state<number | null>(from.sugar ?? null);
  let fiber = $state<number | null>(from.fiber ?? null);
  let protein = $state<number | null>(from.protein ?? null);
  let salt = $state<number | null>(from.salt ?? null);
  let portionLabel = $state(firstPortion?.label ?? '');
  let portionAmount = $state<number | null>(firstPortion?.amount ?? null);
  let tried = $state(false);
  // The keyboard opens at the first field where something is missing. If everything is prefilled, it stays closed.
  const focus = !(base?.name ?? start.name) ? 'name' : from.kcal === undefined ? 'kcal' : null;

  const missing = $derived({
    name: name.trim() === '',
    kcal: kcal === null,
    fat: fat === null,
    carbs: carbs === null,
    protein: protein === null,
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    if (Object.values(missing).some(Boolean)) return;

    const per100: Nutrients = { kcal: kcal!, protein: protein!, carbs: carbs!, fat: fat! };
    if (sugar !== null) per100.sugar = sugar;
    if (satFat !== null) per100.satFat = satFat;
    if (fiber !== null) per100.fiber = fiber;
    if (salt !== null) per100.salt = salt;
    if (from.alcohol !== undefined) per100.alcohol = from.alcohol;

    const portions = [
      ...(portionAmount && portionAmount > 0
        ? [{ label: portionLabel.trim() || `${portionAmount} ${unit}`, amount: portionAmount }]
        : []),
      ...(base?.portions.slice(1) ?? []),
    ];

    const food: Food = {
      ...(own ? base : { ...fresh(), useCount: 0 }),
      updatedAt: Date.now(),
      deleted: 0,
      source: 'own',
      name: name.trim(),
      brand: brand.trim() || undefined,
      barcode: barcode.trim() || undefined,
      quantity: base?.quantity ?? start.quantity,
      unit,
      per100,
      portions,
      lastAmount: base?.lastAmount,
      useCount: own ? base.useCount : 0,
    };
    await db.foods.put(food);
    ondone(food);
  }

  async function remove() {
    if (!own) return;
    await db.foods.update(base.id, { deleted: 1, updatedAt: Date.now() });
    ondone(null);
  }
</script>

<form class="stack" onsubmit={save}>
  <h2>{t.food.title}</h2>

  <label>
    <span class="field-label">{t.common.name}</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      autocomplete="off"
      autocapitalize="sentences"
      autofocus={focus === 'name'}
      aria-invalid={(tried && missing.name) || undefined}
      bind:value={name}
    />
  </label>
  <div class="grid2">
    <label>
      <span class="field-label">{t.food.brand}</span>
      <input type="text" autocomplete="off" bind:value={brand} />
    </label>
    <label>
      <span class="field-label">{t.food.barcode}</span>
      <input type="text" inputmode="numeric" autocomplete="off" bind:value={barcode} />
    </label>
  </div>

  <div class="chips" role="radiogroup" aria-label={t.food.unit}>
    <button type="button" class="chip" role="radio" aria-checked={unit === 'g'} onclick={() => (unit = 'g')}>
      {t.food.gram}
    </button>
    <button type="button" class="chip" role="radio" aria-checked={unit === 'ml'} onclick={() => (unit = 'ml')}>
      {t.food.ml}
    </button>
  </div>

  <p class="section-title">{t.common.per} {unit}</p>
  <!-- Order as on the label, read row by row: the main value on the left, its "of which" on the right. -->
  <NumberField bind:value={kcal} label={t.n.kcal} unit={t.n.kcal} autofocus={focus === 'kcal'} invalid={tried && missing.kcal} />
  <div class="grid2">
    <NumberField bind:value={fat} label={t.n.fat} unit="g" invalid={tried && missing.fat} />
    <NumberField bind:value={satFat} label={t.n.satFat} unit="g" />
    <NumberField bind:value={carbs} label={t.n.carbs} unit="g" invalid={tried && missing.carbs} />
    <NumberField bind:value={sugar} label={t.n.sugar} unit="g" />
    <NumberField bind:value={protein} label={t.n.protein} unit="g" invalid={tried && missing.protein} />
    <NumberField bind:value={fiber} label={t.n.fiber} unit="g" />
    <NumberField bind:value={salt} label={t.n.salt} unit="g" />
  </div>

  <div class="grid2">
    <label>
      <span class="field-label">{t.food.portionLabel}</span>
      <input type="text" autocomplete="off" placeholder={t.food.portionPlaceholder} bind:value={portionLabel} />
    </label>
    <NumberField bind:value={portionAmount} label={t.food.portionAmount} {unit} />
  </div>

  <div class={own ? 'grid2 sheet-actions' : 'sheet-actions'}>
    {#if own}
      <button type="button" onclick={remove}>{t.common.delete}</button>
    {/if}
    <button class="primary wide" type="submit">{t.common.save}</button>
  </div>
</form>

<style>
  .section-title {
    margin: 4px 0 -4px;
  }
</style>
