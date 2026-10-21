import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TargetDefinitionSchema, type Result } from '@mms/mapping-core';
import { importCsv, importXlsx } from '@mms/file-import';
import {
  detectTargetLayout,
  parseTargetStructures,
  type TargetLayout,
  type TargetTable,
} from '../src/index.js';
import { makeXlsx } from '../../file-import/test/helpers/xlsx-builder.js';

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const csvTable = (text: string): TargetTable => ok(importCsv(text, { fileName: 'T.csv' }));
const real = (): TargetTable =>
  ok(
    importXlsx(
      new Uint8Array(
        readFileSync(
          new URL('../../../test-data/profit-center/target/data_pc.XLSX', import.meta.url),
        ),
      ),
      {
        fileName: 'data_pc.XLSX',
        headerRow: 4,
      },
    ),
  );

describe('Profit Center reference target (SPEC-007)', () => {
  const layout = ok(detectTargetLayout(real())).layout;
  const parsed = ok(parseTargetStructures(real(), layout, { name: 'Profit Center' }));
  const [pc, cc, tr] = parsed.target.structures;

  it('detects the layout from the headers and row shape', () => {
    expect(layout.mode).toBe('sectionRows');
    expect(layout.columns).toMatchObject({
      structure: 'Sheet Name',
      displayName: 'Field Description',
      technicalField: 'SAP Field',
    });
  });

  it('produces three structures with no diagnostics', () => {
    expect(parsed.target.structures.map((s) => s.name)).toEqual([
      'Profit Center',
      'Company Codes',
      'Translation',
    ]);
    expect(parsed.diagnostics).toEqual([]);
    expect(TargetDefinitionSchema.safeParse(parsed.target).success).toBe(true);
  });

  it('keeps technical structure names and the structure note', () => {
    expect([pc!.technicalName, cc!.technicalName, tr!.technicalName]).toEqual([
      'S_I_PROFITCENTERTP_2',
      'S_I_PRFTCTRCOMPCODEA',
      'S_I_PROFITCENTERTEXT',
    ]);
    expect(pc!.importance).toBe('mandatory');
    expect(cc!.importance).toBeUndefined();
  });

  it('field counts per structure', () => {
    expect([pc!.fields.length, cc!.fields.length, tr!.fields.length]).toEqual([31, 3, 5]);
  });

  it('required fields are identifiable', () => {
    expect(pc!.fields.filter((f) => f.required).map((f) => f.displayName)).toEqual([
      'Profit Center',
      'Valid To',
      'Valid From',
      'Profit Center Name',
      'Person Responsible',
      'Standard Hierarchy Node',
      'Segment',
    ]);
    expect(cc!.fields.every((f) => f.required)).toBe(true);
    expect(pc!.fields.find((f) => f.displayName === 'Description')!.required).toBe(false);
  });

  it('key fields come from the Key group, carried down to the rows below it', () => {
    expect(pc!.fields.filter((f) => f.isKey).map((f) => f.displayName)).toEqual([
      'Profit Center',
      'Valid To',
    ]);
    expect(cc!.fields.filter((f) => f.isKey)).toHaveLength(3);
    expect(tr!.fields.filter((f) => f.isKey).map((f) => f.displayName)).toEqual([
      'Profit Center',
      'Validty End Date',
      'Language Key',
    ]);
  });

  it('preserves technical metadata, type, length, group and importance', () => {
    const f = pc!.fields[0]!;
    expect(f).toMatchObject({
      displayName: 'Profit Center',
      technicalName: 'PROFITCENTERFOREDIT',
      datatype: 'string',
      nativeType: 'Text',
      length: 80,
      group: 'Key',
      importance: 'mandatory for sheet',
    });
    expect(pc!.fields[2]).toMatchObject({
      displayName: 'Valid From',
      datatype: 'date',
      group: 'General Information',
    });
    expect(pc!.fields[2]!.length).toBeUndefined();
    expect(tr!.fields[3]).toMatchObject({
      displayName: 'Profit Center Name',
      group: 'Text',
      length: 20,
    });
  });

  it('IDs are deterministic and unique', () => {
    expect(parsed.target.structures.map((s) => s.id)).toEqual([
      'ts-Profit-Center',
      'ts-Company-Codes',
      'ts-Translation',
    ]);
    const ids = parsed.target.structures.flatMap((s) => s.fields.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(pc!.fields[0]!.id).toBe('tf-Profit-Center-1');
  });
});

describe('layouts are generic, not Profit Center specific', () => {
  it('sectionRows with other names, groups, a required wording and a decimal column', () => {
    const t = csvTable(
      [
        'Object,Cluster,Label,Req,DataType,Len,Dec,TechTable,TechField',
        'Invoice Header,,,,,,,,',
        ',Key,Invoice Number,required,Number,10,0,INVH,NUM',
        ',Amounts,Net Amount,,Decimal,15,2,INVH,NET',
        'Invoice Lines,,,,,,,,',
        ',Key,Line,required,Integer,,,INVL,LN',
      ].join('\n'),
    );
    const r = ok(
      parseTargetStructures(
        t,
        {
          mode: 'sectionRows',
          columns: {
            structure: 'Object',
            group: 'Cluster',
            displayName: 'Label',
            importance: 'Req',
            type: 'DataType',
            length: 'Len',
            decimals: 'Dec',
            technicalStructure: 'TechTable',
            technicalField: 'TechField',
          },
        },
        { name: 'Invoices' },
      ),
    );
    expect(r.target.structures.map((s) => s.name)).toEqual(['Invoice Header', 'Invoice Lines']);
    expect(r.target.structures[0]!.fields[1]).toMatchObject({
      displayName: 'Net Amount',
      datatype: 'decimal',
      length: 15,
      decimals: 2,
      isKey: false,
      required: false,
    });
    expect(r.target.structures[0]!.fields[0]).toMatchObject({
      isKey: true,
      required: true,
      datatype: 'decimal',
    });
    expect(r.target.structures[1]!.fields[0]).toMatchObject({ datatype: 'integer' });
  });

  it('column mode: a structure name on every field row, with a key flag column', () => {
    const t = csvTable(
      [
        'Structure,Field,Key,Type',
        'Header,Id,X,Text',
        'Lines,Id,X,Text',
        'Header,Name,,Text',
        'Lines,Qty,,Number',
      ].join('\n'),
    );
    const layout = ok(detectTargetLayout(t)).layout;
    expect(layout.mode).toBe('column');
    const r = ok(parseTargetStructures(t, layout, { name: 'Doc' }));
    expect(r.target.structures.map((s) => [s.name, s.fields.map((f) => f.displayName)])).toEqual([
      ['Header', ['Id', 'Name']],
      ['Lines', ['Id', 'Qty']],
    ]);
    expect(r.target.structures[0]!.fields.map((f) => f.isKey)).toEqual([true, false]);
  });

  it('perSheet mode: each sheet is a structure', () => {
    const bytes = makeXlsx([
      {
        name: 'Header',
        rows: [
          ['Field', 'Type', 'Length'],
          ['Id', 'Text', '10'],
          ['Date', 'Date', ''],
        ],
      },
      {
        name: 'Lines',
        rows: [
          ['Field', 'Type', 'Length'],
          ['Qty', 'Number', ''],
        ],
      },
    ]);
    const t = ok(importXlsx(bytes, { fileName: 'b.xlsx' }));
    const layout = ok(detectTargetLayout(t)).layout;
    expect(layout.mode).toBe('perSheet');
    const r = ok(parseTargetStructures(t, layout, { name: 'Doc' }));
    expect(r.target.structures.map((s) => [s.name, s.fields.length])).toEqual([
      ['Header', 2],
      ['Lines', 1],
    ]);
    expect(r.target.structures[0]!.fields[0]).toMatchObject({ length: 10, datatype: 'string' });
  });

  it('a custom type map and key group work', () => {
    const t = csvTable('S,G,F,T\nA,,,\n,PK,Id,Zahl\n');
    const layout: TargetLayout = {
      mode: 'sectionRows',
      columns: { structure: 'S', group: 'G', displayName: 'F', type: 'T' },
      keyGroups: ['pk'],
      typeMap: { zahl: 'integer' },
    };
    const f = ok(parseTargetStructures(t, layout, { name: 'X' })).target.structures[0]!.fields[0]!;
    expect(f).toMatchObject({ datatype: 'integer', isKey: true });
  });
});

describe('parser errors and warnings', () => {
  const layout: TargetLayout = {
    mode: 'sectionRows',
    columns: { structure: 'S', displayName: 'F', type: 'T', length: 'L' },
  };

  it('a missing required column is an error that lists the available headers', () => {
    const r = parseTargetStructures(
      csvTable('S,F\nA,\n,x\n'),
      { ...layout, columns: { structure: 'S', displayName: 'Nope' } },
      { name: 'X' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.code).toBe('TARGET_COLUMN_NOT_FOUND');
      expect(r.issues[0]!.message).toContain('Available: S, F');
    }
  });

  it('a missing optional column is only a warning', () => {
    const r = ok(
      parseTargetStructures(
        csvTable('S,F\nA,\n,x\n'),
        { ...layout, columns: { structure: 'S', displayName: 'F', type: 'Gone' } },
        { name: 'X' },
      ),
    );
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'TARGET_COLUMN_NOT_FOUND',
    });
  });

  it('a field before any structure is reported and skipped', () => {
    const r = ok(parseTargetStructures(csvTable('S,F\n,orphan\nA,\n,x\n'), layout, { name: 'X' }));
    expect(r.diagnostics.map((d) => d.code)).toContain('TARGET_FIELD_BEFORE_STRUCTURE');
    expect(r.target.structures[0]!.fields.map((f) => f.displayName)).toEqual(['x']);
  });

  it('unknown types and bad numbers are warnings, not silent', () => {
    const r = ok(
      parseTargetStructures(csvTable('S,F,T,L\nA,,,\n,x,Blob,ten\n'), layout, { name: 'X' }),
    );
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual([
      'TARGET_BAD_NUMBER',
      'TARGET_UNKNOWN_TYPE',
    ]);
    expect(r.target.structures[0]!.fields[0]).toMatchObject({
      datatype: 'unknown',
      nativeType: 'Blob',
    });
  });

  it('no structure found is an error', () => {
    const r = parseTargetStructures(csvTable('S,F\n'), layout, { name: 'X' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('TARGET_NO_STRUCTURES');
  });

  it('same structure name twice gets unique IDs; duplicate fields and empty structures are warned', () => {
    const min: TargetLayout = {
      mode: 'sectionRows',
      columns: { structure: 'S', displayName: 'F' },
    };
    const r = ok(parseTargetStructures(csvTable('S,F\nA,\n,x\n,x\nA,\n'), min, { name: 'X' }));
    expect(r.target.structures.map((s) => s.id)).toEqual(['ts-A', 'ts-A-2']);
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual([
      'TARGET_DUPLICATE_FIELD',
      'TARGET_EMPTY_STRUCTURE',
    ]);
  });

  it('conflicting technical structure names keep the first and warn', () => {
    const l: TargetLayout = {
      mode: 'sectionRows',
      columns: { structure: 'S', displayName: 'F', technicalStructure: 'TS' },
    };
    const r = ok(parseTargetStructures(csvTable('S,F,TS\nA,,\n,x,T1\n,y,T2\n'), l, { name: 'X' }));
    expect(r.target.structures[0]!.technicalName).toBe('T1');
    expect(r.diagnostics[0]!.code).toBe('TARGET_TECHNICAL_STRUCTURE_CONFLICT');
  });

  it('structure modes need a structure column; unknown dataset is an error', () => {
    expect(
      parseTargetStructures(
        csvTable('F\nx\n'),
        { mode: 'column', columns: { displayName: 'F' } },
        { name: 'X' },
      ).ok,
    ).toBe(false);
    expect(
      parseTargetStructures(csvTable('S,F\nA,\n'), { ...layout, dataset: 'Missing' }, { name: 'X' })
        .ok,
    ).toBe(false);
  });

  it('detect fails without a field name column', () => {
    const r = detectTargetLayout(csvTable('Foo,Bar\n1,2\n'));
    expect(r.ok).toBe(false);
  });
});
