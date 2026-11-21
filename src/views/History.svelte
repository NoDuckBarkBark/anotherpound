<script lang="ts">
  import { addDays, formatAmount, formatNumber, formatShort, formatSigned, todayKey, weekStart } from '../lib/dates';
  import { db, type Entry, type Weight } from '../lib/db';
  import { goalFor } from '../lib/goals';
  import Icon from '../lib/Icon.svelte';
  import { live } from '../lib/live.svelte';
  import { scale, total } from '../lib/nutrition';
  import { removeWeight } from '../lib/records';
  import Sheet from '../lib/Sheet.svelte';
  import { ui } from '../lib/state.svelte';
  import { useGoals } from '../lib/stores.svelte';
  import { t } from '../lib/texts';
  import WeightForm from '../lib/WeightForm.svelte';
  import { trendSeries, weeklyRate } from '../lib/trend';

  // Week
  let start = $state(weekStart(ui.day));
  const goals = useGoals();
  const entries = live(
    () => start,
    (from) =>
      db.entries
        .where('date')
        .between(from, addDays(from, 6), true, true)
        .filter((entry) => !entry.deleted)
        .toArray(),
    [] as Entry[],
  );

  const days = $derived(
    Array.from({ length: 7 }, (_, index) => {
      const day = addDays(start, index);
      const list = entries.value.filter((entry) => entry.date === day);
      return { day, sum: total(list.map((entry) => entry.nutrients)), logged: list.length > 0, goal: goalFor(day, goals.value) };
    }),
  );
  const logged = $derived(days.filter((day) => day.logged));
  const average = $derived(logged.length ? scale(total(logged.map((day) => day.sum)), 1 / logged.length) : undefined);
  const top = $derived(Math.max(1, ...days.map((day) => Math.max(day.sum.kcal, day.goal?.kcal ?? 0))));

  const SLOT = 44;
  const BASE = 112;
  const HEIGHT = 92;
  const y = (kcal: number) => BASE - (kcal / top) * HEIGHT;
  /** The number sits above the bar; if the goal line is there, it moves above the line. */
  function labelY(kcal: number, goal: number | undefined): number {
    const bar = y(kcal);
    if (goal === undefined) return bar - 4;
    const line = y(goal);
    return line > bar - 16 && line < bar ? line - 4 : bar - 4;
  }

  // Weight
  const weights = live(
    () => 0,
    () => db.weights.toArray(),
    [] as Weight[],
  );
  const active = $derived(weights.value.filter((weight) => !weight.deleted).sort((a, b) => a.date.localeCompare(b.date)));
  const series = $derived(trendSeries(active));
  const rate = $derived(weeklyRate(series));
  const latest = $derived(series.at(-1));
  const shown = $derived(series.filter((point) => point.date >= addDays(todayKey(), -90)));

  let weighing = $state(false);

  const W = 320;
  const H = 150;
  const PAD = { left: 34, right: 8, top: 10, bottom: 22 };
  const chart = $derived.by(() => {
    if (shown.length < 2) return undefined;
    const first = shown[0]!.date;
    const span = Math.max(1, dayIndex(shown.at(-1)!.date, first));
    const values = shown.flatMap((point) => [point.kg, point.trend]);
    const low = Math.floor(Math.min(...values) - 0.5);
    const high = Math.ceil(Math.max(...values) + 0.5);
    const px = (date: string) => PAD.left + (dayIndex(date, first) / span) * (W - PAD.left - PAD.right);
    const py = (value: number) => PAD.top + ((high - value) / (high - low)) * (H - PAD.top - PAD.bottom);
    return {
      low,
      high,
      first,
      last: shown.at(-1)!.date,
      points: shown.map((point) => ({ x: px(point.date), y: py(point.kg) })),
      line: shown.map((point) => `${px(point.date).toFixed(1)},${py(point.trend).toFixed(1)}`).join(' '),
    };
  });

  function dayIndex(date: string, from: string): number {
    return Math.round((Date.parse(date + 'T12:00:00') - Date.parse(from + 'T12:00:00')) / 86_400_000);
  }
</script>

<h1>{t.history.title}</h1>

<section class="card">
  <div class="row">
    <button class="icon" aria-label={t.history.prevWeek} onclick={() => (start = addDays(start, -7))}>
      <Icon name="left" />
    </button>
    <h2>{formatShort(start)} – {formatShort(addDays(start, 6))}</h2>
    <button class="icon" aria-label={t.history.nextWeek} onclick={() => (start = addDays(start, 7))}>
      <Icon name="right" />
    </button>
  </div>

  <svg viewBox="0 0 {SLOT * 7} 132" role="img" aria-label={t.history.title}>
    {#each days as day, index (day.day)}
      {@const x = index * SLOT}
      {#if day.logged}
        <rect x={x + 9} y={y(day.sum.kcal)} width={SLOT - 18} height={BASE - y(day.sum.kcal)} rx="3" class="bar" />
        <text x={x + SLOT / 2} y={labelY(day.sum.kcal, day.goal?.kcal)} class="value">{formatNumber(day.sum.kcal)}</text>
      {/if}
      {#if day.goal}
        <line x1={x} x2={x + SLOT} y1={y(day.goal.kcal)} y2={y(day.goal.kcal)} class="goal" />
      {/if}
      <text x={x + SLOT / 2} y="127" class="day" class:today={day.day === todayKey()}>{t.history.days[index]}</text>
    {/each}
    <line x1="0" x2={SLOT * 7} y1={BASE} y2={BASE} class="axis" />
  </svg>

  {#if average}
    <dl class="average">
      <div><dt>{t.history.average}</dt><dd>{formatNumber(average.kcal)} {t.n.kcal}</dd></div>
      <div><dt>{t.n.protein}</dt><dd>{formatNumber(average.protein)} g</dd></div>
      <div><dt>{t.n.carbs}</dt><dd>{formatNumber(average.carbs)} g</dd></div>
      <div><dt>{t.n.fat}</dt><dd>{formatNumber(average.fat)} g</dd></div>
    </dl>
  {/if}
</section>

<section class="card">
  <div class="row">
    <h2>{t.history.weight}</h2>
    {#if latest}
      <p class="muted">
        {t.history.trend}
        {formatAmount(latest.trend)} kg{rate === undefined ? '' : ` · ${formatSigned(Math.round(rate * 100) / 100)} ${t.history.perWeek}`}
      </p>
    {/if}
  </div>

  <button class="wide entry" onclick={() => (weighing = true)}>{t.common.add}</button>

  {#if chart}
    <svg viewBox="0 0 {W} {H}" role="img" aria-label={t.history.weight}>
      <text x="2" y={PAD.top + 4} class="tick">{chart.high}</text>
      <text x="2" y={H - PAD.bottom} class="tick">{chart.low}</text>
      <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} class="axis" />
      <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} class="grid" />
      {#each chart.points as point, index (index)}
        <circle cx={point.x} cy={point.y} r="2.5" class="dot" />
      {/each}
      <polyline points={chart.line} class="trend" />
      <text x={PAD.left} y={H - 6} class="tick">{formatShort(chart.first)}</text>
      <text x={W - PAD.right} y={H - 6} class="tick end">{formatShort(chart.last)}</text>
    </svg>
  {/if}

  {#if active.length}
    <ul>
      {#each [...active].reverse().slice(0, 7) as weight (weight.id)}
        <li class="row">
          <span>{formatShort(weight.date)}</span>
          <span class="row tight">
            {formatAmount(weight.kg)} kg
            <button class="icon small-icon" aria-label={`${t.common.delete}: ${formatShort(weight.date)}`} onclick={() => removeWeight(weight.id)}>
              ×
            </button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<Sheet open={weighing} label={t.history.weight} onclose={() => (weighing = false)}>
  <WeightForm start={active.at(-1)?.kg ?? null} ondone={() => (weighing = false)} />
</Sheet>

<style>
  h2 {
    font-size: 15px;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 10px;
  }

  .bar {
    fill: var(--accent);
  }

  .goal {
    stroke: var(--text);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }

  .axis {
    stroke: var(--line);
    stroke-width: 1;
  }

  .grid {
    stroke: var(--line);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }

  text {
    fill: var(--muted);
    font-size: 10px;
    text-anchor: middle;
  }

  .tick {
    text-anchor: start;
  }

  .tick.end {
    text-anchor: end;
  }

  .day.today {
    fill: var(--text);
    font-weight: 600;
  }

  .dot {
    fill: var(--muted);
  }

  .trend {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .average {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 12px;
    margin: 12px 0 0;
  }

  dt {
    color: var(--muted);
    font-size: 12px;
  }

  dd {
    margin: 0;
    font-size: 14px;
  }

  .entry {
    margin-top: 12px;
  }

  ul {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }

  li {
    min-height: 40px;
    border-top: 1px solid var(--line);
  }

  .tight {
    gap: 6px;
  }

  .small-icon {
    width: 36px;
    min-height: 36px;
    border: 0;
    background: none;
    font-size: 20px;
    line-height: 1;
    color: var(--muted);
  }
</style>
