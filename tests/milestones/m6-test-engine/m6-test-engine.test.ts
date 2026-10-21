import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MappingSnapshotSchema,
  parseProject,
  type Project,
  type Result,
  type SourceRows,
} from '@mms/mapping-core';
import { importCsv, importXlsx } from '@mms/file-import';
import { confirmRelationship, suggestRelationships } from '@mms/relationships';
import { createBuiltInRegistry } from '@mms/routine-library';
import { detectTargetLayout, parseTargetStructures } from '@mms/target-parser';
import {
  SAMPLE_PRESETS,
  diagnosticsForRow,
  rowOf,
  runTest,
  runTestOnSnapshot,
  type TestRunResult,
} from '@mms/test-engine';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

// 1,200 profit centers. Deliberate data problems (source rows are 1-based):
//   bad dates at rows 13, 601 and 1117, an unknown country at row 25,
//   a duplicate company-code row for P0010, and a company-code row whose profit center does not exist.
const N = 1200;
const BAD_DATES = new Set([13, 601, 1117]);
const cepcCsv = [
  'Profit Center,Valid To,Valid From,Country',
  ...Array.from({ length: N }, (_, i) => {
    const row = i + 1;
    const pc = `P${String(row).padStart(4, '0')}`;
    const from = BAD_DATES.has(row) ? '13/45/26' : row % 2 === 0 ? '5/1/26' : '1/1/26';
    return `${pc},12/31/99,${from},${row === 25 ? 'ZZ' : row % 3 === 0 ? 'SE' : 'FI'}`;
  }),
].join('\n');
const bukrsCsv = [
  'Profit Center,Company Code',
  'P0001,FI01',
  'P0001,FI02',
  'P0001,SE01',
  ...Array.from({ length: 599 }, (_, i) => `P${String(i + 2).padStart(4, '0')},FI01`),
  'P0010,FI01', // duplicate key
  'P9999,XX01', // no such profit center
].join('\n');

/**
 * M6 demo check: run 100 / 1,000 / all rows with no screen. Diagnostics show row, field and mapping.
 */
describe('M6 test engine', () => {
  const imported = [
    importCsv(cepcCsv, { fileName: 'CEPC.csv' }),
    importCsv(bukrsCsv, { fileName: 'CEPC_BUKRS.csv' }),
  ].map(ok);
  const rows: SourceRows[] = imported.map((i) => i.rows[0]!);
  const rel = suggestRelationships(
    imported.map((i) => ({ dataset: i.source.datasets[0]!, rows: i.rows[0]! })),
  )[0]!.relationship;
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
  const structure = (n: string) => parsed.structures.find((s) => s.name === n)!;
  const tf = (s: string, f: string) =>
    structure(s).fields.find((x) => x.displayName === f)!.id as string;
  const sf = (ds: string, f: string) =>
    imported
      .flatMap((i) => i.source.datasets)
      .find((d) => d.name === ds)!
      .fields.find((x) => x.displayName === f)!.id as string;
  const ref = (ds: string, f: string) => ({ datasetId: `ds-${ds}`, fieldId: sf(ds, f) });
  const m = (id: string, s: string, f: string, refs: object[], rest: object) => ({
    id,
    targetStructureId: structure(s).id,
    targetFieldId: tf(s, f),
    sourceReferences: refs,
    transformations: [],
    status: 'mapped',
    ...rest,
  });
  const step = (routineId: string, order: number, configuration: object) => ({
    kind: 'routine',
    routineId,
    configuration,
    order,
    onError: 'stop',
  });

  const project = (relationship = confirmRelationship(rel)): Project =>
    ok(
      parseProject({
        id: 'p1',
        name: 'Profit Center migration',
        businessEntity: 'ProfitCenter',
        projectState: 'draft',
        createdAt: '2026-10-21T12:00:00.000Z',
        updatedAt: '2026-10-21T12:00:00.000Z',
        sourceDefinitions: imported.map((i) => i.source),
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
                          childFieldId: tf('Company Codes', 'Profit Center'),
                          parentFieldId: tf('Profit Center', 'Profit Center'),
                        },
                      ],
                    },
                  }
                : s,
          ),
        },
        routines: [
          { id: 'date.parse', name: 'Parse Date', scope: 'builtIn', version: '1' },
          { id: 'date.format', name: 'Format Date', scope: 'builtIn', version: '1' },
        ],
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
          routineReferences: [
            { routineId: 'date.parse', version: '1' },
            { routineId: 'date.format', version: '1' },
          ],
          lookupReferences: [{ lookupId: 'lk-region' }],
          validationRules: [],
          mappings: [
            m('m1', 'Profit Center', 'Profit Center', [ref('CEPC', 'Profit Center')], {
              mappingType: 'direct',
            }),
            m('m2', 'Profit Center', 'Valid To', [ref('CEPC', 'Valid To')], {
              mappingType: 'direct',
            }),
            m('m3', 'Profit Center', 'Valid From', [ref('CEPC', 'Valid From')], {
              mappingType: 'routine',
              transformations: [
                step('date.parse', 0, { format: 'M/D/YY', twoDigitYearPivot: 68 }),
                step('date.format', 1, { format: 'YYYYMMDD' }),
              ],
            }),
            m('m4', 'Profit Center', 'Region', [ref('CEPC', 'Country')], {
              mappingType: 'lookup',
              lookup: { lookupId: 'lk-region', configuration: {}, missingValue: { kind: 'error' } },
            }),
            m('m5', 'Company Codes', 'Profit Center', [ref('CEPC_BUKRS', 'Profit Center')], {
              mappingType: 'direct',
            }),
            m('m6', 'Company Codes', 'Validty End Date', [ref('CEPC_BUKRS', 'Profit Center')], {
              mappingType: 'direct',
            }),
            m('m7', 'Company Codes', 'Company Code', [ref('CEPC_BUKRS', 'Company Code')], {
              mappingType: 'direct',
            }),
          ],
        },
      }),
    );

  let tick = 0;
  const now = () => `2026-10-21T13:00:${String(tick++ % 60).padStart(2, '0')}.000Z`;
  const go = (sample = SAMPLE_PRESETS.rows100, extra = {}): TestRunResult =>
    runTest(
      { runId: 'run-1', model: project(), data: rows, sample },
      { now, routines: createBuiltInRegistry(), ...extra },
    );
  const out = (r: TestRunResult, n: string) =>
    r.targets.find((t) => t.rows.targetStructureId === structure(n).id)!;
  const col = (n: string, f: string) => structure(n).fields.findIndex((x) => x.displayName === f);

  it('M6-01 runs 100 rows (the default sample), with counts and no screen', () => {
    const r = go();
    expect(r.run.outputRecordCounts[structure('Profit Center').id]).toBe(100);
    expect(r.structures.find((s) => s.name === 'Profit Center')).toMatchObject({
      driverRowCount: N,
      sampledRowCount: 100,
      rows: 100,
    });
    expect(r.run.inputRecordCounts).toEqual({ 'ds-CEPC': N, 'ds-CEPC_BUKRS': 604 });
  });

  it('M6-02 runs 1,000 rows and all rows', () => {
    expect(
      go(SAMPLE_PRESETS.rows1000).structures.find((s) => s.name === 'Profit Center')!.rows,
    ).toBe(1000);
    expect(go(SAMPLE_PRESETS.all).structures.find((s) => s.name === 'Profit Center')!.rows).toBe(N);
  });

  it('M6-03 "all rows" is refused when it is not safe', () => {
    const r = go(SAMPLE_PRESETS.all, { safeRowLimit: 1000 });
    expect(r.run.status).toBe('failed');
    expect(r.run.diagnostics.at(-1)).toMatchObject({
      code: 'TEST_ALL_NOT_SAFE',
      severity: 'error',
    });
  });

  it('M6-04 the sample decides which problems show: first 100 sees one bad date, 1,000 sees two, all sees three, spread sees all three', () => {
    const bad = (r: TestRunResult) =>
      r.run.diagnostics.filter((d) => d.code === 'DATE_INVALID').map((d) => d.sourceRow);
    expect(bad(go(SAMPLE_PRESETS.rows100))).toEqual([13]);
    expect(bad(go(SAMPLE_PRESETS.rows1000))).toEqual([13, 601]);
    expect(bad(go(SAMPLE_PRESETS.all))).toEqual([13, 601, 1117]);
    expect(bad(go({ kind: 'spread', count: 100 })).sort((a, b) => a! - b!)).toEqual([
      13, 601, 1117,
    ]);
  });

  it('M6-05 diagnostics show row, field, mapping and routine; errors do not hide successful rows', () => {
    const r = go(SAMPLE_PRESETS.all);
    const d = r.run.diagnostics.find((x) => x.code === 'DATE_INVALID' && x.sourceRow === 13)!;
    expect(d).toMatchObject({
      severity: 'error',
      targetStructureId: structure('Profit Center').id,
      targetFieldId: tf('Profit Center', 'Valid From'),
      fieldMappingId: 'm3',
      routineId: 'date.parse',
      sourceValue: '13/45/26',
      targetRow: 13,
    });
    expect(diagnosticsForRow(r.run.diagnostics, structure('Profit Center').id, 13)).toContain(d);
    expect(rowOf(d)).toEqual({ targetStructureId: structure('Profit Center').id, targetRow: 13 });
    const pc = out(r, 'Profit Center');
    expect(pc.rows.rows[12]![col('Profit Center', 'Valid From')]).toBeNull();
    expect(pc.rows.rows[0]![col('Profit Center', 'Valid From')]).toBe('20260101');
    expect(pc.rows.rows[1]![col('Profit Center', 'Valid From')]).toBe('20260501');
    expect(r.structures.find((s) => s.name === 'Profit Center')).toMatchObject({
      rows: N,
      error: 4,
    }); // 3 bad dates and 1 unknown country
  });

  it('M6-06 a diagnostics list collapses repeats and links back to rows', () => {
    const groups = go(SAMPLE_PRESETS.all).diagnosticGroups;
    const date = groups.find((g) => g.code === 'DATE_INVALID')!;
    expect(date).toMatchObject({
      severity: 'error',
      count: 3,
      firstTargetRow: 13,
      targetFieldId: tf('Profit Center', 'Valid From'),
    });
    expect(groups.find((g) => g.code === 'ENGINE_LOOKUP_MISSING')).toMatchObject({
      count: 1,
      firstTargetRow: 25,
    });
    expect(groups.map((g) => g.severity)).toEqual(
      [...groups.map((g) => g.severity)].sort(
        (a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b),
      ),
    );
  });

  it('M6-07 key checks: duplicate target key and missing parent are found when everything is run', () => {
    const r = go(SAMPLE_PRESETS.all);
    const dup = r.run.diagnostics.find((d) => d.code === 'TARGET_DUPLICATE_KEY')!;
    expect(dup).toMatchObject({
      severity: 'error',
      targetStructureId: structure('Company Codes').id,
      targetRow: 603,
    });
    expect(dup.message).toContain('(P0010, P0010, FI01)');
    const missing = r.run.diagnostics.find((d) => d.code === 'TARGET_PARENT_MISSING')!;
    expect(missing).toMatchObject({
      severity: 'error',
      targetStructureId: structure('Company Codes').id,
      targetRow: 604,
    });
    expect(out(r, 'Company Codes').rowStatus.filter((s) => s === 'error')).toHaveLength(2);
  });

  it('M6-08 with only a sample of the parent structure, parent links are not checked and this is said', () => {
    const r = go(SAMPLE_PRESETS.rows100);
    expect(r.run.diagnostics.some((d) => d.code === 'TARGET_PARENT_MISSING')).toBe(false);
    expect(r.run.diagnostics.find((d) => d.code === 'TARGET_PARENT_CHECK_SKIPPED')).toMatchObject({
      severity: 'info',
    });
  });

  it('M6-09 pre-flight warns once about unmapped required fields, not once per row', () => {
    const r = go();
    const unmapped = r.preflight.filter(
      (d) =>
        d.targetStructureId === structure('Profit Center').id &&
        (d.code === 'TEST_REQUIRED_UNMAPPED' || d.code === 'TEST_KEY_UNMAPPED'),
    );
    expect(unmapped.map((d) => d.code)).toEqual([
      'TEST_REQUIRED_UNMAPPED',
      'TEST_REQUIRED_UNMAPPED',
      'TEST_REQUIRED_UNMAPPED',
      'TEST_REQUIRED_UNMAPPED',
    ]); // Profit Center Name, Person Responsible, Standard Hierarchy Node, Segment
    // The only blank-required errors are for the mapped field Valid From (row 13 has a bad date), never for unmapped ones.
    const blanks = r.run.diagnostics.filter((d) => d.code === 'TARGET_REQUIRED_BLANK');
    expect(blanks.map((d) => [d.targetFieldId, d.targetRow])).toEqual([
      [tf('Profit Center', 'Valid From'), 13],
    ]);
    expect(
      r.completeness.find((c) => c.targetStructureId === structure('Profit Center').id),
    ).toMatchObject({ requiredFields: 7, requiredMapped: 3, ready: false });
  });

  it('M6-10 an unconfirmed relationship is flagged before the run and its data is not used', () => {
    const r = runTest(
      { runId: 'run-2', model: project(rel), data: rows, sample: SAMPLE_PRESETS.rows100 },
      { now, routines: createBuiltInRegistry() },
    );
    expect(r.preflight.map((d) => d.code)).toContain('TEST_RELATIONSHIP_UNCONFIRMED');
    // this mapping reads one dataset per structure, so no join is needed and the run still works
    expect(r.run.status).not.toBe('failed');
  });

  it('M6-11 the same run gives the same result (deterministic)', () => {
    const run = () => {
      tick = 0;
      return go({ kind: 'spread', count: 50 });
    };
    expect(run()).toEqual(run());
  });

  it('M6-12 lineage is recorded for samples up to 1,000 rows and left out of "all"', () => {
    expect(go(SAMPLE_PRESETS.rows100).targets[0]!.lineage).toBeDefined();
    expect(go(SAMPLE_PRESETS.all).targets[0]!.lineage).toBeUndefined();
    const cell = go(SAMPLE_PRESETS.rows100).targets[0]!.lineage![0]![
      col('Profit Center', 'Valid From')
    ]!;
    expect(cell.steps.map((s) => s.ref ?? s.kind)).toEqual(['source', 'date.parse', 'date.format']);
  });

  it('M6-13 a saved snapshot can be tested with the sample of its run definition', () => {
    const p = project();
    const snapshot = MappingSnapshotSchema.parse({
      id: 'snap-1',
      projectId: p.id,
      name: 'Initial Mapping',
      createdAt: '2026-10-21T12:30:00.000Z',
      modelSchemaVersion: 1,
      mappingDefinition: p.mappingDefinition,
      targetDefinition: p.targetDefinition,
      sourceSchemas: p.sourceDefinitions,
      routines: p.routines,
      lookups: p.lookups,
    });
    const r = runTestOnSnapshot(
      snapshot,
      rows,
      {
        id: 'run-3',
        snapshotId: 'snap-1',
        runType: 'test',
        inputs: [],
        sample: { kind: 'firstRows', count: 10 },
      } as never,
      { now, routines: createBuiltInRegistry() },
    );
    expect(r.run).toMatchObject({ runId: 'run-3' });
    expect(out(r, 'Profit Center').rows.rows).toHaveLength(10);
  });
});
