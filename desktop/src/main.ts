/**
 * Electron main process.
 *
 * Dev:  loads from Expo web dev server (localhost:8081)
 * Prod: serves web-build via a local HTTP server (Expo Router needs
 *       proper URL routing which file:// can't provide)
 *
 * Integrates window-manager, shortcuts, menu, tray, and dock modules
 * for a complete desktop-window management experience.
 */

import { app, BrowserWindow, shell, dialog, protocol, ipcMain, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { registerStorageHandlers } from './services/storage';
import { registerLoopbackHandlers, stopAllLoopbacks } from './services/loopback';
import { decodeTicket } from './network/ticket';

// ── New desktop-controls modules ──
import {
  registerWindow,
  unregisterWindow,
  getPrimaryWindow as getPrimaryFromRegistry,
  getAllWindows,
  focusWindow,
  closeWindow,
  getWindowCount,
  setCreateWindowFactory,
} from './window-manager';
import { registerAllShortcuts, unregisterAllShortcuts, getShortcutsMap } from './shortcuts';
import { buildMenu, rebuildMenu, setupMenuAutoRebuild } from './menu';
import { createTray, updateTrayAgentList, destroyTray } from './tray';
import { setupDockMenu, updateDockAgentList } from './dock';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.tiff']);

// Hard cap on ``dialog:readFile`` IPC payloads so a single runaway attachment
// can't OOM the renderer. The renderer streams these into a Blob before the
// HTTP upload; 200 MB covers any normal user attachment (PDFs, images, short
// videos) without letting the user accidentally paste their whole Downloads
// folder into memory.
const MAX_READ_BYTES = 200 * 1024 * 1024;

// Paths the user has explicitly picked through ``dialog:pickFiles`` in this
// session — ``dialog:readFile`` only accepts paths that show up here. This is
// defense-in-depth: we don't *believe* the renderer is hostile, but we also
// don't want a malicious page loaded via file:// in dev mode (or a compromised
// third-party script) to read ~/.ssh/id_rsa just because the renderer can
// send arbitrary IPC args.
const pickedPaths = new Set<string>();

function registerDialogHandlers(): void {
  ipcMain.handle('dialog:pickFiles', async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
    };
    const result = focused
      ? await dialog.showOpenDialog(focused, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths.length) return [];
    for (const p of result.filePaths) pickedPaths.add(p);
    // Return size alongside the path so the renderer can reject files
    // over MAX_READ_BYTES *before* it triggers the IPC readFile (which
    // would otherwise fail with a generic "readFile: too big" string
    // mid-upload). For files we can't stat (broken symlink, etc.) we
    // fall back to size=-1 and let the readFile guard surface the real
    // error.
    return Promise.all(result.filePaths.map(async (p) => {
      let size = -1;
      try {
        const st = await fs.promises.stat(p);
        if (st.isFile()) size = st.size;
      } catch { /* fall through with -1 */ }
      return {
        path: p,
        filename: path.basename(p),
        kind: IMAGE_EXTS.has(path.extname(p).toLowerCase()) ? 'image' : 'file',
        size,
        maxBytes: MAX_READ_BYTES,
      };
    }));
  });

  // Read a file's bytes so the renderer can upload it via /api/upload.
  //
  // The **only** way the renderer can get bytes for an arbitrary local file
  // is via this IPC — Electron renderers with contextIsolation + no
  // nodeIntegration don't have ``fs``. We restrict reads to paths the user
  // has actually picked via the native dialog in this session, so the path
  // string is effectively a capability token issued by the OS file picker
  // rather than a free-form argument.
  ipcMain.handle('dialog:readFile', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      throw new Error('readFile: path must be a string');
    }
    if (!pickedPaths.has(filePath)) {
      throw new Error('readFile: path was not picked via the native dialog');
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`readFile: ${filePath} is not a regular file`);
    }
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(
        `readFile: ${filePath} is ${stat.size} bytes (limit ${MAX_READ_BYTES})`,
      );
    }
    // Buffer crosses the IPC boundary as a Node Buffer which Electron
    // structured-clones into the renderer as a Uint8Array. No base64.
    return fs.promises.readFile(filePath);
  });

  // Deep-link the OS privacy pane so the user can grant mic access
  // without hunting through System Settings. Each platform exposes a
  // different URL scheme; falls back to ``no-op`` on platforms we
  // don't have a target for (the renderer should still log + show
  // instructions).
  ipcMain.handle('app:openMicSettings', async () => {
    try {
      if (process.platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
        return true;
      }
      if (process.platform === 'win32') {
        await shell.openExternal('ms-settings:privacy-microphone');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });
}

const isDev = !app.isPackaged;

app.setAboutPanelOptions({
  applicationName: 'OpenAgent',
  applicationVersion: app.getVersion(),
  website: 'https://openagent.uno/',
});

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.openagent.desktop');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
// Every secondary window (relay-child OR standalone agent window). Tracked so
// closing the primary can tear them all down.
const childWindows = new Set<BrowserWindow>();
// webContents ids of *relay* children only — the ones that tunnel their WS
// through the primary window (opened with ``markChild``). Standalone agent
// windows (own loopback + own WS) are deliberately excluded so the primary's
// broadcast never leaks another agent's frames into them.
const relayChildIds = new Set<number>();
let primaryWindowId: number | null = null;
let staticServer: http.Server | null = null;
let staticPort = 0;

// ── Static file server for production ──

function startStaticServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    // When packaged, web-build is shipped as an extraResource (outside the
    // asar), because electron-builder's default file filter strips any path
    // containing `node_modules` — which Expo's export uses for vendored
    // asset paths (e.g. `assets/node_modules/@react-navigation/.../*.png`).
    const webBuildDir = app.isPackaged
      ? path.join(process.resourcesPath, 'web-build')
      : path.resolve(__dirname, '..', 'web-build');

    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json',
    };

    if (!fs.existsSync(webBuildDir)) {
      console.error(`[openagent] web-build directory missing: ${webBuildDir}`);
      return reject(new Error(`web-build directory missing at ${webBuildDir}`));
    }

    const server = http.createServer((req, res) => {
      // Strip query strings & fragments, decode percent-encoded chars
      const rawUrl = (req.url || '/').split('?')[0].split('#')[0];
      let urlPath: string;
      try {
        urlPath = decodeURIComponent(rawUrl);
      } catch {
        urlPath = rawUrl;
      }

      // Resolve and guard against path traversal (stay within webBuildDir)
      let filePath = path.join(webBuildDir, urlPath === '/' ? 'index.html' : urlPath);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(webBuildDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // SPA fallback: serve index.html when the file doesn't exist *and*
      // it's not an asset request (assets should 404, not get HTML).
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '' || ext === '.html') {
          filePath = path.join(webBuildDir, 'index.html');
        }
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch (err) {
        console.error(`[openagent] 404 ${req.url} -> ${filePath}`);
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      staticServer = server;
      console.log(`[openagent] static server listening on 127.0.0.1:${port} serving ${webBuildDir}`);
      resolve(port);
    });

    server.on('error', reject);
  });
}

// ── Window ──

/** Extract a terminal id from a detached route like ``terminal/<id>?cwd=…``. */
function terminalIdFromRoute(route?: string): string | null {
  if (!route) return null;
  const m = route.match(/^terminal\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

interface CreateWindowOptions {
  /** Relative route to load (no leading slash). Omitted → app root. */
  route?: string;
  /** Mark as a relay child: tunnels its WS through the primary window's
   *  live socket (shared agent). Used for same-agent detached views. */
  markChild?: boolean;
  /** Standalone agent window: boots at ``/?connect=<id>`` and opens its
   *  OWN connection to that account's already-running loopback. Mutually
   *  exclusive with ``markChild`` — a standalone window is never a relay
   *  child. */
  connectAccountId?: string;
}

function createWindow(opts: CreateWindowOptions = {}): BrowserWindow {
  const { route, markChild = false, connectAccountId } = opts;
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    title: 'OpenAgent',
    // Frameless on every desktop OS: the renderer draws its own
    // WindowControls (in the sidebar's top-left on macOS, in the chrome
    // Header on Win/Linux). Native macOS traffic lights are pushed
    // off-screen so they don't double up with the custom ones.
    ...(isMac
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: -200, y: 0 } }
      : { frame: false }),
    show: true,
    backgroundColor: '#050810',  // match JARVIS dark theme bg
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const baseUrl = isDev ? 'http://localhost:8081' : `http://127.0.0.1:${staticPort}`;
  // Build the URL through the URL API so query params compose safely even
  // when the route already carries one (e.g. ``terminal/<id>?cwd=…``).
  const target = new URL(route ? `${baseUrl}/${route}` : baseUrl);
  if (connectAccountId) target.searchParams.set('connect', connectAccountId);
  if (markChild) target.searchParams.set('child', '1');
  win.loadURL(target.toString());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (markChild) relayChildIds.add(win.webContents.id);

  // ── Register with the central window manager ──
  const windowType = connectAccountId
    ? 'standalone-agent'
    : markChild
      ? 'relay-child'
      : 'primary';
  registerWindow(win, {
    type: windowType,
    accountId: connectAccountId,
    title: 'OpenAgent',
    route,
  });

  win.on('closed', () => {
    childWindows.delete(win);
    relayChildIds.delete(win.webContents.id);
    // Also unregister from the central registry.
    unregisterWindow(win.webContents.id);

    // Rebuild the menu so the Window list updates.
    rebuildMenu();

    // Closing an OS window destroys its renderer without running React
    // cleanup, so a terminal window can't send its own ``terminal_close``.
    // Relay one through the primary window's gateway socket here so the
    // PTY on the host is reaped instead of lingering until app exit.
    const terminalId = terminalIdFromRoute(route);
    if (terminalId && primaryWindowId) {
      const primary = BrowserWindow.fromId(primaryWindowId);
      if (primary && !primary.isDestroyed() && primary.webContents.id !== win.webContents.id) {
        primary.webContents.send(
          'ws:relay-from-child',
          JSON.stringify({ type: 'terminal_close', terminal_id: terminalId }),
        );
      }
    }
  });

  childWindows.add(win);

  if (!mainWindow) {
    mainWindow = win;
    mainWindow.on('closed', () => {
      mainWindow = null;
      primaryWindowId = null;
      closeAllChildWindows();
    });
  }

  if (!primaryWindowId) {
    primaryWindowId = win.webContents.id;
  }

  return win;
}

function closeAllChildWindows(): void {
  for (const win of [...childWindows]) {
    if (!win.isDestroyed() && win.webContents.id !== primaryWindowId) {
      win.close();
    }
  }
}

// Register the factory so menu/shortcuts/tray can create windows.
setCreateWindowFactory(createWindow);

// ── Auto-updater ──

function setupAutoUpdater(): void {
  if (isDev) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info: any) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `OpenAgent ${info.version} is ready to install.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }: { response: number }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('Auto-updater error:', err.message);
  });

  autoUpdater.checkForUpdatesAndNotify();
}

// ── IPC: Window-control handlers (module-level so they're registered
// before ``activate`` can fire and create a window on macOS). ──

ipcMain.handle('app:quit', () => {
  app.quit();
});

ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  }
});

ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('window:isMaximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win.isMaximized() : false;
});

// ── IPC: Menu-initiated actions ──

// Renderer requests a new relay-child window at root.
ipcMain.handle('menu:newWindow', () => {
  createWindow({ route: '', markChild: true });
  rebuildMenu();
});

// Renderer requests a new standalone agent window.
// The renderer sends a connectAccountId if known, else we prompt.
ipcMain.handle('menu:newAgentWindow', (_event, accountId?: string) => {
  if (typeof accountId === 'string' && accountId.length > 0) {
    createWindow({ connectAccountId: accountId });
  } else {
    // Open a standalone window without a pre-bound account.
    // It will prompt the user to pick an agent on its own.
    createWindow({});
  }
  rebuildMenu();
});

// Renderer triggers the agent switcher (primary window will show the
// agent selection UI).
ipcMain.handle('menu:switchAgent', () => {
  const primary = getPrimaryFromRegistry();
  if (primary && !primary.isDestroyed()) {
    primary.webContents.send('menu:switchAgent');
  }
});

// Renderer wants to open the Settings route.
ipcMain.handle('menu:openSettings', () => {
  const primary = getPrimaryFromRegistry();
  if (primary && !primary.isDestroyed()) {
    primary.webContents.send('menu:openSettings');
  }
});

// Renderer wants to open the Keyboard Shortcuts documentation.
ipcMain.handle('menu:openShortcuts', () => {
  const primary = getPrimaryFromRegistry();
  if (primary && !primary.isDestroyed()) {
    primary.webContents.send('menu:openShortcuts');
  }
});

// Focus a specific window by its webContents id.
ipcMain.handle('menu:focusWindow', (_event, id: number) => {
  if (typeof id === 'number') {
    focusWindow(id);
  }
});

// Cycle focus through all open windows (next in the list).
ipcMain.handle('menu:cycleWindows', () => {
  const all = getAllWindows().filter((e) => !e.win.isDestroyed());
  if (all.length === 0) return;

  const focusedId = BrowserWindow.getFocusedWindow()?.webContents.id ?? -1;
  const currentIndex = all.findIndex((e) => e.id === focusedId);
  const nextIndex = (currentIndex + 1) % all.length;
  const next = all[nextIndex];
  if (next) focusWindow(next.id);
});

// Note: shortcuts:getMap is registered inside registerAllShortcuts() in shortcuts.ts.

// Quick actions that need main-process side effects
ipcMain.handle('menu:quickJump', () => {
  // The menu already sent the IPC to the focused renderer.
  return true;
});

ipcMain.handle('menu:quickCreate', () => {
  return true;
});

// ── IPC: Window open/close ──

// Renderer asks the main process to open a new window for a tab route.
// These are *relay* children — they share the primary window's agent
// connection (WS tunnelled through the primary).
ipcMain.handle('window:open', (_event, route: string) => {
  if (typeof route !== 'string' || !route) {
    throw new Error('window:open requires a non-empty route string');
  }
  const win = createWindow({ route, markChild: true });
  rebuildMenu();
  return win.webContents.id;
});

// Renderer asks the main process to open a *standalone* agent window: a
// full app window bound to a specific account that opens its OWN
// connection (its own loopback + WS), independent of the primary. This is
// what powers "open another agent in a new window" from the switcher.
ipcMain.handle('window:openAgent', (_event, accountId: string) => {
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('window:openAgent requires a non-empty accountId string');
  }
  const win = createWindow({ connectAccountId: accountId });
  rebuildMenu();
  return win.webContents.id;
});

// Renderer asks the main process to close all sub-windows.
ipcMain.handle('window:closeAllChildren', () => {
  closeAllChildWindows();
  rebuildMenu();
});

// ── IPC: Multi-window WS relay ──

// Primary window's WS is shared with its *relay* children only.
// Standalone agent windows carry their own connection and are never part
// of this fan-out (their ids are not in ``relayChildIds``), so agent A's
// frames can't leak into an agent-B window.
ipcMain.on('ws:relay-out', (event, payload: string) => {
  if (!relayChildIds.has(event.sender.id)) return;
  const primary = primaryWindowId
    ? BrowserWindow.fromId(primaryWindowId)
    : null;
  if (primary && !primary.isDestroyed()) {
    primary.webContents.send('ws:relay-from-child', payload);
  }
});

ipcMain.on('ws:relay-broadcast', (event, payload: string) => {
  if (event.sender.id !== primaryWindowId) return;
  for (const id of relayChildIds) {
    const win = BrowserWindow.fromId(id);
    if (win && !win.isDestroyed()) {
      win.webContents.send('ws:relay-to-child', payload);
    }
  }
});

// ── IPC: Network ──

// Decode an invite ticket for the join form so it can auto-fill
// the bound handle (and show the user what they're joining). On
// any decode error, return null so the renderer falls back to
// manual entry — the loopback step will surface a clearer error
// if the ticket really is malformed.
ipcMain.handle('network:decode-ticket', (_event, ticket: unknown) => {
  if (typeof ticket !== 'string' || ticket.length < 8) return null;
  try {
    const t = decodeTicket(ticket);
    return {
      role: t.role,
      bindTo: t.bindTo,
      networkName: t.networkName,
    };
  } catch {
    return null;
  }
});

// ── Lifecycle ──

app.whenReady().then(async () => {
  registerStorageHandlers();
  registerDialogHandlers();
  registerLoopbackHandlers();

  // ── Desktop controls setup ──

  // Register global keyboard shortcuts.
  registerAllShortcuts();

  // Build and set the initial application menu.
  const menu = buildMenu();
  Menu.setApplicationMenu(menu);

  // Auto-rebuild the menu on window focus changes (updates the Window list).
  setupMenuAutoRebuild();

  // Create the system tray.
  createTray();

  // Set up the macOS dock menu.
  setupDockMenu();

  // In production, start a local HTTP server for the web build
  // (Expo Router needs proper URL routing that file:// can't do)
  if (!isDev) {
    staticPort = await startStaticServer();
  }

  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAllLoopbacks();
    if (staticServer) staticServer.close();
    destroyTray();
    unregisterAllShortcuts();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllLoopbacks();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  if (staticServer) staticServer.close();
  destroyTray();
  unregisterAllShortcuts();
});

// ── Notify renderers of focus changes ──

app.on('browser-window-focus', (_event, win) => {
  if (!win.isDestroyed()) {
    const id = win.webContents.id;
    for (const entry of getAllWindows()) {
      if (!entry.win.isDestroyed()) {
        entry.win.webContents.send('window:focusChanged', id);
      }
    }
  }
});
