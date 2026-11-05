import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importCsv, importXlsx } from '@mms/file-import';
import {
  MappingSnapshotSchema,
  RunResultSchema,
  validateSnapshot,
  type MappingSnapshot,
  type Project,
  type RunDefinition,
  type SourceRows,
  toBase64,
} from '@mms/mapping-core';
import { createBuiltInRegistry } from '@mms/routine-library';
import { fileBytes, runLocal, type LocalRunOptions } from '../src/index.js';
import {
  build,
  direct,
  lookup,
  lookupDef,
  rel,
  routineMapping,
  rstep,
  type Spec,
} from '../../transformation-engine/test/helpers/model.js';

const clock = (): (() => string) => {
  let n = 0;
  return () => `2026-10-21T16:00:${String(n++).padStart(2, '0')}.000Z`;
};
const opts = (extra: Partial<LocalRunOptions> = {}): LocalRunOptions => ({
  now: clock(),
  routines: createBuiltInRegistry(),
  ...extra,
});

const def = (over: Partial<RunDefinition> = {}): RunDefinition =>
  ({ id: 'run-1', snapshotId: 'snap-1', runType: 'full', inputs: [], ...over }) as RunDefinition;

function snapshotOf(project: Project, name = 'Approved Mapping'): MappingSnapshot {
  return MappingSnapshotSchema.parse({
    id: 'snap-1',
    projectId: project.id,
    name,
    createdAt: '2026-10-21T15:00:00.000Z',
    modelSchemaVersion: 1,
    mappingDefinition: project.mappingDefinition,
    targetDefinition: project.targetDefinition,
    sourceSchemas: project.sourceDefinitions,
    routines: project.routines,
    lookups: project.lookups,
  });
}

const cepc = {
  name: 'CEPC',
  fields: ['PC', 'Name', 'Country', 'From'],
  rows: [
    ['P100', 'Helsinki, Central', 'FI', '1/1/26'],
    ['P200', 'Stockholm', 'SE', '5/1/26'],
    ['P300', 'Oslo', 'NO', '13/45/26'],
    ['P400', 'Gone', 'FI', '1/1/26'],
  ],
};
const bukrs = {
  name: 'BUKRS',
  fields: ['PC', 'CC'],
  rows: [
    ['P100', 'FI01'],
    ['P100', 'FI02'],
    ['P100', 'SE01'],
    ['P200', 'SE02'],
    ['P999', 'XX01'],
  ],
};

function spec(over: Partial<Spec> = {}): Spec {
  return {
    datasets: [cepc, bukrs],
    targets: [
      {
        name: 'Profit Center',
        fields: ['PC', 'Name', 'Region', 'From'],
        keys: ['PC'],
        required: ['PC'],
        generation: { driver: 'CEPC' },
      },
      {
        name: 'Company Codes',
        fields: ['PC', 'CC'],
        keys: ['PC', 'CC'],
        required: ['PC', 'CC'],
        generation: { driver: 'BUKRS' },
        parent: { structure: 'Profit Center', keys: [['PC', 'PC']] },
      },
    ],
    relationships: [rel('r1', 'CEPC', 'BUKRS', [['PC', 'PC']], { joinType: 'inner' })],
    lookups: [
      lookupDef('lk', [
        ['FI', 'North'],
        ['SE', 'North'],
      ]),
    ],
    mappings: [
      direct('Profit Center.PC', 'CEPC.PC'),
      direct('Profit Center.Name', 'CEPC.Name'),
      lookup('Profit Center.Region', 'CEPC.Country', 'lk', { kind: 'error' }),
      routineMapping('Profit Center.From', 'CEPC.From', [
        rstep('date.parse', 0, 'stop', { format: 'M/D/YY', twoDigitYearPivot: 68 }),
        rstep('date.format', 1, 'stop', { format: 'YYYYMMDD' }),
      ]),
      direct('Company Codes.PC', 'BUKRS.PC'),
      direct('Company Codes.CC', 'BUKRS.CC'),
    ],
    ...over,
  };
}
function setup(s: Spec = spec()): { snapshot: MappingSnapshot; data: SourceRows[] } {
  const { model, data } = build(s);
  return { snapshot: snapshotOf(model), data };
}
const file = (r: ReturnType<typeof runLocal>, name: string) => r.files.find((f) => f.name === name);
const text = (r: ReturnType<typeof runLocal>, name: string): string => {
  const f = file(r, name);
  if (!f || typeof f.content !== 'string')
    throw new Error(`no text file ${name}: ${r.files.map((x) => x.name).join(', ')}`);
  return f.content;
};

describe('full local run (SPEC-028)', () => {
  it('runs every row and writes one output file per target structure', () => {
    const { snapshot, data } = setup();
    expect(validateSnapshot(snapshot)).toEqual([]);
    const r = runLocal(snapshot, data, def(), opts({ csv: { lineEnding: '\n' } }));
    expect(r.run.status).toBe('completedWithErrors');
    expect(r.files.map((f) => f.name)).toEqual([
      'Profit Center.csv',
      'Profit Center.errors.csv',
      'Company Codes.csv',
      'Company Codes.errors.csv',
      'diagnostics.csv',
      'run-summary.json',
    ]);
    expect(text(r, 'Profit Center.csv')).toBe(
      [
        'PC,Name,Region,From',
        'P100,"Helsinki, Central",North,20260101',
        'P200,Stockholm,North,20260501',
        'P400,Gone,North,20260101',
        '',
      ].join('\n'),
    );
    expect(text(r, 'Company Codes.csv')).toBe(
      ['PC,CC', 'P100,FI01', 'P100,FI02', 'P100,SE01', 'P200,SE02', ''].join('\n'),
    );
  });

  it('rows that failed go to a separate errors file with the reasons, and are not in the output', () => {
    const { snapshot, data } = setup();
    const r = runLocal(snapshot, data, def(), opts({ csv: { lineEnding: '\n' } }));
    const errors = text(r, 'Profit Center.errors.csv').split('\n');
    expect(errors[0]).toBe('Row,Source row,Problems,PC,Name,Region,From');
    expect(errors[1]).toBe(
      '3,3,"No entry for ""NO"" in lookup ""lk"". | Cannot read ""13/45/26"" as a date with the layout M/D/YY: month 13 is not valid.",P300,Oslo,,',
    );
    expect(text(r, 'Profit Center.csv')).not.toContain('P300');
    // the company code row without a parent profit center is an error row too
    const cc = text(r, 'Company Codes.errors.csv').split('\n');
    expect(cc[1]).toContain('XX01');
    expect(cc[1]).toContain('has no parent row in ""Profit Center"" for (P999)'); // quotes are doubled inside a CSV field
  });

  it('nothing is dropped silently: produced = written + errors, and dropped driver rows are counted and listed', () => {
    // Company Codes takes the profit center from CEPC, so a row without a matching CEPC row is dropped by the inner join.
    const { snapshot, data } = setup(
      spec({
        mappings: [
          ...spec().mappings.slice(0, 4),
          direct('Company Codes.CC', 'BUKRS.CC'),
          direct('Company Codes.PC', 'CEPC.PC'),
        ],
      }),
    );
    const r = runLocal(snapshot, data, def(), opts());
    const [pc, cc] = r.summary.structures;
    expect(pc).toMatchObject({
      name: 'Profit Center',
      produced: 4,
      written: 3,
      errors: 1,
      warnings: 0,
      dropped: 0,
    });
    expect(pc!.produced).toBe(pc!.written + pc!.errors);
    expect(cc).toMatchObject({ name: 'Company Codes', produced: 4, dropped: 1 }); // P999 has no parent profit center: dropped by the inner join
    expect(cc!.produced + cc!.dropped).toBe(5); // all 5 company-code rows are accounted for
    expect(text(r, 'diagnostics.csv')).toContain('ENGINE_ROW_DROPPED');
  });

  it('the diagnostics file lists every problem with row, field, source value, mapping and routine', () => {
    const { snapshot, data } = setup();
    const r = runLocal(snapshot, data, def(), opts({ csv: { lineEnding: '\n' } }));
    const lines = text(r, 'diagnostics.csv').trim().split('\n');
    expect(lines[0]).toBe(
      'Severity,Code,Message,Target structure,Target field,Target row,Source dataset,Source row,Source value,Mapping,Routine,Details',
    );
    const date = lines.find((l) => l.includes('DATE_INVALID'))!;
    expect(date).toContain('error,DATE_INVALID');
    expect(date).toContain(
      'Profit Center,tf-Profit Center.From,3,ds-CEPC,3,13/45/26,m-Profit Center.From,date.parse',
    );
    expect(lines.length - 1).toBe(r.run.diagnostics.length);
  });

  it('the run summary has times, snapshot, input and output counts, warnings, errors and files', () => {
    const { snapshot, data } = setup();
    const r = runLocal(snapshot, data, def(), opts());
    const summary = JSON.parse(text(r, 'run-summary.json'));
    expect(summary).toMatchObject({
      runId: 'run-1',
      snapshotId: 'snap-1',
      snapshotName: 'Approved Mapping',
      status: 'completedWithErrors',
      inputRecordCounts: { 'ds-CEPC': 4, 'ds-BUKRS': 5 },
    });
    expect(summary.startedAt < summary.completedAt).toBe(true);
    expect(
      summary.structures.map((s: { name: string; written: number }) => [s.name, s.written]),
    ).toEqual([
      ['Profit Center', 3],
      ['Company Codes', 4],
    ]);
    expect(summary.errorCount).toBe(r.run.errorCount);
    expect(summary.warningCount).toBe(r.run.warningCount);
    expect(summary.files.map((f: { name: string }) => f.name)).toEqual(r.files.map((f) => f.name));
    expect(r.summary).toEqual(summary);
  });

  it('the run result fits the shared contract and lists the generated files; output counts are rows written', () => {
    const { snapshot, data } = setup();
    const r = runLocal(snapshot, data, def(), opts());
    expect(RunResultSchema.safeParse(r.run).success).toBe(true);
    expect(r.run.generatedFiles).toEqual([
      {
        kind: 'output',
        targetStructureId: 'ts-Profit Center',
        fileName: 'Profit Center.csv',
        format: 'csv',
      },
      {
        kind: 'errors',
        targetStructureId: 'ts-Profit Center',
        fileName: 'Profit Center.errors.csv',
        format: 'csv',
      },
      {
        kind: 'output',
        targetStructureId: 'ts-Company Codes',
        fileName: 'Company Codes.csv',
        format: 'csv',
      },
      {
        kind: 'errors',
        targetStructureId: 'ts-Company Codes',
        fileName: 'Company Codes.errors.csv',
        format: 'csv',
      },
      { kind: 'diagnostics', fileName: 'diagnostics.csv', format: 'csv' },
      { kind: 'summary', fileName: 'run-summary.json', format: 'json' },
    ]);
    expect(r.run.outputRecordCounts).toEqual({ 'ts-Profit Center': 3, 'ts-Company Codes': 4 });
    expect(r.run.inputRecordCounts).toEqual({ 'ds-CEPC': 4, 'ds-BUKRS': 5 });
  });

  it('a clean run completes, has no errors file, and still writes header-only files for empty structures', () => {
    const clean = spec({
      datasets: [
        { ...cepc, rows: [['P100', 'Helsinki', 'FI', '1/1/26']] },
        { ...bukrs, rows: [['P100', 'FI01']] },
      ],
    });
    const { snapshot, data } = setup(clean);
    const r = runLocal(snapshot, data, def(), opts({ csv: { lineEnding: '\n' } }));
    expect(r.run.status).toBe('completed');
    expect(r.files.map((f) => f.name)).toEqual([
      'Profit Center.csv',
      'Company Codes.csv',
      'diagnostics.csv',
      'run-summary.json',
    ]);
    const empty = setup(
      spec({
        datasets: [
          { ...cepc, rows: [] },
          { ...bukrs, rows: [] },
        ],
      }),
    );
    const e = runLocal(empty.snapshot, empty.data, def(), opts({ csv: { lineEnding: '\n' } }));
    expect(text(e, 'Profit Center.csv')).toBe('PC,Name,Region,From\n');
    expect(e.summary.structures.map((s) => s.written)).toEqual([0, 0]);
  });

  it('Excel output: one workbook with a sheet per structure, an errors sheet, and the diagnostics', () => {
    const { snapshot, data } = setup();
    const r = runLocal(
      snapshot,
      data,
      def(),
      opts({ formats: ['xlsx'], workbookName: 'Profit Center target' }),
    );
    expect(r.files.map((f) => f.name)).toEqual(['Profit Center target.xlsx', 'run-summary.json']);
    const book = r.files[0]!;
    expect(book).toMatchObject({ format: 'xlsx', kind: 'output' });
    const back = importXlsx(book.content as Uint8Array, { fileName: 'x.xlsx' });
    if (!back.ok) throw new Error('x');
    expect(back.value.source.datasets.map((d) => d.name)).toEqual([
      'Profit Center',
      'Profit Center errors',
      'Company Codes',
      'Company Codes errors',
      'Diagnostics',
    ]);
    expect(back.value.rows[0]!.rows).toEqual([
      ['P100', 'Helsinki, Central', 'North', '20260101'],
      ['P200', 'Stockholm', 'North', '20260501'],
      ['P400', 'Gone', 'North', '20260101'],
    ]);
    expect(back.value.rows[2]!.rows).toHaveLength(4);
  });

  it('both formats can be written together', () => {
    const { snapshot, data } = setup();
    const r = runLocal(snapshot, data, def(), opts({ formats: ['csv', 'xlsx'] }));
    expect(r.files.map((f) => f.format)).toEqual([
      'csv',
      'csv',
      'csv',
      'csv',
      'csv',
      'xlsx',
      'json',
    ]);
    expect(r.run.generatedFiles!.some((f) => f.format === 'xlsx')).toBe(true);
  });

  it('output CSV reads back exactly with the importer, including commas, quotes, leading zeros and blanks', () => {
    const s = spec({
      datasets: [
        {
          ...cepc,
          rows: [
            ['00100', 'a "quoted", name', 'FI', '1/1/26'],
            ['P2', ' spaced ', 'FI', '1/1/26'],
          ],
        },
        { ...bukrs, rows: [] },
      ],
    });
    const { snapshot, data } = setup(s);
    const r = runLocal(snapshot, data, def(), opts());
    const back = importCsv(text(r, 'Profit Center.csv'), { fileName: 'x.csv' });
    if (!back.ok) throw new Error('x');
    expect(back.value.rows[0]!.rows).toEqual([
      ['00100', 'a "quoted", name', 'North', '20260101'],
      ['P2', ' spaced ', 'North', '20260101'],
    ]);
  });

  it('column headings can be technical names, falling back to the display name', () => {
    const s = spec();
    const { model, data } = build(s);
    const withTech = {
      ...model,
      targetDefinition: {
        ...model.targetDefinition!,
        structures: model.targetDefinition!.structures.map((st, i) =>
          i === 0
            ? {
                ...st,
                fields: st.fields.map((f, j) => (j === 0 ? { ...f, technicalName: 'PRCTR' } : f)),
              }
            : st,
        ),
      },
    } as Project;
    const r = runLocal(
      snapshotOf(withTech),
      data,
      def(),
      opts({ header: 'technicalName', csv: { lineEnding: '\n' } }),
    );
    expect(text(r, 'Profit Center.csv').split('\n')[0]).toBe('PRCTR,Name,Region,From');
  });

  it('is repeatable: the same snapshot and data give identical files', () => {
    const { snapshot, data } = setup();
    const a = runLocal(snapshot, data, def(), opts({ formats: ['csv', 'xlsx'] }));
    const b = runLocal(snapshot, data, def(), opts({ formats: ['csv', 'xlsx'] }));
    expect(a.files.map((f) => [f.name, [...fileBytes(f)].join(',')])).toEqual(
      b.files.map((f) => [f.name, [...fileBytes(f)].join(',')]),
    );
    expect(a.run).toEqual(b.run);
  });

  it('does not change the snapshot or the data', () => {
    const { snapshot, data } = setup();
    const before = JSON.stringify([snapshot, data]);
    runLocal(snapshot, data, def(), opts());
    expect(JSON.stringify([snapshot, data])).toBe(before);
  });
});

describe('refusing a run', () => {
  it('only a full run of this snapshot', () => {
    const { snapshot, data } = setup();
    const test = runLocal(snapshot, data, def({ runType: 'test' }), opts());
    expect(test.run.status).toBe('failed');
    expect(test.run.diagnostics[0]!.message).toBe('Run "run-1" is a test run, not a full run.');
    expect(test.files).toEqual([]);
    const other = runLocal(snapshot, data, def({ snapshotId: 'snap-9' as never }), opts());
    expect(other.run.diagnostics[0]!.message).toBe(
      'Run "run-1" is for snapshot "snap-9", not "snap-1".',
    );
  });

  it('broken routines or settings make it fail up front, with no output files', () => {
    const { snapshot, data } = setup();
    const noRoutines = runLocal(snapshot, data, def(), { now: clock(), routines: {} });
    expect(noRoutines.run.status).toBe('failed');
    expect(noRoutines.run.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['TEST_ROUTINE_NOT_AVAILABLE', 'LOCAL_RUN_BLOCKED']),
    );
    expect(noRoutines.files).toEqual([]);
    expect(RunResultSchema.safeParse(noRoutines.run).success).toBe(true);
  });

  it('missing source rows fail the run with the reason', () => {
    const { snapshot, data } = setup();
    const r = runLocal(snapshot, [data[0]!], def(), opts());
    expect(r.run.diagnostics.some((d) => d.code === 'ENGINE_NO_DATA')).toBe(true);
  });
});

describe('large runs', () => {
  it('runs more than 100,000 rows in full (no sample limit) and writes them all', () => {
    const n = 100_001;
    const rows = Array.from({ length: n }, (_, i) => [`P${i}`, 'x', 'FI', '1/1/26']);
    const { snapshot, data } = setup(
      spec({
        datasets: [
          { ...cepc, rows },
          { ...bukrs, rows: [] },
        ],
        mappings: spec().mappings.slice(0, 2),
        targets: [spec().targets[0]!],
      }),
    );
    const r = runLocal(snapshot, data, def(), opts({ csv: { lineEnding: '\n' } }));
    expect(r.run.status).toBe('completed');
    expect(r.summary.structures[0]).toMatchObject({ produced: n, written: n });
    expect(text(r, 'Profit Center.csv').split('\n')).toHaveLength(n + 2); // header + rows + trailing newline
  }, 60_000);
});

describe('local-run boundaries', () => {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
  it('imports only the core packages and relative modules; no Node, DOM, clock, randomness or network', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const t = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of t.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        expect(
          [
            '@mms/file-export',
            '@mms/mapping-core',
            '@mms/test-engine',
            '@mms/transformation-engine',
          ].includes(m[1]!) || m[1]!.startsWith('./'),
          `${f}: ${m[1]}`,
        ).toBe(true);
      }
      expect(t, f).not.toMatch(
        /node:|\bprocess\.|\bBuffer\b|\bdocument\.|\bwindow\.|Math\.random|Date\.now|new Date|\bfetch\(|\beval\(|new Function/,
      );
    }
  });
});

describe('target template workbook', () => {
  const tech: Record<string, Record<string, string>> = {
    'Profit Center': {
      PC: 'PROFITCENTERFOREDIT',
      Name: 'PROFITCENTERNAME',
      Region: 'REGION',
      From: 'VALIDITYSTARTDATE',
    },
    'Company Codes': { PC: 'PROFITCENTERFOREDIT', CC: 'COMPANYCODEFOREDIT' },
  };
  const templateBytes = new Uint8Array(
    readFileSync(
      new URL('../../../test-data/profit-center/target/data_pc_template.xlsx', import.meta.url),
    ),
  );
  function withTemplate(): { snapshot: MappingSnapshot; data: SourceRows[] } {
    const { snapshot, data } = setup();
    const target = snapshot.targetDefinition;
    const next = MappingSnapshotSchema.parse({
      ...snapshot,
      targetDefinition: {
        ...target,
        template: { fileName: 'data_pc.xlsx', base64: toBase64(templateBytes) },
        structures: target.structures.map((st) => ({
          ...st,
          templateSheet: st.name,
          fields: st.fields.map((f) => ({ ...f, technicalName: tech[st.name]![f.displayName]! })),
        })),
      },
    });
    return { snapshot: next, data };
  }

  it('writes the rows that passed into the template, from row 9, next to the other files', () => {
    const { snapshot, data } = withTemplate();
    const r = runLocal(snapshot, data, def(), opts({ csv: { lineEnding: '\n' } }));
    const f = file(r, 'data_pc.xlsx');
    expect(f).toMatchObject({ format: 'xlsx', kind: 'output', rows: 3 + 4 });
    const read = (sheet: string) =>
      importXlsx(f!.content as Uint8Array, { fileName: 'x.xlsx', sheets: [sheet], headerRow: 8 });
    const pc = read('Profit Center');
    if (!pc.ok) throw new Error(JSON.stringify(pc.issues));
    const rows = pc.value.rows[0]!.rows;
    expect(rows.map((x) => x[0])).toEqual(['P100', 'P200', 'P400']);
    expect(rows[0]!.slice(0, 3)).toEqual(['P100', null, '20260101']); // columns by technical name
    expect(file(r, 'Profit Center.csv')).toBeDefined(); // the normal files are still written
  });

  it('without a template nothing changes', () => {
    const { snapshot, data } = setup();
    const r = runLocal(snapshot, data, def(), opts());
    expect(r.files.some((f) => f.format === 'xlsx')).toBe(false);
  });
});
