import { describe, expect, it } from 'vitest';
import {
  draftToMapping,
  previewMapping,
  type MappingDraft,
  type StudioState,
} from '../src/index.js';
import { apply, at, newState, smallSources } from './helpers.js';

const target = {
  id: 'td-1',
  name: 'T',
  structures: [
    {
      id: 'ts-A',
      targetDefinitionId: 'td-1',
      name: 'Alpha',
      displayName: 'Alpha',
      fields: [
        {
          id: 'tf-A-1',
          targetStructureId: 'ts-A',
          displayName: 'Profit Center',
          datatype: 'string',
          required: true,
          isKey: true,
        },
        {
          id: 'tf-A-2',
          targetStructureId: 'ts-A',
          displayName: 'Region',
          datatype: 'string',
          required: false,
          isKey: false,
        },
        {
          id: 'tf-A-3',
          targetStructureId: 'ts-A',
          displayName: 'Valid From',
          datatype: 'date',
          required: true,
          isKey: false,
        },
      ],
    },
  ],
} as never;
const ref = (ds: string, f: number) => ({ datasetId: `ds-${ds}`, fieldId: `f-${ds}-${f}` });
function ready(): StudioState {
  const { cepc, bukrs } = smallSources();
  return apply(
    newState(),
    { type: 'sourceAdded', imported: cepc, at: at() },
    { type: 'sourceAdded', imported: bukrs, at: at() },
    { type: 'targetLoaded', target, at: at() },
  );
}
function preview(draft: MappingDraft, field = 'tf-A-2', s = ready(), rows?: number) {
  const r = draftToMapping(s.project, 'ts-A', field, draft);
  if (!r.ok) throw new Error(r.problems.join(';'));
  return previewMapping(s, r.mapping, r.lookups, rows ? { rows } : {});
}

describe('mapping preview', () => {
  it('shows source values and the produced value for the first rows without saving anything', () => {
    const s = ready();
    const p = preview({ type: 'direct', source: ref('CEPC', 2) }, 'tf-A-2', s);
    expect(p).toMatchObject({ ok: true, sourceLabels: ['CEPC.Country'] });
    if (!p.ok) return;
    expect(p.rows.map((r) => [r.driverRow, r.sources, r.value])).toEqual([
      [1, ['FI'], 'FI'],
      [2, ['SE'], 'SE'],
      [3, ['NO'], 'NO'],
    ]);
    expect(s.project.mappingDefinition.mappings).toEqual([]);
  });

  it('constant, lookup and routine chain', () => {
    const c = preview({ type: 'constant', value: 'EN', datatype: 'string', blank: false });
    expect(c.ok && c.rows.map((r) => r.value)).toEqual(['EN', 'EN', 'EN']);
    const l = preview({
      type: 'lookup',
      source: ref('CEPC', 2),
      lookup: { id: 'lk', name: 'R', entries: [{ key: 'FI', value: 'North' }] },
      missing: { kind: 'error' },
    });
    expect(l.ok && l.rows.map((r) => r.value)).toEqual(['North', null, null]);
    expect(l.ok && l.rows.map((r) => r.issues.map((i) => i.code))).toEqual([
      [],
      ['ENGINE_LOOKUP_MISSING'],
      ['ENGINE_LOOKUP_MISSING'],
    ]);
    const d = preview(
      {
        type: 'routine',
        source: ref('CEPC', 3),
        steps: [
          {
            kind: 'routine',
            routineId: 'date.parse',
            configuration: '{"format":"M/D/YY","twoDigitYearPivot":68}',
            onError: 'stop',
          },
          {
            kind: 'routine',
            routineId: 'date.format',
            configuration: '{"format":"YYYYMMDD"}',
            onError: 'stop',
          },
        ],
      },
      'tf-A-3',
    );
    expect(d.ok && d.rows.map((r) => r.value)).toEqual(['20260101', '20260501', '20260101']);
  });

  it('a routine that fails shows the problem on the row', () => {
    const p = preview(
      {
        type: 'routine',
        source: ref('CEPC', 2),
        steps: [
          {
            kind: 'routine',
            routineId: 'date.parse',
            configuration: '{"format":"M/D/YY","twoDigitYearPivot":68}',
            onError: 'stop',
          },
        ],
      },
      'tf-A-3',
    );
    expect(p.ok && p.rows[0]).toMatchObject({ value: null, sources: ['FI'] });
    expect(p.ok && p.rows[0]!.issues[0]).toMatchObject({
      severity: 'error',
      code: 'DATE_INVALID_FORMAT',
      routineId: 'date.parse',
    });
  });

  it('a condition', () => {
    const p = preview({
      type: 'conditional',
      source: ref('CEPC', 2),
      rules: [
        {
          left: { kind: 'current' },
          operator: 'eq',
          right: 'FI',
          then: { kind: 'text', value: 'Finland' },
        },
      ],
      otherwise: { kind: 'text', value: 'Other' },
    });
    expect(p.ok && p.rows.map((r) => r.value)).toEqual(['Finland', 'Other', 'Other']);
  });

  it('limits the number of rows', () => {
    const p = preview({ type: 'direct', source: ref('CEPC', 2) }, 'tf-A-2', ready(), 2);
    expect(p.ok && p.rows).toHaveLength(2);
  });

  it('a mapping that reads two datasets needs a driver and the preview says which one to choose', () => {
    const s = ready();
    const r = draftToMapping(s.project, 'ts-A', 'tf-A-2', {
      type: 'direct',
      source: ref('CEPC', 2),
    });
    if (!r.ok) throw new Error('x');
    const two = {
      ...r.mapping,
      sourceReferences: [
        ...r.mapping.sourceReferences,
        { datasetId: 'ds-CEPC_BUKRS', fieldId: 'f-CEPC_BUKRS-2' },
      ],
    } as never;
    const p = previewMapping(s, two);
    expect(p).toEqual({ ok: false, message: expect.stringContaining('reads 2 datasets') });
  });

  it('a second dataset read only inside a condition also needs a driver', () => {
    const s = ready();
    const r = draftToMapping(s.project, 'ts-A', 'tf-A-2', {
      type: 'conditional',
      source: ref('CEPC', 2),
      rules: [
        {
          left: { kind: 'field', ref: ref('CEPC_BUKRS', 2) },
          operator: 'eq',
          right: 'FI01',
          then: { kind: 'text', value: 'A' },
        },
      ],
      otherwise: undefined,
    });
    if (!r.ok) throw new Error(r.problems.join(';'));
    const p = previewMapping(s, r.mapping);
    expect(p).toEqual({ ok: false, message: expect.stringContaining('reads 2 datasets') });
  });

  it('explains what is missing instead of failing silently', () => {
    const s = ready();
    const r = draftToMapping(s.project, 'ts-A', 'tf-A-2', {
      type: 'direct',
      source: ref('CEPC', 2),
    });
    if (!r.ok) throw new Error('x');
    expect(previewMapping({ project: s.project, data: {} }, r.mapping)).toEqual({
      ok: false,
      message: 'Load source files first to see a preview.',
    });
    expect(previewMapping({ project: newState().project, data: s.data }, r.mapping)).toEqual({
      ok: false,
      message: 'The target structure is not loaded.',
    });
  });

  it('does not use the clock or randomness for its own work (same preview twice)', () => {
    const d: MappingDraft = { type: 'direct', source: ref('CEPC', 2) };
    expect(preview(d)).toEqual(preview(d));
  });
});
