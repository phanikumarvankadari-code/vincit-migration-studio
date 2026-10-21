import { describe, expect, it } from 'vitest';
import { SourceDefinitionSchema, SourceRowsSchema, type Result } from '@mms/mapping-core';
import { importCsv, parseCsvText, type ImportedSource } from '../src/index.js';
import { readInputText } from './helpers/fixtures.js';

function ok(r: Result<ImportedSource>): ImportedSource {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const imp = (text: string, extra = {}) => ok(importCsv(text, { fileName: 'T.csv', ...extra }));
const cells = (text: string) => imp(text).rows[0]!.rows;

describe('CSV import (SPEC-002)', () => {
  it('standard CSV: header row becomes fields, data rows become rows', () => {
    const r = imp('a,b\n1,2\n3,4\n');
    expect(r.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual(['a', 'b']);
    expect(r.rows[0]!.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(r.source.sourceType).toBe('csv');
    expect(r.diagnostics).toEqual([]);
  });

  it('blank values stay distinguishable: unquoted empty is null, quoted empty is an empty string', () => {
    expect(cells('a,b,c\n1,,""\n')).toEqual([['1', null, '']]);
  });

  it('whitespace is preserved, not trimmed', () => {
    expect(cells('a,b\n" x ",  \n')).toEqual([[' x ', '  ']]);
  });

  it('preserves leading zeros and original text', () => {
    expect(cells('a,b,c\n00330,007,1.50\n')).toEqual([['00330', '007', '1.50']]);
  });

  it('handles quoted commas, quotes and line breaks', () => {
    expect(cells('a,b\n"x,y","say ""hi"""\n"line1\nline2",z\n')).toEqual([
      ['x,y', 'say "hi"'],
      ['line1\nline2', 'z'],
    ]);
  });

  it('handles UTF-8 text and a BOM', () => {
    expect(cells('﻿name,city\nJosé,Tōkyō 日本\n😀,ä\n')).toEqual([
      ['José', 'Tōkyō 日本'],
      ['😀', 'ä'],
    ]);
    expect(imp('﻿name\nx').source.datasets[0]!.fields[0]!.displayName).toBe('name');
  });

  it.each([
    ['CRLF', '\r\n'],
    ['LF', '\n'],
    ['CR', '\r'],
  ])('handles %s line endings and a missing final newline', (_n, nl) => {
    expect(cells(`a,b${nl}1,2${nl}3,4`)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('skips blank lines but keeps a row of only delimiters', () => {
    expect(cells('a,b\n\n1,2\n,\n\n')).toEqual([
      ['1', '2'],
      [null, null],
    ]);
  });

  it('supports a configurable delimiter (semicolon, tab)', () => {
    expect(
      ok(importCsv('a;b\n"1;1";2\n', { fileName: 'T.csv', delimiter: ';' })).rows[0]!.rows,
    ).toEqual([['1;1', '2']]);
    expect(
      ok(importCsv('a\tb\n1\t2\n', { fileName: 'T.csv', delimiter: '\t' })).rows[0]!.rows,
    ).toEqual([['1', '2']]);
  });

  it('a quote inside an unquoted field is kept literally', () => {
    expect(cells('a\n5" pipe\n')).toEqual([['5" pipe']]);
  });
});

describe('CSV errors and warnings', () => {
  it('empty file returns a structured error', () => {
    for (const text of ['', '\n\n', '﻿']) {
      const r = importCsv(text, { fileName: 'T.csv' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0]).toMatchObject({ severity: 'error', code: 'CSV_EMPTY' });
    }
  });

  it('unterminated quote returns an error with the line', () => {
    const r = importCsv('a,b\n1,"oops\n2,3\n', { fileName: 'T.csv' });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.issues[0]).toMatchObject({
        code: 'CSV_UNTERMINATED_QUOTE',
        technicalDetails: 'line 2',
      });
  });

  it('a short row is padded with blanks and reported', () => {
    const r = imp('a,b,c\n1,2\n');
    expect(r.rows[0]!.rows).toEqual([['1', '2', null]]);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'CSV_ROW_TOO_SHORT',
      sourceRow: 1,
    });
  });

  it('a long row is cut, reported as an error, and the dropped values are recorded', () => {
    const r = imp('a,b\n1,2,3,4\n5,6\n');
    expect(r.rows[0]!.rows).toEqual([
      ['1', '2'],
      ['5', '6'],
    ]);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'CSV_ROW_TOO_LONG',
      sourceRow: 1,
    });
    expect(r.diagnostics[0]!.technicalDetails).toContain('"3"');
  });

  it('blank and duplicate headers are reported but kept', () => {
    const r = imp('a,,a\n1,2,3\n');
    expect(r.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual(['a', 'Column 2', 'a']);
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual([
      'CSV_BLANK_HEADER',
      'CSV_DUPLICATE_HEADER',
    ]);
    const ids = r.source.datasets[0]!.fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('a header-only file imports with a warning', () => {
    const r = imp('a,b\n');
    expect(r.rows[0]!.rows).toEqual([]);
    expect(r.diagnostics[0]!.code).toBe('CSV_NO_DATA_ROWS');
  });

  it('parseCsvText reports the physical line of each row', () => {
    const p = parseCsvText('a\n"x\ny"\nz\n');
    expect(p.ok && p.rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });
});

describe('CSV output contract', () => {
  it('output conforms to mapping-core schemas, with deterministic IDs and a datatype of unknown', () => {
    const a = imp('x,y\n1,2\n', { fileName: 'CEPC.csv' });
    const b = imp('x,y\n1,2\n', { fileName: 'CEPC.csv' });
    expect(a).toEqual(b);
    expect(SourceDefinitionSchema.safeParse(a.source).success).toBe(true);
    expect(SourceRowsSchema.safeParse(a.rows[0]).success).toBe(true);
    expect(a.source.id).toBe('src-CEPC');
    expect(a.source.datasets[0]).toMatchObject({
      id: 'ds-CEPC',
      name: 'CEPC',
      sourceId: 'src-CEPC',
    });
    expect(a.source.datasets[0]!.fields.map((f) => [f.id, f.datatype])).toEqual([
      ['f-CEPC-1', 'unknown'],
      ['f-CEPC-2', 'unknown'],
    ]);
    expect(a.rows[0]!.fieldIds).toEqual(['f-CEPC-1', 'f-CEPC-2']);
  });

  it('dataset name and location can be overridden; location is not required to be a local file', () => {
    const r = imp('x\n1', {
      datasetName: 'My Data',
      location: { kind: 'uri', uri: 'sharepoint://x' },
    });
    expect(r.source.datasets[0]!.name).toBe('My Data');
    expect(r.source.datasets[0]!.id).toBe('ds-My-Data');
    expect(r.source.location).toEqual({ kind: 'uri', uri: 'sharepoint://x' });
  });
});

describe('Profit Center CSV fixtures', () => {
  it.each([
    ['CEPC.csv', 48, 3],
    ['CEPCT.csv', 8, 1],
    ['CEPC_BUKRS.csv', 10, 1],
  ])('%s imports with %i columns and %i rows and no diagnostics', (file, cols, rows) => {
    const r = imp(readInputText(file), { fileName: file });
    expect(r.source.datasets[0]!.fields).toHaveLength(cols);
    expect(r.rows[0]!.rows).toHaveLength(rows);
    expect(r.diagnostics).toEqual([]);
  });

  it('blank Client cells in CEPC are null and the values are untouched', () => {
    const r = imp(readInputText('CEPC.csv'), { fileName: 'CEPC.csv' });
    const col = (name: string) =>
      r.source.datasets[0]!.fields.findIndex((f) => f.displayName === name);
    const rows = r.rows[0]!.rows;
    expect(rows.map((row) => row[col('Client')])).toEqual(['100', null, null]);
    expect(rows.map((row) => row[col('Postal Code')])).toEqual(['00330', '00330', '00330']);
    expect(rows[0]![col('Valid From')]).toBe('1/1/26');
    expect(rows[0]![col('Telephone 1')]).toBe('+358123456001');
  });

  it('the dictionary file is also a valid CSV', () => {
    const r = imp(readInputText('field_dictionary.csv'), { fileName: 'field_dictionary.csv' });
    expect(r.source.datasets[0]!.fields[0]!.displayName).toBe('TABNAME');
  });
});
