/**
 * Short confirmation at the bottom edge: what just happened, with "Undo".
 * There is only ever one; the next replaces the previous.
 */
export interface ToastMessage {
  id: number;
  text: string;
  undo?: () => void | Promise<void>;
}

const VISIBLE = 5000;

export const toast = $state<{ current: ToastMessage | null }>({ current: null });

let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, undo?: () => void | Promise<void>): void {
  clearTimeout(timer);
  toast.current = { id: ++counter, text, undo };
  timer = setTimeout(hideToast, VISIBLE);
}

export function hideToast(): void {
  clearTimeout(timer);
  toast.current = null;
}

/** Undoes the displayed action and hides the confirmation. */
export async function undoToast(): Promise<void> {
  const undo = toast.current?.undo;
  hideToast();
  await undo?.();
}
