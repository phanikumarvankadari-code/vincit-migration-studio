import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('transformation-engine boundaries', () => {
  it('imports only mapping-core and relative modules, uses no Node or DOM code, and never evaluates code', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        expect(m[1] === '@mms/mapping-core' || m[1]!.startsWith('./'), `${f}: ${m[1]}`).toBe(true);
      }
      expect(text, f).not.toMatch(
        /node:|\bprocess\.|\bBuffer\b|document\.|window\.|\beval\(|new Function|Math\.random|Date\.now|new Date/,
      );
    }
  });
});
