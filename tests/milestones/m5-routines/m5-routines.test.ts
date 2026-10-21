import { randomFillSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deserializeProject,
  serializeProject,
  validateProject,
  type Project,
} from '@mms/mapping-core';
import { executeMapping } from '@mms/transformation-engine';
import {
  builtInRoutineDefinitions,
  checkRoutineConfiguration,
  createBuiltInRegistry,
} from '@mms/routine-library';
import { createJavaScriptSandbox, type JavaScriptSandbox } from '@mms/js-sandbox';
import {
  build,
  direct,
  lookupDef,
  routineMapping,
  rstep,
} from '../../../packages/transformation-engine/test/helpers/model.js';

const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const dateCfg = {
  format: 'M/D/YY',
  twoDigitYearPivot: 68,
  specialValues: { '12/31/99': '9999-12-31' },
};

const source = {
  name: 'P',
  fields: ['Id', 'From', 'To', 'Name', 'Qty', 'Country'],
  rows: [
    ['P100', '1/1/26', '12/31/99', '  helsinki central  ', '1.234,50', 'FI'],
    ['P200', '5/1/26', '00000000', null, '10,05', 'SE'],
    ['P300', '13/45/26', '12/31/99', 'x', 'abc', 'XX'],
    ['P400', '', null, '', '', ''],
  ],
};
const targetFields = ['Id', 'From', 'To', 'Name', 'Key', 'Rand', 'Qty', 'Country'];

const js = (target: string, src: string, code: string) => ({
  ...direct(target, src),
  mappingType: 'javascript',
  javascript: { code, declaredLookupIds: ['lk'] },
});

/**
 * M5 demo check: dates convert only with an explicit layout; a chain runs in order; sandboxed JavaScript
 * cannot reach files or network. Real routine library and real sandbox, run through the engine.
 */
describe('M5 routines', () => {
  let sandbox: JavaScriptSandbox;
  beforeAll(async () => {
    sandbox = await createJavaScriptSandbox({ timeoutMs: 300 });
  });
  afterAll(() => sandbox.dispose());

  const registry = createBuiltInRegistry({ randomBytes: (n) => randomFillSync(new Uint8Array(n)) });
  const spec = (over: { fromOnError?: 'stop' | 'continue'; code?: string } = {}) => {
    const { model, data } = build({
      datasets: [source],
      targets: [{ name: 'T', fields: targetFields }],
      lookups: [
        lookupDef('lk', [
          ['FI', 'Finland'],
          ['SE', 'Sweden'],
        ]),
      ],
      mappings: [
        direct('T.Id', 'P.Id'),
        routineMapping('T.From', 'P.From', [
          rstep('date.sapZeroToNull', 0),
          rstep('date.parse', 1, over.fromOnError ?? 'stop', dateCfg),
          rstep('date.format', 2, 'stop', { format: 'YYYYMMDD' }),
        ]),
        routineMapping('T.To', 'P.To', [
          rstep('date.sapZeroToNull', 0),
          rstep('date.parse', 1, 'stop', dateCfg),
          rstep('date.format', 2, 'stop', { format: 'YYYYMMDD' }),
        ]),
        routineMapping('T.Name', 'P.Name', [
          rstep('text.trim', 0),
          rstep('text.upper', 1),
          rstep('text.maxLength', 2, 'stop', { length: 8, onTooLong: 'truncate' }),
        ]),
        routineMapping('T.Key', 'P.Id', [
          rstep('id.deterministicUuid', 0, 'stop', { namespace: NS, salt: 'profit-center' }),
        ]),
        routineMapping('T.Rand', 'P.Id', [rstep('id.uuidV4', 0)]),
        routineMapping('T.Qty', 'P.Qty', [
          rstep('numeric.parse', 0, 'stop', { decimalSeparator: ',', thousandsSeparator: '.' }),
          rstep('numeric.round', 1, 'stop', { decimals: 1 }),
        ]),
        js('T.Country', 'P.Country', over.code ?? "return context.lookup('lk', value) ?? value;"),
      ],
    });
    // Use the library's own routine definitions in the project
    return { model: { ...model, routines: builtInRoutineDefinitions() } as Project, data };
  };
  const run = (options: Parameters<typeof spec>[0] = {}, collectLineage = false) => {
    const { model, data } = spec(options);
    const r = executeMapping(model, data, {
      routines: registry,
      javascript: sandbox.execute,
      collectLineage,
    });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.value;
  };
  const col = (f: string) => targetFields.indexOf(f);
  const rows = (r: ReturnType<typeof run>) => r.targets[0]!.rows.rows;

  it('M5-01 the project with the library routine definitions is valid', () => {
    const { model } = spec();
    expect(validateProject(model)).toEqual([]);
  });

  it('M5-02 dates convert with the explicit layout, zero dates become null, 12/31/99 is "never ends"', () => {
    const r = rows(run());
    expect(r.map((x) => x[col('From')])).toEqual(['20260101', '20260501', null, null]);
    expect(r.map((x) => x[col('To')])).toEqual(['99991231', null, '99991231', null]);
  });

  it('M5-03 an invalid date is a structured error on that row, naming the failing routine; other rows are fine', () => {
    const r = run();
    const bad = r.diagnostics.filter((d) => d.code === 'DATE_INVALID');
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({
      severity: 'error',
      routineId: 'date.parse',
      sourceRow: 3,
      sourceValue: '13/45/26',
      targetStructureId: 'ts-T',
      targetFieldId: 'tf-T.From',
      targetRow: 3,
    });
    expect(bad[0]!.message).toContain('"13/45/26"');
    expect(rows(r)[2]![col('From')]).toBeNull();
    expect(r.targets[0]!.rowStatus[0]).not.toBe('error');
  });

  it('M5-04 onError continue skips the failing step with a warning and keeps going', () => {
    const r = run({ fromOnError: 'continue' });
    expect(rows(r)[2]![col('From')]).toBeNull(); // format step then gets the unparsed text and fails too (stop)
    const w = r.diagnostics.find((d) => d.routineId === 'date.parse');
    expect(w).toMatchObject({ severity: 'warning', code: 'DATE_INVALID' });
  });

  it('M5-05 text and numeric chains run in order', () => {
    const r = rows(run());
    expect(r.map((x) => x[col('Name')])).toEqual(['HELSINKI', null, 'X', '']);
    expect(r.map((x) => x[col('Qty')])).toEqual(['1234.5', '10.1', null, null]);
  });

  it('M5-06 numeric errors do not stop the run', () => {
    const r = run();
    expect(r.diagnostics.find((d) => d.code === 'NUMBER_INVALID')).toMatchObject({
      sourceRow: 3,
      routineId: 'numeric.parse',
      sourceValue: 'abc',
    });
    expect(r.outputRecordCounts).toEqual({ 'ts-T': 4 });
  });

  it('M5-07 deterministic UUIDs repeat and differ per key; UUID v4 is explicitly not repeatable', () => {
    const a = rows(run());
    const b = rows(run());
    expect(a.map((x) => x[col('Key')])).toEqual(b.map((x) => x[col('Key')]));
    expect(new Set(a.map((x) => x[col('Key')])).size).toBe(4);
    expect(a[0]![col('Key')]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a[0]![col('Rand')]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a[0]![col('Rand')]).not.toBe(b[0]![col('Rand')]);
  });

  it('M5-08 sandboxed JavaScript uses the approved lookup helper', () => {
    expect(rows(run()).map((x) => x[col('Country')])).toEqual(['Finland', 'Sweden', 'XX', '']);
  });

  it('M5-09 JavaScript failures are errors on their rows and do not stop the run', () => {
    const r = run({ code: "if (value === 'SE') throw new Error('no Sweden'); return value;" });
    expect(rows(r).map((x) => x[col('Country')])).toEqual(['FI', null, 'XX', '']);
    expect(r.diagnostics.find((d) => d.code === 'JS_RUNTIME_ERROR')).toMatchObject({
      severity: 'error',
      sourceRow: 2,
      targetFieldId: 'tf-T.Country',
    });
    const t = run({ code: 'while (true) {}' });
    expect(t.diagnostics.filter((d) => d.code === 'JS_TIMEOUT')).toHaveLength(4);
    expect(t.outputRecordCounts).toEqual({ 'ts-T': 4 });
  });

  it('M5-10 forbidden capabilities are unreachable from a mapping', () => {
    const r = run({
      code: "return typeof process + typeof require + typeof fetch + (function(){}).constructor('return typeof process')();",
    });
    expect(rows(r).map((x) => x[col('Country')])).toEqual(
      new Array(4).fill('undefinedundefinedundefinedundefined'),
    );
  });

  it('M5-11 the chain survives serialization: a reloaded project gives the identical result', () => {
    const { model, data } = spec();
    const back = deserializeProject(serializeProject(model));
    if (!back.ok) throw new Error(JSON.stringify(back.issues));
    const go = (m: Project) => {
      const r = executeMapping(m, data, { routines: registry, javascript: sandbox.execute });
      if (!r.ok) throw new Error('run failed');
      return r.value.targets[0]!.rows.rows.map((row) =>
        row.filter((_, i) => targetFields[i] !== 'Rand'),
      );
    };
    expect(go(back.value)).toEqual(go(model));
  });

  it('M5-12 lineage lists every step with its input and output', () => {
    const cell = run({}, true).targets[0]!.lineage![0]![col('From')]!;
    expect(cell.steps.map((s) => [s.kind, s.ref, s.input, s.output])).toEqual([
      ['source', undefined, '1/1/26', '1/1/26'],
      ['routine', 'date.sapZeroToNull', '1/1/26', '1/1/26'],
      ['routine', 'date.parse', '1/1/26', '2026-01-01'],
      ['routine', 'date.format', '2026-01-01', '20260101'],
    ]);
  });

  it('M5-13 mistakes in a routine configuration are caught before a run', () => {
    expect(checkRoutineConfiguration('date.parse', dateCfg)).toEqual([]);
    expect(checkRoutineConfiguration('date.parse', { format: 'M/D/YY' })[0]).toMatchObject({
      code: 'ROUTINE_CONFIG_INVALID',
    });
    expect(checkRoutineConfiguration('text.maxLength', {})[0]!.message).toContain('length');
  });
});
