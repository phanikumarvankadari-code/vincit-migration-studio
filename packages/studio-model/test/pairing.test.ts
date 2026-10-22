import { describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '@mms/mapping-core';
import { clearDriver, pairViews, scopeOf, setDriver } from '../src/index.js';

const NOW = '2026-10-22T10:00:00.000Z';
const LATER = '2026-10-22T11:00:00.000Z';

function make(rels: object[] = [], maps: object[] = []): Project {
  const ds = (id: string) => ({
    id,
    sourceId: 'src',
    name: id,
    displayName: id,
    fields: [{ id: `${id}-f`, datasetId: id, displayName: 'F', datatype: 'string' }],
  });
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
        name: 'S',
        sourceType: 'csv',
        location: { kind: 'localFile', path: 'S.csv' },
        datasets: [ds('A'), ds('B'), ds('C')],
      },
    ],
    targetDefinition: {
      id: 'tgt',
      name: 'T',
      structures: [
        {
          id: 'st',
          targetDefinitionId: 'tgt',
          name: 'One',
          displayName: 'One',
          fields: [
            {
              id: 't1',
              targetStructureId: 'st',
              displayName: 'T1',
              datatype: 'string',
              required: false,
              isKey: false,
            },
          ],
          parent: { parentStructureId: 'st2', keys: [{ childFieldId: 't1', parentFieldId: 'u1' }] },
        },
        {
          id: 'st2',
          targetDefinitionId: 'tgt',
          name: 'Two',
          displayName: 'Two',
          fields: [
            {
              id: 'u1',
              targetStructureId: 'st2',
              displayName: 'U1',
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
      mappings: maps,
      relationships: rels,
      routineReferences: [],
      lookupReferences: [],
      validationRules: [],
    },
    routines: [],
    lookups: [],
  });
}
const rel = (id: string, l: string, r: string, status: string) => ({
  id,
  leftDatasetId: l,
  rightDatasetId: r,
  keys: [{ leftFieldId: `${l}-f`, rightFieldId: `${r}-f` }],
  cardinality: 'oneToMany',
  joinType: 'left',
  status,
});
const map = (target: string, ds: string) => ({
  id: `m-${target}`,
  targetStructureId: 'st',
  targetFieldId: target,
  mappingType: 'direct',
  sourceReferences: [{ datasetId: ds, fieldId: `${ds}-f` }],
  transformations: [],
  status: 'mapped',
});

describe('pairing (SPEC-037)', () => {
  it('sets and clears the driver, keeps the parent link, and leaves the input alone', () => {
    const p = make();
    const before = JSON.stringify(p);
    const paired = setDriver(p, 'st', 'A', LATER);
    expect(paired.targetDefinition!.structures[0]!.generation).toEqual({ driverDatasetId: 'A' });
    expect(paired.targetDefinition!.structures[0]!.parent?.parentStructureId).toBe('st2');
    expect(paired.updatedAt).toBe(LATER);
    expect(JSON.stringify(p)).toBe(before);
    const changed = setDriver(paired, 'st', 'B', LATER);
    expect(changed.targetDefinition!.structures[0]!.generation).toEqual({ driverDatasetId: 'B' });
    const cleared = clearDriver(changed, 'st', LATER);
    expect(cleared.targetDefinition!.structures[0]!.generation).toBeUndefined();
    expect(cleared.targetDefinition!.structures[0]!.parent).toBeDefined();
    expect(setDriver(p, 'nope', 'A', LATER)).toBe(p);
  });

  it('shows the driver, the datasets joined to it, which joins are unconfirmed, and datasets read from elsewhere', () => {
    const p = setDriver(
      make(
        [
          rel('r1', 'A', 'B', 'confirmed'),
          rel('r2', 'C', 'A', 'suggested'),
          rel('r3', 'A', 'B', 'rejected'),
        ],
        [map('t1', 'A')],
      ),
      'st',
      'A',
      LATER,
    );
    const v = pairViews(p)[0]!;
    expect(v).toMatchObject({ structureId: 'st', driverDatasetId: 'A' });
    expect(v.helperDatasetIds.sort()).toEqual(['B', 'C']);
    expect(v.unconfirmedHelperIds).toEqual(['C']);
    expect(v.strayDatasetIds).toEqual([]);
    const stray = setDriver(make([], [map('t1', 'C')]), 'st', 'A', LATER);
    expect(pairViews(stray)[0]!.strayDatasetIds).toEqual(['C']);
    expect(pairViews(make())[1]).toMatchObject({
      driverDatasetId: undefined,
      helperDatasetIds: [],
    });
  });

  it('the scope of a structure is its driver and helpers, and undefined while it has no driver', () => {
    const p = make([rel('r1', 'A', 'B', 'confirmed')]);
    expect(scopeOf(p, 'st')).toBeUndefined();
    expect(scopeOf(setDriver(p, 'st', 'A', LATER), 'st')).toEqual(['A', 'B']);
  });
});
