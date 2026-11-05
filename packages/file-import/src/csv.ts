import type { Diagnostic, Result, SourceLocation, SourceValue } from '@mms/mapping-core';
import {
  assignDatasetIds,
  buildSource,
  datasetNameFromFile,
  diag,
  type ImportedSource,
} from './common.js';

export interface CsvImportOptions {
  /** File name, used for the source name and default dataset name. */
  fileName: string;
  /** The field separator. Default: found from the header line (tab, semicolon, pipe or comma). */
  delimiter?: string;
  datasetName?: string;
  location?: SourceLocation;
}

export interface RawCsvRow {
  cells: SourceValue[];
  /** 1-based physical line where the row starts. */
  line: number;
}

type ParseOutcome =
  { ok: true; rows: RawCsvRow[] } | { ok: false; code: string; message: string; line: number };

/**
 * RFC 4180 style parser. Unquoted empty field -> null. Quoted empty field ("") -> ''.
 * Values are never trimmed or converted. Blank lines are skipped. A quote inside an unquoted
 * field is kept literally.
 */
export function parseCsvText(input: string, delimiter = ','): ParseOutcome {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: RawCsvRow[] = [];
  let cells: SourceValue[] = [];
  let field = '';
  let quoted = false; // current field was quoted
  let inQuotes = false;
  let atFieldStart = true; // no character of the current field consumed yet
  let rowHasContent = false; // the row has any character or delimiter, so it is not blank
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;

  const endField = (): void => {
    cells.push(!quoted && field === '' ? null : field);
    field = '';
    quoted = false;
    atFieldStart = true;
  };
  const endRow = (): void => {
    const blank = cells.length === 0 && !rowHasContent;
    if (!blank) {
      endField();
      rows.push({ cells, line: rowLine });
    }
    cells = [];
    field = '';
    quoted = false;
    atFieldStart = true;
    rowHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      quoted = true;
      atFieldStart = false;
      rowHasContent = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      endField();
      rowHasContent = true; // a delimiter makes the row non-blank
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
      atFieldStart = false;
      rowHasContent = true;
    }
  }
  if (inQuotes) {
    return {
      ok: false,
      code: 'CSV_UNTERMINATED_QUOTE',
      message: `A quoted field starting on line ${quoteLine} is never closed.`,
      line: quoteLine,
    };
  }
  if (cells.length > 0 || rowHasContent) endRow();
  return { ok: true, rows };
}

function fail(code: string, message: string, extra: Partial<Diagnostic> = {}): Result<never> {
  return { ok: false, issues: [diag('error', code, message, extra)] };
}

/** Header names: blank headers become "Column N" (warning). Duplicates are kept (warning). */
export function normalizeHeaders(
  raw: readonly SourceValue[],
  codePrefix: string,
  datasetId?: string,
): { headers: string[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, number>();
  const headers = raw.map((h, i) => {
    let name = h ?? '';
    if (name.trim() === '') {
      name = `Column ${i + 1}`;
      diagnostics.push(
        diag(
          'warning',
          `${codePrefix}_BLANK_HEADER`,
          `Column ${i + 1} has no header and was named "${name}".`,
          ctx(datasetId),
        ),
      );
    }
    seen.set(name, (seen.get(name) ?? 0) + 1);
    return name;
  });
  for (const [name, count] of seen) {
    if (count > 1) {
      diagnostics.push(
        diag(
          'warning',
          `${codePrefix}_DUPLICATE_HEADER`,
          `Header "${name}" appears ${count} times. Columns are kept separate.`,
          ctx(datasetId),
        ),
      );
    }
  }
  return { headers, diagnostics };
}

const ctx = (datasetId?: string): Partial<Diagnostic> =>
  datasetId ? ({ datasetId } as Partial<Diagnostic>) : {};

/** Makes every row exactly `width` wide, reporting anything padded or cut. Nothing is dropped silently. */
export function fitRows(
  rows: readonly { cells: SourceValue[] }[],
  width: number,
  codePrefix: string,
  datasetId: string,
): { rows: SourceValue[][]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const out = rows.map((r, idx) => {
    const sourceRow = idx + 1;
    if (r.cells.length < width) {
      diagnostics.push(
        diag(
          'warning',
          `${codePrefix}_ROW_TOO_SHORT`,
          `Row ${sourceRow} has ${r.cells.length} values but the header has ${width}. Missing values were set to blank.`,
          { datasetId, sourceRow } as Partial<Diagnostic>,
        ),
      );
      return [...r.cells, ...Array<SourceValue>(width - r.cells.length).fill(null)];
    }
    if (r.cells.length > width) {
      const extra = r.cells.slice(width);
      diagnostics.push(
        diag(
          'error',
          `${codePrefix}_ROW_TOO_LONG`,
          `Row ${sourceRow} has ${r.cells.length} values but the header has ${width}. Extra values were not imported.`,
          {
            datasetId,
            sourceRow,
            technicalDetails: `Dropped: ${JSON.stringify(extra)}`,
          } as Partial<Diagnostic>,
        ),
      );
      return r.cells.slice(0, width);
    }
    return r.cells;
  });
  return { rows: out, diagnostics };
}

/**
 * Finds the separator from the header line: the one of tab, semicolon, pipe and comma that occurs most often outside
 * quotes. SAP table dumps are usually tab separated. A tie or a header with none of them gives a comma.
 */
export function detectDelimiter(text: string): string {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let end = start;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
  const counts: Record<string, number> = { '\t': 0, ';': 0, '|': 0, ',': 0 };
  let quoted = false;
  for (let i = start; i < end; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]!++;
  }
  let best = ',';
  for (const d of ['\t', ';', '|', ',']) if (counts[d]! > counts[best]!) best = d;
  return best;
}

/** Input is decoded text (UTF-8). The importer reads no files and uses no Node or DOM APIs. */
export function importCsv(text: string, options: CsvImportOptions): Result<ImportedSource> {
  const parsed = parseCsvText(text, options.delimiter ?? detectDelimiter(text));
  if (!parsed.ok)
    return fail(parsed.code, parsed.message, { technicalDetails: `line ${parsed.line}` });
  const [headerRow, ...dataRows] = parsed.rows;
  if (!headerRow) return fail('CSV_EMPTY', 'The file contains no header row.');

  const name = options.datasetName ?? datasetNameFromFile(options.fileName);
  const datasetId = assignDatasetIds([name])[0]!;
  const { headers, diagnostics } = normalizeHeaders(headerRow.cells, 'CSV', datasetId);
  const fitted = fitRows(dataRows, headers.length, 'CSV', datasetId);
  const final = buildSource({
    fileName: options.fileName,
    sourceType: 'csv',
    location: options.location ?? { kind: 'localFile', path: options.fileName },
    datasets: [{ id: datasetId, name, headers, rows: fitted.rows }],
  });
  const all = [...diagnostics, ...fitted.diagnostics];
  if (dataRows.length === 0) {
    all.push(
      diag('warning', 'CSV_NO_DATA_ROWS', 'The file has a header but no data rows.', {
        datasetId,
      } as Partial<Diagnostic>),
    );
  }
  return { ok: true, value: { source: final.source, rows: final.rows, diagnostics: all } };
}
