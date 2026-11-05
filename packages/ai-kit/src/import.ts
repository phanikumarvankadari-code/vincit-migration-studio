import {
  FieldMappingSchema,
  LookupDefinitionSchema,
  validateProject,
  type FieldMapping,
  type LookupDefinition,
  type Project,
} from '@mms/mapping-core';
import { upsertLookup, upsertMapping } from '@mms/studio-model';

export interface ImportedMapping {
  targetStructureId: string;
  targetFieldId: string;
  structure: string;
  field: string;
  source: string;
  mappingType: 'direct' | 'lookup';
}

export interface SkippedItem {
  /** 1-based position in the AI answer ("lookup 2" for a lookup table). */
  item: string;
  targetFieldId?: string;
  code: string;
  message: string;
}

export interface UnmappedField {
  structure: string;
  field: string;
  required: boolean;
  /** Dates are set by the user, not the AI. */
  manual: boolean;
}

export interface ImportReport {
  /** The answer could not be read as JSON at all. */
  parseError?: string;
  imported: ImportedMapping[];
  lookupsAdded: string[];
  skipped: SkippedItem[];
  /** Target fields that still have no mapping after the import. */
  unmapped: UnmappedField[];
  /** Problems the project check found in what was imported. */
  notes: string[];
}

export interface ImportOutcome {
  project: Project;
  report: ImportReport;
}

/** What an AI may add to a mapping to explain itself. Dropped, not stored. */
const SOFT_KEYS = ['confidence', 'reason', 'rationale', 'note', 'notes', 'comment', 'source'];

function parseOne(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Finds the JSON in an AI answer: the whole text, or the fenced code blocks, or the outermost braces. Several blocks
 * (one per structure) are merged.
 */
function extractJson(text: string): { mappings: unknown[]; lookups: unknown[] } | string {
  const candidates: unknown[] = [];
  const whole = parseOne(text.trim());
  if (whole !== undefined) candidates.push(whole);
  else {
    for (const m of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
      const v = parseOne(m[1]!.trim());
      if (v !== undefined) candidates.push(v);
    }
    if (candidates.length === 0) {
      const a = text.indexOf('{');
      const b = text.lastIndexOf('}');
      const v = a >= 0 && b > a ? parseOne(text.slice(a, b + 1)) : undefined;
      if (v !== undefined) candidates.push(v);
    }
  }
  if (candidates.length === 0)
    return 'No JSON was found in the answer. Ask the AI to return the mappings as one JSON code block.';
  const mappings: unknown[] = [];
  const lookups: unknown[] = [];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      mappings.push(...c);
      continue;
    }
    const o = c as Record<string, unknown>;
    const def = (o['mappingDefinition'] ?? undefined) as Record<string, unknown> | undefined;
    const m = o['mappings'] ?? def?.['mappings'];
    if (Array.isArray(m)) mappings.push(...m);
    if (Array.isArray(o['lookups'])) lookups.push(...o['lookups']);
  }
  if (mappings.length === 0 && lookups.length === 0)
    return 'The JSON has no "mappings" list. Ask the AI to use the shape in examples.json.';
  return { mappings, lookups };
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * Reads what a chat AI proposed and merges the valid part into the project as draft mappings ("needs review").
 * Only direct and lookup mappings are accepted, never on date fields, and never over a mapping that is already
 * there. Everything else is skipped with the reason, so the report can be pasted back to the AI to fix.
 */
export function importAiResult(project: Project, text: string, at: string): ImportOutcome {
  const report: ImportReport = {
    imported: [],
    lookupsAdded: [],
    skipped: [],
    unmapped: [],
    notes: [],
  };
  const found = extractJson(text);
  if (typeof found === 'string') {
    report.parseError = found;
    report.unmapped = unmappedFields(project);
    return { project, report };
  }

  const structures = project.targetDefinition?.structures ?? [];
  const fieldOwner = new Map<string, (typeof structures)[number]>();
  for (const s of structures) for (const f of s.fields) fieldOwner.set(f.id, s);
  const sourceFields = new Map<string, { datasetId: string; name: string }>();
  for (const sd of project.sourceDefinitions)
    for (const d of sd.datasets)
      for (const f of d.fields)
        sourceFields.set(f.id, {
          datasetId: d.id,
          name: `${d.displayName ?? d.name}.${f.technicalName ?? f.displayName}`,
        });

  let next = project;
  const knownLookups = new Set(project.lookups.map((l) => l.id as string));
  const skip = (item: string, code: string, message: string, targetFieldId?: string): void => {
    report.skipped.push({ item, code, message, ...(targetFieldId ? { targetFieldId } : {}) });
  };

  // Lookup tables first, so mappings can use them.
  found.lookups.forEach((raw, i) => {
    const item = `lookup ${i + 1}`;
    const o = asObject(raw);
    if (!o)
      return skip(item, 'AI_INVALID_ITEM', 'A lookup must be an object with a name and entries.');
    const name = typeof o['name'] === 'string' ? o['name'] : '';
    const entries = Array.isArray(o['entries']) ? o['entries'] : [];
    const candidate = {
      keyDatatype: 'string',
      valueDatatype: 'string',
      ...o,
      id: typeof o['id'] === 'string' && o['id'] ? o['id'] : `lk-${slug(name) || i + 1}`,
      entries: entries.map((e) => {
        const eo = asObject(e) ?? {};
        return { key: String(eo['key'] ?? ''), value: eo['value'] ?? null };
      }),
    };
    const parsed = LookupDefinitionSchema.safeParse(candidate);
    if (!parsed.success)
      return skip(item, 'AI_INVALID_ITEM', `Lookup "${name}": ${issueText(parsed.error.issues)}`);
    if (knownLookups.has(parsed.data.id))
      return skip(
        item,
        'AI_LOOKUP_EXISTS',
        `A lookup with the ID "${parsed.data.id}" already exists. Use another ID.`,
      );
    knownLookups.add(parsed.data.id);
    next = upsertLookup(next, parsed.data as LookupDefinition, at);
    report.lookupsAdded.push(parsed.data.name);
  });

  const mapped = new Set(
    project.mappingDefinition.mappings.map((m) => `${m.targetStructureId}/${m.targetFieldId}`),
  );
  const taken = new Set<string>();
  const accepted: FieldMapping[] = [];

  found.mappings.forEach((raw, i) => {
    const item = String(i + 1);
    const o0 = asObject(raw);
    if (!o0) return skip(item, 'AI_INVALID_ITEM', 'A mapping must be an object.');
    const o: Record<string, unknown> = { ...o0 };
    for (const k of SOFT_KEYS) delete o[k];
    const targetFieldId = typeof o['targetFieldId'] === 'string' ? o['targetFieldId'] : undefined;
    if (!targetFieldId) return skip(item, 'AI_UNKNOWN_TARGET', 'The mapping has no targetFieldId.');
    const owner = fieldOwner.get(targetFieldId);
    if (!owner)
      return skip(
        item,
        'AI_UNKNOWN_TARGET',
        `The target field "${targetFieldId}" is not in the catalog. Copy the Field ID exactly.`,
        targetFieldId,
      );
    if (o['targetStructureId'] !== undefined && o['targetStructureId'] !== owner.id)
      return skip(
        item,
        'AI_FIELD_NOT_IN_STRUCTURE',
        `The target field "${targetFieldId}" belongs to structure "${owner.id}", not "${String(o['targetStructureId'])}".`,
        targetFieldId,
      );
    const field = owner.fields.find((f) => f.id === targetFieldId)!;
    const type = o['mappingType'];
    if (type !== 'direct' && type !== 'lookup')
      return skip(
        item,
        'AI_TYPE_NOT_ALLOWED',
        `Only "direct" and "lookup" mappings can be proposed (got "${String(type)}"). Constants, routines and JavaScript are set by the user.`,
        targetFieldId,
      );
    if (field.datatype === 'date' || field.datatype === 'dateTime')
      return skip(
        item,
        'AI_DATE_MANUAL',
        `"${field.displayName}" is a date field. Dates are converted by the user, so leave it out.`,
        targetFieldId,
      );
    const refs = Array.isArray(o['sourceReferences']) ? o['sourceReferences'] : [];
    if (refs.length !== 1)
      return skip(
        item,
        'AI_NEEDS_ONE_SOURCE',
        `A ${type} mapping needs exactly one source field in sourceReferences (got ${refs.length}).`,
        targetFieldId,
      );
    const ref = asObject(refs[0]);
    const src =
      ref && typeof ref['fieldId'] === 'string' ? sourceFields.get(ref['fieldId']) : undefined;
    if (!ref || !src)
      return skip(
        item,
        'AI_UNKNOWN_SOURCE',
        `The source field "${String(ref?.['fieldId'])}" is not in the catalog. Copy the Field ID exactly.`,
        targetFieldId,
      );
    if (ref['datasetId'] !== src.datasetId)
      return skip(
        item,
        'AI_UNKNOWN_SOURCE',
        `The source field "${String(ref['fieldId'])}" belongs to dataset "${src.datasetId}", not "${String(ref['datasetId'])}".`,
        targetFieldId,
      );
    const key = `${owner.id}/${targetFieldId}`;
    if (mapped.has(key))
      return skip(
        item,
        'AI_ALREADY_MAPPED',
        `"${field.displayName}" already has a mapping. It was not changed.`,
        targetFieldId,
      );
    if (taken.has(key))
      return skip(
        item,
        'AI_DUPLICATE_TARGET',
        `"${field.displayName}" is proposed twice. The first one was kept.`,
        targetFieldId,
      );
    if (type === 'lookup') {
      const lookup = asObject(o['lookup']);
      const lookupId = lookup && typeof lookup['lookupId'] === 'string' ? lookup['lookupId'] : '';
      if (!knownLookups.has(lookupId))
        return skip(
          item,
          'AI_UNKNOWN_LOOKUP',
          `The lookup "${lookupId}" does not exist. Add it to "lookups" first.`,
          targetFieldId,
        );
      o['lookup'] = { configuration: {}, missingValue: { kind: 'error' }, ...lookup };
    }
    const candidate = {
      transformations: [],
      ...o,
      id: typeof o['id'] === 'string' && o['id'] ? o['id'] : `m-${targetFieldId}`,
      targetStructureId: owner.id,
      status: 'needsReview',
    };
    const parsed = FieldMappingSchema.safeParse(candidate);
    if (!parsed.success)
      return skip(item, 'AI_INVALID_ITEM', issueText(parsed.error.issues), targetFieldId);
    taken.add(key);
    accepted.push(parsed.data);
    report.imported.push({
      targetStructureId: owner.id,
      targetFieldId,
      structure: owner.name,
      field: field.displayName,
      source: src.name,
      mappingType: type,
    });
  });

  for (const m of accepted) next = upsertMapping(next, m, at);

  const acceptedIds = new Set(accepted.map((m) => m.id as string));
  for (const d of validateProject(next))
    if (d.severity !== 'info' && d.fieldMappingId && acceptedIds.has(d.fieldMappingId as string))
      report.notes.push(d.message);
  report.unmapped = unmappedFields(next);
  return { project: next, report };
}

function issueText(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

function unmappedFields(project: Project): UnmappedField[] {
  const mapped = new Set(
    project.mappingDefinition.mappings.map((m) => `${m.targetStructureId}/${m.targetFieldId}`),
  );
  return (project.targetDefinition?.structures ?? []).flatMap((s) =>
    s.fields
      .filter((f) => !mapped.has(`${s.id}/${f.id}`))
      .map((f) => ({
        structure: s.name,
        field: f.displayName,
        required: f.required,
        manual: f.datatype === 'date' || f.datatype === 'dateTime',
      })),
  );
}

/** The report as plain text to paste back to the AI so it can fix the skipped items. */
export function reportToText(report: ImportReport): string {
  const lines: string[] = [];
  if (report.parseError) {
    lines.push(`Your answer could not be imported: ${report.parseError}`);
    return lines.join('\n');
  }
  lines.push(
    `Imported ${report.imported.length} mapping(s)${report.lookupsAdded.length ? ` and ${report.lookupsAdded.length} lookup(s)` : ''}.`,
  );
  if (report.skipped.length > 0) {
    lines.push(
      '',
      'These items were NOT imported. Fix only these and answer with one JSON code block that contains just the corrected items:',
    );
    for (const s of report.skipped)
      lines.push(
        `- Item ${s.item}${s.targetFieldId ? ` (target ${s.targetFieldId})` : ''}: ${s.message}`,
      );
  }
  if (report.notes.length > 0) {
    lines.push('', 'Please check these points about what was imported:');
    for (const n of report.notes) lines.push(`- ${n}`);
  }
  const open = report.unmapped.filter((u) => !u.manual);
  if (open.length > 0) {
    lines.push('', `Target fields still without a mapping (${open.length}):`);
    for (const u of open.slice(0, 80))
      lines.push(`- ${u.structure} / ${u.field}${u.required ? ' (required)' : ''}`);
    if (open.length > 80) lines.push(`- ... and ${open.length - 80} more`);
  }
  return lines.join('\n');
}
