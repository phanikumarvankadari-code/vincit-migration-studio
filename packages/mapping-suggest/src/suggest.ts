import type { Project, SourceField, SourceRows, TargetField } from '@mms/mapping-core';

export interface MappingSuggestion {
  /** Stable: the target field ID. One best suggestion per target field. */
  id: string;
  targetStructureId: string;
  targetFieldId: string;
  datasetId: string;
  sourceFieldId: string;
  /** 0 to 1. Higher is more likely. */
  score: number;
  /** Plain-language reasons shown to the user. */
  reasons: string[];
  /** The next best sources, best first (at most two). */
  alternatives: { datasetId: string; sourceFieldId: string; score: number }[];
}

export interface SuggestMappingsOptions {
  /** Minimum score of a suggestion. Default 0.5. */
  minScore?: number;
  /** Only suggest for this structure. */
  structureId?: string;
  /** Row data by dataset ID. When given, an empty source column counts against a suggestion. */
  data?: Readonly<Record<string, SourceRows>>;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Words of a name: split on case changes, digits and punctuation. "ProfitCenter_Name" gives profit, center, name. */
function words(s: string): Set<string> {
  return new Set(
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  // How much of the shorter name is contained in the other: "Region" in "Region Code" counts fully.
  return shared / Math.min(a.size, b.size);
}

function isBlankColumn(rows: SourceRows | undefined, fieldId: string): boolean {
  if (!rows || rows.rows.length === 0) return false;
  const i = rows.fieldIds.indexOf(fieldId as SourceRows['fieldIds'][number]);
  if (i < 0) return false;
  return rows.rows.every((r) => r[i] === null || r[i] === undefined || r[i] === '');
}

interface Scored {
  datasetId: string;
  field: SourceField;
  score: number;
  reasons: string[];
}

function score(
  target: TargetField,
  source: SourceField,
  rows: SourceRows | undefined,
): { score: number; reasons: string[] } {
  let s = 0;
  const reasons: string[] = [];
  if (
    target.technicalName &&
    source.technicalName &&
    target.technicalName.toLowerCase() === source.technicalName.toLowerCase()
  ) {
    s += 0.6;
    reasons.push(`same technical name ${source.technicalName}`);
  } else if (norm(target.displayName) === norm(source.displayName)) {
    s += 0.55;
    reasons.push(`same name "${source.displayName}"`);
  } else {
    const shared = overlap(
      words(target.displayName),
      new Set([...words(source.displayName), ...words(source.technicalName ?? '')]),
    );
    const viaDescription = target.description
      ? overlap(words(target.description), words(source.displayName))
      : 0;
    const best = Math.max(shared, viaDescription * 0.8);
    if (best > 0) {
      s += 0.45 * best;
      reasons.push(
        viaDescription * 0.8 > shared
          ? 'the target description mentions the source name'
          : 'the names share words',
      );
    }
  }
  if (s === 0) return { score: 0, reasons: [] };
  if (target.datatype !== 'unknown' && source.datatype !== 'unknown') {
    if (target.datatype === source.datatype) {
      s += 0.1;
      reasons.push(`same data type ${source.datatype}`);
    } else {
      s -= 0.1;
    }
  }
  if (target.isKey && source.isKey) {
    s += 0.1;
    reasons.push('key on both sides');
  }
  if (target.length !== undefined && source.length !== undefined) {
    if (source.length <= target.length) s += 0.05;
    else {
      s -= 0.05;
      reasons.push(`source is longer (${source.length}) than the target (${target.length})`);
    }
  }
  if (isBlankColumn(rows, source.id)) {
    s -= 0.3;
    reasons.push('the source column is empty in the loaded rows');
  }
  return { score: Math.max(0, Math.min(1, Math.round(s * 100) / 100)), reasons };
}

/**
 * Proposes a source field for every unmapped target field. Rule based and deterministic: no AI, no network.
 * A suggestion is never a mapping; the user accepts or rejects it (PD-010).
 */
export function suggestMappings(
  project: Project,
  options: SuggestMappingsOptions = {},
): MappingSuggestion[] {
  const min = options.minScore ?? 0.5;
  const structures = (project.targetDefinition?.structures ?? []).filter(
    (s) => options.structureId === undefined || s.id === options.structureId,
  );
  const mapped = new Set(project.mappingDefinition.mappings.map((m) => m.targetFieldId as string));
  const sources = project.sourceDefinitions.flatMap((d) =>
    d.datasets.flatMap((ds) => ds.fields.map((f) => ({ datasetId: ds.id as string, field: f }))),
  );
  const out: MappingSuggestion[] = [];
  for (const st of structures) {
    for (const t of st.fields) {
      if (mapped.has(t.id)) continue;
      const scored: Scored[] = [];
      for (const src of sources) {
        const r = score(t, src.field, options.data?.[src.datasetId]);
        if (r.score >= min) scored.push({ ...src, ...r });
      }
      // Stable sort: equal scores keep the order of the sources.
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best) continue;
      out.push({
        id: t.id,
        targetStructureId: st.id,
        targetFieldId: t.id,
        datasetId: best.datasetId,
        sourceFieldId: best.field.id,
        score: best.score,
        reasons: best.reasons,
        alternatives: scored.slice(1, 3).map((a) => ({
          datasetId: a.datasetId,
          sourceFieldId: a.field.id,
          score: a.score,
        })),
      });
    }
  }
  return out;
}
