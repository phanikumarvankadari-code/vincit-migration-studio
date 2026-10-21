import { describe, expect, it } from 'vitest';
import { validateProject } from '@mms/mapping-core';
import {
  buildMappingRows,
  describeMapping,
  draftToMapping,
  emptyDraft,
  filterRows,
  constantFrom,
  mappingToDraft,
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
        {
          id: 'tf-A-4',
          targetStructureId: 'ts-A',
          displayName: 'Language',
          datatype: 'string',
          required: false,
          isKey: false,
        },
      ],
    },
  ],
} as never;

function ready(): StudioState {
  const { cepc, bukrs } = smallSources();
  return apply(
    newState(),
    { type: 'sourceAdded', imported: cepc, at: at() },
    { type: 'sourceAdded', imported: bukrs, at: at() },
    { type: 'targetLoaded', target, at: at() },
  );
}
const ref = (ds: string, f: number | string) => ({
  datasetId: `ds-${ds}`,
  fieldId: `f-${ds}-${f}`,
});
const save = (s: StudioState, field: string, draft: MappingDraft) => {
  const r = draftToMapping(s.project, 'ts-A', field, draft);
  if (!r.ok) throw new Error(r.problems.join('; '));
  return apply(s, { type: 'mappingSaved', mapping: r.mapping, lookups: r.lookups, at: at() });
};

describe('mapping drafts become canonical mappings', () => {
  it('direct', () => {
    const s = save(ready(), 'tf-A-1', { type: 'direct', source: ref('CEPC', 1) });
    expect(s.project.mappingDefinition.mappings[0]).toMatchObject({
      id: 'm-tf-A-1',
      mappingType: 'direct',
      status: 'mapped',
      sourceReferences: [{ datasetId: 'ds-CEPC', fieldId: 'f-CEPC-1' }],
    });
    expect(validateProject(s.project)).toEqual([]);
  });

  it('constant keeps its datatype', () => {
    const s = save(ready(), 'tf-A-4', {
      type: 'constant',
      value: 'EN',
      datatype: 'string',
      blank: false,
    });
    expect(s.project.mappingDefinition.mappings[0]).toMatchObject({
      mappingType: 'constant',
      constant: { datatype: 'string', value: 'EN' },
    });
    expect(constantFrom('integer', '5', false)).toEqual({
      ok: true,
      constant: { datatype: 'integer', value: 5 },
    });
    expect(constantFrom('boolean', 'TRUE', false)).toEqual({
      ok: true,
      constant: { datatype: 'boolean', value: true },
    });
    expect(constantFrom('string', '', true)).toEqual({
      ok: true,
      constant: { datatype: 'string', value: null },
    });
    for (const [t, v] of [
      ['integer', '5.5'],
      ['boolean', 'yes'],
      ['decimal', '1,5'],
      ['date', '1/1/26'],
    ] as const)
      expect(constantFrom(t, v, false).ok, `${t} ${v}`).toBe(false);
  });

  it('lookup creates the lookup definition and the manifest', () => {
    const s = save(ready(), 'tf-A-2', {
      type: 'lookup',
      source: ref('CEPC', 2),
      lookup: {
        id: 'lk-region',
        name: 'Country to region',
        entries: [
          { key: 'FI', value: 'North' },
          { key: 'SE', value: 'North' },
        ],
      },
      missing: { kind: 'warning' },
    });
    expect(s.project.lookups).toMatchObject([
      {
        id: 'lk-region',
        name: 'Country to region',
        entries: [
          { key: 'FI', value: 'North' },
          { key: 'SE', value: 'North' },
        ],
      },
    ]);
    expect(s.project.mappingDefinition.lookupReferences).toEqual([{ lookupId: 'lk-region' }]);
    expect(validateProject(s.project)).toEqual([]);
  });

  it('condition', () => {
    const s = save(ready(), 'tf-A-2', {
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
    expect(s.project.mappingDefinition.mappings[0]).toMatchObject({
      mappingType: 'conditional',
      conditional: {
        rules: [{ when: { op: 'compare', operator: 'eq' } }],
        otherwise: { kind: 'constant' },
      },
    });
    expect(validateProject(s.project)).toEqual([]);
  });

  it('routine chain adds the routine definitions and pins their versions', () => {
    const s = save(ready(), 'tf-A-3', {
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
    });
    expect(s.project.routines.map((r) => r.id)).toEqual(['date.format', 'date.parse']);
    expect(s.project.mappingDefinition.routineReferences).toEqual([
      { routineId: 'date.format', version: '1' },
      { routineId: 'date.parse', version: '1' },
    ]);
    expect(s.project.mappingDefinition.mappings[0]!.transformations.map((t) => t.order)).toEqual([
      0, 1,
    ]);
    expect(validateProject(s.project)).toEqual([]);
  });

  it('replacing a mapping removes routines nobody uses any more', () => {
    let s = save(ready(), 'tf-A-3', {
      type: 'routine',
      source: ref('CEPC', 3),
      steps: [{ kind: 'routine', routineId: 'text.trim', configuration: '{}', onError: 'stop' }],
    });
    expect(s.project.routines).toHaveLength(1);
    s = save(s, 'tf-A-3', { type: 'direct', source: ref('CEPC', 3) });
    expect(s.project.routines).toEqual([]);
    expect(s.project.mappingDefinition.routineReferences).toEqual([]);
    expect(s.project.mappingDefinition.mappings).toHaveLength(1);
  });

  it('problems are listed in plain words and nothing is saved', () => {
    const p = ready().project;
    const problems = (d: MappingDraft) => {
      const r = draftToMapping(p, 'ts-A', 'tf-A-1', d);
      return r.ok ? [] : r.problems;
    };
    expect(problems(emptyDraft('direct'))).toEqual(['Choose a source field.']);
    expect(problems({ type: 'constant', value: '', datatype: 'string', blank: false })).toEqual([
      'Enter the constant value, or tick "blank".',
    ]);
    expect(problems({ type: 'constant', value: 'x', datatype: 'integer', blank: false })).toEqual([
      '"x" is not a whole number.',
    ]);
    expect(problems(emptyDraft('routine'))).toEqual([
      'Choose a source field.',
      'Add at least one step.',
    ]);
    // the blank starter row is ignored, so only "add an entry" is reported
    expect(problems(emptyDraft('lookup'))).toEqual([
      'Choose the source field to look up.',
      'Add at least one lookup entry.',
    ]);
    expect(
      problems({
        type: 'lookup',
        source: ref('CEPC', 2),
        lookup: {
          id: 'lk',
          name: ' ',
          entries: [
            { key: 'A', value: '1' },
            { key: 'A', value: '2' },
          ],
        },
        missing: { kind: 'null' },
      }),
    ).toEqual(['Give the lookup a name.', 'A lookup key appears more than once.']);
    expect(
      problems({
        type: 'routine',
        source: ref('CEPC', 1),
        steps: [
          { kind: 'routine', routineId: 'date.parse', configuration: '{nope', onError: 'stop' },
        ],
      }),
    ).toEqual([
      'Step 1: the settings are not valid JSON (use {"setting": "value"}).',
      expect.stringContaining('Parse Date'),
    ]);
    expect(
      problems({
        type: 'routine',
        source: ref('CEPC', 1),
        steps: [
          {
            kind: 'routine',
            routineId: 'date.parse',
            configuration: '{"format":"M/D/YY"}',
            onError: 'stop',
          },
        ],
      })[0],
    ).toContain('twoDigitYearPivot');
    expect(
      problems({ type: 'direct', source: { datasetId: 'ds-CEPC', fieldId: 'f-gone' } }),
    ).toEqual(['The source field for a source field no longer exists.']);
    expect(
      problems({ type: 'conditional', source: undefined, rules: [], otherwise: undefined }),
    ).toEqual(['Add at least one rule.']);
  });

  it('needs-review can be flagged when saving', () => {
    const r = draftToMapping(
      ready().project,
      'ts-A',
      'tf-A-1',
      { type: 'direct', source: ref('CEPC', 1) },
      { needsReview: true },
    );
    expect(r.ok && r.mapping.status).toBe('needsReview');
  });
});

describe('mappings can be edited again', () => {
  const roundTrip = (draft: MappingDraft, field = 'tf-A-2') => {
    const s = save(ready(), field, draft);
    const m = s.project.mappingDefinition.mappings[0]!;
    const back = mappingToDraft(s.project, m);
    expect(back).toEqual(draft);
    return s;
  };

  it('every editable type goes back into the editor unchanged', () => {
    roundTrip({ type: 'direct', source: ref('CEPC', 2) });
    roundTrip({ type: 'constant', value: '12.50', datatype: 'decimal', blank: false });
    roundTrip({ type: 'constant', value: '', datatype: 'string', blank: true });
    roundTrip({
      type: 'lookup',
      source: ref('CEPC', 2),
      lookup: { id: 'lk-x', name: 'X', entries: [{ key: 'A', value: '1' }] },
      missing: { kind: 'default', value: 'D' },
    });
    roundTrip({
      type: 'conditional',
      source: ref('CEPC', 2),
      rules: [
        {
          left: { kind: 'current' },
          operator: 'notEmpty',
          right: '',
          then: { kind: 'field', ref: ref('CEPC', 3) },
        },
        {
          left: { kind: 'field', ref: ref('CEPC', 1) },
          operator: 'gte',
          right: 'P2',
          then: { kind: 'text', value: 'hi' },
        },
      ],
      otherwise: undefined,
    });
    roundTrip(
      {
        type: 'routine',
        source: ref('CEPC', 3),
        steps: [
          {
            kind: 'routine',
            routineId: 'text.trim',
            configuration: '{\n  "mode": "start"\n}',
            onError: 'continue',
          },
        ],
      },
      'tf-A-3',
    );
  });

  it('a mapping the editor cannot show returns undefined instead of losing parts of it', () => {
    const s = ready();
    const base = {
      id: 'm1',
      targetStructureId: 'ts-A',
      targetFieldId: 'tf-A-2',
      sourceReferences: [],
      transformations: [],
      status: 'mapped',
    } as Record<string, unknown>;
    expect(
      mappingToDraft(s.project, {
        ...base,
        mappingType: 'javascript',
        javascript: { code: 'return value;', declaredLookupIds: [] },
      } as never),
    ).toBeUndefined();
    expect(
      mappingToDraft(s.project, {
        ...base,
        mappingType: 'conditional',
        conditional: {
          rules: [
            {
              when: { op: 'and', conditions: [{ op: 'isEmpty', operand: { kind: 'current' } }] },
              then: { kind: 'current' },
            },
          ],
        },
      } as never),
    ).toBeUndefined();
    expect(
      mappingToDraft(s.project, {
        ...base,
        mappingType: 'lookup',
        lookup: { lookupId: 'nope', configuration: {}, missingValue: { kind: 'error' } },
      } as never),
    ).toBeUndefined();
  });

  it('a direct mapping with steps opens as a routine chain', () => {
    const s = ready();
    const m = {
      id: 'm1',
      targetStructureId: 'ts-A',
      targetFieldId: 'tf-A-2',
      mappingType: 'direct',
      sourceReferences: [ref('CEPC', 2)],
      transformations: [
        { kind: 'routine', routineId: 'text.upper', configuration: {}, order: 0, onError: 'stop' },
      ],
      status: 'mapped',
    } as never;
    expect(mappingToDraft(s.project, m)).toMatchObject({
      type: 'routine',
      steps: [{ kind: 'routine', routineId: 'text.upper' }],
    });
  });
});

describe('mapping table rows', () => {
  it('lists every target field with its status; unmapped required fields are easy to find', () => {
    const s = save(ready(), 'tf-A-1', { type: 'direct', source: ref('CEPC', 1) });
    const rows = buildMappingRows({ project: s.project });
    expect(rows.map((r) => [r.fieldName, r.status, r.required])).toEqual([
      ['Profit Center', 'mapped', true],
      ['Region', 'unmapped', false],
      ['Valid From', 'unmapped', true],
      ['Language', 'unmapped', false],
    ]);
    expect(filterRows(rows, { status: 'requiredUnmapped' }).map((r) => r.fieldName)).toEqual([
      'Valid From',
    ]);
    expect(filterRows(rows, { status: 'unmapped' })).toHaveLength(3);
    expect(filterRows(rows, { search: 'region' }).map((r) => r.fieldName)).toEqual(['Region']);
    expect(filterRows(rows, { structureId: 'ts-nope' })).toEqual([]);
  });

  it('describes source and transformation in plain words', () => {
    let s = save(ready(), 'tf-A-1', { type: 'direct', source: ref('CEPC', 1) });
    s = save(s, 'tf-A-4', { type: 'constant', value: 'EN', datatype: 'string', blank: false });
    s = save(s, 'tf-A-2', {
      type: 'lookup',
      source: ref('CEPC', 2),
      lookup: { id: 'lk', name: 'Region table', entries: [{ key: 'FI', value: 'N' }] },
      missing: { kind: 'null' },
    });
    s = save(s, 'tf-A-3', {
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
    });
    const rows = Object.fromEntries(
      buildMappingRows({ project: s.project }).map((r) => [r.fieldName, r]),
    );
    expect([rows['Profit Center']!.source, rows['Profit Center']!.transformation]).toEqual([
      'CEPC.Profit Center',
      'Direct',
    ]);
    expect([rows['Language']!.source, rows['Language']!.transformation]).toEqual([
      '"EN"',
      'Constant',
    ]);
    expect([rows['Region']!.source, rows['Region']!.transformation]).toEqual([
      'CEPC.Country',
      'Lookup Region table',
    ]);
    expect([rows['Valid From']!.source, rows['Valid From']!.transformation]).toEqual([
      'CEPC.Valid From',
      'Parse Date → Format Date',
    ]);
  });

  it('describes conditions', () => {
    const s = save(ready(), 'tf-A-2', {
      type: 'conditional',
      source: ref('CEPC', 2),
      rules: [
        {
          left: { kind: 'current' },
          operator: 'eq',
          right: 'FI',
          then: { kind: 'text', value: 'A' },
        },
        {
          left: { kind: 'current' },
          operator: 'isEmpty',
          right: '',
          then: { kind: 'text', value: 'B' },
        },
      ],
      otherwise: undefined,
    });
    expect(
      describeMapping(s.project, s.project.mappingDefinition.mappings[0]!).transformation,
    ).toBe('Condition: if this value = "FI" …');
  });

  it('flagged mappings show Needs Review, and errors from pre-flight or a current run show Error', () => {
    const s0 = ready();
    const r = draftToMapping(
      s0.project,
      'ts-A',
      'tf-A-1',
      { type: 'direct', source: ref('CEPC', 1) },
      { needsReview: true },
    );
    if (!r.ok) throw new Error('x');
    const s = apply(s0, { type: 'mappingSaved', mapping: r.mapping, at: at() });
    expect(buildMappingRows({ project: s.project })[0]!.status).toBe('needsReview');
    const err = {
      severity: 'error',
      code: 'X',
      message: 'broken',
      fieldMappingId: 'm-tf-A-1',
    } as never;
    expect(buildMappingRows({ project: s.project, preflight: [err] })[0]).toMatchObject({
      status: 'error',
    });
    expect(buildMappingRows({ project: s.project, runDiagnostics: [err] })[0]!.issues).toHaveLength(
      1,
    );
    const perRow = {
      ...(err as object),
      targetRow: 3,
      targetFieldId: 'tf-A-1',
      targetStructureId: 'ts-A',
      fieldMappingId: undefined,
    } as never;
    expect(buildMappingRows({ project: s.project, runDiagnostics: [perRow] })[0]!.status).toBe(
      'needsReview',
    ); // a per-row diagnostic for another reason does not change the mapping status
  });

  it('no target means no rows', () => {
    expect(buildMappingRows({ project: newState().project })).toEqual([]);
  });
});
