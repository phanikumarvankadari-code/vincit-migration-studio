import { describe, expect, it } from 'vitest';
import { autoImportTarget, previewTarget, readTargetTable } from '../src/index.js';
import { fromBase64 } from '@mms/mapping-core';
import { ok, targetFile, templateFile } from './helpers.js';

describe('target template workbook (Field List + one data sheet per structure)', () => {
  it('takes the structures from Field List, ignores Introduction, and connects each structure to its data sheet', () => {
    const p = ok(autoImportTarget(templateFile(), 'Profit Center'));
    expect(p.target.structures.map((s) => [s.name, s.fields.length, s.templateSheet])).toEqual([
      ['Profit Center', 31, 'Profit Center'],
      ['Company Codes', 3, 'Company Codes'],
      ['Translation', 5, 'Translation'],
    ]);
    expect(p.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.code)).toEqual([
      'XLSX_BLANK_HEADER',
    ]);
  });

  it('the preview with a chosen header row and layout gives the same result as the automatic import', () => {
    const auto = ok(autoImportTarget(templateFile(), 'Profit Center'));
    const same = ok(previewTarget(templateFile(), 4, auto.layout, 'Profit Center'));
    expect(same.target).toEqual(auto.target);
  });

  it('readTargetTable reads the Field List sheet, so the column choices come from it', () => {
    const t = ok(readTargetTable(templateFile(), 4));
    expect(t.source.datasets.map((d) => d.name)).toEqual(['Field List']);
  });

  it('keeps the workbook in the target so output can be written into it', () => {
    const p = ok(autoImportTarget(templateFile(), 'Profit Center'));
    expect(p.target.template?.fileName).toBe('data_pc_template.xlsx');
    expect(Array.from(fromBase64(p.target.template!.base64))).toEqual(
      Array.from(templateFile().content),
    );
  });

  it('gives the same fields as the old single-sheet file, and the old file still loads without a template', () => {
    const t = ok(autoImportTarget(templateFile(), 'Profit Center')).target;
    const old = ok(autoImportTarget(targetFile(), 'Profit Center')).target;
    const strip = (s: (typeof t.structures)[number]) => ({ ...s, templateSheet: undefined });
    expect(t.structures.map(strip)).toEqual(old.structures.map(strip));
    expect(old.template).toBeUndefined();
    expect(old.structures.every((s) => s.templateSheet === undefined)).toBe(true);
  });
});

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
