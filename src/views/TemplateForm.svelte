<script lang="ts">
  import type { Choice } from '../lib/catalog';
  import ChoiceRow from '../lib/ChoiceRow.svelte';
  import { db, fresh, type Template, type TemplateItem } from '../lib/db';
  import { ensureFood } from '../lib/diary';
  import FoodSearch from '../lib/FoodSearch.svelte';
  import Icon from '../lib/Icon.svelte';
  import NumberField from '../lib/NumberField.svelte';
  import { go, route } from '../lib/route.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import { useDishes, useFoods } from '../lib/stores.svelte';
  import { t } from '../lib/texts';

  const id = route.path.split('/')[1] ?? 'new';
  const foods = useFoods();
  const dishes = useDishes();

  let existing = $state.raw<Template | undefined>();
  let name = $state('');
  let items = $state<{ kind: 'food' | 'dish'; refId: string; amount: number | null }[]>([]);
  let tried = $state(false);
  let picking = $state(false);

  if (id !== 'new') {
    void db.templates.get(id).then((template) => {
      if (!template) return;
      existing = template;
      name = template.name;
      items = template.items.map((item) => ({ ...item }));
    });
  }

  const cleaned = $derived<TemplateItem[]>(
    items.flatMap((item) => (item.amount && item.amount > 0 ? [{ kind: item.kind, refId: item.refId, amount: item.amount }] : [])),
  );

  const recent = $derived<Choice[]>(
    [
      ...foods.list.map((food): Choice => ({ kind: 'food', food })),
      ...dishes.list.map((dish): Choice => ({ kind: 'dish', dish })),
    ]
      .sort(
        (a, b) =>
          ((b.kind === 'food' ? b.food.lastUsedAt : b.dish.lastUsedAt) ?? 0) -
          ((a.kind === 'food' ? a.food.lastUsedAt : a.dish.lastUsedAt) ?? 0),
      )
      .slice(0, 30),
  );

  function labelOf(item: { kind: 'food' | 'dish'; refId: string }) {
    if (item.kind === 'food') {
      const food = foods.map.get(item.refId);
      return { name: food?.name ?? '–', unit: food?.unit ?? 'g' };
    }
    return { name: dishes.map.get(item.refId)?.name ?? '–', unit: 'g' };
  }

  async function picked(choice: Choice) {
    if (choice.kind === 'food') {
      const stored = await ensureFood(choice.food);
      items.push({ kind: 'food', refId: stored.id, amount: stored.lastAmount ?? 100 });
    } else {
      items.push({ kind: 'dish', refId: choice.dish.id, amount: choice.dish.lastAmount ?? 100 });
    }
    picking = false;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    if (name.trim() === '' || !cleaned.length) return;
    await db.templates.put({
      ...(existing ?? fresh()),
      updatedAt: Date.now(),
      deleted: 0,
      name: name.trim(),
      items: cleaned,
    });
    go('dishes');
  }

  async function remove() {
    if (existing) await db.templates.update(existing.id, { deleted: 1, updatedAt: Date.now() });
    go('dishes');
  }
</script>

<form onsubmit={save}>
  <div class="topbar">
    <a class="button icon" href="#/dishes" aria-label={t.common.back}><Icon name="left" /></a>
    <h1>{t.dishes.template}</h1>
    <button class="primary" type="submit">{t.common.save}</button>
  </div>

  <div class="stack">
    <label>
      <span class="field-label">{t.common.name}</span>
      <input type="text" autocomplete="off" aria-invalid={(tried && name.trim() === '') || undefined} bind:value={name} />
    </label>

    <div>
      <p class="section-title first">{t.dishes.items}</p>
      <ul>
        {#each items as item, index (index)}
          {@const label = labelOf(item)}
          <li class="row">
            <span class="what">{label.name}</span>
            <NumberField bind:value={item.amount} label={`${t.common.amount} ${label.name}`} unit={label.unit} compact />
            <button type="button" class="icon small-icon" aria-label={`${t.common.remove}: ${label.name}`} onclick={() => items.splice(index, 1)}>
              ×
            </button>
          </li>
        {/each}
      </ul>
      <button type="button" class="wide" class:missing={tried && !cleaned.length} onclick={() => (picking = true)}>
        {t.dishes.addItem}
      </button>
    </div>

    {#if existing}
      <button type="button" onclick={remove}>{t.common.delete}</button>
    {/if}
  </div>
</form>

<Sheet open={picking} label={t.dishes.addItem} onclose={() => (picking = false)}>
  <FoodSearch foods={foods.list} foodMap={foods.map} dishes={dishes.list} onpick={picked}>
    {#each recent as choice (choice.kind === 'food' ? choice.food.id : choice.dish.id)}
      <ChoiceRow {choice} foods={foods.map} onpick={picked} />
    {/each}
  </FoodSearch>
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
</style>
