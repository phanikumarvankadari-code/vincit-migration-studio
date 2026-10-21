import { describe, expect, it } from 'vitest';
import { ProjectSchema, SourceRowsSchema, type Project, type SourceRows } from '@mms/mapping-core';
import { suggestMappings } from '../src/index.js';

const NOW = '2026-10-22T10:00:00.000Z';

function project(over: { mappings?: object[] } = {}): Project {
  return ProjectSchema.parse({
    id: 'p',
    name: 'p',
    businessEntity: 'Profit Center',
    projectState: 'draft',
    createdAt: NOW,
    updatedAt: NOW,
    sourceDefinitions: [
      {
        id: 'src-1',
        name: 'CEPC.csv',
        sourceType: 'csv',
        location: { kind: 'localFile', path: 'CEPC.csv' },
        datasets: [
          {
            id: 'ds-1',
            sourceId: 'src-1',
            name: 'CEPC',
            displayName: 'CEPC',
            fields: [
              {
                id: 'f1',
                datasetId: 'ds-1',
                displayName: 'Profit Center',
                technicalName: 'PRCTR',
                datatype: 'string',
                length: 10,
                isKey: true,
              },
              {
                id: 'f2',
                datasetId: 'ds-1',
                displayName: 'Country',
                datatype: 'string',
                length: 3,
              },
              {
                id: 'f3',
                datasetId: 'ds-1',
                displayName: 'Region Code',
                datatype: 'string',
                length: 3,
              },
              {
                id: 'f4',
                datasetId: 'ds-1',
                displayName: 'Responsible User',
                datatype: 'string',
                length: 12,
              },
            ],
          },
        ],
      },
    ],
    targetDefinition: {
      id: 'tgt-1',
      name: 'S/4',
      structures: [
        {
          id: 'st-1',
          targetDefinitionId: 'tgt-1',
          name: 'Profit Center',
          displayName: 'Profit Center',
          fields: [
            {
              id: 'tf1',
              targetStructureId: 'st-1',
              displayName: 'Profit Center',
              technicalName: 'PRCTR',
              datatype: 'string',
              length: 10,
              required: true,
              isKey: true,
            },
            {
              id: 'tf2',
              targetStructureId: 'st-1',
              displayName: 'Country',
              datatype: 'string',
              length: 3,
              required: false,
              isKey: false,
            },
            {
              id: 'tf3',
              targetStructureId: 'st-1',
              displayName: 'Region',
              datatype: 'string',
              required: false,
              isKey: false,
            },
            {
              id: 'tf4',
              targetStructureId: 'st-1',
              displayName: 'Planet Of Origin',
              datatype: 'string',
              required: false,
              isKey: false,
            },
          ],
        },
      ],
    },
    mappingDefinition: {
      id: 'md',
      mappings: over.mappings ?? [],
      relationships: [],
      routineReferences: [],
      lookupReferences: [],
      validationRules: [],
    },
    routines: [],
    lookups: [],
  });
}

describe('suggestMappings (SPEC-031)', () => {
  it('AC-1 proposes the matching source with reasons, and none for a target that is already mapped', () => {
    const all = suggestMappings(project());
    const byTarget = Object.fromEntries(all.map((s) => [s.targetFieldId, s]));
    expect(byTarget['tf1']).toMatchObject({ sourceFieldId: 'f1', datasetId: 'ds-1' });
    expect(byTarget['tf1']!.reasons).toContain('same technical name PRCTR');
    expect(byTarget['tf1']!.reasons).toContain('key on both sides');
    expect(byTarget['tf2']).toMatchObject({ sourceFieldId: 'f2' });
    expect(byTarget['tf2']!.reasons[0]).toBe('same name "Country"');
    expect(byTarget['tf3']).toMatchObject({ sourceFieldId: 'f3' }); // "Region" shares a word with "Region Code"
    expect(byTarget['tf3']!.reasons).toContain('the names share words');

    const mapped = suggestMappings(
      project({
        mappings: [
          {
            id: 'm-tf2',
            targetStructureId: 'st-1',
            targetFieldId: 'tf2',
            mappingType: 'direct',
            sourceReferences: [{ datasetId: 'ds-1', fieldId: 'f2' }],
            transformations: [],
            status: 'mapped',
          },
        ],
      }),
    );
    expect(mapped.find((s) => s.targetFieldId === 'tf2')).toBeUndefined();
  });

  it('AC-2 gives no suggestion for a target with no similar source', () => {
    expect(suggestMappings(project()).find((s) => s.targetFieldId === 'tf4')).toBeUndefined();
  });

  it('AC-3 an empty source column scores lower than the same match on a filled one', () => {
    const rows = (blank: boolean): Record<string, SourceRows> => ({
      'ds-1': SourceRowsSchema.parse({
        datasetId: 'ds-1',
        fieldIds: ['f1', 'f2', 'f3', 'f4'],
        rows: [['P1', blank ? '' : 'FI', 'X', 'u']],
      }),
    });
    const filled = suggestMappings(project(), { data: rows(false) }).find(
      (s) => s.targetFieldId === 'tf2',
    )!;
    const empty = suggestMappings(project(), { data: rows(true), minScore: 0 }).find(
      (s) => s.targetFieldId === 'tf2',
    )!;
    expect(empty.score).toBeLessThan(filled.score);
    expect(empty.reasons).toContain('the source column is empty in the loaded rows');
    // below the default minimum, so it is not offered at all
    expect(
      suggestMappings(project(), { data: rows(true) }).find((s) => s.targetFieldId === 'tf2'),
    ).toBeUndefined();
  });

  it('AC-4 is deterministic, limited to a structure on request, and empty without a target', () => {
    expect(suggestMappings(project())).toEqual(suggestMappings(project()));
    expect(suggestMappings(project(), { structureId: 'nope' })).toEqual([]);
    const noTarget = { ...project(), targetDefinition: undefined } as Project;
    expect(suggestMappings(noTarget)).toEqual([]);
  });

  it('scores are between 0 and 1 and alternatives never repeat the best source', () => {
    for (const s of suggestMappings(project(), { minScore: 0.1 })) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.alternatives.every((a) => a.sourceFieldId !== s.sourceFieldId)).toBe(true);
      expect(s.alternatives.length).toBeLessThanOrEqual(2);
    }
  });
});
