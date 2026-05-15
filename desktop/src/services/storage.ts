/**
 * Desktop-only persistent storage via electron-store.
 * Injected into the renderer via IPC handlers in main process.
 */

import { ipcMain } from 'electron';
import Store from 'electron-store';

const store = new Store({ name: 'openagent-desktop' });

export function registerStorageHandlers(): void {
  ipcMain.handle('storage:get', (_event, key: string) => {
    return store.get(key, null) as string | null;
  });

  ipcMain.handle('storage:set', (_event, key: string, value: string) => {
    store.set(key, value);
  });

  ipcMain.handle('storage:remove', (_event, key: string) => {
    store.delete(key);
  });
}
