<script lang="ts">
  import Icon from './Icon.svelte';
  import { decimal } from './locale';
  import type { PadKey, PadValue } from './pad.svelte';
  import { t } from './texts';

  /**
   * The app's own number pad: digits, decimal separator, backspace. It is part of the sheet,
   * so nothing slides in and nothing jumps. A physical keyboard works just the same.
   */
  let { model }: { model: PadValue } = $props();

  const keys: PadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'dec', '0', 'back'];

  function onkeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
    const key = event.key === 'Backspace' || event.key === 'Delete' ? 'back' : event.key;
    if (key !== 'back' && key !== ',' && key !== '.' && !/^\d$/.test(key)) return;
    event.preventDefault();
    model.press(key);
  }

  // Keys and choice chips do not take the focus away from the main button: Enter keeps submitting.
  function onpointerdown(event: PointerEvent) {
    if ((event.target as HTMLElement | null)?.closest('dialog .key, dialog .chip')) event.preventDefault();
  }
</script>

<svelte:document {onkeydown} {onpointerdown} />

<div class="pad" role="group" aria-label={t.pad.label}>
  {#each keys as key (key)}
    <button type="button" class="key" aria-label={key === 'back' ? t.pad.back : undefined} onclick={() => model.press(key)}>
      {#if key === 'back'}<Icon name="backspace" size={24} />{:else if key === 'dec'}{decimal}{:else}{key}{/if}
    </button>
  {/each}
</div>

<style>
  .pad {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .key {
    min-height: 52px;
    padding: 0;
    border: 0;
    background: var(--track);
    font-size: 22px;
    font-variant-numeric: tabular-nums;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .key:active {
    background: var(--press);
  }

  @media (max-height: 680px) {
    .key {
      min-height: 46px;
    }
  }
</style>
