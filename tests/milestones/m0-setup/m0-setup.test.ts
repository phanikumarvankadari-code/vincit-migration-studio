import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');
const h1Count = (rel: string): number =>
  read(rel)
    .split('\n')
    .filter((l) => /^# /.test(l)).length;

describe('M0 setup and cleanup', () => {
  it('M0-01 required project files exist', () => {
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'PRD.md', '.nvmrc', 'docs/MILESTONES.md']) {
      expect(existsSync(join(root, f)), f).toBe(true);
    }
  });

  it('M0-02 docs and SPEC-001 have exactly one top-level heading (no duplicated stub headers)', () => {
    for (const f of [
      'PRD.md',
      'docs/ARCHITECTURE.md',
      'docs/PRODUCT_DECISIONS.md',
      'docs/DEVELOPMENT_WORKFLOW.md',
      'docs/TESTING_STRATEGY.md',
      'specs/001-canonical-mapping-model.md',
    ]) {
      expect(h1Count(f), f).toBe(1);
    }
  });

  it('M0-03 TESTING_STRATEGY is its own document, not a copy of the workflow doc', () => {
    expect(read('docs/TESTING_STRATEGY.md').startsWith('# Testing Strategy')).toBe(true);
    expect(read('docs/TESTING_STRATEGY.md')).not.toBe(read('docs/DEVELOPMENT_WORKFLOW.md'));
  });

  it('M0-04 PD-003 records Table and Visual Mapper as equal views', () => {
    expect(read('docs/PRODUCT_DECISIONS.md')).toContain(
      'PD-003: Mapping Table and Visual Mapper Are Equal Views',
    );
    expect(read('PRD.md')).toContain('Equal Views');
  });

  it('M0-05 Profit Center golden fixtures are present', () => {
    const lower = (d: string): string[] =>
      readdirSync(join(root, 'test-data/profit-center', d)).map((n) => n.toLowerCase());
    expect(lower('input')).toEqual(
      expect.arrayContaining(['cepc.csv', 'cepct.csv', 'cepc_bukrs.csv', 'field_dictionary.csv']),
    );
    expect(lower('target')).toContain('data_pc.xlsx');
  });
});
