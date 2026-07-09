/**
 * Connection state with multi-account support.
 *
 * Accounts represent ``handle@network`` memberships persisted via the
 * storage service (electron-store on desktop, localStorage on web).
 * Connecting an account spawns the loopback sidecar (handled by the
 * Electron main process) which exposes a localhost port that proxies
 * HTTP/WS over the Iroh transport. The renderer keeps using ``fetch``
 * and ``WebSocket`` against ``http://127.0.0.1:<sidecarPort>`` exactly
 * like before — auth + transport are below the visible layer.
 *
 * Passwords are never persisted: the user is prompted on every
 * connect (the cert TTL bounds re-prompt frequency to ~30 days when
 * the cached cert is still valid).
 */

import { create } from 'zustand';
import type { ConnectionConfig, SavedAccount } from '../../common/types';
import { OpenAgentWS } from '../services/ws';
import { setBaseUrl, fetchSessions } from '../services/api';
import * as storage from '../services/storage';
import { useChat } from './chat';

const STORAGE_KEY = 'openagent:accounts';
const ACTIVE_CONNECTION_KEY = 'openagent:activeConnection';

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Translate a raw loopback / coordinator failure into something a human
 * can act on. The desktop bridge surfaces the Python child's stderr
 * verbatim — that's noisy ("loopback exited before printing port
 * (code=1); stderr: …") and leaks internal terminology. We strip the
 * envelope, then map the known coordinator error codes to plain
 * sentences. Anything we don't recognise falls through cleaned-up but
 * intact so we don't hide unexpected failures.
 */
function humanizeLoginError(raw: string | undefined | null): string {
  if (!raw) return 'Something went wrong. Please try again.';
  let msg = String(raw);

  // Drop the loopback envelope from the desktop bridge.
  msg = msg.replace(/^Error invoking remote method [^:]+: ?/, '');
  msg = msg.replace(/^Error: /, '');
  msg = msg.replace(/^loopback exited before printing port \(code=\d+\); stderr: ?/, '');
  msg = msg.replace(/^loopback startup timed out after \d+ms; stderr: ?/, '');
  // Click leaves a trailing "Aborted!" line on every error.
  msg = msg.replace(/\bAborted!\s*$/, '').trim();

  // Common Python-CLI error prefixes the user shouldn't have to read.
  msg = msg.replace(/^join failed: ?/, '');
  msg = msg.replace(/^login failed: ?/, '');

  const lower = msg.toLowerCase();

  if (lower.includes('unauthorized') || lower.includes('login failed')) {
    return 'Wrong password. Try again — passwords are case-sensitive.';
  }
  if (lower.includes('invalid_invite')) {
    if (lower.includes('different handle')) {
      return 'This invite is bound to a different handle. Ask the owner for one for your handle, or pick a fresh user invite.';
    }
    return 'This invite is no longer valid — expired, already used, or for the wrong role. Ask the network owner for a fresh one.';
  }
  if (lower.includes('handle') && lower.includes('already taken')) {
    const m = msg.match(/'([^']+)'/);
    const taken = m ? m[1] : 'that handle';
    return `“${taken}” is already in use on this network. Pick a different handle and try again.`;
  }
  if (lower.includes('could not reach') || lower.includes('is the openagent server running')) {
    return 'Can’t reach the agent server. Make sure ‘openagent serve’ is running on the host that issued the invite, and that this device has internet access.';
  }
  if (lower.includes('expected handle@network')) {
    return 'Pick a saved network or paste an invite ticket — the field can’t be empty.';
  }
  if (lower.includes('unknown network')) {
    return 'This device doesn’t know that network yet. Use a fresh invite to join from this Mac.';
  }
  if (lower.includes('cert') && lower.includes('expired')) {
    return 'Your saved credentials expired. Sign in again to refresh them.';
  }
  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return 'Can’t reach the agent server. Make sure it’s running and reachable.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'The agent didn’t respond in time. Check that the server is running and try again.';
  }
  if (lower.includes('password is required')) {
    return 'Enter your password to continue.';
  }

  // Trim whitespace + cap length so we never overflow the card.
  msg = msg.trim();
  if (!msg) return 'Something went wrong. Please try again.';
  if (msg.length > 280) msg = msg.slice(0, 277) + '…';

  // Capitalise the first letter for politeness; keep the rest verbatim.
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

interface DesktopAPI {
  startLoopback: (args: {
    accountId: string;
    password: string;
    ticket?: string;
    handle?: string;
    network?: string;
    agent?: string;
  }) => Promise<number>;
  stopLoopback: (args: { accountId: string }) => Promise<void>;
  getLoopbackPort: (accountId: string) => Promise<number | null>;
  /** Open a standalone agent window bound to ``accountId`` (own
   *  connection). Present only in Electron; used for multi-window. */
  openAgentWindow?: (accountId: string) => Promise<void>;
}

function desktop(): DesktopAPI | null {
  // ``window.desktop`` is exposed by the Electron preload. On web this
  // is undefined — the connection flow surfaces a clear error and we
  // skip the sidecar altogether.
  if (typeof window === 'undefined') return null;
  // @ts-ignore — runtime-injected
  const d = (window as any).desktop;
  if (!d || typeof d.startLoopback !== 'function') return null;
  return d as DesktopAPI;
}

const DIRECTED_ACCOUNT_KEY = 'openagent:directedAccount';

/** This renderer is a *directed* (standalone agent) window — it was opened
 *  with ``?connect=<accountId>`` and owns its own connection to that
 *  account. Such windows derive their identity from the URL and must NOT
 *  touch the shared ``ACTIVE_CONNECTION_KEY`` slot (that belongs to the
 *  primary window's cold-start resume).
 *
 *  The ``?connect=`` marker is dropped from the URL once we redirect into
 *  the tab stack, so we mirror it into per-window ``sessionStorage`` (each
 *  Electron BrowserWindow has its own) and fall back to that — this keeps a
 *  standalone window bound to its agent across renderer reloads. Returns the
 *  target accountId, or null for a normal (primary) window. */
export function directedAccountId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('connect');
    if (fromUrl && fromUrl.length > 0) return fromUrl;
    return (window as any).sessionStorage?.getItem(DIRECTED_ACCOUNT_KEY) || null;
  } catch {
    return null;
  }
}

/** Pin the directed account into this window's sessionStorage so a reload
 *  reconnects to it even after we've navigated away from ``/?connect=``. */
export function rememberDirectedAccount(id: string): void {
  if (typeof window === 'undefined') return;
  try { (window as any).sessionStorage?.setItem(DIRECTED_ACCOUNT_KEY, id); } catch { /* ignore */ }
}

export interface JoinNetworkArgs {
  // Single string the user pastes — carries network name, network ID,
  // coordinator NodeId, invite code, role, and (for device tickets)
  // the handle to bind to. Generate one with ``openagent network invite``.
  ticket: string;
  // Required when the ticket is role=user (the new user picks their
  // own handle); ignored for role=device tickets. The CLI re-derives
  // it from the ticket on its end either way.
  handle: string;
  password: string;
  isLocal?: boolean;
  displayName?: string;
}

interface ConnectionState {
  // Persisted
  accounts: SavedAccount[];
  // Runtime
  activeAccountId: string | null;
  config: ConnectionConfig | null;
  ws: OpenAgentWS | null;
  isConnected: boolean;
  isConnecting: boolean;
  /** True between a post-auth WS drop and the next ``auth_ok``. The
   *  reconnect loop in OpenAgentWS still runs whether or not anyone
   *  reads this — the flag just lets the UI surface a "Reconnecting…"
   *  hint instead of letting the chat go silently dead. */
  isReconnecting: boolean;
  agentName: string | null;
  agentVersion: string | null;
  error: string | null;
  isLoading: boolean;

  // Account management
  loadAccounts: () => Promise<void>;
  removeAccount: (id: string) => Promise<void>;

  // Onboarding & connection
  joinNetwork: (args: JoinNetworkArgs) => Promise<void>;
  connectAccount: (accountId: string, password: string) => Promise<void>;
  disconnect: () => Promise<void>;
  resumeConnection: () => Promise<void>;

  // Multi-window (Electron desktop only)
  /** Open ``accountId`` in a *new* standalone window without disturbing
   *  this window's connection. Ensures the account's loopback is up
   *  (spawning it with ``password`` when it isn't yet), then asks the main
   *  process to open a window bound to that account — which connects to the
   *  now-running loopback passwordlessly. Returns ``{ ok }`` so the caller
   *  can surface a humanised error inline. */
  openAccountWindow: (accountId: string, password?: string) => Promise<{ ok: boolean; error?: string }>;
  /** Boot path for a standalone window (``?connect=<id>``): connect to the
   *  account's already-running loopback with no password. No-op when the
   *  loopback isn't up (the window falls back to the login screen). */
  connectDirected: (accountId: string) => Promise<void>;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  accounts: [],
  activeAccountId: null,
  config: null,
  ws: null,
  isConnected: false,
  isConnecting: false,
  isReconnecting: false,
  agentName: null,
  agentVersion: null,
  error: null,
  isLoading: true,

  // ── persistence ──

  loadAccounts: async () => {
    set({ isLoading: true });
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      const accounts: SavedAccount[] = raw ? JSON.parse(raw) : [];
      const connRaw = await storage.getItem(ACTIVE_CONNECTION_KEY);
      const ac = connRaw ? JSON.parse(connRaw) : null;
      set({
        accounts,
        activeAccountId: ac?.accountId ?? null,
        isLoading: false,
      });
    } catch {
      set({ accounts: [], isLoading: false });
    }
  },

  removeAccount: async (id) => {
    const { accounts, activeAccountId } = get();
    if (activeAccountId === id) {
      await get().disconnect();
    }
    const filtered = accounts.filter((a) => a.id !== id);
    set({ accounts: filtered });
    await storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    // Best-effort cleanup of any lingering sidecar for this account.
    try {
      await desktop()?.stopLoopback({ accountId: id });
    } catch {
      // ignore
    }
  },

  // ── connection ──
  //
  // Both join + connect funnel through ``startLoopback``. Join passes
  // the invite + coordinator so the underlying CLI registers the user
  // on its way to opening the proxy; subsequent connects only pass
  // password and reuse the persisted ``coordinatorNodeId``.

  joinNetwork: async (args) => {
    const d = desktop();
    if (!d) {
      set({ error: 'Joining a network requires the desktop app — the loopback sidecar is unavailable here.' });
      return;
    }
    set({ isConnecting: true, error: null });

    const accountId = genId();

    // Spawn the loopback in ticket mode. The Python CLI parses the
    // ticket, registers/logs in via SRP-6a, mints the cert, persists
    // the network in the user store, and prints the bound port. We
    // don't see the ticket bits at all — just hand them off.
    let port: number;
    try {
      port = await d.startLoopback({
        accountId,
        password: args.password,
        ticket: args.ticket,
        handle: args.handle,
      });
    } catch (e: any) {
      set({ isConnecting: false, error: humanizeLoginError(e?.message || String(e)) });
      return;
    }

    // We don't yet know the network name the ticket points at — the
    // ``auth_ok`` frame from the gateway will tell us. Save a
    // placeholder row; ``_openWebsocket`` patches it on connect.
    const newAccount: SavedAccount = {
      id: accountId,
      name: args.displayName ?? args.handle,
      network: '',
      handle: args.handle,
      isLocal: !!args.isLocal,
      createdAt: Date.now(),
      inviteCode: args.ticket,
    };
    const accounts = [...get().accounts, newAccount];
    set({ accounts });
    await storage.setItem(STORAGE_KEY, JSON.stringify(accounts));

    _openWebsocket(get, set, { ...newAccount, sidecarPort: port }, accountId);
  },

  connectAccount: async (accountId, password) => {
    const d = desktop();
    if (!d) {
      set({ error: 'Connecting requires the desktop app — the loopback sidecar is unavailable here.' });
      return;
    }
    const account = get().accounts.find((a) => a.id === accountId);
    if (!account) {
      set({ error: 'Account not found' });
      return;
    }
    set({ isConnecting: true, error: null });

    // Tear down any prior connection first so a switch from A→B
    // doesn't leave A's sidecar running.
    const old = get().ws;
    if (old) {
      old.disconnect();
    }
    if (get().activeAccountId && get().activeAccountId !== accountId) {
      try { await d.stopLoopback({ accountId: get().activeAccountId! }); } catch { /* ignore */ }
    }
    useChat.getState().clearAll();

    let port: number;
    try {
      port = await d.startLoopback({
        accountId,
        password,
        handle: account.handle,
        network: account.network,
        agent: account.agentHandle,
      });
    } catch (e: any) {
      set({ isConnecting: false, error: humanizeLoginError(e?.message || String(e)) });
      return;
    }

    _openWebsocket(get, set, { ...account, sidecarPort: port }, accountId);
  },

  disconnect: async () => {
    const { ws, activeAccountId } = get();
    ws?.disconnect();
    // Flip the visible state SYNCHRONOUSLY before any await. Subscribers
    // (notably the login screen's auto-redirect effect) read this on
    // their next render — if we awaited the IPC first, a route change
    // racing in between would land them on /(tabs)/chat with the old
    // ``isConnected: true`` still latched.
    useChat.getState().clearAll();
    set({
      ws: null,
      isConnected: false,
      isConnecting: false,
      isReconnecting: false,
      config: null,
      agentName: null,
      agentVersion: null,
      activeAccountId: null,
    });
    // A standalone agent window neither owns the shared resume slot nor
    // exclusively owns its loopback (a sibling window may be on the same
    // account). It just drops its own WS; the loopback is reaped on app
    // quit (stopAllLoopbacks). A primary window clears the slot and tears
    // down its sidecar as before.
    if (directedAccountId()) return;
    // Clear persisted connection so a reload doesn't try to resume it.
    await storage.removeItem(ACTIVE_CONNECTION_KEY);
    // Best-effort sidecar cleanup. Even if this fails we're already
    // disconnected from the renderer's perspective.
    if (activeAccountId) {
      try { await desktop()?.stopLoopback({ accountId: activeAccountId }); } catch { /* ignore */ }
    }
  },

  resumeConnection: async () => {
    const d = desktop();
    if (!d) return;
    const { activeAccountId, ws: currentWs } = get();
    if (!activeAccountId || currentWs) return;
    const connRaw = await storage.getItem(ACTIVE_CONNECTION_KEY);
    if (!connRaw) return;
    let connInfo: { accountId: string; sidecarPort: number };
    try { connInfo = JSON.parse(connRaw); } catch { return; }
    if (connInfo.accountId !== activeAccountId) return;
    const port = await d.getLoopbackPort(activeAccountId);
    if (!port) return;
    const account = get().accounts.find((a) => a.id === activeAccountId);
    if (!account) return;
    _openWebsocket(get, set, { ...account, sidecarPort: port }, activeAccountId);
  },

  // ── multi-window (Electron) ──

  openAccountWindow: async (accountId, password) => {
    const d = desktop();
    if (!d || typeof d.openAgentWindow !== 'function') {
      return { ok: false, error: 'Opening another agent in its own window requires the desktop app.' };
    }
    const account = get().accounts.find((a) => a.id === accountId);
    if (!account) return { ok: false, error: 'Account not found' };

    // Bring up (or reuse) this account's loopback WITHOUT tearing down any
    // other connection — this window keeps its current agent. Two windows on
    // the same account share one loopback: ``startLoopback`` is idempotent
    // and returns the existing port (so an already-running agent needs no
    // password). We only need the password to spawn a loopback that isn't up
    // yet; it never leaves this window.
    try {
      const existingPort = await d.getLoopbackPort(accountId);
      if (!existingPort) {
        if (!password) {
          return { ok: false, error: 'Enter the password to open this agent.' };
        }
        await d.startLoopback({
          accountId,
          password,
          handle: account.handle,
          network: account.network,
          agent: account.agentHandle,
        });
      }
    } catch (e: any) {
      return { ok: false, error: humanizeLoginError(e?.message || String(e)) };
    }

    // Loopback is up — hand off to the main process, which opens a standalone
    // window at ``/?connect=<accountId>`` that connects passwordlessly.
    try {
      await d.openAgentWindow(accountId);
    } catch (e: any) {
      return { ok: false, error: humanizeLoginError(e?.message || String(e)) };
    }
    return { ok: true };
  },

  connectDirected: async (accountId) => {
    const d = desktop();
    if (!d) return;
    // Guard against a double-connect if boot runs this twice.
    if (get().ws) return;
    const port = await d.getLoopbackPort(accountId);
    // No live loopback for this account → can't connect without a password;
    // leave the window on the login screen (index.tsx preselects the account).
    if (!port) return;
    const account = get().accounts.find((a) => a.id === accountId);
    if (!account) return;
    set({ isConnecting: true, error: null, activeAccountId: accountId });
    _openWebsocket(
      get, set,
      { ...account, sidecarPort: port }, accountId,
      { persistActive: false },
    );
  },
}));

/** Hard cap on how long we wait for the gateway's auth_ok / auth_error
 *  frame after the WebSocket is wired. The loopback proxy is already
 *  bound at this point, so the budget only covers TCP-to-localhost +
 *  one iroh stream + one server frame — 15 s is generous. Cleared on
 *  any terminal outcome (auth_ok, auth_error, pre-auth close, manual
 *  disconnect). Was: no cap, so a silent gateway hang would lock the
 *  UI in "Connecting…" forever. */
const WS_AUTH_TIMEOUT_MS = 15_000;

/** Wire up the WebSocket once we have a sidecar port.
 *
 * ``opts.persistActive`` (default true) controls whether an ``auth_ok``
 * writes the shared ``ACTIVE_CONNECTION_KEY`` slot. Standalone agent
 * windows pass ``false``: their account identity lives in the URL
 * (``?connect=<id>``), so they must not clobber the primary window's
 * cold-start resume target. */
function _openWebsocket(
  get: () => ConnectionState,
  set: (s: Partial<ConnectionState>) => void,
  config: ConnectionConfig & { sidecarPort: number },
  accountId: string,
  opts: { persistActive?: boolean } = {},
) {
  let isChild = false;
  try {
    isChild = typeof window !== 'undefined' &&
      !!(window as any).desktop?.isChild;
  } catch { /* web / RN */ }

  const host = '127.0.0.1';
  const port = config.sidecarPort;
  const url = `ws://${host}:${port}/ws`;
  const ws = new OpenAgentWS(url, undefined);

  if (isChild) {
    try {
      const { IpcWebSocket } = require('../services/ipc-ws');
      ws.setTransport(new IpcWebSocket());
    } catch { /* fall back to direct WS */ }
  }

  // Single-shot finalizer: any of {auth_ok, auth_error, pre-auth close,
  // retries-exhausted, timeout, disconnect} marks the attempt done so
  // later events don't double-fire (e.g. close → timer firing 3 s
  // later and overwriting the error).
  let attemptDone = false;
  let authTimer: ReturnType<typeof setTimeout> | null = null;
  const finalize = () => {
    attemptDone = true;
    if (authTimer != null) {
      clearTimeout(authTimer);
      authTimer = null;
    }
  };
  // Skip mutations if this attempt is stale (the user clicked Connect
  // again before this attempt resolved → the store's ws is now a
  // different instance). Without this, a stale failure could overwrite
  // a fresh ``isConnecting: true``.
  const isCurrent = () => get().ws === ws;

  ws.onMessage((msg) => {
    if (msg.type === 'auth_ok') {
      finalize();
      if (!isCurrent()) return;
      const st = get();
      const acct = st.accounts.find((a) => a.id === accountId);
      set({
        isConnected: true,
        isConnecting: false,
        isReconnecting: false,
        // Fall back to persisted agent info or account name for child
        // windows where the synthesized auth_ok has no agent metadata.
        // @ts-ignore
        agentName: msg.agent_name || st.agentName || acct?.name,
        // @ts-ignore
        agentVersion: msg.version || st.agentVersion,
        error: null,
      });
      // Patch the saved account from the gateway's auth_ok frame —
      // covers post-join when we didn't yet know the network ID, and
      // keeps the display label fresh as the agent name evolves.
      const acc = get().accounts.find((a) => a.id === accountId);
      const serverAgent = (msg as any).agent_name as string | undefined;
      const serverNetwork = (msg as any).network as string | undefined;
      const serverHandle = (msg as any).handle as string | undefined;
      if (acc) {
        const updated = get().accounts.map((a) => {
          if (a.id !== accountId) return a;
          const next = { ...a };
          if (serverNetwork && !a.network) next.network = serverNetwork;
          if (serverHandle && !a.handle) next.handle = serverHandle;
          // Auto-name only when the account row is still sitting on
          // the bare handle / placeholder — leave user-customised
          // labels alone.
          if (serverAgent && (a.name === a.handle || a.name === '')) {
            next.name = `${next.handle}@${next.network} — ${serverAgent}`;
          }
          return next;
        });
        set({ accounts: updated });
        storage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
      // Persist the active connection so a renderer reload can resume
      // without re-entering credentials. Skipped for standalone agent
      // windows (they resume from their own ``?connect=`` URL instead) so
      // they don't overwrite the primary window's resume target — including
      // the login-fallback path, hence the ``directedAccountId()`` guard.
      if (opts.persistActive !== false && !directedAccountId()) {
        storage.setItem(ACTIVE_CONNECTION_KEY, JSON.stringify({
          accountId,
          sidecarPort: config.sidecarPort,
        }));
      }
      // Hydrate the chat sidebar with every session the server
      // already knows about for this device.
      const chat = useChat.getState();
      if (!chat.sessionsHydrated) {
        fetchSessions()
          .then((entries) => {
            chat.hydrateFromServer(entries);
            chat.markHydrated();
          })
          .catch(() => {
            chat.markHydrated();
          });
      }
    } else if (msg.type === 'auth_error') {
      finalize();
      if (!isCurrent()) return;
      set({
        isConnected: false,
        isConnecting: false,
        error: humanizeLoginError((msg as any).reason),
      });
    }
  });

  // Pre-auth WS drops (proxy can't reach the gateway, port stale,
  // gateway refused the cert pre-handshake) used to be invisible —
  // ``onclose`` only logged + scheduled a 3 s reconnect. Now the WS
  // surfaces them through onClose so we clear the loading state.
  ws.onClose(async (info) => {
    if (info.reason === 'post_auth') {
      // Mid-session drop — the WS auto-reconnect kicks in; surface a
      // "Reconnecting…" hint so the user knows why their messages have
      // stopped getting replies. Cleared on the next ``auth_ok``.
      if (!isCurrent()) return;
      set({ isReconnecting: true });
      return;
    }
    if (attemptDone) return;
    if (info.reason === 'pre_auth' || info.reason === 'retries_exhausted') {
      finalize();
      if (!isCurrent()) return;
      const detail = info.detail || `WebSocket closed before authentication (code=${info.code})`;

      // Post-auth retries exhausted → the loopback's iroh transport is
      // likely dead while the proxy port is still bound (common after
      // macOS sleep or network change). Try restarting the loopback.
      if (info.reason === 'retries_exhausted') {
        const acctId = get().activeAccountId;
        if (acctId) {
          const account = get().accounts.find((a) => a.id === acctId);
          if (account) {
            // We can't restart the loopback without the password, but we
            // can at least stop the dead one and surface a clear error
            // with a reconnect prompt instead of "Reconnecting…" forever.
            try { await desktop()?.stopLoopback({ accountId: acctId }); } catch { /* ignore */ }
            set({
              isConnected: false,
              isConnecting: false,
              isReconnecting: false,
              error: 'Connection lost. The secure tunnel to your agent stopped responding — this can happen after your Mac wakes from sleep or changes networks. Enter your password to reconnect.',
            });
            ws.disconnect();
            return;
          }
        }
      }

      set({
        isConnected: false,
        isConnecting: false,
        isReconnecting: false,
        error: humanizeLoginError(detail),
      });
      ws.disconnect();
    }
  });

  ws.onError(() => {
    // onError fires alongside onClose with no extra signal; let the
    // close handler do the work. Kept registered so future per-error
    // diagnostics can hook in without re-wiring the store.
  });

  authTimer = setTimeout(() => {
    if (attemptDone) return;
    finalize();
    if (!isCurrent()) return;
    set({
      isConnected: false,
      isConnecting: false,
      error: 'The agent didn’t respond in time. Check that the server is running and try again.',
    });
    ws.disconnect();
  }, WS_AUTH_TIMEOUT_MS);

  ws.connect();
  setBaseUrl(host, port);
  set({
    config,
    ws,
    isConnected: false,
    error: null,
    activeAccountId: accountId,
  });
}
