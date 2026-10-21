import { describe, expect, it } from 'vitest';
import { FieldMappingSchema, MappingDefinitionSchema, ValidationRuleSchema } from '../src/index.js';
import { profitCenterRaw } from './fixtures/profit-center.js';

const raw = () => profitCenterRaw() as any;
const mapping = (id: string) => raw().mappingDefinition.mappings.find((m: any) => m.id === id);

describe('mapping types (AC-004)', () => {
  it.each([
    ['m-prctr', 'direct'],
    ['m-lang', 'constant'],
    ['m-company', 'lookup'],
    ['m-name', 'conditional'],
    ['m-validfrom', 'routine'],
    ['m-tr-name', 'javascript'],
  ])('AC-004 %s is representable as %s', (id, type) => {
    const m = FieldMappingSchema.parse(mapping(id));
    expect(m.mappingType).toBe(type);
  });

  it('rejects an unknown mapping type', () => {
    expect(
      FieldMappingSchema.safeParse({ ...mapping('m-prctr'), mappingType: 'magic' }).success,
    ).toBe(false);
  });

  it('a constant mapping must carry its constant', () => {
    const noConstant = mapping('m-lang');
    delete noConstant.constant;
    expect(FieldMappingSchema.safeParse(noConstant).success).toBe(false);
  });

  it('constants preserve their datatype', () => {
    const base = mapping('m-lang');
    const ok = (constant: unknown) => FieldMappingSchema.safeParse({ ...base, constant }).success;
    expect(ok({ datatype: 'integer', value: 5 })).toBe(true);
    expect(ok({ datatype: 'integer', value: '5' })).toBe(false);
    expect(ok({ datatype: 'decimal', value: '12.50' })).toBe(true);
    expect(ok({ datatype: 'decimal', value: 12.5 })).toBe(false);
    expect(ok({ datatype: 'boolean', value: true })).toBe(true);
    expect(ok({ datatype: 'string', value: null })).toBe(true);
  });

  it('supports nested conditions', () => {
    const base = mapping('m-name');
    const when = {
      op: 'and',
      conditions: [
        { op: 'isEmpty', operand: { kind: 'current' } },
        {
          op: 'not',
          condition: {
            op: 'in',
            operand: { kind: 'current' },
            values: [{ datatype: 'string', value: 'X' }],
          },
        },
      ],
    };
    const c = { rules: [{ when, then: { kind: 'current' } }] };
    expect(FieldMappingSchema.safeParse({ ...base, conditional: c }).success).toBe(true);
  });
});

describe('multiple source references (AC-005)', () => {
  it('AC-005 a mapping can reference two source fields', () => {
    const m = FieldMappingSchema.parse(mapping('m-name'));
    expect(m.sourceReferences.map((s) => s.fieldId)).toEqual(['f-cepc-land1', 'f-cepct-ktext']);
  });
});

describe('routine chains (AC-006)', () => {
  it('AC-006 chain order is preserved', () => {
    const m = FieldMappingSchema.parse(mapping('m-validfrom'));
    expect(m.transformations.map((t) => (t.kind === 'routine' ? t.routineId : t.lookupId))).toEqual(
      ['r-zero-date', 'r-parse-date', 'r-format-date'],
    );
    expect(m.transformations.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  it('a lookup can sit inside a chain', () => {
    const m = mapping('m-validfrom');
    const chain = [
      ...m.transformations,
      {
        kind: 'lookup',
        lookupId: 'lk-company',
        configuration: {},
        missingValue: { kind: 'keepSource' },
        order: 3,
      },
    ];
    expect(FieldMappingSchema.safeParse({ ...m, transformations: chain }).success).toBe(true);
  });

  it.each([
    { kind: 'error' },
    { kind: 'warning' },
    { kind: 'keepSource' },
    { kind: 'null' },
    { kind: 'default', value: { datatype: 'string', value: 'X' } },
  ])('lookup missing-value behavior %j is accepted', (missingValue) => {
    const m = mapping('m-company');
    expect(
      FieldMappingSchema.safeParse({ ...m, lookup: { ...m.lookup, missingValue } }).success,
    ).toBe(true);
  });
});

describe('mapping definition and validation rules', () => {
  it('parses the full mapping definition', () => {
    const d = MappingDefinitionSchema.parse(raw().mappingDefinition);
    expect(d.mappings).toHaveLength(6);
    expect(d.relationships).toHaveLength(2);
  });

  it('accepts each initial validation rule type', () => {
    const scope = { kind: 'targetField', targetFieldId: 'tf-pc-prctr' };
    const rules = [
      { ruleType: 'required', configuration: {} },
      { ruleType: 'unique', configuration: {} },
      { ruleType: 'maxLength', configuration: { max: 10 } },
      { ruleType: 'pattern', configuration: { pattern: '^S_' } },
      { ruleType: 'allowedValues', configuration: { values: ['A'] } },
    ];
    for (const r of rules) {
      expect(
        ValidationRuleSchema.safeParse({ id: 'v', scope, severity: 'warning', ...r }).success,
        r.ruleType,
      ).toBe(true);
    }
  });
});
