import { z } from 'zod';

/** Names of the files and folders the app owns inside a workspace. */
export const ROOT_MANIFEST = 'mms-workspace.json';
export const CUSTOMER_FILE = 'customer.json';
export const OBJECT_FILE = 'object.json';
export const PROJECT_FILE = 'project.mms.json';
export const ARCHIVE_DIR = '_archive';
export const SOURCES_DIR = 'sources';
export const TARGET_DIR = 'target';
export const OUTPUT_DIR = 'output';
export const DICTIONARY_DIR = 'dictionary';

export const ROOT_FORMAT = 'mms.root';
export const ROOT_VERSION = 1;

export const RootManifestSchema = z.strictObject({
  format: z.literal(ROOT_FORMAT),
  schemaVersion: z.literal(ROOT_VERSION),
  createdAt: z.string().min(1),
});
export type RootManifest = z.infer<typeof RootManifestSchema>;

export const CustomerSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  notes: z.string().optional(),
  createdAt: z.string().min(1),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const BusinessObjectSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  entity: z.string().min(1),
  /** Counts saves of project.mms.json; used to notice a change made elsewhere. */
  revision: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type BusinessObject = z.infer<typeof BusinessObjectSchema>;

export interface PortEntry {
  name: string;
  kind: 'file' | 'dir';
}

/**
 * The only way the workspace logic touches storage. Paths are lists of folder names from the workspace root.
 * Adapters: browser storage, a picked (OneDrive-synced) folder, memory for tests. Writing creates missing folders.
 */
export interface FilePort {
  /** Entries of a folder; a missing folder is empty. */
  list(path: readonly string[]): Promise<PortEntry[]>;
  readText(path: readonly string[]): Promise<string | undefined>;
  writeText(path: readonly string[], text: string): Promise<void>;
  readBytes(path: readonly string[]): Promise<Uint8Array | undefined>;
  writeBytes(path: readonly string[], bytes: Uint8Array): Promise<void>;
  /** Removes a file or a folder with everything in it. */
  remove(path: readonly string[]): Promise<void>;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string; conflict?: true };

export interface CustomerEntry {
  /** Folder name, the key of the customer inside the workspace. */
  folder: string;
  customer: Customer;
}

export interface ObjectEntry {
  folder: string;
  object: BusinessObject;
  hasProject: boolean;
}

export interface StoreContext {
  port: FilePort;
  now: () => string;
  newId: () => string;
}
