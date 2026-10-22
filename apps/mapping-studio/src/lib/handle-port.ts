import type { FilePort, PortEntry } from '@mms/workspace-files';

/** Browser file storage (OPFS) can hold the workspace when the browser can write files from the page. */
export function browserStorageSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  );
}

export const browserStorageRoot = (): Promise<FileSystemDirectoryHandle> =>
  navigator.storage.getDirectory();

async function dirAt(
  root: FileSystemDirectoryHandle,
  path: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | undefined> {
  let dir = root;
  for (const name of path) {
    try {
      dir = await dir.getDirectoryHandle(name, { create });
    } catch {
      return undefined;
    }
  }
  return dir;
}

/** A FilePort over any directory handle: the browser's own storage, or a folder the user picked. */
export function handlePort(root: FileSystemDirectoryHandle): FilePort {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const readBytes = async (path: readonly string[]): Promise<Uint8Array | undefined> => {
    const dir = await dirAt(root, path.slice(0, -1), false);
    if (!dir) return undefined;
    try {
      const file = await (await dir.getFileHandle(path[path.length - 1]!)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return undefined;
    }
  };
  const writeBytes = async (path: readonly string[], bytes: Uint8Array): Promise<void> => {
    const dir = await dirAt(root, path.slice(0, -1), true);
    if (!dir) throw new Error(`Cannot create the folder for ${path.join('/')}.`);
    const handle = await dir.getFileHandle(path[path.length - 1]!, { create: true });
    const w = await handle.createWritable();
    await w.write(bytes as BufferSource);
    await w.close();
  };
  return {
    async list(path): Promise<PortEntry[]> {
      const dir = await dirAt(root, path, false);
      if (!dir) return [];
      const out: PortEntry[] = [];
      for await (const [name, h] of (
        dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
      ).entries())
        out.push({ name, kind: h.kind === 'directory' ? 'dir' : 'file' });
      return out;
    },
    readBytes,
    writeBytes,
    async readText(path) {
      const b = await readBytes(path);
      return b === undefined ? undefined : dec.decode(b);
    },
    writeText: (path, text) => writeBytes(path, enc.encode(text)),
    async remove(path) {
      const dir = await dirAt(root, path.slice(0, -1), false);
      if (!dir) return;
      try {
        await dir.removeEntry(path[path.length - 1]!, { recursive: true });
      } catch {
        /* already gone */
      }
    },
  };
}
