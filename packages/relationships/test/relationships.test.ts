import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RelationshipSchema,
  SourceDatasetSchema,
  SourceRowsSchema,
  type Relationship,
  type Result,
  type SourceDataset,
  type SourceRows,
} from '@mms/mapping-core';
import { applyFieldDictionary, importCsv, importFieldDictionary } from '@mms/file-import';
import {
  analyzeRelationship,
  checkRelationship,
  confirmRelationship,
  rejectRelationship,
  suggestRelationships,
  type DatasetData,
} from '../src/index.js';

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

function table(
  id: string,
  headers: string[],
  rows: (string | null)[][],
  fieldOver: Record<string, object> = {},
): DatasetData {
  const dataset: SourceDataset = SourceDatasetSchema.parse({
    id: `ds-${id}`,
    sourceId: `src-${id}`,
    name: id,
    displayName: id,
    fields: headers.map((h) => ({
      id: `${id}.${h}`,
      datasetId: `ds-${id}`,
      displayName: h,
      datatype: 'unknown',
      ...(fieldOver[h] ?? {}),
    })),
  });
  const data: SourceRows = SourceRowsSchema.parse({
    datasetId: dataset.id,
    fieldIds: dataset.fields.map((f) => f.id),
    rows,
  });
  return { dataset, rows: data };
}
const rel = (
  l: DatasetData,
  r: DatasetData,
  pairs: [string, string][],
  over: Partial<Relationship> = {},
): Relationship =>
  RelationshipSchema.parse({
    id: 'rel-1',
    leftDatasetId: l.dataset.id,
    rightDatasetId: r.dataset.id,
    keys: pairs.map(([a, b]) => ({
      leftFieldId: `${l.dataset.name}.${a}`,
      rightFieldId: `${r.dataset.name}.${b}`,
    })),
    cardinality: 'oneToMany',
    joinType: 'left',
    status: 'confirmed',
    ...over,
  });

describe('relationship analysis (SPEC-006)', () => {
  const parent = table(
    'P',
    ['id', 'area', 'name'],
    [
      ['1', 'A', 'x'],
      ['2', 'A', 'y'],
      ['3', 'B', 'z'],
    ],
  );
  const child = table(
    'C',
    ['id', 'area', 'v'],
    [
      ['1', 'A', '10'],
      ['1', 'A', '11'],
      ['2', 'A', '12'],
      ['9', 'A', '13'],
    ],
  );
  const composite = rel(parent, child, [
    ['id', 'id'],
    ['area', 'area'],
  ]);

  it('composite keys: matching keys, unmatched rows and uniqueness', () => {
    const a = analyzeRelationship(composite, parent, child)!;
    expect(a).toMatchObject({
      leftRows: 3,
      rightRows: 4,
      leftDistinctKeys: 3,
      rightDistinctKeys: 3,
      matchingKeys: 2,
      leftUnmatchedRows: 1,
      rightUnmatchedRows: 1,
      leftKeyUnique: true,
      rightKeyUnique: false,
    });
    expect(a.observedCardinality).toBe('oneToMany');
  });

  it('a single key behaves the same way', () => {
    const a = analyzeRelationship(rel(parent, child, [['id', 'id']]), parent, child)!;
    expect(a.matchingKeys).toBe(2);
  });

  it.each([
    ['oneToOne', [['1'], ['2']], [['1'], ['2']]],
    ['oneToMany', [['1'], ['2']], [['1'], ['1']]],
    ['manyToOne', [['1'], ['1']], [['1'], ['2']]],
    ['manyToMany', [['1'], ['1']], [['1'], ['1']]],
  ])('observed cardinality %s', (expected, l, r) => {
    const a = table('A', ['k'], l as string[][]);
    const b = table('B', ['k'], r as string[][]);
    expect(analyzeRelationship(rel(a, b, [['k', 'k']]), a, b)!.observedCardinality).toBe(expected);
  });

  it('rows with a blank key part never match and are counted', () => {
    const a = table(
      'A',
      ['k', 'j'],
      [
        ['1', 'x'],
        [null, 'x'],
        ['2', ''],
      ],
    );
    const b = table('B', ['k', 'j'], [['1', 'x']]);
    const x = analyzeRelationship(
      rel(a, b, [
        ['k', 'k'],
        ['j', 'j'],
      ]),
      a,
      b,
    )!;
    expect(x).toMatchObject({ leftBlankKeyRows: 2, leftDistinctKeys: 1, matchingKeys: 1 });
  });

  it('returns undefined for an unknown key field', () => {
    const bad = rel(parent, child, [['id', 'id']], {
      keys: [{ leftFieldId: 'nope' as never, rightFieldId: 'C.id' as never }],
    });
    expect(analyzeRelationship(bad, parent, child)).toBeUndefined();
  });

  it('one dataset can take part in several relationships', () => {
    const third = table('T', ['id'], [['1']]);
    const r1 = rel(parent, child, [['id', 'id']], { id: 'r1' as never });
    const r2 = rel(parent, third, [['id', 'id']], { id: 'r2' as never });
    expect(analyzeRelationship(r1, parent, child)).toBeDefined();
    expect(analyzeRelationship(r2, parent, third)).toBeDefined();
    expect([r1, r2].every((r) => r.leftDatasetId === parent.dataset.id)).toBe(true);
  });

  it('relationships serialize and come back equal (all cardinalities, join types and statuses)', () => {
    for (const cardinality of ['oneToOne', 'oneToMany', 'manyToOne', 'manyToMany'] as const) {
      for (const joinType of ['inner', 'left'] as const) {
        const r = rel(
          parent,
          child,
          [
            ['id', 'id'],
            ['area', 'area'],
          ],
          { cardinality, joinType, status: 'suggested' },
        );
        expect(RelationshipSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
      }
    }
  });

  it('confirm and reject return new objects and keep everything else', () => {
    const s = rel(parent, child, [['id', 'id']], { status: 'suggested' });
    expect(confirmRelationship(s)).toEqual({ ...s, status: 'confirmed' });
    expect(rejectRelationship(s)).toEqual({ ...s, status: 'rejected' });
    expect(s.status).toBe('suggested');
  });
});

describe('relationship checks', () => {
  const p = table('P', ['id', 'n'], [['1', '5']], {
    id: { datatype: 'string' },
    n: { datatype: 'integer' },
  });
  const c = table('C', ['id', 'n'], [['1', '5']], {
    id: { datatype: 'integer' },
    n: { datatype: 'integer' },
  });
  const codes = (r: Relationship, data = true) =>
    checkRelationship(r, [p.dataset, c.dataset], data ? { left: p, right: c } : undefined).map(
      (d) => d.code,
    );

  it('a valid relationship has no issues', () => {
    expect(codes(rel(p, c, [['n', 'n']], { cardinality: 'oneToOne' }))).toEqual([]);
  });

  it('invalid key references return diagnostics with a path', () => {
    const bad = rel(p, c, [['id', 'id']], {
      keys: [{ leftFieldId: 'P.zzz' as never, rightFieldId: 'C.id' as never }],
    });
    const d = checkRelationship(bad, [p.dataset, c.dataset]);
    expect(d[0]).toMatchObject({
      severity: 'error',
      code: 'RELATIONSHIP_UNKNOWN_FIELD',
      path: 'keys[0].leftFieldId',
    });
  });

  it('unknown datasets are errors', () => {
    const bad = rel(p, c, [['id', 'id']], { rightDatasetId: 'ds-none' as never });
    expect(checkRelationship(bad, [p.dataset, c.dataset]).map((d) => d.code)).toContain(
      'RELATIONSHIP_UNKNOWN_DATASET',
    );
  });

  it('a repeated key pair is an error', () => {
    expect(
      codes(
        rel(p, c, [
          ['id', 'id'],
          ['id', 'id'],
        ]),
        false,
      ),
    ).toContain('RELATIONSHIP_DUPLICATE_KEY');
  });

  it('many-to-many and datatype mismatch are warnings', () => {
    const d = checkRelationship(rel(p, c, [['id', 'id']], { cardinality: 'manyToMany' }), [
      p.dataset,
      c.dataset,
    ]);
    expect(d.map((x) => [x.severity, x.code])).toEqual([
      ['warning', 'RELATIONSHIP_DATATYPE_MISMATCH'],
      ['warning', 'RELATIONSHIP_MANY_TO_MANY'],
    ]);
  });

  it('data checks: no matching values, blank keys, declared cardinality differs from the data', () => {
    const a = table('A', ['k'], [['1'], ['1'], [null]]);
    const b = table('B', ['k'], [['2']]);
    const d = checkRelationship(
      rel(a, b, [['k', 'k']], { cardinality: 'oneToOne' }),
      [a.dataset, b.dataset],
      { left: a, right: b },
    ).map((x) => x.code);
    expect(d).toEqual([
      'RELATIONSHIP_NO_MATCHING_VALUES',
      'RELATIONSHIP_BLANK_KEYS',
      'RELATIONSHIP_CARDINALITY_MISMATCH',
    ]);
  });
});

describe('relationship suggestions (humans confirm)', () => {
  const base = new URL('../../../test-data/profit-center/', import.meta.url);
  const load = () => {
    const dict = ok(
      importFieldDictionary(readFileSync(new URL('input/field_dictionary.csv', base), 'utf8')),
    ).dictionary;
    return ['CEPC.csv', 'CEPCT.csv', 'CEPC_BUKRS.csv'].map((f) => {
      const i = ok(importCsv(readFileSync(new URL(`input/${f}`, base), 'utf8'), { fileName: f }));
      return {
        dataset: applyFieldDictionary(i.source, dict).source.datasets[0]!,
        rows: i.rows[0]!,
      };
    });
  };
  const byId = (s: ReturnType<typeof suggestRelationships>, id: string) =>
    s.find((x) => x.relationship.id === id)!;

  it('Profit Center files: CEPC relates to CEPCT and to CEPC_BUKRS on composite keys, status suggested', () => {
    const s = suggestRelationships(load());
    expect(s.map((x) => x.relationship.id)).toEqual([
      'rel-CEPC-CEPCT',
      'rel-CEPC-CEPC_BUKRS',
      'rel-CEPCT-CEPC_BUKRS',
    ]);
    const ct = byId(s, 'rel-CEPC-CEPCT').relationship;
    const names = (r: Relationship, ds: SourceDataset) =>
      r.keys.map((k) => ds.fields.find((f) => f.id === k.leftFieldId)!.technicalName);
    expect(names(ct, load()[0]!.dataset)).toEqual(expect.arrayContaining(['PRCTR', 'KOKRS']));
    expect(ct.keys.length).toBeGreaterThanOrEqual(2);
    for (const x of s) {
      expect(x.relationship.status).toBe('suggested');
      expect(RelationshipSchema.safeParse(x.relationship).success).toBe(true);
      expect(x.evidence.length).toBeGreaterThan(0);
    }
  });

  it('CEPC takes part in two suggested relationships', () => {
    const s = suggestRelationships(load());
    expect(s.filter((x) => x.relationship.leftDatasetId === 'ds-CEPC')).toHaveLength(2);
  });

  it('warns about the data problems in the sample: no shared key values and blank client keys', () => {
    const s = suggestRelationships(load());
    expect(byId(s, 'rel-CEPC-CEPCT').diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['RELATIONSHIP_NO_MATCHING_VALUES', 'RELATIONSHIP_BLANK_KEYS']),
    );
  });

  it('generic files without a dictionary: display names and value overlap are enough', () => {
    const orders = table(
      'Orders',
      ['Order No', 'Customer'],
      [
        ['1', 'A'],
        ['2', 'A'],
        ['3', 'B'],
      ],
    );
    const lines = table(
      'Lines',
      ['Order No', 'Item'],
      [
        ['1', 'x'],
        ['1', 'y'],
        ['2', 'z'],
      ],
    );
    const [s] = suggestRelationships([orders, lines]);
    expect(s!.relationship).toMatchObject({
      leftDatasetId: 'ds-Orders',
      rightDatasetId: 'ds-Lines',
      cardinality: 'oneToMany',
      status: 'suggested',
    });
    expect(s!.relationship.keys).toEqual([
      { leftFieldId: 'Orders.Order No', rightFieldId: 'Lines.Order No' },
    ]);
    expect(s!.evidence).toEqual(['same display name "Order No"', '2 shared value(s)']);
    expect(s!.diagnostics).toEqual([]);
  });

  it('unrelated datasets produce no suggestion', () => {
    expect(suggestRelationships([table('A', ['x'], [['1']]), table('B', ['y'], [['1']])])).toEqual(
      [],
    );
  });

  it('a single-valued field is left out unless both sides mark it a key', () => {
    const a = table(
      'A',
      ['id', 'country'],
      [
        ['1', 'FI'],
        ['2', 'FI'],
      ],
    );
    const b = table('B', ['id', 'country'], [['1', 'FI']]);
    const [s] = suggestRelationships([a, b]);
    expect(s!.relationship.keys.map((k) => k.leftFieldId)).toEqual(['A.id']);
    const ak = table(
      'A',
      ['id', 'country'],
      [
        ['1', 'FI'],
        ['2', 'FI'],
      ],
      { country: { isKey: true }, id: { isKey: true } },
    );
    const bk = table('B', ['id', 'country'], [['1', 'FI']], {
      country: { isKey: true },
      id: { isKey: true },
    });
    expect(suggestRelationships([ak, bk])[0]!.relationship.keys.map((k) => k.leftFieldId)).toEqual([
      'A.id',
      'A.country',
    ]);
  });

  it('many-to-many suggestions carry a warning', () => {
    const a = table('A', ['k'], [['1'], ['1']]);
    const b = table('B', ['k'], [['1'], ['1']]);
    expect(suggestRelationships([a, b])[0]!.diagnostics.map((d) => d.code)).toContain(
      'RELATIONSHIP_MANY_TO_MANY',
    );
  });

  it('is deterministic and does not change its input', () => {
    const data = load();
    const before = JSON.stringify(data);
    expect(suggestRelationships(data)).toEqual(suggestRelationships(data));
    expect(JSON.stringify(data)).toBe(before);
  });
});
