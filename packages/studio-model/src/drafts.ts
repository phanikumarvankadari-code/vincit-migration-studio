import {
  ConstantValueSchema,
  FieldMappingSchema,
  type ConditionExpr,
  type DataType,
  type FieldMapping,
  type JsonValue,
  type LookupDefinition,
  type MissingValueBehavior,
  type Project,
  type TransformationStep,
  type ValueOperand,
} from '@mms/mapping-core';
import { checkRoutineConfiguration } from '@mms/routine-library';

/**
 * A mapping as the editor sees it: plain strings and choices. `draftToMapping` turns it into a canonical
 * FieldMapping or lists what is wrong in words a consultant can act on.
 */
export interface FieldRef {
  datasetId: string;
  fieldId: string;
}
export type OperandDraft =
  | { kind: 'field'; ref: FieldRef | undefined }
  | { kind: 'text'; value: string }
  | { kind: 'current' };
export type CompareOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'isEmpty' | 'notEmpty';
export interface RuleDraft {
  left: OperandDraft;
  operator: CompareOperator;
  /** Text compared against. Not used for isEmpty and notEmpty. */
  right: string;
  then: OperandDraft;
}
export type MissingDraft =
  { kind: 'error' | 'warning' | 'keepSource' | 'null' } | { kind: 'default'; value: string };
export type StepDraft =
  | {
      kind: 'routine';
      routineId: string;
      /** JSON text */ configuration: string;
      onError: 'stop' | 'continue';
    }
  | { kind: 'lookup'; lookupId: string; missing: MissingDraft };
export interface LookupDraft {
  id: string;
  name: string;
  entries: { key: string; value: string }[];
}

export type MappingDraft =
  | { type: 'direct'; source: FieldRef | undefined }
  | { type: 'constant'; value: string; datatype: DataType; blank: boolean }
  | { type: 'lookup'; source: FieldRef | undefined; lookup: LookupDraft; missing: MissingDraft }
  | {
      type: 'conditional';
      source: FieldRef | undefined;
      rules: RuleDraft[];
      otherwise: OperandDraft | undefined;
    }
  | { type: 'routine'; source: FieldRef | undefined; steps: StepDraft[] };

export type DraftType = MappingDraft['type'];
export const DRAFT_TYPES: readonly { type: DraftType; label: string; help: string }[] = [
  { type: 'direct', label: 'Direct', help: 'Copy a source field as it is.' },
  { type: 'constant', label: 'Constant', help: 'Always use the same value.' },
  {
    type: 'lookup',
    label: 'Lookup',
    help: 'Translate a source value with a table (for example 1000 → FI01).',
  },
  { type: 'conditional', label: 'Condition', help: 'Choose a value with if / otherwise rules.' },
  {
    type: 'routine',
    label: 'Routine chain',
    help: 'Take a source field and change it step by step: Date Format, text, numbers, IDs.',
  },
];

export function emptyDraft(type: DraftType, mappingKey = 'lookup'): MappingDraft {
  switch (type) {
    case 'direct':
      return { type, source: undefined };
    case 'constant':
      return { type, value: '', datatype: 'string', blank: false };
    case 'lookup':
      return {
        type,
        source: undefined,
        lookup: { id: `lk-${mappingKey}`, name: 'New lookup', entries: [{ key: '', value: '' }] },
        missing: { kind: 'error' },
      };
    case 'conditional':
      return {
        type,
        source: undefined,
        rules: [
          {
            left: { kind: 'current' },
            operator: 'eq',
            right: '',
            then: { kind: 'text', value: '' },
          },
        ],
        otherwise: { kind: 'text', value: '' },
      };
    case 'routine':
      return { type, source: undefined, steps: [] };
  }
}

const text = (v: string | number | boolean | null): string => (v === null ? '' : String(v));

function operandToDraft(o: ValueOperand): OperandDraft {
  return o.kind === 'field'
    ? { kind: 'field', ref: { datasetId: o.datasetId, fieldId: o.fieldId } }
    : o.kind === 'constant'
      ? { kind: 'text', value: text(o.constant.value) }
      : { kind: 'current' };
}

function missingToDraft(m: MissingValueBehavior): MissingDraft {
  return m.kind === 'default' ? { kind: 'default', value: text(m.value.value) } : { kind: m.kind };
}

function ruleToDraft(c: ConditionExpr, then: ValueOperand): RuleDraft | undefined {
  if (c.op === 'compare')
    return {
      left: operandToDraft(c.left),
      operator: c.operator,
      right: c.right.kind === 'constant' ? text(c.right.constant.value) : '',
      then: operandToDraft(then),
    };
  if (c.op === 'isEmpty')
    return {
      left: operandToDraft(c.operand),
      operator: 'isEmpty',
      right: '',
      then: operandToDraft(then),
    };
  if (c.op === 'not' && c.condition.op === 'isEmpty')
    return {
      left: operandToDraft(c.condition.operand),
      operator: 'notEmpty',
      right: '',
      then: operandToDraft(then),
    };
  return undefined; // conditions the editor cannot show (in, and, or) are left to the Visual Mapper / later work
}

/** The editor can show a mapping if every part of it fits its forms. Otherwise undefined. */
export function mappingToDraft(project: Project, m: FieldMapping): MappingDraft | undefined {
  const source = m.sourceReferences[0]
    ? { datasetId: m.sourceReferences[0].datasetId, fieldId: m.sourceReferences[0].fieldId }
    : undefined;
  const steps: StepDraft[] = m.transformations
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) =>
      t.kind === 'routine'
        ? {
            kind: 'routine',
            routineId: t.routineId,
            configuration: JSON.stringify(t.configuration, null, 2),
            onError: t.onError,
          }
        : { kind: 'lookup', lookupId: t.lookupId, missing: missingToDraft(t.missingValue) },
    );
  switch (m.mappingType) {
    case 'direct':
      return steps.length === 0 ? { type: 'direct', source } : { type: 'routine', source, steps };
    case 'routine':
      return { type: 'routine', source, steps };
    case 'constant':
      return steps.length > 0
        ? undefined
        : {
            type: 'constant',
            value: text(m.constant.value),
            datatype: m.constant.datatype,
            blank: m.constant.value === null,
          };
    case 'lookup': {
      const def = project.lookups.find((l) => l.id === m.lookup.lookupId);
      if (steps.length > 0 || !def) return undefined;
      return {
        type: 'lookup',
        source,
        lookup: {
          id: def.id,
          name: def.name,
          entries: def.entries.map((e) => ({ key: e.key, value: text(e.value) })),
        },
        missing: missingToDraft(m.lookup.missingValue),
      };
    }
    case 'conditional': {
      if (steps.length > 0) return undefined;
      const rules = m.conditional.rules.map((r) => ruleToDraft(r.when, r.then));
      if (rules.some((r) => r === undefined)) return undefined;
      return {
        type: 'conditional',
        source,
        rules: rules as RuleDraft[],
        otherwise: m.conditional.otherwise ? operandToDraft(m.conditional.otherwise) : undefined,
      };
    }
    case 'javascript':
      return undefined;
  }
}

export type DraftResult =
  | { ok: true; mapping: FieldMapping; lookups: LookupDefinition[] }
  | { ok: false; problems: string[] };

const SEQUENCE = (steps: TransformationStep[]): TransformationStep[] =>
  steps.map((s, order) => ({ ...s, order }));

function missingFromDraft(m: MissingDraft): MissingValueBehavior {
  return m.kind === 'default'
    ? { kind: 'default', value: { datatype: 'string', value: m.value } }
    : { kind: m.kind };
}

/** Whether `text` is valid for the datatype. Returns the canonical constant or a reason. */
export function constantFrom(
  datatype: DataType,
  raw: string,
  blank: boolean,
):
  | { ok: true; constant: { datatype: DataType; value: string | number | boolean | null } }
  | { ok: false; reason: string } {
  if (blank) return { ok: true, constant: { datatype, value: null } };
  let value: string | number | boolean = raw;
  if (datatype === 'integer') {
    if (!/^-?\d+$/.test(raw.trim()))
      return { ok: false, reason: `"${raw}" is not a whole number.` };
    value = Number(raw.trim());
  } else if (datatype === 'boolean') {
    if (!/^(true|false)$/i.test(raw.trim()))
      return { ok: false, reason: 'Boolean must be true or false.' };
    value = raw.trim().toLowerCase() === 'true';
  } else if (datatype === 'decimal' && !/^-?\d+(\.\d+)?$/.test(raw.trim())) {
    return { ok: false, reason: `"${raw}" is not a plain decimal number such as 12.50.` };
  } else if (datatype === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return { ok: false, reason: 'A date constant must be written as YYYY-MM-DD.' };
  }
  const parsed = ConstantValueSchema.safeParse({ datatype, value });
  return parsed.success
    ? { ok: true, constant: parsed.data }
    : { ok: false, reason: 'The value does not fit the datatype.' };
}

const OPERATORS: Record<Exclude<CompareOperator, 'isEmpty' | 'notEmpty'>, true> = {
  eq: true,
  ne: true,
  gt: true,
  gte: true,
  lt: true,
  lte: true,
};

export function draftToMapping(
  project: Project,
  structureId: string,
  fieldId: string,
  draft: MappingDraft,
  options: { needsReview?: boolean } = {},
): DraftResult {
  const problems: string[] = [];
  const id = `m-${fieldId}`;
  const ref = (r: FieldRef | undefined, what: string): FieldRef | undefined => {
    if (!r) {
      problems.push(`Choose ${what}.`);
      return undefined;
    }
    const known = project.sourceDefinitions.some((s) =>
      s.datasets.some((d) => d.id === r.datasetId && d.fields.some((f) => f.id === r.fieldId)),
    );
    if (!known) problems.push(`The source field for ${what} no longer exists.`);
    return r;
  };
  const base = {
    id,
    targetStructureId: structureId,
    targetFieldId: fieldId,
    status: options.needsReview ? 'needsReview' : 'mapped',
  } as const;
  const lookups: LookupDefinition[] = [];

  const operand = (o: OperandDraft, what: string): ValueOperand | undefined => {
    if (o.kind === 'current') return { kind: 'current' };
    if (o.kind === 'text')
      return { kind: 'constant', constant: { datatype: 'string', value: o.value } };
    const r = ref(o.ref, what);
    return r
      ? { kind: 'field', datasetId: r.datasetId as never, fieldId: r.fieldId as never }
      : undefined;
  };
  const lookupFrom = (l: LookupDraft): string => {
    const entries = l.entries.filter((e) => e.key !== '' || e.value !== '');
    if (l.name.trim() === '') problems.push('Give the lookup a name.');
    if (entries.length === 0) problems.push('Add at least one lookup entry.');
    const keys = entries.map((e) => e.key);
    if (new Set(keys).size !== keys.length) problems.push('A lookup key appears more than once.');
    if (entries.some((e) => e.key === '')) problems.push('Every lookup entry needs a key.');
    lookups.push({
      id: l.id as LookupDefinition['id'],
      name: l.name.trim() || l.id,
      keyDatatype: 'string',
      valueDatatype: 'string',
      entries: entries.map((e) => ({ key: e.key, value: e.value })),
    });
    return l.id;
  };

  const stepsFrom = (drafts: StepDraft[]): TransformationStep[] => {
    const out: TransformationStep[] = [];
    drafts.forEach((s, i) => {
      if (s.kind === 'lookup') {
        if (!project.lookups.some((l) => l.id === s.lookupId))
          problems.push(`Step ${i + 1}: the lookup "${s.lookupId}" does not exist.`);
        out.push({
          kind: 'lookup',
          lookupId: s.lookupId as never,
          configuration: {},
          missingValue: missingFromDraft(s.missing),
          order: i,
        });
        return;
      }
      let configuration: Record<string, JsonValue> = {};
      try {
        const parsed: unknown = s.configuration.trim() === '' ? {} : JSON.parse(s.configuration);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('not an object');
        configuration = parsed as Record<string, JsonValue>;
      } catch {
        problems.push(`Step ${i + 1}: the settings are not valid JSON (use {"setting": "value"}).`);
      }
      for (const d of checkRoutineConfiguration(s.routineId, configuration))
        problems.push(`Step ${i + 1}: ${d.message}`);
      out.push({
        kind: 'routine',
        routineId: s.routineId as never,
        configuration,
        order: i,
        onError: s.onError,
      });
    });
    return out;
  };

  let candidate: unknown;
  switch (draft.type) {
    case 'direct': {
      const r = ref(draft.source, 'a source field');
      candidate = {
        ...base,
        mappingType: 'direct',
        sourceReferences: r ? [r] : [],
        transformations: [],
      };
      break;
    }
    case 'constant': {
      const c = constantFrom(draft.datatype, draft.value, draft.blank);
      if (!c.ok) problems.push(c.reason);
      else if (!draft.blank && draft.value === '')
        problems.push('Enter the constant value, or tick "blank".');
      candidate = {
        ...base,
        mappingType: 'constant',
        sourceReferences: [],
        transformations: [],
        constant: c.ok ? c.constant : { datatype: 'string', value: '' },
      };
      break;
    }
    case 'lookup': {
      const r = ref(draft.source, 'the source field to look up');
      const lookupId = lookupFrom(draft.lookup);
      candidate = {
        ...base,
        mappingType: 'lookup',
        sourceReferences: r ? [r] : [],
        transformations: [],
        lookup: { lookupId, configuration: {}, missingValue: missingFromDraft(draft.missing) },
      };
      break;
    }
    case 'conditional': {
      const r = draft.source ? ref(draft.source, 'a source field') : undefined;
      const rules = draft.rules.map((rule, i) => {
        const left = operand(rule.left, `the field in rule ${i + 1}`);
        const then = operand(rule.then, `the result of rule ${i + 1}`);
        let when: ConditionExpr | undefined;
        if (left && rule.operator === 'isEmpty') when = { op: 'isEmpty', operand: left };
        else if (left && rule.operator === 'notEmpty')
          when = { op: 'not', condition: { op: 'isEmpty', operand: left } };
        else if (left && rule.operator in OPERATORS)
          when = {
            op: 'compare',
            operator: rule.operator as keyof typeof OPERATORS,
            left,
            right: { kind: 'constant', constant: { datatype: 'string', value: rule.right } },
          };
        return when && then ? { when, then } : undefined;
      });
      if (draft.rules.length === 0) problems.push('Add at least one rule.');
      const otherwise = draft.otherwise
        ? operand(draft.otherwise, 'the "otherwise" result')
        : undefined;
      candidate = {
        ...base,
        mappingType: 'conditional',
        sourceReferences: r ? [r] : [],
        transformations: [],
        conditional: { rules: rules.filter(Boolean), ...(otherwise ? { otherwise } : {}) },
      };
      break;
    }
    case 'routine': {
      const r = ref(draft.source, 'a source field');
      if (draft.steps.length === 0) problems.push('Add at least one step.');
      candidate = {
        ...base,
        mappingType: 'routine',
        sourceReferences: r ? [r] : [],
        transformations: SEQUENCE(stepsFrom(draft.steps)),
      };
      break;
    }
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  const parsed = FieldMappingSchema.safeParse(candidate);
  return parsed.success
    ? { ok: true, mapping: parsed.data, lookups }
    : { ok: false, problems: parsed.error.issues.map((i) => i.message) };
}
