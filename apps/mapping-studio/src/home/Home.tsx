import {
  Badge,
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
  Select,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import { useWorkspace, type ObjectCard } from '../workspace';

const useStyles = makeStyles({
  page: {
    minHeight: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL}`,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  body: {
    maxWidth: '1100px',
    margin: '0 auto',
    padding: tokens.spacingVerticalXL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  box: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  row: { display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'end', flexWrap: 'wrap' },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

const STATE_LABEL = { draft: 'Draft', ready: 'Ready', approved: 'Approved' } as const;
const STATE_COLOR = { draft: 'informative', ready: 'warning', approved: 'success' } as const;

function CardView({
  card,
  onOpen,
  onArchive,
}: {
  card: ObjectCard;
  onOpen: () => void;
  onArchive: () => void;
}) {
  const s = useStyles();
  const sum = card.summary;
  return (
    <div className={s.card} data-testid={`object-${card.object.name}`}>
      <div className={s.row} style={{ alignItems: 'center' }}>
        <Text weight="semibold" size={400}>
          {card.object.name}
        </Text>
        <Badge appearance="outline">{card.object.entity}</Badge>
        {sum && (
          <Badge
            appearance="tint"
            color={STATE_COLOR[sum.state]}
            data-testid={`object-status-${card.object.name}`}
          >
            {STATE_LABEL[sum.state]}
          </Badge>
        )}
      </div>
      {card.problem ? (
        <Text className={s.muted}>The project file could not be read: {card.problem}</Text>
      ) : sum ? (
        <Text className={s.muted} data-testid={`object-summary-${card.object.name}`}>
          {sum.fields === 0 ? 'No target yet' : `${sum.mapped} of ${sum.fields} fields mapped`}
          {' · '}
          {sum.datasets} {sum.datasets === 1 ? 'dataset' : 'datasets'}
          {' · '}
          {sum.snapshots} {sum.snapshots === 1 ? 'snapshot' : 'snapshots'}
        </Text>
      ) : (
        <Text className={s.muted}>No project saved yet</Text>
      )}
      <Text size={200} className={s.muted} data-testid={`object-lastrun-${card.object.name}`}>
        {card.lastRun
          ? `Last output: ${card.lastRun.folder} (${card.lastRun.files} files)`
          : 'No output saved yet'}
      </Text>
      <Text size={200} className={s.muted}>
        Changed {new Date(card.object.updatedAt).toLocaleString()}
      </Text>
      <div className={s.row}>
        <Button appearance="primary" onClick={onOpen}>
          Open
        </Button>
        <Button onClick={onArchive} aria-label={`Archive ${card.object.name}`}>
          Archive
        </Button>
      </div>
    </div>
  );
}

/** The main page: one customer, and inside it one entry per business object. */
export function Home() {
  const s = useStyles();
  const ws = useWorkspace();
  const [customerName, setCustomerName] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [objectName, setObjectName] = useState('');
  const [entity, setEntity] = useState('');
  const [message, setMessage] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<
    | { kind: 'object'; folder: string; name: string }
    | { kind: 'customer'; name: string }
    | undefined
  >();
  const customer = ws.customers.find((c) => c.folder === ws.customerFolder)?.customer;

  const run = async (p: Promise<{ ok: true } | { ok: false; message: string }>) => {
    const r = await p;
    setMessage(r.ok ? undefined : r.message);
    return r.ok;
  };

  if (ws.phase === 'loading')
    return (
      <div className={s.page}>
        <Spinner label="Opening the workspace" style={{ paddingTop: 80 }} />
      </div>
    );

  return (
    <div className={s.page} data-testid="home">
      <header className={s.header}>
        <div>
          <Text size={200} block>
            Migration Mapping Studio
          </Text>
          <Text as="h1" size={600} weight="semibold" data-testid="home-title">
            {customer ? customer.name : 'Customers'}
          </Text>
        </div>
        <div className={s.row} style={{ marginLeft: 'auto', alignItems: 'center' }}>
          <Text size={200} style={{ color: 'inherit' }} data-testid="storage-label">
            Files kept in: {ws.storageLabel}
          </Text>
          {ws.canChooseFolder && (
            <Button
              size="small"
              appearance="outline"
              style={{ color: 'inherit', borderColor: 'rgba(255,255,255,0.6)' }}
              onClick={() => void run(ws.chooseFolder())}
            >
              Choose OneDrive folder
            </Button>
          )}
          {ws.connection.kind !== 'browser' && (
            <Button
              size="small"
              appearance="outline"
              style={{ color: 'inherit', borderColor: 'rgba(255,255,255,0.6)' }}
              onClick={() => void run(ws.useBrowserStorage())}
            >
              Use browser storage
            </Button>
          )}
        </div>
      </header>
      <div className={s.body}>
        {ws.phase === 'error' && (
          <MessageBar intent="error" data-testid="workspace-error">
            <MessageBarBody>{ws.error}</MessageBarBody>
          </MessageBar>
        )}
        {message && (
          <MessageBar intent="error" data-testid="home-message">
            <MessageBarBody>{message}</MessageBarBody>
          </MessageBar>
        )}

        {ws.connection.kind === 'needsPermission' ? (
          <div className={s.box} data-testid="reconnect">
            <Text size={500} weight="semibold">
              Reconnect your folder
            </Text>
            <Text className={s.muted}>
              The browser needs your permission again to use the folder “{ws.connection.name}”. Your
              files in it are untouched.
            </Text>
            <div className={s.row}>
              <Button appearance="primary" onClick={() => void run(ws.reconnectFolder())}>
                Reconnect folder
              </Button>
              <Button onClick={() => void run(ws.useBrowserStorage())}>
                Use browser storage instead
              </Button>
            </div>
          </div>
        ) : ws.customers.length === 0 ? (
          <div className={s.box}>
            <Text size={500} weight="semibold">
              Create your first customer
            </Text>
            <Text className={s.muted}>
              A customer holds all the business objects you migrate for them.
            </Text>
          </div>
        ) : (
          <div className={s.box}>
            <div className={s.row}>
              <label>
                <Text block>Customer</Text>
                <Select
                  aria-label="Customer"
                  value={ws.customerFolder ?? ''}
                  onChange={(_, d) => ws.selectCustomer(d.value)}
                >
                  {ws.customers.map((c) => (
                    <option key={c.folder} value={c.folder}>
                      {c.customer.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                onClick={() => customer && setConfirm({ kind: 'customer', name: customer.name })}
              >
                Archive customer
              </Button>
            </div>
            {customer?.notes && <Text className={s.muted}>{customer.notes}</Text>}
          </div>
        )}

        {ws.connection.kind !== 'needsPermission' && (
          <div className={s.box}>
            <Text weight="semibold">
              {ws.customers.length === 0 ? 'New customer' : 'Add a customer'}
            </Text>
            <div className={s.row}>
              <label>
                <Text block>Customer name</Text>
                <Input
                  aria-label="Customer name"
                  value={customerName}
                  onChange={(_, d) => setCustomerName(d.value)}
                />
              </label>
              <label>
                <Text block>Notes (optional)</Text>
                <Input
                  aria-label="Customer notes"
                  value={customerNotes}
                  onChange={(_, d) => setCustomerNotes(d.value)}
                />
              </label>
              <Button
                appearance={ws.customers.length === 0 ? 'primary' : 'secondary'}
                onClick={async () => {
                  if (await run(ws.addCustomer(customerName, customerNotes))) {
                    setCustomerName('');
                    setCustomerNotes('');
                  }
                }}
              >
                Create customer
              </Button>
            </div>
          </div>
        )}

        {customer && (
          <>
            <div className={s.box}>
              <Text weight="semibold">Add a business object</Text>
              <div className={s.row}>
                <label>
                  <Text block>Business object name</Text>
                  <Input
                    aria-label="Business object name"
                    value={objectName}
                    onChange={(_, d) => setObjectName(d.value)}
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
                <Button
                  appearance="primary"
                  onClick={async () => {
                    if (await run(ws.addObject(objectName, entity))) {
                      setObjectName('');
                      setEntity('');
                    }
                  }}
                >
                  Add business object
                </Button>
              </div>
            </div>

            <Text size={500} weight="semibold">
              Business objects of {customer.name}
            </Text>
            {ws.cards.length === 0 ? (
              <Text className={s.muted} data-testid="no-objects">
                No business objects yet. Add the first one above.
              </Text>
            ) : (
              <div className={s.cards}>
                {ws.cards.map((c) => (
                  <CardView
                    key={c.folder}
                    card={c}
                    onOpen={() => void run(ws.openObject(c.folder))}
                    onArchive={() =>
                      setConfirm({ kind: 'object', folder: c.folder, name: c.object.name })
                    }
                  />
                ))}
              </div>
            )}

            {ws.unfiled.length > 0 && (
              <div className={s.box} data-testid="unfiled">
                <Text weight="semibold">Unfiled projects in this browser</Text>
                <Text className={s.muted}>
                  Saved before customers existed. Move one into {customer.name} to keep working on
                  it here. Source rows were never saved, so add its files again.
                </Text>
                {ws.unfiled.map((u) => (
                  <div key={u.id} className={s.row} style={{ alignItems: 'center' }}>
                    <Text>
                      {u.name} <span className={s.muted}>({u.businessEntity})</span>
                    </Text>
                    <Button
                      size="small"
                      aria-label={`Move ${u.name} into ${customer.name}`}
                      onClick={() => void run(ws.moveUnfiled(u.id))}
                    >
                      Move into {customer.name}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={confirm !== undefined}
        onOpenChange={(_, d) => !d.open && setConfirm(undefined)}
      >
        <DialogSurface aria-label="Archive">
          <DialogBody>
            <DialogTitle>Archive {confirm?.name}?</DialogTitle>
            <DialogContent>
              The folder is moved into the workspace's _archive folder, with all its files. Nothing
              is deleted.
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => {
                  const c = confirm;
                  setConfirm(undefined);
                  if (c?.kind === 'object') void run(ws.archiveObject(c.folder));
                  else if (c?.kind === 'customer') void run(ws.archiveCustomer());
                }}
              >
                Archive
              </Button>
              <Button onClick={() => setConfirm(undefined)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
