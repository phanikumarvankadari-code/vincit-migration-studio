import {
  Button,
  Dialog,
  DialogBody,
  DialogSurface,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { LOGO_SRC, STEPS, StatusTag, currentStep, formatWhen } from '../components/brand';
import { useWorkspace, type ObjectCard, type ObjectFiles } from '../workspace';
import { ConfirmArchive } from './shared';

const box = { border: '1px solid var(--line)', borderRadius: 8, padding: '14px 16px' } as const;

function stepNote(i: number, c: ObjectCard): string {
  const s = c.summary;
  switch (i) {
    case 0:
      return s && s.datasets > 0
        ? `${s.datasets} ${s.datasets === 1 ? 'file' : 'files'}, ${s.joinsConfirmed} ${s.joinsConfirmed === 1 ? 'join' : 'joins'} confirmed`
        : 'No files yet';
    case 1:
      return s && s.structures > 0
        ? `${s.structures} structures, ${s.fields} fields`
        : 'No target yet';
    case 2:
      return s && s.fields > 0 ? `${s.fields - s.mapped} fields left` : 'Waiting for a target';
    case 3:
      return s && s.snapshots > 0 ? 'A snapshot was saved' : 'Not run yet';
    default:
      return s && s.state !== 'draft' ? `Marked ${s.state}` : 'Mark a snapshot';
  }
}

/** One business object in detail: where it is, what it holds and what it produced. */
export function ObjectDetail({ card, onClose }: { card: ObjectCard; onClose: () => void }) {
  const ws = useWorkspace();
  const [files, setFiles] = useState<ObjectFiles['files']>([]);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const sum = card.summary;
  const now = currentStep(sum);
  const allDone = now === 4 && sum !== undefined && sum.state !== 'draft';

  useEffect(() => {
    let cancelled = false;
    void ws.objectDetail(card.customerFolder, card.folder).then((d) => {
      if (!cancelled) setFiles(d.files);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.customerFolder, card.folder]);

  const open = async (stage?: 'ready') => {
    const r = await ws.openObject(card.folder, card.customerFolder, stage);
    if (!r.ok) setMessage(r.message);
  };

  return (
    <>
      <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
        <DialogSurface
          aria-label={`${card.object.name} details`}
          data-testid="object-detail"
          style={{ maxWidth: 1040, width: 'calc(100vw - 48px)', padding: 0, overflow: 'hidden' }}
        >
          <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '20px 28px',
                borderBottom: '1px solid var(--line)',
                background: 'var(--bg)',
                flexWrap: 'wrap',
              }}
            >
              <img src={LOGO_SRC} alt="" width={44} height={44} style={{ borderRadius: 8 }} />
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {card.customerName} › Business objects
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
                  <h1
                    style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}
                  >
                    {card.object.name}
                  </h1>
                  {sum && <StatusTag state={sum.state} testId="detail-status" />}
                </div>
              </div>
              <Button onClick={() => setConfirm(true)}>Archive</Button>
              <Button disabled={!sum || sum.snapshots === 0} onClick={() => void open('ready')}>
                Run all rows
              </Button>
              <Button appearance="primary" onClick={() => void open()}>
                Open project
              </Button>
              <Button appearance="subtle" aria-label="Close" onClick={onClose}>
                ×
              </Button>
            </div>

            <div
              style={{
                padding: '24px 28px',
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
                maxHeight: 'calc(100vh - 220px)',
                overflowY: 'auto',
              }}
            >
              {message && (
                <MessageBar intent="error" data-testid="detail-message">
                  <MessageBarBody>{message}</MessageBarBody>
                </MessageBar>
              )}
              <ol
                aria-label="Progress"
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                {STEPS.map((name, i) => {
                  const done = i < now || (i === 4 && allDone);
                  const current = i === now && !done;
                  return (
                    <li
                      key={name}
                      data-testid={`step-${name}`}
                      data-state={done ? 'done' : current ? 'now' : 'todo'}
                      style={{
                        flex: '1 1 150px',
                        border: `1px solid ${done ? '#CFE8D8' : current ? '#9FB1EA' : 'var(--line)'}`,
                        background: done ? '#F4FAF6' : current ? '#EEF2FD' : '#fff',
                        borderRadius: 8,
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: done ? '#1E8A52' : current ? 'var(--brand)' : '#E6E8E0',
                            color: done || current ? '#fff' : 'var(--ink-2)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {done ? '✓' : i + 1}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
                        <span className="mms-muted" style={{ fontSize: 11 }}>
                          {done ? 'Done' : current ? 'Now' : ''}
                        </span>
                      </div>
                      <span className="mms-muted" style={{ fontSize: 12 }}>
                        {stepNote(i, card)}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {[
                  [
                    sum ? `${sum.mapped}` : '0',
                    sum && sum.fields ? `of ${sum.fields} fields mapped` : 'fields mapped',
                  ],
                  [
                    `${sum?.datasets ?? 0}`,
                    `datasets, ${sum?.joinsConfirmed ?? 0} joins confirmed`,
                  ],
                  [
                    `${sum?.snapshots ?? 0}`,
                    sum && sum.state === 'approved'
                      ? 'snapshots, one approved'
                      : 'snapshots, none approved',
                  ],
                  [`${sum?.requiredOpen ?? 0}`, 'required fields still open'],
                ].map(([v, l]) => (
                  <div key={l} style={{ ...box, flex: '1 1 180px' }}>
                    <div style={{ fontSize: 26, fontWeight: 700 }}>{v}</div>
                    <div className="mms-muted" style={{ fontSize: 12 }}>
                      {l}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <section style={{ flex: '1.2 1 340px', minWidth: 0 }}>
                  <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 600 }}>
                    Files kept with this object
                  </h2>
                  <div
                    style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}
                    data-testid="detail-files"
                  >
                    {files.length === 0 && (
                      <div className="mms-muted" style={{ padding: '12px 14px', fontSize: 14 }}>
                        No files yet.
                      </div>
                    )}
                    {files.map((f) => (
                      <div
                        key={`${f.kind}/${f.name}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 14px',
                          borderTop: '1px solid #ECEEE5',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '.06em',
                            color: 'var(--brand)',
                            width: 84,
                          }}
                        >
                          {f.kind}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            fontSize: 14,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
                <section style={{ flex: '1 1 300px', minWidth: 0 }}>
                  <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 600 }}>Outputs</h2>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    data-testid="detail-runs"
                  >
                    {card.runs.length === 0 && (
                      <div className="mms-muted" style={{ fontSize: 14 }}>
                        No output saved yet.
                      </div>
                    )}
                    {card.runs.slice(0, 3).map((r) => (
                      <div
                        key={r.folder}
                        style={{
                          ...box,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: 14,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-all' }}>
                            {r.folder}
                          </div>
                          <div className="mms-muted" style={{ fontSize: 12, marginTop: 2 }}>
                            {r.files} files
                          </div>
                        </div>
                        <Button
                          size="small"
                          aria-label={`Download ${r.folder} as ZIP`}
                          onClick={() =>
                            void ws.downloadRun(card.customerFolder, card.folder, r.folder)
                          }
                        >
                          ZIP
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p
                    className="mms-muted"
                    style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5 }}
                  >
                    Each run is saved in its own folder under the object’s output folder. Earlier
                    runs are never replaced. Last change {formatWhen(card.object.updatedAt)}.
                  </p>
                </section>
              </div>
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <ConfirmArchive
        name={confirm ? card.object.name : undefined}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void ws.archiveObject(card.folder, card.customerFolder).then((r) => {
            if (r.ok) onClose();
            else setMessage(r.message);
          });
        }}
      />
    </>
  );
}
