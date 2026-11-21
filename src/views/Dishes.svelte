<script lang="ts">
  import { formatNumber } from '../lib/dates';
  import { dishPer100, itemsTotal } from '../lib/nutrition';
  import { useDishes, useFoods, useTemplates } from '../lib/stores.svelte';
  import { t } from '../lib/texts';

  const foods = useFoods();
  const dishes = useDishes();
  const templates = useTemplates();
</script>

<h1>{t.dishes.title}</h1>

<div class="grid2">
  <a class="button" href="#/dish/new">{t.dishes.newDish}</a>
  <a class="button" href="#/template/new">{t.dishes.newTemplate}</a>
</div>

{#if dishes.list.length}
  <p class="section-title">{t.dishes.title}</p>
  {#each dishes.list as dish (dish.id)}
    <a class="list-button" href={'#/dish/' + dish.id}>
      <span>{dish.name}</span>
      <span class="muted">{formatNumber(dishPer100(dish, foods.map).kcal)} {t.n.kcal} {t.common.per} g</span>
    </a>
  {/each}
{/if}

{#if templates.list.length}
  <p class="section-title">{t.dishes.templates}</p>
  {#each templates.list as template (template.id)}
    <a class="list-button" href={'#/template/' + template.id}>
      <span>{template.name}</span>
      <span class="muted">{formatNumber(itemsTotal(template.items, foods.map, dishes.map).kcal)} {t.n.kcal}</span>
    </a>
  {/each}
{/if}
