import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { useState } from 'react';
import { Bar, StatusTag, currentStep, formatWhen, pctOf, STEPS } from '../components/brand';
import { useWorkspace, type ObjectCard } from '../workspace';
import {
  BrowserCustomersBanner,
  WorkspaceNoticeBar,
  ConfirmArchive,
  NewObjectDialog,
  Page,
  TopBar,
  attentionOf,
} from './shared';
import { ObjectDetail } from './ObjectDetail';

/** One customer: summary, where to continue, and its business objects. */
export function CustomerHome() {
  const ws = useWorkspace();
  const customer = ws.customers.find((c) => c.folder === ws.customerFolder)?.customer;
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<ObjectCard | undefined>();
  const [archiving, setArchiving] = useState<
    { kind: 'object'; card: ObjectCard } | { kind: 'customer' } | undefined
  >();
  const [message, setMessage] = useState<string | undefined>();
  const [moving, setMoving] = useState(false);
  const q = ws.search.trim().toLowerCase();

  const cards = ws.cards;
  const shown = cards.filter(
    (c) =>
      q === '' ||
      c.object.name.toLowerCase().includes(q) ||
      c.object.entity.toLowerCase().includes(q),
  );
  const sums = cards.map((c) => c.summary).filter((s) => s !== undefined);
  const fields = sums.reduce((n, s) => n + s.fields, 0);
  const mapped = sums.reduce((n, s) => n + s.mapped, 0);
  const runsSaved = cards.reduce((n, c) => n + c.runs.length, 0);
  const readyToRun = cards.filter((c) => c.summary && c.summary.state !== 'draft');
  const latest = [...cards].sort((a, b) => b.object.updatedAt.localeCompare(a.object.updatedAt))[0];
  const outputs = cards
    .filter((c) => c.lastRun)
    .sort((a, b) => (b.lastRun?.folder ?? '').localeCompare(a.lastRun?.folder ?? ''))
    .slice(0, 5);
  const attention = cards.map((c) => ({ c, a: attentionOf(c) })).filter((x) => x.a !== undefined);

  const run = async (p: Promise<{ ok: true } | { ok: false; message: string }>) => {
    const r = await p;
    setMessage(r.ok ? undefined : r.message);
  };

  if (!customer) return null;
  return (
    <Page>
      <TopBar search />
      <main className="mms-main">
        <WorkspaceNoticeBar />
        <BrowserCustomersBanner />
        <nav
          aria-label="Breadcrumb"
          style={{ fontSize: 14, color: 'var(--muted)', display: 'flex', gap: 8 }}
        >
          <button
            type="button"
            className="mms-link"
            style={{ fontWeight: 400, color: 'var(--brand)' }}
            onClick={() => ws.selectCustomer(undefined)}
          >
            All customers
          </button>
          <span aria-hidden="true">›</span>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{customer.name}</span>
        </nav>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: '1 1 480px', minWidth: 0 }}>
            <h1 className="mms-h1" data-testid="home-title">
              {customer.name}
            </h1>
            {customer.notes && <p className="mms-sub">{customer.notes}</p>}
          </div>
          {ws.connection.kind === 'browser' && ws.canChooseFolder && (
            <Button onClick={() => setMoving(true)}>Move to OneDrive folder</Button>
          )}
          <Button onClick={() => setArchiving({ kind: 'customer' })}>Archive customer</Button>
          <Button appearance="primary" onClick={() => setShowNew(true)}>
            Add business object
          </Button>
        </div>

        {message && (
          <MessageBar intent="error" data-testid="home-message">
            <MessageBarBody>{message}</MessageBarBody>
          </MessageBar>
        )}

        <section aria-label="Summary" className="mms-grid4">
          {[
            [
              'Business objects',
              `${cards.length}`,
              `${cards.filter((c) => c.summary?.state === 'approved').length} approved · ${cards.filter((c) => c.summary?.state === 'ready').length} ready · ${cards.filter((c) => c.summary?.state === 'draft').length} draft`,
            ],
            [
              'Fields mapped',
              `${pctOf(mapped, fields)}%`,
              fields ? `${mapped} of ${fields} fields` : 'No target fields yet',
            ],
            [
              'Ready to run',
              `${readyToRun.length}`,
              readyToRun.length
                ? readyToRun.map((c) => c.object.name).join(', ')
                : 'Mark a snapshot Ready',
            ],
            ['Runs saved', `${runsSaved}`, 'in the output folders'],
          ].map(([label, value, note]) => (
            <div key={label} className="mms-kpi" data-testid={`kpi-${label}`}>
              <div className="mms-muted" style={{ fontSize: 13 }}>
                {label}
              </div>
              <div className="v">{value}</div>
              <div className="mms-muted" style={{ fontSize: 13, marginTop: 2 }}>
                {note}
              </div>
            </div>
          ))}
        </section>

        {latest && (
          <section
            className="mms-panel"
            data-testid="continue-panel"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 20,
              padding: '20px 24px',
            }}
          >
            <div style={{ flex: '1 1 360px', minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                }}
              >
                Continue where you left off
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6 }}>
                {latest.object.name} · {STEPS[currentStep(latest.summary)]} step
              </div>
              <div className="mms-muted" style={{ fontSize: 14, marginTop: 2 }}>
                {latest.summary && latest.summary.fields > 0
                  ? `${latest.summary.mapped} of ${latest.summary.fields} fields mapped · `
                  : ''}
                last changed {formatWhen(latest.object.updatedAt)}
              </div>
            </div>
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Bar
                pct={pctOf(latest.summary?.mapped ?? 0, latest.summary?.fields ?? 0)}
                style={{ height: 8 }}
              />
              <div className="mms-muted" style={{ fontSize: 12 }}>
                {pctOf(latest.summary?.mapped ?? 0, latest.summary?.fields ?? 0)}% mapped
              </div>
            </div>
            <Button
              appearance="primary"
              size="large"
              onClick={() => void run(ws.openObject(latest.folder, latest.customerFolder))}
            >
              Resume
            </Button>
          </section>
        )}

        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              paddingBottom: 12,
            }}
          >
            <h2 className="mms-h2">Business objects</h2>
            <span className="mms-muted" style={{ fontSize: 13 }}>
              {cards.length} {cards.length === 1 ? 'object' : 'objects'}
            </span>
          </div>
          {cards.length === 0 ? (
            <div className="mms-panel" style={{ padding: 28 }} data-testid="no-objects">
              <div style={{ fontWeight: 600, fontSize: 16 }}>No business objects yet</div>
              <p className="mms-muted" style={{ margin: '6px 0 14px' }}>
                A business object is one thing you migrate, for example Profit Center or Vendor.
              </p>
              <Button appearance="primary" onClick={() => setShowNew(true)}>
                Add business object
              </Button>
            </div>
          ) : (
            <div className="mms-panel mms-scroll">
              <table className="mms-table" aria-label="Business objects">
                <thead>
                  <tr>
                    <th scope="col">Business object</th>
                    <th scope="col">Status</th>
                    <th scope="col">Stage</th>
                    <th scope="col" style={{ width: 200 }}>
                      Fields mapped
                    </th>
                    <th scope="col">Last output</th>
                    <th scope="col">Changed</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const sum = c.summary;
                    return (
                      <tr
                        key={c.folder}
                        className="mms-row"
                        data-testid={`object-${c.object.name}`}
                      >
                        <td>
                          <button type="button" className="mms-link" onClick={() => setDetail(c)}>
                            {c.object.name}
                          </button>
                          <div className="mms-muted" style={{ fontSize: 12, marginTop: 2 }}>
                            {c.object.entity}
                          </div>
                        </td>
                        <td>
                          {sum ? (
                            <StatusTag
                              state={sum.state}
                              testId={`object-status-${c.object.name}`}
                            />
                          ) : (
                            <span className="mms-muted">Unreadable</span>
                          )}
                        </td>
                        <td style={{ color: 'var(--ink-2)' }}>{STEPS[currentStep(sum)]}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Bar
                              pct={pctOf(sum?.mapped ?? 0, sum?.fields ?? 0)}
                              color={sum?.state === 'approved' ? '#1E8A52' : 'var(--brand)'}
                              style={{ flex: 1 }}
                            />
                            <span
                              style={{ fontSize: 12, width: 72 }}
                              data-testid={`object-summary-${c.object.name}`}
                            >
                              {sum && sum.fields > 0
                                ? `${sum.mapped} of ${sum.fields}`
                                : 'No target'}
                            </span>
                          </div>
                        </td>
                        <td className="mms-muted" data-testid={`object-lastrun-${c.object.name}`}>
                          {c.lastRun
                            ? `${c.lastRun.folder} · ${c.lastRun.files} files`
                            : 'No output yet'}
                        </td>
                        <td className="mms-muted">{formatWhen(c.object.updatedAt)}</td>
                        <td className="mms-row-actions">
                          <Button
                            size="small"
                            aria-label={`Open ${c.object.name}`}
                            onClick={() => void run(ws.openObject(c.folder))}
                          >
                            Open
                          </Button>{' '}
                          <Menu>
                            <MenuTrigger disableButtonEnhancement>
                              <Button size="small" aria-label={`More actions for ${c.object.name}`}>
                                ⋯
                              </Button>
                            </MenuTrigger>
                            <MenuPopover>
                              <MenuList>
                                <MenuItem onClick={() => setDetail(c)}>Details</MenuItem>
                                <MenuItem onClick={() => setArchiving({ kind: 'object', card: c })}>
                                  Archive
                                </MenuItem>
                              </MenuList>
                            </MenuPopover>
                          </Menu>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="mms-muted">
                        No business objects match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <section style={{ flex: '1.4 1 520px', minWidth: 0 }}>
            <h2 className="mms-h2" style={{ marginBottom: 12 }}>
              Latest outputs
            </h2>
            <div className="mms-panel" data-testid="latest-outputs">
              {outputs.length === 0 && (
                <div className="mms-muted" style={{ padding: '16px 20px', fontSize: 14 }}>
                  No outputs saved yet. Run a snapshot that is marked Ready to create files.
                </div>
              )}
              {outputs.map((c, i) => (
                <div
                  key={c.folder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '14px 20px',
                    borderTop: i === 0 ? 'none' : '1px solid #ECEEE5',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.object.name}</div>
                    <div
                      className="mms-muted"
                      style={{ fontSize: 12, marginTop: 2, wordBreak: 'break-all' }}
                    >
                      {c.lastRun?.folder} · {c.lastRun?.files} files
                    </div>
                  </div>
                  {c.lastResult && (
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: c.lastResult.errors === 0 ? '#12603A' : '#8A4B00',
                      }}
                    >
                      {c.lastResult.errors === 0 ? 'No errors' : `${c.lastResult.errors} errors`}
                    </span>
                  )}
                  <Button
                    size="small"
                    aria-label={`Download ${c.object.name} output as ZIP`}
                    onClick={() =>
                      c.lastRun &&
                      void run(ws.downloadRun(c.customerFolder, c.folder, c.lastRun.folder))
                    }
                  >
                    Download ZIP
                  </Button>
                </div>
              ))}
            </div>
          </section>
          <section style={{ flex: '1 1 360px', minWidth: 0 }}>
            <h2 className="mms-h2" style={{ marginBottom: 12 }}>
              Needs attention
            </h2>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              data-testid="attention"
            >
              {attention.length === 0 && (
                <div className="mms-muted" style={{ fontSize: 14 }}>
                  Nothing needs attention.
                </div>
              )}
              {attention.map(({ c, a }) => (
                <div
                  key={c.folder}
                  style={{
                    background: '#FFF8EC',
                    border: '1px solid #F0D9AE',
                    borderRadius: 10,
                    padding: '14px 18px',
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#5C3B00' }}>
                      {a!.title}
                    </div>
                    <div style={{ fontSize: 13, color: '#6B5427', marginTop: 2 }}>{a!.text}</div>
                  </div>
                  <Button
                    size="small"
                    onClick={() =>
                      a!.action === 'Details' ? setDetail(c) : void run(ws.openObject(c.folder))
                    }
                  >
                    {a!.action}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {ws.unfiled.length > 0 && (
          <section
            className="mms-panel"
            data-testid="unfiled"
            style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <h2 className="mms-h2">Unfiled projects in this browser</h2>
            <p className="mms-muted" style={{ margin: 0, fontSize: 14 }}>
              Saved before customers existed. Move one into {customer.name} to keep working on it
              here. Source rows were never saved, so add its files again.
            </p>
            {ws.unfiled.map((u) => (
              <div
                key={u.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
              >
                <span>
                  {u.name} <span className="mms-muted">({u.businessEntity})</span>
                </span>
                <Button
                  size="small"
                  aria-label={`Move ${u.name} into ${customer.name}`}
                  onClick={() => void run(ws.moveUnfiled(u.id))}
                >
                  Move into {customer.name}
                </Button>
              </div>
            ))}
          </section>
        )}
      </main>

      <Dialog open={moving} onOpenChange={(_, d) => !d.open && setMoving(false)}>
        <DialogSurface aria-label="Move to OneDrive folder">
          <DialogBody>
            <DialogTitle>Move {customer.name} to a OneDrive folder?</DialogTitle>
            <DialogContent>
              Choose a folder inside your synced OneDrive. Every business object, source file and
              output of {customer.name} is copied there. The copy is checked, and only then is the
              browser copy moved to the browser's archive. Nothing is deleted.
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => {
                  setMoving(false);
                  void run(ws.moveCustomerToFolder());
                }}
              >
                Choose folder and move
              </Button>
              <Button onClick={() => setMoving(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <NewObjectDialog open={showNew} onClose={() => setShowNew(false)} />
      {detail && <ObjectDetail card={detail} onClose={() => setDetail(undefined)} />}
      <ConfirmArchive
        name={
          archiving
            ? archiving.kind === 'object'
              ? archiving.card.object.name
              : customer.name
            : undefined
        }
        onCancel={() => setArchiving(undefined)}
        onConfirm={() => {
          const a = archiving;
          setArchiving(undefined);
          if (a?.kind === 'object')
            void run(ws.archiveObject(a.card.folder, a.card.customerFolder));
          else if (a?.kind === 'customer') void run(ws.archiveCustomer());
        }}
      />
    </Page>
  );
}
