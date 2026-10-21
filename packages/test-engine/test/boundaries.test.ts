import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('test-engine boundaries', () => {
  it('imports only mapping-core, routine-library, the engine and relative modules; no Node, DOM, clock or randomness', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        expect(
          ['@mms/mapping-core', '@mms/routine-library', '@mms/transformation-engine'].includes(
            m[1]!,
          ) || m[1]!.startsWith('./'),
          `${f}: ${m[1]}`,
        ).toBe(true);
      }
      expect(text, f).not.toMatch(
        /node:|\bprocess\.|\bBuffer\b|document\.|window\.|Math\.random|Date\.now|new Date|\beval\(|new Function/,
      );
    }
  });
});
