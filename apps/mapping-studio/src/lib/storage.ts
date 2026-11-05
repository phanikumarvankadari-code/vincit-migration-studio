import { decodeWorkspace, type Workspace } from '@mms/studio-model';

const KEY = 'mms:workspace';

export type Stored =
  { kind: 'none' } | { kind: 'ok'; workspace: Workspace } | { kind: 'unreadable'; reason: string };

/** The project saved in this browser, if any. A damaged copy is reported, never half-loaded. */
export function loadStored(text?: string | null): Stored {
  let raw: string | null | undefined = text;
  if (raw === undefined) {
    try {
      raw = window.localStorage.getItem(KEY);
    } catch {
      return { kind: 'none' };
    }
  }
  if (!raw) return { kind: 'none' };
  const r = decodeWorkspace(raw);
  return r.ok
    ? { kind: 'ok', workspace: r.value }
    : { kind: 'unreadable', reason: r.issues.map((i) => i.message).join(' ') };
}

export function store(text: string): { ok: true } | { ok: false; message: string } {
  try {
    window.localStorage.setItem(KEY, text);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error && e.name === 'QuotaExceededError'
          ? 'The browser has no room left to save the project.'
          : 'The browser would not save the project.',
    };
  }
}

export function clearStored(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Project library: every project worked on in this browser is kept (draft, snapshots, dictionary;
 * never row data) so an earlier project can be opened again. `mms:workspace` stays the project
 * that was open last.
 */
const INDEX_KEY = 'mms:projects';
const entryKey = (id: string): string => `mms:project:${id}`;

export interface LibraryEntry {
  id: string;
  name: string;
  businessEntity: string;
  savedAt: string;
}

export function listProjects(): LibraryEntry[] {
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as LibraryEntry[])
      .filter((e) => typeof e?.id === 'string' && typeof e.name === 'string')
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export function saveToLibrary(entry: LibraryEntry, text: string): void {
  try {
    window.localStorage.setItem(entryKey(entry.id), text);
    const others = listProjects().filter((e) => e.id !== entry.id);
    window.localStorage.setItem(INDEX_KEY, JSON.stringify([entry, ...others]));
  } catch {
    /* the library is a convenience on top of the autosave; a full browser is reported there */
  }
}

export function loadFromLibrary(id: string): Stored {
  try {
    return loadStored(window.localStorage.getItem(entryKey(id)) ?? '');
  } catch {
    return { kind: 'none' };
  }
}

/** The saved text of a project kept in the browser library (for moving it into a workspace). */
export function readLibraryText(id: string): string | undefined {
  try {
    return window.localStorage.getItem(entryKey(id)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function deleteFromLibrary(id: string): void {
  try {
    window.localStorage.removeItem(entryKey(id));
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify(listProjects().filter((e) => e.id !== id)),
    );
  } catch {
    /* nothing to delete */
  }
}

/** Offers a file to the user as a download. */
export function downloadFile(name: string, content: string | Uint8Array, mime: string): void {
  const blob = new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const MIME: Record<string, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  xml: 'application/xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};
