import {
  DICTIONARY_DIR,
  OUTPUT_DIR,
  SOURCES_DIR,
  TARGET_DIR,
  ARCHIVE_DIR,
  archive,
  chooseWorkspace,
  copyBetweenPorts,
  countFiles,
  createCustomer,
  createObject,
  inputPath,
  findNestedWorkspaces,
  inspectRoot,
  listCustomers,
  listObjects,
  listRuns,
  scanCustomers,
  listSourceFiles,
  saveRunOutput,
  openWorkspace,
  readProject,
  stamp,
  uniqueName,
  writeProject,
  type BusinessObject,
  type CustomerEntry,
  type NestedWorkspace,
  type ObjectEntry,
  type RunEntry,
  type StoreContext,
  wrongFolderMessage,
} from '@mms/workspace-files';
import {
  createStudioState,
  decodeWorkspace,
  encodeWorkspace,
  summarizeWorkspace,
  type ObjectSummary,
  type Stage,
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
import { MIME, downloadFile } from './lib/storage';
import { toZip } from '@mms/file-export';
import { deleteFromLibrary, listProjects, readLibraryText, type LibraryEntry } from './lib/storage';

export interface ObjectCard extends ObjectEntry {
  customerFolder: string;
  customerName: string;
  /** Runs saved in the object's output folder, newest first. */
  runs: RunEntry[];
  /** The newest run saved in the object's output folder. */
  lastRun: RunEntry | undefined;
  /** What the newest run's summary says (errors found), when it can be read. */
  lastResult: { errors: number } | undefined;
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
  /** Stage to start on (for example Ready, to run all rows). */
  stage?: Stage | undefined;
}

export interface PortfolioCustomer {
  entry: CustomerEntry;
  cards: ObjectCard[];
}

export interface ObjectFiles {
  files: { kind: 'SOURCE' | 'TARGET' | 'DICTIONARY'; name: string }[];
}

type Result = { ok: true } | { ok: false; message: string };

export type Connection =
  | { kind: 'browser' }
  | { kind: 'folder'; name: string }
  | { kind: 'needsPermission'; name: string };

export interface WorkspaceNotice {
  intent: 'info' | 'warning';
  text: string;
}

export interface WorkspaceApi {
  /** What happened when a folder was opened (customers found, folders skipped), so it never looks like nothing happened. */
  notice: WorkspaceNotice | undefined;
  dismissNotice: () => void;
  /** A folder is being opened. */
  opening: boolean;
  /** Several workspaces were found in the chosen folder: the person picks one. */
  choice: { folderName: string; options: NestedWorkspace[] } | undefined;
  answerChoice: (folder: string | undefined) => void;
  phase: 'loading' | 'ready' | 'error';
  error: string | undefined;
  storageLabel: string;
  connection: Connection;
  canChooseFolder: boolean;
  /** `chosen` is false when the person closed the picker without choosing. */
  chooseFolder: () => Promise<{ ok: true; chosen: boolean } | { ok: false; message: string }>;
  reconnectFolder: () => Promise<Result>;
  /** Opens a workspace that already exists in a OneDrive folder (all its customers); never creates one. */
  openWorkspaceFolder: () => Promise<
    { ok: true; chosen: boolean } | { ok: false; message: string }
  >;
  /** Copies the selected customer from browser storage into a chosen OneDrive folder, archives the browser copy and switches to the folder. */
  /** Customers still kept in browser storage while a folder is the workspace. */
  browserCustomerCount: number;
  /** Copies every customer kept in browser storage into the current folder workspace and archives the browser copies. */
  moveBrowserCustomersToFolder: () => Promise<Result>;
  moveCustomerToFolder: () => Promise<
    { ok: true; chosen: boolean } | { ok: false; message: string }
  >;
  useBrowserStorage: () => Promise<Result>;
  /** Copies a file the user added into the object's sources, target or dictionary folder. */
  saveInput: (kind: 'sources' | 'target' | 'dictionary', file: File) => Promise<Result>;
  /** The source files kept with the open object, as files, for re-attaching their rows. */
  readSources: () => Promise<File[]>;
  /** Saves the files of a run into a new folder under the open object's output folder. */
  saveOutput: (
    files: { name: string; bytes: Uint8Array }[],
    run: { startedAt: string; snapshotName: string },
  ) => Promise<{ ok: true; path: string; files: number } | { ok: false; message: string }>;
  rowsLoaded: boolean;
  markRowsLoaded: () => void;
  /** The open project was changed elsewhere; the user has to decide. */
  conflict: { message: string; hasPending: boolean } | undefined;
  resolveConflict: (choice: 'theirs' | 'mine') => Promise<void>;
  /** Changes when the open project is reloaded from disk, so the screen starts again from it. */
  openNonce: number;
  customers: CustomerEntry[];
  /** The customer whose home is shown; undefined shows All customers. */
  customerFolder: string | undefined;
  selectCustomer: (folder: string | undefined) => void;
  /** Every customer with its business objects, for the All customers page. */
  portfolio: PortfolioCustomer[];
  /** The business objects of the selected customer. */
  cards: ObjectCard[];
  search: string;
  setSearch: (s: string) => void;
  /** The Where files are kept dialog; it lives above the pages so it survives a page change. */
  storageDialog: boolean;
  setStorageDialog: (open: boolean) => void;
  objectDetail: (customerFolder: string, objectFolder: string) => Promise<ObjectFiles>;
  /** Offers the files of one saved run as a ZIP download. */
  downloadRun: (customerFolder: string, objectFolder: string, runFolder: string) => Promise<Result>;
  addCustomer: (name: string, notes: string) => Promise<Result>;
  addObject: (name: string, entity: string) => Promise<Result>;
  archiveObject: (folder: string, customerFolder?: string) => Promise<Result>;
  archiveCustomer: () => Promise<Result>;
  open: OpenObject | undefined;
  openObject: (folder: string, customerFolder?: string, stage?: Stage) => Promise<Result>;
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
  const [portfolio, setPortfolio] = useState<PortfolioCustomer[]>([]);
  const [search, setSearch] = useState('');
  const [storageDialog, setStorageDialog] = useState(false);
  const [notice, setNotice] = useState<WorkspaceNotice | undefined>();
  const [opening, setOpening] = useState(false);
  const skippedRef = useRef<{ folder: string; reason: string }[]>([]);
  const portfolioCount = useRef({ customers: 0, objects: 0 });
  const choiceResolver = useRef<((folder: string | undefined) => void) | undefined>(undefined);
  const [choice, setChoice] = useState<
    { folderName: string; options: NestedWorkspace[] } | undefined
  >();
  const [browserCustomerCount, setBrowserCustomerCount] = useState(0);
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

  /** Reads every customer and its business objects (small enough to read in one go). */
  const loadAll = useCallback(async (): Promise<CustomerEntry[]> => {
    const ctx = ctxRef.current;
    if (!ctx) return [];
    const scanned = await scanCustomers(ctx.port);
    const list = scanned.customers;
    skippedRef.current = scanned.skipped;
    const out: PortfolioCustomer[] = [];
    for (const entry of list) {
      const cards: ObjectCard[] = [];
      for (const e of await listObjects(ctx.port, entry.folder)) {
        const text = e.hasProject ? await readProject(ctx.port, entry.folder, e.folder) : undefined;
        const decoded = text === undefined ? undefined : decodeWorkspace(text);
        const runs = await listRuns(ctx.port, entry.folder, e.folder);
        let lastResult: ObjectCard['lastResult'];
        if (runs[0]) {
          const t = await ctx.port.readText([
            entry.folder,
            e.folder,
            OUTPUT_DIR,
            runs[0].folder,
            'run-summary.json',
          ]);
          try {
            const j = t === undefined ? undefined : (JSON.parse(t) as { errorCount?: unknown });
            if (typeof j?.errorCount === 'number') lastResult = { errors: j.errorCount };
          } catch {
            /* a summary that cannot be read just has no result line */
          }
        }
        cards.push({
          ...e,
          customerFolder: entry.folder,
          customerName: entry.customer.name,
          runs,
          lastRun: runs[0],
          lastResult,
          summary: decoded?.ok ? summarizeWorkspace(decoded.value) : undefined,
          problem:
            decoded && !decoded.ok ? decoded.issues.map((i) => i.message).join(' ') : undefined,
        });
      }
      out.push({ entry, cards });
    }
    setCustomers(list);
    setPortfolio(out);
    portfolioCount.current = {
      customers: list.length,
      objects: out.reduce((n, p) => n + p.cards.length, 0),
    };
    return list;
  }, []);

  const refreshCustomers = useCallback(
    async (prefer?: string): Promise<string | undefined> => {
      const list = await loadAll();
      const pick = list.find((c) => c.folder === prefer)?.folder;
      setCustomerFolder(pick);
      return pick;
    },
    [loadAll],
  );

  const openObject = useCallback(
    async (folder: string, customerOverride?: string, stage?: Stage): Promise<Result> => {
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
        stage,
      };
      openRef.current = o;
      setCustomerFolder(cf);
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

  /** Asks which of several workspaces in the chosen folder to use. */
  const askChoice = useCallback(
    (folderName: string, options: NestedWorkspace[]): Promise<string | undefined> =>
      new Promise((resolve) => {
        choiceResolver.current = resolve;
        setChoice({ folderName, options });
      }),
    [],
  );

  /**
   * Checks a folder and makes it ready as a workspace. The folder may be the workspace, or hold it one level down
   * (the real layout is often MigrationStudio/Vincit): then that workspace is used, and a person is asked only when
   * it is not clear which one. A folder with other files and no workspace in it gets a folder of its own, but only
   * when a new workspace is wanted.
   */
  const prepareRoot = useCallback(
    async (
      root: FileSystemDirectoryHandle,
      existingOnly = false,
    ): Promise<
      | { ok: true; ctx: StoreContext; handle: FileSystemDirectoryHandle; via?: string }
      | { ok: false; message: string }
    > => {
      let handle = root;
      let port = handlePort(root);
      let kind = await inspectRoot(port);
      let via: string | undefined;
      if (kind === 'customer' || kind === 'object') {
        return { ok: false, message: wrongFolderMessage(kind) };
      }
      if (kind === 'other') {
        const choice = chooseWorkspace(await findNestedWorkspaces(port));
        let folder: string | undefined;
        if (choice.kind === 'one') folder = choice.folder;
        else if (choice.kind === 'many') {
          folder = await askChoice(root.name, choice.options);
          if (!folder) return { ok: false, message: 'No workspace was chosen.' };
        }
        if (folder) {
          handle = await root.getDirectoryHandle(folder);
          port = handlePort(handle);
          kind = 'workspace';
          via = root.name;
        }
      }
      if (existingOnly && kind !== 'workspace')
        return {
          ok: false,
          message:
            kind === 'empty'
              ? 'There is no workspace in that folder. To start a new one, create a customer and choose the folder there.'
              : 'No workspace was found in that folder or in the folders inside it.',
        };
      if (kind === 'other') {
        // A folder with other files and no workspace in it: keep to a folder of our own inside it.
        handle = await root.getDirectoryHandle('Migration Mapping Studio', { create: true });
        port = handlePort(handle);
        kind = await inspectRoot(port);
        via = root.name;
        if (kind !== 'empty' && kind !== 'workspace')
          return {
            ok: false,
            message:
              'That folder has a "Migration Mapping Studio" folder that is not a workspace. Choose another folder.',
          };
      }
      const ctx: StoreContext = { port, now: nowIso, newId };
      const opened = await openWorkspace(ctx);
      return opened.ok ? { ok: true, ctx, handle, ...(via ? { via } : {}) } : opened;
    },
    [askChoice],
  );

  /** Makes `root` the workspace: creates or checks its marker, then loads the customers. */
  const connectTo = useCallback(
    async (
      root: FileSystemDirectoryHandle,
      conn: Connection,
      existingOnly = false,
    ): Promise<
      { ok: true; handle: FileSystemDirectoryHandle; via?: string } | { ok: false; message: string }
    > => {
      const prepared = await prepareRoot(root, existingOnly);
      if (!prepared.ok) return prepared;
      ctxRef.current = prepared.ctx;
      setConnection(conn.kind === 'folder' ? { kind: 'folder', name: prepared.handle.name } : conn);
      return { ok: true, handle: prepared.handle, ...(prepared.via ? { via: prepared.via } : {}) };
    },
    [prepareRoot],
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
            // Opening what was chosen before never creates anything.
            connected = await connectTo(stored, { kind: 'folder', name: stored.name }, true);
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
      existingOnly = false,
    ): Promise<Result> => {
      setOpening(true);
      setNotice(undefined);
      try {
        const r = await connectTo(root, conn, existingOnly);
        if (!r.ok) return r;
        if (remember_ && conn.kind === 'folder') {
          await saveFolderHandle(r.handle);
        } else if (conn.kind === 'browser') await forgetFolderHandle();
        permissionHandle.current = undefined;
        openRef.current = undefined;
        setOpen(undefined);
        setError(undefined);
        remember(undefined);
        await refreshCustomers();
        if (conn.kind === 'folder') {
          const name = r.handle.name;
          const where = r.via ? ` (inside “${r.via}”)` : '';
          const skipped = skippedRef.current;
          const customers = portfolioCount.current;
          const skippedText =
            skipped.length > 0
              ? ` ${skipped.length} ${skipped.length === 1 ? 'folder was' : 'folders were'} skipped: ${skipped
                  .slice(0, 4)
                  .map((x) => `${x.folder} (${x.reason})`)
                  .join(', ')}${skipped.length > 4 ? ', …' : ''}.`
              : '';
          setNotice(
            customers.customers === 0
              ? {
                  intent: 'warning',
                  text: `The workspace in the folder “${name}”${where} has no customers yet.${skippedText}`,
                }
              : {
                  intent: skipped.length > 0 ? 'warning' : 'info',
                  text: `Opened the workspace in the folder “${name}”${where}: ${customers.customers} ${customers.customers === 1 ? 'customer' : 'customers'}, ${customers.objects} business ${customers.objects === 1 ? 'object' : 'objects'}.${skippedText}`,
                },
          );
        }
        return { ok: true };
      } finally {
        setOpening(false);
      }
    },
    [connectTo, refreshCustomers],
  );

  // While a folder is the workspace, customers left in browser storage are counted, so they can be moved.
  useEffect(() => {
    if (connection.kind !== 'folder') return;
    let cancelled = false;
    void browserStorageRoot()
      .then((root) => listCustomers(handlePort(root)))
      .then((list) => {
        if (!cancelled) setBrowserCustomerCount(list.length);
      })
      .catch(() => {
        if (!cancelled) setBrowserCustomerCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, portfolio]);

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
      notice,
      dismissNotice: () => setNotice(undefined),
      opening,
      choice,
      answerChoice: (folder) => {
        choiceResolver.current?.(folder);
        choiceResolver.current = undefined;
        setChoice(undefined);
      },
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
          if (!picked) return { ok: true as const, chosen: false };
          const r = await switchTo(picked, { kind: 'folder', name: picked.name }, true);
          return r.ok ? { ok: true as const, chosen: true } : r;
        } catch (e) {
          return {
            ok: false,
            message: e instanceof Error ? e.message : 'The folder could not be opened.',
          };
        }
      },
      openWorkspaceFolder: async () => {
        try {
          const picked = await pickFolder();
          if (!picked) return { ok: true as const, chosen: false };
          const r = await switchTo(picked, { kind: 'folder', name: picked.name }, true, true);
          return r.ok ? { ok: true as const, chosen: true } : r;
        } catch (e) {
          return {
            ok: false as const,
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
        const r = await switchTo(h, { kind: 'folder', name: h.name }, true, true);
        if (r.ok) setPhase('ready');
        return r;
      },
      browserCustomerCount: connection.kind === 'folder' ? browserCustomerCount : 0,
      moveBrowserCustomersToFolder: async () => {
        const dest = ctxRef.current;
        if (!dest || connection.kind !== 'folder')
          return { ok: false as const, message: 'Choose a OneDrive folder first.' };
        try {
          const source: StoreContext = {
            port: handlePort(await browserStorageRoot()),
            now: nowIso,
            newId,
          };
          for (const c of await listCustomers(source.port)) {
            const existing = (await dest.port.list([])).map((e) => e.name);
            const target = uniqueName(c.folder, [...existing, ARCHIVE_DIR]);
            const expected = await countFiles(source.port, [c.folder]);
            await copyBetweenPorts(source.port, [c.folder], dest.port, [target]);
            if ((await countFiles(dest.port, [target])) !== expected)
              return {
                ok: false as const,
                message: `The copy of ${c.customer.name} in the folder is incomplete, so it was left in the browser.`,
              };
            const archived = await archive(source, [c.folder]);
            if (!archived.ok) return archived;
          }
          await refreshCustomers();
          return { ok: true as const };
        } catch (e) {
          return {
            ok: false as const,
            message: e instanceof Error ? e.message : 'The customers could not be moved.',
          };
        }
      },
      moveCustomerToFolder: async () => {
        const source = ctxRef.current;
        const cf = customerFolder;
        if (!source || !cf || connection.kind !== 'browser')
          return {
            ok: false as const,
            message: 'Only a customer kept in this browser can be moved to a folder.',
          };
        try {
          const picked = await pickFolder();
          if (!picked) return { ok: true as const, chosen: false };
          const prepared = await prepareRoot(picked);
          if (!prepared.ok) return prepared;
          const dest = prepared.ctx;
          const existing = (await dest.port.list([])).map((e) => e.name);
          const target = uniqueName(cf, [...existing, ARCHIVE_DIR]);
          const expected = await countFiles(source.port, [cf]);
          await copyBetweenPorts(source.port, [cf], dest.port, [target]);
          if ((await countFiles(dest.port, [target])) !== expected)
            return {
              ok: false as const,
              message: 'The copy in the folder is incomplete, so nothing was changed here.',
            };
          // The browser copy is archived, not deleted.
          const archived = await archive(source, [cf]);
          if (!archived.ok) return archived;
          ctxRef.current = dest;
          setConnection({ kind: 'folder', name: prepared.handle.name });
          await saveFolderHandle(prepared.handle);
          permissionHandle.current = undefined;
          openRef.current = undefined;
          setOpen(undefined);
          remember(undefined);
          await refreshCustomers(target);
          return { ok: true as const, chosen: true };
        } catch (e) {
          return {
            ok: false as const,
            message: e instanceof Error ? e.message : 'The customer could not be moved.',
          };
        }
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
      saveOutput: async (files, run) => {
        const ctx = ctxRef.current;
        const o = openRef.current;
        if (!ctx || !o) return { ok: false, message: 'No business object is open.' };
        try {
          const r = await saveRunOutput(ctx, o.customerFolder, o.objectFolder, run, files);
          return r.ok
            ? {
                ok: true,
                path: `${o.customerFolder}/${o.objectFolder}/output/${r.value.folder}`,
                files: r.value.files,
              }
            : { ok: false, message: r.message };
        } catch (e) {
          return {
            ok: false,
            message: e instanceof Error ? e.message : 'The files were not saved.',
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
        void loadAll();
      },
      portfolio,
      cards: portfolio.find((p) => p.entry.folder === customerFolder)?.cards ?? [],
      search,
      setSearch,
      storageDialog,
      setStorageDialog,
      downloadRun: async (cf, folder, runFolder) => {
        const ctx = ctxRef.current;
        if (!ctx) return { ok: false, message: 'The workspace is not ready.' };
        const entries: { name: string; data: Uint8Array }[] = [];
        for (const e of await ctx.port.list([cf, folder, OUTPUT_DIR, runFolder])) {
          if (e.kind !== 'file') continue;
          const data = await ctx.port.readBytes([cf, folder, OUTPUT_DIR, runFolder, e.name]);
          if (data) entries.push({ name: e.name, data });
        }
        if (entries.length === 0) return { ok: false, message: 'That run has no files.' };
        downloadFile(`${runFolder}.zip`, toZip(entries), MIME['zip']!);
        return { ok: true };
      },
      objectDetail: async (cf, folder) => {
        const ctx = ctxRef.current;
        if (!ctx) return { files: [] };
        const names = async (dir: string, kind: ObjectFiles['files'][number]['kind']) =>
          (await ctx.port.list([cf, folder, dir]))
            .filter((e) => e.kind === 'file')
            .map((e) => ({ kind, name: e.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
          files: [
            ...(await names(SOURCES_DIR, 'SOURCE')),
            ...(await names(TARGET_DIR, 'TARGET')),
            ...(await names(DICTIONARY_DIR, 'DICTIONARY')),
          ],
        };
      },
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
        await loadAll();
        return { ok: true };
      },
      archiveObject: async (folder, cf) => {
        const ctx = ctxRef.current;
        const c = cf ?? customerFolder;
        if (!ctx || !c) return { ok: false, message: 'Choose a customer first.' };
        const r = await archive(ctx, [c, folder]);
        if (!r.ok) return r;
        await loadAll();
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
      openObject: (folder, cf, stage) => openObject(folder, cf, stage),
      closeObject: async () => {
        await flush.current?.();
        await saves.current;
        openRef.current = undefined;
        setOpen(undefined);
        remember(undefined);
        await loadAll();
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
        await loadAll();
        return { ok: true };
      },
    }),
    [
      phase,
      error,
      customers,
      customerFolder,
      portfolio,
      browserCustomerCount,
      storageDialog,
      search,
      open,
      unfiled,
      connection,
      notice,
      opening,
      choice,
      rowsLoaded,
      conflict,
      openNonce,
      persist,
      switchTo,
      prepareRoot,
      loadAll,
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
