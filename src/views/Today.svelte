<script lang="ts">
  import Bar from '../lib/Bar.svelte';
  import { addDays, formatAmount, formatDay, formatNumber, todayKey } from '../lib/dates';
  import { db, type Entry } from '../lib/db';
  import EntryForm from '../lib/EntryForm.svelte';
  import { goalFor } from '../lib/goals';
  import Icon from '../lib/Icon.svelte';
  import { live } from '../lib/live.svelte';
  import { total } from '../lib/nutrition';
  import { formatCount } from '../lib/portions';
  import Sheet from '../lib/Sheet.svelte';
  import { ui } from '../lib/state.svelte';
  import { useGoals, useMealNames } from '../lib/stores.svelte';
  import { t } from '../lib/texts';

  const entries = live(
    () => ui.day,
    (key) =>
      db.entries
        .where('date')
        .equals(key)
        .filter((entry) => !entry.deleted)
        .sortBy('createdAt'),
    [] as Entry[],
  );
  const goals = useGoals();
  const mealNames = useMealNames();

  const sum = $derived(total(entries.value.map((entry) => entry.nutrients)));
  const goal = $derived(goalFor(ui.day, goals.value));
  const left = $derived(goal ? Math.round(goal.kcal) - Math.round(sum.kcal) : 0);
  const meals = $derived(
    mealNames.value.map((name, index) => {
      const items = entries.value.filter((entry) => entry.meal === index);
      return { name, index, items, kcal: items.reduce((kcal, entry) => kcal + entry.nutrients.kcal, 0) };
    }),
  );
  const macros = $derived([
    { label: t.n.protein, value: sum.protein, target: goal?.protein },
    { label: t.n.carbs, value: sum.carbs, target: goal?.carbs },
    { label: t.n.fat, value: sum.fat, target: goal?.fat },
  ]);

  // Show only once everything is loaded: otherwise an empty day without a goal flashes briefly at startup.
  const ready = $derived(entries.ready && goals.ready && mealNames.ready);

  let editing = $state.raw<Entry | null>(null);
</script>

<header class="row">
  <button class="icon" aria-label={t.today.prevDay} onclick={() => (ui.day = addDays(ui.day, -1))}>
    <Icon name="left" />
  </button>
  <div class="date">
    <h1>{formatDay(ui.day)}</h1>
    {#if ui.day !== todayKey()}
      <button class="small" onclick={() => (ui.day = todayKey())}>{t.today.today}</button>
    {/if}
  </div>
  <button class="icon" aria-label={t.today.nextDay} onclick={() => (ui.day = addDays(ui.day, 1))}>
    <Icon name="right" />
  </button>
</header>

{#if ready}
<section class="summary">
  {#if goal}
    <div class="row baseline">
      <p class="total">
        <strong>{formatNumber(Math.abs(left))}</strong>
        {t.n.kcal}
        {left >= 0 ? t.today.left : t.today.over}
      </p>
      <p class="muted">{formatNumber(sum.kcal)} / {formatNumber(goal.kcal)}</p>
    </div>
    <Bar value={sum.kcal} max={goal.kcal} />
  {:else}
    <p class="total"><strong>{formatNumber(sum.kcal)}</strong> {t.n.kcal}</p>
  {/if}

  <dl class="macros">
    {#each macros as macro (macro.label)}
      <div>
        <dt>{macro.label}</dt>
        <dd>
          {formatNumber(macro.value)}{#if macro.target}&nbsp;/ {formatNumber(macro.target)}{/if} g
        </dd>
        {#if macro.target}<Bar value={macro.value} max={macro.target} thin />{/if}
      </div>
    {/each}
  </dl>

  <details>
    <summary>{t.today.more}</summary>
    <dl class="more">
      <div><dt>{t.n.sugarSum}</dt><dd>{formatAmount(sum.sugar ?? 0)} g</dd></div>
      <div><dt>{t.n.satFatSum}</dt><dd>{formatAmount(sum.satFat ?? 0)} g</dd></div>
      <div><dt>{t.n.fiber}</dt><dd>{formatAmount(sum.fiber ?? 0)} g</dd></div>
      <div><dt>{t.n.salt}</dt><dd>{formatAmount(sum.salt ?? 0)} g</dd></div>
    </dl>
  </details>
</section>

{#each meals as meal (meal.index)}
  <section class="meal">
    <div class="row">
      <h2>{meal.name} <span class="muted">{formatNumber(meal.kcal)} {t.n.kcal}</span></h2>
      <a class="button icon round" href={'#/add/' + meal.index} aria-label={t.today.addTo(meal.name)}>
        <Icon name="plus" size={20} />
      </a>
    </div>
    {#if meal.items.length}
      <ul>
        {#each meal.items as entry (entry.id)}
          <li>
            <button class="entry" onclick={() => (editing = entry)}>
              <span class="what">
                {entry.name}
                {#if entry.count && entry.portion}
                  <span class="muted">{formatCount(entry.count, entry.portion)}</span>
                {:else if entry.amount}
                  <span class="muted">{formatAmount(entry.amount)} {entry.unit ?? 'g'}</span>
                {/if}
              </span>
              <span class="kcal">{formatNumber(entry.nutrients.kcal)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/each}
{/if}

<Sheet open={editing !== null} label={editing?.name ?? ''} onclose={() => (editing = null)}>
  {#if editing}
    <EntryForm entry={editing} mealNames={mealNames.value} ondone={() => (editing = null)} />
  {/if}
</Sheet>

<style>
  header {
    margin-bottom: 14px;
  }

  .date {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .date h1 {
    margin: 0;
    font-size: 17px;
  }

  .summary {
    margin-bottom: 6px;
  }

  .baseline {
    align-items: baseline;
    margin-bottom: 6px;
  }

  .total {
    color: var(--muted);
    font-size: 14px;
  }

  .total strong {
    font-size: 30px;
    font-weight: 600;
    color: var(--text);
  }

  .macros {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 12px 0 0;
  }

  dt {
    color: var(--muted);
    font-size: 13px;
  }

  dd {
    margin: 0 0 3px;
    font-variant-numeric: tabular-nums;
  }

  details {
    margin-top: 8px;
  }

  summary {
    color: var(--muted);
    font-size: 13px;
    min-height: 32px;
    display: flex;
    align-items: center;
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::after {
    content: '▾';
    margin-left: 6px;
  }

  details[open] summary::after {
    content: '▴';
  }

  .more {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 12px;
    margin: 0 0 6px;
  }

  .meal {
    border-top: 1px solid var(--line);
    padding: 10px 0 8px;
  }

  .meal h2 .muted {
    font-weight: 400;
    margin-left: 4px;
  }

  .round {
    border-radius: 50%;
    width: 40px;
    min-height: 40px;
    padding: 0;
  }

  ul {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
  }

  .entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 44px;
    padding: 4px 0;
    border: 0;
    border-radius: 0;
    background: none;
    text-align: left;
  }

  .entry:active {
    opacity: 0.55;
  }

  .what {
    overflow-wrap: anywhere;
  }

  .kcal {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
</style>
