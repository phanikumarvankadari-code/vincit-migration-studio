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

interface Pair {
  left: SourceField;
  right: SourceField;
  score: number;
  evidence: string[];
  constant: boolean;
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
        evidence: [...new Set(chosen.flatMap((p) => p.evidence))],
        diagnostics,
      });
    }
  }
  return out;
}
