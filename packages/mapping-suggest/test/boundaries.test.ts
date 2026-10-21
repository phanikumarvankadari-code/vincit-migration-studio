import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('mapping-suggest boundaries', () => {
  it('imports only mapping-core and relative modules and uses no Node, DOM or network code', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        expect(m[1] === '@mms/mapping-core' || m[1]!.startsWith('./'), `${f}: ${m[1]}`).toBe(true);
      }
      expect(text).not.toMatch(/node:|\bprocess\.|\bBuffer\b|document\.|window\.|fetch\(/);
    }
  });
});
