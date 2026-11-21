<script lang="ts">
  import { formatInput as format, parseInput as parse } from './dates';

  /** Number field with a unit, written the way the locale writes numbers. An empty field is null. */
  let {
    value = $bindable<number | null>(null),
    label,
    unit = '',
    autofocus = false,
    invalid = false,
    compact = false,
    hideLabel = false,
  }: {
    value?: number | null;
    label: string;
    unit?: string;
    autofocus?: boolean;
    invalid?: boolean;
    compact?: boolean;
    hideLabel?: boolean;
  } = $props();

  let text = $state(value === null ? '' : format(value));

  // Take over values set from outside, for example by a serving shortcut.
  $effect(() => {
    if (parse(text) !== value) text = value === null ? '' : format(value);
  });
</script>

<label class="field" class:compact>
  <span class="label" class:visually-hidden={compact || hideLabel}>{label}</span>
  <span class="box" class:invalid>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      inputmode="decimal"
      autocomplete="off"
      {autofocus}
      aria-invalid={invalid || undefined}
      value={text}
      oninput={(event) => {
        text = event.currentTarget.value;
        value = parse(text);
      }}
    />
    {#if unit}<span class="unit">{unit}</span>{/if}
  </span>
</label>

<style>
  .field {
    display: block;
  }

  .label {
    display: block;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 4px;
  }

  .box {
    display: flex;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    min-height: 44px;
    padding: 0 12px;
  }

  .box:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .box.invalid {
    border-color: var(--danger);
  }

  input {
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 42px;
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
    color: inherit;
    font-variant-numeric: tabular-nums;
  }

  input:focus {
    outline: none;
  }

  .unit {
    color: var(--muted);
    font-size: 14px;
    padding-left: 6px;
    white-space: nowrap;
  }

  .compact {
    width: 108px;
    flex: none;
  }

  .compact input {
    text-align: right;
  }
</style>
