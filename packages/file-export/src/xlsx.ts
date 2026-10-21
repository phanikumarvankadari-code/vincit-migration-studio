import { strToU8, zipSync } from 'fflate';
import type { Diagnostic, Result, SourceValue } from '@mms/mapping-core';

export interface XlsxSheet {
  name: string;
  header: readonly string[];
  rows: readonly (readonly SourceValue[])[];
}

export interface XlsxOutput {
  bytes: Uint8Array;
  /** Sheet names after cleaning (Excel limits them), in order. */
  sheetNames: string[];
  /** Notes about anything that had to be changed to fit the format. */
  notes: string[];
}

const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;

const colName = (i: number): string => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Characters that are not allowed in XML 1.0 text.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function esc(text: string, notes: Set<string>): string {
  let t = text;
  if (INVALID_XML.test(t)) {
    notes.add('Control characters that XLSX cannot store were replaced with U+FFFD.');
    t = t.replace(INVALID_XML, '�');
  }
  INVALID_XML.lastIndex = 0;
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Excel sheet names: at most 31 characters, none of []:*?/\, not empty, unique ignoring case. */
export function sheetName(raw: string, used: ReadonlySet<string>): string {
  let name =
    raw
      .replace(/[[\]:*?/\\]/g, '_')
      .trim()
      .replace(/^'+|'+$/g, '')
      .slice(0, 31) || 'Sheet';
  const lower = (s: string): string => s.toLowerCase();
  const taken = new Set([...used].map(lower));
  for (let n = 2; taken.has(lower(name)); n++) {
    const suffix = ` (${n})`;
    name = name.slice(0, 31 - suffix.length) + suffix;
  }
  return name;
}

function cell(ref: string, value: SourceValue, style: number, notes: Set<string>): string {
  if (value === null) return '';
  const s = style > 0 ? ` s="${style}"` : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value, notes)}</t></is></c>`;
}

/**
 * Writes an XLSX workbook with one sheet per table. Every value is stored as text, so leading zeros, dates and
 * long numbers are never changed by Excel. A blank (null) is an empty cell; an empty string is an empty text cell.
 * The first row is the header (bold).
 */
export function toXlsx(sheets: readonly XlsxSheet[]): Result<XlsxOutput> {
  const issues: Diagnostic[] = [];
  if (sheets.length === 0)
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          code: 'XLSX_NO_SHEETS',
          message: 'A workbook needs at least one sheet.',
        },
      ],
    };
  for (const s of sheets) {
    if (s.rows.length + 1 > MAX_ROWS)
      issues.push({
        severity: 'error',
        code: 'XLSX_TOO_MANY_ROWS',
        message: `Sheet "${s.name}" has ${s.rows.length.toLocaleString('en-US')} rows but a worksheet holds at most ${(MAX_ROWS - 1).toLocaleString('en-US')}. Use CSV for this table.`,
      });
    if (s.header.length > MAX_COLS)
      issues.push({
        severity: 'error',
        code: 'XLSX_TOO_MANY_COLUMNS',
        message: `Sheet "${s.name}" has ${s.header.length} columns but a worksheet holds at most ${MAX_COLS}.`,
      });
  }
  if (issues.length > 0) return { ok: false, issues };

  const notes = new Set<string>();
  const names: string[] = [];
  for (const s of sheets) {
    const n = sheetName(s.name, new Set(names));
    if (n !== s.name) notes.add(`Sheet name "${s.name}" was changed to "${n}".`);
    names.push(n);
  }

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${esc(n, notes)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join(
          '',
        )}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>',
    ),
  };

  sheets.forEach((s, i) => {
    const rows: string[] = [];
    rows.push(
      `<row r="1">${s.header.map((h, c) => cell(`${colName(c)}1`, h, 1, notes)).join('')}</row>`,
    );
    s.rows.forEach((r, n) => {
      rows.push(
        `<row r="${n + 2}">${r.map((v, c) => cell(`${colName(c)}${n + 2}`, v, 0, notes)).join('')}</row>`,
      );
    });
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`,
    );
  });
  return { ok: true, value: { bytes: zipSync(files), sheetNames: names, notes: [...notes] } };
}
