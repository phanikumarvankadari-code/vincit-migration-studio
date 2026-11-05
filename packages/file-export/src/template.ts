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
