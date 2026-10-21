import type {
  Cardinality,
  Diagnostic,
  Relationship,
  SourceDataset,
  SourceRows,
} from '@mms/mapping-core';

export interface DatasetData {
  dataset: SourceDataset;
  rows: SourceRows;
}

export interface RelationshipAnalysis {
  leftRows: number;
  rightRows: number;
  /** Rows whose key has a blank part never match. */
  leftBlankKeyRows: number;
  rightBlankKeyRows: number;
  leftDistinctKeys: number;
  rightDistinctKeys: number;
  matchingKeys: number;
  leftUnmatchedRows: number;
  rightUnmatchedRows: number;
  leftKeyUnique: boolean;
  rightKeyUnique: boolean;
  /** Cardinality implied by the data, left to right. */
  observedCardinality: Cardinality;
}

const SEP = '\u0000';

function keysOf(
  data: DatasetData,
  fieldIds: readonly string[],
): { keys: (string | null)[]; blank: number } | undefined {
  const idx = fieldIds.map((id) => data.dataset.fields.findIndex((f) => f.id === id));
  if (idx.some((i) => i < 0)) return undefined;
  let blank = 0;
  const keys = data.rows.rows.map((row) => {
    const parts = idx.map((i) => row[i] ?? null);
    if (parts.some((p) => p === null || p === '')) {
      blank++;
      return null;
    }
    return parts.join(SEP);
  });
  return { keys, blank };
}

/** Compares the data of both sides on the relationship keys. Returns undefined if a key field is unknown. */
export function analyzeRelationship(
  rel: Relationship,
  left: DatasetData,
  right: DatasetData,
): RelationshipAnalysis | undefined {
  const l = keysOf(
    left,
    rel.keys.map((k) => k.leftFieldId),
  );
  const r = keysOf(
    right,
    rel.keys.map((k) => k.rightFieldId),
  );
  if (!l || !r) return undefined;
  const lSet = new Set(l.keys.filter((k): k is string => k !== null));
  const rSet = new Set(r.keys.filter((k): k is string => k !== null));
  let matching = 0;
  for (const k of lSet) if (rSet.has(k)) matching++;
  const lFilled = l.keys.length - l.blank;
  const rFilled = r.keys.length - r.blank;
  const leftKeyUnique = lFilled > 0 && lSet.size === lFilled;
  const rightKeyUnique = rFilled > 0 && rSet.size === rFilled;
  return {
    leftRows: l.keys.length,
    rightRows: r.keys.length,
    leftBlankKeyRows: l.blank,
    rightBlankKeyRows: r.blank,
    leftDistinctKeys: lSet.size,
    rightDistinctKeys: rSet.size,
    matchingKeys: matching,
    leftUnmatchedRows: l.keys.filter((k) => k !== null && !rSet.has(k)).length,
    rightUnmatchedRows: r.keys.filter((k) => k !== null && !lSet.has(k)).length,
    leftKeyUnique,
    rightKeyUnique,
    observedCardinality:
      leftKeyUnique && rightKeyUnique
        ? 'oneToOne'
        : leftKeyUnique
          ? 'oneToMany'
          : rightKeyUnique
            ? 'manyToOne'
            : 'manyToMany',
  };
}

/** Warns about rows whose key has a blank part: they never match in a join. */
export function blankKeys(
  leftName: string,
  rightName: string,
  a: RelationshipAnalysis,
): Diagnostic {
  const parts = [
    a.leftBlankKeyRows > 0 ? `${a.leftBlankKeyRows} of ${a.leftRows} rows in ${leftName}` : '',
    a.rightBlankKeyRows > 0 ? `${a.rightBlankKeyRows} of ${a.rightRows} rows in ${rightName}` : '',
  ].filter(Boolean);
  return {
    severity: 'warning',
    code: 'RELATIONSHIP_BLANK_KEYS',
    message: `${parts.join(' and ')} have a blank key value and will not match.`,
  };
}

export const RelationshipIssueCode = {
  UnknownDataset: 'RELATIONSHIP_UNKNOWN_DATASET',
  UnknownField: 'RELATIONSHIP_UNKNOWN_FIELD',
  DuplicateKey: 'RELATIONSHIP_DUPLICATE_KEY',
  DatatypeMismatch: 'RELATIONSHIP_DATATYPE_MISMATCH',
  ManyToMany: 'RELATIONSHIP_MANY_TO_MANY',
  CardinalityMismatch: 'RELATIONSHIP_CARDINALITY_MISMATCH',
  NoMatchingValues: 'RELATIONSHIP_NO_MATCHING_VALUES',
} as const;

const issue = (
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  rel: Relationship,
  path?: string,
): Diagnostic => ({
  severity,
  code,
  message,
  ...(path ? { path } : {}),
  technicalDetails: `relationship ${rel.id}`,
});

/**
 * Checks one relationship against dataset schemas, and against data when it is given.
 * Errors: unknown datasets or fields, repeated key pairs. Warnings: many-to-many, datatype mismatch,
 * declared cardinality different from the data, no matching key values.
 */
export function checkRelationship(
  rel: Relationship,
  datasets: readonly SourceDataset[],
  data?: { left: DatasetData; right: DatasetData },
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const left = datasets.find((d) => d.id === rel.leftDatasetId);
  const right = datasets.find((d) => d.id === rel.rightDatasetId);
  if (!left)
    out.push(
      issue(
        'error',
        RelationshipIssueCode.UnknownDataset,
        `Dataset "${rel.leftDatasetId}" does not exist.`,
        rel,
        'leftDatasetId',
      ),
    );
  if (!right)
    out.push(
      issue(
        'error',
        RelationshipIssueCode.UnknownDataset,
        `Dataset "${rel.rightDatasetId}" does not exist.`,
        rel,
        'rightDatasetId',
      ),
    );

  const seen = new Set<string>();
  rel.keys.forEach((k, i) => {
    const pair = `${k.leftFieldId}|${k.rightFieldId}`;
    if (seen.has(pair))
      out.push(
        issue(
          'error',
          RelationshipIssueCode.DuplicateKey,
          `Key pair ${k.leftFieldId} = ${k.rightFieldId} is listed more than once.`,
          rel,
          `keys[${i}]`,
        ),
      );
    seen.add(pair);
    const lf = left?.fields.find((f) => f.id === k.leftFieldId);
    const rf = right?.fields.find((f) => f.id === k.rightFieldId);
    if (left && !lf)
      out.push(
        issue(
          'error',
          RelationshipIssueCode.UnknownField,
          `Field "${k.leftFieldId}" does not exist in "${left.name}".`,
          rel,
          `keys[${i}].leftFieldId`,
        ),
      );
    if (right && !rf)
      out.push(
        issue(
          'error',
          RelationshipIssueCode.UnknownField,
          `Field "${k.rightFieldId}" does not exist in "${right.name}".`,
          rel,
          `keys[${i}].rightFieldId`,
        ),
      );
    if (
      lf &&
      rf &&
      lf.datatype !== 'unknown' &&
      rf.datatype !== 'unknown' &&
      lf.datatype !== rf.datatype
    ) {
      out.push(
        issue(
          'warning',
          RelationshipIssueCode.DatatypeMismatch,
          `Key ${lf.displayName} is ${lf.datatype} but ${rf.displayName} is ${rf.datatype}.`,
          rel,
          `keys[${i}]`,
        ),
      );
    }
  });

  if (rel.cardinality === 'manyToMany') {
    out.push(
      issue(
        'warning',
        RelationshipIssueCode.ManyToMany,
        'Many-to-many joins multiply rows. Check that the keys are complete.',
        rel,
        'cardinality',
      ),
    );
  }
  if (data) {
    const a = analyzeRelationship(rel, data.left, data.right);
    if (a) {
      if (a.matchingKeys === 0 && a.leftRows > 0 && a.rightRows > 0) {
        out.push(
          issue(
            'warning',
            RelationshipIssueCode.NoMatchingValues,
            'No key value appears on both sides. The join returns no rows.',
            rel,
          ),
        );
      }
      if (a.leftBlankKeyRows > 0 || a.rightBlankKeyRows > 0) {
        out.push({
          ...blankKeys(left?.name ?? rel.leftDatasetId, right?.name ?? rel.rightDatasetId, a),
          technicalDetails: `relationship ${rel.id}`,
        });
      }
      if (
        a.observedCardinality !== rel.cardinality &&
        rel.cardinality !== 'manyToMany' &&
        a.leftRows > 0 &&
        a.rightRows > 0
      ) {
        out.push(
          issue(
            'warning',
            RelationshipIssueCode.CardinalityMismatch,
            `The relationship says ${rel.cardinality} but the data looks ${a.observedCardinality}.`,
            rel,
            'cardinality',
          ),
        );
      }
    }
  }
  return out;
}

/** Status changes return a new relationship. Suggested relationships need a human decision. */
export const confirmRelationship = (rel: Relationship): Relationship => ({
  ...rel,
  status: 'confirmed',
});
export const rejectRelationship = (rel: Relationship): Relationship => ({
  ...rel,
  status: 'rejected',
});
