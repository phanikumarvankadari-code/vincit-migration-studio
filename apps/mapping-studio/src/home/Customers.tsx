import { Button, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { useState } from 'react';
import { Bar, StatusTag, Tag, formatWhen, pctOf } from '../components/brand';
import { useWorkspace, type ObjectCard, type PortfolioCustomer } from '../workspace';
import {
  BrowserCustomersBanner,
  OpenWorkspaceButton,
  Page,
  TopBar,
  attentionOf,
  storageText,
} from './shared';
import { ObjectDetail } from './ObjectDetail';

const TILES = [
  ['#E5EAFB', '#1F3A8A'],
  ['#DFF1EE', '#0B5A52'],
  ['#FBE7DD', '#8A3B16'],
  ['#ECEEF2', '#3F4655'],
];

interface Stats {
  p: PortfolioCustomer;
  objects: number;
  pct: number;
  draft: number;
  ready: number;
  approved: number;
  changed: string;
  attention: number;
  runs: number;
}

function statsOf(p: PortfolioCustomer): Stats {
  const sums = p.cards.map((c) => c.summary).filter((s) => s !== undefined);
  const fields = sums.reduce((n, s) => n + s.fields, 0);
  const mapped = sums.reduce((n, s) => n + s.mapped, 0);
  const count = (st: string) => sums.filter((s) => s.state === st).length;
  return {
    p,
    objects: p.cards.length,
    pct: pctOf(mapped, fields),
    draft: p.cards.length - count('ready') - count('approved'),
    ready: count('ready'),
    approved: count('approved'),
    changed:
      p.cards
        .map((c) => c.object.updatedAt)
        .sort()
        .at(-1) ?? p.entry.customer.createdAt,
    attention: p.cards.filter((c) => attentionOf(c) !== undefined).length,
    runs: p.cards.reduce((n, c) => n + c.runs.length, 0),
  };
}

/** All customers: cards, and every project across them. */
export function Customers({ onNewCustomer }: { onNewCustomer: () => void }) {
  const ws = useWorkspace();
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [openMessage, setOpenMessage] = useState<string | undefined>();
  const [sort, setSort] = useState<'recent' | 'name' | 'least'>('recent');
  const [detail, setDetail] = useState<ObjectCard | undefined>();
  const q = ws.search.trim().toLowerCase();

  const all = ws.portfolio.map(statsOf);
  const shown = all
    .filter((s) => (filter === 'attention' ? s.attention > 0 : true))
    .filter(
      (s) =>
        q === '' ||
        s.p.entry.customer.name.toLowerCase().includes(q) ||
        s.p.cards.some((c) => c.object.name.toLowerCase().includes(q)),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.p.entry.customer.name.localeCompare(b.p.entry.customer.name)
        : sort === 'least'
          ? a.pct - b.pct
          : b.changed.localeCompare(a.changed),
    );
  const objects = all.reduce((n, s) => n + s.objects, 0);
  const runs = all.reduce((n, s) => n + s.runs, 0);
  const projects = ws.portfolio
    .flatMap((p) => p.cards)
    .filter(
      (c) =>
        q === '' ||
        c.object.name.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q),
    )
    .sort((a, b) => b.object.updatedAt.localeCompare(a.object.updatedAt));
  const attentionCount = all.filter((s) => s.attention > 0).length;

  return (
    <Page>
      <TopBar search />
      <main className="mms-main">
        <BrowserCustomersBanner />
        {openMessage && (
          <MessageBar intent="error" data-testid="open-workspace-message">
            <MessageBarBody>{openMessage}</MessageBarBody>
          </MessageBar>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 20 }}>
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <h1 className="mms-h1" data-testid="home-title">
              Customers
            </h1>
            <p className="mms-sub" data-testid="portfolio-summary">
              {all.length} {all.length === 1 ? 'customer' : 'customers'} · {objects} business{' '}
              {objects === 1 ? 'object' : 'objects'} · {runs} {runs === 1 ? 'run' : 'runs'} saved
            </p>
          </div>
          <OpenWorkspaceButton onMessage={setOpenMessage} />
          <Button appearance="primary" onClick={() => onNewCustomer()}>
            New customer
          </Button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {(
            [
              ['all', `All (${all.length})`],
              ['attention', `Needs attention (${attentionCount})`],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              appearance={filter === v ? 'primary' : 'outline'}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
            >
              {label}
            </Button>
          ))}
          <div style={{ flex: 1 }} />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'var(--muted)',
            }}
          >
            Sort by
            <select
              aria-label="Sort customers"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              style={{
                height: 34,
                borderRadius: 6,
                border: '1px solid var(--line-strong)',
                background: '#fff',
                fontSize: 14,
                padding: '0 10px',
              }}
            >
              <option value="recent">Recently changed</option>
              <option value="name">Name</option>
              <option value="least">Least mapped</option>
            </select>
          </label>
        </div>

        <section className="mms-cards" aria-label="Customers">
          {shown.map((s, i) => {
            const [bg, fg] = TILES[i % TILES.length]!;
            const c = s.p.entry.customer;
            return (
              <button
                key={s.p.entry.folder}
                type="button"
                className="mms-card"
                data-testid={`customer-${c.name}`}
                aria-label={`Open customer ${c.name}`}
                onClick={() => ws.selectCustomer(s.p.entry.folder)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      background: bg,
                      color: fg,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 18,
                      flex: 'none',
                    }}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{c.name}</div>
                    <div className="mms-muted" style={{ fontSize: 12 }}>
                      {storageText(ws.connection)}
                    </div>
                  </div>
                  {s.attention > 0 && (
                    <Tag bg="#FDEBD9" color="#7A3A00" testId={`customer-attention-${c.name}`}>
                      {s.attention} to check
                    </Tag>
                  )}
                </div>
                <div
                  className="mms-muted"
                  style={{ fontSize: 13, lineHeight: 1.45, minHeight: 38 }}
                >
                  {c.notes ?? 'No notes.'}
                </div>
                <div style={{ width: '100%' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      color: 'var(--ink-2)',
                      marginBottom: 6,
                    }}
                  >
                    <span data-testid={`customer-objects-${c.name}`}>
                      {s.objects} business {s.objects === 1 ? 'object' : 'objects'}
                    </span>
                    <span>{s.pct}% mapped</span>
                  </div>
                  <Bar pct={s.pct} />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Tag bg="#EEF0F4" color="#3F4655">
                    {s.draft} draft
                  </Tag>
                  <Tag bg="#FFF1CC" color="#6B4700">
                    {s.ready} ready
                  </Tag>
                  <Tag bg="#DDF3E7" color="#12603A">
                    {s.approved} approved
                  </Tag>
                </div>
                <div
                  className="mms-muted"
                  style={{
                    fontSize: 12,
                    borderTop: '1px solid #ECEEE5',
                    paddingTop: 12,
                    width: '100%',
                  }}
                >
                  Changed {formatWhen(s.changed)}
                </div>
              </button>
            );
          })}
          {q === '' && filter === 'all' && (
            <button
              type="button"
              onClick={() => onNewCustomer()}
              style={{
                minHeight: 240,
                background: 'transparent',
                border: '1.5px dashed #B9BEAE',
                borderRadius: 10,
                color: 'var(--ink-2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
                font: 'inherit',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: '#E9ECE0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  color: 'var(--brand)',
                }}
              >
                +
              </span>
              Add a customer
            </button>
          )}
        </section>
        {shown.length === 0 && (
          <p className="mms-muted" data-testid="no-customers-match">
            No customers match.
          </p>
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
            <h2 className="mms-h2">All projects</h2>
            <span className="mms-muted" style={{ fontSize: 13 }}>
              Every business object across customers
            </span>
          </div>
          <div className="mms-panel mms-scroll">
            <table className="mms-table" aria-label="All projects">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ width: 220 }}>
                    Fields mapped
                  </th>
                  <th scope="col">Last output</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((c) => (
                  <tr
                    key={`${c.customerFolder}/${c.folder}`}
                    className="mms-row"
                    data-testid={`project-${c.customerName}-${c.object.name}`}
                  >
                    <td>
                      <button type="button" className="mms-link" onClick={() => setDetail(c)}>
                        {c.object.name}
                      </button>
                    </td>
                    <td>{c.customerName}</td>
                    <td>
                      {c.summary ? (
                        <StatusTag state={c.summary.state} />
                      ) : (
                        <span className="mms-muted">Unreadable</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Bar
                          pct={pctOf(c.summary?.mapped ?? 0, c.summary?.fields ?? 0)}
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: 12, width: 40 }}>
                          {pctOf(c.summary?.mapped ?? 0, c.summary?.fields ?? 0)}%
                        </span>
                      </div>
                    </td>
                    <td className="mms-muted">
                      {c.lastRun
                        ? `${c.lastRun.folder} · ${c.lastRun.files} files`
                        : 'No output yet'}
                    </td>
                    <td className="mms-muted">{formatWhen(c.object.updatedAt)}</td>
                  </tr>
                ))}
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={6} className="mms-muted" data-testid="no-projects">
                      No projects yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      {detail && <ObjectDetail card={detail} onClose={() => setDetail(undefined)} />}
    </Page>
  );
}
