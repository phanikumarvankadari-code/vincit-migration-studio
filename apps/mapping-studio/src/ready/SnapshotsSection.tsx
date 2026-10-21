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
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  MARKER_LABEL,
  createSnapshot,
  draftMatchesSnapshot,
  snapshotProblems,
  summarizeSnapshot,
  type SnapshotMarker,
} from '@mms/studio-model';
import { useState } from 'react';
import { Section } from '../components/common';
import { nowIso, useStudio } from '../context';

const useStyles = makeStyles({
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  wrap: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflowX: 'auto',
  },
});

const MARKER_COLOR: Record<SnapshotMarker, 'subtle' | 'warning' | 'success'> = {
  none: 'subtle',
  ready: 'warning',
  approved: 'success',
};

export function SnapshotsSection() {
  const s = useStyles();
  const { state, send, preflight } = useStudio();
  const [name, setName] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmReload, setConfirmReload] = useState<string | undefined>();
  const snapshots = state.snapshots;
  const latest = snapshots.at(-1);
  const upToDate = latest ? draftMatchesSnapshot(state.project, latest.snapshot) : false;
  const blocking = snapshotProblems(state.project, preflight);
  const draftSaved = snapshots.some((r) => draftMatchesSnapshot(state.project, r.snapshot));

  const save = () => {
    const r = createSnapshot(
      state.project,
      { id: crypto.randomUUID(), name, at: nowIso() },
      preflight,
    );
    if (!r.ok) {
      setProblems(r.issues.map((i) => i.message));
      return;
    }
    if (snapshots.some((x) => x.snapshot.name.toLowerCase() === r.value.name.toLowerCase())) {
      setProblems([`A snapshot named "${r.value.name}" already exists. Use a different name.`]);
      return;
    }
    send({
      type: 'snapshotSaved',
      record: { snapshot: r.value, marker: 'none', markedAt: undefined },
    });
    setName('');
    setProblems([]);
  };

  const mark = (id: string, marker: SnapshotMarker) =>
    send({ type: 'snapshotMarked', snapshotId: id, marker });
  const reload = (id: string) => {
    if (!draftSaved) setConfirmReload(id);
    else send({ type: 'snapshotRestored', snapshotId: id });
  };

  return (
    <Section
      title="Snapshots"
      hint="A snapshot freezes the mapping under a name so a run can be repeated exactly. Later changes never alter it."
    >
      <Text data-testid="draft-status" className={s.muted}>
        {latest
          ? upToDate
            ? `The draft is the same as "${latest.snapshot.name}".`
            : `The draft has changes since "${latest.snapshot.name}".`
          : 'No snapshot saved yet.'}
      </Text>
      <div className={s.row}>
        <Input
          aria-label="Snapshot name"
          placeholder="For example SIT Cycle 1"
          value={name}
          onChange={(_, d) => {
            setName(d.value);
            setProblems([]);
          }}
          style={{ minWidth: 260 }}
        />
        <Button appearance="primary" onClick={save} disabled={blocking.length > 0}>
          Save snapshot
        </Button>
      </div>
      {blocking.length > 0 && (
        <MessageBar intent="warning" data-testid="snapshot-blockers">
          <MessageBarBody>
            <Text weight="semibold" block>
              Before a snapshot can be saved:
            </Text>
            {[...new Set(blocking.map((d) => d.message))].map((m) => (
              <div key={m}>{m}</div>
            ))}
          </MessageBarBody>
        </MessageBar>
      )}
      {problems.length > 0 && (
        <MessageBar intent="error" data-testid="snapshot-error">
          <MessageBarBody>{problems.join(' ')}</MessageBarBody>
        </MessageBar>
      )}

      {snapshots.length > 0 && (
        <div className={s.wrap}>
          <table className="data" aria-label="Snapshot history">
            <thead>
              <tr>
                <th>Name</th>
                <th>Saved</th>
                <th>Marker</th>
                <th>Content</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().map((r) => {
                const sum = summarizeSnapshot(r.snapshot);
                const id = r.snapshot.id;
                return (
                  <tr key={id} data-testid={`snapshot-${r.snapshot.name}`}>
                    <td>
                      <Text weight="semibold">{r.snapshot.name}</Text>
                    </td>
                    <td>{new Date(r.snapshot.createdAt).toLocaleString()}</td>
                    <td>
                      <Badge
                        appearance="tint"
                        color={MARKER_COLOR[r.marker]}
                        data-testid={`marker-${r.snapshot.name}`}
                      >
                        {MARKER_LABEL[r.marker]}
                      </Badge>
                    </td>
                    <td>
                      {sum.structures} structures · {sum.mappings} mappings
                    </td>
                    <td>
                      <div className={s.row}>
                        <Button
                          size="small"
                          aria-label={`Mark ${r.snapshot.name} ready`}
                          disabled={r.marker === 'ready'}
                          onClick={() => mark(id, 'ready')}
                        >
                          Mark ready
                        </Button>
                        <Button
                          size="small"
                          aria-label={`Mark ${r.snapshot.name} approved`}
                          disabled={r.marker === 'approved'}
                          onClick={() => mark(id, 'approved')}
                        >
                          Mark approved
                        </Button>
                        <Button
                          size="small"
                          appearance="subtle"
                          aria-label={`Clear mark of ${r.snapshot.name}`}
                          disabled={r.marker === 'none'}
                          onClick={() => mark(id, 'none')}
                        >
                          Clear mark
                        </Button>
                        <Button
                          size="small"
                          aria-label={`Reload ${r.snapshot.name} as draft`}
                          onClick={() => reload(id)}
                        >
                          Reload as draft
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={confirmReload !== undefined}
        onOpenChange={(_, d) => !d.open && setConfirmReload(undefined)}
      >
        <DialogSurface aria-label="Reload snapshot">
          <DialogBody>
            <DialogTitle>Replace the current draft?</DialogTitle>
            <DialogContent>
              The draft has changes that are not in any snapshot. Reloading replaces it. Save a
              snapshot first if you want to keep these changes.
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => {
                  send({ type: 'snapshotRestored', snapshotId: confirmReload! });
                  setConfirmReload(undefined);
                }}
              >
                Reload anyway
              </Button>
              <Button onClick={() => setConfirmReload(undefined)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Section>
  );
}
