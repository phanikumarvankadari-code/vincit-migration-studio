import type {
  CellLineage,
  ConditionExpr,
  Diagnostic,
  FieldMapping,
  LineageStep,
  LookupDefinition,
  MissingValueBehavior,
  SourceValue,
  TransformationStep,
  ValueOperand,
} from '@mms/mapping-core';
import type { JavaScriptExecutor, RoutineRegistry } from './types.js';
import { compareValues, constantText, isEmptyValue } from './values.js';

export interface RowAccess {
  value(datasetId: string, fieldId: string): SourceValue;
  /** 1-based data row of the dataset in the current row context, if one matched. */
  rowNumber(datasetId: string): number | undefined;
  /** Values by field ID for the given datasets, for JavaScript. */
  record(datasetIds: readonly string[]): Record<string, SourceValue>;
}

export interface LookupIndex {
  definition: LookupDefinition;
  entries: Map<string, SourceValue>;
}

export function buildLookupIndex(definition: LookupDefinition): LookupIndex {
  const entries = new Map<string, SourceValue>();
  for (const e of definition.entries) {
    if (!entries.has(e.key))
      entries.set(
        e.key,
        e.value === null ? null : typeof e.value === 'string' ? e.value : String(e.value),
      );
  }
  return { definition, entries };
}

export interface EvalEnv {
  row: RowAccess;
  lookups: ReadonlyMap<string, LookupIndex>;
  routines: RoutineRegistry;
  javascript?: JavaScriptExecutor;
  collectLineage: boolean;
}

export interface CellResult {
  value: SourceValue;
  diagnostics: Diagnostic[];
  lineage?: CellLineage;
}

/**
 * Computes one target value. The primary operation (by mapping type) gives a first value; the ordered
 * transformation chain then changes it step by step. Never throws: problems become diagnostics.
 * Rules: a blank stays blank unless a step says otherwise; nothing is trimmed or converted on the way.
 */
export function evaluateMapping(
  m: FieldMapping,
  env: EvalEnv,
  base: Partial<Diagnostic>,
): CellResult {
  const diagnostics: Diagnostic[] = [];
  const steps: LineageStep[] = [];
  const inputs = m.sourceReferences.map((r) => env.row.value(r.datasetId, r.fieldId));
  const first = inputs[0] ?? null;
  const note = (
    severity: Diagnostic['severity'],
    code: string,
    message: string,
    extra: Partial<Diagnostic> = {},
  ): void => {
    diagnostics.push({
      severity,
      code,
      message,
      ...base,
      fieldMappingId: m.id,
      targetFieldId: m.targetFieldId,
      ...(m.sourceReferences[0] ? { sourceFieldId: m.sourceReferences[0].fieldId } : {}),
      ...(m.sourceReferences[0] ? { sourceValue: first } : {}),
      ...extra,
    } as Diagnostic);
  };
  const operand = (o: ValueOperand, current: SourceValue): SourceValue =>
    o.kind === 'field'
      ? env.row.value(o.datasetId, o.fieldId)
      : o.kind === 'constant'
        ? constantText(o.constant)
        : current;

  const condition = (c: ConditionExpr, current: SourceValue): boolean => {
    switch (c.op) {
      case 'compare':
        return compareValues(c.operator, operand(c.left, current), operand(c.right, current));
      case 'in': {
        const v = operand(c.operand, current);
        return c.values.some((k) => constantText(k) === v);
      }
      case 'isEmpty':
        return isEmptyValue(operand(c.operand, current));
      case 'and':
        return c.conditions.every((x) => condition(x, current));
      case 'or':
        return c.conditions.some((x) => condition(x, current));
      case 'not':
        return !condition(c.condition, current);
    }
  };

  const lookup = (
    lookupId: string,
    missing: MissingValueBehavior,
    key: SourceValue,
  ): SourceValue => {
    const idx = env.lookups.get(lookupId);
    if (!idx) {
      note('error', 'ENGINE_UNKNOWN_LOOKUP', `Lookup "${lookupId}" is not defined.`);
      steps.push({
        kind: 'lookup',
        ref: lookupId,
        input: key,
        output: null,
        note: 'lookup not defined',
      });
      return null;
    }
    if (key !== null && idx.entries.has(key)) {
      const out = idx.entries.get(key) ?? null;
      steps.push({ kind: 'lookup', ref: lookupId, input: key, output: out });
      return out;
    }
    const what = key === null ? 'a blank value' : `"${key}"`;
    const msg = `No entry for ${what} in lookup "${idx.definition.name}".`;
    let out: SourceValue = null;
    let how: string = missing.kind;
    switch (missing.kind) {
      case 'error':
        note('error', 'ENGINE_LOOKUP_MISSING', msg);
        break;
      case 'warning':
        note('warning', 'ENGINE_LOOKUP_MISSING', msg);
        break;
      case 'keepSource':
        out = key;
        break;
      case 'null':
        break;
      case 'default':
        out = constantText(missing.value);
        how = 'default';
        break;
    }
    steps.push({
      kind: 'lookup',
      ref: lookupId,
      input: key,
      output: out,
      note: `not found, ${how}`,
    });
    return out;
  };

  let value: SourceValue = null;
  switch (m.mappingType) {
    case 'direct':
    case 'routine':
      value = first;
      steps.push({ kind: 'source', input: first, output: first });
      break;
    case 'constant':
      value = constantText(m.constant);
      steps.push({ kind: 'constant', input: null, output: value });
      break;
    case 'lookup':
      if (m.sourceReferences.length !== 1) {
        note(
          'error',
          'ENGINE_LOOKUP_NEEDS_ONE_SOURCE',
          'A lookup mapping needs exactly one source field.',
        );
      } else {
        steps.push({ kind: 'source', input: first, output: first });
      }
      value =
        m.sourceReferences.length === 1
          ? lookup(m.lookup.lookupId, m.lookup.missingValue, first)
          : null;
      break;
    case 'conditional': {
      const rules = m.conditional.rules;
      const hit = rules.findIndex((r) => condition(r.when, first));
      if (hit >= 0) {
        value = operand(rules[hit]!.then, first);
        steps.push({ kind: 'condition', ref: `rule ${hit + 1}`, input: first, output: value });
      } else if (m.conditional.otherwise) {
        value = operand(m.conditional.otherwise, first);
        steps.push({ kind: 'condition', ref: 'otherwise', input: first, output: value });
      } else {
        note(
          'info',
          'ENGINE_CONDITION_NO_MATCH',
          'No condition matched and there is no otherwise value. The target value is blank.',
        );
        steps.push({ kind: 'condition', ref: 'no match', input: first, output: null });
      }
      break;
    }
    case 'javascript': {
      if (!env.javascript) {
        note(
          'error',
          'ENGINE_JS_NOT_AVAILABLE',
          'Custom JavaScript cannot run: no sandbox is configured.',
        );
        steps.push({ kind: 'javascript', input: first, output: null, note: 'no sandbox' });
        break;
      }
      const r = env.javascript({
        definition: m.javascript,
        value: first,
        inputs,
        row: env.row.record([...new Set(m.sourceReferences.map((s) => s.datasetId))]),
      });
      if (r.ok) value = r.value;
      else note('error', r.code, r.message);
      steps.push({
        kind: 'javascript',
        input: first,
        output: value,
        ...(r.ok ? {} : { note: r.message }),
      });
      break;
    }
  }

  const chain: TransformationStep[] = [...m.transformations].sort((a, b) => a.order - b.order);
  for (const step of chain) {
    if (step.kind === 'lookup') {
      value = lookup(step.lookupId, step.missingValue, value);
      continue;
    }
    const impl = env.routines[step.routineId];
    if (!impl) {
      note(
        'error',
        'ENGINE_ROUTINE_NOT_AVAILABLE',
        `Routine "${step.routineId}" has no implementation.`,
        { routineId: step.routineId } as Partial<Diagnostic>,
      );
      steps.push({
        kind: 'routine',
        ref: step.routineId,
        input: value,
        output: null,
        note: 'no implementation',
      });
      value = null;
      break;
    }
    const r = impl({ value, inputs, configuration: step.configuration });
    if (r.ok) {
      steps.push({ kind: 'routine', ref: step.routineId, input: value, output: r.value });
      value = r.value;
    } else if (step.onError === 'continue') {
      note('warning', r.code, `${r.message} The step was skipped.`, {
        routineId: step.routineId,
      } as Partial<Diagnostic>);
      steps.push({
        kind: 'routine',
        ref: step.routineId,
        input: value,
        output: value,
        note: `skipped: ${r.message}`,
      });
    } else {
      note('error', r.code, r.message, { routineId: step.routineId } as Partial<Diagnostic>);
      steps.push({
        kind: 'routine',
        ref: step.routineId,
        input: value,
        output: null,
        note: r.message,
      });
      value = null;
      break;
    }
  }

  const result: CellResult = { value, diagnostics };
  if (env.collectLineage) {
    result.lineage = {
      targetFieldId: m.targetFieldId,
      fieldMappingId: m.id,
      sources: m.sourceReferences.map((r, i) => {
        const sourceRow = env.row.rowNumber(r.datasetId);
        return {
          datasetId: r.datasetId,
          fieldId: r.fieldId,
          ...(sourceRow !== undefined ? { sourceRow } : {}),
          value: inputs[i] ?? null,
        };
      }),
      steps,
    };
  }
  return result;
}
