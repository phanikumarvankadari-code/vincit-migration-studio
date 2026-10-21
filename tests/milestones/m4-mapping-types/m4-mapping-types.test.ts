import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deserializeProject,
  parseProject,
  serializeProject,
  type Project,
  type Result,
  type SourceRows,
} from '@mms/mapping-core';
import { importCsv, importXlsx } from '@mms/file-import';
import { confirmRelationship, suggestRelationships } from '@mms/relationships';
import { detectTargetLayout, parseTargetStructures } from '@mms/target-parser';
import { executeMapping } from '@mms/transformation-engine';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

const CEPC = [
  'Profit Center,Valid To,Valid From,Country',
  'P100,12/31/99,1/1/26,FI',
  'P200,12/31/99,5/1/26,SE',
  'P300,12/31/99,1/1/26,NO',
].join('\n');
const BUKRS = [
  'Profit Center,Company Code',
  'P100,FI01',
  'P100,FI02',
  'P100,SE01',
  'P300,NO01',
].join('\n');

/**
 * M4 demo check: one Profit Center produces several Company Code rows, and lookup, constant and
 * conditional mappings give correct values. Built from the real importers, relationship suggestions and
 * the real target workbook.
 */
describe('M4 mapping types', () => {
  const imported = [
    importCsv(CEPC, { fileName: 'CEPC.csv' }),
    importCsv(BUKRS, { fileName: 'CEPC_BUKRS.csv' }),
  ].map(ok);
  const sources = imported.map((i) => i.source);
  const rows: SourceRows[] = imported.map((i) => i.rows[0]!);
  const suggested = suggestRelationships(
    imported.map((i) => ({ dataset: i.source.datasets[0]!, rows: i.rows[0]! })),
  );
  const rel = suggested[0]!.relationship;

  const workbook = ok(
    importXlsx(new Uint8Array(readFileSync(new URL('target/data_pc.XLSX', base))), {
      fileName: 'data_pc.XLSX',
      headerRow: 4,
    }),
  );
  const parsed = ok(
    parseTargetStructures(workbook, ok(detectTargetLayout(workbook)).layout, {
      name: 'Profit Center',
    }),
  ).target;
  const structure = (name: string) => parsed.structures.find((s) => s.name === name)!;
  const tfield = (s: string, f: string) =>
    structure(s).fields.find((x) => x.displayName === f)!.id as string;
  const sfield = (ds: string, f: string) =>
    sources
      .flatMap((s) => s.datasets)
      .find((d) => d.name === ds)!
      .fields.find((x) => x.displayName === f)!.id as string;
  const sref = (ds: string, f: string) => ({ datasetId: `ds-${ds}`, fieldId: sfield(ds, f) });
  const mapping = (id: string, s: string, f: string, refs: object[], rest: object) => ({
    id,
    targetStructureId: structure(s).id,
    targetFieldId: tfield(s, f),
    sourceReferences: refs,
    transformations: [],
    status: 'mapped',
    ...rest,
  });

  const projectRaw = (relationship = confirmRelationship(rel)) => ({
    id: 'p1',
    name: 'Profit Center migration',
    businessEntity: 'ProfitCenter',
    projectState: 'draft',
    createdAt: '2026-10-21T12:00:00.000Z',
    updatedAt: '2026-10-21T12:00:00.000Z',
    sourceDefinitions: sources,
    targetDefinition: {
      ...parsed,
      structures: parsed.structures.map((s) =>
        s.name === 'Profit Center'
          ? { ...s, generation: { driverDatasetId: 'ds-CEPC' } }
          : s.name === 'Company Codes'
            ? {
                ...s,
                generation: {
                  driverDatasetId: 'ds-CEPC_BUKRS',
                  viaRelationshipIds: [relationship.id],
                },
                parent: {
                  parentStructureId: structure('Profit Center').id,
                  keys: [
                    {
                      childFieldId: tfield('Company Codes', 'Profit Center'),
                      parentFieldId: tfield('Profit Center', 'Profit Center'),
                    },
                  ],
                },
              }
            : s,
      ),
    },
    routines: [],
    lookups: [
      {
        id: 'lk-region',
        name: 'Country to Region',
        keyDatatype: 'string',
        valueDatatype: 'string',
        entries: [
          { key: 'FI', value: '18' },
          { key: 'SE', value: '14' },
        ],
      },
    ],
    mappingDefinition: {
      id: 'md1',
      relationships: [relationship],
      routineReferences: [],
      lookupReferences: [{ lookupId: 'lk-region' }],
      validationRules: [],
      mappings: [
        mapping('m1', 'Profit Center', 'Profit Center', [sref('CEPC', 'Profit Center')], {
          mappingType: 'direct',
        }),
        mapping('m2', 'Profit Center', 'Valid To', [sref('CEPC', 'Valid To')], {
          mappingType: 'direct',
        }),
        mapping('m3', 'Profit Center', 'Language Key', [], {
          mappingType: 'constant',
          constant: { datatype: 'string', value: 'EN' },
        }),
        mapping('m4', 'Profit Center', 'Region', [sref('CEPC', 'Country')], {
          mappingType: 'lookup',
          lookup: { lookupId: 'lk-region', configuration: {}, missingValue: { kind: 'error' } },
        }),
        mapping('m5', 'Profit Center', 'Standard Hierarchy Node', [sref('CEPC', 'Country')], {
          mappingType: 'conditional',
          conditional: {
            rules: [
              {
                when: {
                  op: 'compare',
                  operator: 'eq',
                  left: { kind: 'current' },
                  right: { kind: 'constant', constant: { datatype: 'string', value: 'FI' } },
                },
                then: { kind: 'constant', constant: { datatype: 'string', value: 'H-FI' } },
              },
            ],
            otherwise: { kind: 'constant', constant: { datatype: 'string', value: 'H-OTHER' } },
          },
        }),
        mapping('m6', 'Company Codes', 'Profit Center', [sref('CEPC_BUKRS', 'Profit Center')], {
          mappingType: 'direct',
        }),
        mapping('m7', 'Company Codes', 'Validty End Date', [sref('CEPC', 'Valid To')], {
          mappingType: 'direct',
        }),
        mapping('m8', 'Company Codes', 'Company Code', [sref('CEPC_BUKRS', 'Company Code')], {
          mappingType: 'direct',
        }),
      ],
    },
  });
  const load = (relationship?: Parameters<typeof projectRaw>[0]): Project =>
    ok(parseProject(projectRaw(relationship)));
  const run = (p: Project, options = {}) => ok(executeMapping(p, rows, options));
  const out = (r: ReturnType<typeof run>, name: string) =>
    r.targets.find((t) => t.rows.targetStructureId === structure(name).id)!;
  const col = (name: string, field: string) =>
    structure(name).fields.findIndex((f) => f.displayName === field);

  it('M4-01 direct, constant and conditional mappings give the right values', () => {
    const t = out(run(load()), 'Profit Center');
    expect(t.rows.rows.map((r) => r[col('Profit Center', 'Profit Center')])).toEqual([
      'P100',
      'P200',
      'P300',
    ]);
    expect(t.rows.rows.map((r) => r[col('Profit Center', 'Valid To')])).toEqual([
      '12/31/99',
      '12/31/99',
      '12/31/99',
    ]);
    expect(t.rows.rows.map((r) => r[col('Profit Center', 'Language Key')])).toEqual([
      'EN',
      'EN',
      'EN',
    ]);
    expect(t.rows.rows.map((r) => r[col('Profit Center', 'Standard Hierarchy Node')])).toEqual([
      'H-FI',
      'H-OTHER',
      'H-OTHER',
    ]);
    expect(t.rows.rows[0]![col('Profit Center', 'Segment')]).toBeNull(); // unmapped stays blank
  });

  it('M4-02 lookup resolves existing keys; a missing key is an error on that row only', () => {
    const r = run(load());
    const t = out(r, 'Profit Center');
    expect(t.rows.rows.map((x) => x[col('Profit Center', 'Region')])).toEqual(['18', '14', null]);
    expect(t.rowStatus).toEqual(['ready', 'ready', 'error']);
    const problems = r.diagnostics.filter((d) => d.severity !== 'info');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: 'ENGINE_LOOKUP_MISSING',
      sourceRow: 3,
      sourceValue: 'NO',
      targetRow: 3,
    });
  });

  it('M4-03 one Profit Center produces several Company Code rows, keeping the parent key', () => {
    const t = out(run(load()), 'Company Codes');
    const rowsOut = t.rows.rows.map((r) => [
      r[col('Company Codes', 'Profit Center')],
      r[col('Company Codes', 'Company Code')],
    ]);
    expect(rowsOut).toEqual([
      ['P100', 'FI01'],
      ['P100', 'FI02'],
      ['P100', 'SE01'],
      ['P300', 'NO01'],
    ]);
    expect(t.rows.rows.map((r) => r[col('Company Codes', 'Validty End Date')])).toEqual([
      '12/31/99',
      '12/31/99',
      '12/31/99',
      '12/31/99',
    ]);
  });

  it('M4-04 lineage traces a generated value back through the join to the parent row', () => {
    const r = run(load(), { collectLineage: true });
    const cell = out(r, 'Company Codes').lineage![2]![col('Company Codes', 'Validty End Date')]!;
    expect(cell.sources).toEqual([
      {
        datasetId: 'ds-CEPC',
        fieldId: sfield('CEPC', 'Valid To'),
        sourceRow: 1,
        value: '12/31/99',
      },
    ]);
  });

  it('M4-05 a suggested (unconfirmed) relationship is not used, so the human confirmation matters', () => {
    expect(rel.status).toBe('suggested');
    const r = run(load(rel));
    expect(r.diagnostics.map((d) => d.code)).toContain('ENGINE_NO_JOIN_PATH');
    expect(
      out(r, 'Company Codes').rows.rows.map((x) => x[col('Company Codes', 'Validty End Date')]),
    ).toEqual([null, null, null, null]);
  });

  it('M4-06 structures without mappings are reported, not silently empty', () => {
    const r = run(load());
    expect(out(r, 'Translation').rows.rows).toEqual([]);
    expect(r.diagnostics.some((d) => d.code === 'ENGINE_STRUCTURE_NOT_MAPPED')).toBe(true);
  });

  it('M4-07 a saved and reloaded project gives the identical result (constants and lookups survive)', () => {
    const p = load();
    const back = ok(deserializeProject(serializeProject(p)));
    expect(run(back, { collectLineage: true })).toEqual(run(p, { collectLineage: true }));
  });

  it('M4-08 run counts and a test run limit', () => {
    const r = run(load());
    expect(r.inputRecordCounts).toEqual({ 'ds-CEPC': 3, 'ds-CEPC_BUKRS': 4 });
    expect(r.outputRecordCounts[structure('Profit Center').id]).toBe(3);
    expect(r.outputRecordCounts[structure('Company Codes').id]).toBe(4);
    expect(out(run(load(), { limit: 1 }), 'Profit Center').rows.rows).toHaveLength(1);
  });
});
