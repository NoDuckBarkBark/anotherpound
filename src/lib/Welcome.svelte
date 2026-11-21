<script lang="ts">
  import { keepPack } from './catalog';
  import LanguageCountry from './LanguageCountry.svelte';
  import { chosenRegion, region, setRegion } from './regions';
  import Sheet from './Sheet.svelte';
  import { t } from './texts';

  /** First start: language and country, prefilled from the device. Closing keeps what is shown. */
  let open = $state(chosenRegion() === null);
  let country = $state(region);

  function done() {
    open = false;
    setRegion(country);
    void keepPack();
  }
</script>

<Sheet {open} label="AnotherPound" onclose={done}>
  <h2>AnotherPound</h2>
  <div class="choices">
    <LanguageCountry bind:country labelled />
  </div>
  <div class="sheet-actions">
    <!-- svelte-ignore a11y_autofocus -->
    <button type="button" class="primary wide" autofocus onclick={done}>{t.welcome.start}</button>
  </div>
</Sheet>

<style>
  .choices {
    margin: 14px 0 18px;
  }
</style>
