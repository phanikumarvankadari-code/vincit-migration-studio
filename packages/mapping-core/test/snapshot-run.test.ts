import { describe, expect, it } from 'vitest';
import {
  DiagnosticSchema,
  RunDefinitionSchema,
  RunResultSchema,
  deserializeSnapshot,
  parseProject,
  parseSnapshot,
  serializeSnapshot,
  validateSnapshot,
} from '../src/index.js';
import { profitCenterRaw } from './fixtures/profit-center.js';

function snapshotRaw(): any {
  const p = profitCenterRaw() as any;
  return {
    id: 'snap-1',
    projectId: p.id,
    name: 'Initial Mapping',
    createdAt: '2026-10-21T11:00:00.000Z',
    modelSchemaVersion: 1,
    mappingDefinition: p.mappingDefinition,
    targetDefinition: p.targetDefinition,
    sourceSchemas: p.sourceDefinitions,
    routines: p.routines,
    lookups: p.lookups,
  };
}

describe('snapshot', () => {
  it('is self-contained and validates with no issues', () => {
    const r = parseSnapshot(snapshotRaw());
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateSnapshot(r.value)).toEqual([]);
  });

  it('round-trips through JSON', () => {
    const r = parseSnapshot(snapshotRaw());
    if (!r.ok) throw new Error('unexpected');
    const back = deserializeSnapshot(serializeSnapshot(r.value));
    expect(back.ok && back.value).toEqual(r.value);
  });

  it('reports a reference that does not resolve inside the snapshot', () => {
    const raw = snapshotRaw();
    raw.routines = [];
    const r = parseSnapshot(raw);
    if (!r.ok) throw new Error('unexpected');
    expect(validateSnapshot(r.value).map((i) => i.code)).toContain('MODEL_UNKNOWN_ROUTINE');
  });

  it('later changes to the project do not alter a parsed snapshot', () => {
    const raw = snapshotRaw();
    const r = parseSnapshot(raw);
    if (!r.ok) throw new Error('unexpected');
    const before = serializeSnapshot(r.value);
    const proj = parseProject(profitCenterRaw());
    expect(proj.ok).toBe(true);
    raw.name = 'changed';
    expect(serializeSnapshot(r.value)).toBe(before);
  });
});

describe('run definition and result', () => {
  it('accepts test and full runs with an optional sample', () => {
    const base = {
      id: 'run-1',
      snapshotId: 'snap-1',
      inputs: [{ datasetId: 'ds-cepc', location: { kind: 'localFile', path: 'x.csv' } }],
    };
    expect(
      RunDefinitionSchema.safeParse({
        ...base,
        runType: 'test',
        sample: { kind: 'firstRows', count: 100 },
      }).success,
    ).toBe(true);
    expect(RunDefinitionSchema.safeParse({ ...base, runType: 'full' }).success).toBe(true);
    expect(RunDefinitionSchema.safeParse({ ...base, runType: 'partial' }).success).toBe(false);
  });

  it('result carries per-dataset input counts, per-structure output counts and diagnostics', () => {
    const r = RunResultSchema.safeParse({
      runId: 'run-1',
      status: 'completedWithErrors',
      startedAt: '2026-10-21T11:00:00Z',
      completedAt: '2026-10-21T11:00:05Z',
      inputRecordCounts: { 'ds-cepc': 3 },
      outputRecordCounts: { 'ts-pc': 2, 'ts-cc': 4 },
      warningCount: 0,
      errorCount: 1,
      generatedFiles: [
        { kind: 'output', targetStructureId: 'ts-pc', fileName: 'ProfitCenter.csv', format: 'csv' },
        { kind: 'errors', fileName: 'errors.csv', format: 'csv' },
      ],
      diagnostics: [
        {
          severity: 'error',
          code: 'DATE_INVALID',
          message: 'Invalid date',
          sourceRow: 3,
          sourceValue: '13/45/26',
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe('diagnostic', () => {
  it('needs severity, code and message; context is optional', () => {
    expect(
      DiagnosticSchema.safeParse({ severity: 'warning', code: 'X', message: 'm' }).success,
    ).toBe(true);
    expect(DiagnosticSchema.safeParse({ severity: 'warning', code: 'X' }).success).toBe(false);
  });

  it('rejects an unknown severity and a zero source row', () => {
    expect(DiagnosticSchema.safeParse({ severity: 'fatal', code: 'X', message: 'm' }).success).toBe(
      false,
    );
    expect(
      DiagnosticSchema.safeParse({ severity: 'info', code: 'X', message: 'm', sourceRow: 0 })
        .success,
    ).toBe(false);
  });
});
