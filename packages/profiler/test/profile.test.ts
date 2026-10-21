import { describe, expect, it } from 'vitest';
import {
  SourceDatasetSchema,
  SourceRowsSchema,
  type SourceDataset,
  type SourceRows,
} from '@mms/mapping-core';
import { profileDataset, type DatasetProfile } from '../src/index.js';

function make(
  headers: string[],
  rows: (string | null)[][],
): { ds: SourceDataset; data: SourceRows } {
  const ds = SourceDatasetSchema.parse({
    id: 'ds1',
    sourceId: 's1',
    name: 'T',
    displayName: 'T',
    fields: headers.map((h, i) => ({
      id: `f${i + 1}`,
      datasetId: 'ds1',
      displayName: h,
      datatype: 'unknown',
    })),
  });
  const data = SourceRowsSchema.parse({
    datasetId: 'ds1',
    fieldIds: ds.fields.map((f) => f.id),
    rows,
  });
  return { ds, data };
}
function profile(headers: string[], rows: (string | null)[][], opts = {}): DatasetProfile {
  const { ds, data } = make(headers, rows);
  const r = profileDataset(ds, data, opts);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

describe('profiler (SPEC-005)', () => {
  it('counts rows, nulls, empty strings, filled cells and fill percentage', () => {
    const p = profile(['a'], [['x'], [null], [''], ['y']]);
    expect(p.rowCount).toBe(4);
    expect(p.fields[0]).toMatchObject({
      nullCount: 1,
      emptyCount: 1,
      filledCount: 2,
      fillPercentage: 50,
    });
  });

  it('rounds the fill percentage to two decimals', () => {
    expect(profile(['a'], [['x'], [null], [null]]).fields[0]!.fillPercentage).toBe(33.33);
  });

  it('counts distinct values and flags uniqueness', () => {
    const p = profile(
      ['u', 'd', 'blank'],
      [
        ['1', 'a', null],
        ['2', 'a', null],
        ['3', 'b', null],
      ],
    );
    expect(p.fields.map((f) => [f.distinctCount, f.uniqueness])).toEqual([
      [3, 'unique'],
      [2, 'notUnique'],
      [0, 'unknown'],
    ]);
  });

  it('lists representative values: most frequent first, ties by first seen', () => {
    const p = profile(['a'], [['b'], ['a'], ['a'], ['c'], ['b'], ['d']], {
      maxRepresentativeValues: 3,
    });
    expect(p.fields[0]!.representativeValues).toEqual(['b', 'a', 'c']);
  });

  it('reports min and max length of filled values', () => {
    const f = profile(['a'], [['ab'], ['abcd'], [null]]).fields[0]!;
    expect([f.minLength, f.maxLength]).toEqual([2, 4]);
    expect(profile(['a'], [[null]]).fields[0]!.minLength).toBeUndefined();
  });

  it.each([
    [['1', '22', '-3'], 'integer'],
    [['1.5', '2'], 'decimal'],
    [['true', 'FALSE'], 'boolean'],
    [['2026-01-31', '2025-12-01'], 'date'],
    [['2026-01-31T10:00:00', '2026-01-31T10:00:00Z'], 'dateTime'],
    [['00330', '00120'], 'string'],
    [['007'], 'string'],
    [['1/1/26', '5/1/26'], 'string'],
    [['2026-02-30'], 'string'],
    [['1', 'x'], 'string'],
    [['1', '2026-01-01'], 'string'],
    [[null, ''], 'unknown'],
  ])('infers %j as %s', (values, expected) => {
    expect(
      profile(
        ['a'],
        (values as (string | null)[]).map((v) => [v]),
      ).fields[0]!.inferredDatatype,
    ).toBe(expected);
  });

  it('a Profit Center like dataset profiles correctly', () => {
    const p = profile(
      ['Client', 'Profit Center', 'Postal Code'],
      [
        ['100', 'S_PC_1', '00330'],
        [null, 'S_PC_2', '00330'],
        [null, 'S_PC_3', '00330'],
      ],
    );
    expect(p.fields[0]).toMatchObject({
      nullCount: 2,
      fillPercentage: 33.33,
      inferredDatatype: 'integer',
      uniqueness: 'unique',
    });
    expect(p.fields[1]).toMatchObject({
      uniqueness: 'unique',
      inferredDatatype: 'string',
      representativeValues: ['S_PC_1', 'S_PC_2', 'S_PC_3'],
    });
    expect(p.fields[2]).toMatchObject({
      uniqueness: 'notUnique',
      distinctCount: 1,
      inferredDatatype: 'string',
    });
  });

  it('an empty dataset profiles to zero rows and zero fill', () => {
    expect(profile(['a'], []).fields[0]).toMatchObject({
      rowCount: 0,
      fillPercentage: 0,
      inferredDatatype: 'unknown',
    });
  });

  it('does not modify the source rows or the dataset', () => {
    const { ds, data } = make(
      ['a', 'b'],
      [
        ['1', null],
        ['2', 'x'],
      ],
    );
    const before = JSON.stringify([ds, data]);
    const frozen = Object.freeze(data.rows.map((r) => Object.freeze([...r])));
    const r = profileDataset(ds, { ...data, rows: frozen as never });
    expect(r.ok).toBe(true);
    expect(JSON.stringify([ds, data])).toBe(before);
  });

  it('failures return diagnostics, never throw', () => {
    const { ds, data } = make(['a', 'b'], [['1', '2'], ['3']]);
    const short = profileDataset(ds, data);
    expect(short.ok).toBe(false);
    if (!short.ok)
      expect(short.issues[0]).toMatchObject({ code: 'PROFILE_ROW_WIDTH', sourceRow: 2 });
    const other = profileDataset(ds, { ...data, datasetId: 'other' as never });
    expect(!other.ok && other.issues[0]!.code).toBe('PROFILE_DATASET_MISMATCH');
    const cols = profileDataset(ds, { ...data, fieldIds: ['x', 'y'] as never });
    expect(!cols.ok && cols.issues[0]!.code).toBe('PROFILE_FIELD_MISMATCH');
  });
});
