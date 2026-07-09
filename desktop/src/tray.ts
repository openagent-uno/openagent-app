/**
 * System tray icon and menu.
 *
 * Provides a persistent tray icon with quick actions: show/hide main
 * window, open new windows, list recent agents, and quit.
 */

import { app, BrowserWindow, Menu, MenuItemConstructorOptions, nativeImage, NativeImage, Tray } from 'electron';
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

// ── Icon generation ──

/**
 * Generate a simple 22×22 tray icon as a NativeImage.
 * Draws a filled circle with an "OA"-like motif so the tray icon is
 * recognisable even without a dedicated icon asset.
 */
function generateTrayIcon(): NativeImage {
  const size = 22;
  const scale = 2; // Retina-friendly
  const canvasSize = size * scale;

  // Create an empty BGRA buffer.
  const buffer = Buffer.alloc(canvasSize * canvasSize * 4, 0);

  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const radius = (canvasSize / 2) - 2;
  const innerRadius = radius * 0.55;

  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * canvasSize + x) * 4;

      // Outer filled circle (#7C3AED — purple, matching OA brand).
      if (dist <= radius) {
        buffer[idx] = 0xED;     // B
        buffer[idx + 1] = 0x3A;  // G
        buffer[idx + 2] = 0x7C;  // R
        buffer[idx + 3] = 255;   // A

        // Inner cutout (transparent) to make a ring / "O" shape.
        if (dist <= innerRadius) {
          buffer[idx] = 0;
          buffer[idx + 1] = 0;
          buffer[idx + 2] = 0;
          buffer[idx + 3] = 0;
        }
      }
    }
  }

  const img = nativeImage.createFromBuffer(buffer, {
    width: canvasSize,
    height: canvasSize,
  });
  // Downscale to the requested size (Electron handles HiDPI).
  return img.resize({ width: size, height: size });
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
