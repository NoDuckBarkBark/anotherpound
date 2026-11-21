<script lang="ts" module>
  export const icons = {
    today: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 3v4M16 3v4M3 10h18',
    dishes: 'M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-6zM2 10h20M9 6h6',
    history: 'M3 17l6-6 4 4 8-8M3 21h18',
    more: 'M4 6h16M4 12h16M4 18h16',
    barcode: 'M4 6v12M7 6v12M11 6v12M14 6v12M17 6v12M20 6v12',
    left: 'M15 6l-6 6 6 6',
    right: 'M9 6l6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    backspace: 'M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7zM17 9.5l-5 5M12 9.5l5 5',
  } as const;
  export type IconName = keyof typeof icons;
</script>

<script lang="ts">
  let { name, size = 22 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={icons[name]} />
</svg>
