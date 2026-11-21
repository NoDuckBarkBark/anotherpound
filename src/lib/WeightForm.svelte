<script lang="ts">
  import { untrack } from 'svelte';
  import { todayKey } from './dates';
  import NumberPad from './NumberPad.svelte';
  import { PadValue } from './pad.svelte';
  import PadDisplay from './PadDisplay.svelte';
  import { saveWeight } from './records';
  import { t } from './texts';

  /** Record today's weight. Prefilled with the last value; the first digit replaces it. */
  let { start, ondone }: { start: number | null; ondone: () => void } = $props();

  const pad = new PadValue(untrack(() => start));
  const valid = $derived(pad.value !== null && pad.value > 0);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!valid) return;
    await saveWeight(todayKey(), pad.value!);
    ondone();
  }
</script>

<form class="stack" onsubmit={submit}>
  <h2>{t.history.weight}</h2>
  <PadDisplay model={pad} label={t.history.weight} unit="kg" />
  <NumberPad model={pad} />
  <!-- svelte-ignore a11y_autofocus -->
  <button class="primary wide" type="submit" autofocus aria-disabled={!valid || undefined}>{t.common.add}</button>
</form>

<style>
  h2 {
    font-size: 18px;
  }
</style>
