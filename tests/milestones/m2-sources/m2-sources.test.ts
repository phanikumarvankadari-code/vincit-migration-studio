import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SourceDefinitionSchema, SourceRowsSchema, type Result } from '@mms/mapping-core';
import {
  applyFieldDictionary,
  importCsv,
  importFieldDictionary,
  importXlsx,
} from '@mms/file-import';
import { profileDataset } from '@mms/profiler';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, base), 'utf8');
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

/**
 * M2 demo check: Profit Center files load with a profile; the dictionary enriches fields;
 * the CEPC_BUKRS include placeholders are skipped without a false mismatch warning.
 */
describe('M2 sources', () => {
  const dictionary = ok(importFieldDictionary(text('input/field_dictionary.csv')));
  const load = (file: string) => {
    const imported = ok(importCsv(text(`input/${file}`), { fileName: file }));
    const enriched = applyFieldDictionary(imported.source, dictionary.dictionary);
    return { imported, enriched };
  };

  it('M2-01 all Profit Center CSV sources import with canonical output and no diagnostics', () => {
    for (const file of ['CEPC.csv', 'CEPCT.csv', 'CEPC_BUKRS.csv']) {
      const { imported } = load(file);
      expect(imported.diagnostics, file).toEqual([]);
      expect(SourceDefinitionSchema.safeParse(imported.source).success).toBe(true);
      expect(SourceRowsSchema.safeParse(imported.rows[0]).success).toBe(true);
    }
  });

  it('M2-02 the dictionary enriches fields and keeps display names', () => {
    const f = load('CEPC.csv').enriched.source.datasets[0]!.fields[1]!;
    expect(f).toMatchObject({
      displayName: 'Profit Center',
      technicalName: 'PRCTR',
      isKey: true,
      length: 10,
    });
  });

  it('M2-03 CEPC_BUKRS include placeholders are skipped, so 10 columns match 10 fields', () => {
    expect(
      dictionary.diagnostics.filter((d) => d.code === 'DICT_PSEUDO_FIELD_SKIPPED'),
    ).toHaveLength(2);
    const { enriched } = load('CEPC_BUKRS.csv');
    expect(enriched.diagnostics).toEqual([]);
    expect(enriched.source.datasets[0]!.fields[3]).toMatchObject({
      displayName: 'Company Code',
      technicalName: 'BUKRS',
    });
  });

  it('M2-04 fields show fill percentage, inferred datatype, uniqueness and sample values', () => {
    const { imported, enriched } = load('CEPC.csv');
    const p = ok(profileDataset(enriched.source.datasets[0]!, imported.rows[0]!));
    const byName = (name: string) => {
      const i = enriched.source.datasets[0]!.fields.findIndex((f) => f.displayName === name);
      return p.fields[i]!;
    };
    expect(p.rowCount).toBe(3);
    expect(byName('Client')).toMatchObject({
      fillPercentage: 33.33,
      nullCount: 2,
      inferredDatatype: 'integer',
    });
    expect(byName('Profit Center')).toMatchObject({
      uniqueness: 'unique',
      representativeValues: ['S_PC_1', 'S_PC_2', 'S_PC_3'],
    });
    expect(byName('Postal Code').inferredDatatype).toBe('string'); // leading zeros stay text
    expect(byName('Valid From').inferredDatatype).toBe('string'); // ambiguous dates are not guessed
  });

  it('M2-05 profiling does not change the imported rows', () => {
    const { imported, enriched } = load('CEPC.csv');
    const before = JSON.stringify(imported.rows);
    ok(profileDataset(enriched.source.datasets[0]!, imported.rows[0]!));
    expect(JSON.stringify(imported.rows)).toBe(before);
  });

  it('M2-06 the Excel target workbook is readable and its blank header column is reported', () => {
    const bytes = new Uint8Array(readFileSync(new URL('target/data_pc.XLSX', base)));
    const r = ok(importXlsx(bytes, { fileName: 'data_pc.XLSX', headerRow: 4 }));
    expect(r.source.datasets[0]!.name).toBe('Field Mapping');
    expect(r.diagnostics.some((d) => d.code === 'XLSX_BLANK_HEADER')).toBe(true);
  });

  it('M2-07 a generic CSV works without any dictionary', () => {
    const generic = ok(importCsv('Name,Qty\nBolt,00012\n', { fileName: 'Parts.csv' }));
    const enriched = applyFieldDictionary(generic.source, dictionary.dictionary);
    expect(enriched.source).toEqual(generic.source);
    expect(enriched.diagnostics[0]!.code).toBe('DICT_TABLE_NOT_FOUND');
  });
});
