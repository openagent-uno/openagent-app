/**
 * In-process loopback supervisor: brings up an iroh node, registers/logs
 * in to the coordinator, and exposes a localhost port the renderer hits
 * with plain HTTP/WS.
 *
 * Replaces the previous subprocess model (spawning ``openagent network
 * loopback``) with a native TS implementation. The renderer-facing IPC
 * shape is unchanged: the renderer still calls ``loopback:start`` /
 * ``loopback:stop`` and gets a port back.
 */
import { ipcMain } from 'electron';
import {
  startNativeLoopback,
  type RunningLoopback,
  type StartLoopbackArgs as NativeStartArgs,
} from '../network/start.js';
import { isCredentialRejection } from './credentials-core';
import {
  loadRememberedCredential,
  removeRememberedCredential,
  saveRememberedCredential,
} from './credentials';
import { createAccountStartCoordinator } from './account-start-coordinator';

interface LoopbackHandle {
  id: string;
  loopback: RunningLoopback;
  startedAt: number;
}

const handles = new Map<string, LoopbackHandle>();
const accountStarts = createAccountStartCoordinator<number>();

/** Hard cap on the whole sidecar bring-up: iroh dial + SRP login +
 *  list_agents + proxy bind. iroh-js exposes no AbortSignal, so we can't
 *  cancel the inner promise — when the timeout fires we let it run, but
 *  attach a teardown so any partial RunningLoopback that resolves later
 *  gets cleaned up rather than leaked. Was: hung indefinitely when iroh
 *  discovery couldn't reach the coordinator (common in DMG builds where
 *  macOS Local Network access is blocked). */
const STARTUP_TIMEOUT_MS = 30_000;

export interface StartLoopbackArgs {
  accountId: string;
  password: string;
  agent?: string;
  ticket?: string;
  handle?: string;
  network?: string;
  /** Renderer opt-in. The handler persists only after coordinator login
   * succeeds; omitted means leave the current preference untouched. */
  remember?: boolean;
}

export type RememberedLoopbackResult =
  | { status: 'started'; port: number }
  | { status: 'missing' }
  | { status: 'invalid'; error: string }
  | { status: 'retryable_error'; error: string };

type RememberedLoopbackArgs = Omit<StartLoopbackArgs, 'password'>;

function validateStartArgs(
  raw: unknown,
  channel: 'loopback:start' | 'loopback:startRemembered',
  requiresPassword: boolean,
): StartLoopbackArgs | RememberedLoopbackArgs {
  const args = raw as Partial<StartLoopbackArgs> | null;
  if (!args || typeof args.accountId !== 'string') {
    throw new Error(`${channel}: accountId is required`);
  }
  if (requiresPassword && typeof args.password !== 'string') {
    throw new Error(`${channel}: password is required`);
  }
  const hasTicket = typeof args.ticket === 'string' && args.ticket.length > 0;
  const hasHandleNet =
    typeof args.handle === 'string' && args.handle.length > 0 &&
    typeof args.network === 'string' && args.network.length > 0;
  if (!hasTicket && !hasHandleNet) {
    throw new Error(`${channel}: pass either ticket, or handle + network`);
  }
  for (const key of ['ticket', 'handle', 'network', 'agent'] as const) {
    const value = (args as Record<string, unknown>)[key];
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`${channel}: ${key} must be a string when present`);
    }
  }
  if (args.remember !== undefined && typeof args.remember !== 'boolean') {
    throw new Error(`${channel}: remember must be a boolean when present`);
  }
  return args as StartLoopbackArgs | RememberedLoopbackArgs;
}

export async function startLoopback(args: StartLoopbackArgs): Promise<number> {
  const existing = handles.get(args.accountId);
  if (existing) {
    return existing.loopback.port;
  }
  return accountStarts.run(
    args.accountId,
    () => startLoopbackFresh(args),
    () => {
      // Only the call that created this in-flight start may persist its
      // password. Waiters with the same accountId share the port but must not
      // overwrite the keychain with credentials that were never authenticated.
      // Persistence remains best-effort and never falls back to plaintext.
      try {
        if (args.remember === true) {
          saveRememberedCredential(args.accountId, args.password);
        } else if (args.remember === false) {
          removeRememberedCredential(args.accountId);
        }
      } catch {
        // A keychain failure must not turn a valid login into a failed one.
      }
    },
  );
}

async function startLoopbackFresh(args: StartLoopbackArgs): Promise<number> {
  const nativeArgs: NativeStartArgs = {
    password: args.password,
    ticket: args.ticket,
    handle: args.handle,
    network: args.network,
    agent: args.agent,
  };

  const startPromise = startNativeLoopback(nativeArgs);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error(`loopback startup timed out after ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);
  });

  // If the native loopback eventually succeeds AFTER we've timed out, tear
  // it down so the iroh node + proxy don't leak.
  startPromise.then(
    (lb) => {
      if (timedOut) {
        lb.stop().catch(() => { /* ignore */ });
      }
    },
    () => { /* error surfaces through Promise.race below */ },
  );

  let loopback: RunningLoopback;
  try {
    loopback = await Promise.race([startPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
  }

  handles.set(args.accountId, {
    id: args.accountId,
    loopback,
    startedAt: Date.now(),
  });
  return loopback.port;
}

export async function stopLoopback(accountId: string): Promise<void> {
  const h = handles.get(accountId);
  if (!h) return;
  handles.delete(accountId);
  try {
    await h.loopback.stop();
  } catch (err) {
    console.warn(`[loopback ${accountId}] stop error:`, err);
  }
}

export async function stopAllLoopbacks(): Promise<void> {
  const ids = Array.from(handles.keys());
  await Promise.all(ids.map((id) => stopLoopback(id)));
}

export function registerLoopbackHandlers(): void {
  ipcMain.handle('loopback:start', async (_event, raw: unknown) => {
    const args = validateStartArgs(raw, 'loopback:start', true) as StartLoopbackArgs;
    try {
      return await startLoopback(args);
    } catch (error) {
      if (isCredentialRejection(error)) {
        removeRememberedCredential(args.accountId);
      }
      throw error;
    }
  });

  // The renderer supplies account metadata only. Password decryption and
  // loopback startup both happen in this trusted process, so a remembered
  // plaintext credential never crosses the contextBridge back into JS UI.
  ipcMain.handle('loopback:startRemembered', async (_event, raw: unknown): Promise<RememberedLoopbackResult> => {
    const args = validateStartArgs(
      raw,
      'loopback:startRemembered',
      false,
    ) as RememberedLoopbackArgs;
    const password = loadRememberedCredential(args.accountId);
    if (password == null) return { status: 'missing' };

    try {
      const port = await startLoopback({ ...args, password });
      return { status: 'started', port };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isCredentialRejection(error)) {
        removeRememberedCredential(args.accountId);
        return { status: 'invalid', error: message };
      }
      // Connectivity/timeouts do not prove the password is wrong. Keep the
      // ciphertext so the renderer can offer a passwordless retry.
      return { status: 'retryable_error', error: message };
    }
  });

  ipcMain.handle('loopback:stop', async (_event, raw: unknown) => {
    const args = raw as { accountId: string };
    if (!args || typeof args.accountId !== 'string') {
      throw new Error('loopback:stop: accountId required');
    }
    await stopLoopback(args.accountId);
  });

  ipcMain.handle('loopback:getPort', async (_event, accountId: string) => {
    if (typeof accountId !== 'string' || !accountId) {
      throw new Error('loopback:getPort: accountId required');
    }
    const h = handles.get(accountId);
    return h ? h.loopback.port : null;
  });
}
