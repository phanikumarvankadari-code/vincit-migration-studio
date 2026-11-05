import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Result } from '@mms/mapping-core';
import {
  importSpreadsheetXml,
  importWorkbook,
  listWorkbookSheets,
  repairSpreadsheetXml,
  spreadsheetXmlText,
} from '../src/index.js';

const bytes = new Uint8Array(
  readFileSync(
    new URL('../../../test-data/fixed-asset/target/fixed_asset_template.xml', import.meta.url),
  ),
);
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

describe('Excel 2003 XML workbook (SAP migration template)', () => {
  it('is recognised by content, and a zip is not', () => {
    expect(spreadsheetXmlText(bytes)).toContain('<Workbook');
    expect(spreadsheetXmlText(new Uint8Array([0x50, 0x4b, 3, 4]))).toBeUndefined();
    expect(spreadsheetXmlText(new TextEncoder().encode('a,b\n1,2'))).toBeUndefined();
  });

  it('repairs SAP pseudo tags and a bare ampersand', () => {
    expect(repairSpreadsheetXml('<D>a <LS>File </>-> x & y &amp; z</D>')).toBe(
      '<D>a File -> x &amp; y &amp; z</D>',
    );
  });

  it('lists the 13 sheets', () => {
    const names = ok(listWorkbookSheets(bytes)).map((s) => s.name);
    expect(names).toHaveLength(13);
    expect(names.slice(0, 4)).toEqual(['Introduction', 'Field List', 'General', 'Origin']);
  });

  it('reads the Field List like an XLSX sheet: header row 4, structures as section rows', () => {
    const src = ok(
      importSpreadsheetXml(bytes, { fileName: 'f.xml', sheets: ['Field List'], headerRow: 4 }),
    );
    const ds = src.source.datasets[0]!;
    expect(ds.fields.map((f) => f.displayName).slice(1, 7)).toEqual([
      'Sheet Name',
      'Group Name',
      'Field Description',
      'Importance',
      'Type',
      'Length',
    ]);
    const rows = src.rows[0]!.rows;
    expect(rows[0]![1]).toBe('General (mandatory)');
    expect(rows[1]!.slice(2, 5)).toEqual(['Key', 'Ext./Leg. Company Code', 'mandatory for sheet']);
  });

  it('reads the technical names of a data sheet from row 5, including the cell after the bare ampersand', () => {
    const src = ok(importWorkbook(bytes, { fileName: 'f.xml', sheets: ['General'], headerRow: 5 }));
    expect(src.source.datasets[0]!.fields.slice(0, 4).map((f) => f.displayName)).toEqual([
      'BUKRS',
      'ANLN1',
      'ANLN2',
      'ANLKL',
    ]);
    const fl = ok(
      importWorkbook(bytes, { fileName: 'f.xml', sheets: ['Field List'], headerRow: 4 }),
    );
    expect(fl.rows[0]!.rows.some((r) => r.includes('Indicator: R & D Asset'))).toBe(true);
  });
});
