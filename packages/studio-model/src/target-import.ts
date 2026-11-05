import {
  importCsv,
  importWorkbook,
  listWorkbookSheets,
  type ImportedSource,
} from '@mms/file-import';
import { toBase64, type Diagnostic, type Result, type TargetDefinition } from '@mms/mapping-core';
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
export function readTargetTable(
  file: TargetFile,
  headerRow: number,
  sheets?: string[],
): Result<ImportedSource> {
  // A template workbook is read from its Field List sheet unless sheets are named.
  const only =
    sheets ??
    (() => {
      const t = templateSheets(file);
      return t ? [t.fieldList] : undefined;
    })();
  return isXlsx(file)
    ? importWorkbook(file.content, {
        fileName: file.name,
        headerRow,
        ...(only ? { sheets: only } : {}),
      })
    : importCsv(file.content as string, { fileName: file.name });
}

/** Row of an SAP migration template sheet that holds the technical field names. */
const TEMPLATE_TECHNICAL_ROW = 5;

/**
 * A target template workbook has a "Field List" sheet that defines the structures, and one sheet per structure that
 * is a placeholder for the data (its technical field names are in row 5). Returns the sheet names, or undefined when
 * the file is not laid out like that.
 */
function templateSheets(file: TargetFile): { fieldList: string; others: string[] } | undefined {
  if (!isXlsx(file)) return undefined;
  const list = listWorkbookSheets(file.content);
  if (!list.ok) return undefined;
  const visible = list.value.filter((x) => !x.hidden).map((x) => x.name);
  const fieldList = visible.find((n) => n.trim().toLowerCase() === 'field list');
  const others = visible.filter(
    (n) => n !== fieldList && n.trim().toLowerCase() !== 'introduction',
  );
  return fieldList && others.length > 0 ? { fieldList, others } : undefined;
}

/**
 * Template mode: connects each structure of the target to its data sheet in the workbook, checks that the sheet
 * has the fields of the structure (by technical name), and keeps the workbook so output can be written into it.
 */
function attachTemplate(
  file: TargetFile & { content: Uint8Array },
  target: TargetDefinition,
  sheets: string[],
): { target: TargetDefinition; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const note = (severity: Diagnostic['severity'], code: string, message: string): void => {
    diagnostics.push({ severity, code, message });
  };
  const structures = target.structures.map((st) => {
    const sheet = sheets.find((n) => n.trim().toLowerCase() === st.name.trim().toLowerCase());
    if (!sheet) {
      note(
        'warning',
        'TARGET_TEMPLATE_SHEET_MISSING',
        `The template has no sheet named "${st.name}", so its data cannot be written into the template.`,
      );
      return st;
    }
    const table = importWorkbook(file.content, {
      fileName: file.name,
      sheets: [sheet],
      headerRow: TEMPLATE_TECHNICAL_ROW,
    });
    if (!table.ok) {
      note(
        'warning',
        'TARGET_TEMPLATE_SHEET_UNREADABLE',
        `Sheet "${sheet}" could not be read: ${table.issues.map((i) => i.message).join(' ')}`,
      );
      return { ...st, templateSheet: sheet };
    }
    const columns = new Set(
      (table.value.source.datasets[0]?.fields ?? []).map((f) => f.displayName.trim()),
    );
    const missing = st.fields.filter((f) => !f.technicalName || !columns.has(f.technicalName));
    if (missing.length > 0)
      note(
        'warning',
        'TARGET_TEMPLATE_FIELDS_MISSING',
        `Sheet "${sheet}" has no column for: ${missing.map((f) => f.displayName).join(', ')}. These fields are not written into the template.`,
      );
    return { ...st, templateSheet: sheet };
  });
  return {
    target: {
      ...target,
      structures,
      template: { fileName: file.name, base64: toBase64(file.content) },
    },
    diagnostics,
  };
}

/** Parses the table with the layout, or reports why it cannot. */
export function previewTarget(
  file: TargetFile,
  headerRow: number,
  layout: TargetLayout,
  name: string,
): Result<TargetPreview> {
  const template = templateSheets(file);
  const table = readTargetTable(file, headerRow, template ? [template.fieldList] : undefined);
  if (!table.ok) return table;
  const parsed = parseTargetStructures(table.value as TargetTable, layout, { name });
  if (!parsed.ok) return parsed;
  const attached =
    template && isXlsx(file)
      ? attachTemplate(file, parsed.value.target, template.others)
      : { target: parsed.value.target, diagnostics: [] as Diagnostic[] };
  return {
    ok: true,
    value: {
      table: table.value,
      headerRow,
      layout,
      target: attached.target,
      diagnostics: [
        ...table.value.diagnostics,
        ...parsed.value.diagnostics,
        ...attached.diagnostics,
      ],
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
  const template = templateSheets(file);
  const only = template ? [template.fieldList] : undefined;
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
    const table = readTargetTable(file, headerRow, only);
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
    const attached =
      template && isXlsx(file)
        ? attachTemplate(file, parsed.value.target, template.others)
        : { target: parsed.value.target, diagnostics: [] as Diagnostic[] };
    return {
      ok: true,
      value: {
        table: table.value,
        headerRow,
        layout: detected.value.layout,
        target: attached.target,
        diagnostics: [
          ...table.value.diagnostics,
          ...detected.value.diagnostics,
          ...parsed.value.diagnostics,
          ...attached.diagnostics,
        ],
      },
    };
  }
  return { ok: false, issues: lastIssues };
}
