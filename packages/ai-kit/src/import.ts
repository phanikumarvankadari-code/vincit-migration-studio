import {
  FieldMappingSchema,
  LookupDefinitionSchema,
  validateProject,
  type FieldMapping,
  type LookupDefinition,
  type Project,
} from '@mms/mapping-core';
import {
  applyDescriptions,
  applyPairings,
  upsertLookup,
  upsertMapping,
  type PairingEdit,
} from '@mms/studio-model';

export interface ImportedMapping {
  targetStructureId: string;
  targetFieldId: string;
  structure: string;
  field: string;
  source: string;
  mappingType: 'direct' | 'lookup';
}

export interface ImportedPairing {
  structure: string;
  mainTable: string;
  extraTables: string[];
}

export interface SkippedItem {
  /** Where in the AI answer, for example "3", "pairing 2" or "field description 7". */
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
  tableDescriptions: number;
  fieldDescriptions: number;
  pairings: ImportedPairing[];
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
const SOFT_KEYS = ['confidence', 'reason', 'rationale', 'note', 'notes', 'comment'];

interface Found {
  tableDescriptions: unknown[];
  fieldDescriptions: unknown[];
  pairings: unknown[];
  lookups: unknown[];
  mappings: unknown[];
}

function parseOne(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Finds the JSON in an AI answer: the whole text, or the fenced code blocks, or the outermost braces. Several blocks
 * (one per step or structure) are merged.
 */
function extractJson(text: string): Found | string {
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
    return 'No JSON was found in the answer. Ask the AI to return its result as one JSON code block.';
  const found: Found = {
    tableDescriptions: [],
    fieldDescriptions: [],
    pairings: [],
    lookups: [],
    mappings: [],
  };
  for (const c of candidates) {
    if (Array.isArray(c)) {
      found.mappings.push(...c);
      continue;
    }
    const o = c as Record<string, unknown>;
    const def = (o['mappingDefinition'] ?? undefined) as Record<string, unknown> | undefined;
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    found.tableDescriptions.push(...list(o['tableDescriptions']));
    found.fieldDescriptions.push(...list(o['fieldDescriptions']));
    found.pairings.push(...list(o['pairings']));
    found.lookups.push(...list(o['lookups']));
    found.mappings.push(...list(o['mappings'] ?? def?.['mappings']));
  }
  const total = Object.values(found).reduce((n, l) => n + l.length, 0);
  if (total === 0)
    return 'The JSON has none of "tableDescriptions", "fieldDescriptions", "pairings" or "mappings". Ask the AI to use the shapes in the prompt.';
  return found;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const norm = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .toLowerCase();

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function issueText(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** The tables, fields and structures of a project, found by name. */
function indexOf(project: Project) {
  const datasets = project.sourceDefinitions.flatMap((s) => s.datasets);
  const structures = project.targetDefinition?.structures ?? [];
  return {
    datasets,
    structures,
    table(name: unknown) {
      const n = norm(name);
      return datasets.find((d) => norm(d.displayName) === n || norm(d.name) === n);
    },
    structure(name: unknown) {
      const n = norm(name);
      return structures.find((s) => norm(s.name) === n || norm(s.templateSheet) === n);
    },
    /** A source field by technical name or name inside a table. `undefined` = none, `null` = several. */
    sourceField(dataset: (typeof datasets)[number], name: unknown) {
      const n = norm(name);
      const hits = dataset.fields.filter(
        (f) => norm(f.technicalName) === n || norm(f.displayName) === n,
      );
      return hits.length === 1 ? hits[0] : hits.length === 0 ? undefined : null;
    },
    /** A target field by technical name, then by description, inside a structure. */
    targetField(structure: (typeof structures)[number], name: unknown) {
      const n = norm(name);
      let hits = structure.fields.filter((f) => norm(f.technicalName) === n);
      if (hits.length === 0) hits = structure.fields.filter((f) => norm(f.displayName) === n);
      return hits.length === 1 ? hits[0] : hits.length === 0 ? undefined : null;
    },
  };
}

/**
 * Reads what a chat AI proposed and merges the valid part into the project: table and field descriptions, the
 * pairing of target structures with their main source table ("suggested"), and direct or lookup mappings ("needs
 * review"). Mappings are never made on date fields and never over a mapping that is already there. Everything else
 * is skipped with the reason, so the report can be pasted back to the AI to fix.
 */
export function importAiResult(project: Project, answer: string, at: string): ImportOutcome {
  const report: ImportReport = {
    imported: [],
    lookupsAdded: [],
    tableDescriptions: 0,
    fieldDescriptions: 0,
    pairings: [],
    skipped: [],
    unmapped: [],
    notes: [],
  };
  const found = extractJson(answer);
  if (typeof found === 'string') {
    report.parseError = found;
    report.unmapped = unmappedFields(project);
    return { project, report };
  }
  const skip = (item: string, code: string, message: string, targetFieldId?: string): void => {
    report.skipped.push({ item, code, message, ...(targetFieldId ? { targetFieldId } : {}) });
  };

  let next = project;
  const ix0 = indexOf(project);

  // 1. Descriptions of tables and fields
  const tables: { datasetId: string; description: string }[] = [];
  found.tableDescriptions.forEach((raw, i) => {
    const item = `table description ${i + 1}`;
    const o = asObject(raw);
    const d = ix0.table(o?.['table']);
    const description = text(o?.['description']);
    if (!o || !d)
      return skip(
        item,
        'AI_UNKNOWN_TABLE',
        `The table "${text(o?.['table'])}" is not among the source tables.`,
      );
    if (!description)
      return skip(item, 'AI_INVALID_ITEM', `The description of "${d.displayName}" is empty.`);
    tables.push({ datasetId: d.id, description });
  });
  const fields: { datasetId: string; fieldId: string; description: string }[] = [];
  const addField = (
    item: string,
    tableName: unknown,
    fieldName: unknown,
    descriptionRaw: unknown,
  ): void => {
    const d = ix0.table(tableName);
    if (!d)
      return skip(
        item,
        'AI_UNKNOWN_TABLE',
        `The table "${text(tableName)}" is not among the source tables.`,
      );
    const f = ix0.sourceField(d, fieldName);
    if (f === undefined)
      return skip(
        item,
        'AI_UNKNOWN_SOURCE',
        `The field "${text(fieldName)}" is not in table "${d.displayName}".`,
      );
    if (f === null)
      return skip(
        item,
        'AI_AMBIGUOUS_NAME',
        `The name "${text(fieldName)}" matches several fields of "${d.displayName}".`,
      );
    const description = text(descriptionRaw);
    if (!description)
      return skip(
        item,
        'AI_INVALID_ITEM',
        `The description of "${d.displayName}.${text(fieldName)}" is empty.`,
      );
    fields.push({ datasetId: d.id, fieldId: f.id, description });
  };
  found.fieldDescriptions.forEach((raw, i) => {
    const o = asObject(raw);
    if (!o)
      return skip(
        `field description ${i + 1}`,
        'AI_INVALID_ITEM',
        'A field description must be an object.',
      );
    if (Array.isArray(o['fields'])) {
      // grouped by table: { table, fields: [{ field, description }] }
      o['fields'].forEach((fr, j) => {
        const fo = asObject(fr);
        addField(
          `field description ${i + 1}.${j + 1}`,
          o['table'],
          fo?.['field'],
          fo?.['description'],
        );
      });
    } else addField(`field description ${i + 1}`, o['table'], o['field'], o['description']);
  });
  if (tables.length > 0 || fields.length > 0) {
    next = applyDescriptions(next, { tables, fields }, at);
    report.tableDescriptions = tables.length;
    report.fieldDescriptions = fields.length;
  }

  // 2. Pairing of structures with their main table
  const ix = indexOf(next);
  const edits: PairingEdit[] = [];
  const paired = new Set<string>();
  found.pairings.forEach((raw, i) => {
    const item = `pairing ${i + 1}`;
    const o = asObject(raw);
    const s = ix.structure(o?.['structure']);
    if (!o || !s)
      return skip(
        item,
        'AI_UNKNOWN_STRUCTURE',
        `The structure "${text(o?.['structure'])}" is not in the target.`,
      );
    const main = ix.table(o['mainTable'] ?? o['table']);
    if (!main)
      return skip(
        item,
        'AI_UNKNOWN_TABLE',
        `The main table "${text(o['mainTable'] ?? o['table'])}" is not among the source tables.`,
      );
    if (paired.has(s.id))
      return skip(
        item,
        'AI_DUPLICATE_TARGET',
        `"${s.name}" is paired twice. The first one was kept.`,
      );
    const extras: string[] = [];
    const extraNames: string[] = [];
    for (const n of Array.isArray(o['extraTables']) ? o['extraTables'] : []) {
      const t = ix.table(n);
      if (!t)
        skip(
          item,
          'AI_UNKNOWN_TABLE',
          `The extra table "${text(n)}" is not among the source tables. It was left out.`,
        );
      else if (t.id !== main.id && !extras.includes(t.id)) {
        extras.push(t.id);
        extraNames.push(t.displayName);
      }
    }
    paired.add(s.id);
    edits.push({
      structureId: s.id,
      driverDatasetId: main.id,
      helperDatasetIds: extras,
      status: 'suggested',
    });
    report.pairings.push({
      structure: s.name,
      mainTable: main.displayName,
      extraTables: extraNames,
    });
  });
  if (edits.length > 0) next = applyPairings(next, edits, at);

  // 3. Lookup tables
  const knownLookups = new Set(project.lookups.map((l) => l.id as string));
  const lookupByName = new Map(project.lookups.map((l) => [norm(l.name), l.id as string]));
  found.lookups.forEach((raw, i) => {
    const item = `lookup ${i + 1}`;
    const o = asObject(raw);
    if (!o)
      return skip(item, 'AI_INVALID_ITEM', 'A lookup must be an object with a name and entries.');
    const name = text(o['name']);
    const entries = Array.isArray(o['entries']) ? o['entries'] : [];
    const candidate = {
      keyDatatype: 'string',
      valueDatatype: 'string',
      ...o,
      id: text(o['id']) || `lk-${slug(name) || i + 1}`,
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
    lookupByName.set(norm(parsed.data.name), parsed.data.id);
    next = upsertLookup(next, parsed.data as LookupDefinition, at);
    report.lookupsAdded.push(parsed.data.name);
  });

  // 4. Mappings
  const sourceById = new Map<string, { datasetId: string; name: string }>();
  for (const d of ix.datasets)
    for (const f of d.fields)
      sourceById.set(f.id, {
        datasetId: d.id,
        name: `${d.displayName}.${f.technicalName ?? f.displayName}`,
      });
  const fieldOwner = new Map<string, (typeof ix.structures)[number]>();
  for (const s of ix.structures) for (const f of s.fields) fieldOwner.set(f.id, s);
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

    // The compact form, by names: { structure, target, table, source, type, lookup }
    if (
      o['targetFieldId'] === undefined &&
      (o['target'] !== undefined || o['structure'] !== undefined)
    ) {
      const s = ix.structure(o['structure']);
      if (!s)
        return skip(
          item,
          'AI_UNKNOWN_STRUCTURE',
          `The structure "${text(o['structure'])}" is not in the target.`,
        );
      const tf = ix.targetField(s, o['target']);
      if (tf === undefined)
        return skip(
          item,
          'AI_UNKNOWN_TARGET',
          `The target field "${text(o['target'])}" is not in structure "${s.name}".`,
        );
      if (tf === null)
        return skip(
          item,
          'AI_AMBIGUOUS_NAME',
          `The name "${text(o['target'])}" matches several fields of "${s.name}".`,
        );
      const t = ix.table(o['table']);
      if (!t)
        return skip(
          item,
          'AI_UNKNOWN_TABLE',
          `The table "${text(o['table'])}" is not among the source tables.`,
          tf.id,
        );
      const sf = ix.sourceField(t, o['source']);
      if (sf === undefined)
        return skip(
          item,
          'AI_UNKNOWN_SOURCE',
          `The field "${text(o['source'])}" is not in table "${t.displayName}".`,
          tf.id,
        );
      if (sf === null)
        return skip(
          item,
          'AI_AMBIGUOUS_NAME',
          `The name "${text(o['source'])}" matches several fields of "${t.displayName}".`,
          tf.id,
        );
      const lookupName = text(o['lookup']);
      o['targetStructureId'] = s.id;
      o['targetFieldId'] = tf.id;
      o['mappingType'] = o['type'] ?? o['mappingType'];
      o['sourceReferences'] = [{ datasetId: t.id, fieldId: sf.id }];
      if (lookupName) o['lookup'] = { lookupId: lookupByName.get(norm(lookupName)) ?? lookupName };
      for (const k of ['structure', 'target', 'table', 'source', 'type']) delete o[k];
    }

    const targetFieldId = typeof o['targetFieldId'] === 'string' ? o['targetFieldId'] : undefined;
    if (!targetFieldId) return skip(item, 'AI_UNKNOWN_TARGET', 'The mapping has no target field.');
    const owner = fieldOwner.get(targetFieldId);
    if (!owner)
      return skip(
        item,
        'AI_UNKNOWN_TARGET',
        `The target field "${targetFieldId}" is not in the catalog. Copy the name exactly.`,
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
        `A ${type} mapping needs exactly one source field (got ${refs.length}).`,
        targetFieldId,
      );
    const ref = asObject(refs[0]);
    const src =
      ref && typeof ref['fieldId'] === 'string' ? sourceById.get(ref['fieldId']) : undefined;
    if (!ref || !src)
      return skip(
        item,
        'AI_UNKNOWN_SOURCE',
        `The source field "${String(ref?.['fieldId'])}" is not in the catalog. Copy the name exactly.`,
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
      const raw = lookup && typeof lookup['lookupId'] === 'string' ? lookup['lookupId'] : '';
      const lookupId = knownLookups.has(raw) ? raw : (lookupByName.get(norm(raw)) ?? raw);
      if (!knownLookups.has(lookupId))
        return skip(
          item,
          'AI_UNKNOWN_LOOKUP',
          `The lookup "${raw}" does not exist. Add it to "lookups" first.`,
          targetFieldId,
        );
      o['lookup'] = { configuration: {}, missingValue: { kind: 'error' }, ...lookup, lookupId };
    }
    const candidate = {
      transformations: [],
      ...o,
      id: text(o['id']) || `m-${targetFieldId}`,
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
  const parts = [
    report.tableDescriptions ? `${report.tableDescriptions} table description(s)` : '',
    report.fieldDescriptions ? `${report.fieldDescriptions} field description(s)` : '',
    report.pairings.length ? `${report.pairings.length} pairing(s)` : '',
    `${report.imported.length} mapping(s)`,
    report.lookupsAdded.length ? `${report.lookupsAdded.length} lookup(s)` : '',
  ].filter(Boolean);
  lines.push(`Imported ${parts.join(', ')}.`);
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
