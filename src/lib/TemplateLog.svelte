<script lang="ts">
  import { untrack } from 'svelte';
  import { formatNumber } from './dates';
  import type { Dish, Food, Meal, Template } from './db';
  import { logItems, removeEntry } from './diary';
  import NumberField from './NumberField.svelte';
  import { dishPer100, forAmount } from './nutrition';
  import { t } from './texts';
  import { showToast } from './toasts.svelte';

  /** Log a template: all items in one pass, amounts changeable individually, items can be deselected. */
  let {
    template,
    meal,
    date,
    foods,
    dishes,
    ondone,
  }: {
    template: Template;
    meal: Meal;
    date: string;
    foods: Map<string, Food>;
    dishes: Map<string, Dish>;
    ondone: () => void;
  } = $props();

  let rows = $state(
    untrack(() => template.items).flatMap((item) => {
      const name = item.kind === 'food' ? foods.get(item.refId)?.name : dishes.get(item.refId)?.name;
      const unit = item.kind === 'food' ? (foods.get(item.refId)?.unit ?? 'g') : 'g';
      return name ? [{ ...item, name, unit, amount: item.amount as number | null, on: true }] : [];
    }),
  );
  let saving = $state(false);

  function kcalOf(row: (typeof rows)[number]): number {
    if (!row.on || !row.amount) return 0;
    if (row.kind === 'food') {
      const food = foods.get(row.refId);
      return food ? forAmount(food.per100, row.amount).kcal : 0;
    }
    const dish = dishes.get(row.refId);
    return dish ? forAmount(dishPer100(dish, foods), row.amount).kcal : 0;
  }

  const totalKcal = $derived(rows.reduce((sum, row) => sum + kcalOf(row), 0));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const entries = await logItems(
      rows.flatMap((row) => (row.on && row.amount ? [{ kind: row.kind, refId: row.refId, amount: row.amount }] : [])),
      meal,
      date,
    );
    if (entries.length) {
      showToast(`${template.name} · ${t.toast.entries(entries.length)}`, async () => {
        for (const entry of entries) await removeEntry(entry.id);
      });
    }
    ondone();
  }
</script>

<form class="stack" onsubmit={submit}>
  <h2>{template.name}</h2>

  <ul>
    {#each rows as row, index (index)}
      <li class="row">
        <label class="item">
          <input type="checkbox" bind:checked={row.on} />
          <span>{row.name}</span>
        </label>
        <NumberField bind:value={row.amount} label={`${t.common.amount} ${row.name}`} unit={row.unit} compact />
      </li>
    {/each}
  </ul>

  <div class="row sheet-actions">
    <p class="total"><strong>{formatNumber(totalKcal)}</strong> {t.n.kcal}</p>
    <button class="primary" type="submit" disabled={saving}>{t.common.add}</button>
  </div>
</form>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .total strong {
    font-size: 20px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .sheet-actions button {
    flex: 1;
    max-width: 60%;
  }

  input[type='checkbox'] {
    width: 20px;
    height: 20px;
    flex: none;
    accent-color: var(--accent);
  }
</style>
