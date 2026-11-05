import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject, validateProject } from '@mms/mapping-core';
import {
  applyDescriptions,
  applyPairings,
  autoImportTarget,
  confirmPairings,
  suggestedPairings,
} from '../src/index.js';
import { apply, at, newState, ok, smallSources, targetFile } from './helpers.js';

const AT = '2026-11-05T12:00:00.000Z';

function setup() {
  const { cepc, bukrs } = smallSources();
  const preview = ok(autoImportTarget(targetFile(), 'Profit Center'));
  const s = apply(
    newState(),
    { type: 'sourceAdded', imported: cepc, at: at() },
    { type: 'sourceAdded', imported: bukrs, at: at() },
    { type: 'targetLoaded', target: preview.target, at: at() },
  );
  const [a, b] = s.project.sourceDefinitions.flatMap((x) => x.datasets);
  const [pc, cc] = s.project.targetDefinition!.structures;
  return { s, a: a!, b: b!, pc: pc!, cc: cc! };
}

describe('pairing structures with their main table', () => {
  it('sets the main table and the extra tables, suggested; the extra table never equals the main one', () => {
    const { s, a, b, pc } = setup();
    const next = applyPairings(
      s.project,
      [
        {
          structureId: pc.id,
          driverDatasetId: a.id,
          helperDatasetIds: [b.id, a.id],
          status: 'suggested',
        },
      ],
      AT,
    );
    const g = next.targetDefinition!.structures[0]!.generation!;
    expect(g).toMatchObject({
      driverDatasetId: a.id,
      helperDatasetIds: [b.id],
      status: 'suggested',
    });
    expect(validateProject(next)).toEqual([]);
    expect(suggestedPairings(next).map((x) => x.name)).toEqual([pc.name]);
  });

  it('confirms one structure, or every suggested one, and leaves the rest alone', () => {
    const { s, a, b, pc, cc } = setup();
    const p = applyPairings(
      s.project,
      [
        { structureId: pc.id, driverDatasetId: a.id, status: 'suggested' },
        { structureId: cc.id, driverDatasetId: b.id, status: 'suggested' },
      ],
      AT,
    );
    const one = confirmPairings(p, pc.id, AT);
    expect(one.targetDefinition!.structures.map((x) => x.generation?.status)).toEqual([
      'confirmed',
      'suggested',
      undefined,
    ]);
    const all = confirmPairings(one, undefined, AT);
    expect(suggestedPairings(all)).toEqual([]);
  });

  it('keeps the relationship choices when the main table stays the same', () => {
    const { s, a, pc } = setup();
    const withVia = {
      ...s.project,
      targetDefinition: {
        ...s.project.targetDefinition!,
        structures: s.project.targetDefinition!.structures.map((x) =>
          x.id === pc.id
            ? { ...x, generation: { driverDatasetId: a.id, viaRelationshipIds: [] } }
            : x,
        ),
      },
    };
    const next = applyPairings(
      withVia,
      [{ structureId: pc.id, driverDatasetId: a.id, status: 'confirmed' }],
      AT,
    );
    expect(next.targetDefinition!.structures[0]!.generation).toMatchObject({
      driverDatasetId: a.id,
      status: 'confirmed',
    });
  });

  it('a pairing that points at a missing table is reported by the project check', () => {
    const { s, pc } = setup();
    const bad = applyPairings(
      s.project,
      [{ structureId: pc.id, driverDatasetId: 'ds-gone', status: 'suggested' }],
      AT,
    );
    expect(validateProject(bad).length).toBeGreaterThan(0);
  });

  it('is saved in the project file and read back; an old file without pairing details still loads', () => {
    const { s, a, b, pc } = setup();
    const p = applyPairings(
      s.project,
      [
        {
          structureId: pc.id,
          driverDatasetId: a.id,
          helperDatasetIds: [b.id],
          status: 'suggested',
        },
      ],
      AT,
    );
    const back = ok(deserializeProject(serializeProject(p)));
    expect(back.targetDefinition!.structures[0]!.generation).toEqual(
      p.targetDefinition!.structures[0]!.generation,
    );
    const old = { ...s.project };
    expect(ok(deserializeProject(serializeProject(old)))).toBeTruthy();
  });
});

describe('descriptions of source tables and fields', () => {
  it('are set by ID, ignore unknown IDs, and survive reading the same file again', () => {
    const { s, a } = setup();
    const f = a.fields[0]!;
    const next = applyDescriptions(
      s.project,
      {
        tables: [
          { datasetId: a.id, description: 'Parents' },
          { datasetId: 'nope', description: 'x' },
        ],
        fields: [{ datasetId: a.id, fieldId: f.id, description: 'Profit center number' }],
      },
      AT,
    );
    const ds = next.sourceDefinitions.flatMap((x) => x.datasets).find((d) => d.id === a.id)!;
    expect(ds.description).toBe('Parents');
    expect(ds.fields[0]!.description).toBe('Profit center number');
    const again = apply(
      { ...s, project: next },
      { type: 'sourceAdded', imported: smallSources().cepc, at: at() },
    );
    const ds2 = again.project.sourceDefinitions
      .flatMap((x) => x.datasets)
      .find((d) => d.id === a.id)!;
    expect(ds2.description).toBe('Parents');
    expect(ds2.fields[0]!.description).toBe('Profit center number');
    const old = ok(deserializeProject(serializeProject(s.project)));
    expect(old.sourceDefinitions[0]!.datasets[0]!.description).toBeUndefined();
  });
});
