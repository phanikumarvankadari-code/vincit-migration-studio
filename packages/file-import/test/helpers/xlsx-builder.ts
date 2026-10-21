import { strToU8, zipSync } from 'fflate';

export type CellSpec =
  | string
  | number
  | null
  | { date: number }
  | { bool: boolean }
  | { err: string }
  | { inline: string }
  | { rich: string[] };

export interface SheetSpec {
  name: string;
  hidden?: boolean;
  /** Rows of cells. null leaves a gap, so column positions stay put. */
  rows: CellSpec[][];
  /** 1-based worksheet row number of the first row. Default 1. */
  startRow?: number;
}

const colName = (i: number): string => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Builds a minimal but valid XLSX in memory. */
export function makeXlsx(sheets: SheetSpec[], opts: { date1904?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const sst = (s: string): number => {
    const i = shared.indexOf(s);
    if (i >= 0) return i;
    shared.push(s);
    return shared.length - 1;
  };
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows
      .map((cells, r) => {
        const rowNo = (sh.startRow ?? 1) + r;
        const cs = cells
          .map((c, i) => {
            if (c === null) return '';
            const ref = `${colName(i)}${rowNo}`;
            if (typeof c === 'string') return `<c r="${ref}" t="s"><v>${sst(c)}</v></c>`;
            if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
            if ('date' in c) return `<c r="${ref}" s="1"><v>${c.date}</v></c>`;
            if ('bool' in c) return `<c r="${ref}" t="b"><v>${c.bool ? 1 : 0}</v></c>`;
            if ('err' in c) return `<c r="${ref}" t="e"><v>${esc(c.err)}</v></c>`;
            if ('inline' in c)
              return `<c r="${ref}" t="inlineStr"><is><t>${esc(c.inline)}</t></is></c>`;
            const i2 = sst(c.rich.join(''));
            shared[i2] = c.rich.join('');
            return `<c r="${ref}" t="s"><v>${i2}</v></c>`;
          })
          .join('');
        return `<row r="${rowNo}">${cs}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${opts.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`,
        )
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared
        .map(
          (s) =>
            `<si><r><t xml:space="preserve">${esc(s.slice(0, 1))}</t></r><r><t xml:space="preserve">${esc(s.slice(1))}</t></r></si>`,
        )
        .join('')}</sst>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    ),
  };
  sheetXml.forEach((x, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x)));
  return zipSync(files);
}
