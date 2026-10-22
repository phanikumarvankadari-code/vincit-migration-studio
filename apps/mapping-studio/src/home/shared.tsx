import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  Text,
} from '@fluentui/react-components';
import { useState, type ReactNode } from 'react';
import { Brand } from '../components/brand';
import { useWorkspace, type ObjectCard } from '../workspace';

/** Result of an action: ok, or a message to show. */
export type Outcome = { ok: true } | { ok: false; message: string };

/** What the storage chip says. */
export function storageText(c: ReturnType<typeof useWorkspace>['connection']): string {
  return c.kind === 'browser'
    ? 'This browser'
    : c.kind === 'folder'
      ? `OneDrive folder “${c.name}”`
      : `Folder “${c.name}” (reconnect)`;
}

/** Things a person should look at on a business object. */
export function attentionOf(
  card: ObjectCard,
): { title: string; text: string; action: string } | undefined {
  if (card.problem)
    return {
      title: `${card.object.name}: the project file cannot be read`,
      text: card.problem,
      action: 'Details',
    };
  if (card.summary && card.summary.datasets === 0)
    return {
      title: `${card.object.name} has no source files`,
      text: 'Add the CSV or Excel files to start mapping.',
      action: 'Add files',
    };
  return undefined;
}

export function StorageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [message, setMessage] = useState<string | undefined>();
  const run = async (p: Promise<{ ok: true } | { ok: false; message: string }>) => {
    const r = await p;
    setMessage(r.ok ? undefined : r.message);
    if (r.ok) onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface aria-label="Where files are kept">
        <DialogBody>
          <DialogTitle>Where files are kept</DialogTitle>
          <DialogContent>
            <Text block>
              Now: <b>{storageText(ws.connection)}</b>
            </Text>
            <Text block style={{ marginTop: 8, color: 'var(--muted)' }}>
              A OneDrive folder is shared with your team and keeps version history. Browser storage
              stays on this computer. Customers kept in one place are not copied to the other.
            </Text>
            {message && (
              <MessageBar intent="error" data-testid="storage-message" style={{ marginTop: 12 }}>
                <MessageBarBody>{message}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            {ws.canChooseFolder && (
              <Button appearance="primary" onClick={() => void run(ws.chooseFolder())}>
                Choose OneDrive folder
              </Button>
            )}
            {ws.connection.kind !== 'browser' && (
              <Button onClick={() => void run(ws.useBrowserStorage())}>Use browser storage</Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** The header of the workspace pages: logo, name, storage place and an optional search box. */
export function TopBar({ search = false }: { search?: boolean }) {
  const ws = useWorkspace();
  const dot = ws.connection.kind === 'folder' ? '#1E8A52' : '#8A8F9C';
  return (
    <header className="mms-topbar">
      <Brand />
      <div style={{ flex: 1 }} />
      <button
        type="button"
        data-testid="storage-label"
        onClick={() => ws.setStorageDialog(true)}
        title="Change where files are kept"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--muted)',
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '7px 12px',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        <span className="mms-dot" style={{ background: dot }} />
        Files kept in: {storageText(ws.connection)}
      </button>
      {search && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#fff',
            border: '1px solid #d5d8cd',
            borderRadius: 6,
            padding: '0 12px',
            height: 38,
            minWidth: 240,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="#565B68" strokeWidth="1.6" />
            <path d="M11 11l3.5 3.5" stroke="#565B68" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            aria-label="Search"
            placeholder="Search"
            value={ws.search}
            onChange={(e) => ws.setSearch(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 14,
              width: '100%',
              outline: 'none',
            }}
          />
        </label>
      )}
    </header>
  );
}

export function Page({ children, testId = 'home' }: { children: ReactNode; testId?: string }) {
  return (
    <div className="mms-page" data-testid={testId}>
      {children}
    </div>
  );
}

export function ConfirmArchive({
  name,
  onConfirm,
  onCancel,
}: {
  name: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={name !== undefined} onOpenChange={(_, d) => !d.open && onCancel()}>
      <DialogSurface aria-label="Archive">
        <DialogBody>
          <DialogTitle>Archive {name}?</DialogTitle>
          <DialogContent>
            The folder is moved into the workspace's _archive folder, with all its files. Nothing is
            deleted.
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onConfirm}>
              Archive
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function FormDialog({
  open,
  title,
  submit,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  submit: string;
  onClose: () => void;
  onSubmit: () => Promise<Outcome>;
  children: ReactNode;
}) {
  const [message, setMessage] = useState<string | undefined>();
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface aria-label={title}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
            {message && (
              <MessageBar intent="error" data-testid="dialog-message" style={{ marginTop: 12 }}>
                <MessageBarBody>{message}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={async () => {
                const r = await onSubmit();
                if (r.ok) {
                  setMessage(undefined);
                  onClose();
                } else setMessage(r.message);
              }}
            >
              {submit}
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function NewCustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <FormDialog
      open={open}
      title="New customer"
      submit="Create customer"
      onClose={onClose}
      onSubmit={async () => {
        const r = await ws.addCustomer(name, notes);
        if (r.ok) {
          setName('');
          setNotes('');
        }
        return r;
      }}
    >
      <label>
        <Text block>Customer name</Text>
        <Input aria-label="Customer name" value={name} onChange={(_, d) => setName(d.value)} />
      </label>
      <label>
        <Text block>Notes (optional)</Text>
        <Input aria-label="Customer notes" value={notes} onChange={(_, d) => setNotes(d.value)} />
      </label>
    </FormDialog>
  );
}

export function NewObjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [entity, setEntity] = useState('');
  return (
    <FormDialog
      open={open}
      title="Add a business object"
      submit="Create business object"
      onClose={onClose}
      onSubmit={async () => {
        const r = await ws.addObject(name, entity);
        if (r.ok) {
          setName('');
          setEntity('');
        }
        return r;
      }}
    >
      <label>
        <Text block>Business object name</Text>
        <Input
          aria-label="Business object name"
          value={name}
          onChange={(_, d) => setName(d.value)}
        />
      </label>
      <label>
        <Text block>Business entity</Text>
        <Input
          aria-label="Business entity"
          placeholder="same as the name"
          value={entity}
          onChange={(_, d) => setEntity(d.value)}
        />
      </label>
    </FormDialog>
  );
}

/** Offered while a folder is the workspace but customers are still kept in this browser. */
export function BrowserCustomersBanner() {
  const ws = useWorkspace();
  const [message, setMessage] = useState<string | undefined>();
  if (ws.connection.kind !== 'folder' || ws.browserCustomerCount === 0) return null;
  const n = ws.browserCustomerCount;
  return (
    <MessageBar intent="warning" data-testid="browser-customers-banner" layout="multiline">
      <MessageBarBody>
        {n} {n === 1 ? 'customer is' : 'customers are'} still kept in this browser, not in the
        folder “{ws.connection.name}”. Move {n === 1 ? 'it' : 'them'} into the folder to work on{' '}
        {n === 1 ? 'it' : 'them'} here.
        {message ? ` ${message}` : ''}
      </MessageBarBody>
      <Button
        size="small"
        onClick={async () => {
          const r = await ws.moveBrowserCustomersToFolder();
          setMessage(r.ok ? undefined : r.message);
        }}
      >
        Move {n === 1 ? 'it' : 'them'} to the folder
      </Button>
    </MessageBar>
  );
}
