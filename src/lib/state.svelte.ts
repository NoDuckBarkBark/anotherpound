import { todayKey } from './dates';

/** State that survives screen changes: the selected day. */
export const ui = $state({ day: todayKey() });
