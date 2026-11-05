import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Diagnostic, Result, SourceValue } from '@mms/mapping-core';

/** The rows of one structure to write into its sheet of a template workbook. */
export interface TemplateSheet {
  /** Name of the sheet in the template. */
  sheet: string;
  /** For each value of a row, the technical field name that is written in the template's technical-name row. */
  keys: readonly (string | null)[];
  rows: readonly (readonly SourceValue[])[];
}

export interface TemplateOptions {
  /** Row holding the technical field names. SAP migration templates use 5. */
  technicalNameRow?: number;
  /** First row for data. Everything from here down is replaced. SAP migration templates use 9. */
  firstDataRow?: number;
}

export interface TemplateOutput {
  bytes: Uint8Array;
  /** Things that could not be written as asked (for example a field with no column). */
  notes: string[];
}

const err = (code: string, message: string): Result<never> => ({
  ok: false,
  issues: [{ severity: 'error', code, message } satisfies Diagnostic],
});

const colName = (i: number): string => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (letters: string): number =>
  [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const unesc = (t: string): string =>
  t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (t: string): string =>
  t.replace(INVALID_XML, '�').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const f = files['xl/sharedStrings.xml'];
  if (!f) return [];
  return [...strFromU8(f).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1]!)).join(''),
  );
}

/** Path of the worksheet part of the named sheet, or undefined. */
function sheetPath(files: Record<string, Uint8Array>, name: string): string | undefined {
  const wb = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (!wb || !rels) return undefined;
  const tag = [...strFromU8(wb).matchAll(/<sheet\s[^>]*>/g)]
    .map((m) => m[0])
    .find((t) => unesc(attr(t, 'name') ?? '') === name);
  const rid = tag ? attr(tag, 'r:id') : undefined;
  if (!rid) return undefined;
  const rel = [...strFromU8(rels).matchAll(/<Relationship\s[^>]*>/g)]
    .map((m) => m[0])
    .find((t) => attr(t, 'Id') === rid);
  const target = rel ? attr(rel, 'Target') : undefined;
  if (!target) return undefined;
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/** Column index by technical name, read from the technical-name row of a sheet. */
function technicalColumns(xml: string, row: number, strings: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const m = new RegExp(`<row\\s[^>]*\\br="${row}"[^>]*>([\\s\\S]*?)</row>`).exec(xml);
  if (!m) return out;
  for (const c of m[1]!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = attr(c[1]!, 'r');
    const body = c[2] ?? '';
    const type = attr(c[1]!, 't');
    const col = ref ? /^([A-Z]+)/.exec(ref)?.[1] : undefined;
    if (!col) continue;
    let text: string | undefined;
    if (type === 's') {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      text = v === undefined ? undefined : strings[Number(v)];
    } else if (type === 'inlineStr') {
      text = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((t) => unesc(t[1]!))
        .join('');
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      text = v === undefined ? undefined : unesc(v);
    }
    const name = text?.trim();
    if (name && !out.has(name)) out.set(name, colIndex(col));
  }
  return out;
}

/**
 * Writes rows into the sheets of a template workbook and leaves everything else as it is: other sheets, the rows
 * above the first data row, styles, column widths, protection. Values are stored as text, so leading zeros and dates
 * are never changed by Excel. A column is found by the technical field name in the technical-name row.
 */
export function fillTemplate(
  template: Uint8Array,
  sheets: readonly TemplateSheet[],
  options: TemplateOptions = {},
): Result<TemplateOutput> {
  const techRow = options.technicalNameRow ?? 5;
  const first = options.firstDataRow ?? 9;
  if (!(template.length >= 2 && template[0] === 0x50 && template[1] === 0x4b))
    return fillXmlTemplate(template, sheets, techRow, first);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(template);
  } catch {
    return err('TEMPLATE_INVALID_FILE', 'The template is not a valid XLSX workbook.');
  }
  const strings = sharedStrings(files);
  const notes: string[] = [];
  const out: Record<string, Uint8Array> = { ...files };

  for (const s of sheets) {
    const path = sheetPath(files, s.sheet);
    const part = path ? files[path] : undefined;
    if (!path || !part)
      return err('TEMPLATE_SHEET_NOT_FOUND', `The template has no sheet named "${s.sheet}".`);
    let xml = strFromU8(part);
    const columns = technicalColumns(xml, techRow, strings);
    if (columns.size === 0)
      return err(
        'TEMPLATE_NO_TECHNICAL_NAMES',
        `Sheet "${s.sheet}" has no technical field names in row ${techRow}.`,
      );
    const colOf = s.keys.map((k) => (k === null ? undefined : columns.get(k)));
    s.keys.forEach((k, i) => {
      if (k === null || colOf[i] === undefined)
        notes.push(
          `Sheet "${s.sheet}": the field ${k === null ? `in position ${i + 1}` : `"${k}"`} has no column in the template, so its values were not written.`,
        );
    });

    // Drop any rows from the first data row down, then add the new ones.
    xml = xml.replace(/<row\s[^>]*>[\s\S]*?<\/row>|<row\s[^>]*\/>/g, (row) => {
      const r = Number(attr(/^<row\s[^>]*>/.exec(row)![0], 'r') ?? 0);
      return r >= first ? '' : row;
    });
    let lastRow = 0;
    for (const m of xml.matchAll(/<row\s[^>]*\br="(\d+)"/g))
      lastRow = Math.max(lastRow, Number(m[1]));
    let maxCol = -1;
    const rowsXml = s.rows
      .map((row, i) => {
        const r = first + i;
        const cells = row
          .map((v, k) => {
            const c = colOf[k];
            if (c === undefined || v === null) return '';
            maxCol = Math.max(maxCol, c);
            return `<c r="${colName(c)}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
          })
          .filter(Boolean)
          .sort(
            (a, b) => colIndex(/r="([A-Z]+)/.exec(a)![1]!) - colIndex(/r="([A-Z]+)/.exec(b)![1]!),
          )
          .join('');
        return `<row r="${r}">${cells}</row>`;
      })
      .join('');
    lastRow = Math.max(lastRow, first + s.rows.length - 1);
    if (!xml.includes('</sheetData>'))
      xml = xml.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>');
    xml = xml.replace('</sheetData>', `${rowsXml}</sheetData>`);
    xml = xml.replace(/<dimension\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/>/, (_m, a, b, c) => {
      const end = colName(Math.max(colIndex(c as string), maxCol));
      return `<dimension ref="${a}${b}:${end}${lastRow}"/>`;
    });
    out[path] = strToU8(xml);
  }
  return { ok: true, value: { bytes: zipSync(out), notes } };
}

// ---- Excel 2003 XML (SpreadsheetML), the format of SAP migration cockpit downloads -----------------------------
// The file is changed as text, so everything we do not touch (including SAP's own markup) stays as it was.

const xmlText = (t: string): string => esc(t).replace(/\r?\n/g, '&#10;');

/** Start, end and tag text of each element of a kind, in order. Elements of the same kind do not nest here. */
function elements(
  xml: string,
  tag: string,
  from = 0,
  to = xml.length,
): { start: number; end: number; open: string; inner: string }[] {
  const out: { start: number; end: number; open: string; inner: string }[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  re.lastIndex = from;
  for (let m = re.exec(xml); m && m.index < to; m = re.exec(xml))
    out.push({ start: m.index, end: m.index + m[0].length, open: m[1] ?? '', inner: m[2] ?? '' });
  return out;
}

function fillXmlTemplate(
  template: Uint8Array,
  sheets: readonly TemplateSheet[],
  techRow: number,
  first: number,
): Result<TemplateOutput> {
  let xml = strFromU8(template);
  if (!xml.includes('urn:schemas-microsoft-com:office:spreadsheet'))
    return err(
      'TEMPLATE_INVALID_FILE',
      'The template is neither an XLSX nor an Excel XML workbook.',
    );
  const notes: string[] = [];

  for (const s of sheets) {
    const sheet = elements(xml, 'Worksheet').find(
      (w) => unesc(attr(w.open, 'ss:Name') ?? '') === s.sheet,
    );
    if (!sheet)
      return err('TEMPLATE_SHEET_NOT_FOUND', `The template has no sheet named "${s.sheet}".`);
    const table = elements(xml, 'Table', sheet.start, sheet.end)[0];
    const tableOpen = /<Table\b[^>]*>/.exec(xml.slice(sheet.start, sheet.end));
    if (!table || !tableOpen)
      return err('TEMPLATE_SHEET_NOT_FOUND', `Sheet "${s.sheet}" has no table.`);
    const bodyStart = sheet.start + tableOpen.index + tableOpen[0].length;
    const bodyEnd = table.end - '</Table>'.length;
    const body = xml.slice(bodyStart, bodyEnd);

    // Column styles, so new cells look like the template's own columns.
    const styles: (string | undefined)[] = [];
    for (const c of elements(body, 'Column')) {
      const at = attr(c.open, 'ss:Index');
      if (at !== undefined) styles.length = Number(at) - 1;
      const span = Number(attr(c.open, 'ss:Span') ?? 0) + 1;
      for (let i = 0; i < span; i++) styles.push(attr(c.open, 'ss:StyleID'));
    }

    // Rows: find the technical names, and cut everything from the first data row down.
    const rows = elements(body, 'Row');
    let no = 0;
    const columns = new Map<string, number>();
    let cut = body.length;
    for (const r of rows) {
      const at = attr(r.open, 'ss:Index');
      no = at !== undefined ? Number(at) : no + 1;
      if (no >= first) {
        cut = Math.min(cut, r.start);
        continue;
      }
      if (no !== techRow) continue;
      let col = 0;
      for (const c of elements(r.inner, 'Cell')) {
        const ci = attr(c.open, 'ss:Index');
        if (ci !== undefined) col = Number(ci) - 1;
        const data = /<Data\b[^>]*>([\s\S]*?)<\/Data>/.exec(c.inner)?.[1];
        const name = data === undefined ? '' : unesc(data.replace(/<[^>]*>/g, '')).trim();
        if (name && !columns.has(name)) columns.set(name, col);
        col += 1 + Number(attr(c.open, 'ss:MergeAcross') ?? 0);
      }
    }
    if (columns.size === 0)
      return err(
        'TEMPLATE_NO_TECHNICAL_NAMES',
        `Sheet "${s.sheet}" has no technical field names in row ${techRow}.`,
      );
    const colOf = s.keys.map((k) => (k === null ? undefined : columns.get(k)));
    s.keys.forEach((k, i) => {
      if (k === null || colOf[i] === undefined)
        notes.push(
          `Sheet "${s.sheet}": the field ${k === null ? `in position ${i + 1}` : `"${k}"`} has no column in the template, so its values were not written.`,
        );
    });

    const newRows = s.rows
      .map((row) => {
        const cells = row
          .map((v, k) => ({ v, c: colOf[k] }))
          .filter((x): x is { v: string; c: number } => x.c !== undefined && x.v !== null)
          .sort((a, b) => a.c - b.c)
          .map(({ v, c }) => {
            const style = styles[c];
            return `<Cell${style ? ` ss:StyleID="${style}"` : ''} ss:Index="${c + 1}"><Data ss:Type="String">${xmlText(v)}</Data></Cell>`;
          })
          .join('');
        return `<Row ss:AutoFitHeight="0">${cells}</Row>\n`;
      })
      .join('');

    let open = tableOpen[0];
    const lastRow = first + s.rows.length - 1;
    const count = /ss:ExpandedRowCount="(\d+)"/.exec(open);
    if (count)
      open = open.replace(count[0], `ss:ExpandedRowCount="${Math.max(first - 1, lastRow)}"`);
    const rebuilt = open + body.slice(0, cut) + (newRows ? '\n' : '') + newRows;
    xml = xml.slice(0, sheet.start + tableOpen.index) + rebuilt + xml.slice(bodyEnd);
  }
  return { ok: true, value: { bytes: strToU8(xml), notes } };
}
