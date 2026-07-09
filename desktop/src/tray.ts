/**
 * System tray icon and menu.
 *
 * Provides a persistent tray icon with quick actions: show/hide main
 * window, open new windows, list recent agents, and quit.
 */

import { app, BrowserWindow, Menu, MenuItemConstructorOptions, nativeImage, NativeImage, Tray } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  getPrimaryWindow,
  getWindowCount,
  getAllWindows,
  focusWindow,
  getCreateWindowFactory,
} from './window-manager';

// ── Globals ──

let tray: Tray | null = null;

/** Cached agent list shared between tray and dock. */
let recentAgentList: string[] = [];

// ── Icon ──

/**
 * Resolve the tray icon path across dev and production environments.
 *
 * In dev, the icon lives in ``universal/assets/openagent-icon.png``.
 * In production, the bundle script copies it into ``dist/tray-icon.png``
 * so it ships inside the asar alongside the compiled JS.
 */
function resolveTrayIconPath(): string {
  // Production: tray icon copied into dist/ by the bundle script.
  const prodPath = path.join(__dirname, 'tray-icon.png');
  try {
    if (fs.existsSync(prodPath)) return prodPath;
  } catch { /* fall through */ }

  // Dev: icon in the universal assets directory.
  return path.join(__dirname, '..', '..', 'universal', 'assets', 'openagent-icon.png');
}

/**
 * Load the OpenAgent icon as a macOS template tray icon.
 *
 * On macOS template images are rendered by the system in the correct
 * colour for the current menu-bar appearance (dark in light mode,
 * white in dark mode). We resize to tray-native size (22pt macOS,
 * 16px Windows) and avoid pixel-level manipulation — the source PNG
 * is already crisp at these dimensions.
 */
function generateTrayIcon(): NativeImage {
  const iconPath = resolveTrayIconPath();
  const sourceImg = nativeImage.createFromPath(iconPath);

  if (sourceImg.isEmpty()) {
    console.error(`[tray] failed to load icon from ${iconPath}`);
    return nativeImage.createEmpty();
  }

  const traySize = process.platform === 'win32' ? 16 : 22;
  const resized = sourceImg.resize({ width: traySize, height: traySize });

  // Template mode: macOS draws the icon's alpha channel, ignoring
  // RGB, so it automatically looks correct in light AND dark menu bars.
  if (process.platform === 'darwin') {
    resized.setTemplateImage(true);
  }

  return resized;
}

// ── Tray menu builder ──

/**
 * Build the tray context menu from current state.
 */
function buildTrayMenu(): Menu {
  const primary = getPrimaryWindow();
  const isVisible = primary !== null && primary.isVisible() && !primary.isMinimized();

  const items: MenuItemConstructorOptions[] = [
    {
      label: isVisible ? 'Hide OpenAgent' : 'Show OpenAgent',
      click: () => {
        if (primary && !primary.isDestroyed()) {
          if (primary.isVisible() && !primary.isMinimized()) {
            primary.hide();
          } else {
            if (primary.isMinimized()) primary.restore();
            primary.show();
            primary.focus();
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: 'New Window',
      click: () => {
        const factory = getCreateWindowFactory();
        if (factory) factory({ markChild: true });
      },
    },
    {
      label: 'New Agent Window',
      click: () => {
        const factory = getCreateWindowFactory();
        if (factory) factory({});
      },
    },
    { type: 'separator' },
    {
      label: 'Memory Vault',
      click: () => {
        const focused = BrowserWindow.getFocusedWindow();
        const target = focused ?? primary;
        if (target && !target.isDestroyed()) {
          target.webContents.send('menu:navigate', '/vault');
        }
      },
    },
    {
      label: 'Scheduled Tasks',
      click: () => {
        const focused = BrowserWindow.getFocusedWindow();
        const target = focused ?? primary;
        if (target && !target.isDestroyed()) {
          target.webContents.send('menu:navigate', '/scheduled');
        }
      },
    },
    {
      label: 'Workflows',
      click: () => {
        const focused = BrowserWindow.getFocusedWindow();
        const target = focused ?? primary;
        if (target && !target.isDestroyed()) {
          target.webContents.send('menu:navigate', '/workflows');
        }
      },
    },
    {
      label: 'Active Sessions',
      click: () => {
        const focused = BrowserWindow.getFocusedWindow();
        const target = focused ?? primary;
        if (target && !target.isDestroyed()) {
          target.webContents.send('menu:navigate', '/sessions');
        }
      },
    },
  ];

  // Recent Agents submenu
  if (recentAgentList.length > 0) {
    items.push({
      label: 'Recent Agents',
      submenu: recentAgentList.map((agent) => ({
        label: agent,
        click: () => {
          const focused = BrowserWindow.getFocusedWindow();
          const target = focused ?? primary;
          if (target && !target.isDestroyed()) {
            target.webContents.send('menu:openAgent', agent);
          }
        },
      })),
    });
    items.push({ type: 'separator' });
  }

  items.push({
    label: 'Quit',
    click: () => {
      app.quit();
    },
  });

  return Menu.buildFromTemplate(items);
}

// ── Public API ──

/**
 * Create the system tray icon and menu.
 * Call once on app ready. No-op if a tray already exists.
 */
export function createTray(): Tray | null {
  if (tray) return tray;

  try {
    const icon = generateTrayIcon();
    if (icon.isEmpty()) {
      console.error('[tray] cannot create tray: icon is empty');
      return null;
    }

    tray = new Tray(icon);
    tray.setToolTip('OpenAgent');

    const menu = buildTrayMenu();
    tray.setContextMenu(menu);

    // Click on tray icon toggles the primary window.
    tray.on('click', () => {
      const primary = getPrimaryWindow();
      if (primary && !primary.isDestroyed()) {
        if (primary.isVisible() && !primary.isMinimized()) {
          primary.hide();
        } else {
          if (primary.isMinimized()) primary.restore();
          primary.show();
          primary.focus();
        }
      }
    });

    console.log('[tray] created successfully');
  } catch (err) {
    console.error('[tray] creation failed:', err);
    tray = null;
  }

  return tray;
}

/**
 * Update the recent agents list shown in the tray submenu.
 * Call when the user switches agents or when the agent list changes.
 */
export function updateTrayAgentList(agents: string[]): void {
  recentAgentList = agents;
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

/**
 * Get the current tray instance (null if not created).
 */
export function getTray(): Tray | null {
  return tray;
}

/**
 * Refresh the tray menu (e.g. after window visibility changes).
 */
export function refreshTrayMenu(): void {
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

/**
 * Destroy the tray (called on quit or when cleaning up).
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
