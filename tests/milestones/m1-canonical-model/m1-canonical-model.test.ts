import { describe, expect, it } from 'vitest';
import {
  deserializeProject,
  parseProject,
  serializeProject,
  validateProject,
} from '@mms/mapping-core';
import { profitCenterRaw } from '../../../packages/mapping-core/test/fixtures/profit-center.js';

/** M1 demo check: Profit Center model saved to JSON and loaded back equal; bad references give structured errors. */
describe('M1 canonical model', () => {
  const parsed = parseProject(profitCenterRaw());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const project = parsed.value;

  it('M1-01 Profit Center reference model parses and has no reference issues', () => {
    expect(project.targetDefinition?.structures.map((s) => s.name)).toEqual([
      'ProfitCenter',
      'CompanyCodes',
      'Translation',
    ]);
    expect(validateProject(project)).toEqual([]);
  });

  it('M1-02 model is saved to JSON and loaded back equal', () => {
    const back = deserializeProject(serializeProject(project));
    expect(back.ok && back.value).toEqual(project);
  });

  it('M1-03 composite relationship, one-to-many generation and parent link are represented', () => {
    expect(project.mappingDefinition.relationships[0]?.keys).toHaveLength(2);
    const cc = project.targetDefinition?.structures[1];
    expect(cc?.generation?.driverDatasetId).toBe('ds-bukrs');
    expect(cc?.parent?.parentStructureId).toBe('ts-pc');
  });

  it('M1-04 all six mapping types are present in the reference mapping', () => {
    const types = new Set(project.mappingDefinition.mappings.map((m) => m.mappingType));
    expect([...types].sort()).toEqual([
      'conditional',
      'constant',
      'direct',
      'javascript',
      'lookup',
      'routine',
    ]);
  });

  it('M1-05 a bad reference returns a structured error with code and path', () => {
    const raw = profitCenterRaw() as any;
    raw.mappingDefinition.mappings[0].targetFieldId = 'missing';
    const p = parseProject(raw);
    if (!p.ok) throw new Error('unexpected');
    expect(validateProject(p.value)[0]).toMatchObject({
      severity: 'error',
      code: 'MODEL_UNKNOWN_TARGET_FIELD',
      path: 'mappingDefinition.mappings[0].targetFieldId',
    });
  });
});
