import type { Project, SourceDataset, SourceRows, TargetStructure } from '@mms/mapping-core';
import { scoreFieldPair } from './suggest.js';

/**
 * Which source dataset drives which target structure, even when their names differ. The question is answered from
 * the fields: how many target fields have a matching source field in the dataset. Rule based, then optionally
 * the AI (metadata only), merged the same way as field suggestions. A person confirms each pair.
 */
export interface PairCoverage {
  total: number;
  matched: number;
  requiredTotal: number;
  requiredMatched: number;
  keysTotal: number;
  keysMatched: number;
}

export interface StructureSuggestion {
  /** The target structure ID: one best suggestion per structure. */
  id: string;
  targetStructureId: string;
  driverDatasetId: string;
  /** Datasets joined to the driver that fill target fields the driver cannot. */
  helperDatasetIds: string[];
  /** 0 to 1. */
  score: number;
  coverage: PairCoverage;
  reasons: string[];
  origin: 'rules' | 'ai' | 'both';
  alternatives: { driverDatasetId: string; score: number }[];
  /** Set when rules and AI disagree on the driver: the proposal that lost on confidence. */
  conflict?: { driverDatasetId: string; score: number; origin: 'rules' | 'ai' };
}

/** A target field counts as covered when its best source field in the dataset has at least this name evidence. */
const COVERED = 0.5;
const MIN_SCORE = 0.3;

const words = (s: string): Set<string> =>
  new Set(
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );

/** Which target fields of a structure a dataset can fill, by name, technical name and type evidence. */
export function coverageOf(
  structure: TargetStructure,
  dataset: SourceDataset,
  rows?: SourceRows,
): { coverage: PairCoverage; coveredFieldIds: Set<string> } {
  const covered = new Set<string>();
  for (const f of structure.fields) {
    let best = 0;
    for (const s of dataset.fields) best = Math.max(best, scoreFieldPair(f, s, rows).score);
    if (best >= COVERED) covered.add(f.id);
  }
  const req = structure.fields.filter((f) => f.required);
  const keys = structure.fields.filter((f) => f.isKey);
  return {
    coverage: {
      total: structure.fields.length,
      matched: covered.size,
      requiredTotal: req.length,
      requiredMatched: req.filter((f) => covered.has(f.id)).length,
      keysTotal: keys.length,
      keysMatched: keys.filter((f) => covered.has(f.id)).length,
    },
    coveredFieldIds: covered,
  };
}

function pairScore(c: PairCoverage, structure: TargetStructure, dataset: SourceDataset): number {
  const cov = c.total === 0 ? 0 : c.matched / c.total;
  const req = c.requiredTotal === 0 ? cov : c.requiredMatched / c.requiredTotal;
  const key = c.keysTotal === 0 ? cov : c.keysMatched / c.keysTotal;
  const a = words(`${structure.name} ${structure.displayName} ${structure.technicalName ?? ''}`);
  const b = words(`${dataset.name} ${dataset.displayName}`);
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const name = a.size === 0 || b.size === 0 ? 0 : Math.min(1, shared / Math.min(a.size, b.size));
  // A small dataset that fits the structure is a better driver than a wide one that happens to contain the same names.
  const tight =
    dataset.fields.length === 0 ? 0 : Math.min(1, (c.matched / dataset.fields.length) * 3);
  return Math.round((0.5 * cov + 0.2 * req + 0.1 * key + 0.1 * tight + 0.1 * name) * 100) / 100;
}

const reasonsOf = (c: PairCoverage, dataset: SourceDataset): string[] => [
  `${dataset.name} has a matching field for ${c.matched} of ${c.total} target fields`,
  ...(c.requiredTotal > 0 ? [`${c.requiredMatched} of ${c.requiredTotal} required fields`] : []),
  ...(c.keysTotal > 0 ? [`${c.keysMatched} of ${c.keysTotal} key fields`] : []),
];

export interface SuggestPairsOptions {
  structureId?: string;
  data?: Readonly<Record<string, SourceRows>>;
}

export function suggestStructurePairs(
  project: Project,
  options: SuggestPairsOptions = {},
): StructureSuggestion[] {
  const datasets = project.sourceDefinitions.flatMap((d) => d.datasets);
  const rels = project.mappingDefinition.relationships.filter((r) => r.status !== 'rejected');
  const out: StructureSuggestion[] = [];
  for (const st of project.targetDefinition?.structures ?? []) {
    if (options.structureId !== undefined && st.id !== options.structureId) continue;
    const ranked = datasets
      .map((ds) => {
        const r = coverageOf(st, ds, options.data?.[ds.id]);
        return { ds, ...r, score: pairScore(r.coverage, st, ds) };
      })
      .filter((x) => x.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score || a.ds.name.localeCompare(b.ds.name));
    const best = ranked[0];
    if (!best) continue;
    const helpers: { id: string; added: number; names: string[] }[] = [];
    for (const other of ranked.slice(1)) {
      const joined = rels.some(
        (r) =>
          (r.leftDatasetId === best.ds.id && r.rightDatasetId === other.ds.id) ||
          (r.rightDatasetId === best.ds.id && r.leftDatasetId === other.ds.id),
      );
      const added = [...other.coveredFieldIds].filter((id) => !best.coveredFieldIds.has(id));
      if (joined && added.length > 0)
        helpers.push({
          id: other.ds.id,
          added: added.length,
          names: added.map((id) => st.fields.find((f) => f.id === id)!.displayName),
        });
    }
    helpers.sort((a, b) => b.added - a.added);
    out.push({
      id: st.id,
      targetStructureId: st.id,
      driverDatasetId: best.ds.id,
      helperDatasetIds: helpers.map((h) => h.id),
      score: best.score,
      coverage: best.coverage,
      reasons: [
        ...reasonsOf(best.coverage, best.ds),
        ...helpers.map(
          (h) =>
            `${datasets.find((d) => d.id === h.id)!.name} adds ${h.names.slice(0, 3).join(', ')} through a join`,
        ),
      ],
      origin: 'rules',
      alternatives: ranked.slice(1, 3).map((x) => ({ driverDatasetId: x.ds.id, score: x.score })),
    });
  }
  return out;
}

// ---- AI ----

export interface StructureAiPrompt {
  system: string;
  user: string;
  targets: ReadonlyMap<string, string>;
  datasets: ReadonlyMap<string, string>;
}

export interface StructureAiPair {
  targetStructureId: string;
  /** null: the model found no source dataset for this structure. */
  driverDatasetId: string | null;
  helperDatasetIds: string[];
  confidence: number;
  reason: string;
}

const SYSTEM = [
  'You help pair source datasets with target structures for a data migration.',
  'For every target structure, choose the ONE source dataset that should drive its rows (one target row per source row), and any helper datasets that add fields through a join. Names may differ between source and target; judge by the fields.',
  'Use only the metadata you are given. You see no data values.',
  'Reply with JSON only, in exactly this shape: {"pairs":[{"target":"t1","driver":"d2","helpers":["d3"],"confidence":85,"reason":"short reason"}]}.',
  'Use only the ids you were given. Use null for driver when no dataset fits. Confidence is a number from 0 to 100. Keep each reason under 15 words.',
].join(' ');

const MAX_FIELDS = 60;

export function buildStructureAiPrompt(
  project: Project,
  hints: readonly StructureSuggestion[] = [],
  structureId?: string,
): StructureAiPrompt | undefined {
  const datasets = new Map<string, string>();
  const dsLines = project.sourceDefinitions
    .flatMap((d) => d.datasets)
    .map((ds) => {
      const id = `d${datasets.size + 1}`;
      datasets.set(id, ds.id);
      return {
        id,
        name: ds.name,
        fields: ds.fields
          .slice(0, MAX_FIELDS)
          .map((f) => (f.technicalName ? `${f.displayName} (${f.technicalName})` : f.displayName)),
      };
    });
  const targets = new Map<string, string>();
  const tLines = (project.targetDefinition?.structures ?? [])
    .filter((st) => structureId === undefined || st.id === structureId)
    .map((st) => {
      const id = `t${targets.size + 1}`;
      targets.set(id, st.id);
      return {
        id,
        name: st.name,
        ...(st.importance ? { importance: st.importance } : {}),
        fields: st.fields
          .slice(0, MAX_FIELDS)
          .map((f) => (f.technicalName ? `${f.displayName} (${f.technicalName})` : f.displayName)),
      };
    });
  if (tLines.length === 0 || dsLines.length === 0) return undefined;
  const idOfDataset = new Map([...datasets].map(([k, v]) => [v, k]));
  const idOfTarget = new Map([...targets].map(([k, v]) => [v, k]));
  const hintLines = hints
    .filter((h) => idOfTarget.has(h.targetStructureId))
    .map((h) => ({
      target: idOfTarget.get(h.targetStructureId),
      driver: idOfDataset.get(h.driverDatasetId),
      score: Math.round(h.score * 100),
    }));
  return {
    system: SYSTEM,
    user: JSON.stringify({ targets: tLines, datasets: dsLines, hints: hintLines }),
    targets,
    datasets,
  };
}

export function parseStructureAiResponse(
  text: string,
  prompt: Pick<StructureAiPrompt, 'targets' | 'datasets'>,
): { items: StructureAiPair[]; problems: string[] } {
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
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { pairs?: unknown }).pairs)
      ? (json as { pairs: unknown[] }).pairs
      : undefined;
  if (!list) return { items: [], problems: ['The answer was not the expected JSON.'] };
  const items: StructureAiPair[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as {
      target?: unknown;
      driver?: unknown;
      helpers?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    const target = typeof r.target === 'string' ? prompt.targets.get(r.target) : undefined;
    if (!target) {
      problems.push(`An answer named an unknown target (${String(r.target)}); it was ignored.`);
      continue;
    }
    if (seen.has(target)) continue;
    seen.add(target);
    const none = r.driver === null || r.driver === undefined || r.driver === '';
    const driver = none ? undefined : prompt.datasets.get(String(r.driver));
    if (!none && !driver) {
      problems.push(`An answer named an unknown dataset (${String(r.driver)}); it was ignored.`);
      continue;
    }
    const helpers = (Array.isArray(r.helpers) ? r.helpers : [])
      .map((h) => prompt.datasets.get(String(h)))
      .filter((h): h is string => h !== undefined && h !== driver);
    let conf = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence);
    if (!Number.isFinite(conf)) conf = 0;
    if (conf > 1) conf /= 100;
    items.push({
      targetStructureId: target,
      driverDatasetId: driver ?? null,
      helperDatasetIds: [...new Set(helpers)],
      confidence: Math.max(0, Math.min(1, Math.round(conf * 100) / 100)),
      reason: typeof r.reason === 'string' ? r.reason.trim().slice(0, 200) : '',
    });
  }
  return { items, problems };
}

const AI_CAP = 0.95;

/** Rules and AI together: agreement raises the confidence, disagreement keeps the stronger and records the other. */
export function mergeStructureSuggestions(
  rules: readonly StructureSuggestion[],
  ai: readonly StructureAiPair[],
  project: Project,
): StructureSuggestion[] {
  const out = new Map<string, StructureSuggestion>();
  for (const r of rules) out.set(r.targetStructureId, { ...r, origin: 'rules' });
  const known = new Set((project.targetDefinition?.structures ?? []).map((s) => s.id as string));
  const empty: PairCoverage = {
    total: 0,
    matched: 0,
    requiredTotal: 0,
    requiredMatched: 0,
    keysTotal: 0,
    keysMatched: 0,
  };
  for (const a of ai) {
    if (!known.has(a.targetStructureId)) continue;
    const rule = out.get(a.targetStructureId);
    const aiReason = a.reason ? `AI: ${a.reason}` : 'AI proposed this dataset';
    if (a.driverDatasetId === null) {
      if (rule)
        out.set(a.targetStructureId, {
          ...rule,
          reasons: [...rule.reasons, 'AI found no clear source dataset'],
        });
      continue;
    }
    if (!rule) {
      out.set(a.targetStructureId, {
        id: a.targetStructureId,
        targetStructureId: a.targetStructureId,
        driverDatasetId: a.driverDatasetId,
        helperDatasetIds: a.helperDatasetIds,
        score: Math.min(AI_CAP, a.confidence),
        coverage: empty,
        reasons: [aiReason],
        origin: 'ai',
        alternatives: [],
      });
      continue;
    }
    if (rule.driverDatasetId === a.driverDatasetId) {
      out.set(a.targetStructureId, {
        ...rule,
        helperDatasetIds: [...new Set([...rule.helperDatasetIds, ...a.helperDatasetIds])],
        score: Math.min(1, Math.round((Math.max(rule.score, a.confidence) + 0.05) * 100) / 100),
        reasons: [...rule.reasons, aiReason],
        origin: 'both',
      });
      continue;
    }
    const aiScore = Math.min(AI_CAP, a.confidence);
    if (aiScore > rule.score)
      out.set(a.targetStructureId, {
        ...rule,
        driverDatasetId: a.driverDatasetId,
        helperDatasetIds: a.helperDatasetIds,
        score: aiScore,
        reasons: [aiReason],
        origin: 'ai',
        alternatives: [
          { driverDatasetId: rule.driverDatasetId, score: rule.score },
          ...rule.alternatives,
        ].slice(0, 2),
        conflict: { driverDatasetId: rule.driverDatasetId, score: rule.score, origin: 'rules' },
      });
    else
      out.set(a.targetStructureId, {
        ...rule,
        reasons: [...rule.reasons, `AI preferred another dataset (${Math.round(aiScore * 100)}%)`],
        alternatives: [
          { driverDatasetId: a.driverDatasetId, score: aiScore },
          ...rule.alternatives,
        ].slice(0, 2),
        conflict: { driverDatasetId: a.driverDatasetId, score: aiScore, origin: 'ai' },
      });
  }
  return [...out.values()];
}
