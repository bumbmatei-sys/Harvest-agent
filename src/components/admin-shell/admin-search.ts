/**
 * One opener for the admin command palette.
 *
 * The palette and the ⌘K / Ctrl-K listener live on AdminDesktopSidebar, which
 * is the component that already owned them. The content-bar pill calls
 * `openAdminSearch` instead of registering a second hotkey.
 */
type OpenFn = () => void;

const listeners = new Set<OpenFn>();

export function openAdminSearch(): void {
  for (const fn of listeners) fn();
}

export function subscribeAdminSearch(fn: OpenFn): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let hotkeyClaims = 0;

/** A screen with its own ⌘K / Ctrl-K takes the key; the admin palette's hotkey stands down until released. */
export function claimAdminSearchHotkey(): () => void {
  hotkeyClaims += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hotkeyClaims -= 1;
  };
}

export function isAdminSearchHotkeyClaimed(): boolean {
  return hotkeyClaims > 0;
}
