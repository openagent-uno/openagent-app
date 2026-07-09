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
} from './window-manager';

// ── Globals ──

let tray: Tray | null = null;

/** Cached agent list shared between tray and dock. */
let recentAgentList: string[] = [];

// ── Icon ──

/**
 * Resolve the tray icon path across dev and production environments.
 *
 * In dev, the icon lives in ``desktop/buildResources/icon.png`` relative
 * to the source root. In production, electron-builder ships the icon
 * alongside the compiled JS in the asar (copied by the bundle script).
 */
function resolveTrayIconPath(): string {
  // Production: icon copied into dist/ by the bundle script.
  const prodPath = path.join(__dirname, 'icon.png');
  try {
    if (fs.existsSync(prodPath)) return prodPath;
  } catch { /* fall through */ }

  // Dev: icon in the buildResources directory.
  return path.join(__dirname, '..', 'buildResources', 'icon.png');
}

/**
 * Load the OpenAgent logo as a tray icon.
 *
 * Resizes the full app icon to tray dimensions and, on macOS, marks it
 * as a template image so it adapts to light/dark menu bar automatically.
 */
function generateTrayIcon(): NativeImage {
  const iconPath = resolveTrayIconPath();
  let img = nativeImage.createFromPath(iconPath);

  // If the icon couldn't be loaded, fall back to a minimal empty image
  // so the tray still appears (just blank) rather than crashing.
  if (img.isEmpty()) {
    console.error(`[tray] Failed to load icon from ${iconPath}`);
    return nativeImage.createEmpty();
  }

  // Tray icons: macOS menu bar is 22×22 pt (44×44 px @2x),
  // Windows notification area is 16×16, Linux is 22×22.
  const size = process.platform === 'win32' ? 16 : 22;
  img = img.resize({ width: size, height: size });

  // macOS template images: the alpha channel defines the shape and the
  // system renders it in the correct colour for light/dark mode.
  if (process.platform === 'darwin') {
    img.setTemplateImage(true);
  }

  return img;
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
        const focused = BrowserWindow.getFocusedWindow();
        const target = focused ?? primary;
        if (target && !target.isDestroyed()) {
          target.webContents.send('menu:newWindow');
        }
      },
    },
    {
      label: 'New Agent Window',
      click: () => {
        const focused = BrowserWindow.getFocusedWindow();
        const target = focused ?? primary;
        if (target && !target.isDestroyed()) {
          target.webContents.send('menu:newAgentWindow');
        }
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

  const icon = generateTrayIcon();
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
