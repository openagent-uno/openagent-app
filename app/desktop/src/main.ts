/**
 * Electron main process.
 *
 * Dev:  loads from Expo web dev server (localhost:8081)
 * Prod: loads from bundled web-build/index.html
 */

import { app, BrowserWindow, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerStorageHandlers } from './services/storage';

const isDev = !app.isPackaged;

app.setAboutPanelOptions({
  applicationName: 'OpenAgent',
  applicationVersion: app.getVersion(),
  website: 'https://geroale.github.io/OpenAgent/',
});

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.openagent.desktop');
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 375,
    minHeight: 500,
    title: 'OpenAgent',
    titleBarStyle: 'hiddenInset',
    show: false, // show after content loads to avoid flash
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:8081');
  } else {
    const webBuild = path.resolve(__dirname, '..', 'web-build', 'index.html');
    if (fs.existsSync(webBuild)) {
      mainWindow.loadFile(webBuild);
    } else {
      console.error('web-build not found at:', webBuild);
      mainWindow.loadURL(`data:text/html,<h2>Build not found</h2><p>${webBuild}</p>`);
    }
  }

  // Show window once content is ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Auto-updater (production only) ──

function setupAutoUpdater(): void {
  if (isDev) return;

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info: any) => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `OpenAgent ${info.version} is ready to install.`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      .then(({ response }: { response: number }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('Auto-updater error:', err.message);
  });

  autoUpdater.checkForUpdatesAndNotify();
}

// ── App lifecycle ──

app.whenReady().then(() => {
  registerStorageHandlers();
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: clicking dock icon restores/focuses the window
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Second instance: focus existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
