import { describe, expect, it } from 'vitest';
import {
  RelationshipSchema,
  SourceDefinitionSchema,
  SourceFieldSchema,
  TargetDefinitionSchema,
} from '../src/index.js';
import { profitCenterRaw } from './fixtures/profit-center.js';

const raw = () => profitCenterRaw() as any;

describe('source model (AC-001)', () => {
  it('AC-001 three source definitions with datasets coexist in one project', () => {
    const defs = raw().sourceDefinitions.map((d: unknown) => SourceDefinitionSchema.parse(d));
    expect(defs).toHaveLength(3);
    expect(defs.flatMap((d: any) => d.datasets)).toHaveLength(3);
  });

  it('technical metadata is optional on a generic CSV field', () => {
    const f = SourceFieldSchema.parse({
      id: 'f1',
      datasetId: 'd1',
      displayName: 'Name',
      datatype: 'unknown',
    });
    expect(f.technicalName).toBeUndefined();
    expect(f.length).toBeUndefined();
  });

  it('rejects unknown keys (strict objects)', () => {
    const bad = { ...raw().sourceDefinitions[0], surprise: 1 };
    expect(SourceDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown datatype', () => {
    const f = { id: 'f1', datasetId: 'd1', displayName: 'N', datatype: 'varchar' };
    expect(SourceFieldSchema.safeParse(f).success).toBe(false);
  });

  it('source location is not tied to local files', () => {
    const d = { ...raw().sourceDefinitions[0], location: { kind: 'uri', uri: 'sharepoint://x' } };
    expect(SourceDefinitionSchema.safeParse(d).success).toBe(true);
  });
});

describe('relationships (AC-002)', () => {
  const rel = () => raw().mappingDefinition.relationships[0];

  it('AC-002 supports composite keys (two key pairs)', () => {
    const r = RelationshipSchema.parse(rel());
    expect(r.keys).toHaveLength(2);
  });

  it('supports a single key', () => {
    expect(RelationshipSchema.parse(raw().mappingDefinition.relationships[1]).keys).toHaveLength(1);
  });

  it.each(['oneToOne', 'oneToMany', 'manyToOne', 'manyToMany'])('accepts cardinality %s', (c) => {
    expect(RelationshipSchema.safeParse({ ...rel(), cardinality: c }).success).toBe(true);
  });

  it.each(['inner', 'left'])('accepts join type %s', (j) => {
    expect(RelationshipSchema.safeParse({ ...rel(), joinType: j }).success).toBe(true);
  });

  it('rejects a relationship with no keys', () => {
    expect(RelationshipSchema.safeParse({ ...rel(), keys: [] }).success).toBe(false);
  });

  it('carries suggested/confirmed/rejected status', () => {
    for (const status of ['suggested', 'confirmed', 'rejected']) {
      expect(RelationshipSchema.safeParse({ ...rel(), status }).success).toBe(true);
    }
    expect(RelationshipSchema.safeParse({ ...rel(), status: 'maybe' }).success).toBe(false);
  });
});

describe('target model (AC-003)', () => {
  it('AC-003 three structures and their fields are represented independently', () => {
    const t = TargetDefinitionSchema.parse(raw().targetDefinition);
    expect(t.structures.map((s) => s.name)).toEqual([
      'ProfitCenter',
      'CompanyCodes',
      'Translation',
    ]);
    const fieldIds = t.structures.flatMap((s) => s.fields.map((f) => f.id));
    expect(new Set(fieldIds).size).toBe(fieldIds.length);
  });

  it('has no fixed maximum number of structures', () => {
    const t = raw().targetDefinition;
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      targetDefinitionId: t.id,
      name: `S${i}`,
      displayName: `S${i}`,
      fields: [],
    }));
    expect(TargetDefinitionSchema.safeParse({ ...t, structures: many }).success).toBe(true);
  });

  it('technical name on a structure is optional', () => {
    const s = TargetDefinitionSchema.parse(raw().targetDefinition).structures[0]!;
    expect(s.technicalName).toBeUndefined();
  });

  it('models one-to-many generation and a parent link on a structure', () => {
    const cc = TargetDefinitionSchema.parse(raw().targetDefinition).structures[1]!;
    expect(cc.generation?.driverDatasetId).toBe('ds-bukrs');
    expect(cc.parent?.keys).toHaveLength(1);
  });
});
