/** Small navigation via the URL hash (#/today). Works on any static host. */

function current(): string {
  return location.hash.replace(/^#\/?/, '') || 'today';
}

export const route = $state({ path: current() });

addEventListener('hashchange', () => {
  route.path = current();
  // Every view starts at the top instead of inheriting the scroll position of the previous one.
  scrollTo(0, 0);
});

export function go(path: string): void {
  location.hash = '/' + path;
}
