import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set(['@mms/mapping-core', 'fflate', 'fast-xml-parser']);

describe('file-import boundaries', () => {
  it('sources import only allowed packages and relative modules', () => {
    const bad: string[] = [];
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (!ALLOWED.has(spec) && !spec.startsWith('./')) bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('sources use no file system, DOM or Node globals (importers take text or bytes)', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(join(pkg, 'src', f), 'utf8'), f).not.toMatch(
        /node:|\bprocess\.|\bBuffer\b|document\.|window\.|TextDecoder/,
      );
    }
  });

  it('compiles without DOM or Node typings', () => {
    const ts = JSON.parse(readFileSync(join(pkg, 'tsconfig.json'), 'utf8'));
    expect(ts.compilerOptions).toMatchObject({ types: [], lib: ['ES2023'] });
  });
});
