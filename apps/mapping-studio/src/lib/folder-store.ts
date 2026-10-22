/** Remembers the folder the user chose, so it need not be chosen again. Handles can be kept in IndexedDB. */
const DB = 'mms';
const STORE = 'handles';
const KEY = 'workspace-root';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available.'));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB failed.'));
    });
  } finally {
    db.close();
  }
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(handle, KEY));
  } catch {
    /* without it the folder has to be chosen again next time */
  }
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const v = await run<unknown>('readonly', (s) => s.get(KEY));
    return v && typeof v === 'object' && 'kind' in v ? (v as FileSystemDirectoryHandle) : undefined;
  } catch {
    return undefined;
  }
}

export async function forgetFolderHandle(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing to forget */
  }
}

interface Permissioned {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
}

export async function folderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const h = handle as unknown as Permissioned;
  return h.queryPermission ? h.queryPermission({ mode: 'readwrite' }) : 'granted';
}

/** Must be called from a click. */
export async function requestFolderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const h = handle as unknown as Permissioned;
  return h.requestPermission ? h.requestPermission({ mode: 'readwrite' }) : 'granted';
}

export const folderPickerSupported = (): boolean =>
  typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
  'function';

export async function pickFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await (
      window as unknown as {
        showDirectoryPicker: (o: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return undefined;
    throw e;
  }
}
