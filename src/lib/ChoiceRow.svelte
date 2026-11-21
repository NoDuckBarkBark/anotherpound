<script lang="ts">
  import type { Choice } from './catalog';
  import { formatAmount, formatNumber } from './dates';
  import type { Food } from './db';
  import { dishPer100, forAmount } from './nutrition';
  import { formatCount, startFor } from './portions';
  import { t } from './texts';

  /** A row in lists of foods and dishes. The whole row is a button. */
  let {
    choice,
    foods,
    onpick,
  }: { choice: Choice; foods: Map<string, Food>; onpick: (choice: Choice) => void } = $props();

  const name = $derived(choice.kind === 'food' ? choice.food.name : choice.dish.name);
  const unit = $derived(choice.kind === 'food' ? choice.food.unit : 'g');
  const per100 = $derived(choice.kind === 'food' ? choice.food.per100 : dishPer100(choice.dish, foods));
  // The row shows what the amount input will open with.
  const start = $derived(startFor(choice, t.add.portion));
  const kcal = $derived(forAmount(per100, start.amount).kcal);
  const detail = $derived(
    [
      choice.kind === 'food' ? choice.food.brand : t.add.dish,
      start.portion ? formatCount(start.value, start.portion.label) : `${formatAmount(start.amount)} ${unit}`,
      `${formatNumber(kcal)} ${t.n.kcal}`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<button type="button" class="choice" onclick={() => onpick(choice)}>
  <span class="name">{name}</span>
  <span class="muted">{detail}</span>
</button>

<style>
  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1px;
    width: 100%;
    min-height: 52px;
    padding: 6px 0;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: none;
    text-align: left;
  }

  .choice:active {
    opacity: 0.55;
  }

  .name {
    overflow-wrap: anywhere;
  }
</style>
