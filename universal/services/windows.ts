/**
 * In-app navigation for "detached" views.
 *
 * Editors, run history, and terminals used to open in their own desktop
 * OS window. They now render inline as ordinary pushed routes in every
 * environment — one window, one content area — so `openDetached` is just
 * a `router.push` and `closeDetached` pops the stack. The desktop
 * multi-window story is handled separately: `openNewMainWindow` opens a
 * second *full* app window that shares this one's live connection through
 * the primary window's WS relay (see desktop/src/main.ts).
 *
 * Callers pass a relative route (no leading slash, e.g. ``workflows/abc``
 * or ``tasks/runs/abc``).
 */

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

/** Running inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return desktop()?.isDesktop === true;
}

/** A secondary desktop window that relays its WS through the primary. */
export function isDesktopChild(): boolean {
  return desktop()?.isChild === true;
}

/**
 * Navigate to ``route`` inline (a pushed full-screen route). ``route`` is
 * relative with no leading slash — e.g. ``workflows/abc``, ``tasks/new``,
 * ``tasks/runs/abc``.
 */
export function openDetached(router: RouterLike, route: string): void {
  const normalized = route.replace(/^\/+/, '');
  router.push(`/${normalized}` as any);
}

/**
 * Dismiss an inline detail/editor: pop the navigation stack, falling back
 * to the authenticated home when there's nothing to pop (e.g. a
 * deep-linked tab). The fallback is the chat tab — NOT ``/`` (the login
 * screen), which would look like a logout when a sub-screen's back has an
 * empty history.
 */
export function closeDetached(router: RouterLike): void {
  if (router.canGoBack?.()) {
    router.back();
  } else {
    router.replace('/(tabs)/chat' as any);
  }
}

/**
 * Desktop only: open another full app window. It loads the app shell with
 * the ``child`` marker so the connection store tunnels its WebSocket
 * through the primary window's live socket (shared connection) rather than
 * opening a second one. A no-op on web / native, where there is one window.
 */
export function openNewMainWindow(): void {
  const d = desktop();
  if (d?.isDesktop && typeof d.openWindow === 'function') {
    void d.openWindow('chat');
  }
}
