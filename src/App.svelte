<script lang="ts">
  import Icon, { type IconName } from './lib/Icon.svelte';
  import { keyboard } from './lib/keyboard.svelte';
  import { live } from './lib/live.svelte';
  import { route } from './lib/route.svelte';
  import { backupDue } from './lib/storage';
  import { t } from './lib/texts';
  import Toast from './lib/Toast.svelte';
  import Add from './views/Add.svelte';
  import Dishes from './views/Dishes.svelte';
  import DishForm from './views/DishForm.svelte';
  import Goals from './views/Goals.svelte';
  import History from './views/History.svelte';
  import More from './views/More.svelte';
  import TemplateForm from './views/TemplateForm.svelte';
  import Today from './views/Today.svelte';

  const tabs: { path: string; label: string; icon: IconName }[] = [
    { path: 'today', label: t.nav.today, icon: 'today' },
    { path: 'dishes', label: t.nav.dishes, icon: 'dishes' },
    { path: 'history', label: t.nav.history, icon: 'history' },
    { path: 'more', label: t.nav.more, icon: 'more' },
  ];

  const parents: Record<string, string> = { add: 'today', dish: 'dishes', template: 'dishes', goals: 'more' };

  // A dot on "More" while a backup is due.
  const due = live(
    () => route.path,
    () => backupDue(),
    false,
  );

  const section = $derived(route.path.split('/')[0] ?? 'today');
  const activeTab = $derived(parents[section] ?? (tabs.some((tab) => tab.path === section) ? section : 'today'));
</script>

<main>
  {#if section === 'add'}
    <Add />
  {:else if section === 'dishes'}
    <Dishes />
  {:else if section === 'dish'}
    {#key route.path}<DishForm />{/key}
  {:else if section === 'template'}
    {#key route.path}<TemplateForm />{/key}
  {:else if section === 'history'}
    <History />
  {:else if section === 'more'}
    <More />
  {:else if section === 'goals'}
    <Goals />
  {:else}
    <Today />
  {/if}
</main>

<Toast />

<!-- While the keyboard is open the bar steps aside: the space belongs to the field being typed in. -->
<nav class="tabs" class:away={keyboard.open} aria-label={t.nav.label}>
  {#each tabs as tab (tab.path)}
    <a href={'#/' + tab.path} aria-current={activeTab === tab.path ? 'page' : undefined}>
      <span class="mark">
        <Icon name={tab.icon} />
        {#if tab.path === 'more' && due.value}<span class="dot" role="img" aria-label={t.more.backupDue}></span>{/if}
      </span>
      {tab.label}
    </a>
  {/each}
</nav>

<style>
  main {
    flex: 1;
    padding: 12px 16px calc(76px + env(safe-area-inset-bottom));
  }

  .tabs {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom);
  }

  .away {
    display: none;
  }

  .tabs a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 58px;
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
  }

  .mark {
    position: relative;
    display: flex;
  }

  .mark .dot {
    position: absolute;
    top: -2px;
    right: -6px;
    margin: 0;
  }

  .tabs a:active {
    background: var(--track);
  }

  .tabs a[aria-current='page'] {
    color: var(--text);
    font-weight: 600;
  }
</style>
