import { Configuration } from 'crawlee';

export { resolveStorageDir } from './resolve-storage-dir.js';

export function configureStorage(storageDir: string): void {
  Configuration.getGlobalConfig().set('storageClientOptions', { localDataDirectory: storageDir });
  Configuration.getGlobalConfig().set('purgeOnStart', false);
}
