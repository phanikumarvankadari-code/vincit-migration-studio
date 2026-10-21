import { importCsv, importXlsx, type ImportedSource } from '@mms/file-import';
import type { Diagnostic, Result, TargetDefinition } from '@mms/mapping-core';
import {
  detectTargetLayout,
  parseTargetStructures,
  type TargetLayout,
  type TargetTable,
} from '@mms/target-parser';

export interface TargetFile {
  name: string;
  /** Raw bytes for an Excel workbook, or decoded text for a CSV file. */
  content: Uint8Array | string;
}

export interface TargetPreview {
  table: ImportedSource;
  /** The worksheet row used as header (always 1 for CSV). */
  headerRow: number;
  layout: TargetLayout;
  target: TargetDefinition;
  diagnostics: Diagnostic[];
}

const isXlsx = (f: TargetFile): f is TargetFile & { content: Uint8Array } =>
  typeof f.content !== 'string';

/** Reads the file into a table with the given header row (CSV ignores the row number). */
export function readTargetTable(file: TargetFile, headerRow: number): Result<ImportedSource> {
  return isXlsx(file)
    ? importXlsx(file.content, { fileName: file.name, headerRow })
    : importCsv(file.content as string, { fileName: file.name });
}

/** Parses the table with the layout, or reports why it cannot. */
export function previewTarget(
  file: TargetFile,
  headerRow: number,
  layout: TargetLayout,
  name: string,
): Result<TargetPreview> {
  const table = readTargetTable(file, headerRow);
  if (!table.ok) return table;
  const parsed = parseTargetStructures(table.value as TargetTable, layout, { name });
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      table: table.value,
      headerRow,
      layout,
      target: parsed.value.target,
      diagnostics: [...table.value.diagnostics, ...parsed.value.diagnostics],
    },
  };
}

/**
 * Finds the header row and layout by trying the first rows of the sheet, so the user usually only confirms.
 * Fails with the reason when nothing in the first rows looks like a target definition.
 */
export function autoImportTarget(
  file: TargetFile,
  name: string,
  maxHeaderRow = 15,
): Result<TargetPreview> {
  const candidates = isXlsx(file) ? Array.from({ length: maxHeaderRow }, (_, i) => i + 1) : [1];
  let lastIssues: Diagnostic[] = [
    {
      severity: 'error',
      code: 'TARGET_NOT_RECOGNISED',
      message:
        'No header row with a field name column was found in the first rows. Choose the header row and columns yourself.',
    },
  ];
  for (const headerRow of candidates) {
    const table = readTargetTable(file, headerRow);
    if (!table.ok) {
      lastIssues = table.issues;
      continue;
    }
    const detected = detectTargetLayout(table.value as TargetTable);
    if (!detected.ok) continue;
    const parsed = parseTargetStructures(table.value as TargetTable, detected.value.layout, {
      name,
    });
    if (!parsed.ok || parsed.value.target.structures.every((s) => s.fields.length === 0)) continue;
    return {
      ok: true,
      value: {
        table: table.value,
        headerRow,
        layout: detected.value.layout,
        target: parsed.value.target,
        diagnostics: [
          ...table.value.diagnostics,
          ...detected.value.diagnostics,
          ...parsed.value.diagnostics,
        ],
      },
    };
  }
  return { ok: false, issues: lastIssues };
}
