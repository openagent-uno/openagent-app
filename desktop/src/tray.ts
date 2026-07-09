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
 * Load the OpenAgent polygon-bird logo as a tray icon.
 *
 * Renders the bird in white at the native tray size with padding so the
 * shape is crisp and not stretched edge-to-edge.
 */
function generateTrayIcon(): NativeImage {
  const iconPath = resolveTrayIconPath();
  const sourceImg = nativeImage.createFromPath(iconPath);

  if (sourceImg.isEmpty()) {
    console.error(`[tray] Failed to load icon from ${iconPath}`);
    return nativeImage.createEmpty();
  }

  const traySize = process.platform === 'win32' ? 16 : 22;
  const padding = Math.max(2, Math.round(traySize * 0.1));
  const contentMax = traySize - padding * 2;

  const srcSize = sourceImg.getSize();
  const srcBitmap = sourceImg.toBitmap(); // BGRA, one byte per channel

  // Fit the polygon bird inside the padded area, preserving aspect ratio.
  const scale = Math.min(contentMax / srcSize.width, contentMax / srcSize.height);
  const drawW = Math.round(srcSize.width * scale);
  const drawH = Math.round(srcSize.height * scale);

  // Build at 2× for retina sharpness, then downscale.
  const scaleFactor = 2;
  const canvas = traySize * scaleFactor;
  const buffer = Buffer.alloc(canvas * canvas * 4, 0);

  const ox = Math.round((canvas - drawW * scaleFactor) / 2);
  const oy = Math.round((canvas - drawH * scaleFactor) / 2);

  // Nearest-neighbour scale into the output buffer.
  // Every non-transparent source pixel becomes white in the output.
  for (let dy = 0; dy < drawH * scaleFactor; dy++) {
    for (let dx = 0; dx < drawW * scaleFactor; dx++) {
      const sx = Math.floor((dx / scaleFactor) / scale);
      const sy = Math.floor((dy / scaleFactor) / scale);
      const si = (sy * srcSize.width + sx) * 4;
      const sa = srcBitmap[si + 3]; // source alpha

      if (sa > 128) {
        const di = ((oy + dy) * canvas + (ox + dx)) * 4;
        buffer[di] = 255;     // B
        buffer[di + 1] = 255; // G
        buffer[di + 2] = 255; // R
        buffer[di + 3] = sa;  // A
      }
    }
  }

  const img = nativeImage.createFromBitmap(buffer, {
    width: canvas,
    height: canvas,
  });

  return img.resize({ width: traySize, height: traySize });
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
