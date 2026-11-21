<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from './texts';

  /**
   * Sheet that opens from the bottom. The content is rebuilt on every opening.
   * It always sits above the phone keyboard and is at most as tall as the free space.
   */
  let {
    open,
    label,
    onclose,
    children,
  }: { open: boolean; label: string; onclose: () => void; children: Snippet } = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  aria-label={label}
  onclose={onclose}
  onclick={(event) => {
    if (event.target === dialog) onclose();
  }}
>
  {#if open}
    <div class="sheet-body">
      {@render children()}
      <!-- Gets focus on opening if the content sets no starting point of its own. This way the
           keyboard only pops up where typing should start right away. Placed last, so the content takes precedence. -->
      <!-- svelte-ignore a11y_autofocus -->
      <button type="button" class="icon close" aria-label={t.common.close} autofocus onclick={onclose}>
        <Icon name="close" size={20} />
      </button>
    </div>
  {/if}
</dialog>

<style>
  .sheet {
    /* --keyboard is only greater than zero where the browser does not make room for the keyboard itself. */
    margin: auto auto var(--keyboard, 0px);
    width: min(480px, 100vw);
    max-width: 100vw;
    max-height: calc(100dvh - var(--keyboard, 0px) - 24px);
    padding: 0;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 16px 16px 0 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sheet[open] {
    animation: rise 200ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }

  .sheet[open]::backdrop {
    animation: dim 200ms ease-out;
  }

  .sheet-body {
    position: relative;
    padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  }

  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 40px;
    min-height: 40px;
    border: 0;
    background: none;
    color: var(--muted);
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes dim {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet[open],
    .sheet[open]::backdrop {
      animation: none;
    }
  }
</style>
