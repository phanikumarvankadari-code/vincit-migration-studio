import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { Diagnostic, Result, SourceLocation, SourceValue } from '@mms/mapping-core';
import { assignDatasetIds, buildSource, diag, type ImportedSource } from './common.js';
import { normalizeHeaders } from './csv.js';

export interface XlsxImportOptions {
  fileName: string;
  /** Sheets to import by name. Default: all visible sheets. */
  sheets?: string[];
  /** 1-based worksheet row holding the headers. Default: first non-empty row. */
  headerRow?: number;
  location?: SourceLocation;
}

export interface SheetInfo {
  name: string;
  hidden: boolean;
}

const ARRAY_TAGS = new Set(['sheet', 'si', 'r', 'row', 'c', 'xf', 'numFmt', 'Relationship']);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, unknown>;
const asNode = (v: unknown): Node => (v && typeof v === 'object' ? (v as Node) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** Text of an element that may be a string or an object with attributes and #text. */
function textOf(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return textOf((v as Node)['#text']);
  return String(v);
}

interface Workbook {
  files: Record<string, Uint8Array>;
  sheets: (SheetInfo & { path: string })[];
  date1904: boolean;
}

function readWorkbook(bytes: Uint8Array): Result<Workbook> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return {
      ok: false,
      issues: [
        diag(
          'error',
          'XLSX_INVALID_FILE',
          'The file is not a valid XLSX workbook (not a zip archive).',
        ),
      ],
    };
  }
  const wbFile = files['xl/workbook.xml'];
  if (!wbFile) {
    return {
      ok: false,
      issues: [
        diag(
          'error',
          'XLSX_INVALID_FILE',
          'The file is not a valid XLSX workbook (xl/workbook.xml is missing).',
        ),
      ],
    };
  }
  const wb = asNode(asNode(parser.parse(strFromU8(wbFile)))['workbook']);
  const relsFile = files['xl/_rels/workbook.xml.rels'];
  const rels = new Map<string, string>();
  if (relsFile) {
    const doc = asNode(asNode(parser.parse(strFromU8(relsFile)))['Relationships']);
    for (const r of asArray(doc['Relationship'])) {
      const n = asNode(r);
      rels.set(String(n['@_Id']), String(n['@_Target']));
    }
  }
  const sheets = asArray(asNode(wb['sheets'])['sheet']).map((s, i) => {
    const n = asNode(s);
    const target = rels.get(String(n['@_r:id'])) ?? `worksheets/sheet${i + 1}.xml`;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    return {
      name: String(n['@_name']),
      hidden: n['@_state'] === 'hidden' || n['@_state'] === 'veryHidden',
      path,
    };
  });
  const date1904 =
    asNode(wb['workbookPr'])['@_date1904'] === '1' ||
    asNode(wb['workbookPr'])['@_date1904'] === 'true';
  return { ok: true, value: { files, sheets, date1904 } };
}

export function listXlsxSheets(bytes: Uint8Array): Result<SheetInfo[]> {
  const wb = readWorkbook(bytes);
  if (!wb.ok) return wb;
  return { ok: true, value: wb.value.sheets.map(({ name, hidden }) => ({ name, hidden })) };
}

function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const f = files['xl/sharedStrings.xml'];
  if (!f) return [];
  const sst = asNode(asNode(parser.parse(strFromU8(f)))['sst']);
  return asArray(sst['si']).map((si) => {
    const n = asNode(si);
    if (n['t'] !== undefined) return textOf(n['t']);
    return asArray(n['r'])
      .map((r) => textOf(asNode(r)['t']))
      .join('');
  });
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Style index -> is this a date/time format? */
function readDateStyles(files: Record<string, Uint8Array>): (xf: number) => boolean {
  const f = files['xl/styles.xml'];
  if (!f) return () => false;
  const styles = asNode(asNode(parser.parse(strFromU8(f)))['styleSheet']);
  const custom = new Map<number, string>();
  for (const nf of asArray(asNode(styles['numFmts'])['numFmt'])) {
    const n = asNode(nf);
    custom.set(Number(n['@_numFmtId']), String(n['@_formatCode']));
  }
  const xfs = asArray(asNode(styles['cellXfs'])['xf']).map((x) =>
    Number(asNode(x)['@_numFmtId'] ?? 0),
  );
  return (xf: number): boolean => {
    const id = xfs[xf];
    if (id === undefined) return false;
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    if (!code) return false;
    const stripped = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dmyhs]/i.test(stripped);
  };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Excel serial number to ISO text. Returns undefined for the non-existent 1900-02-29. */
export function excelSerialToIso(serial: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial) || serial < 0) return undefined;
  const day = Math.floor(serial);
  if (!date1904 && day === 60) return undefined;
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : day < 60
      ? Date.UTC(1899, 11, 31)
      : Date.UTC(1899, 11, 30);
  const secondsOfDay = Math.round((serial - day) * 86400);
  const d = new Date(epoch + day * 86400000 + secondsOfDay * 1000);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (secondsOfDay === 0) return date;
  return `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}
const colName = (i: number): string => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

interface Grid {
  rows: Map<number, Map<number, SourceValue>>; // worksheet row number -> column -> value
  dateColumns: Set<number>;
  diagnostics: Diagnostic[];
}

function readSheet(
  wb: Workbook,
  path: string,
  shared: string[],
  isDate: (xf: number) => boolean,
): Grid {
  const grid: Grid = { rows: new Map(), dateColumns: new Set(), diagnostics: [] };
  const f = wb.files[path];
  if (!f) return grid;
  const ws = asNode(asNode(parser.parse(strFromU8(f)))['worksheet']);
  for (const rowNode of asArray(asNode(ws['sheetData'])['row'])) {
    const row = asNode(rowNode);
    const rowNo = Number(row['@_r']);
    const cells = new Map<number, SourceValue>();
    let fallbackCol = 0;
    for (const cNode of asArray(row['c'])) {
      const c = asNode(cNode);
      const ref = c['@_r'] !== undefined ? String(c['@_r']) : '';
      const col = ref ? colIndex(ref) : fallbackCol;
      fallbackCol = col + 1;
      const t = c['@_t'] as string | undefined;
      const v = c['v'] === undefined ? undefined : textOf(c['v']);
      let value: SourceValue = null;
      if (t === 's') value = v === undefined ? null : (shared[Number(v)] ?? null);
      else if (t === 'inlineStr') value = textOf(asNode(c['is'])['t'] ?? '');
      else if (t === 'str' || t === 'd') value = v === undefined ? null : v;
      else if (t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : null;
      else if (t === 'e') {
        value = v ?? '#ERROR';
        grid.diagnostics.push(
          diag(
            'warning',
            'XLSX_CELL_ERROR',
            `Cell ${colName(col)}${rowNo} holds the Excel error ${value}. It was imported as text.`,
            { technicalDetails: `${colName(col)}${rowNo}` },
          ),
        );
      } else if (v !== undefined && v !== '') {
        value = v;
        if (isDate(Number(c['@_s'] ?? 0))) {
          const iso = excelSerialToIso(Number(v), wb.date1904);
          if (iso !== undefined) {
            value = iso;
            grid.dateColumns.add(col);
          } else {
            grid.diagnostics.push(
              diag(
                'warning',
                'XLSX_DATE_NOT_CONVERTED',
                `Cell ${colName(col)}${rowNo} looks like a date but could not be converted. The raw number ${v} was kept.`,
                { technicalDetails: `${colName(col)}${rowNo}` },
              ),
            );
          }
        }
      }
      cells.set(col, value);
    }
    grid.rows.set(rowNo, cells);
  }
  return grid;
}

const hasValue = (m: Map<number, SourceValue>): boolean => [...m.values()].some((v) => v !== null);

/** Input is the raw workbook bytes. The importer reads no files and uses no Node or DOM APIs. */
export function importXlsx(bytes: Uint8Array, options: XlsxImportOptions): Result<ImportedSource> {
  const read = readWorkbook(bytes);
  if (!read.ok) return read;
  const wb = read.value;

  const wanted = options.sheets;
  if (wanted) {
    const missing = wanted.filter((n) => !wb.sheets.some((s) => s.name === n));
    if (missing.length > 0) {
      return {
        ok: false,
        issues: [diag('error', 'XLSX_SHEET_NOT_FOUND', `Sheet not found: ${missing.join(', ')}.`)],
      };
    }
  }
  const selected = wb.sheets.filter((s) => (wanted ? wanted.includes(s.name) : !s.hidden));
  if (selected.length === 0) {
    return {
      ok: false,
      issues: [diag('error', 'XLSX_NO_SHEETS', 'The workbook has no sheets to import.')],
    };
  }

  const shared = readSharedStrings(wb.files);
  const isDate = readDateStyles(wb.files);
  const ids = assignDatasetIds(selected.map((s) => s.name));
  const diagnostics: Diagnostic[] = [];
  const datasets = [];

  for (const [i, sheet] of selected.entries()) {
    const datasetId = ids[i]!;
    const grid = readSheet(wb, sheet.path, shared, isDate);
    const tag = (d: Diagnostic): Diagnostic => ({ ...d, datasetId: datasetId as never });
    diagnostics.push(...grid.diagnostics.map(tag));

    const rowNumbers = [...grid.rows.keys()].sort((a, b) => a - b);
    const headerNo = options.headerRow ?? rowNumbers.find((n) => hasValue(grid.rows.get(n)!));
    const headerCells = headerNo === undefined ? undefined : grid.rows.get(headerNo);
    if (headerNo === undefined || !headerCells || !hasValue(headerCells)) {
      diagnostics.push(
        tag(
          diag(
            'warning',
            'XLSX_SHEET_EMPTY',
            `Sheet "${sheet.name}" has no header row and was skipped.`,
          ),
        ),
      );
      continue;
    }
    const lastCol = Math.max(
      ...[...headerCells.entries()].filter(([, v]) => v !== null).map(([c]) => c),
    );
    const width = lastCol + 1;
    const rawHeader = Array.from({ length: width }, (_, c) => headerCells.get(c) ?? null);
    const norm = normalizeHeaders(rawHeader, 'XLSX', datasetId);
    diagnostics.push(...norm.diagnostics);

    const data: { cells: SourceValue[] }[] = [];
    let outside = 0;
    let firstOutside = '';
    for (const n of rowNumbers) {
      if (n <= headerNo) continue;
      const cells = grid.rows.get(n)!;
      if (!hasValue(cells)) continue;
      const row = Array.from({ length: width }, (_, c) => cells.get(c) ?? null);
      for (const [c, v] of cells) {
        if (c >= width && v !== null) {
          outside++;
          if (!firstOutside) firstOutside = `${colName(c)}${n}`;
        }
      }
      data.push({ cells: row });
    }
    if (outside > 0) {
      diagnostics.push(
        tag(
          diag(
            'warning',
            'XLSX_CELL_OUTSIDE_HEADER',
            `${outside} value(s) sit to the right of the last header and were not imported. First: ${firstOutside}.`,
          ),
        ),
      );
    }
    for (const c of [...grid.dateColumns].sort((a, b) => a - b)) {
      if (c < width) {
        diagnostics.push(
          tag(
            diag(
              'info',
              'XLSX_DATE_CELLS_CONVERTED',
              `Column "${norm.headers[c]}" contains Excel date cells. They were converted to ISO 8601 text; the original serial numbers are not kept.`,
            ),
          ),
        );
      }
    }
    datasets.push({
      id: datasetId,
      name: sheet.name,
      headers: norm.headers,
      rows: data.map((d) => d.cells),
    });
  }

  if (datasets.length === 0) {
    return {
      ok: false,
      issues: diagnostics.length
        ? diagnostics
        : [diag('error', 'XLSX_NO_SHEETS', 'No sheet could be imported.')],
    };
  }
  const built = buildSource({
    fileName: options.fileName,
    sourceType: 'xlsx',
    location: options.location ?? { kind: 'localFile', path: options.fileName },
    datasets,
  });
  return { ok: true, value: { source: built.source, rows: built.rows, diagnostics } };
}
