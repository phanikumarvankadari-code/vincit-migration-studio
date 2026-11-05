import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '@mms/mapping-core';
import { executeMapping, type ExecutionResult } from '@mms/transformation-engine';
import {
  build,
  direct,
  rel,
  routineMapping,
  rstep,
  type Spec,
} from '../../transformation-engine/test/helpers/model.js';
import { createBuiltInRegistry } from '../src/index.js';

const routines = createBuiltInRegistry();
const sapToIso = {
  inputFormat: 'yyyyMMdd',
  outputFormat: 'yyyy-MM-dd',
  invalidValueBehavior: 'blank',
  specialValues: { '00000000': '' },
};
const dateStep = (order: number, configuration: Record<string, unknown> = sapToIso) =>
  rstep('date.convert', order, 'stop', configuration as never);

/** Saves the project as .mms.json text, loads it again, and runs the reloaded copy. */
function runAfterReload(spec: Spec): ExecutionResult {
  const { model, data } = build(spec);
  const reloaded = deserializeProject(serializeProject(model));
  if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.issues));
  const r = executeMapping(reloaded.value, data, { routines });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const rowsOf = (r: ExecutionResult, s: string) =>
  r.targets.find((t) => t.rows.targetStructureId === `ts-${s}`)!.rows.rows;

const cepc = {
  name: 'CEPC',
  fields: ['Profit Center', 'DATAB', 'DATBI'],
  rows: [
    ['P100', '20260101', '99991231'],
    ['P200', '20261105', '00000000'],
    ['P300', '20260229', ''],
  ] as (string | null)[][],
};

describe('Date Format in a saved mapping', () => {
  const spec: Spec = {
    datasets: [cepc],
    targets: [{ name: 'PC', fields: ['Profit Center', 'Valid From', 'Valid To', 'Raw'] }],
    mappings: [
      direct('PC.Profit Center', 'CEPC.Profit Center'),
      routineMapping('PC.Valid From', 'CEPC.DATAB', [dateStep(0)]),
      routineMapping('PC.Valid To', 'CEPC.DATBI', [dateStep(0)]),
      direct('PC.Raw', 'CEPC.DATBI'),
    ],
  };

  it('keeps the configuration in the .mms.json text and runs the same after reload', () => {
    const text = serializeProject(build(spec).model);
    expect(text).toContain('"date.convert"');
    expect(text).toContain('"yyyyMMdd"');
    expect(rowsOf(runAfterReload(spec), 'PC')).toEqual([
      ['P100', '2026-01-01', '9999-12-31', '99991231'],
      ['P200', '2026-11-05', null, '00000000'],
      ['P300', null, null, ''],
    ]);
  });

  it('direct mappings, and the empty transformations list, stay direct', () => {
    const { model } = build(spec);
    const m = model.mappingDefinition.mappings.find((x) => x.targetFieldId === 'tf-PC.Raw')!;
    expect(m).toMatchObject({ mappingType: 'direct', transformations: [] });
  });

  it('runs the steps in their order', () => {
    const toDotted = {
      inputFormat: 'yyyy-MM-dd',
      outputFormat: 'dd.MM.yyyy',
      invalidValueBehavior: 'error',
    };
    const mk = (a: number, b: number): Spec => ({
      datasets: [cepc],
      targets: [{ name: 'PC', fields: ['V'] }],
      mappings: [routineMapping('PC.V', 'CEPC.DATAB', [dateStep(a), dateStep(b, toDotted)])],
    });
    expect(rowsOf(runAfterReload(mk(0, 1)), 'PC')[0]).toEqual(['01.01.2026']);
    const wrong = runAfterReload(mk(1, 0));
    expect(rowsOf(wrong, 'PC')[0]).toEqual([null]);
    expect(wrong.diagnostics.some((d) => d.code.startsWith('DATE_INVALID'))).toBe(true);
  });

  it('reports an invalid date as an error when asked to', () => {
    const r = runAfterReload({
      datasets: [cepc],
      targets: [{ name: 'PC', fields: ['V'] }],
      mappings: [
        routineMapping('PC.V', 'CEPC.DATAB', [
          dateStep(0, { ...sapToIso, invalidValueBehavior: 'error' }),
        ]),
      ],
    });
    expect(rowsOf(r, 'PC').map((x) => x[0])).toEqual(['2026-01-01', '2026-11-05', null]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['DATE_INVALID']);
  });
});

describe('a field reached through a relationship', () => {
  it('Company Codes takes the end date from CEPC through the Profit Center relationship', () => {
    const r = runAfterReload({
      datasets: [
        {
          ...cepc,
          rows: [
            ['P100', '20260101', '99991231'],
            ['P200', '20260101', '20261231'],
          ],
        },
        {
          name: 'CEPC_BUKRS',
          fields: ['Profit Center', 'Company Code'],
          rows: [
            ['P100', 'FI01'],
            ['P200', 'SE01'],
          ],
        },
      ],
      targets: [
        {
          name: 'CC',
          fields: ['Company Code', 'Validity End Date'],
          generation: { driver: 'CEPC_BUKRS' },
        },
      ],
      relationships: [rel('r1', 'CEPC_BUKRS', 'CEPC', [['Profit Center', 'Profit Center']])],
      mappings: [
        direct('CC.Company Code', 'CEPC_BUKRS.Company Code'),
        routineMapping('CC.Validity End Date', 'CEPC.DATBI', [dateStep(0)]),
      ],
    });
    expect(rowsOf(r, 'CC')).toEqual([
      ['FI01', '9999-12-31'],
      ['SE01', '2026-12-31'],
    ]);
    expect(r.diagnostics).toEqual([]);
  });
});
