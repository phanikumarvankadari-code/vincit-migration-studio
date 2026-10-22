import {
  DICTIONARY_DIR,
  SOURCES_DIR,
  TARGET_DIR,
  archive,
  createCustomer,
  createObject,
  inputPath,
  inspectRoot,
  listCustomers,
  listObjects,
  listSourceFiles,
  openWorkspace,
  readProject,
  stamp,
  writeProject,
  type BusinessObject,
  type CustomerEntry,
  type ObjectEntry,
  type StoreContext,
} from '@mms/workspace-files';
import {
  createStudioState,
  decodeWorkspace,
  encodeWorkspace,
  summarizeWorkspace,
  type ObjectSummary,
  type Workspace,
} from '@mms/studio-model';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { browserStorageRoot, handlePort } from './lib/handle-port';
import {
  folderPermission,
  folderPickerSupported,
  forgetFolderHandle,
  loadFolderHandle,
  pickFolder,
  requestFolderPermission,
  saveFolderHandle,
} from './lib/folder-store';
import { deleteFromLibrary, listProjects, readLibraryText, type LibraryEntry } from './lib/storage';

export interface ObjectCard extends ObjectEntry {
  summary: ObjectSummary | undefined;
  /** Why the project file could not be read, if it could not. */
  problem: string | undefined;
}

export interface OpenObject {
  customerFolder: string;
  customerName: string;
  objectFolder: string;
  object: BusinessObject;
  workspace: Workspace;
}

type Result = { ok: true } | { ok: false; message: string };

export type Connection =
  | { kind: 'browser' }
  | { kind: 'folder'; name: string }
  | { kind: 'needsPermission'; name: string };

export interface WorkspaceApi {
  phase: 'loading' | 'ready' | 'error';
  error: string | undefined;
  storageLabel: string;
  connection: Connection;
  canChooseFolder: boolean;
  chooseFolder: () => Promise<Result>;
  reconnectFolder: () => Promise<Result>;
  useBrowserStorage: () => Promise<Result>;
  /** Copies a file the user added into the object's sources, target or dictionary folder. */
  saveInput: (kind: 'sources' | 'target' | 'dictionary', file: File) => Promise<Result>;
  /** The source files kept with the open object, as files, for re-attaching their rows. */
  readSources: () => Promise<File[]>;
  rowsLoaded: boolean;
  markRowsLoaded: () => void;
  /** The open project was changed elsewhere; the user has to decide. */
  conflict: { message: string; hasPending: boolean } | undefined;
  resolveConflict: (choice: 'theirs' | 'mine') => Promise<void>;
  /** Changes when the open project is reloaded from disk, so the screen starts again from it. */
  openNonce: number;
  customers: CustomerEntry[];
  customerFolder: string | undefined;
  selectCustomer: (folder: string) => void;
  cards: ObjectCard[];
  addCustomer: (name: string, notes: string) => Promise<Result>;
  addObject: (name: string, entity: string) => Promise<Result>;
  archiveObject: (folder: string) => Promise<Result>;
  archiveCustomer: () => Promise<Result>;
  open: OpenObject | undefined;
  openObject: (folder: string) => Promise<Result>;
  closeObject: () => Promise<void>;
  registerFlush: (flush: (() => Promise<void>) | undefined) => void;
  /** Saves the open project into its folder. */
  persist: (text: string) => Promise<Result>;
  unfiled: LibraryEntry[];
  moveUnfiled: (id: string) => Promise<Result>;
}

const Ctx = createContext<WorkspaceApi | undefined>(undefined);
const LAST_KEY = 'mms:lastOpen';

const newId = (): string => crypto.randomUUID();
const nowIso = (): string => new Date().toISOString();

function freshProjectText(name: string, entity: string): string {
  const at = nowIso();
  const st = createStudioState({ id: newId(), name, businessEntity: entity, at });
  return encodeWorkspace({
    project: st.project,
    snapshots: [],
    dictionary: undefined,
    savedAt: at,
  });
}

function remember(v: { customer: string; object: string } | undefined): void {
  try {
    if (v) window.localStorage.setItem(LAST_KEY, JSON.stringify(v));
    else window.localStorage.removeItem(LAST_KEY);
  } catch {
    /* the last-open memory is a convenience */
  }
}
function recall(): { customer: string; object: string } | undefined {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    const v = raw ? (JSON.parse(raw) as { customer?: unknown; object?: unknown }) : undefined;
    return typeof v?.customer === 'string' && typeof v.object === 'string'
      ? { customer: v.customer, object: v.object }
      : undefined;
  } catch {
    return undefined;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<WorkspaceApi['phase']>('loading');
  const [error, setError] = useState<string | undefined>();
  const [customers, setCustomers] = useState<CustomerEntry[]>([]);
  const [customerFolder, setCustomerFolder] = useState<string | undefined>();
  const [cards, setCards] = useState<ObjectCard[]>([]);
  const [open, setOpen] = useState<OpenObject | undefined>();
  const [unfiled, setUnfiled] = useState<LibraryEntry[]>(() => listProjects());
  const [connection, setConnection] = useState<Connection>({ kind: 'browser' });
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const [conflict, setConflict] = useState<WorkspaceApi['conflict']>();
  const [openNonce, setOpenNonce] = useState(0);
  const pending = useRef<string | undefined>(undefined);
  const permissionHandle = useRef<FileSystemDirectoryHandle | undefined>(undefined);
  const ctxRef = useRef<StoreContext | undefined>(undefined);
  const revision = useRef(0);
  const openRef = useRef<OpenObject | undefined>(undefined);
  const started = useRef(false);
  const flush = useRef<(() => Promise<void>) | undefined>(undefined);
  // Saves go one after the other, each with the revision left by the one before.
  const saves = useRef<Promise<unknown>>(Promise.resolve());

  const loadCards = useCallback(async (folder: string | undefined) => {
    const ctx = ctxRef.current;
    if (!ctx || !folder) {
      setCards([]);
      return;
    }
    const entries = await listObjects(ctx.port, folder);
    const out: ObjectCard[] = [];
    for (const e of entries) {
      const text = e.hasProject ? await readProject(ctx.port, folder, e.folder) : undefined;
      const decoded = text === undefined ? undefined : decodeWorkspace(text);
      out.push({
        ...e,
        summary: decoded?.ok ? summarizeWorkspace(decoded.value) : undefined,
        problem:
          decoded && !decoded.ok ? decoded.issues.map((i) => i.message).join(' ') : undefined,
      });
    }
    setCards(out);
  }, []);

  const refreshCustomers = useCallback(
    async (prefer?: string): Promise<string | undefined> => {
      const ctx = ctxRef.current;
      if (!ctx) return undefined;
      const list = await listCustomers(ctx.port);
      setCustomers(list);
      const pick = list.find((c) => c.folder === prefer)?.folder ?? list[0]?.folder;
      setCustomerFolder(pick);
      await loadCards(pick);
      return pick;
    },
    [loadCards],
  );

  const openObject = useCallback(
    async (folder: string, customerOverride?: string): Promise<Result> => {
      const ctx = ctxRef.current;
      const cf = customerOverride ?? customerFolder;
      if (!ctx || !cf) return { ok: false, message: 'No customer is selected.' };
      const customer = (await listCustomers(ctx.port)).find((c) => c.folder === cf);
      const entry = (await listObjects(ctx.port, cf)).find((o) => o.folder === folder);
      if (!customer || !entry) return { ok: false, message: 'That business object was not found.' };
      let text = await readProject(ctx.port, cf, folder);
      if (text === undefined) {
        text = freshProjectText(entry.object.name, entry.object.entity);
        const w = await writeProject(ctx, cf, folder, text, entry.object.revision);
        if (!w.ok) return { ok: false, message: w.message };
        entry.object = { ...entry.object, revision: w.value.revision };
      }
      const decoded = decodeWorkspace(text);
      if (!decoded.ok)
        return {
          ok: false,
          message: `The project file could not be read: ${decoded.issues.map((i) => i.message).join(' ')}`,
        };
      revision.current = entry.object.revision;
      const o: OpenObject = {
        customerFolder: cf,
        customerName: customer.customer.name,
        objectFolder: folder,
        object: entry.object,
        workspace: decoded.value,
      };
      openRef.current = o;
      setRowsLoaded(false);
      setConflict(undefined);
      pending.current = undefined;
      setOpenNonce((n) => n + 1);
      setOpen(o);
      remember({ customer: cf, object: folder });
      return { ok: true };
    },
    [customerFolder],
  );

  /** Makes `root` the workspace: creates or checks its marker, then loads the customers. */
  const connectTo = useCallback(
    async (root: FileSystemDirectoryHandle, conn: Connection): Promise<Result> => {
      let port = handlePort(root);
      let kind = await inspectRoot(port);
      if (kind === 'other') {
        // A folder that already holds other files (for example the OneDrive top folder): keep to a folder of our own inside it.
        const sub = await root.getDirectoryHandle('Migration Mapping Studio', { create: true });
        port = handlePort(sub);
        kind = await inspectRoot(port);
        if (kind === 'other')
          return {
            ok: false,
            message:
              'That folder has a "Migration Mapping Studio" folder that is not a workspace. Choose another folder.',
          };
      }
      const ctx: StoreContext = { port, now: nowIso, newId };
      const opened = await openWorkspace(ctx);
      if (!opened.ok) return opened;
      ctxRef.current = ctx;
      setConnection(conn);
      return { ok: true };
    },
    [],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const stored = await loadFolderHandle();
        let connected: Result | undefined;
        if (stored) {
          const perm = await folderPermission(stored);
          if (perm === 'granted') {
            connected = await connectTo(stored, { kind: 'folder', name: stored.name });
          } else {
            permissionHandle.current = stored;
            setConnection({ kind: 'needsPermission', name: stored.name });
            setPhase('ready');
            return;
          }
        }
        if (!connected || !connected.ok) {
          const r = await connectTo(await browserStorageRoot(), { kind: 'browser' });
          if (!r.ok) {
            setError(r.message);
            setPhase('error');
            return;
          }
          if (connected && !connected.ok) setError(connected.message);
        }
        const last = recall();
        const pick = await refreshCustomers(last?.customer);
        if (last && pick === last.customer) await openObject(last.object, pick);
        setPhase('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The workspace could not be opened.');
        setPhase('error');
      }
    })();
  }, [connectTo, refreshCustomers, openObject]);

  const switchTo = useCallback(
    async (
      root: FileSystemDirectoryHandle,
      conn: Connection,
      remember_: boolean,
    ): Promise<Result> => {
      const r = await connectTo(root, conn);
      if (!r.ok) return r;
      if (remember_ && conn.kind === 'folder') {
        await saveFolderHandle(root);
      } else if (conn.kind === 'browser') await forgetFolderHandle();
      permissionHandle.current = undefined;
      openRef.current = undefined;
      setOpen(undefined);
      setError(undefined);
      remember(undefined);
      await refreshCustomers();
      return { ok: true };
    },
    [connectTo, refreshCustomers],
  );

  const checkChangedElsewhere = useCallback(async () => {
    const ctx = ctxRef.current;
    const o = openRef.current;
    if (!ctx || !o) return;
    await saves.current;
    const onDisk = (await listObjects(ctx.port, o.customerFolder)).find(
      (x) => x.folder === o.objectFolder,
    );
    if (onDisk && onDisk.object.revision !== revision.current)
      setConflict(
        (c) =>
          c ?? {
            message:
              'This project was saved elsewhere (another computer, or a OneDrive sync) since you opened it.',
            hasPending: pending.current !== undefined,
          },
      );
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkChangedElsewhere();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checkChangedElsewhere]);

  const persist = useCallback((text: string): Promise<Result> => {
    const job = saves.current.then(async (): Promise<Result> => {
      const ctx = ctxRef.current;
      const o = openRef.current;
      if (!ctx || !o) return { ok: false, message: 'No business object is open.' };
      try {
        const r = await writeProject(ctx, o.customerFolder, o.objectFolder, text, revision.current);
        if (!r.ok) {
          if (r.conflict) {
            pending.current = text;
            setConflict({ message: r.message, hasPending: true });
          }
          return { ok: false, message: r.message };
        }
        revision.current = r.value.revision;
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : 'The project was not saved.',
        };
      }
    });
    saves.current = job;
    return job;
  }, []);

  const api = useMemo<WorkspaceApi>(
    () => ({
      phase,
      error,
      storageLabel:
        connection.kind === 'browser'
          ? 'this browser'
          : `folder “${connection.name}”${connection.kind === 'needsPermission' ? ' (needs permission)' : ''}`,
      connection,
      canChooseFolder: folderPickerSupported(),
      chooseFolder: async () => {
        try {
          const picked = await pickFolder();
          if (!picked) return { ok: true };
          return await switchTo(picked, { kind: 'folder', name: picked.name }, true);
        } catch (e) {
          return {
            ok: false,
            message: e instanceof Error ? e.message : 'The folder could not be opened.',
          };
        }
      },
      reconnectFolder: async () => {
        const h = permissionHandle.current;
        if (!h) return { ok: false, message: 'There is no folder to reconnect.' };
        const perm = await requestFolderPermission(h);
        if (perm !== 'granted')
          return { ok: false, message: 'Permission to use the folder was not given.' };
        const r = await switchTo(h, { kind: 'folder', name: h.name }, true);
        if (r.ok) setPhase('ready');
        return r;
      },
      useBrowserStorage: async () => {
        const r = await switchTo(await browserStorageRoot(), { kind: 'browser' }, false);
        if (r.ok) setPhase('ready');
        return r;
      },
      saveInput: async (kind, file) => {
        const ctx = ctxRef.current;
        const o = openRef.current;
        if (!ctx || !o) return { ok: false, message: 'No business object is open.' };
        const dir =
          kind === 'sources' ? SOURCES_DIR : kind === 'target' ? TARGET_DIR : DICTIONARY_DIR;
        try {
          await ctx.port.writeBytes(
            inputPath(o.customerFolder, o.objectFolder, dir, file.name),
            new Uint8Array(await file.arrayBuffer()),
          );
          return { ok: true };
        } catch (e) {
          return {
            ok: false,
            message: e instanceof Error ? e.message : 'The file was not copied.',
          };
        }
      },
      readSources: async () => {
        const ctx = ctxRef.current;
        const o = openRef.current;
        if (!ctx || !o) return [];
        const out: File[] = [];
        for (const name of await listSourceFiles(ctx.port, o.customerFolder, o.objectFolder)) {
          const bytes = await ctx.port.readBytes([
            o.customerFolder,
            o.objectFolder,
            SOURCES_DIR,
            name,
          ]);
          if (bytes) out.push(new File([bytes as BlobPart], name));
        }
        return out;
      },
      rowsLoaded,
      markRowsLoaded: () => setRowsLoaded(true),
      conflict,
      openNonce,
      resolveConflict: async (choice) => {
        const ctx = ctxRef.current;
        const o = openRef.current;
        if (!ctx || !o) return;
        const mine = pending.current;
        setConflict(undefined);
        pending.current = undefined;
        if (choice === 'theirs') {
          if (mine !== undefined)
            await ctx.port.writeText(
              [o.customerFolder, o.objectFolder, `project.conflict-${stamp(nowIso())}.mms.json`],
              mine,
            );
          await openObject(o.objectFolder, o.customerFolder);
          return;
        }
        const onDisk = (await listObjects(ctx.port, o.customerFolder)).find(
          (x) => x.folder === o.objectFolder,
        );
        if (onDisk) revision.current = onDisk.object.revision;
        if (mine !== undefined) await persist(mine);
      },
      customers,
      customerFolder,
      selectCustomer: (folder) => {
        setCustomerFolder(folder);
        void loadCards(folder);
      },
      cards,
      addCustomer: async (name, notes) => {
        const ctx = ctxRef.current;
        if (!ctx) return { ok: false, message: 'The workspace is not ready.' };
        const r = await createCustomer(ctx, name, notes);
        if (!r.ok) return r;
        await refreshCustomers(r.value.folder);
        return { ok: true };
      },
      addObject: async (name, entity) => {
        const ctx = ctxRef.current;
        if (!ctx || !customerFolder) return { ok: false, message: 'Choose a customer first.' };
        if (name.trim() === '') return { ok: false, message: 'Give the business object a name.' };
        const r = await createObject(
          ctx,
          customerFolder,
          { name, entity },
          freshProjectText(name.trim(), entity.trim() || name.trim()),
        );
        if (!r.ok) return r;
        await loadCards(customerFolder);
        return { ok: true };
      },
      archiveObject: async (folder) => {
        const ctx = ctxRef.current;
        if (!ctx || !customerFolder) return { ok: false, message: 'Choose a customer first.' };
        const r = await archive(ctx, [customerFolder, folder]);
        if (!r.ok) return r;
        await loadCards(customerFolder);
        return { ok: true };
      },
      archiveCustomer: async () => {
        const ctx = ctxRef.current;
        if (!ctx || !customerFolder) return { ok: false, message: 'Choose a customer first.' };
        const r = await archive(ctx, [customerFolder]);
        if (!r.ok) return r;
        await refreshCustomers();
        return { ok: true };
      },
      open,
      openObject: (folder) => openObject(folder),
      closeObject: async () => {
        await flush.current?.();
        await saves.current;
        openRef.current = undefined;
        setOpen(undefined);
        remember(undefined);
        await loadCards(customerFolder);
      },
      registerFlush: (f) => {
        flush.current = f;
      },
      persist,
      unfiled,
      moveUnfiled: async (id) => {
        const ctx = ctxRef.current;
        const entry = unfiled.find((u) => u.id === id);
        const text = readLibraryText(id);
        if (!ctx || !customerFolder || !entry || text === undefined)
          return { ok: false, message: 'Choose a customer first.' };
        const decoded = decodeWorkspace(text);
        if (!decoded.ok)
          return {
            ok: false,
            message: `That saved project cannot be read: ${decoded.issues.map((i) => i.message).join(' ')}`,
          };
        const r = await createObject(
          ctx,
          customerFolder,
          { name: entry.name, entity: entry.businessEntity },
          text,
        );
        if (!r.ok) return r;
        deleteFromLibrary(id);
        setUnfiled(listProjects());
        await loadCards(customerFolder);
        return { ok: true };
      },
    }),
    [
      phase,
      error,
      customers,
      customerFolder,
      cards,
      open,
      unfiled,
      connection,
      rowsLoaded,
      conflict,
      openNonce,
      persist,
      switchTo,
      loadCards,
      refreshCustomers,
      openObject,
    ],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return v;
}

/** The workspace, or undefined in classic single-project mode. */
export function useOptionalWorkspace(): WorkspaceApi | undefined {
  return useContext(Ctx);
}
