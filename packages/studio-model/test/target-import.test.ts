import { describe, expect, it } from 'vitest';
import { autoImportTarget, previewTarget, readTargetTable } from '../src/index.js';
import { ok, targetFile } from './helpers.js';

describe('target import wizard model', () => {
  it('finds the header row and layout of the reference workbook by itself', () => {
    const p = ok(autoImportTarget(targetFile(), 'Profit Center'));
    expect(p.headerRow).toBe(4);
    expect(p.layout.columns).toMatchObject({
      structure: 'Sheet Name',
      displayName: 'Field Description',
      technicalField: 'SAP Field',
    });
    expect(p.target.structures.map((s) => [s.name, s.fields.length])).toEqual([
      ['Profit Center', 31],
      ['Company Codes', 3],
      ['Translation', 5],
    ]);
    expect(p.diagnostics.map((d) => d.code)).toEqual(['XLSX_BLANK_HEADER']); // column A of the workbook has no header
  });

  it('previews with a chosen header row and layout', () => {
    const auto = ok(autoImportTarget(targetFile(), 'Profit Center'));
    const same = ok(previewTarget(targetFile(), 4, auto.layout, 'Profit Center'));
    expect(same.target).toEqual(auto.target);
    const wrong = previewTarget(targetFile(), 1, auto.layout, 'Profit Center');
    expect(wrong.ok).toBe(false);
  });

  it('a changed layout changes the result (the user can correct detection)', () => {
    const auto = ok(autoImportTarget(targetFile(), 'Profit Center'));
    const noKeys = ok(
      previewTarget(targetFile(), 4, { ...auto.layout, keyGroups: ['nothing'] }, 'Profit Center'),
    );
    expect(noKeys.target.structures[0]!.fields.filter((f) => f.isKey)).toEqual([]);
    expect(auto.target.structures[0]!.fields.filter((f) => f.isKey)).toHaveLength(2);
  });

  it('reads a CSV structure definition', () => {
    const csv =
      'Structure,Field,Type,Length,Importance,Key\nHeader,Id,Text,10,mandatory,X\nHeader,Name,Text,20,,\nLines,Qty,Number,,,\n';
    const p = ok(autoImportTarget({ name: 'target.csv', content: csv }, 'Doc'));
    expect(p.headerRow).toBe(1);
    expect(p.layout.mode).toBe('column');
    expect(p.target.structures.map((s) => [s.name, s.fields.map((f) => f.displayName)])).toEqual([
      ['Header', ['Id', 'Name']],
      ['Lines', ['Qty']],
    ]);
    expect(p.target.structures[0]!.fields[0]).toMatchObject({
      required: true,
      isKey: true,
      length: 10,
    });
  });

  it('says why a file is not recognised', () => {
    const r = autoImportTarget({ name: 'x.csv', content: 'A,B\n1,2\n' }, 'X');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe('TARGET_NOT_RECOGNISED');
    expect(autoImportTarget({ name: 'x.xlsx', content: new Uint8Array([1, 2, 3]) }, 'X').ok).toBe(
      false,
    );
    expect(readTargetTable({ name: 'x.xlsx', content: new Uint8Array([1]) }, 1).ok).toBe(false);
  });
});
