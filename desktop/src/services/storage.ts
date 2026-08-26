/**
 * Desktop-only persistent storage via electron-store.
 * Injected into the renderer via IPC handlers in main process.
 */

import { ipcMain } from 'electron';
import Store from 'electron-store';
import { createStorageCallbacks } from './storage-core';

// Construct only after ``app.setPath('userData', ...)`` has had a chance to
// run.  Eager module-level construction pins electron-store to the default
// profile before a local E2E or multi-profile launcher can isolate it.
const callbacks = createStorageCallbacks(
  () => new Store<Record<string, string>>({ name: 'openagent-desktop' }),
);

export function registerStorageHandlers(): void {
  ipcMain.handle('storage:get', (_event, key: string) => {
    return callbacks.get(_event, key);
  });

  ipcMain.handle('storage:set', (_event, key: string, value: string) => {
    callbacks.set(_event, key, value);
  });

  ipcMain.handle('storage:remove', (_event, key: string) => {
    callbacks.remove(_event, key);
  });
}
