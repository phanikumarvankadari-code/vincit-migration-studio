import { describe, expect, it } from 'vitest';
import {
  MappingSnapshotSchema,
  RunResultSchema,
  type Project,
  type SourceRows,
} from '@mms/mapping-core';
import { createBuiltInRegistry } from '@mms/routine-library';
import {
  DEFAULT_SAMPLE,
  SAMPLE_PRESETS,
  diagnosticsForRow,
  preflight,
  rowOf,
  runTest,
  runTestOnSnapshot,
  selectRows,
  suggestDrivers,
  summarizeDiagnostics,
  type SampleConfig,
  type TestRunOptions,
  type TestRunResult,
} from '../src/index.js';
import {
  build,
  conditional,
  constant,
  direct,
  lookup,
  lookupDef,
  rel,
  routineMapping,
  rstep,
  type Spec,
} from '../../transformation-engine/test/helpers/model.js';

/** A clock that ticks one second per call, so runs are repeatable. */
const clock = (): (() => string) => {
  let n = 0;
  return () => `2026-10-21T12:00:${String(n++).padStart(2, '0')}.000Z`;
};
const opts = (extra: Partial<TestRunOptions> = {}): TestRunOptions => ({ now: clock(), ...extra });

const cepc = {
  name: 'CEPC',
  fields: ['PC', 'Name', 'Country'],
  rows: [
    ['P100', 'Helsinki', 'FI'],
    ['P200', 'Stockholm', 'SE'],
    ['P300', 'Oslo', 'NO'],
  ],
};
const bukrs = {
  name: 'BUKRS',
  fields: ['PC', 'CC'],
  rows: [
    ['P100', 'FI01'],
    ['P100', 'FI02'],
    ['P300', 'NO01'],
  ],
};

function spec(over: Partial<Spec> = {}): Spec {
  return {
    datasets: [cepc, bukrs],
    targets: [
      {
        name: 'PC',
        fields: ['PC', 'Name', 'Region'],
        keys: ['PC'],
        required: ['PC', 'Name'],
        generation: { driver: 'CEPC' },
      },
      {
        name: 'CC',
        fields: ['PC', 'CC'],
        keys: ['PC', 'CC'],
        required: ['PC', 'CC'],
        generation: { driver: 'BUKRS' },
        parent: { structure: 'PC', keys: [['PC', 'PC']] },
      },
    ],
    relationships: [rel('r1', 'CEPC', 'BUKRS', [['PC', 'PC']], { status: 'confirmed' })],
    lookups: [
      lookupDef('lk', [
        ['FI', 'North'],
        ['SE', 'North'],
        ['NO', 'North'],
      ]),
    ],
    mappings: [
      direct('PC.PC', 'CEPC.PC'),
      direct('PC.Name', 'CEPC.Name'),
      lookup('PC.Region', 'CEPC.Country', 'lk', { kind: 'error' }),
      direct('CC.PC', 'BUKRS.PC'),
      direct('CC.CC', 'BUKRS.CC'),
    ],
    ...over,
  };
}
function go(
  s: Spec = spec(),
  sample?: SampleConfig,
  options: Partial<TestRunOptions> = {},
): TestRunResult {
  const { model, data } = build(s);
  return runTest({ runId: 'run-1', model, data, ...(sample ? { sample } : {}) }, opts(options));
}
const rowsOf = (r: TestRunResult, name: string) =>
  r.targets.find((t) => t.rows.targetStructureId === `ts-${name}`)!;
const codes = (r: TestRunResult) => r.run.diagnostics.map((d) => d.code);

describe('sample selection (SPEC-020)', () => {
  it('offers 100 rows, 1,000 rows and all rows', () => {
    expect(SAMPLE_PRESETS).toEqual({
      rows100: { kind: 'firstRows', count: 100 },
      rows1000: { kind: 'firstRows', count: 1000 },
      all: { kind: 'all' },
    });
    expect(DEFAULT_SAMPLE).toEqual(SAMPLE_PRESETS.rows100);
  });

  it('first rows, all rows, and a count larger than the data', () => {
    expect(selectRows({ kind: 'firstRows', count: 3 }, 10)).toEqual([0, 1, 2]);
    expect(selectRows({ kind: 'firstRows', count: 99 }, 4)).toEqual([0, 1, 2, 3]);
    expect(selectRows({ kind: 'all' }, 3)).toEqual([0, 1, 2]);
    expect(selectRows({ kind: 'spread', count: 99 }, 3)).toEqual([0, 1, 2]);
  });

  it('spread picks evenly spaced rows, starting at the first, without repeats', () => {
    expect(selectRows({ kind: 'spread', count: 4 }, 10)).toEqual([0, 2, 5, 7]);
    const rows = selectRows({ kind: 'spread', count: 100 }, 250);
    expect(rows).toHaveLength(100);
    expect(new Set(rows).size).toBe(100);
    expect(rows[0]).toBe(0);
    expect(rows[99]!).toBeGreaterThan(240);
  });

  it('empty datasets and repeatability', () => {
    expect(selectRows({ kind: 'all' }, 0)).toEqual([]);
    expect(selectRows({ kind: 'firstRows', count: 5 }, 0)).toEqual([]);
    expect(selectRows({ kind: 'spread', count: 7 }, 1000)).toEqual(
      selectRows({ kind: 'spread', count: 7 }, 1000),
    );
  });
});

describe('running a sample', () => {
  const big = (n: number): Spec =>
    spec({
      datasets: [
        { ...cepc, rows: Array.from({ length: n }, (_, i) => [`P${i}`, `Name ${i}`, 'FI']) },
        { ...bukrs, rows: [] },
      ],
    });

  it('runs the first 100 rows by default and reports driver and sample sizes', () => {
    const r = go(big(250));
    const pc = r.structures.find((s) => s.targetStructureId === 'ts-PC')!;
    expect(pc).toMatchObject({
      driverDataset: 'ds-CEPC',
      driverRowCount: 250,
      sampledRowCount: 100,
      rows: 100,
    });
    expect(rowsOf(r, 'PC').rows.rows[99]![0]).toBe('P99');
    expect(r.sample).toEqual({ kind: 'firstRows', count: 100 });
  });

  it('1,000 rows covers the 250 available; spread covers the whole range; all runs everything', () => {
    expect(go(big(250), SAMPLE_PRESETS.rows1000).structures[0]!.rows).toBe(250);
    const spread = go(big(250), { kind: 'spread', count: 10 });
    expect(rowsOf(spread, 'PC').rows.rows.map((x) => x[0])).toEqual([
      'P0',
      'P25',
      'P50',
      'P75',
      'P100',
      'P125',
      'P150',
      'P175',
      'P200',
      'P225',
    ]);
    expect(go(big(250), SAMPLE_PRESETS.all).structures[0]!.rows).toBe(250);
  });

  it('joined datasets are always complete: a sample limits driver rows only', () => {
    const r = go(spec(), { kind: 'firstRows', count: 1 });
    expect(rowsOf(r, 'PC').rows.rows).toHaveLength(1);
    expect(rowsOf(r, 'CC').rows.rows).toHaveLength(1); // CC has its own driver: BUKRS, first row only
    expect(r.run.inputRecordCounts).toEqual({ 'ds-CEPC': 3, 'ds-BUKRS': 3 });
  });

  it('all rows only run when safe', () => {
    const r = go(big(250), SAMPLE_PRESETS.all, { safeRowLimit: 100 });
    expect(r.run.status).toBe('failed');
    expect(r.targets).toEqual([]);
    expect(r.run.diagnostics.at(-1)).toMatchObject({
      severity: 'error',
      code: 'TEST_ALL_NOT_SAFE',
    });
    expect(r.run.diagnostics.at(-1)!.message).toBe(
      'Running all rows was requested but the sources hold 250 rows (the safe limit is 100). Choose a smaller sample or raise the limit.',
    );
    expect(go(big(250), SAMPLE_PRESETS.all, { safeRowLimit: 250 }).run.status).toBe('completed');
  });

  it('a sample executes deterministically', () => {
    const a = go(spec(), { kind: 'spread', count: 2 });
    const b = go(spec(), { kind: 'spread', count: 2 });
    expect(a).toEqual(b);
  });

  it('does not change the model or the data', () => {
    const { model, data } = build(spec());
    const before = JSON.stringify([model, data]);
    runTest({ runId: 'r', model, data }, opts());
    expect(JSON.stringify([model, data])).toBe(before);
  });
});

describe('results', () => {
  it('a clean run completes, with counts, times and a result that fits the shared RunResult contract', () => {
    const r = go();
    expect(r.run).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-10-21T12:00:00.000Z',
      completedAt: '2026-10-21T12:00:01.000Z',
      warningCount: 0,
      errorCount: 0,
    });
    expect(r.run.inputRecordCounts).toEqual({ 'ds-CEPC': 3, 'ds-BUKRS': 3 });
    expect(r.run.outputRecordCounts).toEqual({ 'ts-PC': 3, 'ts-CC': 3 });
    expect(RunResultSchema.safeParse(r.run).success).toBe(true);
    expect(r.run.diagnostics).toEqual([]);
    expect(r.diagnosticGroups).toEqual([]);
  });

  it('target structures are independently identifiable, each with its own summary', () => {
    const r = go();
    expect(r.targets.map((t) => t.rows.targetStructureId)).toEqual(['ts-PC', 'ts-CC']);
    expect(r.structures).toEqual([
      {
        targetStructureId: 'ts-PC',
        name: 'PC',
        driverDataset: 'ds-CEPC',
        driverRowCount: 3,
        sampledRowCount: 3,
        rows: 3,
        ready: 3,
        warning: 0,
        error: 0,
      },
      {
        targetStructureId: 'ts-CC',
        name: 'CC',
        driverDataset: 'ds-BUKRS',
        driverRowCount: 3,
        sampledRowCount: 3,
        rows: 3,
        ready: 3,
        warning: 0,
        error: 0,
      },
    ]);
    expect(r.completeness.map((c) => [c.targetStructureId, c.ready])).toEqual([
      ['ts-PC', true],
      ['ts-CC', true],
    ]);
  });

  it('errors do not hide successful rows', () => {
    const s = spec({
      datasets: [
        {
          ...cepc,
          rows: [
            ['P100', 'Helsinki', 'FI'],
            ['P200', 'Stockholm', 'XX'],
            ['P300', 'Oslo', 'NO'],
          ],
        },
        bukrs,
      ],
    });
    const r = go(s);
    expect(r.run.status).toBe('completedWithErrors');
    const pc = rowsOf(r, 'PC');
    expect(pc.rows.rows.map((x) => x[2])).toEqual(['North', null, 'North']);
    expect(pc.rowStatus).toEqual(['ready', 'error', 'ready']);
    expect(r.structures[0]).toMatchObject({ rows: 3, ready: 2, error: 1 });
    expect(r.structures[1]).toMatchObject({ rows: 3, ready: 3, error: 0 });
  });

  it('diagnostics are structured and linked to rows', () => {
    const s = spec({
      datasets: [
        {
          ...cepc,
          rows: [
            ['P100', 'Helsinki', 'FI'],
            ['P200', 'Stockholm', 'XX'],
            ['P300', 'Oslo', 'NO'],
          ],
        },
        bukrs,
      ],
    });
    const r = go(s);
    const d = r.run.diagnostics.find((x) => x.code === 'ENGINE_LOOKUP_MISSING')!;
    expect(d).toMatchObject({
      severity: 'error',
      targetStructureId: 'ts-PC',
      targetRow: 2,
      sourceRow: 2,
      sourceValue: 'XX',
    });
    expect(rowOf(d)).toEqual({ targetStructureId: 'ts-PC', targetRow: 2 });
    expect(diagnosticsForRow(r.run.diagnostics, 'ts-PC', 2)).toEqual([d]);
    expect(diagnosticsForRow(r.run.diagnostics, 'ts-PC', 1)).toEqual([]);
    expect(r.run.diagnostics.every((x) => x.severity && x.code && x.message)).toBe(true);
  });

  it('a diagnostics list collapses repeats, worst first, and links to the first row', () => {
    const rows = Array.from({ length: 200 }, (_, i) => [
      `P${i}`,
      `N${i}`,
      i % 4 === 0 ? 'XX' : 'FI',
    ]);
    const r = go(
      spec({
        datasets: [
          { ...cepc, rows },
          { ...bukrs, rows: [] },
        ],
      }),
      { kind: 'firstRows', count: 200 },
    );
    expect(r.diagnosticGroups).toHaveLength(1);
    expect(r.diagnosticGroups[0]).toMatchObject({
      code: 'ENGINE_LOOKUP_MISSING',
      severity: 'error',
      count: 50,
      targetStructureId: 'ts-PC',
      targetFieldId: 'tf-PC.Region',
      firstTargetRow: 1,
    });
    expect(r.run.errorCount).toBe(50);
  });

  it('groups are ordered by severity, then count', () => {
    const groups = summarizeDiagnostics([
      { severity: 'info', code: 'I', message: 'i' },
      { severity: 'warning', code: 'W', message: 'w' },
      { severity: 'error', code: 'E1', message: 'e1' },
      { severity: 'error', code: 'E2', message: 'e2' },
      { severity: 'error', code: 'E2', message: 'e2' },
    ]);
    expect(groups.map((g) => [g.code, g.count])).toEqual([
      ['E2', 2],
      ['E1', 1],
      ['W', 1],
      ['I', 1],
    ]);
  });

  it('lineage is on for samples up to 1,000 rows and off for bigger ones, unless set', () => {
    expect(go().targets[0]!.lineage).toBeDefined();
    expect(go(spec(), SAMPLE_PRESETS.all).targets[0]!.lineage).toBeUndefined();
    expect(go(spec(), { kind: 'firstRows', count: 5000 }).targets[0]!.lineage).toBeUndefined();
    expect(
      go(spec(), SAMPLE_PRESETS.all, { collectLineage: true }).targets[0]!.lineage,
    ).toBeDefined();
    expect(go(spec(), undefined, { collectLineage: false }).targets[0]!.lineage).toBeUndefined();
  });

  it('only the chosen structures run', () => {
    const r = go(spec(), undefined, { structures: ['ts-CC'] });
    expect(r.targets.map((t) => t.rows.targetStructureId)).toEqual(['ts-CC']);
    expect(codes(r)).toContain('TARGET_PARENT_CHECK_SKIPPED');
  });
});

describe('a model that cannot run gives a failed result, not an exception', () => {
  it('reference errors', () => {
    const { model, data } = build(spec());
    const bad: Project = {
      ...model,
      mappingDefinition: {
        ...model.mappingDefinition,
        mappings: [{ ...model.mappingDefinition.mappings[0]!, targetFieldId: 'nope' as never }],
      },
    };
    const r = runTest({ runId: 'r', model: bad, data }, opts());
    expect(r.run.status).toBe('failed');
    expect(r.targets).toEqual([]);
    expect(codes(r)).toContain('MODEL_UNKNOWN_TARGET_FIELD');
  });

  it('data that does not match', () => {
    const { model } = build(spec());
    const r = runTest(
      {
        runId: 'r',
        model,
        data: [{ datasetId: 'ds-CEPC' as never, fieldIds: ['x'] as never, rows: [] }],
      },
      opts(),
    );
    expect(r.run.status).toBe('failed');
    expect(codes(r)).toContain('ENGINE_DATA_MISMATCH');
  });
});

describe('key and row checks', () => {
  it('duplicate target keys are errors on the repeated row', () => {
    const r = go(
      spec({
        datasets: [
          cepc,
          {
            ...bukrs,
            rows: [
              ['P100', 'FI01'],
              ['P100', 'FI01'],
              ['P300', 'NO01'],
            ],
          },
        ],
      }),
    );
    const dup = r.run.diagnostics.find((x) => x.code === 'TARGET_DUPLICATE_KEY')!;
    expect(dup).toMatchObject({
      severity: 'error',
      targetStructureId: 'ts-CC',
      targetRow: 2,
      sourceRow: 2,
    });
    expect(dup.message).toBe('Row 2 of "CC" repeats the key (P100, FI01) already used by row 1.');
    expect(rowsOf(r, 'CC').rowStatus).toEqual(['ready', 'error', 'ready']);
    expect(r.run.status).toBe('completedWithErrors');
  });

  it('the same key part twice is fine as long as the whole key differs', () => {
    expect(codes(go())).not.toContain('TARGET_DUPLICATE_KEY');
  });

  it('blank key fields and blank required fields are errors on their row', () => {
    const r = go(
      spec({
        datasets: [
          {
            ...cepc,
            rows: [
              ['P100', 'Helsinki', 'FI'],
              ['', 'Stockholm', 'SE'],
              ['P300', null, 'NO'],
            ],
          },
          bukrs,
        ],
      }),
    );
    const byCode = (c: string) => r.run.diagnostics.filter((x) => x.code === c);
    expect(byCode('TARGET_KEY_BLANK')).toMatchObject([
      { targetRow: 2, targetFieldId: 'tf-PC.PC', severity: 'error' },
    ]);
    expect(byCode('TARGET_REQUIRED_BLANK')).toMatchObject([
      { targetRow: 3, targetFieldId: 'tf-PC.Name' },
    ]);
    expect(rowsOf(r, 'PC').rowStatus).toEqual(['ready', 'error', 'error']);
    expect(byCode('TARGET_DUPLICATE_KEY')).toEqual([]); // a blank key is reported once, not as a duplicate
  });

  it('fields without a mapping are left to pre-flight: no error on every row of a partly mapped draft', () => {
    const s = spec({ mappings: [direct('PC.Name', 'CEPC.Name'), direct('CC.PC', 'BUKRS.PC')] });
    const r = go(s);
    const perRow = r.run.diagnostics.filter((x) => x.targetRow !== undefined);
    expect(perRow).toEqual([]);
    expect(r.preflight.map((x) => x.code).sort()).toEqual([
      'TEST_KEY_UNMAPPED',
      'TEST_KEY_UNMAPPED',
    ]);
    expect(r.run.status).toBe('completed');
  });

  it('duplicates are only looked for when every key field is mapped', () => {
    const s = spec({
      datasets: [
        cepc,
        {
          ...bukrs,
          rows: [
            ['P100', 'FI01'],
            ['P100', 'FI01'],
          ],
        },
      ],
      mappings: [
        direct('PC.PC', 'CEPC.PC'),
        direct('PC.Name', 'CEPC.Name'),
        direct('CC.PC', 'BUKRS.PC'),
      ],
    });
    expect(codes(go(s))).not.toContain('TARGET_DUPLICATE_KEY');
  });

  it('a child row without a parent row is an error', () => {
    const r = go(
      spec({
        datasets: [
          cepc,
          {
            ...bukrs,
            rows: [
              ['P100', 'FI01'],
              ['P999', 'XX01'],
            ],
          },
        ],
      }),
    );
    const missing = r.run.diagnostics.find((x) => x.code === 'TARGET_PARENT_MISSING')!;
    expect(missing).toMatchObject({ severity: 'error', targetStructureId: 'ts-CC', targetRow: 2 });
    expect(missing.message).toBe('Row 2 of "CC" has no parent row in "PC" for (P999).');
    expect(rowsOf(r, 'CC').rowStatus).toEqual(['ready', 'error']);
  });

  it('parent links are not checked when the parent was only sampled (no false alarms), and this is reported', () => {
    const r = go(
      spec({
        datasets: [
          cepc,
          {
            ...bukrs,
            rows: [
              ['P100', 'FI01'],
              ['P300', 'NO01'],
            ],
          },
        ],
      }),
      { kind: 'firstRows', count: 1 },
    );
    expect(codes(r)).not.toContain('TARGET_PARENT_MISSING');
    const skipped = r.run.diagnostics.find((x) => x.code === 'TARGET_PARENT_CHECK_SKIPPED')!;
    expect(skipped).toMatchObject({ severity: 'info', targetStructureId: 'ts-CC' });
    expect(skipped.message).toContain('Only 1 of 3 rows of "PC" were run');
  });

  it('every check result carries structure and row so it can be found in the grid', () => {
    const r = go(
      spec({
        datasets: [
          cepc,
          {
            ...bukrs,
            rows: [
              ['P999', 'X'],
              ['P999', 'X'],
            ],
          },
        ],
      }),
    );
    for (const d of r.run.diagnostics.filter(
      (x) => x.code.startsWith('TARGET_') && x.severity === 'error',
    )) {
      expect(rowOf(d), d.code).toBeDefined();
    }
  });
});

describe('pre-flight checks', () => {
  const pre = (s: Spec, o = {}) => {
    const { model } = build(s);
    return preflight(model, o);
  };
  const chain = (id: string, config: Record<string, never | string | number> = {}) =>
    routineMapping('PC.Name', 'CEPC.Name', [rstep(id, 0, 'stop', config as never)]);

  it('a clean model has nothing to report', () => {
    expect(pre(spec())).toEqual([]);
  });

  it('a routine without an implementation is reported once, not once per row', () => {
    const d = pre(
      spec({
        mappings: [...spec().mappings.slice(0, 1), chain('r-unknown'), ...spec().mappings.slice(2)],
      }),
      { routines: {} },
    );
    expect(d.filter((x) => x.code === 'TEST_ROUTINE_NOT_AVAILABLE')).toHaveLength(1);
    expect(d.find((x) => x.code === 'TEST_ROUTINE_NOT_AVAILABLE')).toMatchObject({
      severity: 'error',
      routineId: 'r-unknown',
      targetFieldId: 'tf-PC.Name',
    });
  });

  it('a built-in routine with a bad configuration is reported before the run', () => {
    const registry = createBuiltInRegistry();
    const d = pre(
      spec({
        mappings: [
          ...spec().mappings.slice(0, 1),
          chain('date.parse', { format: 'M/D/YY' }),
          ...spec().mappings.slice(2),
        ],
      }),
      { routines: registry },
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      severity: 'error',
      code: 'ROUTINE_CONFIG_INVALID',
      routineId: 'date.parse',
      targetFieldId: 'tf-PC.Name',
    });
    expect(d[0]!.message).toContain('twoDigitYearPivot');
    expect(
      pre(
        spec({
          mappings: [
            ...spec().mappings.slice(0, 1),
            chain('date.parse', { format: 'YYYYMMDD' }),
            ...spec().mappings.slice(2),
          ],
        }),
        { routines: registry },
      ),
    ).toEqual([]);
  });

  it('custom JavaScript without a sandbox is reported', () => {
    const js = {
      ...direct('PC.Name', 'CEPC.Name'),
      mappingType: 'javascript',
      javascript: { code: 'return value;', declaredLookupIds: [] },
    };
    const s = spec({ mappings: [spec().mappings[0]!, js, ...spec().mappings.slice(2)] });
    expect(pre(s).map((x) => x.code)).toEqual(['TEST_JS_NOT_AVAILABLE']);
    expect(pre(s, { javascript: () => ({ ok: true, value: 'x' }) })).toEqual([]);
  });

  it('unconfirmed relationships are listed as not used', () => {
    const d = pre(
      spec({
        relationships: [rel('r1', 'CEPC', 'BUKRS', [['PC', 'PC']], { status: 'suggested' })],
      }),
    );
    expect(d).toMatchObject([{ severity: 'info', code: 'TEST_RELATIONSHIP_UNCONFIRMED' }]);
  });

  it('unmapped key fields and unmapped required fields are warnings', () => {
    const d = pre(
      spec({
        mappings: [
          direct('PC.Name', 'CEPC.Name'),
          direct('CC.PC', 'BUKRS.PC'),
          direct('CC.CC', 'BUKRS.CC'),
        ],
      }),
    );
    expect(d.map((x) => [x.severity, x.code, x.targetFieldId])).toEqual([
      ['warning', 'TEST_KEY_UNMAPPED', 'tf-PC.PC'],
    ]);
    const d2 = pre(
      spec({
        mappings: [
          direct('PC.PC', 'CEPC.PC'),
          direct('CC.PC', 'BUKRS.PC'),
          direct('CC.CC', 'BUKRS.CC'),
        ],
      }),
    );
    expect(d2.map((x) => [x.code, x.targetFieldId])).toEqual([
      ['TEST_REQUIRED_UNMAPPED', 'tf-PC.Name'],
    ]);
  });

  describe('driver suggestion', () => {
    const noGen = (): Spec => {
      const s = spec();
      s.targets = s.targets.map((t) => ({ ...t, generation: undefined }) as never);
      s.targets[0] = {
        name: 'PC',
        fields: ['PC', 'Name', 'Region'],
        keys: ['PC'],
        required: ['PC', 'Name'],
      };
      s.targets[1] = {
        name: 'CC',
        fields: ['PC', 'CC', 'Country'],
        keys: ['PC', 'CC'],
        required: ['PC', 'CC'],
        parent: { structure: 'PC', keys: [['PC', 'PC']] },
      };
      s.mappings = [
        direct('PC.PC', 'CEPC.PC'),
        direct('PC.Name', 'CEPC.Name'),
        direct('CC.PC', 'BUKRS.PC'),
        direct('CC.CC', 'BUKRS.CC'),
        direct('CC.Country', 'CEPC.Country'),
      ];
      return s;
    };

    it('a structure reading several datasets without a driver gets a suggestion from its key fields', () => {
      const d = pre(noGen());
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({
        severity: 'warning',
        code: 'TEST_DRIVER_SUGGESTION',
        targetStructureId: 'ts-CC',
        technicalDetails: 'suggested driver: ds-BUKRS',
      });
      expect(d[0]!.message).toContain('it supplies 2 of 2 key field(s)');
    });

    it('suggestDrivers ranks by key fields, then by number of mappings', () => {
      const { model } = build(noGen());
      expect(suggestDrivers(model, 'ts-CC').map((x) => [x.datasetId, x.keyFieldsCovered])).toEqual([
        ['ds-BUKRS', 2],
        ['ds-CEPC', 0],
      ]);
      expect(suggestDrivers(model, 'ts-PC')).toHaveLength(1);
      expect(suggestDrivers(model, 'nope')).toEqual([]);
    });

    it('the run itself reports ENGINE_NO_DRIVER and makes no rows for that structure, and the suggestion explains how to fix it', () => {
      const { model, data } = build(noGen());
      const r = runTest({ runId: 'r', model, data }, opts());
      expect(rowsOf(r, 'CC').rows.rows).toEqual([]);
      expect(codes(r)).toEqual(
        expect.arrayContaining(['TEST_DRIVER_SUGGESTION', 'ENGINE_NO_DRIVER']),
      );
    });
  });

  it('datasets read inside conditions count when looking for a driver', () => {
    const f = (path: string) => ({
      kind: 'field',
      datasetId: `ds-${path.split('.')[0]}`,
      fieldId: path,
    });
    const lit = { kind: 'constant', constant: { datatype: 'string', value: 'x' } };
    const when = {
      op: 'and',
      conditions: [
        { op: 'not', condition: { op: 'isEmpty', operand: f('BUKRS.CC') } },
        {
          op: 'or',
          conditions: [
            { op: 'in', operand: f('BUKRS.PC'), values: [lit.constant] },
            { op: 'compare', operator: 'eq', left: f('BUKRS.CC'), right: lit },
          ],
        },
      ],
    };
    const s = spec();
    s.targets = [{ name: 'PC', fields: ['PC', 'Name'], keys: ['PC'] }];
    s.mappings = [
      direct('PC.PC', 'CEPC.PC'),
      { ...conditional('PC.Name', ['CEPC.Name'], [{ when, then: f('BUKRS.CC') }], f('BUKRS.PC')) },
    ];
    const d = pre(s);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      code: 'TEST_DRIVER_SUGGESTION',
      technicalDetails: 'suggested driver: ds-CEPC',
    });
    expect(d[0]!.message).toContain('reads 2 datasets');
  });

  it('pre-flight problems are part of the run result, listed once and also on their own', () => {
    const { model, data } = build(
      spec({
        relationships: [rel('r1', 'CEPC', 'BUKRS', [['PC', 'PC']], { status: 'suggested' })],
      }),
    );
    const r = runTest({ runId: 'r', model, data }, opts());
    expect(r.preflight.map((x) => x.code)).toEqual(['TEST_RELATIONSHIP_UNCONFIRMED']);
    expect(r.run.diagnostics[0]).toEqual(r.preflight[0]);
  });
});

describe('testing a saved snapshot', () => {
  const snapshotOf = (project: Project) =>
    MappingSnapshotSchema.parse({
      id: 'snap-1',
      projectId: project.id,
      name: 'Initial',
      createdAt: '2026-10-21T11:00:00.000Z',
      modelSchemaVersion: 1,
      mappingDefinition: project.mappingDefinition,
      targetDefinition: project.targetDefinition,
      sourceSchemas: project.sourceDefinitions,
      routines: project.routines,
      lookups: project.lookups,
    });
  const def = (over: object = {}) =>
    ({
      id: 'run-9',
      snapshotId: 'snap-1',
      runType: 'test',
      inputs: [],
      sample: { kind: 'firstRows', count: 2 },
      ...over,
    }) as never;

  it('runs the snapshot with the sample of the run definition', () => {
    const { model, data } = build(spec());
    const r = runTestOnSnapshot(snapshotOf(model), data, def(), opts());
    expect(r.run).toMatchObject({ runId: 'run-9', status: 'completed' });
    expect(r.sample).toEqual({ kind: 'firstRows', count: 2 });
    expect(rowsOf(r, 'PC').rows.rows).toHaveLength(2);
  });

  it('refuses a full run or a run for another snapshot', () => {
    const { model, data } = build(spec());
    const full = runTestOnSnapshot(snapshotOf(model), data, def({ runType: 'full' }), opts());
    expect(full.run.status).toBe('failed');
    expect(full.run.diagnostics[0]).toMatchObject({
      code: 'TEST_RUN_MISMATCH',
      message: 'Run "run-9" is a full run, not a test run.',
    });
    const other = runTestOnSnapshot(snapshotOf(model), data, def({ snapshotId: 'snap-2' }), opts());
    expect(other.run.diagnostics[0]!.message).toBe(
      'Run "run-9" is for snapshot "snap-2", not "snap-1".',
    );
  });
});

describe('deterministic and portable', () => {
  it('constant mappings and a sample give identical results across runs, with an injected clock', () => {
    const s = spec({ mappings: [...spec().mappings, constant('PC.Region', 'EU')] });
    s.mappings = s.mappings.filter((m) => !(m['mappingType'] === 'lookup'));
    const { model, data } = build(s);
    const run = () => runTest({ runId: 'r', model, data: data as SourceRows[] }, opts());
    expect(run()).toEqual(run());
  });
});
