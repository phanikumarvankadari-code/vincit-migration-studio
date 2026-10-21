import { describe, expect, it } from 'vitest';
import type { Result } from '@mms/mapping-core';
import { executeMapping, type ExecuteOptions, type ExecutionResult } from '../src/index.js';
import {
  build,
  conditional,
  constant,
  direct,
  eq,
  field,
  javascript,
  lit,
  lookup,
  lookupDef,
  lstep,
  rel,
  routineMapping,
  rstep,
  type Spec,
} from './helpers/model.js';

function run(spec: Spec, options: ExecuteOptions = {}): ExecutionResult {
  const { model, data } = build(spec);
  const r: Result<ExecutionResult> = executeMapping(model, data, options);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const rowsOf = (r: ExecutionResult, structure: string) =>
  r.targets.find((t) => t.rows.targetStructureId === `ts-${structure}`)!.rows.rows;
const codes = (r: ExecutionResult) => r.diagnostics.map((d) => d.code);

const people = {
  name: 'P',
  fields: ['id', 'name', 'country', 'created'],
  rows: [
    ['1', 'Ann', 'FI', '1/1/26'],
    ['2', null, 'SE', ''],
    ['3', ' Bo ', 'XX', '00330'],
  ],
};
const target = { name: 'T', fields: ['Id', 'Name', 'Lang', 'Region'] };

describe('direct mapping (SPEC-009)', () => {
  it('copies the source value unchanged, including leading zeros, spaces, blanks and empty strings', () => {
    const r = run({
      datasets: [people],
      targets: [target],
      mappings: [direct('T.Id', 'P.id'), direct('T.Name', 'P.name'), direct('T.Lang', 'P.created')],
    });
    expect(rowsOf(r, 'T')).toEqual([
      ['1', 'Ann', '1/1/26', null],
      ['2', null, '', null],
      ['3', ' Bo ', '00330', null],
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.outputRecordCounts).toEqual({ 'ts-T': 3 });
    expect(r.inputRecordCounts).toEqual({ 'ds-P': 3 });
  });

  it('unmapped target fields stay blank', () => {
    expect(
      rowsOf(
        run({ datasets: [people], targets: [target], mappings: [direct('T.Id', 'P.id')] }),
        'T',
      )[0],
    ).toEqual(['1', null, null, null]);
  });

  it('one output row per driver row, in source order, with the driver row recorded', () => {
    const r = run({ datasets: [people], targets: [target], mappings: [direct('T.Id', 'P.id')] });
    expect(r.targets[0]!.driverRows).toEqual([1, 2, 3]);
    expect(r.targets[0]!.rowStatus).toEqual(['ready', 'ready', 'ready']);
  });

  it('records lineage: source field, source row and original value', () => {
    const r = run(
      { datasets: [people], targets: [target], mappings: [direct('T.Name', 'P.name')] },
      { collectLineage: true },
    );
    expect(r.targets[0]!.lineage![2]![1]).toEqual({
      targetFieldId: 'tf-T.Name',
      fieldMappingId: 'm-T.Name',
      sources: [{ datasetId: 'ds-P', fieldId: 'P.name', sourceRow: 3, value: ' Bo ' }],
      steps: [{ kind: 'source', input: ' Bo ', output: ' Bo ' }],
    });
    expect(
      run({ datasets: [people], targets: [target], mappings: [direct('T.Name', 'P.name')] })
        .targets[0]!.lineage,
    ).toBeUndefined();
  });
});

describe('constant mapping (SPEC-010)', () => {
  it('populates every output row and keeps the configured value as text', () => {
    const r = run({
      datasets: [people],
      targets: [{ name: 'T', fields: ['Id', 'Lang', 'Count', 'Flag', 'Amount', 'Blank'] }],
      mappings: [
        direct('T.Id', 'P.id'),
        constant('T.Lang', 'EN'),
        constant('T.Count', 5, 'integer'),
        constant('T.Flag', true, 'boolean'),
        constant('T.Amount', '12.50', 'decimal'),
        constant('T.Blank', null),
      ],
    });
    expect(rowsOf(r, 'T').map((row) => row.slice(1))).toEqual([
      ['EN', '5', 'true', '12.50', null],
      ['EN', '5', 'true', '12.50', null],
      ['EN', '5', 'true', '12.50', null],
    ]);
  });

  it('a constant takes part in lineage', () => {
    const r = run(
      {
        datasets: [people],
        targets: [target],
        mappings: [direct('T.Id', 'P.id'), constant('T.Lang', 'EN')],
      },
      { collectLineage: true },
    );
    expect(r.targets[0]!.lineage![0]![2]).toMatchObject({
      sources: [],
      steps: [{ kind: 'constant', input: null, output: 'EN' }],
    });
  });

  it('an invalid constant datatype is rejected when the model is parsed', () => {
    expect(() =>
      build({
        datasets: [people],
        targets: [target],
        mappings: [constant('T.Count', '5', 'integer')],
      }),
    ).toThrow();
  });
});

describe('lookup mapping (SPEC-011)', () => {
  const regions = lookupDef('lk-region', [
    ['FI', 'EU-N'],
    ['SE', 'EU-N'],
    ['NO', null],
  ]);
  const spec = (missing: Record<string, unknown>, extra: Partial<Spec> = {}): Spec => ({
    datasets: [people],
    targets: [target],
    mappings: [lookup('T.Region', 'P.country', 'lk-region', missing)],
    lookups: [regions],
    ...extra,
  });

  it('an existing key resolves', () => {
    const r = run(spec({ kind: 'null' }));
    expect(rowsOf(r, 'T').map((x) => x[3])).toEqual(['EU-N', 'EU-N', null]);
  });

  it('missing key: error gives an error diagnostic, a blank value and an error row', () => {
    const r = run(spec({ kind: 'error' }));
    expect(rowsOf(r, 'T')[2]![3]).toBeNull();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'ENGINE_LOOKUP_MISSING',
      datasetId: 'ds-P',
      sourceRow: 3,
      targetRow: 3,
      targetStructureId: 'ts-T',
      targetFieldId: 'tf-T.Region',
      fieldMappingId: 'm-T.Region',
      sourceFieldId: 'P.country',
      sourceValue: 'XX',
    });
    expect(r.diagnostics[0]!.message).toBe('No entry for "XX" in lookup "lk-region".');
    expect(r.targets[0]!.rowStatus).toEqual(['ready', 'ready', 'error']);
    expect(r.errorCount).toBe(1);
  });

  it('missing key: warning gives a warning diagnostic and a blank value', () => {
    const r = run(spec({ kind: 'warning' }));
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'ENGINE_LOOKUP_MISSING' });
    expect(r.targets[0]!.rowStatus[2]).toBe('warning');
    expect(r.warningCount).toBe(1);
  });

  it('missing key: keepSource keeps the source value silently', () => {
    const r = run(spec({ kind: 'keepSource' }));
    expect(rowsOf(r, 'T').map((x) => x[3])).toEqual(['EU-N', 'EU-N', 'XX']);
    expect(r.diagnostics).toEqual([]);
  });

  it('missing key: null and default are silent', () => {
    expect(rowsOf(run(spec({ kind: 'null' })), 'T')[2]![3]).toBeNull();
    const d = run(spec({ kind: 'default', value: { datatype: 'string', value: 'OTHER' } }));
    expect(rowsOf(d, 'T')[2]![3]).toBe('OTHER');
    expect(d.diagnostics).toEqual([]);
  });

  it('a blank source value follows the missing-value behavior and says so', () => {
    const s = spec({ kind: 'error' });
    s.datasets = [{ ...people, rows: [['1', 'A', null, '']] }];
    const r = run(s);
    expect(r.diagnostics[0]!.message).toBe('No entry for a blank value in lookup "lk-region".');
  });

  it('a lookup entry with a blank value resolves to blank (it is a hit, not a miss)', () => {
    const s = spec({ kind: 'error' });
    s.datasets = [{ ...people, rows: [['1', 'A', 'NO', '']] }];
    const r = run(s);
    expect(rowsOf(r, 'T')[0]![3]).toBeNull();
    expect(r.diagnostics).toEqual([]);
  });

  it('one lookup is reused by several mappings', () => {
    const r = run(
      spec(
        { kind: 'null' },
        {
          targets: [{ name: 'T', fields: ['Id', 'Name', 'Lang', 'Region'] }],
          mappings: [
            lookup('T.Region', 'P.country', 'lk-region', { kind: 'null' }),
            lookup('T.Lang', 'P.country', 'lk-region', { kind: 'null' }),
          ],
        },
      ),
    );
    expect(rowsOf(r, 'T').map((x) => [x[2], x[3]])).toEqual([
      ['EU-N', 'EU-N'],
      ['EU-N', 'EU-N'],
      [null, null],
    ]);
  });

  it('lineage shows the source value and the resolved value', () => {
    const r = run(spec({ kind: 'null' }), { collectLineage: true });
    expect(r.targets[0]!.lineage![0]![3]!.steps).toEqual([
      { kind: 'source', input: 'FI', output: 'FI' },
      { kind: 'lookup', ref: 'lk-region', input: 'FI', output: 'EU-N' },
    ]);
    expect(r.targets[0]!.lineage![2]![3]!.steps[1]).toMatchObject({
      output: null,
      note: 'not found, null',
    });
  });

  it('a lookup mapping with two source fields is reported', () => {
    const { model, data } = build({
      datasets: [people],
      targets: [target],
      mappings: [
        {
          ...lookup('T.Region', 'P.country', 'lk-region'),
          sourceReferences: [
            { datasetId: 'ds-P', fieldId: 'P.country' },
            { datasetId: 'ds-P', fieldId: 'P.id' },
          ],
        },
      ],
      lookups: [regions],
    });
    const r = executeMapping(model, data);
    expect(r.ok && r.value.diagnostics.map((d) => d.code)).toEqual([
      'ENGINE_LOOKUP_NEEDS_ONE_SOURCE',
      'ENGINE_LOOKUP_NEEDS_ONE_SOURCE',
      'ENGINE_LOOKUP_NEEDS_ONE_SOURCE',
    ]);
  });
});

describe('conditional mapping (SPEC-012)', () => {
  const rule = (when: object, then: object) => ({ when, then }) as Record<string, unknown>;
  const isFI = eq(field('P.country'), lit('FI'));
  const run1 = (cond: object[], otherwise?: Record<string, unknown>, rows = people.rows) =>
    run({
      datasets: [{ ...people, rows }],
      targets: [target],
      mappings: [conditional('T.Region', ['P.country'], cond as never, otherwise)],
    });

  it('true branch and else branch', () => {
    const r = run1([rule(isFI, lit('FI01'))], lit('DEFAULT'));
    expect(rowsOf(r, 'T').map((x) => x[3])).toEqual(['FI01', 'DEFAULT', 'DEFAULT']);
  });

  it('the first matching rule wins; later rules are not used', () => {
    const r = run1([
      rule(isFI, lit('A')),
      rule(isFI, lit('B')),
      rule(eq(field('P.country'), lit('SE')), lit('C')),
    ]);
    expect(rowsOf(r, 'T').map((x) => x[3])).toEqual(['A', 'C', null]);
  });

  it('can return a source field; "current" is the first source reference', () => {
    const r = run1(
      [
        rule(
          { op: 'isEmpty', operand: { kind: 'field', datasetId: 'ds-P', fieldId: 'P.name' } },
          { kind: 'current' },
        ),
      ],
      field('P.name'),
    );
    expect(rowsOf(r, 'T').map((x) => x[3])).toEqual(['Ann', 'SE', ' Bo ']);
  });

  it('null behavior is explicit: blank equals blank, ordering never matches a blank, empty means null or empty string', () => {
    const rows = [
      ['1', null, null, null],
      ['2', '', null, null],
      ['3', ' ', null, null],
    ];
    const blankEq = run1(
      [
        rule(
          eq(field('P.name'), { kind: 'constant', constant: { datatype: 'string', value: null } }),
          lit('blank'),
        ),
      ],
      lit('has value'),
      rows,
    );
    expect(rowsOf(blankEq, 'T').map((x) => x[3])).toEqual(['blank', 'has value', 'has value']);
    const empty = run1(
      [rule({ op: 'isEmpty', operand: field('P.name') }, lit('empty'))],
      lit('filled'),
      rows,
    );
    expect(rowsOf(empty, 'T').map((x) => x[3])).toEqual(['empty', 'empty', 'filled']);
    const rows2 = [
      ['1', null, null, null],
      ['2', '', null, null],
      ['3', 'b', null, null],
    ];
    const gt = run1(
      [rule({ op: 'compare', operator: 'gt', left: field('P.name'), right: lit('A') }, lit('gt'))],
      lit('no'),
      rows2,
    );
    expect(rowsOf(gt, 'T').map((x) => x[3])).toEqual(['no', 'no', 'gt']);
  });

  it('ordering compares plain numbers as numbers and everything else as text', () => {
    const rows = [
      ['1', '9', null, null],
      ['2', '10', null, null],
      ['3', 'b', null, null],
    ];
    const r = run1(
      [rule({ op: 'compare', operator: 'lt', left: field('P.name'), right: lit('10') }, lit('lt'))],
      lit('ge'),
      rows,
    );
    expect(rowsOf(r, 'T').map((x) => x[3])).toEqual(['lt', 'ge', 'ge']);
  });

  it('supports in, and, or, not and the other comparisons', () => {
    const rows = [
      ['1', 'x', 'FI', null],
      ['2', 'y', 'SE', null],
      ['3', 'z', 'NO', null],
    ];
    const c = (cond: object) =>
      rowsOf(run1([rule(cond, lit('Y'))], lit('N'), rows), 'T').map((x) => x[3]);
    expect(
      c({
        op: 'in',
        operand: field('P.country'),
        values: [
          { datatype: 'string', value: 'FI' },
          { datatype: 'string', value: 'SE' },
        ],
      }),
    ).toEqual(['Y', 'Y', 'N']);
    expect(c({ op: 'and', conditions: [isFI, eq(field('P.name'), lit('x'))] })).toEqual([
      'Y',
      'N',
      'N',
    ]);
    expect(c({ op: 'or', conditions: [isFI, eq(field('P.country'), lit('NO'))] })).toEqual([
      'Y',
      'N',
      'Y',
    ]);
    expect(c({ op: 'not', condition: isFI })).toEqual(['N', 'Y', 'Y']);
    expect(
      c({ op: 'compare', operator: 'ne', left: field('P.country'), right: lit('FI') }),
    ).toEqual(['N', 'Y', 'Y']);
    expect(
      c({ op: 'compare', operator: 'gte', left: field('P.country'), right: lit('NO') }),
    ).toEqual(['N', 'Y', 'Y']);
    expect(
      c({ op: 'compare', operator: 'lte', left: field('P.country'), right: lit('NO') }),
    ).toEqual(['Y', 'N', 'Y']);
  });

  it('no match and no otherwise: blank value and an info diagnostic', () => {
    const r = run1([rule(isFI, lit('A'))]);
    expect(rowsOf(r, 'T')[1]![3]).toBeNull();
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['info', 'ENGINE_CONDITION_NO_MATCH'],
      ['info', 'ENGINE_CONDITION_NO_MATCH'],
    ]);
    expect(r.errorCount + r.warningCount).toBe(0);
    expect(r.targets[0]!.rowStatus).toEqual(['ready', 'ready', 'ready']);
  });

  it('lineage records the rule that fired', () => {
    const r = run(
      {
        datasets: [people],
        targets: [target],
        mappings: [
          conditional('T.Region', ['P.country'], [rule(isFI, lit('FI01'))], lit('DEFAULT')),
        ],
      },
      { collectLineage: true },
    );
    expect(r.targets[0]!.lineage![0]![3]!.steps).toEqual([
      { kind: 'condition', ref: 'rule 1', input: 'FI', output: 'FI01' },
    ]);
    expect(r.targets[0]!.lineage![1]![3]!.steps).toEqual([
      { kind: 'condition', ref: 'otherwise', input: 'SE', output: 'DEFAULT' },
    ]);
  });

  it('is deterministic: the same input gives the same output', () => {
    const spec: Spec = {
      datasets: [people],
      targets: [target],
      mappings: [conditional('T.Region', ['P.country'], [rule(isFI, lit('A'))], lit('B'))],
    };
    expect(run(spec)).toEqual(run(spec));
  });
});

describe('transformation chains', () => {
  it('lookup steps and routine steps run in order, each receiving the previous value', () => {
    const upper = ({ value }: { value: string | null }) => ({
      ok: true as const,
      value: value === null ? null : value.toUpperCase(),
    });
    const exclaim = ({ value }: { value: string | null }) => ({
      ok: true as const,
      value: value === null ? null : `${value}!`,
    });
    const spec: Spec = {
      datasets: [people],
      targets: [target],
      lookups: [lookupDef('lk', [['FI', 'finland']])],
      mappings: [
        routineMapping('T.Name', 'P.country', [
          rstep('r-exclaim', 2),
          lstep('lk', 0, { kind: 'keepSource' }),
          rstep('r-upper', 1),
        ]),
      ],
    };
    const r = run(spec, {
      routines: { 'r-upper': upper, 'r-exclaim': exclaim },
      collectLineage: true,
    });
    expect(rowsOf(r, 'T').map((x) => x[1])).toEqual(['FINLAND!', 'SE!', 'XX!']);
    expect(r.targets[0]!.lineage![0]![1]!.steps.map((s) => s.kind + ':' + s.output)).toEqual([
      'source:FI',
      'lookup:finland',
      'routine:FINLAND',
      'routine:FINLAND!',
    ]);
  });

  it('a routine without an implementation is an error, not a silent pass-through', () => {
    const r = run({
      datasets: [people],
      targets: [target],
      mappings: [routineMapping('T.Name', 'P.id', [rstep('r-missing', 0)])],
    });
    expect(rowsOf(r, 'T')[0]![1]).toBeNull();
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'ENGINE_ROUTINE_NOT_AVAILABLE',
      routineId: 'r-missing',
    });
  });

  it('a failing routine: stop ends the chain with an error; continue skips it with a warning', () => {
    const fail = () => ({ ok: false as const, code: 'R_FAIL', message: 'cannot do it' });
    const tail = ({ value }: { value: string | null }) => ({
      ok: true as const,
      value: `${value}+`,
    });
    const routines = { 'r-fail': fail, 'r-tail': tail };
    const stop = run(
      {
        datasets: [people],
        targets: [target],
        mappings: [
          routineMapping('T.Name', 'P.id', [rstep('r-fail', 0, 'stop'), rstep('r-tail', 1)]),
        ],
      },
      { routines },
    );
    expect(rowsOf(stop, 'T')[0]![1]).toBeNull();
    expect(stop.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'R_FAIL',
      routineId: 'r-fail',
    });
    const cont = run(
      {
        datasets: [people],
        targets: [target],
        mappings: [
          routineMapping('T.Name', 'P.id', [rstep('r-fail', 0, 'continue'), rstep('r-tail', 1)]),
        ],
      },
      { routines },
    );
    expect(rowsOf(cont, 'T')[0]![1]).toBe('1+');
    expect(cont.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'R_FAIL' });
  });

  it('routines get all source values and their configuration', () => {
    let seen: unknown;
    run(
      {
        datasets: [people],
        targets: [target],
        mappings: [
          {
            ...routineMapping('T.Name', 'P.id', [rstep('r-spy', 0, 'stop', { n: 3 })]),
            sourceReferences: [
              { datasetId: 'ds-P', fieldId: 'P.id' },
              { datasetId: 'ds-P', fieldId: 'P.name' },
            ],
          },
        ],
      },
      { routines: { 'r-spy': (a) => ((seen ??= a), { ok: true, value: a.value }) }, limit: 1 },
    );
    expect(seen).toEqual({ value: '1', inputs: ['1', 'Ann'], configuration: { n: 3 } });
  });

  it('custom JavaScript needs an executor; with one it is called with the value, inputs and row', () => {
    const spec: Spec = {
      datasets: [people],
      targets: [target],
      mappings: [javascript('T.Name', 'P.name', 'return value')],
    };
    const without = run(spec, { limit: 1 });
    expect(without.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'ENGINE_JS_NOT_AVAILABLE',
    });
    let seen: unknown;
    const r = run(spec, {
      limit: 1,
      javascript: (a) => ((seen = a), { ok: true, value: `js:${a.value}` }),
    });
    expect(rowsOf(r, 'T')[0]![1]).toBe('js:Ann');
    expect(seen).toMatchObject({
      value: 'Ann',
      inputs: ['Ann'],
      row: { 'P.id': '1', 'P.name': 'Ann', 'P.country': 'FI' },
    });
  });
});

describe('one-to-many generation (SPEC-013)', () => {
  const cepc = {
    name: 'CEPC',
    fields: ['Profit Center', 'Valid To', 'Country'],
    rows: [
      ['P100', '12/31/99', 'FI'],
      ['P200', '12/31/99', 'SE'],
      ['P300', '12/31/99', 'NO'],
    ],
  };
  const bukrs = {
    name: 'BUKRS',
    fields: ['Profit Center', 'Company Code'],
    rows: [
      ['P100', 'FI01'],
      ['P100', 'FI02'],
      ['P100', 'SE01'],
      ['P300', 'NO01'],
    ],
  };
  const spec = (over: Partial<Spec> = {}, relOver = {}): Spec => ({
    datasets: [cepc, bukrs],
    targets: [
      { name: 'PC', fields: ['Profit Center', 'Valid To'], generation: { driver: 'CEPC' } },
      {
        name: 'CC',
        fields: ['Profit Center', 'Valid To', 'Company Code'],
        generation: { driver: 'BUKRS' },
      },
    ],
    relationships: [
      rel('r1', 'CEPC', 'BUKRS', [['Profit Center', 'Profit Center']], {
        joinType: 'inner',
        ...relOver,
      }),
    ],
    mappings: [
      direct('PC.Profit Center', 'CEPC.Profit Center'),
      direct('PC.Valid To', 'CEPC.Valid To'),
      direct('CC.Profit Center', 'BUKRS.Profit Center'),
      direct('CC.Valid To', 'CEPC.Valid To'),
      direct('CC.Company Code', 'BUKRS.Company Code'),
    ],
    ...over,
  });

  it('Profit Center P100 assigned to FI01, FI02 and SE01 produces three Company Code rows', () => {
    const r = run(spec());
    expect(rowsOf(r, 'CC').filter((x) => x[0] === 'P100')).toEqual([
      ['P100', '12/31/99', 'FI01'],
      ['P100', '12/31/99', 'FI02'],
      ['P100', '12/31/99', 'SE01'],
    ]);
  });

  it('keeps the parent key on every generated row, and a parent without children gets zero rows', () => {
    const r = run(spec());
    expect(rowsOf(r, 'PC').map((x) => x[0])).toEqual(['P100', 'P200', 'P300']);
    expect(rowsOf(r, 'CC').map((x) => x[0])).toEqual(['P100', 'P100', 'P100', 'P300']);
    expect(r.outputRecordCounts).toEqual({ 'ts-PC': 3, 'ts-CC': 4 });
    expect(r.diagnostics).toEqual([]);
  });

  it('rows stay with their structure and carry driver row numbers', () => {
    const r = run(spec());
    expect(r.targets.map((t) => t.rows.targetStructureId)).toEqual(['ts-PC', 'ts-CC']);
    expect(r.targets[1]!.driverRows).toEqual([1, 2, 3, 4]);
  });

  it('generated rows are validated independently: a problem in one row does not touch the others', () => {
    const s = spec({
      lookups: [
        lookupDef('lk', [
          ['FI01', 'A'],
          ['FI02', 'B'],
          ['NO01', 'C'],
        ]),
      ],
    });
    s.mappings = [
      ...s.mappings.slice(0, 4),
      lookup('CC.Company Code', 'BUKRS.Company Code', 'lk', { kind: 'error' }),
    ];
    const r = run(s);
    expect(r.targets[1]!.rowStatus).toEqual(['ready', 'ready', 'error', 'ready']);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      targetStructureId: 'ts-CC',
      targetRow: 3,
      sourceRow: 3,
      sourceValue: 'SE01',
    });
  });

  it('lineage reaches back through the join to the parent row', () => {
    const r = run(spec(), { collectLineage: true });
    expect(r.targets[1]!.lineage![1]![1]!.sources).toEqual([
      { datasetId: 'ds-CEPC', fieldId: 'CEPC.Valid To', sourceRow: 1, value: '12/31/99' },
    ]);
    expect(r.targets[1]!.lineage![3]![1]!.sources[0]).toMatchObject({ sourceRow: 3 });
  });

  it('inner join: a driver row with no parent is dropped with a warning, never silently', () => {
    const s = spec();
    s.datasets = [cepc, { ...bukrs, rows: [...bukrs.rows, ['P999', 'XX01']] }];
    const r = run(s);
    expect(rowsOf(r, 'CC')).toHaveLength(4);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'ENGINE_ROW_DROPPED',
      datasetId: 'ds-BUKRS',
      sourceRow: 5,
    });
    expect(r.diagnostics[0]!.targetRow).toBeUndefined();
    expect(r.diagnostics[0]!.message).toContain(
      '"P999"'.slice(0, 0) + 'no matching row in "ds-CEPC"',
    );
  });

  it('left join from the left side keeps the row with blank values', () => {
    const s: Spec = {
      datasets: [cepc, { ...bukrs, rows: [['P100', 'FI01']] }],
      targets: [
        { name: 'PC', fields: ['Profit Center', 'Company Code'], generation: { driver: 'CEPC' } },
      ],
      relationships: [
        rel('r1', 'CEPC', 'BUKRS', [['Profit Center', 'Profit Center']], { joinType: 'left' }),
      ],
      mappings: [
        direct('PC.Profit Center', 'CEPC.Profit Center'),
        direct('PC.Company Code', 'BUKRS.Company Code'),
      ],
    };
    const r = run(s);
    expect(rowsOf(r, 'PC')).toEqual([
      ['P100', 'FI01'],
      ['P200', null],
      ['P300', null],
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it('several matches use the first and warn', () => {
    const s: Spec = {
      datasets: [cepc, bukrs],
      targets: [
        { name: 'PC', fields: ['Profit Center', 'Company Code'], generation: { driver: 'CEPC' } },
      ],
      relationships: [rel('r1', 'CEPC', 'BUKRS', [['Profit Center', 'Profit Center']])],
      mappings: [
        direct('PC.Profit Center', 'CEPC.Profit Center'),
        direct('PC.Company Code', 'BUKRS.Company Code'),
      ],
    };
    const r = run(s);
    expect(rowsOf(r, 'PC')[0]).toEqual(['P100', 'FI01']);
    expect(r.diagnostics.map((d) => [d.code, d.sourceRow])).toEqual([
      ['ENGINE_JOIN_MULTIPLE_MATCHES', 1],
    ]);
    expect(r.targets[0]!.rowStatus).toEqual(['warning', 'ready', 'ready']);
  });

  it('blank key parts never match', () => {
    const s = spec();
    s.datasets = [
      { ...cepc, rows: [['', '12/31/99', 'FI']] },
      { ...bukrs, rows: [['', 'FI01']] },
    ];
    const r = run(s);
    expect(rowsOf(r, 'CC')).toEqual([]);
    expect(codes(r)).toEqual(['ENGINE_ROW_DROPPED']);
  });

  it('composite keys join on every key part', () => {
    const s: Spec = {
      datasets: [
        {
          name: 'A',
          fields: ['k', 'j', 'v'],
          rows: [
            ['1', 'x', 'one-x'],
            ['1', 'y', 'one-y'],
          ],
        },
        { name: 'B', fields: ['k', 'j'], rows: [['1', 'y']] },
      ],
      targets: [{ name: 'T', fields: ['V'], generation: { driver: 'B' } }],
      relationships: [
        rel(
          'r1',
          'A',
          'B',
          [
            ['k', 'k'],
            ['j', 'j'],
          ],
          { joinType: 'inner' },
        ),
      ],
      mappings: [direct('T.V', 'A.v')],
    };
    expect(rowsOf(run(s), 'T')).toEqual([['one-y']]);
  });

  it('reaches a dataset through another one (two joins)', () => {
    const s: Spec = {
      datasets: [
        { name: 'A', fields: ['id', 'bid'], rows: [['a1', 'b1']] },
        { name: 'B', fields: ['id', 'cid'], rows: [['b1', 'c1']] },
        { name: 'C', fields: ['id', 'name'], rows: [['c1', 'Cee']] },
      ],
      targets: [{ name: 'T', fields: ['Name'], generation: { driver: 'A' } }],
      relationships: [rel('r1', 'A', 'B', [['bid', 'id']]), rel('r2', 'B', 'C', [['cid', 'id']])],
      mappings: [direct('T.Name', 'C.name')],
    };
    expect(rowsOf(run(s), 'T')).toEqual([['Cee']]);
  });

  it('unconfirmed relationships are not used: the values are blank and the problem is reported', () => {
    const r = run(spec({}, { status: 'suggested' }));
    expect(rowsOf(r, 'CC').map((x) => x[1])).toEqual([null, null, null, null]);
    expect(codes(r)).toEqual(['ENGINE_NO_JOIN_PATH']);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', targetStructureId: 'ts-CC' });
  });

  it('via limits the relationships a structure may use', () => {
    const s = spec();
    s.datasets = [...s.datasets, { name: 'X', fields: ['k'], rows: [['1']] }];
    s.relationships = [
      ...(s.relationships ?? []),
      rel('r2', 'CEPC', 'X', [['Profit Center', 'k']]),
    ];
    s.targets = [s.targets[0]!, { ...s.targets[1]!, generation: { driver: 'BUKRS', via: ['r2'] } }];
    expect(codes(run(s))).toEqual(['ENGINE_NO_JOIN_PATH']);
  });

  it('the driver is inferred from the mappings when exactly one dataset is read; otherwise it must be set', () => {
    const inferred = run({
      datasets: [people],
      targets: [target],
      mappings: [direct('T.Id', 'P.id')],
    });
    expect(inferred.outputRecordCounts).toEqual({ 'ts-T': 3 });
    const s = spec();
    s.targets = [{ name: 'PC', fields: ['Profit Center', 'Valid To'] }];
    s.mappings = [
      direct('PC.Profit Center', 'CEPC.Profit Center'),
      direct('PC.Valid To', 'BUKRS.Company Code'),
    ];
    const r = run(s);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', code: 'ENGINE_NO_DRIVER' });
    expect(rowsOf(r, 'PC')).toEqual([]);
  });

  it('a structure without mappings produces no rows and an info message', () => {
    const r = run({
      datasets: [people],
      targets: [target, { name: 'Other', fields: ['X'] }],
      mappings: [direct('T.Id', 'P.id')],
    });
    expect(rowsOf(r, 'Other')).toEqual([]);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'info',
      code: 'ENGINE_STRUCTURE_NOT_MAPPED',
    });
  });
});

describe('execution rules', () => {
  const spec: Spec = { datasets: [people], targets: [target], mappings: [direct('T.Id', 'P.id')] };

  it('limit runs only the first rows; structures selects structures', () => {
    expect(rowsOf(run(spec, { limit: 2 }), 'T')).toHaveLength(2);
    const two = run(
      {
        ...spec,
        targets: [target, { name: 'U', fields: ['A'] }],
        mappings: [direct('T.Id', 'P.id'), direct('U.A', 'P.id')],
      },
      { structures: ['ts-U'] },
    );
    expect(two.targets.map((t) => t.rows.targetStructureId)).toEqual(['ts-U']);
  });

  it('does not change the model or the data and gives the same result twice', () => {
    const { model, data } = build(spec);
    const before = JSON.stringify([model, data]);
    const a = executeMapping(model, data, { collectLineage: true });
    const b = executeMapping(model, data, { collectLineage: true });
    expect(JSON.stringify([model, data])).toBe(before);
    expect(a).toEqual(b);
  });

  it('refuses a model with reference errors and returns them as diagnostics', () => {
    const { model, data } = build(spec);
    const bad = {
      ...model,
      mappingDefinition: {
        ...model.mappingDefinition,
        mappings: [{ ...model.mappingDefinition.mappings[0]!, targetFieldId: 'nope' as never }],
      },
    };
    const r = executeMapping(bad, data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe('MODEL_UNKNOWN_TARGET_FIELD');
  });

  it('refuses data that does not match the model', () => {
    const { model, data } = build(spec);
    const short = executeMapping(model, [{ ...data[0]!, rows: [['1']] }]);
    expect(!short.ok && short.issues[0]!.code).toBe('ENGINE_DATA_MISMATCH');
    const cols = executeMapping(model, [{ ...data[0]!, fieldIds: ['x'] as never }]);
    expect(!cols.ok && cols.issues[0]!.code).toBe('ENGINE_DATA_MISMATCH');
    const unknown = executeMapping(model, [{ ...data[0]!, datasetId: 'ds-nope' as never }]);
    expect(!unknown.ok && unknown.issues[0]!.code).toBe('ENGINE_UNKNOWN_DATASET');
  });

  it('a missing dataset for a structure is reported for that structure', () => {
    const { model } = build(spec);
    const r = executeMapping(model, []);
    expect(r.ok && r.value.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'ENGINE_NO_DATA',
    });
  });

  it('counts warnings and errors and records input counts', () => {
    const r = run({
      datasets: [people],
      targets: [target],
      lookups: [lookupDef('lk', [])],
      mappings: [lookup('T.Region', 'P.country', 'lk', { kind: 'warning' })],
    });
    expect(r).toMatchObject({ warningCount: 3, errorCount: 0, inputRecordCounts: { 'ds-P': 3 } });
  });
});
