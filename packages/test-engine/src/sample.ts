import type { RunDefinition } from '@mms/mapping-core';

/** First N rows, N rows spread evenly across the dataset, or every row. */
export type SampleConfig = NonNullable<RunDefinition['sample']>;

export const DEFAULT_SAMPLE: SampleConfig = { kind: 'firstRows', count: 100 };

/** The sizes the product offers: 100 rows, 1,000 rows, and all rows when safe. */
export const SAMPLE_PRESETS: Readonly<Record<'rows100' | 'rows1000' | 'all', SampleConfig>> = {
  rows100: { kind: 'firstRows', count: 100 },
  rows1000: { kind: 'firstRows', count: 1000 },
  all: { kind: 'all' },
};

/**
 * Which 0-based rows to run for a dataset of `rowCount` rows. Repeatable: the same input always gives the
 * same rows. "spread" takes row 0 and then evenly spaced rows (it does not always include the last row).
 */
export function selectRows(sample: SampleConfig, rowCount: number): number[] {
  if (rowCount <= 0) return [];
  if (sample.kind === 'all' || sample.count >= rowCount)
    return Array.from({ length: rowCount }, (_, i) => i);
  if (sample.kind === 'firstRows') return Array.from({ length: sample.count }, (_, i) => i);
  return Array.from({ length: sample.count }, (_, i) => Math.floor((i * rowCount) / sample.count));
}
