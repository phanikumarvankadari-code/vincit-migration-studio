import {
  computeCompleteness,
  type Diagnostic,
  type FieldMapping,
  type ModelParts,
} from '@mms/mapping-core';
import { checkRoutineConfiguration } from '@mms/routine-library';
import type { JavaScriptExecutor, RoutineRegistry } from '@mms/transformation-engine';

const d = (
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic => ({ severity, code, message, ...extra }) as Diagnostic;

/** Source datasets a mapping reads (its source references and condition operands). */
export function datasetsRead(m: FieldMapping): string[] {
  const out = new Set<string>(m.sourceReferences.map((r) => r.datasetId));
  const operand = (o: { kind: string; datasetId?: string }): void => {
    if (o.kind === 'field' && o.datasetId) out.add(o.datasetId);
  };
  const cond = (c: import('@mms/mapping-core').ConditionExpr): void => {
    if (c.op === 'compare') {
      operand(c.left);
      operand(c.right);
    } else if (c.op === 'in' || c.op === 'isEmpty') operand(c.operand);
    else if (c.op === 'not') cond(c.condition);
    else c.conditions.forEach(cond);
  };
  if (m.mappingType === 'conditional') {
    for (const r of m.conditional.rules) {
      cond(r.when);
      operand(r.then);
    }
    if (m.conditional.otherwise) operand(m.conditional.otherwise);
  }
  return [...out];
}

export interface DriverSuggestion {
  datasetId: string;
  /** How many key fields of the structure take their value from this dataset. */
  keyFieldsCovered: number;
  reason: string;
}

/**
 * Suggests which dataset should drive the rows of a structure: the dataset that supplies most of the structure's
 * key fields (rows are generated at the grain of the key), then the one read by most mappings. Best first.
 */
export function suggestDrivers(model: ModelParts, targetStructureId: string): DriverSuggestion[] {
  const structure = model.targetDefinition?.structures.find((s) => s.id === targetStructureId);
  if (!structure) return [];
  const mappings = model.mappingDefinition.mappings.filter(
    (m) => m.targetStructureId === targetStructureId,
  );
  const keyIds = new Set(structure.fields.filter((f) => f.isKey).map((f) => f.id as string));
  const score = new Map<string, { keys: number; reads: number }>();
  for (const m of mappings) {
    for (const ds of datasetsRead(m)) {
      const s = score.get(ds) ?? { keys: 0, reads: 0 };
      s.reads++;
      if (keyIds.has(m.targetFieldId) && m.sourceReferences.some((r) => r.datasetId === ds))
        s.keys++;
      score.set(ds, s);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1].keys - a[1].keys || b[1].reads - a[1].reads || a[0].localeCompare(b[0]))
    .map(([datasetId, s]) => ({
      datasetId,
      keyFieldsCovered: s.keys,
      reason:
        keyIds.size > 0
          ? `it supplies ${s.keys} of ${keyIds.size} key field(s) and is read by ${s.reads} mapping(s)`
          : `it is read by ${s.reads} mapping(s)`,
    }));
}

export interface PreflightOptions {
  routines?: RoutineRegistry;
  javascript?: JavaScriptExecutor;
}

/**
 * Checks that can be made without running: routine availability and configuration, JavaScript availability,
 * unconfirmed relationships, unmapped required and key fields, and structures with no clear driver.
 * Each problem is reported once, instead of once per row.
 */
export function preflight(model: ModelParts, options: PreflightOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const registry = options.routines ?? {};

  for (const m of model.mappingDefinition.mappings) {
    const ctx = {
      fieldMappingId: m.id,
      targetStructureId: m.targetStructureId,
      targetFieldId: m.targetFieldId,
    } as Partial<Diagnostic>;
    for (const step of m.transformations) {
      if (step.kind !== 'routine') continue;
      const rctx = { ...ctx, routineId: step.routineId } as Partial<Diagnostic>;
      if (!registry[step.routineId]) {
        out.push(
          d(
            'error',
            'TEST_ROUTINE_NOT_AVAILABLE',
            `Routine "${step.routineId}" has no implementation, so every row of this mapping will fail.`,
            rctx,
          ),
        );
        continue;
      }
      const bad = checkRoutineConfiguration(step.routineId, step.configuration).filter(
        (x) => x.code === 'ROUTINE_CONFIG_INVALID',
      );
      for (const b of bad) out.push({ ...b, ...ctx, routineId: step.routineId } as Diagnostic);
    }
    if (m.mappingType === 'javascript' && !options.javascript) {
      out.push(
        d(
          'error',
          'TEST_JS_NOT_AVAILABLE',
          'This mapping uses custom JavaScript but no sandbox is available, so every row of it will fail.',
          ctx,
        ),
      );
    }
  }

  for (const r of model.mappingDefinition.relationships) {
    if (r.status !== 'confirmed') {
      out.push(
        d(
          'info',
          'TEST_RELATIONSHIP_UNCONFIRMED',
          `Relationship "${r.id}" is ${r.status} and is not used in runs until it is confirmed.`,
        ),
      );
    }
  }

  const target = model.targetDefinition;
  if (target) {
    for (const c of computeCompleteness(target, model.mappingDefinition)) {
      const s = target.structures.find((x) => x.id === c.targetStructureId)!;
      const name = (id: string): string => s.fields.find((f) => f.id === id)?.displayName ?? id;
      for (const id of c.unmappedKeys) {
        out.push(
          d(
            'warning',
            'TEST_KEY_UNMAPPED',
            `Key field "${name(id)}" of "${s.name}" has no mapping.`,
            { targetStructureId: s.id, targetFieldId: id } as Partial<Diagnostic>,
          ),
        );
      }
      for (const id of c.unmappedRequired.filter((x) => !c.unmappedKeys.includes(x))) {
        out.push(
          d(
            'warning',
            'TEST_REQUIRED_UNMAPPED',
            `Required field "${name(id)}" of "${s.name}" has no mapping.`,
            { targetStructureId: s.id, targetFieldId: id } as Partial<Diagnostic>,
          ),
        );
      }
    }
    for (const s of target.structures) {
      const mappings = model.mappingDefinition.mappings.filter((m) => m.targetStructureId === s.id);
      if (mappings.length === 0 || s.generation) continue;
      const read = new Set(mappings.flatMap(datasetsRead));
      if (read.size > 1) {
        const best = suggestDrivers(model, s.id)[0]!;
        out.push(
          d(
            'warning',
            'TEST_DRIVER_SUGGESTION',
            `"${s.name}" reads ${read.size} datasets and has no driver dataset, so no rows can be made. Suggested: "${best.datasetId}" (${best.reason}).`,
            {
              targetStructureId: s.id,
              technicalDetails: `suggested driver: ${best.datasetId}`,
            } as Partial<Diagnostic>,
          ),
        );
      }
    }
  }
  return out;
}
