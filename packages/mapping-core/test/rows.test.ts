import { describe, expect, it } from 'vitest';
import { SourceRowsSchema, TargetRowsSchema } from '../src/index.js';

describe('row contracts', () => {
  it('source rows: null is a blank cell, empty string is an empty value', () => {
    const r = SourceRowsSchema.parse({
      datasetId: 'd',
      fieldIds: ['a', 'b'],
      rows: [
        ['x', null],
        ['', 'y'],
      ],
    });
    expect(r.rows).toEqual([
      ['x', null],
      ['', 'y'],
    ]);
  });

  it('rejects non-string cell values and unknown keys', () => {
    expect(
      SourceRowsSchema.safeParse({ datasetId: 'd', fieldIds: ['a'], rows: [[1]] }).success,
    ).toBe(false);
    expect(
      SourceRowsSchema.safeParse({ datasetId: 'd', fieldIds: ['a'], rows: [], extra: 1 }).success,
    ).toBe(false);
  });

  it('target rows stay associated with their structure', () => {
    const r = TargetRowsSchema.parse({
      targetStructureId: 'ts-cc',
      fieldIds: ['tf-1'],
      rows: [['FI01']],
    });
    expect(r.targetStructureId).toBe('ts-cc');
    expect(TargetRowsSchema.safeParse({ fieldIds: ['tf-1'], rows: [] }).success).toBe(false);
  });
});
