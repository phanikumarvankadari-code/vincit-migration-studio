import { describe, expect, it } from 'vitest';
import type { Result, SourceDefinition } from '@mms/mapping-core';
import {
  applyFieldDictionary,
  importCsv,
  importFieldDictionary,
  type ImportedSource,
} from '../src/index.js';
import { readInputText } from './helpers/fixtures.js';

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const csv = (file: string): ImportedSource =>
  ok(importCsv(readInputText(file), { fileName: file }));
const dict = () => ok(importFieldDictionary(readInputText('field_dictionary.csv')));

describe('field dictionary import (SPEC-004)', () => {
  it('reads the reference dictionary, skipping the blank row and the structure includes', () => {
    const { dictionary, diagnostics } = dict();
    expect(dictionary.entries).toHaveLength(66);
    expect(diagnostics.filter((d) => d.code === 'DICT_PSEUDO_FIELD_SKIPPED')).toHaveLength(2);
    expect(diagnostics.filter((d) => d.code === 'DICT_BLANK_ROW')).toHaveLength(1);
    expect(diagnostics.every((d) => d.severity === 'info')).toBe(true);
  });

  it('maps native types to canonical datatypes and keeps the native type', () => {
    const e = dict().dictionary.entries;
    const f = (t: string, n: string) => e.find((x) => x.table === t && x.field === n)!;
    expect(f('CEPC', 'PRCTR')).toMatchObject({
      datatype: 'string',
      nativeType: 'C',
      length: 10,
      isKey: true,
      mandatory: false,
      position: 2,
    });
    expect(f('CEPCT', 'DATBI')).toMatchObject({ datatype: 'date', nativeType: 'D', length: 8 });
    expect(f('CEPC', 'ABTEI')).toMatchObject({ isKey: false, rollName: 'ABTEIL' });
  });

  it('column names are configurable', () => {
    const text = 'tbl;fld;ord;k\nT1;F1;1;X\nT1;F2;2;\n';
    const r = ok(
      importFieldDictionary(text, {
        delimiter: ';',
        columns: { table: 'tbl', field: 'fld', position: 'ord', key: 'k' },
      }),
    );
    expect(r.dictionary.entries.map((e) => [e.field, e.isKey])).toEqual([
      ['F1', true],
      ['F2', false],
    ]);
  });

  it('missing required columns and an empty file return errors', () => {
    expect(importFieldDictionary('a,b\n1,2\n').ok).toBe(false);
    const r = importFieldDictionary('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe('DICT_EMPTY');
  });
});

describe('applying the dictionary', () => {
  it('enriches matching source fields and keeps the original display name', () => {
    const { source, diagnostics } = applyFieldDictionary(csv('CEPC.csv').source, dict().dictionary);
    const f = source.datasets[0]!.fields;
    expect(f[1]).toMatchObject({
      displayName: 'Profit Center',
      technicalName: 'PRCTR',
      datatype: 'string',
      nativeType: 'C',
      length: 10,
      isKey: true,
      nullable: true,
    });
    expect(f[4]).toMatchObject({ displayName: 'Valid From', technicalName: 'DATAB', isKey: false });
    expect(f[8]).toMatchObject({ technicalName: 'ABTEI', reference: { rollName: 'ABTEIL' } });
    expect(diagnostics).toEqual([]);
  });

  it('CEPC_BUKRS matches by order once the include placeholders are removed (no mismatch)', () => {
    const { source, diagnostics } = applyFieldDictionary(
      csv('CEPC_BUKRS.csv').source,
      dict().dictionary,
    );
    expect(diagnostics).toEqual([]);
    expect(source.datasets[0]!.fields.map((f) => f.technicalName)).toEqual([
      'MANDT',
      'KOKRS',
      'PRCTR',
      'BUKRS',
      'VNAME',
      'RECID',
      'ETYPE',
      'JV_OTYPE',
      'JV_JIBCL',
      'JV_JIBSA',
    ]);
    expect(source.datasets[0]!.fields[4]!.displayName).toBe('Joint Venture');
  });

  it('CEPCT enriches all 8 fields', () => {
    const { source } = applyFieldDictionary(csv('CEPCT.csv').source, dict().dictionary);
    expect(source.datasets[0]!.fields.map((f) => f.technicalName)).toEqual([
      'MANDT',
      'SPRAS',
      'PRCTR',
      'DATBI',
      'KOKRS',
      'KTEXT',
      'LTEXT',
      'MCTXT',
    ]);
  });

  it('a missing dictionary table does not break the import', () => {
    const generic = ok(importCsv('a,b\n1,2\n', { fileName: 'Other.csv' })).source;
    const r = applyFieldDictionary(generic, dict().dictionary);
    expect(r.source).toEqual(generic);
    expect(r.diagnostics).toMatchObject([{ severity: 'info', code: 'DICT_TABLE_NOT_FOUND' }]);
  });

  it('generic non-SAP files work with an empty dictionary', () => {
    const generic = ok(importCsv('a,b\n1,2\n', { fileName: 'Other.csv' })).source;
    expect(applyFieldDictionary(generic, { entries: [] }).source).toEqual(generic);
  });

  it('a column-count mismatch is reported with the unmatched names', () => {
    const src = ok(importCsv('a,b,c\n1,2,3\n', { fileName: 'T1.csv' })).source;
    const d = ok(
      importFieldDictionary('TABNAME,FIELDNAME,POSITION\nT1,F1,1\nT1,F2,2\nT1,F3,3\nT1,F4,4\n'),
    ).dictionary;
    const r = applyFieldDictionary(src, d);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'DICT_COLUMN_COUNT_MISMATCH',
    });
    expect(r.diagnostics[0]!.technicalDetails).toContain('F4');
    expect(r.source.datasets[0]!.fields.map((f) => f.technicalName)).toEqual(['F1', 'F2', 'F3']);
  });

  it('ambiguous dictionary entries give a warning and leave the dataset unchanged', () => {
    const src = ok(importCsv('a,b\n1,2\n', { fileName: 'T1.csv' })).source;
    const d = ok(
      importFieldDictionary('TABNAME,FIELDNAME,POSITION\nT1,F1,1\nT1,F1,2\n'),
    ).dictionary;
    const r = applyFieldDictionary(src, d);
    expect(r.diagnostics[0]!.code).toBe('DICT_AMBIGUOUS');
    expect(r.source).toEqual(src);
  });

  it('a dataset can be mapped to a differently named table', () => {
    const src: SourceDefinition = ok(importCsv('a\n1\n', { fileName: 'Export.csv' })).source;
    const d = ok(importFieldDictionary('TABNAME,FIELDNAME,POSITION\nT1,F1,1\n')).dictionary;
    const r = applyFieldDictionary(src, d, { datasetTables: { 'ds-Export': 'T1' } });
    expect(r.source.datasets[0]!.fields[0]!.technicalName).toBe('F1');
  });

  it('does not change the input source', () => {
    const src = csv('CEPC.csv').source;
    const before = JSON.stringify(src);
    applyFieldDictionary(src, dict().dictionary);
    expect(JSON.stringify(src)).toBe(before);
  });
});
