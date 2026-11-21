<script lang="ts">
  import { t } from './texts';
  import { toast, undoToast } from './toasts.svelte';
</script>

{#if toast.current}
  {#key toast.current.id}
    <div class="toast" role="status">
      <span class="text">{toast.current.text}</span>
      {#if toast.current.undo}
        <button type="button" onclick={undoToast}>{t.common.undo}</button>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(70px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(448px, calc(100vw - 32px));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 48px;
    padding: 4px 6px 4px 14px;
    border-radius: var(--radius);
    background: var(--text);
    color: var(--bg);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    animation: appear 160ms ease-out;
  }

  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    flex: none;
    min-height: 40px;
    padding: 0 10px;
    border: 0;
    background: none;
    color: inherit;
    font-weight: 600;
  }

  button:active {
    opacity: 0.6;
  }

  @keyframes appear {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
