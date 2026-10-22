import { describe, expect, it } from 'vitest';
import {
  createCustomer,
  createObject,
  inputPath,
  inspectRoot,
  listSourceFiles,
  openWorkspace,
  type StoreContext,
} from '@mms/workspace-files';
import { MemoryPort } from '../../../packages/workspace-files/test/memory-port.js';

/** M13 / SPEC-033: the files an object keeps next to its project, and what a chosen folder may be. */
describe('M13 input files and folder rules', () => {
  const setup = () => {
    let n = 0;
    const port = new MemoryPort();
    const ctx: StoreContext = {
      port,
      now: () => '2026-10-22T10:00:00.000Z',
      newId: () => `id-${++n}`,
    };
    return { port, ctx };
  };

  it('M13-01 source, target and dictionary files are kept in their own folders with safe names', async () => {
    const { port, ctx } = setup();
    await openWorkspace(ctx);
    const c = await createCustomer(ctx, 'Acme');
    if (!c.ok) throw new Error(c.message);
    const o = await createObject(ctx, c.value.folder, { name: 'Profit Center', entity: 'PC' });
    if (!o.ok) throw new Error(o.message);
    await port.writeText(inputPath('Acme', 'Profit Center', 'sources', 'CEPC.csv'), 'a,b\n1,2\n');
    await port.writeText(inputPath('Acme', 'Profit Center', 'sources', 'CEPC_BUKRS.csv'), 'a\n1\n');
    await port.writeText(inputPath('Acme', 'Profit Center', 'target', 'data_pc.XLSX'), 'x');
    await port.writeText(inputPath('Acme', 'Profit Center', 'dictionary', 'dict:1.csv'), 'x');
    expect([...port.files.keys()].filter((k) => !k.endsWith('.json')).sort()).toEqual([
      'Acme/Profit Center/dictionary/dict_1.csv',
      'Acme/Profit Center/sources/CEPC.csv',
      'Acme/Profit Center/sources/CEPC_BUKRS.csv',
      'Acme/Profit Center/target/data_pc.XLSX',
    ]);
  });

  it('M13-02 only csv and xlsx files directly in sources are read back as sources', async () => {
    const { port } = setup();
    for (const f of ['b.csv', 'a.XLSX', 'readme.txt', 'old/c.csv'])
      await port.writeText(['Acme', 'PC', 'sources', ...f.split('/')], 'x');
    expect(await listSourceFiles(port, 'Acme', 'PC')).toEqual(['a.XLSX', 'b.csv']);
  });

  it('M13-03 an empty folder or a workspace can be used; any other folder is not written into', async () => {
    const empty = setup();
    expect(await inspectRoot(empty.port)).toBe('empty');
    await openWorkspace(empty.ctx);
    expect(await inspectRoot(empty.port)).toBe('workspace');
    const other = setup();
    await other.port.writeText(['photos', 'holiday.jpg'], 'x');
    expect(await inspectRoot(other.port)).toBe('other');
    expect(await openWorkspace(other.ctx)).toMatchObject({ ok: false });
    expect([...other.port.files.keys()]).toEqual(['photos/holiday.jpg']);
  });
});
