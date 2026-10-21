import { describe, expect, it } from 'vitest';
import { computeCompleteness, parseProject } from '../src/index.js';
import { profitCenterRaw } from './fixtures/profit-center.js';

function load(mutate: (raw: any) => void = () => {}) {
  const raw = profitCenterRaw() as any;
  mutate(raw);
  const r = parseProject(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return computeCompleteness(r.value.targetDefinition!, r.value.mappingDefinition);
}
const find = (c: ReturnType<typeof load>, id: string) => c.find((x) => x.targetStructureId === id)!;

describe('mapping completeness per structure (SPEC-008)', () => {
  it('is calculated independently for each structure', () => {
    const c = load();
    expect(c.map((x) => x.targetStructureId)).toEqual(['ts-pc', 'ts-cc', 'ts-tr']);
    expect(find(c, 'ts-pc')).toMatchObject({
      totalFields: 4,
      mappedFields: 4,
      percentMapped: 100,
      ready: true,
    });
    expect(find(c, 'ts-cc')).toMatchObject({
      totalFields: 2,
      mappedFields: 1,
      requiredFields: 2,
      requiredMapped: 1,
      unmappedRequired: ['tf-cc-prctr'],
      unmappedKeys: ['tf-cc-prctr'],
      percentMapped: 50,
      ready: false,
    });
    expect(find(c, 'ts-tr')).toMatchObject({
      totalFields: 2,
      mappedFields: 1,
      unmappedRequired: ['tf-tr-prctr'],
      ready: false,
    });
  });

  it('a change in one structure does not affect another', () => {
    const c = load(
      (r) =>
        (r.mappingDefinition.mappings = r.mappingDefinition.mappings.filter(
          (m: any) => m.targetStructureId !== 'ts-pc',
        )),
    );
    expect(find(c, 'ts-pc')).toMatchObject({ mappedFields: 0, ready: false });
    expect(find(c, 'ts-cc').mappedFields).toBe(1);
  });

  it('a mapping with status unmapped does not count; needsReview and error count but are tallied', () => {
    const c = load((r) => {
      const m = r.mappingDefinition.mappings;
      m.find((x: any) => x.id === 'm-prctr').status = 'unmapped';
      m.find((x: any) => x.id === 'm-lang').status = 'needsReview';
      m.find((x: any) => x.id === 'm-name').status = 'error';
    });
    expect(find(c, 'ts-pc')).toMatchObject({
      mappedFields: 3,
      needsReview: 1,
      errors: 1,
      unmappedRequired: ['tf-pc-prctr'],
      unmappedKeys: ['tf-pc-prctr'],
    });
  });

  it('an empty structure is 0 percent and ready', () => {
    const c = load((r) => (r.targetDefinition.structures[2].fields = []));
    expect(find(c, 'ts-tr')).toMatchObject({ totalFields: 0, percentMapped: 0, ready: true });
  });
});
