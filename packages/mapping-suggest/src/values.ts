import type { Project, TargetField } from '@mms/mapping-core';

/**
 * Hard-coded values for target fields that nothing fills. A rule covers the one convention that is safe to state
 * (the open end of a validity period); everything else comes from the AI, which sees field metadata only.
 */
export interface ValueSuggestion {
  value: string;
  /** 0 to 1. */
  confidence: number;
  reason: string;
  origin: 'rules' | 'ai';
}

const END_DATE = /(valid\s*to|valid\s*until|end\s*date|expir|until|\bto\s*date|finish)/i;

export function ruleValueSuggestion(field: TargetField): ValueSuggestion | undefined {
  if (field.datatype !== 'date') return undefined;
  if (END_DATE.test(`${field.displayName} ${field.technicalName ?? ''}`))
    return {
      value: '9999-12-31',
      confidence: 0.8,
      reason: 'The end of an open-ended validity period is 9999-12-31 in SAP.',
      origin: 'rules',
    };
  return undefined;
}

const SYSTEM = [
  'You help fill a target field of a data migration that has no source field.',
  'Suggest ONE fixed value, using only the metadata you are given. You see no data values.',
  'For a date, write it as YYYY-MM-DD. If the field is the end of a validity period, prefer the open end 9999-12-31 unless the context says otherwise; if it is a start date, say what the context supports.',
  'Reply with JSON only, in exactly this shape: {"value":"...","confidence":85,"reason":"short reason"}.',
  'Confidence is a number from 0 to 100 of how sure you are. Keep the reason under 20 words. If you cannot suggest a sensible value, use an empty string and confidence 0.',
].join(' ');

export interface ValuePrompt {
  system: string;
  user: string;
}

/** Context for one field: its own metadata and the names of its sibling fields (and what feeds them). No data. */
export function buildValuePrompt(
  project: Project,
  structureId: string,
  fieldId: string,
  today: string,
): ValuePrompt | undefined {
  const st = project.targetDefinition?.structures.find((x) => x.id === structureId);
  const field = st?.fields.find((f) => f.id === fieldId);
  if (!st || !field) return undefined;
  const sources = new Map<string, string>();
  for (const sd of project.sourceDefinitions)
    for (const ds of sd.datasets)
      for (const f of ds.fields) sources.set(f.id, `${ds.name}.${f.displayName}`);
  const mapped = new Map(
    project.mappingDefinition.mappings
      .filter((m) => m.targetStructureId === structureId)
      .map((m) => [m.targetFieldId as string, m] as const),
  );
  const clean = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
  return {
    system: SYSTEM,
    user: JSON.stringify({
      today,
      structure: st.name,
      field: clean({
        name: field.displayName,
        technicalName: field.technicalName,
        type: field.datatype === 'unknown' ? undefined : field.datatype,
        length: field.length,
        required: field.required ? true : undefined,
        key: field.isKey ? true : undefined,
        group: field.group,
        description: field.description,
      }),
      siblings: st.fields
        .filter((f) => f.id !== fieldId)
        .map((f) => {
          const m = mapped.get(f.id);
          const src = m?.sourceReferences[0]
            ? sources.get(m.sourceReferences[0].fieldId)
            : undefined;
          return clean({
            name: f.displayName,
            type: f.datatype === 'unknown' ? undefined : f.datatype,
            from: src,
            fixed: m?.mappingType === 'constant' ? true : undefined,
          });
        }),
    }),
  };
}

export function parseValueResponse(
  text: string,
): { ok: true; suggestion: ValueSuggestion } | { ok: false; problem: string } {
  const tryParse = (t: string): unknown => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  let json = tryParse(text.trim());
  if (json === undefined) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fenced) json = tryParse(fenced[1]!.trim());
  }
  if (json === undefined) {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) json = tryParse(text.slice(a, b + 1));
  }
  if (!json || typeof json !== 'object')
    return { ok: false, problem: 'The answer was not the expected JSON.' };
  const r = json as { value?: unknown; confidence?: unknown; reason?: unknown };
  const value =
    typeof r.value === 'string'
      ? r.value.trim()
      : typeof r.value === 'number'
        ? String(r.value)
        : '';
  if (value === '') return { ok: false, problem: 'The model had no sensible value to suggest.' };
  let conf = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence);
  if (!Number.isFinite(conf)) conf = 0;
  if (conf > 1) conf /= 100;
  return {
    ok: true,
    suggestion: {
      value,
      confidence: Math.max(0, Math.min(0.95, Math.round(conf * 100) / 100)),
      reason: typeof r.reason === 'string' ? r.reason.trim().slice(0, 200) : '',
      origin: 'ai',
    },
  };
}
