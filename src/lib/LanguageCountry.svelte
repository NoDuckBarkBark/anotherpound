<script lang="ts">
  import { chosenLanguage, LANGUAGES, setLanguage } from './locale';
  import { regionChoices, type Region } from './regions';
  import { t } from './texts';

  /**
   * Language of the interface and the country whose products the app offers.
   * `labelled` names the language row too, where no heading above does that.
   */
  let {
    country = $bindable(),
    labelled = false,
    onchange,
  }: { country: Region; labelled?: boolean; onchange?: (country: Region) => void } = $props();

  const chosen = chosenLanguage();
  const countries = regionChoices();
</script>

{#if labelled}<span class="field-label">{t.more.language}</span>{/if}
<div class="chips" role="radiogroup" aria-label={t.more.language}>
  <button type="button" class="chip" role="radio" aria-checked={chosen === null} onclick={() => setLanguage(null)}>
    {t.more.languageDevice}
  </button>
  {#each LANGUAGES as option (option.id)}
    <button
      type="button"
      class="chip"
      role="radio"
      lang={option.id}
      aria-checked={chosen === option.id}
      onclick={() => setLanguage(option.id)}
    >
      {option.name}
    </button>
  {/each}
</div>

<label class="country">
  <span class="field-label">{t.more.country}</span>
  <select bind:value={country} onchange={() => onchange?.(country)}>
    {#each countries as option (option.code)}
      <option value={option.code}>{option.name}</option>
    {/each}
  </select>
</label>

<style>
  .country {
    display: block;
    margin-top: 12px;
  }
</style>
