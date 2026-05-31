/**
 * Detached-view navigation.
 *
 * Some views (the workflow editor, the scheduled-task editor, run
 * history) are better off "detached" from the main shell. On the
 * Electron desktop app that means a real second OS window; on plain
 * web and on native there's only one window, so it means a pushed
 * full-screen route instead.
 *
 * ``openDetached`` papers over that difference: callers pass a relative
 * route (no leading slash, e.g. ``workflows/abc`` or ``tasks/runs/abc``)
 * and get a new window on desktop / a full screen everywhere else. The
 * desktop shell loads the route in a fresh ``BrowserWindow`` with
 * ``?child=1`` (see ``desktop/src/main.ts``), which the tab layout
 * renders chrome-less.
 *
 * ``closeDetached`` is the inverse for a detached screen's back/close
 * control: it closes the OS window when we're in a desktop child
 * window, and otherwise pops the navigation stack.
 */

// Minimal shape of the expo-router ``Router`` we depend on. Typed
// loosely so this module doesn't couple to expo-router's exported
// types (which vary across versions).
type RouterLike = {
  push: (href: any) => void;
  back: () => void;
  replace: (href: any) => void;
  canGoBack?: () => boolean;
};

function desktop(): any {
  if (typeof window === 'undefined') return undefined;
  return (window as any).desktop;
}

/** Running inside the Electron desktop shell (main or child window). */
export function isDesktop(): boolean {
  return desktop()?.isDesktop === true;
}

/** This renderer is a detached desktop child window (``?child=1``). */
export function isDesktopChild(): boolean {
  return desktop()?.isChild === true;
}

/**
 * Open ``route`` detached: a new OS window on desktop, a pushed
 * full-screen route on web / native. ``route`` is relative with no
 * leading slash — e.g. ``workflows/abc``, ``tasks/new``,
 * ``tasks/runs/abc``.
 */
export function openDetached(router: RouterLike, route: string): void {
  const normalized = route.replace(/^\/+/, '');
  const d = desktop();
  if (d?.isDesktop && typeof d.openWindow === 'function') {
    void d.openWindow(normalized);
    return;
  }
  router.push(`/${normalized}` as any);
}

/**
 * Dismiss a detached screen. Closes the OS window when this is a
 * desktop child window; otherwise pops the stack (falling back to the
 * root when there's nothing to pop — e.g. a deep-linked web tab).
 */
export function closeDetached(router: RouterLike): void {
  const d = desktop();
  if (d?.isChild && typeof d.close === 'function') {
    void d.close();
    return;
  }
  if (router.canGoBack?.()) {
    router.back();
  } else {
    router.replace('/' as any);
  }
}
