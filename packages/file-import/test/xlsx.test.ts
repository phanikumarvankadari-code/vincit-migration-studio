import { describe, expect, it } from 'vitest';
import type { Result } from '@mms/mapping-core';
import { excelSerialToIso, importXlsx, listXlsxSheets, type ImportedSource } from '../src/index.js';
import { makeXlsx } from './helpers/xlsx-builder.js';
import { readTargetBytes } from './helpers/fixtures.js';

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const imp = (bytes: Uint8Array, extra = {}): ImportedSource =>
  ok(importXlsx(bytes, { fileName: 'Book.xlsx', ...extra }));

describe('XLSX import (SPEC-003)', () => {
  const book = () =>
    makeXlsx([
      {
        name: 'Alpha',
        rows: [
          ['id', 'name'],
          ['001', 'A'],
          ['002', 'B'],
        ],
      },
      { name: 'Beta Sheet', rows: [['x'], ['1']] },
      { name: 'Secret', hidden: true, rows: [['h'], ['v']] },
    ]);

  it('workbook sheets are discoverable, including hidden ones', () => {
    expect(ok(listXlsxSheets(book()))).toEqual([
      { name: 'Alpha', hidden: false },
      { name: 'Beta Sheet', hidden: false },
      { name: 'Secret', hidden: true },
    ]);
  });

  it('multiple sheets become independent datasets (visible sheets by default)', () => {
    const r = imp(book());
    expect(r.source.sourceType).toBe('xlsx');
    expect(r.source.datasets.map((d) => d.name)).toEqual(['Alpha', 'Beta Sheet']);
    expect(r.source.datasets.map((d) => d.id)).toEqual(['ds-Alpha', 'ds-Beta-Sheet']);
    expect(r.rows.map((x) => x.rows.length)).toEqual([2, 1]);
  });

  it('sheet selection limits the import and can pick a hidden sheet', () => {
    expect(imp(book(), { sheets: ['Beta Sheet'] }).source.datasets.map((d) => d.name)).toEqual([
      'Beta Sheet',
    ]);
    expect(imp(book(), { sheets: ['Secret'] }).source.datasets.map((d) => d.name)).toEqual([
      'Secret',
    ]);
  });

  it('headers are preserved as display names', () => {
    expect(imp(book()).source.datasets[0]!.fields.map((f) => f.displayName)).toEqual([
      'id',
      'name',
    ]);
  });

  it('empty cells do not shift columns', () => {
    const r = imp(
      makeXlsx([
        {
          name: 'S',
          rows: [
            ['a', 'b', 'c', 'd'],
            ['1', null, null, '4'],
            [null, '2', null, null],
          ],
        },
      ]),
    );
    expect(r.rows[0]!.rows).toEqual([
      ['1', null, null, '4'],
      [null, '2', null, null],
    ]);
  });

  it('text values and leading zeros are preserved', () => {
    expect(imp(makeXlsx([{ name: 'S', rows: [['postal'], ['00330']] }])).rows[0]!.rows).toEqual([
      ['00330'],
    ]);
  });

  it('numeric cells keep their stored text; booleans become TRUE/FALSE; inline and rich strings work', () => {
    const r = imp(
      makeXlsx([
        {
          name: 'S',
          rows: [
            ['n', 'b', 'i', 'r'],
            [12.5, { bool: true }, { inline: 'inl' }, { rich: ['ab', 'cd'] }],
          ],
        },
      ]),
    );
    expect(r.rows[0]!.rows).toEqual([['12.5', 'TRUE', 'inl', 'abcd']]);
  });

  it('date cells are converted to ISO text with an info diagnostic, not silently', () => {
    const r = imp(
      makeXlsx([{ name: 'S', rows: [['when'], [{ date: 46023 }], [{ date: 46023.5 }]] }]),
    );
    expect(r.rows[0]!.rows).toEqual([['2026-01-01'], ['2026-01-01T12:00:00']]);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'info',
      code: 'XLSX_DATE_CELLS_CONVERTED',
      datasetId: 'ds-S',
    });
    expect(r.diagnostics[0]!.message).toContain('"when"');
  });

  it('serial dates: 1900 and 1904 systems, and the non-existent 1900-02-29', () => {
    expect(excelSerialToIso(1, false)).toBe('1900-01-01');
    expect(excelSerialToIso(59, false)).toBe('1900-02-28');
    expect(excelSerialToIso(60, false)).toBeUndefined();
    expect(excelSerialToIso(61, false)).toBe('1900-03-01');
    expect(excelSerialToIso(45292, false)).toBe('2024-01-01');
    expect(excelSerialToIso(0, true)).toBe('1904-01-01');
    const r = imp(makeXlsx([{ name: 'S', rows: [['d'], [{ date: 60 }]] }]));
    expect(r.rows[0]!.rows).toEqual([['60']]);
    expect(r.diagnostics[0]!.code).toBe('XLSX_DATE_NOT_CONVERTED');
    expect(
      imp(makeXlsx([{ name: 'S', rows: [['d'], [{ date: 0 }]] }], { date1904: true })).rows[0]!
        .rows,
    ).toEqual([['1904-01-01']]);
  });

  it('error cells are imported as text with a warning', () => {
    const r = imp(makeXlsx([{ name: 'S', rows: [['a'], [{ err: '#DIV/0!' }]] }]));
    expect(r.rows[0]!.rows).toEqual([['#DIV/0!']]);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XLSX_CELL_ERROR',
      technicalDetails: 'A2',
    });
  });

  it('a header row can be chosen; rows above it are ignored', () => {
    const r = imp(makeXlsx([{ name: 'S', rows: [['Title'], [null], ['k', 'v'], ['1', '2']] }]), {
      headerRow: 3,
    });
    expect(r.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual(['k', 'v']);
    expect(r.rows[0]!.rows).toEqual([['1', '2']]);
  });

  it('by default the first non-empty row is the header and fully empty rows are skipped', () => {
    const r = imp(makeXlsx([{ name: 'S', startRow: 3, rows: [['k', 'v'], [null], ['1', '2']] }]));
    expect(r.rows[0]!.rows).toEqual([['1', '2']]);
  });

  it('values right of the last header are reported, not dropped silently', () => {
    const r = imp(makeXlsx([{ name: 'S', rows: [['a'], ['1', 'stray']] }]));
    expect(r.rows[0]!.rows).toEqual([['1']]);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'XLSX_CELL_OUTSIDE_HEADER',
    });
    expect(r.diagnostics[0]!.message).toContain('B2');
  });

  it('blank headers are named and reported', () => {
    const r = imp(
      makeXlsx([
        {
          name: 'S',
          rows: [
            ['a', null, 'c'],
            ['1', '2', '3'],
          ],
        },
      ]),
    );
    expect(r.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual(['a', 'Column 2', 'c']);
    expect(r.diagnostics[0]!.code).toBe('XLSX_BLANK_HEADER');
  });

  it('sheet names that make the same ID get unique IDs', () => {
    const r = imp(
      makeXlsx([
        { name: 'A B', rows: [['x']] },
        { name: 'A-B', rows: [['x']] },
      ]),
    );
    expect(r.source.datasets.map((d) => d.id)).toEqual(['ds-A-B', 'ds-A-B-2']);
  });
});

describe('XLSX failures return diagnostics', () => {
  it('not a zip', () => {
    const r = importXlsx(new Uint8Array([1, 2, 3]), { fileName: 'x.xlsx' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe('XLSX_INVALID_FILE');
    expect(listXlsxSheets(new Uint8Array()).ok).toBe(false);
  });

  it('unknown sheet name', () => {
    const r = importXlsx(makeXlsx([{ name: 'A', rows: [['x']] }]), {
      fileName: 'x.xlsx',
      sheets: ['Nope'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ code: 'XLSX_SHEET_NOT_FOUND' });
  });

  it('an empty sheet is skipped with a warning; all sheets empty is an error', () => {
    const mixed = imp(
      makeXlsx([
        { name: 'Empty', rows: [] },
        { name: 'Data', rows: [['x'], ['1']] },
      ]),
    );
    expect(mixed.source.datasets.map((d) => d.name)).toEqual(['Data']);
    expect(mixed.diagnostics[0]!.code).toBe('XLSX_SHEET_EMPTY');
    expect(importXlsx(makeXlsx([{ name: 'Empty', rows: [] }]), { fileName: 'x.xlsx' }).ok).toBe(
      false,
    );
  });
});

describe('real workbook: target sample', () => {
  it('lists its sheet and imports it with the header on row 4', () => {
    const bytes = readTargetBytes('data_pc.XLSX');
    expect(ok(listXlsxSheets(bytes)).map((s) => s.name)).toEqual(['Field Mapping']);
    const r = imp(bytes, { headerRow: 4 });
    const fields = r.source.datasets[0]!.fields.map((f) => f.displayName);
    // Column A of this workbook has no header, so it is named and reported.
    expect(fields.slice(0, 6)).toEqual([
      'Column 1',
      'Sheet Name',
      'Group Name',
      'Field Description',
      'Importance',
      'Type',
    ]);
    expect(r.diagnostics.some((d) => d.code === 'XLSX_BLANK_HEADER')).toBe(true);
    expect(r.rows[0]!.rows.length).toBeGreaterThan(20);
    expect(r.rows[0]!.rows.every((row) => row.length === fields.length)).toBe(true);
  });
});
