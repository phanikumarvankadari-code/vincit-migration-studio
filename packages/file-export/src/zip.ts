import { strToU8, zipSync } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

/** Bundles files into one ZIP archive (text is stored as UTF-8). */
export function toZip(entries: readonly ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) files[e.name] = typeof e.data === 'string' ? strToU8(e.data) : e.data;
  return zipSync(files);
}

/** UTF-8 bytes of text. */
export const utf8Bytes = (text: string): Uint8Array => strToU8(text);
