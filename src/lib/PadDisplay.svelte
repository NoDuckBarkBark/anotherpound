<script lang="ts">
  import type { PadValue } from './pad.svelte';

  /** Large display of the typed number. An untouched value is highlighted: the first digit replaces it. */
  let { model, label, unit = '' }: { model: PadValue; label: string; unit?: string } = $props();
</script>

<p class="display" role="status" aria-label={label}>
  <span class="number" class:fresh={model.fresh && model.text !== ''} class:empty={model.text === ''}>
    {model.text === '' ? '0' : model.text}
  </span>
  {#if unit}<span class="unit">{unit}</span>{/if}
</p>

<style>
  .display {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
    min-width: 0;
  }

  .number {
    font-size: 34px;
    font-weight: 600;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    padding: 0 6px;
    margin-left: -6px;
    border-radius: 8px;
  }

  .fresh {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }

  .empty {
    color: var(--muted);
  }

  .unit {
    color: var(--muted);
    font-size: 15px;
    overflow-wrap: anywhere;
  }
</style>
