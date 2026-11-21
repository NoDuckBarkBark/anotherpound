<script lang="ts">
  import type { Choice } from '../lib/catalog';
  import { formatAmount, formatNumber } from '../lib/dates';
  import { db, fresh, type Dish, type Food, type Ingredient } from '../lib/db';
  import { ensureFood } from '../lib/diary';
  import FoodForm, { type FoodDraft } from '../lib/FoodForm.svelte';
  import FoodSearch from '../lib/FoodSearch.svelte';
  import Icon from '../lib/Icon.svelte';
  import NumberField from '../lib/NumberField.svelte';
  import { dishPer100, dishTotals, dishWeight } from '../lib/nutrition';
  import { go, route } from '../lib/route.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import { useFoods } from '../lib/stores.svelte';
  import { t } from '../lib/texts';

  const id = route.path.split('/')[1] ?? 'new';
  const foods = useFoods();

  let existing = $state.raw<Dish | undefined>();
  let name = $state('');
  let ingredients = $state<{ foodId: string; amount: number | null }[]>([]);
  let cookedWeight = $state<number | null>(null);
  let portions = $state<number | null>(null);
  let tried = $state(false);
  let picking = $state(false);
  let draft = $state.raw<FoodDraft | null>(null);

  if (id !== 'new') {
    void db.dishes.get(id).then((dish) => {
      if (!dish) return;
      existing = dish;
      name = dish.name;
      ingredients = dish.ingredients.map((ingredient) => ({ ...ingredient }));
      cookedWeight = dish.cookedWeight ?? null;
      portions = dish.portions ?? null;
    });
  }

  const cleaned = $derived<Ingredient[]>(
    ingredients.flatMap((row) => (row.amount && row.amount > 0 ? [{ foodId: row.foodId, amount: row.amount }] : [])),
  );
  const shape = $derived({ ingredients: cleaned, cookedWeight: cookedWeight ?? undefined });
  const totals = $derived(dishTotals(shape, foods.map));
  const per100 = $derived(dishPer100(shape, foods.map));
  const weight = $derived(dishWeight(shape));

  async function addFood(food: Food) {
    const stored = await ensureFood(food);
    ingredients.push({ foodId: stored.id, amount: stored.lastAmount ?? 100 });
    picking = false;
  }

  function picked(choice: Choice) {
    if (choice.kind === 'food') void addFood(choice.food);
  }

  function foodSaved(food: Food | null) {
    draft = null;
    if (food) void addFood(food);
  }

  function build(): Dish {
    return {
      ...(existing ?? { ...fresh(), useCount: 0 }),
      updatedAt: Date.now(),
      deleted: 0,
      name: name.trim(),
      ingredients: cleaned,
      cookedWeight: cookedWeight && cookedWeight > 0 ? cookedWeight : undefined,
      portions: portions && portions > 0 ? portions : undefined,
    };
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    if (name.trim() === '' || !cleaned.length) return;
    await db.dishes.put(build());
    go('dishes');
  }

  async function duplicate() {
    if (name.trim() === '' || !cleaned.length) return;
    await db.dishes.put({ ...build(), ...fresh(), name: t.dishes.copyOf(name.trim()), useCount: 0, lastUsedAt: undefined, lastAmount: undefined });
    go('dishes');
  }

  async function remove() {
    if (existing) await db.dishes.update(existing.id, { deleted: 1, updatedAt: Date.now() });
    go('dishes');
  }
</script>

<form onsubmit={save}>
  <div class="topbar">
    <a class="button icon" href="#/dishes" aria-label={t.common.back}><Icon name="left" /></a>
    <h1>{t.dishes.dish}</h1>
    <button class="primary" type="submit">{t.common.save}</button>
  </div>

  <div class="stack">
    <label>
      <span class="field-label">{t.common.name}</span>
      <input type="text" autocomplete="off" aria-invalid={(tried && name.trim() === '') || undefined} bind:value={name} />
    </label>

    <div>
      <p class="section-title first">{t.dishes.ingredients}</p>
      <ul>
        {#each ingredients as row, index (index)}
          {@const food = foods.map.get(row.foodId)}
          <li class="row">
            <span class="what">{food?.name ?? '–'}</span>
            <NumberField bind:value={row.amount} label={`${t.common.amount} ${food?.name ?? ''}`} unit={food?.unit ?? 'g'} compact />
            <button type="button" class="icon small-icon" aria-label={`${t.common.remove}: ${food?.name ?? ''}`} onclick={() => ingredients.splice(index, 1)}>
              ×
            </button>
          </li>
        {/each}
      </ul>
      <button type="button" class="wide" class:missing={tried && !cleaned.length} onclick={() => (picking = true)}>
        {t.dishes.addIngredient}
      </button>
    </div>

    <div class="grid2">
      <NumberField bind:value={cookedWeight} label={t.dishes.cooked} unit="g" />
      <NumberField bind:value={portions} label={t.dishes.portions} />
    </div>

    <dl class="card">
      <div class="row">
        <dt>{t.dishes.total} <span class="muted">{formatAmount(weight)} g</span></dt>
        <dd>{formatNumber(totals.kcal)} {t.n.kcal}</dd>
      </div>
      {#if portions && portions > 0 && weight > 0}
        <div class="row">
          <dt>{t.dishes.perPortion} <span class="muted">{formatNumber(weight / portions)} g</span></dt>
          <dd>{formatNumber(totals.kcal / portions)} {t.n.kcal}</dd>
        </div>
      {/if}
      <div class="row">
        <dt>{t.common.per} g</dt>
        <dd>
          {formatNumber(per100.kcal)}
          {t.n.kcal}
          <span class="muted">
            · {t.n.p}
            {formatAmount(per100.protein)} · {t.n.c}
            {formatAmount(per100.carbs)} · {t.n.f}
            {formatAmount(per100.fat)}
          </span>
        </dd>
      </div>
    </dl>

    {#if existing}
      <div class="grid2">
        <button type="button" onclick={remove}>{t.common.delete}</button>
        <button type="button" onclick={duplicate}>{t.common.duplicate}</button>
      </div>
    {/if}
  </div>
</form>

<Sheet open={picking} label={t.dishes.addIngredient} onclose={() => (picking = false)}>
  <FoodSearch
    foods={foods.list}
    foodMap={foods.map}
    onpick={picked}
    oncreate={(newName) => ((picking = false), (draft = { name: newName }))}
  >
    {#each [...foods.list].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 30) as food (food.id)}
      <button type="button" class="list-button" onclick={() => addFood(food)}>{food.name}</button>
    {/each}
  </FoodSearch>
</Sheet>

<Sheet open={draft !== null} label={t.food.title} onclose={() => (draft = null)}>
  {#if draft}
    <FoodForm {draft} ondone={foodSaved} />
  {/if}
</Sheet>

<style>
  ul {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .what {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .small-icon {
    width: 40px;
    min-height: 40px;
    flex: none;
    font-size: 20px;
    line-height: 1;
  }

  .first {
    margin-top: 0;
  }

  .missing {
    border-color: var(--danger);
  }

  dl {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  dd {
    margin: 0;
    text-align: right;
  }
</style>
