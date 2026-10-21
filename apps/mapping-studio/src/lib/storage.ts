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
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};
