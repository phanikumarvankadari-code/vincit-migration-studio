import type { Project } from '@mms/mapping-core';
import type { MappingSuggestion } from './suggest.js';

/**
 * AI suggestions, as pure functions: build the questions, read the answers, merge them with the rule-based
 * suggestions. Talking to the model is the application's job (a local Ollama server). Only field metadata goes
 * into a prompt: never row values.
 */

export interface AiMapping {
  targetFieldId: string;
  /** null: the model found no clear match. */
  sourceFieldId: string | null;
  datasetId: string | null;
  /** 0 to 1. */
  confidence: number;
  reason: string;
}

export interface AiPrompt {
  system: string;
  user: string;
  /** Short ids used in the prompt, mapped back to the real ones. */
  targets: ReadonlyMap<string, { structureId: string; fieldId: string }>;
  sources: ReadonlyMap<string, { datasetId: string; fieldId: string }>;
}

export interface BuildAiPromptsOptions {
  structureId?: string;
  /** Target fields per question. Default 15. */
  batchSize?: number;
  /** Rule-based suggestions, offered to the model as hints. */
  hints?: readonly MappingSuggestion[];
  /** Offer these source datasets only (smaller questions, faster answers). */
  datasetIds?: readonly string[];
}

const SYSTEM = [
  'You help map SAP source fields to target fields for a data migration.',
  'Use only the metadata you are given. You see no data values.',
  'For every target, choose the one source field that most likely holds the same information, or null if none clearly does.',
  'Reply with JSON only, in exactly this shape: {"mappings":[{"target":"t1","source":"s3","confidence":85,"reason":"short reason"}]}.',
  'Use only the ids you were given. Confidence is a number from 0 to 100 of how sure you are. Keep each reason under 15 words.',
].join(' ');

const clean = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

/** One prompt per batch of unmapped target fields. */
export function buildAiPrompts(project: Project, options: BuildAiPromptsOptions = {}): AiPrompt[] {
  const batch = options.batchSize ?? 15;
  const mapped = new Set(project.mappingDefinition.mappings.map((m) => m.targetFieldId as string));

  const sources = new Map<string, { datasetId: string; fieldId: string }>();
  const sourceByField = new Map<string, string>();
  const sourceLines: object[] = [];
  const inScope = options.datasetIds ? new Set(options.datasetIds) : undefined;
  for (const sd of project.sourceDefinitions)
    for (const ds of sd.datasets)
      for (const f of inScope && !inScope.has(ds.id) ? [] : ds.fields) {
        const id = `s${sources.size + 1}`;
        sources.set(id, { datasetId: ds.id, fieldId: f.id });
        sourceByField.set(f.id, id);
        sourceLines.push(
          clean({
            id,
            dataset: ds.name,
            name: f.displayName,
            technicalName: f.technicalName,
            type: f.datatype === 'unknown' ? undefined : f.datatype,
            length: f.length,
            key: f.isKey ? true : undefined,
          }),
        );
      }

  type TargetField = NonNullable<
    Project['targetDefinition']
  >['structures'][number]['fields'][number];
  const pending: { structureId: string; f: TargetField }[] = [];
  for (const st of project.targetDefinition?.structures ?? []) {
    if (options.structureId !== undefined && st.id !== options.structureId) continue;
    for (const f of st.fields) if (!mapped.has(f.id)) pending.push({ structureId: st.id, f });
  }

  const prompts: AiPrompt[] = [];
  for (let i = 0; i < pending.length; i += batch) {
    const targets = new Map<string, { structureId: string; fieldId: string }>();
    const targetLines: object[] = [];
    const hints: object[] = [];
    for (const { structureId, f } of pending.slice(i, i + batch)) {
      const id = `t${targets.size + 1}`;
      targets.set(id, { structureId, fieldId: f.id });
      targetLines.push(
        clean({
          id,
          name: f.displayName,
          technicalName: f.technicalName,
          type: f.datatype === 'unknown' ? undefined : f.datatype,
          length: f.length,
          required: f.required ? true : undefined,
          key: f.isKey ? true : undefined,
          group: f.group,
          description: f.description,
        }),
      );
      const h = options.hints?.find((x) => x.targetFieldId === f.id);
      if (h) {
        const cands = [
          { source: sourceByField.get(h.sourceFieldId), score: Math.round(h.score * 100) },
          ...h.alternatives.map((a) => ({
            source: sourceByField.get(a.sourceFieldId),
            score: Math.round(a.score * 100),
          })),
        ].filter((c) => c.source !== undefined);
        if (cands.length > 0) hints.push({ target: id, candidates: cands });
      }
    }
    prompts.push({
      system: SYSTEM,
      user: JSON.stringify({ targets: targetLines, sources: sourceLines, hints }),
      targets,
      sources,
    });
  }
  return prompts;
}

/** Finds the JSON in an answer: bare, in a code fence, or with text around it. */
function extractJson(text: string): unknown {
  const tryParse = (t: string): unknown => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(text.trim());
  if (direct !== undefined) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const v = tryParse(fenced[1]!.trim());
    if (v !== undefined) return v;
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return tryParse(text.slice(first, last + 1));
  return undefined;
}

/** Reads the model's answer for one prompt. Unknown ids are dropped; problems are listed, never guessed around. */
export function parseAiResponse(
  text: string,
  prompt: Pick<AiPrompt, 'targets' | 'sources'>,
): { items: AiMapping[]; problems: string[] } {
  const problems: string[] = [];
  const json = extractJson(text);
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { mappings?: unknown }).mappings)
      ? (json as { mappings: unknown[] }).mappings
      : undefined;
  if (!list) return { items: [], problems: ['The answer was not the expected JSON.'] };
  const items: AiMapping[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { target?: unknown; source?: unknown; confidence?: unknown; reason?: unknown };
    const t = typeof r.target === 'string' ? prompt.targets.get(r.target) : undefined;
    if (!t) {
      problems.push(`An answer named an unknown target (${String(r.target)}); it was ignored.`);
      continue;
    }
    if (seen.has(t.fieldId)) continue;
    seen.add(t.fieldId);
    const noMatch = r.source === null || r.source === undefined || r.source === '';
    const s = noMatch ? undefined : prompt.sources.get(String(r.source));
    if (!noMatch && !s) {
      problems.push(`An answer named an unknown source (${String(r.source)}); it was ignored.`);
      continue;
    }
    let conf = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence);
    if (!Number.isFinite(conf)) conf = 0;
    if (conf > 1) conf = conf / 100;
    items.push({
      targetFieldId: t.fieldId,
      sourceFieldId: s?.fieldId ?? null,
      datasetId: s?.datasetId ?? null,
      confidence: Math.max(0, Math.min(1, Math.round(conf * 100) / 100)),
      reason: typeof r.reason === 'string' ? r.reason.trim().slice(0, 200) : '',
    });
  }
  return { items, problems };
}

const AI_CAP = 0.95;

/**
 * Combines rule-based suggestions with the AI's answers. Agreement raises the confidence, disagreement keeps the
 * stronger proposal and records the other as a conflict, a lone AI proposal is capped. A person still decides.
 */
export function mergeSuggestions(
  rules: readonly MappingSuggestion[],
  ai: readonly AiMapping[],
  project: Project,
): MappingSuggestion[] {
  const out = new Map<string, MappingSuggestion>();
  for (const r of rules) out.set(r.targetFieldId, { ...r, origin: 'rules' });
  const structureOf = new Map<string, string>();
  for (const st of project.targetDefinition?.structures ?? [])
    for (const f of st.fields) structureOf.set(f.id, st.id);

  for (const a of ai) {
    const rule = out.get(a.targetFieldId);
    const aiReason = a.reason ? `AI: ${a.reason}` : 'AI proposed this source';
    if (a.sourceFieldId === null || a.datasetId === null) {
      if (rule && rule.origin === 'rules')
        out.set(a.targetFieldId, {
          ...rule,
          reasons: [...rule.reasons, 'AI found no clear match'],
        });
      continue;
    }
    if (!rule) {
      const structureId = structureOf.get(a.targetFieldId);
      if (!structureId) continue;
      out.set(a.targetFieldId, {
        id: a.targetFieldId,
        targetStructureId: structureId,
        targetFieldId: a.targetFieldId,
        datasetId: a.datasetId,
        sourceFieldId: a.sourceFieldId,
        score: Math.min(AI_CAP, a.confidence),
        reasons: [aiReason],
        alternatives: [],
        origin: 'ai',
      });
      continue;
    }
    if (rule.sourceFieldId === a.sourceFieldId) {
      out.set(a.targetFieldId, {
        ...rule,
        score: Math.min(1, Math.round((Math.max(rule.score, a.confidence) + 0.05) * 100) / 100),
        reasons: [...rule.reasons, aiReason],
        origin: 'both',
      });
      continue;
    }
    const aiScore = Math.min(AI_CAP, a.confidence);
    if (aiScore > rule.score) {
      out.set(a.targetFieldId, {
        ...rule,
        datasetId: a.datasetId,
        sourceFieldId: a.sourceFieldId,
        score: aiScore,
        reasons: [aiReason],
        origin: 'ai',
        alternatives: [
          { datasetId: rule.datasetId, sourceFieldId: rule.sourceFieldId, score: rule.score },
          ...rule.alternatives,
        ].slice(0, 2),
        conflict: {
          datasetId: rule.datasetId,
          sourceFieldId: rule.sourceFieldId,
          score: rule.score,
          origin: 'rules',
        },
      });
    } else {
      out.set(a.targetFieldId, {
        ...rule,
        reasons: [...rule.reasons, `AI preferred another source (${Math.round(aiScore * 100)}%)`],
        alternatives: [
          { datasetId: a.datasetId, sourceFieldId: a.sourceFieldId, score: aiScore },
          ...rule.alternatives,
        ].slice(0, 2),
        conflict: {
          datasetId: a.datasetId,
          sourceFieldId: a.sourceFieldId,
          score: aiScore,
          origin: 'ai',
        },
      });
    }
  }
  return [...out.values()];
}
