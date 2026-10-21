import { describe, expect, it } from 'vitest';
import { parseProject, validateProject, type Project } from '../src/index.js';
import { profitCenterRaw } from './fixtures/profit-center.js';

/** Build a structurally valid project after mutating the raw fixture, then validate references. */
function issuesFor(mutate: (raw: any) => void): string[] {
  const raw = profitCenterRaw() as any;
  mutate(raw);
  const r = parseProject(raw);
  if (!r.ok) throw new Error('fixture mutation broke structure: ' + JSON.stringify(r.issues));
  return validateProject(r.value as Project).map((i) => i.code);
}
const mapping = (raw: any, id: string) =>
  raw.mappingDefinition.mappings.find((m: any) => m.id === id);

describe('semantic validation (AC-008)', () => {
  it('the Profit Center reference has no issues', () => {
    expect(issuesFor(() => {})).toEqual([]);
  });

  it('AC-008 mapping to a nonexistent target field', () => {
    expect(issuesFor((r) => (mapping(r, 'm-prctr').targetFieldId = 'nope'))).toContain(
      'MODEL_UNKNOWN_TARGET_FIELD',
    );
  });

  it('mapping to a nonexistent target structure', () => {
    expect(issuesFor((r) => (mapping(r, 'm-prctr').targetStructureId = 'nope'))).toContain(
      'MODEL_UNKNOWN_TARGET_STRUCTURE',
    );
  });

  it('a target field that belongs to a different structure', () => {
    expect(issuesFor((r) => (mapping(r, 'm-prctr').targetStructureId = 'ts-cc'))).toContain(
      'MODEL_UNKNOWN_TARGET_FIELD',
    );
  });

  it('AC-008 relationship to a nonexistent dataset', () => {
    expect(
      issuesFor((r) => (r.mappingDefinition.relationships[0].rightDatasetId = 'nope')),
    ).toContain('MODEL_UNKNOWN_DATASET');
  });

  it('AC-008 relationship key on a nonexistent field', () => {
    expect(
      issuesFor((r) => (r.mappingDefinition.relationships[0].keys[1].leftFieldId = 'nope')),
    ).toContain('MODEL_UNKNOWN_SOURCE_FIELD');
  });

  it('relationship key field that sits in the other dataset', () => {
    expect(
      issuesFor(
        (r) => (r.mappingDefinition.relationships[0].keys[0].rightFieldId = 'f-cepc-prctr'),
      ),
    ).toContain('MODEL_UNKNOWN_SOURCE_FIELD');
  });

  it('AC-008 duplicate IDs', () => {
    expect(
      issuesFor((r) => (r.sourceDefinitions[1].datasets[0].fields[0].id = 'f-cepc-prctr')),
    ).toContain('MODEL_DUPLICATE_ID');
    expect(issuesFor((r) => (r.mappingDefinition.mappings[1].id = 'm-prctr'))).toContain(
      'MODEL_DUPLICATE_ID',
    );
  });

  it('parent id that disagrees with nesting', () => {
    expect(
      issuesFor((r) => (r.sourceDefinitions[0].datasets[0].fields[0].datasetId = 'ds-cepct')),
    ).toContain('MODEL_PARENT_MISMATCH');
    expect(
      issuesFor((r) => (r.targetDefinition.structures[0].fields[0].targetStructureId = 'ts-cc')),
    ).toContain('MODEL_PARENT_MISMATCH');
  });

  it('source reference to a missing field or dataset', () => {
    expect(
      issuesFor((r) => (mapping(r, 'm-prctr').sourceReferences[0].fieldId = 'nope')),
    ).toContain('MODEL_UNKNOWN_SOURCE_FIELD');
    expect(
      issuesFor((r) => (mapping(r, 'm-prctr').sourceReferences[0].datasetId = 'nope')),
    ).toContain('MODEL_UNKNOWN_DATASET');
  });

  it('condition operand referencing a missing field', () => {
    expect(
      issuesFor((r) => (mapping(r, 'm-name').conditional.rules[0].when.left.fieldId = 'nope')),
    ).toContain('MODEL_UNKNOWN_SOURCE_FIELD');
  });

  it('direct needs one source, constant takes none, routine needs a chain', () => {
    expect(issuesFor((r) => (mapping(r, 'm-prctr').sourceReferences = []))).toContain(
      'MODEL_BAD_SOURCE_ARITY',
    );
    expect(
      issuesFor(
        (r) =>
          (mapping(r, 'm-lang').sourceReferences = [
            { datasetId: 'ds-cepc', fieldId: 'f-cepc-prctr' },
          ]),
      ),
    ).toContain('MODEL_BAD_SOURCE_ARITY');
    expect(issuesFor((r) => (mapping(r, 'm-validfrom').transformations = []))).toContain(
      'MODEL_EMPTY_CHAIN',
    );
  });

  it('two mappings for one target field', () => {
    const codes = issuesFor((r) => {
      const dup = { ...mapping(r, 'm-prctr'), id: 'm-prctr-2' };
      r.mappingDefinition.mappings.push(dup);
    });
    expect(codes).toContain('MODEL_DUPLICATE_MAPPING');
  });

  it('duplicate transformation order', () => {
    expect(issuesFor((r) => (mapping(r, 'm-validfrom').transformations[1].order = 0))).toContain(
      'MODEL_DUPLICATE_ORDER',
    );
  });

  it('routine and lookup: unknown, and used but not declared', () => {
    expect(
      issuesFor((r) => (mapping(r, 'm-validfrom').transformations[0].routineId = 'nope')),
    ).toContain('MODEL_UNKNOWN_ROUTINE');
    expect(issuesFor((r) => (r.mappingDefinition.routineReferences = []))).toContain(
      'MODEL_UNDECLARED_ROUTINE',
    );
    expect(issuesFor((r) => (mapping(r, 'm-company').lookup.lookupId = 'nope'))).toContain(
      'MODEL_UNKNOWN_LOOKUP',
    );
    expect(issuesFor((r) => (r.mappingDefinition.lookupReferences = []))).toContain(
      'MODEL_UNDECLARED_LOOKUP',
    );
  });

  it('manifest pins a routine version that is not defined', () => {
    expect(issuesFor((r) => (r.mappingDefinition.routineReferences[0].version = '99'))).toContain(
      'MODEL_UNKNOWN_ROUTINE',
    );
  });

  it('generation driver or relationship that does not exist', () => {
    expect(
      issuesFor((r) => (r.targetDefinition.structures[1].generation.driverDatasetId = 'nope')),
    ).toContain('MODEL_UNKNOWN_DATASET');
    expect(
      issuesFor((r) => (r.targetDefinition.structures[1].generation.viaRelationshipIds = ['nope'])),
    ).toContain('MODEL_UNKNOWN_RELATIONSHIP');
  });

  it('parent link to a missing structure or to fields in the wrong structure', () => {
    expect(
      issuesFor((r) => (r.targetDefinition.structures[1].parent.parentStructureId = 'nope')),
    ).toContain('MODEL_INVALID_PARENT_LINK');
    expect(
      issuesFor(
        (r) => (r.targetDefinition.structures[1].parent.keys[0].parentFieldId = 'tf-cc-bukrs'),
      ),
    ).toContain('MODEL_INVALID_PARENT_LINK');
  });

  it('validation rule scope that does not exist', () => {
    expect(
      issuesFor((r) => (r.mappingDefinition.validationRules[0].scope.targetFieldId = 'nope')),
    ).toContain('MODEL_UNKNOWN_TARGET_FIELD');
  });

  it('issues are structured with severity, code, message and path', () => {
    const raw = profitCenterRaw() as any;
    mapping(raw, 'm-prctr').targetFieldId = 'nope';
    const parsed = parseProject(raw);
    if (!parsed.ok) throw new Error('unexpected');
    const issue = validateProject(parsed.value)[0]!;
    expect(issue).toMatchObject({
      severity: 'error',
      code: 'MODEL_UNKNOWN_TARGET_FIELD',
      path: 'mappingDefinition.mappings[0].targetFieldId',
      fieldMappingId: 'm-prctr',
    });
    expect(issue.message.length).toBeGreaterThan(0);
  });

  it('does not over-constrain: unmapped target fields are not model errors', () => {
    expect(issuesFor((r) => (r.mappingDefinition.mappings = []))).toEqual([]);
  });
});
