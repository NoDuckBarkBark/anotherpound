<script lang="ts">
  import type { Snippet } from 'svelte';
  import { loadCatalog, search, type Choice } from './catalog';
  import ChoiceRow from './ChoiceRow.svelte';
  import type { Dish, Food } from './db';
  import Icon from './Icon.svelte';
  import { searchProducts } from './off';
  import { t } from './texts';

  /**
   * Search field with result list. Immediately searches your own data and the
   * bundled base catalog. Open Food Facts is only queried on button press.
   */
  let {
    foods,
    foodMap,
    dishes = [],
    onpick,
    onscan,
    oncreate,
    children,
  }: {
    foods: Food[];
    foodMap: Map<string, Food>;
    dishes?: Dish[];
    onpick: (choice: Choice) => void;
    onscan?: () => void;
    oncreate?: (name: string) => void;
    children?: Snippet;
  } = $props();

  let query = $state('');
  let catalog = $state.raw<Awaited<ReturnType<typeof loadCatalog>>['index']>([]);
  let online = $state.raw<{ query: string; foods: Food[] } | null>(null);
  let busy = $state(false);
  let notice = $state('');

  const active = $derived(query.trim().length > 0);

  $effect(() => {
    if (active && !catalog.length) void loadCatalog().then((loaded) => (catalog = loaded.index));
  });

  const local = $derived<Choice[]>([
    ...foods.map((food): Choice => ({ kind: 'food', food })),
    ...dishes.map((dish): Choice => ({ kind: 'dish', dish })),
  ]);
  const results = $derived(active ? search(query, local, catalog) : []);
  const onlineResults = $derived(online && online.query === query.trim() ? online.foods : []);

  async function askOnline() {
    const asked = query.trim();
    busy = true;
    notice = '';
    const result = await searchProducts(asked);
    busy = false;
    if (result.status === 'offline') {
      notice = t.add.offline;
      return;
    }
    const known = new Set(results.flatMap((r) => (r.kind === 'food' && r.food.barcode ? [r.food.barcode] : [])));
    online = { query: asked, foods: result.foods.filter((food) => !food.barcode || !known.has(food.barcode)) };
    if (!online.foods.length) notice = t.add.none;
  }

  function pick(choice: Choice) {
    query = '';
    online = null;
    notice = '';
    onpick(choice);
  }

  export function clear() {
    query = '';
  }
</script>

<div class="bar">
  <input
    type="search"
    enterkeyhint="search"
    autocomplete="off"
    aria-label={t.add.search}
    placeholder={t.add.search}
    bind:value={query}
    oninput={() => (notice = '')}
  />
  {#if onscan}
    <button type="button" class="icon" aria-label={t.add.scan} onclick={onscan}>
      <Icon name="barcode" />
    </button>
  {/if}
</div>

{#if active}
  <div class="results">
    {#each results as choice (choice.kind === 'food' ? choice.food.id : choice.dish.id)}
      <ChoiceRow {choice} foods={foodMap} onpick={pick} />
    {/each}
    {#each onlineResults as food (food.id)}
      <ChoiceRow choice={{ kind: 'food', food }} foods={foodMap} onpick={pick} />
    {/each}
  </div>
  <p class="notice" aria-live="polite">{notice}</p>
  <div class="actions">
    <button type="button" disabled={busy} onclick={askOnline}>{t.add.searchOff}</button>
    {#if oncreate}
      <button type="button" onclick={() => oncreate(query.trim())}>{t.add.newFood}</button>
    {/if}
  </div>
{:else}
  {@render children?.()}
{/if}

<style>
  .bar {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0 12px;
    font: inherit;
    color: inherit;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .notice {
    min-height: 1.4em;
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 14px;
  }

  .notice:empty {
    display: none;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }
</style>
