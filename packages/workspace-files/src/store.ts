import {
  ARCHIVE_DIR,
  BusinessObjectSchema,
  CUSTOMER_FILE,
  CustomerSchema,
  DICTIONARY_DIR,
  OBJECT_FILE,
  PROJECT_FILE,
  ROOT_FORMAT,
  ROOT_MANIFEST,
  OUTPUT_DIR,
  ROOT_VERSION,
  RootManifestSchema,
  SOURCES_DIR,
  TARGET_DIR,
  type BusinessObject,
  type Customer,
  type CustomerEntry,
  type FilePort,
  type ObjectEntry,
  type Outcome,
  type StoreContext,
} from './types.js';
import {
  runFolderName,
  safeFileName,
  safeName,
  stamp,
  uniqueFileName,
  uniqueName,
} from './names.js';

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

async function readJson<T>(
  port: FilePort,
  path: readonly string[],
  parse: (v: unknown) => { success: true; data: T } | { success: false },
): Promise<T | undefined> {
  const text = await port.readText(path);
  if (text === undefined) return undefined;
  try {
    const r = parse(JSON.parse(text));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

const readCustomer = (port: FilePort, folder: string) =>
  readJson(port, [folder, CUSTOMER_FILE], (v) => CustomerSchema.safeParse(v));
const readObject = (port: FilePort, c: string, o: string) =>
  readJson(port, [c, o, OBJECT_FILE], (v) => BusinessObjectSchema.safeParse(v));

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

export type RootKind = 'empty' | 'workspace' | 'customer' | 'object' | 'other';

/** What a chosen folder is: empty, already a workspace, or something else that must not be written into. */
/** What to tell the user when the chosen folder is a customer or object folder instead of the workspace. */
export function wrongFolderMessage(kind: 'customer' | 'object'): string {
  return kind === 'customer'
    ? 'This is a customer folder, not the workspace. Choose the folder that contains it (the workspace folder with mms-workspace.json).'
    : 'This is a business object folder, not the workspace. Choose the workspace folder that holds the customer folders.';
}

export async function inspectRoot(port: FilePort): Promise<RootKind> {
  const text = await port.readText([ROOT_MANIFEST]);
  if (text === undefined) {
    const entries = await port.list([]);
    if (entries.length === 0) return 'empty';
    // A customer or business-object folder chosen by mistake, instead of the workspace that holds it.
    if (entries.some((e) => e.kind === 'file' && e.name === OBJECT_FILE)) return 'object';
    if (entries.some((e) => e.kind === 'file' && e.name === CUSTOMER_FILE)) return 'customer';
    return 'other';
  }
  try {
    return RootManifestSchema.safeParse(JSON.parse(text)).success ? 'workspace' : 'other';
  } catch {
    return 'other';
  }
}

/** Creates the workspace marker on first use. A folder that already has another kind of marker is refused. */
export async function openWorkspace(ctx: StoreContext): Promise<Outcome<{ created: boolean }>> {
  const kind = await inspectRoot(ctx.port);
  if (kind === 'workspace') return { ok: true, value: { created: false } };
  if (kind === 'customer' || kind === 'object') return fail(wrongFolderMessage(kind));
  if (kind === 'other')
    return fail(
      'This folder already has other files in it and is not a Migration Mapping Studio workspace.',
    );
  await ctx.port.writeText(
    [ROOT_MANIFEST],
    json({ format: ROOT_FORMAT, schemaVersion: ROOT_VERSION, createdAt: ctx.now() }),
  );
  return { ok: true, value: { created: true } };
}

export interface SkippedFolder {
  folder: string;
  reason: string;
}

/** The customers of a workspace, and the folders that look like customers but could not be read as one. */
export async function scanCustomers(
  port: FilePort,
): Promise<{ customers: CustomerEntry[]; skipped: SkippedFolder[] }> {
  const customers: CustomerEntry[] = [];
  const skipped: SkippedFolder[] = [];
  for (const e of await port.list([])) {
    if (e.kind !== 'dir' || e.name === ARCHIVE_DIR || e.name.startsWith('.')) continue;
    const text = await port.readText([e.name, CUSTOMER_FILE]);
    if (text === undefined) {
      skipped.push({ folder: e.name, reason: 'it has no customer.json' });
      continue;
    }
    const customer = await readCustomer(port, e.name);
    if (customer) customers.push({ folder: e.name, customer });
    else skipped.push({ folder: e.name, reason: 'its customer.json is not valid' });
  }
  customers.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  return { customers, skipped };
}

export async function listCustomers(port: FilePort): Promise<CustomerEntry[]> {
  const out: CustomerEntry[] = [];
  for (const e of await port.list([])) {
    if (e.kind !== 'dir' || e.name === ARCHIVE_DIR || e.name.startsWith('.')) continue;
    const customer = await readCustomer(port, e.name);
    if (customer) out.push({ folder: e.name, customer });
  }
  return out.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
}

export async function createCustomer(
  ctx: StoreContext,
  name: string,
  notes?: string,
): Promise<Outcome<CustomerEntry>> {
  if (name.trim() === '') return fail('Give the customer a name.');
  const existing = (await ctx.port.list([])).map((e) => e.name);
  const folder = uniqueName(safeName(name), [...existing, ARCHIVE_DIR]);
  const customer: Customer = {
    id: ctx.newId(),
    name: name.trim(),
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    createdAt: ctx.now(),
  };
  await ctx.port.writeText([folder, CUSTOMER_FILE], json(customer));
  return { ok: true, value: { folder, customer } };
}

export async function listObjects(port: FilePort, customerFolder: string): Promise<ObjectEntry[]> {
  const out: ObjectEntry[] = [];
  for (const e of await port.list([customerFolder])) {
    if (e.kind !== 'dir' || e.name.startsWith('.')) continue;
    const object = await readObject(port, customerFolder, e.name);
    if (!object) continue;
    const hasProject = (await port.readText([customerFolder, e.name, PROJECT_FILE])) !== undefined;
    out.push({ folder: e.name, object, hasProject });
  }
  return out.sort((a, b) => a.object.name.localeCompare(b.object.name));
}

/** Path of an input file kept with an object: sources, target or dictionary. */
export function inputPath(
  customerFolder: string,
  objectFolder: string,
  dir: typeof SOURCES_DIR | typeof TARGET_DIR | typeof DICTIONARY_DIR,
  fileName: string,
): string[] {
  return [customerFolder, objectFolder, dir, safeFileName(fileName)];
}

/** Names of the files directly inside an object's `sources` folder (subfolders are ignored). */
export async function listSourceFiles(
  port: FilePort,
  customerFolder: string,
  objectFolder: string,
): Promise<string[]> {
  return (await port.list([customerFolder, objectFolder, SOURCES_DIR]))
    .filter((e) => e.kind === 'file' && /\.(csv|xlsx)$/i.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Creates a business object folder. `projectText` is the first project.mms.json, when there is one. */
export async function createObject(
  ctx: StoreContext,
  customerFolder: string,
  input: { name: string; entity: string },
  projectText?: string,
): Promise<Outcome<ObjectEntry>> {
  if (input.name.trim() === '') return fail('Give the business object a name.');
  if ((await readCustomer(ctx.port, customerFolder)) === undefined)
    return fail('That customer does not exist.');
  const existing = (await ctx.port.list([customerFolder])).map((e) => e.name);
  const folder = uniqueName(safeName(input.name), existing);
  const now = ctx.now();
  const object: BusinessObject = {
    id: ctx.newId(),
    name: input.name.trim(),
    entity: input.entity.trim() || input.name.trim(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (projectText !== undefined)
    await ctx.port.writeText([customerFolder, folder, PROJECT_FILE], projectText);
  await ctx.port.writeText([customerFolder, folder, OBJECT_FILE], json(object));
  return { ok: true, value: { folder, object, hasProject: projectText !== undefined } };
}

export const readProject = (
  port: FilePort,
  customerFolder: string,
  objectFolder: string,
): Promise<string | undefined> => port.readText([customerFolder, objectFolder, PROJECT_FILE]);

/**
 * Saves project.mms.json. `expectedRevision` is the revision the caller loaded; when the file on disk has moved on
 * (another machine, a sync) nothing is written and the result is a conflict.
 */
export async function writeProject(
  ctx: StoreContext,
  customerFolder: string,
  objectFolder: string,
  text: string,
  expectedRevision: number,
): Promise<Outcome<{ revision: number }>> {
  const object = await readObject(ctx.port, customerFolder, objectFolder);
  if (!object) return fail('The business object is no longer in the workspace.');
  if (object.revision !== expectedRevision) {
    return {
      ok: false,
      conflict: true,
      message: `The project was changed elsewhere (saved ${object.revision} times on disk, ${expectedRevision} here).`,
    };
  }
  const revision = object.revision + 1;
  await ctx.port.writeText([customerFolder, objectFolder, PROJECT_FILE], text);
  await ctx.port.writeText(
    [customerFolder, objectFolder, OBJECT_FILE],
    json({ ...object, revision, updatedAt: ctx.now() }),
  );
  return { ok: true, value: { revision } };
}

async function copyTree(
  port: FilePort,
  from: readonly string[],
  to: readonly string[],
): Promise<void> {
  for (const e of await port.list(from)) {
    if (e.kind === 'dir') await copyTree(port, [...from, e.name], [...to, e.name]);
    else {
      const bytes = await port.readBytes([...from, e.name]);
      if (bytes) await port.writeBytes([...to, e.name], bytes);
    }
  }
}

export async function countFiles(port: FilePort, path: readonly string[]): Promise<number> {
  let n = 0;
  for (const e of await port.list(path))
    n += e.kind === 'dir' ? await countFiles(port, [...path, e.name]) : 1;
  return n;
}

/**
 * Moves a customer or object folder into `_archive/<name>-<timestamp>`. The folder is copied, the copy is checked
 * by file count, and only then is the original removed.
 */
export async function archive(
  ctx: StoreContext,
  path: readonly string[],
): Promise<Outcome<{ archivedAs: string }>> {
  if (path.length === 0 || path[0] === ARCHIVE_DIR) return fail('That cannot be archived.');
  const name = path[path.length - 1]!;
  const existing = (await ctx.port.list([ARCHIVE_DIR])).map((e) => e.name);
  const archivedAs = uniqueName(`${name}-${stamp(ctx.now())}`, existing);
  const target = [ARCHIVE_DIR, archivedAs];
  const expected = await countFiles(ctx.port, path);
  if (expected === 0) return fail('Nothing to archive there.');
  await copyTree(ctx.port, path, target);
  if ((await countFiles(ctx.port, target)) !== expected) {
    await ctx.port.remove(target);
    return fail('The archive copy was incomplete, so nothing was removed.');
  }
  await ctx.port.remove(path);
  return { ok: true, value: { archivedAs } };
}

export interface RunEntry {
  /** Folder name under `output/`. */
  folder: string;
  files: number;
}

/** The runs saved for an object, newest first (folder names start with their time). */
export async function listRuns(
  port: FilePort,
  customerFolder: string,
  objectFolder: string,
): Promise<RunEntry[]> {
  const out: RunEntry[] = [];
  for (const e of await port.list([customerFolder, objectFolder, OUTPUT_DIR])) {
    if (e.kind !== 'dir') continue;
    const files = (await port.list([customerFolder, objectFolder, OUTPUT_DIR, e.name])).filter(
      (f) => f.kind === 'file',
    ).length;
    out.push({ folder: e.name, files });
  }
  return out.sort((a, b) => b.folder.localeCompare(a.folder));
}

/**
 * Writes the files of one run into a new folder under `output/`. A folder that exists is never reused, so an
 * earlier run is never replaced.
 */
export async function saveRunOutput(
  ctx: StoreContext,
  customerFolder: string,
  objectFolder: string,
  run: { startedAt: string; snapshotName: string },
  files: readonly { name: string; bytes: Uint8Array }[],
): Promise<Outcome<{ folder: string; files: number }>> {
  if (files.length === 0) return fail('There are no files to save.');
  const existing = (await ctx.port.list([customerFolder, objectFolder, OUTPUT_DIR])).map(
    (e) => e.name,
  );
  const folder = uniqueName(runFolderName(run.startedAt, run.snapshotName), existing);
  const used = new Set<string>();
  for (const f of files) {
    const name = uniqueFileName(safeFileName(f.name), used);
    used.add(name);
    await ctx.port.writeBytes([customerFolder, objectFolder, OUTPUT_DIR, folder, name], f.bytes);
  }
  return { ok: true, value: { folder, files: files.length } };
}

/**
 * Copies a folder with everything in it from one storage place to another (for example from browser storage
 * to a OneDrive folder). Returns the number of files copied. Nothing is removed from the source.
 */
export async function copyBetweenPorts(
  from: FilePort,
  fromPath: readonly string[],
  to: FilePort,
  toPath: readonly string[],
): Promise<number> {
  let n = 0;
  for (const e of await from.list(fromPath)) {
    if (e.kind === 'dir')
      n += await copyBetweenPorts(from, [...fromPath, e.name], to, [...toPath, e.name]);
    else {
      const bytes = await from.readBytes([...fromPath, e.name]);
      if (bytes) {
        await to.writeBytes([...toPath, e.name], bytes);
        n++;
      }
    }
  }
  return n;
}

/** A FilePort that sees one folder of another port as its root. */
export function scopedPort(port: FilePort, prefix: readonly string[]): FilePort {
  const at = (p: readonly string[]): string[] => [...prefix, ...p];
  return {
    list: (p) => port.list(at(p)),
    readText: (p) => port.readText(at(p)),
    writeText: (p, t) => port.writeText(at(p), t),
    readBytes: (p) => port.readBytes(at(p)),
    writeBytes: (p, b) => port.writeBytes(at(p), b),
    remove: (p) => port.remove(at(p)),
  };
}

export interface NestedWorkspace {
  /** Folder name inside the chosen folder. */
  folder: string;
  customers: number;
}

/** Workspaces one level down: a chosen folder often holds the real workspace folder rather than being one. */
export async function findNestedWorkspaces(port: FilePort): Promise<NestedWorkspace[]> {
  const out: NestedWorkspace[] = [];
  for (const e of await port.list([])) {
    if (e.kind !== 'dir' || e.name === ARCHIVE_DIR || e.name.startsWith('.')) continue;
    const inner = scopedPort(port, [e.name]);
    if ((await inspectRoot(inner)) !== 'workspace') continue;
    out.push({ folder: e.name, customers: (await scanCustomers(inner)).customers.length });
  }
  return out.sort((a, b) => b.customers - a.customers || a.folder.localeCompare(b.folder));
}

export type WorkspaceChoice =
  { kind: 'none' } | { kind: 'one'; folder: string } | { kind: 'many'; options: NestedWorkspace[] };

/**
 * Which nested workspace to use. One candidate: that one. Several, but only one with customers (the others are
 * empty leftovers): the one with customers. Otherwise the person chooses.
 */
export function chooseWorkspace(found: readonly NestedWorkspace[]): WorkspaceChoice {
  if (found.length === 0) return { kind: 'none' };
  if (found.length === 1) return { kind: 'one', folder: found[0]!.folder };
  const withCustomers = found.filter((f) => f.customers > 0);
  if (withCustomers.length === 1) return { kind: 'one', folder: withCustomers[0]!.folder };
  return { kind: 'many', options: [...found] };
}
