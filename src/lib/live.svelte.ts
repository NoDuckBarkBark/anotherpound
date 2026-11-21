import { liveQuery } from 'dexie';

/**
 * Keeps a database query current: reruns when the data or the
 * dependency changes (for example the selected day).
 */
export function live<K, T>(dependency: () => K, query: (key: K) => Promise<T>, initial: T) {
  // Kept raw: results are replaced as a whole and must stay storable (no proxies).
  let value = $state.raw<T>(initial);
  /** True as soon as the first result is in. Before that, `value` holds only the placeholder. */
  let ready = $state(false);

  $effect(() => {
    const key = dependency();
    const subscription = liveQuery(() => query(key)).subscribe({
      next: (result) => {
        value = result;
        ready = true;
      },
      error: (error) => console.error(error),
    });
    return () => subscription.unsubscribe();
  });

  return {
    get value() {
      return value;
    },
    get ready() {
      return ready;
    },
  };
}
