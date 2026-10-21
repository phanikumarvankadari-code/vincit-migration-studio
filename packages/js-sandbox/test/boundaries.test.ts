import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('js-sandbox boundaries', () => {
  it('the host side imports only the sandbox engine, mapping-core, the engine types and relative modules', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        expect(
          ['quickjs-emscripten', '@mms/mapping-core', '@mms/transformation-engine'].includes(
            m[1]!,
          ) || m[1]!.startsWith('./'),
          `${f}: ${m[1]}`,
        ).toBe(true);
      }
      expect(text, f).not.toMatch(/node:|\bprocess\.|\bBuffer\b|document\.|window\.|require\(/);
    }
  });

  it('uses no unsafe evaluation on the host (user code runs only inside QuickJS)', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(join(pkg, 'src', f), 'utf8'), f).not.toMatch(
        /\beval\(|new Function\(|node:vm/,
      );
    }
  });
});
