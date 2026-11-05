import type { Cardinality, Diagnostic, Relationship, SourceField } from '@mms/mapping-core';
import { RelationshipSchema } from '@mms/mapping-core';
import { analyzeRelationship, blankKeys, type DatasetData } from './analyze.js';

export interface RelationshipSuggestion {
  relationship: Relationship;
  /** 0 to 1. Higher is more likely. */
  score: number;
  /** Plain-language reasons shown to the user. */
  evidence: string[];
  diagnostics: Diagnostic[];
}

export interface SuggestOptions {
  /** Minimum score for a field pair to be used as a key. Default 0.6. */
  pairThreshold?: number;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const slug = (s: string): string => s.replace(/[^A-Za-z0-9_]+/g, '-').replace(/^-+|-+$/g, '');

function distinct(data: DatasetData, fieldId: string): Set<string> {
  const i = data.dataset.fields.findIndex((f) => f.id === fieldId);
  const set = new Set<string>();
  for (const row of data.rows.rows) {
    const v = row[i];
    if (v !== null && v !== undefined && v !== '') set.add(v);
  }
  return set;
}

/** A column of decimal numbers (1000.00) holds amounts, not keys. */
function isAmount(data: DatasetData, fieldId: string): boolean {
  const i = data.dataset.fields.findIndex((f) => f.id === fieldId);
  let seen = 0;
  for (const row of data.rows.rows) {
    const v = row[i];
    if (v === null || v === undefined || v === '') continue;
    if (!/^[+-]?\d+[.,]\d+-?$/.test(v)) return false;
    if (++seen >= 200) break;
  }
  return seen > 0;
}

interface Pair {
  left: SourceField;
  right: SourceField;
  score: number;
  evidence: string[];
  constant: boolean;
}

/** Share of the rows of both sides whose key is found on the other side (blank keys never match). */
function coverage(a: DatasetData, b: DatasetData, pairs: readonly Pair[]): number {
  const draft = RelationshipSchema.parse({
    id: 'rel-probe',
    leftDatasetId: a.dataset.id,
    rightDatasetId: b.dataset.id,
    keys: pairs.map((p) => ({ leftFieldId: p.left.id, rightFieldId: p.right.id })),
    cardinality: 'manyToMany',
    joinType: 'left',
    status: 'suggested',
  });
  const stats = analyzeRelationship(draft, a, b);
  if (!stats) return 0;
  const total = stats.leftRows + stats.rightRows;
  if (total === 0) return 0;
  const matched =
    stats.leftRows -
    stats.leftBlankKeyRows -
    stats.leftUnmatchedRows +
    (stats.rightRows - stats.rightBlankKeyRows - stats.rightUnmatchedRows);
  return matched / total;
}

/** Share of rows of the two datasets that must match before the keys count as working. */
const NO_MATCH = 0.01;

/** All ways to choose `size` items of 0..n-1, in order. */
function* combinations(
  n: number,
  size: number,
  from = 0,
  picked: number[] = [],
): Generator<number[]> {
  if (picked.length === size) {
    yield picked;
    return;
  }
  for (let i = from; i <= n - (size - picked.length); i++)
    yield* combinations(n, size, i + 1, [...picked, i]);
}

/** At most this many key parts are tried in every combination; more fall back to dropping the least specific first. */
const MAX_SEARCH = 12;

/**
 * Two tables often share more column names than they share keys (a year or a status field that means something
 * different in each), and one such field makes the whole key match nothing. When the suggested keys match no row at
 * all, looks for the smallest set of key parts to leave out so that rows match. Parts that both sides declare a key
 * are never left out, and what remains must contain a part that is not single-valued. If no row ever matches, the
 * keys stay as they were. Changes `chosen` in place and returns what was left out.
 */
function refineKeys(a: DatasetData, b: DatasetData, chosen: Pair[]): Pair[] {
  if (chosen.length < 2 || coverage(a, b, chosen) > NO_MATCH) return [];
  const droppable = chosen.filter((p) => !(p.left.isKey && p.right.isKey));
  const works = (drop: ReadonlySet<Pair>): boolean => {
    const rest = chosen.filter((p) => !drop.has(p));
    return rest.length > 0 && rest.some((p) => !p.constant) && coverage(a, b, rest) > NO_MATCH;
  };
  let found: Pair[] | undefined;
  if (droppable.length <= MAX_SEARCH) {
    for (let size = 1; size < chosen.length && !found; size++) {
      let best: { drop: Pair[]; value: number } | undefined;
      for (const idx of combinations(droppable.length, size)) {
        const drop = idx.map((i) => droppable[i]!);
        if (!works(new Set(drop))) continue;
        const value = coverage(
          a,
          b,
          chosen.filter((p) => !drop.includes(p)),
        );
        if (!best || value > best.value) best = { drop, value };
      }
      if (best) found = best.drop;
    }
  } else {
    // Many parts: drop those that carry the fewest different values first.
    const order = [...droppable].sort(
      (x, y) => distinct(a, x.left.id).size - distinct(a, y.left.id).size,
    );
    const drop = new Set<Pair>();
    for (const p of order) {
      drop.add(p);
      if (works(drop)) {
        found = [...drop];
        break;
      }
    }
  }
  if (!found) return [];
  for (const p of found) chosen.splice(chosen.indexOf(p), 1);
  return found;
}

/**
 * Suggests relationships between every pair of datasets from: technical-name match, display-name match,
 * key metadata (both sides are keys) and value overlap. Fields that hold one single value on both sides
 * are left out unless both sides declare them a key, or nothing else matches. Suggestions are always status
 * "suggested" and need human confirmation. Order of suggestions follows the order of datasets.
 */
export function suggestRelationships(
  datasets: readonly DatasetData[],
  options: SuggestOptions = {},
): RelationshipSuggestion[] {
  const threshold = options.pairThreshold ?? 0.6;
  const out: RelationshipSuggestion[] = [];

  for (let i = 0; i < datasets.length; i++) {
    for (let j = i + 1; j < datasets.length; j++) {
      const a = datasets[i]!;
      const b = datasets[j]!;
      const pairs: Pair[] = [];
      for (const lf of a.dataset.fields) {
        for (const rf of b.dataset.fields) {
          let score = 0;
          const evidence: string[] = [];
          if (
            lf.technicalName &&
            rf.technicalName &&
            lf.technicalName.toLowerCase() === rf.technicalName.toLowerCase()
          ) {
            score += 0.5;
            evidence.push(`same technical name ${lf.technicalName}`);
          } else if (norm(lf.displayName) === norm(rf.displayName)) {
            score += 0.4;
            evidence.push(`same display name "${lf.displayName}"`);
          }
          if (score === 0) continue;
          if (!(lf.isKey && rf.isKey) && (isAmount(a, lf.id) || isAmount(b, rf.id))) continue;
          if (lf.isKey && rf.isKey) {
            score += 0.2;
            evidence.push('key on both sides');
          }
          const lv = distinct(a, lf.id);
          const rv = distinct(b, rf.id);
          let overlap = 0;
          for (const v of lv) if (rv.has(v)) overlap++;
          if (lv.size > 0 && rv.size > 0) {
            const containment = overlap / Math.min(lv.size, rv.size);
            if (overlap > 0) {
              score += 0.3 * containment;
              evidence.push(`${overlap} shared value(s)`);
            }
          }
          // A value that is the same everywhere carries little information, unless both sides declare it a key.
          const constant =
            lv.size <= 1 && rv.size <= 1 && lv.size + rv.size > 0 && !(lf.isKey && rf.isKey);
          if (score >= threshold) pairs.push({ left: lf, right: rf, score, evidence, constant });
        }
      }
      if (pairs.length === 0) continue;

      // Best pairs first; each field is used once. Single-valued fields only if nothing else remains.
      pairs.sort((x, y) => y.score - x.score);
      const usedL = new Set<string>();
      const usedR = new Set<string>();
      const chosen: Pair[] = [];
      for (const p of [...pairs.filter((p) => !p.constant), ...pairs.filter((p) => p.constant)]) {
        if (p.constant && chosen.length > 0) continue;
        if (usedL.has(p.left.id) || usedR.has(p.right.id)) continue;
        usedL.add(p.left.id);
        usedR.add(p.right.id);
        chosen.push(p);
      }
      const dropped = refineKeys(a, b, chosen);
      chosen.sort((x, y) => a.dataset.fields.indexOf(x.left) - a.dataset.fields.indexOf(y.left));
      const keys = chosen.map((p) => ({ leftFieldId: p.left.id, rightFieldId: p.right.id }));
      const draft = RelationshipSchema.parse({
        id: `rel-${slug(a.dataset.name)}-${slug(b.dataset.name)}`,
        leftDatasetId: a.dataset.id,
        rightDatasetId: b.dataset.id,
        keys,
        cardinality: 'manyToMany',
        joinType: 'left',
        status: 'suggested',
      });
      const stats = analyzeRelationship(draft, a, b);
      const cardinality: Cardinality = stats ? stats.observedCardinality : 'manyToMany';
      const diagnostics: Diagnostic[] = [];
      if (stats && stats.matchingKeys === 0 && stats.leftRows > 0 && stats.rightRows > 0) {
        diagnostics.push({
          severity: 'warning',
          code: 'RELATIONSHIP_NO_MATCHING_VALUES',
          message: `Suggested from names and key information, but no key value appears in both ${a.dataset.name} and ${b.dataset.name}.`,
        });
      }
      if (stats && (stats.leftBlankKeyRows > 0 || stats.rightBlankKeyRows > 0)) {
        diagnostics.push(blankKeys(a.dataset.name, b.dataset.name, stats));
      }
      if (cardinality === 'manyToMany') {
        diagnostics.push({
          severity: 'warning',
          code: 'RELATIONSHIP_MANY_TO_MANY',
          message: `${a.dataset.name} and ${b.dataset.name} look many-to-many on these keys. Check that the keys are complete.`,
        });
      }
      out.push({
        relationship: { ...draft, cardinality },
        score: Math.round((chosen.reduce((s, p) => s + p.score, 0) / chosen.length) * 100) / 100,
        evidence: [
          ...new Set(chosen.flatMap((p) => p.evidence)),
          ...dropped.map(
            (p) => `left out "${p.left.displayName}": with it no row matches on the other keys`,
          ),
        ],
        diagnostics,
      });
    }
  }
  return out;
}
