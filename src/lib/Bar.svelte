<script lang="ts">
  /** Progress bar. If the goal is exceeded, it stays full and does not change color. */
  let { value, max, thin = false }: { value: number; max: number; thin?: boolean } = $props();
  const share = $derived(max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0);
</script>

<div class="bar" class:thin aria-hidden="true"><i style:width="{share}%"></i></div>

<style>
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
  }

  .thin {
    height: 4px;
  }

  i {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
  }
</style>
