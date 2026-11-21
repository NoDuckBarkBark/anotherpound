<script lang="ts">
  import AmountForm from '../lib/AmountForm.svelte';
  import { loadCatalog, type Choice } from '../lib/catalog';
  import ChoiceRow from '../lib/ChoiceRow.svelte';
  import { addDays, formatNumber } from '../lib/dates';
  import type { Food, Meal, Template } from '../lib/db';
  import { copyMeal, mealEntries, mealForTime, removeEntry, saveMealAsTemplate } from '../lib/diary';
  import FoodForm, { type FoodDraft } from '../lib/FoodForm.svelte';
  import FoodSearch from '../lib/FoodSearch.svelte';
  import Icon from '../lib/Icon.svelte';
  import { live } from '../lib/live.svelte';
  import { itemsTotal } from '../lib/nutrition';
  import { fetchProduct } from '../lib/off';
  import QuickForm from '../lib/QuickForm.svelte';
  import { route } from '../lib/route.svelte';
  import ScannerPanel from '../lib/ScannerPanel.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import { ui } from '../lib/state.svelte';
  import { useDishes, useFoods, useMealNames, useTemplates } from '../lib/stores.svelte';
  import TemplateLog from '../lib/TemplateLog.svelte';
  import { t } from '../lib/texts';
  import { showToast } from '../lib/toasts.svelte';

  const meal = $derived.by<Meal>(() => {
    const fromRoute = Number(route.path.split('/')[1]);
    return fromRoute >= 0 && fromRoute <= 3 ? (fromRoute as Meal) : mealForTime();
  });

  const foods = useFoods();
  const dishes = useDishes();
  const templates = useTemplates();
  const mealNames = useMealNames();
  const mealName = $derived(mealNames.value[meal]!);

  const here = live(
    () => [ui.day, meal] as const,
    ([day, index]) => mealEntries(day, index),
    [],
  );
  const yesterday = live(
    () => [addDays(ui.day, -1), meal] as const,
    ([day, index]) => mealEntries(day, index),
    [],
  );
  const hereKcal = $derived(here.value.reduce((sum, entry) => sum + entry.nutrients.kcal, 0));

  type Tab = 'recent' | 'frequent' | 'dishes' | 'templates';
  let tab = $state<Tab>('recent');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'recent', label: t.add.recent },
    { id: 'frequent', label: t.add.frequent },
    { id: 'dishes', label: t.add.dishes },
    { id: 'templates', label: t.add.templates },
  ];

  const used = $derived<Choice[]>([
    ...foods.list.filter((food) => food.lastUsedAt).map((food): Choice => ({ kind: 'food', food })),
    ...dishes.list.filter((dish) => dish.lastUsedAt).map((dish): Choice => ({ kind: 'dish', dish })),
  ]);
  const lastUsed = (choice: Choice) => (choice.kind === 'food' ? choice.food.lastUsedAt : choice.dish.lastUsedAt) ?? 0;
  const useCount = (choice: Choice) => (choice.kind === 'food' ? choice.food.useCount : choice.dish.useCount) ?? 0;
  const listed = $derived.by<Choice[]>(() => {
    if (tab === 'recent') return [...used].sort((a, b) => lastUsed(b) - lastUsed(a)).slice(0, 40);
    if (tab === 'frequent') return [...used].sort((a, b) => useCount(b) - useCount(a) || lastUsed(b) - lastUsed(a)).slice(0, 40);
    if (tab === 'dishes') return dishes.list.map((dish): Choice => ({ kind: 'dish', dish }));
    return [];
  });

  // Kept raw because these objects are written to the database.
  let choice = $state.raw<Choice | null>(null);
  let template = $state.raw<Template | null>(null);
  let draft = $state.raw<FoodDraft | null>(null);
  let quickOpen = $state(false);
  let scannerOpen = $state(false);
  let notice = $state('');
  let noticeCode = $state<string | null>(null);

  async function handleCode(code: string) {
    scannerOpen = false;
    notice = '';
    noticeCode = null;

    // Own foods take precedence over the database entry with the same barcode.
    const known = foods.list.filter((food) => food.barcode === code);
    const local = known.find((food) => food.source === 'own') ?? known[0];
    if (local) {
      choice = { kind: 'food', food: local };
      return;
    }
    const bundled = (await loadCatalog()).byBarcode.get(code);
    if (bundled) {
      choice = { kind: 'food', food: bundled };
      return;
    }

    const result = await fetchProduct(code);
    if (result.status === 'found') choice = { kind: 'food', food: result.food };
    else if (result.status === 'incomplete') draft = { ...result.draft, barcode: code };
    else if (result.status === 'missing') draft = { barcode: code };
    else {
      notice = t.add.offline;
      noticeCode = code;
    }
  }

  function foodSaved(food: Food | null) {
    draft = null;
    if (food) choice = { kind: 'food', food };
  }

  async function copyYesterday() {
    const copies = await copyMeal(addDays(ui.day, -1), ui.day, meal);
    if (!copies.length) return;
    showToast(`${mealName} · ${t.toast.entries(copies.length)}`, async () => {
      for (const entry of copies) await removeEntry(entry.id);
    });
  }

  async function saveTemplate() {
    await saveMealAsTemplate(ui.day, meal, mealName);
    tab = 'templates';
  }
</script>

<div class="topbar">
  <a class="button icon" href="#/today" aria-label={t.common.back}><Icon name="left" /></a>
  <h1>{mealName} <span class="muted">{formatNumber(hereKcal)} {t.n.kcal}</span></h1>
</div>

<FoodSearch
  foods={foods.list}
  foodMap={foods.map}
  dishes={dishes.list}
  onpick={(picked) => (choice = picked)}
  onscan={() => (scannerOpen = true)}
  oncreate={(name) => (draft = { name })}
>
  {#if notice}
    <div class="card row" aria-live="polite">
      <span>{notice}</span>
      {#if noticeCode}
        <button class="small" onclick={() => ((draft = { barcode: noticeCode ?? undefined }), (notice = ''))}>
          {t.add.newFood}
        </button>
      {/if}
    </div>
  {/if}

  <div class="chips tabs" role="tablist">
    {#each tabs as item (item.id)}
      <button class="chip" role="tab" aria-selected={tab === item.id} onclick={() => (tab = item.id)}>
        {item.label}
      </button>
    {/each}
  </div>

  {#if tab === 'templates'}
    {#each templates.list as item (item.id)}
      <button class="list-button" onclick={() => (template = item)}>
        <span>{item.name}</span>
        <span class="muted">{formatNumber(itemsTotal(item.items, foods.map, dishes.map).kcal)} {t.n.kcal}</span>
      </button>
    {/each}
    {#if here.value.some((entry) => entry.kind !== 'quick')}
      <button class="wide extra" onclick={saveTemplate}>{t.add.saveTemplate(mealName)}</button>
    {/if}
  {:else}
    {#each listed as item (item.kind === 'food' ? item.food.id : item.dish.id)}
      <ChoiceRow choice={item} foods={foods.map} onpick={(picked) => (choice = picked)} />
    {/each}
  {/if}

  <div class="stack extra">
    <button class="wide" onclick={() => (quickOpen = true)}>{t.add.quick}</button>
    {#if yesterday.value.length}
      <button class="wide" onclick={copyYesterday}>
        {t.add.copyYesterday(mealName)}
      </button>
    {/if}
  </div>
</FoodSearch>

<Sheet open={choice !== null} label={t.common.amount} onclose={() => (choice = null)}>
  {#if choice}
    <AmountForm
      {choice}
      {meal}
      date={ui.day}
      foods={foods.map}
      mealNames={mealNames.value}
      ondone={() => (choice = null)}
      onvalues={(food) => ((choice = null), (draft = { food }))}
    />
  {/if}
</Sheet>

<Sheet open={draft !== null} label={t.food.title} onclose={() => (draft = null)}>
  {#if draft}
    <FoodForm {draft} ondone={foodSaved} />
  {/if}
</Sheet>

<Sheet open={quickOpen} label={t.add.quick} onclose={() => (quickOpen = false)}>
  <QuickForm {meal} date={ui.day} ondone={() => (quickOpen = false)} />
</Sheet>

<Sheet open={scannerOpen} label={t.scanner.title} onclose={() => (scannerOpen = false)}>
  <ScannerPanel oncode={handleCode} />
</Sheet>

<Sheet open={template !== null} label={template?.name ?? ''} onclose={() => (template = null)}>
  {#if template}
    <TemplateLog
      {template}
      {meal}
      date={ui.day}
      foods={foods.map}
      dishes={dishes.map}
      ondone={() => (template = null)}
    />
  {/if}
</Sheet>

<style>
  .topbar h1 .muted {
    font-weight: 400;
    margin-left: 4px;
  }

  .tabs {
    margin-bottom: 6px;
  }

  .extra {
    margin-top: 16px;
  }
</style>
