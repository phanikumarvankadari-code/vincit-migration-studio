import { XMLParser } from 'fast-xml-parser';
import { strFromU8 } from 'fflate';
import type { Result, SourceValue } from '@mms/mapping-core';
import { diag, type ImportedSource } from './common.js';
import {
  importGrids,
  importXlsx as importXlsxBytes,
  listXlsxSheets,
  type SheetGrid,
  type SheetInfo,
  type XlsxImportOptions,
} from './xlsx.js';

/**
 * Excel 2003 XML ("XML Spreadsheet 2003", SpreadsheetML), the format SAP migration templates are downloaded in.
 * SAP's files are not always well-formed XML: rich text uses pseudo tags such as <LS>…</>, and an "&" can appear
 * unescaped. Both are repaired before reading. Excel opens these files, so they must be read too.
 */
const MARK = 'urn:schemas-microsoft-com:office:spreadsheet';

const ARRAY_TAGS = new Set(['Worksheet', 'Row', 'Cell']);
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

/** The file text, or undefined when the bytes are not an Excel 2003 XML workbook. */
export function spreadsheetXmlText(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return undefined; // a zip (XLSX)
  const text = strFromU8(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const head = text.replace(/^\uFEFF/, '').trimStart();
  if (!head.startsWith('<') || !head.includes(MARK)) return undefined;
  return strFromU8(bytes).replace(/^\uFEFF/, '');
}

/** Repairs the two things SAP writes that a strict XML reader rejects. */
export function repairSpreadsheetXml(text: string): string {
  return (
    text
      .replace(/<\/?LS\b[^>]*>/g, '')
      .replace(/<\/>/g, '')
      // The reader does not decode numeric references (&#10;), so they become the characters themselves.
      .replace(
        /&#(\d+);|&#x([0-9a-fA-F]+);/g,
        (_m, dec: string | undefined, hex: string | undefined) => {
          const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
          if (code === 38) return '&amp;';
          if (code === 60) return '&lt;';
          if (code === 62) return '&gt;';
          if (code === 34) return '&quot;';
          return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
        },
      )
      .replace(/&(?!(?:amp|lt|gt|quot|apos);)/g, '&amp;')
  );
}

function textOf(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return textOf((v as Node)['#text']);
  return String(v);
}

interface ParsedSheet {
  info: SheetInfo;
  grid: SheetGrid;
}

function readSheets(text: string): Result<ParsedSheet[]> {
  let root: Node;
  try {
    root = asNode(asNode(parser.parse(repairSpreadsheetXml(text)))['Workbook']);
  } catch (e) {
    return {
      ok: false,
      issues: [
        diag(
          'error',
          'XLSX_INVALID_FILE',
          `The file is not a valid Excel XML workbook: ${e instanceof Error ? e.message : String(e)}`,
        ),
      ],
    };
  }
  const out: ParsedSheet[] = [];
  for (const wsNode of asArray(root['Worksheet'])) {
    const ws = asNode(wsNode);
    const name = String(ws['@_ss:Name'] ?? '');
    const options = asNode(ws['WorksheetOptions']);
    const hidden = String(options['Visible'] ?? '').startsWith('Sheet');
    const grid: SheetGrid = { rows: new Map(), dateColumns: new Set(), diagnostics: [] };
    let rowNo = 0;
    for (const rowNode of asArray(asNode(ws['Table'])['Row'])) {
      const row = asNode(rowNode);
      const at = row['@_ss:Index'];
      rowNo = at !== undefined ? Number(at) : rowNo + 1;
      const cells = new Map<number, SourceValue>();
      let col = 0;
      for (const cNode of asArray(row['Cell'])) {
        const c = asNode(cNode);
        const ci = c['@_ss:Index'];
        if (ci !== undefined) col = Number(ci) - 1;
        const data = asNode(c['Data']);
        const type = String(data['@_ss:Type'] ?? 'String');
        let value: SourceValue = c['Data'] === undefined ? null : textOf(c['Data']);
        if (value !== null && type === 'DateTime') {
          const m = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z?$/.exec(value);
          if (m) {
            value = m[1]!;
            grid.dateColumns.add(col);
          }
        } else if (value !== null && type === 'Boolean')
          value = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value;
        cells.set(col, value === '' ? null : value);
        col += 1 + Number(c['@_ss:MergeAcross'] ?? 0);
      }
      grid.rows.set(rowNo, cells);
    }
    out.push({ info: { name, hidden }, grid });
  }
  if (out.length === 0)
    return {
      ok: false,
      issues: [diag('error', 'XLSX_NO_SHEETS', 'The workbook has no sheets to import.')],
    };
  return { ok: true, value: out };
}

export function listSpreadsheetXmlSheets(bytes: Uint8Array): Result<SheetInfo[]> {
  const text = spreadsheetXmlText(bytes);
  if (text === undefined)
    return {
      ok: false,
      issues: [diag('error', 'XLSX_INVALID_FILE', 'The file is not an Excel XML workbook.')],
    };
  const sheets = readSheets(text);
  return sheets.ok ? { ok: true, value: sheets.value.map((s) => s.info) } : sheets;
}

/** Imports an Excel 2003 XML workbook the way importXlsx imports an XLSX one (same options and result). */
export function importSpreadsheetXml(
  bytes: Uint8Array,
  options: XlsxImportOptions,
): Result<ImportedSource> {
  const text = spreadsheetXmlText(bytes);
  if (text === undefined)
    return {
      ok: false,
      issues: [diag('error', 'XLSX_INVALID_FILE', 'The file is not an Excel XML workbook.')],
    };
  const sheets = readSheets(text);
  if (!sheets.ok) return sheets;
  const byName = new Map(sheets.value.map((s) => [s.info.name, s.grid]));
  return importGrids(
    sheets.value.map((s) => s.info),
    (sheet) => byName.get(sheet.name)!,
    options,
  );
}

/** Imports a workbook in either format: XLSX (zip) or Excel 2003 XML. */
export function importWorkbook(
  bytes: Uint8Array,
  options: XlsxImportOptions,
): Result<ImportedSource> {
  return spreadsheetXmlText(bytes) !== undefined
    ? importSpreadsheetXml(bytes, options)
    : importXlsxBytes(bytes, options);
}

/** The sheets of a workbook in either format. */
export function listWorkbookSheets(bytes: Uint8Array): Result<SheetInfo[]> {
  return spreadsheetXmlText(bytes) !== undefined
    ? listSpreadsheetXmlSheets(bytes)
    : listXlsxSheets(bytes);
}
