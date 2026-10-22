const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const MAX_LENGTH = 80;

/**
 * A folder name that is safe on Windows, macOS, Linux and OneDrive: no path characters, no control characters,
 * no leading or trailing dots or spaces, no reserved device names, limited length. Never empty.
 */
export function safeName(name: string): string {
  let out = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (out.length > MAX_LENGTH) out = out.slice(0, MAX_LENGTH).replace(/[.\s]+$/g, '');
  if (out === '') return 'Untitled';
  if (RESERVED.has(out.toLowerCase().split('.')[0]!)) out = `${out}_`;
  return out;
}

/** The name itself when free, else "name (2)", "name (3)" ... Comparison ignores case, as file systems do. */
export function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** "2026-10-22T10:05:03.000Z" becomes "20261022-100503" (for archive and run folder names). */
export function stamp(iso: string): string {
  return iso
    .replace(/\.\d+Z?$/, '')
    .replace(/Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
}

/** A file name safe on every file system that keeps its extension ("con.csv" stays a .csv). */
export function safeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  const ext =
    dot > 0
      ? base
          .slice(dot)
          .replace(/[^A-Za-z0-9.]/g, '')
          .slice(0, 12)
      : '';
  const cleanExt = /[A-Za-z0-9]/.test(ext) ? ext : '';
  const stem = safeName(dot > 0 ? base.slice(0, dot) : base);
  const safeStem = RESERVED.has(stem.toLowerCase()) ? `${stem}_` : stem;
  return `${safeStem}${cleanExt}`;
}
