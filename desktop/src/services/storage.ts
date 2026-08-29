/**
 * Desktop-only persistent storage via electron-store.
 * Injected into the renderer via IPC handlers in main process.
 */

import Store from 'electron-store';
import { handleTrustedIpc } from '../security/trusted-ipc';

const store = new Store({ name: 'openagent-desktop' });

export function registerStorageHandlers(): void {
  handleTrustedIpc('storage:get', (_event, key: string) => {
    return store.get(key, null) as string | null;
  });

  handleTrustedIpc('storage:set', (_event, key: string, value: string) => {
    store.set(key, value);
  });

  handleTrustedIpc('storage:remove', (_event, key: string) => {
    store.delete(key);
  });
}
