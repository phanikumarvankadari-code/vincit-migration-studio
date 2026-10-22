import {
  archive,
  createCustomer,
  createObject,
  listCustomers,
  listObjects,
  openWorkspace,
  readProject,
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

export interface WorkspaceApi {
  phase: 'loading' | 'ready' | 'error';
  error: string | undefined;
  storageLabel: string;
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
      setOpen(o);
      remember({ customer: cf, object: folder });
      return { ok: true };
    },
    [customerFolder],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const port = handlePort(await browserStorageRoot());
        const ctx: StoreContext = { port, now: nowIso, newId };
        ctxRef.current = ctx;
        const opened = await openWorkspace(ctx);
        if (!opened.ok) {
          setError(opened.message);
          setPhase('error');
          return;
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
  }, [refreshCustomers, openObject]);

  const api = useMemo<WorkspaceApi>(
    () => ({
      phase,
      error,
      storageLabel: 'This browser',
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
      persist: (text) => {
        const job = saves.current.then(async (): Promise<Result> => {
          const ctx = ctxRef.current;
          const o = openRef.current;
          if (!ctx || !o) return { ok: false, message: 'No business object is open.' };
          try {
            const r = await writeProject(
              ctx,
              o.customerFolder,
              o.objectFolder,
              text,
              revision.current,
            );
            if (!r.ok) return { ok: false, message: r.message };
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
      },
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
