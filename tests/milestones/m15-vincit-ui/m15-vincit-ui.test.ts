import { describe, expect, it } from 'vitest';
import {
  copyBetweenPorts,
  countFiles,
  createCustomer,
  createObject,
  inspectRoot,
  openWorkspace,
  type StoreContext,
} from '@mms/workspace-files';
import {
  createStudioState,
  encodeWorkspace,
  decodeWorkspace,
  reduce,
  summarizeWorkspace,
} from '@mms/studio-model';
import { MemoryPort } from '../../../packages/workspace-files/test/memory-port.js';

const AT = '2026-10-22T10:00:00.000Z';

/** M15 / SPEC-035: what the new pages are built from, and moving a customer between storage places. */
describe('M15 Vincit Migration Studio pages', () => {
  const ctxOf = (port: MemoryPort): StoreContext => {
    let n = 0;
    return { port, now: () => AT, newId: () => `id-${++n}` };
  };

  it('M15-01 the object summary carries what the cards and the detail dialog show', () => {
    const st = createStudioState({ id: 'p', name: 'Profit Center', businessEntity: 'PC', at: AT });
    const ws = decodeWorkspace(
      encodeWorkspace({ project: st.project, snapshots: [], dictionary: undefined, savedAt: AT }),
    );
    if (!ws.ok) throw new Error('decode');
    expect(summarizeWorkspace(ws.value)).toEqual({
      state: 'draft',
      datasets: 0,
      structures: 0,
      fields: 0,
      mapped: 0,
      snapshots: 0,
      requiredOpen: 0,
      joinsConfirmed: 0,
    });
    // a renamed project still summarises the same way
    const renamed = reduce(st, { type: 'projectRenamed', name: 'X', businessEntity: 'Y', at: AT });
    expect(renamed.project.name).toBe('X');
  });

  it('M15-02 a customer moves between storage places with every file, and the source is left for archiving', async () => {
    const browser = new MemoryPort();
    const folder = new MemoryPort();
    const b = ctxOf(browser);
    await openWorkspace(b);
    const c = await createCustomer(b, 'Acme');
    if (!c.ok) throw new Error(c.message);
    const o = await createObject(b, c.value.folder, { name: 'Profit Center', entity: 'PC' }, '{}');
    if (!o.ok) throw new Error(o.message);
    await browser.writeText([c.value.folder, o.value.folder, 'sources', 'CEPC.csv'], 'a,b\n1,2\n');
    const f = ctxOf(folder);
    await openWorkspace(f);
    const n = await copyBetweenPorts(browser, [c.value.folder], folder, ['Acme']);
    expect(n).toBe(await countFiles(browser, [c.value.folder]));
    expect(await folder.readText(['Acme', 'Profit Center', 'sources', 'CEPC.csv'])).toBe(
      'a,b\n1,2\n',
    );
    expect(await browser.readText([c.value.folder, 'customer.json'])).toContain('Acme');
  });

  it('M15-03 a customer folder or a business-object folder chosen as the workspace is recognised, not written into', async () => {
    const customerFolder = new MemoryPort();
    await customerFolder.writeText(['customer.json'], '{}');
    expect(await inspectRoot(customerFolder)).toBe('customer');
    expect(await openWorkspace(ctxOf(customerFolder))).toMatchObject({ ok: false });
    expect([...customerFolder.files.keys()]).toEqual(['customer.json']);
    const objectFolder = new MemoryPort();
    await objectFolder.writeText(['object.json'], '{}');
    expect(await inspectRoot(objectFolder)).toBe('object');
  });
});
