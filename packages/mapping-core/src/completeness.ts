import type { MappingDefinition } from './mapping.js';
import type { TargetDefinition } from './target.js';

export interface StructureCompleteness {
  targetStructureId: string;
  totalFields: number;
  mappedFields: number;
  requiredFields: number;
  requiredMapped: number;
  /** Target field IDs, in structure order. */
  unmappedRequired: string[];
  unmappedKeys: string[];
  needsReview: number;
  errors: number;
  /** mappedFields / totalFields * 100, rounded to 2 decimals. 0 for an empty structure. */
  percentMapped: number;
  /** All required fields and all key fields are mapped. */
  ready: boolean;
}

/**
 * Mapping completeness per target structure, derived from the model. A field counts as mapped when a
 * FieldMapping exists for it and its status is not "unmapped". Structures are independent of each other.
 */
export function computeCompleteness(
  target: TargetDefinition,
  mapping: MappingDefinition,
): StructureCompleteness[] {
  const byField = new Map(
    mapping.mappings.map((m) => [`${m.targetStructureId}/${m.targetFieldId}`, m]),
  );
  return target.structures.map((s) => {
    let mappedFields = 0;
    let requiredMapped = 0;
    let needsReview = 0;
    let errors = 0;
    const unmappedRequired: string[] = [];
    const unmappedKeys: string[] = [];
    for (const f of s.fields) {
      const m = byField.get(`${s.id}/${f.id}`);
      const mapped = m !== undefined && m.status !== 'unmapped';
      if (mapped) mappedFields++;
      if (m?.status === 'needsReview') needsReview++;
      if (m?.status === 'error') errors++;
      if (f.required) {
        if (mapped) requiredMapped++;
        else unmappedRequired.push(f.id);
      }
      if (f.isKey && !mapped) unmappedKeys.push(f.id);
    }
    const totalFields = s.fields.length;
    return {
      targetStructureId: s.id,
      totalFields,
      mappedFields,
      requiredFields: s.fields.filter((f) => f.required).length,
      requiredMapped,
      unmappedRequired,
      unmappedKeys,
      needsReview,
      errors,
      percentMapped: totalFields === 0 ? 0 : Math.round((mappedFields / totalFields) * 10000) / 100,
      ready: unmappedRequired.length === 0 && unmappedKeys.length === 0,
    };
  });
}
