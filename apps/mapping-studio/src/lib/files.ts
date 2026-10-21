import {
  importCsv,
  importFieldDictionary,
  importXlsx,
  type FieldDictionary,
  type ImportedSource,
} from '@mms/file-import';
import type { Diagnostic } from '@mms/mapping-core';

export interface Notice {
  id: string;
  severity: 'error' | 'warning' | 'info';
  text: string;
}

let counter = 0;
const notice = (severity: Notice['severity'], text: string): Notice => ({
  id: `n${counter++}`,
  severity,
  text,
});

const extension = (name: string): string => name.toLowerCase().replace(/^.*\./, '');

/** Reads CSV and Excel files into canonical sources. Files that cannot be read become notices. */
export async function readSourceFiles(
  files: readonly File[],
): Promise<{ imported: ImportedSource[]; notices: Notice[] }> {
  const imported: ImportedSource[] = [];
  const notices: Notice[] = [];
  for (const file of files) {
    const ext = extension(file.name);
    if (ext !== 'csv' && ext !== 'xlsx') {
      notices.push(
        notice(
          'error',
          `"${file.name}" was not loaded: only .csv and .xlsx files can be used as sources.`,
        ),
      );
      continue;
    }
    const result =
      ext === 'csv'
        ? importCsv(await file.text(), { fileName: file.name })
        : importXlsx(new Uint8Array(await file.arrayBuffer()), { fileName: file.name });
    if (result.ok) imported.push(result.value);
    else
      notices.push(
        notice(
          'error',
          `"${file.name}" was not loaded: ${result.issues.map((i) => i.message).join(' ')}`,
        ),
      );
  }
  return { imported, notices };
}

export async function readDictionaryFile(
  file: File,
): Promise<{ dictionary: FieldDictionary; diagnostics: Diagnostic[] } | { error: string }> {
  const r = importFieldDictionary(await file.text());
  return r.ok
    ? r.value.dictionary.entries.length === 0
      ? { error: `"${file.name}" has no usable field entries.` }
      : { dictionary: r.value.dictionary, diagnostics: r.value.diagnostics }
    : { error: r.issues.map((i) => i.message).join(' ') };
}

export const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '');
export { notice };
