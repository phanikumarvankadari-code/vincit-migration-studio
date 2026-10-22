import { describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '@mms/mapping-core';
import { conflictsByTarget, detectConflicts, removeMappings } from '../src/index.js';

const NOW = '2026-10-22T10:00:00.000Z';

function make(maps: object[]): Project {
  return ProjectSchema.parse({
    id: 'p',
    name: 'p',
    businessEntity: 'x',
    projectState: 'draft',
    createdAt: NOW,
    updatedAt: NOW,
    sourceDefinitions: [
      {
        id: 'src',
        name: 'S.csv',
        sourceType: 'csv',
        location: { kind: 'localFile', path: 'S.csv' },
        datasets: [
          {
            id: 'ds',
            sourceId: 'src',
            name: 'S',
            displayName: 'S',
            fields: [
              {
                id: 'f-name',
                datasetId: 'ds',
                displayName: 'Name',
                datatype: 'string',
                length: 40,
              },
              {
                id: 'f-date',
                datasetId: 'ds',
                displayName: 'Valid From',
                datatype: 'string',
                length: 8,
              },
              { id: 'f-num', datasetId: 'ds', displayName: 'Amount', datatype: 'integer' },
              {
                id: 'f-blank',
                datasetId: 'ds',
                displayName: 'Region',
                datatype: 'string',
                length: 3,
              },
            ],
          },
        ],
      },
    ],
    targetDefinition: {
      id: 'tgt',
      name: 'T',
      structures: [
        {
          id: 'st',
          targetDefinitionId: 'tgt',
          name: 'PC',
          displayName: 'PC',
          fields: [
            {
              id: 't-name',
              targetStructureId: 'st',
              displayName: 'Name',
              datatype: 'string',
              length: 20,
              required: true,
              isKey: false,
            },
            {
              id: 't-desc',
              targetStructureId: 'st',
              displayName: 'Description',
              datatype: 'string',
              length: 40,
              required: false,
              isKey: false,
            },
            {
              id: 't-from',
              targetStructureId: 'st',
              displayName: 'Valid From',
              datatype: 'date',
              required: false,
              isKey: false,
            },
            {
              id: 't-amt',
              targetStructureId: 'st',
              displayName: 'Amount',
              datatype: 'decimal',
              required: false,
              isKey: false,
            },
            {
              id: 't-reg',
              targetStructureId: 'st',
              displayName: 'Region',
              datatype: 'string',
              length: 3,
              required: true,
              isKey: false,
            },
          ],
        },
      ],
    },
    mappingDefinition: {
      id: 'md',
      mappings: maps,
      relationships: [],
      routineReferences: [],
      lookupReferences: [],
      validationRules: [],
    },
    routines: [],
    lookups: [],
  });
}

const direct = (target: string, source: string, over: object = {}) => ({
  id: `m-${target}`,
  targetStructureId: 'st',
  targetFieldId: target,
  mappingType: 'direct',
  sourceReferences: [{ datasetId: 'ds', fieldId: source }],
  transformations: [],
  status: 'mapped',
  ...over,
});

describe('detectConflicts (SPEC-036 AC-4)', () => {
  it('finds nothing in clean mappings', () => {
    expect(detectConflicts(make([direct('t-desc', 'f-name'), direct('t-amt', 'f-num')]))).toEqual(
      [],
    );
  });

  it('flags a text source copied into a date target, and not a number into a decimal', () => {
    const c = detectConflicts(make([direct('t-from', 'f-date'), direct('t-amt', 'f-num')]));
    expect(c.map((x) => [x.kind, x.targetFieldIds[0]])).toEqual([['typeMismatch', 't-from']]);
    expect(c[0]!.message).toContain('Add a conversion step');
  });

  it('does not flag a type mismatch once a conversion step is there', () => {
    const withStep = direct('t-from', 'f-date', {
      transformations: [
        { order: 1, kind: 'routine', routineId: 'date.parse', configuration: {}, onError: 'stop' },
      ],
    });
    expect(detectConflicts(make([withStep])).filter((x) => x.kind === 'typeMismatch')).toEqual([]);
  });

  it('flags a longer source copied into a shorter target', () => {
    const c = detectConflicts(make([direct('t-name', 'f-name')]));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      kind: 'lengthOverflow',
      severity: 'warning',
      targetFieldIds: ['t-name'],
    });
    expect(c[0]!.message).toContain('can hold 40 characters but Name only 20');
  });

  it('flags one source that feeds several targets, as information', () => {
    const c = detectConflicts(make([direct('t-desc', 'f-name'), direct('t-name', 'f-name')]));
    const reuse = c.find((x) => x.kind === 'sourceReused')!;
    expect(reuse).toMatchObject({ severity: 'info', sourceFieldIds: ['f-name'] });
    expect(reuse.targetFieldIds.sort()).toEqual(['t-desc', 't-name']);
  });

  it('flags empty and partly blank source columns from the fill figures', () => {
    const maps = [direct('t-reg', 'f-blank'), direct('t-desc', 'f-name')];
    const c = detectConflicts(make(maps), { fill: { 'f-blank': 66.67, 'f-name': 0 } });
    const kinds = c.map((x) => `${x.kind}:${x.targetFieldIds[0]}`).sort();
    expect(kinds).toContain('sourceEmpty:t-reg');
    expect(kinds).toContain('sourceEmpty:t-desc');
    expect(c.find((x) => x.targetFieldIds[0] === 't-reg')!.message).toContain(
      'blank in 33.3% of the rows',
    );
    // fill figures that are not given (no rows loaded) give no such conflict
    expect(detectConflicts(make(maps)).filter((x) => x.kind === 'sourceEmpty')).toEqual([]);
  });

  it('flags a suggestion conflict for an unmapped target only, and groups conflicts by target', () => {
    const suggestion = {
      targetStructureId: 'st',
      targetFieldId: 't-desc',
      sourceFieldId: 'f-name',
      score: 0.7,
      conflict: { sourceFieldId: 'f-blank', score: 0.65, origin: 'ai' as const },
    };
    const c = detectConflicts(make([]), { suggestions: [suggestion] });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: 'suggestionDisagree', targetFieldIds: ['t-desc'] });
    expect(c[0]!.message).toContain('(70%)');
    expect(c[0]!.message).toContain('(65%, AI)');
    expect(
      detectConflicts(make([direct('t-desc', 'f-name')]), { suggestions: [suggestion] }).filter(
        (x) => x.kind === 'suggestionDisagree',
      ),
    ).toEqual([]);
    expect(conflictsByTarget(c).get('t-desc')).toHaveLength(1);
  });
});

describe('removeMappings (AC-4)', () => {
  it('removes several mappings in one edit and leaves the rest and the input alone', () => {
    const p = make([
      direct('t-desc', 'f-name'),
      direct('t-amt', 'f-num'),
      direct('t-reg', 'f-blank'),
    ]);
    const before = JSON.stringify(p);
    const r = removeMappings(
      p,
      [
        { structureId: 'st', fieldId: 't-desc' },
        { structureId: 'st', fieldId: 't-reg' },
        { structureId: 'st', fieldId: 't-from' },
      ],
      NOW,
    );
    expect(r.removed).toBe(2);
    expect(r.project.mappingDefinition.mappings.map((m) => m.targetFieldId)).toEqual(['t-amt']);
    expect(JSON.stringify(p)).toBe(before);
    expect(removeMappings(p, [], NOW)).toEqual({ project: p, removed: 0 });
  });
});
