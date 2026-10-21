import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFiles = readdirSync(join(pkg, 'src')).filter((f) => f.endsWith('.ts'));

describe('mapping-core boundaries (AC-009)', () => {
  it('AC-009 source files import only zod and relative modules', () => {
    const bad: string[] = [];
    for (const f of srcFiles) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (spec !== 'zod' && !spec.startsWith('./')) bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('only runtime dependency is zod', () => {
    const json = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    expect(Object.keys(json.dependencies ?? {})).toEqual(['zod']);
  });

  it('source compiles without DOM or Node typings', () => {
    const ts = JSON.parse(readFileSync(join(pkg, 'tsconfig.json'), 'utf8'));
    expect(ts.compilerOptions.types).toEqual([]);
    expect(ts.compilerOptions.lib).toEqual(['ES2023']);
  });

  it('source does not use Date, process or require', () => {
    for (const f of srcFiles) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      expect(text, f).not.toMatch(/new Date|Date\.now|process\.|require\(/);
    }
  });
});
