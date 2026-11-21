/**
 * Tracks whether the phone keyboard is open and how much of the screen it covers.
 *
 * Android Chrome shrinks the page itself (see `interactive-widget` in index.html);
 * then nothing is covered and `--keyboard` stays 0. Where the browser does not do this (iPhone),
 * `--keyboard` holds the covered height, and the sheets move up by that much.
 */
export const keyboard = $state({ open: false });

export function startKeyboard(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;

  // Largest height seen at this width: the screen without keyboard.
  let width = viewport.width;
  let full = viewport.height;

  const update = () => {
    // Zooming in also shrinks the visible area; that is not a keyboard.
    if (viewport.scale > 1.01) return;
    if (Math.abs(viewport.width - width) > 1) {
      width = viewport.width;
      full = viewport.height;
    }
    full = Math.max(full, viewport.height);
    keyboard.open = viewport.height < full - 120;
    const covered = keyboard.open ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard', `${Math.round(covered)}px`);
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
}
