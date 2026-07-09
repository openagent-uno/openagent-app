/**
 * Preload script — exposes desktop-only APIs to the renderer via
 * contextBridge. The renderer accesses them as window.desktop.*.
 */

import { contextBridge, ipcRenderer } from 'electron';

const isChild = (() => {
  try {
    return new URLSearchParams(window.location.search).get('child') === '1';
  } catch { return false; }
})();

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDesktop: true,
  isChild,

  // Storage (electron-store based, persists across restarts)
  getItem: (key: string): Promise<string | null> =>
    ipcRenderer.invoke('storage:get', key),
  setItem: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke('storage:set', key, value),
  removeItem: (key: string): Promise<void> =>
    ipcRenderer.invoke('storage:remove', key),

  // Native file picker
  pickFiles: (): Promise<{
    path: string;
    filename: string;
    kind: 'image' | 'file';
    /** Bytes on disk, or -1 if stat failed. */
    size: number;
    /** Renderer-side cap mirror so the UI can pre-reject oversized files. */
    maxBytes: number;
  }[]> => ipcRenderer.invoke('dialog:pickFiles'),

  readFile: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('dialog:readFile', filePath),

  /** Deep-link to the OS microphone privacy pane. Returns false when
   *  the platform has no known URL (the UI should show instructions). */
  openMicSettings: (): Promise<boolean> => ipcRenderer.invoke('app:openMicSettings'),

  // Quit the app from the renderer.
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),

  // Custom window controls (cross-platform Jarvis-themed).
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),

  // Open a new window for a tab route (desktop-only multi-window). The new
  // window is a *relay child* — it shares this window's agent connection.
  openWindow: (route: string): Promise<void> => ipcRenderer.invoke('window:open', route),

  // Open a *standalone* agent window bound to ``accountId`` — a full app
  // window with its OWN connection (own loopback + WS), independent of this
  // one. Powers "open another agent in a new window" from the switcher.
  openAgentWindow: (accountId: string): Promise<void> =>
    ipcRenderer.invoke('window:openAgent', accountId),

  // Close all sub-windows (called on agent switch or main window close).
  closeAllChildren: (): Promise<void> => ipcRenderer.invoke('window:closeAllChildren'),

  // Retrieve an already-running loopback's port without a password.
  getLoopbackPort: (accountId: string): Promise<number | null> =>
    ipcRenderer.invoke('loopback:getPort', accountId),

  // ── Multi-window WS relay ──

  // Child → primary: send an outbound WS message.
  wsRelayOut: (payload: string): void => {
    ipcRenderer.send('ws:relay-out', payload);
  },

  // Primary → children: broadcast a server message.
  wsRelayBroadcast: (payload: string): void => {
    ipcRenderer.send('ws:relay-broadcast', payload);
  },

  // Child: subscribe to server messages from the primary.
  onWsRelayToChild: (cb: (data: string) => void): (() => void) => {
    const handler = (_event: any, data: string) => cb(data);
    ipcRenderer.on('ws:relay-to-child', handler);
    return () => { ipcRenderer.removeListener('ws:relay-to-child', handler); };
  },

  // Primary: subscribe to outbound messages from children.
  onWsRelayFromChild: (cb: (data: string) => void): (() => void) => {
    const handler = (_event: any, data: string) => cb(data);
    ipcRenderer.on('ws:relay-from-child', handler);
    return () => { ipcRenderer.removeListener('ws:relay-from-child', handler); };
  },

  // ── Network loopback (Iroh transport bridge) ──
  startLoopback: (args: {
    accountId: string;
    password: string;
    ticket?: string;
    handle?: string;
    network?: string;
    agent?: string;
  }): Promise<number> => ipcRenderer.invoke('loopback:start', args),

  stopLoopback: (args: { accountId: string }): Promise<void> =>
    ipcRenderer.invoke('loopback:stop', args),

  // ── Ticket introspection ──
  // Decode an oa1… ticket so the join form can auto-fill the handle
  // when the ticket is bound (role=device). Returns ``null`` on any
  // parse error — the form falls back to manual entry. The renderer
  // doesn't ship the base32/CBOR libs, so we delegate to the same
  // ``decodeTicket`` the loopback bridge already uses.
  decodeTicket: (ticket: string): Promise<{
    role: 'user' | 'device' | 'agent';
    bindTo: string;
    networkName: string;
  } | null> => ipcRenderer.invoke('network:decode-ticket', ticket),
});
