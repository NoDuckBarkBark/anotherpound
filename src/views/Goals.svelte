<script lang="ts">
  import { formatAmount, formatNumber, formatSigned, todayKey } from '../lib/dates';
  import { db, getSetting, setSetting } from '../lib/db';
  import {
    expenditure,
    goalFor,
    PAL_LEVELS,
    PROTEIN_LEVELS,
    RATES,
    suggest,
    type Profile,
    type Sex,
  } from '../lib/goals';
  import Icon from '../lib/Icon.svelte';
  import NumberField from '../lib/NumberField.svelte';
  import { saveGoal } from '../lib/records';
  import { go } from '../lib/route.svelte';
  import { t } from '../lib/texts';

  let sex = $state<Sex>('m');
  let birthYear = $state<number | null>(null);
  let heightCm = $state<number | null>(null);
  let weightKg = $state<number | null>(null);
  let pal = $state<number>(PAL_LEVELS[1]);
  let sport = $state(false);
  let kgPerWeek = $state<number>(0);
  let proteinPerKg = $state<number>(PROTEIN_LEVELS[1]);

  let kcal = $state<number | null>(null);
  let protein = $state<number | null>(null);
  let carbs = $state<number | null>(null);
  let fat = $state<number | null>(null);

  let triedCalc = $state(false);
  let triedSave = $state(false);

  void (async () => {
    const stored = await getSetting<Profile>('profile');
    if (stored) {
      sex = stored.sex;
      birthYear = stored.birthYear;
      heightCm = stored.heightCm;
      weightKg = stored.weightKg;
      pal = stored.pal;
      sport = stored.sport;
      kgPerWeek = stored.kgPerWeek;
      proteinPerKg = stored.proteinPerKg;
    }
    const weights = (await db.weights.toArray()).filter((weight) => !weight.deleted);
    const latest = weights.sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (latest) weightKg = latest.kg;

    const goal = goalFor(todayKey(), await db.goals.toArray());
    if (goal) {
      kcal = goal.kcal;
      protein = goal.protein;
      carbs = goal.carbs;
      fat = goal.fat;
    }
  })();

  const profile = $derived<Profile | undefined>(
    birthYear && heightCm && weightKg
      ? { sex, birthYear, heightCm, weightKg, pal, sport, kgPerWeek, proteinPerKg }
      : undefined,
  );
  const need = $derived(profile ? expenditure(profile) : undefined);

  function calculate() {
    triedCalc = true;
    if (!profile) return;
    const suggestion = suggest(profile);
    kcal = suggestion.kcal;
    protein = suggestion.protein;
    carbs = suggestion.carbs;
    fat = suggestion.fat;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    triedSave = true;
    if (kcal === null || protein === null || carbs === null || fat === null) return;

    await saveGoal(todayKey(), { kcal, protein, carbs, fat });
    if (profile) await setSetting('profile', profile);
    go('more');
  }
</script>

<form onsubmit={save}>
  <div class="topbar">
    <a class="button icon" href="#/more" aria-label={t.common.back}><Icon name="left" /></a>
    <h1>{t.goals.title}</h1>
    <button class="primary" type="submit">{t.common.save}</button>
  </div>

  <section class="card stack">
    <h2>{t.goals.target}</h2>
    <NumberField bind:value={kcal} label={t.n.kcal} unit={t.n.kcal} invalid={triedSave && kcal === null} />
    <div class="grid3">
      <NumberField bind:value={protein} label={t.n.protein} unit="g" invalid={triedSave && protein === null} />
      <NumberField bind:value={carbs} label={t.n.carbs} unit="g" invalid={triedSave && carbs === null} />
      <NumberField bind:value={fat} label={t.n.fat} unit="g" invalid={triedSave && fat === null} />
    </div>
  </section>

  <section class="card stack">
    <div class="chips" role="radiogroup" aria-label={t.goals.sex}>
      <button type="button" class="chip" role="radio" aria-checked={sex === 'm'} onclick={() => (sex = 'm')}>
        {t.goals.male}
      </button>
      <button type="button" class="chip" role="radio" aria-checked={sex === 'w'} onclick={() => (sex = 'w')}>
        {t.goals.female}
      </button>
    </div>

    <div class="grid3">
      <NumberField bind:value={birthYear} label={t.goals.birthYear} invalid={triedCalc && !birthYear} />
      <NumberField bind:value={heightCm} label={t.goals.height} unit="cm" invalid={triedCalc && !heightCm} />
      <NumberField bind:value={weightKg} label={t.goals.weight} unit="kg" invalid={triedCalc && !weightKg} />
    </div>

    <div>
      <span class="field-label">{t.goals.activity}</span>
      <div class="chips" role="radiogroup" aria-label={t.goals.activity}>
        {#each PAL_LEVELS as level, index (level)}
          <button type="button" class="chip" role="radio" aria-checked={pal === level} onclick={() => (pal = level)}>
            {t.goals.pal[index]}
          </button>
        {/each}
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={sport} />
        {t.goals.sport}
      </label>
    </div>

    <div>
      <span class="field-label">{t.goals.rate} · {t.goals.rateUnit}</span>
      <div class="chips" role="radiogroup" aria-label={t.goals.rate}>
        {#each RATES as rate (rate)}
          <button type="button" class="chip" role="radio" aria-checked={kgPerWeek === rate} onclick={() => (kgPerWeek = rate)}>
            {rate === 0 ? '0' : formatSigned(rate)}
          </button>
        {/each}
      </div>
    </div>

    <div>
      <span class="field-label">{t.goals.proteinPerKg}</span>
      <div class="chips" role="radiogroup" aria-label={t.goals.proteinPerKg}>
        {#each PROTEIN_LEVELS as level (level)}
          <button type="button" class="chip" role="radio" aria-checked={proteinPerKg === level} onclick={() => (proteinPerKg = level)}>
            {formatAmount(level)} g
          </button>
        {/each}
      </div>
    </div>

    <div class="row">
      <span class="muted">{#if need}{t.goals.need} {formatNumber(need)} {t.n.kcal}{/if}</span>
      <button type="button" onclick={calculate}>{t.goals.calc}</button>
    </div>
  </section>
</form>

<style>
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-top: 6px;
  }

  .check input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
</style>
