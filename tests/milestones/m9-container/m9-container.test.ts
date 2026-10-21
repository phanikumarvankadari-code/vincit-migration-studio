import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');

/** M9 / SPEC-030: static checks of the container files. The running container is tested by npm run e2e:container. */
describe('M9 container packaging', () => {
  const dockerfile = read('container/Dockerfile');

  it('M9-01 base images are pinned to versions', () => {
    const froms = dockerfile.split('\n').filter((l) => l.startsWith('FROM '));
    expect(froms).toHaveLength(2);
    for (const f of froms) expect(f).toMatch(/:\d+\.\d+/);
    expect(dockerfile).not.toMatch(/:latest/);
  });

  it('M9-02 runtime is a non-root static server with a healthcheck and a data volume', () => {
    expect(dockerfile).toContain('nginx-unprivileged');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('VOLUME ["/data"]');
    expect(dockerfile).not.toMatch(/^USER root/m);
  });

  it('M9-03 image build context excludes dependencies and results; no test data is copied in', () => {
    expect(read('.dockerignore')).toContain('node_modules');
    expect(dockerfile).not.toContain('test-data');
  });

  it('M9-04 compose mounts user data read-only, publishes on localhost only, read-only root', () => {
    const c = read('container/docker-compose.yml');
    expect(c).toContain('127.0.0.1:8080:8080');
    expect(c).toContain(':/data:ro');
    expect(c).toContain('read_only: true');
    expect(c).toContain('no-new-privileges');
  });

  it('M9-05 the smoke test and the spec exist', () => {
    expect(existsSync(new URL('apps/mapping-studio/e2e-container/smoke.spec.ts', root))).toBe(true);
    expect(read('specs/030-container-packaging.md')).toContain('AC-5');
    expect(JSON.parse(read('package.json')).scripts['e2e:container']).toBeTruthy();
  });
});
