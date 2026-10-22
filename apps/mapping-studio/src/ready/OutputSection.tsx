import {
  Button,
  Checkbox,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { toZip } from '@mms/file-export';
import { fileBytes, runLocal, type LocalRunResult, type OutputFile } from '@mms/local-run';
import { canRunFull, datasetsWithoutData } from '@mms/studio-model';
import { useState } from 'react';
import { Section } from '../components/common';
import { nowIso, useStudio } from '../context';
import { useOptionalWorkspace } from '../workspace';
import { MIME, downloadFile } from '../lib/storage';

const useStyles = makeStyles({
  row: { display: 'flex', alignItems: 'end', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
});

const fmt = (n: number): string => n.toLocaleString('en-US');
const mimeOf = (f: OutputFile): string => MIME[f.format] ?? 'application/octet-stream';

/** Runs a saved snapshot on all rows and offers the result files for download (no AI, no cloud). */
export function OutputSection() {
  const s = useStyles();
  const { state, registry, setStage, lastOutput, setLastOutput } = useStudio();
  const eligible = state.snapshots.filter(canRunFull);
  const [chosen, setChosen] = useState<string | undefined>();
  const [csv, setCsv] = useState(true);
  const [xlsx, setXlsx] = useState(false);
  const [header, setHeader] = useState<'displayName' | 'technicalName'>('displayName');
  const [busy, setBusy] = useState(false);
  const ws = useOptionalWorkspace();
  const [saveEvery, setSaveEvery] = useState(() => {
    try {
      return window.localStorage.getItem('mms:saveOutputs') !== 'off';
    } catch {
      return true;
    }
  });
  const [saved, setSaved] = useState<
    { ok: true; path: string; files: number } | { ok: false; message: string } | undefined
  >();

  const saveToWorkspace = async (result: LocalRunResult) => {
    if (!ws || result.files.length === 0) return;
    setSaved(
      await ws.saveOutput(
        result.files.map((f) => ({ name: f.name, bytes: fileBytes(f) })),
        { startedAt: result.summary.startedAt, snapshotName: result.summary.snapshotName },
      ),
    );
  };
  const missing = datasetsWithoutData(state);
  const record = eligible.find((r) => r.snapshot.id === chosen) ?? eligible.at(-1);

  const run = () => {
    if (!record) return;
    setBusy(true);
    // Let the screen show "Running" before the work starts.
    window.setTimeout(() => {
      const formats = [
        csv ? ('csv' as const) : undefined,
        xlsx ? ('xlsx' as const) : undefined,
      ].filter((x) => x !== undefined);
      const result = runLocal(
        record.snapshot,
        Object.values(state.data),
        {
          id: crypto.randomUUID() as never,
          snapshotId: record.snapshot.id,
          runType: 'full',
          inputs: [],
        },
        {
          now: nowIso,
          routines: registry,
          formats: formats.length > 0 ? formats : ['csv'],
          header,
          workbookName: state.project.name,
        },
      );
      setLastOutput(result);
      setSaved(undefined);
      setBusy(false);
      if (ws && saveEvery && result.run.status !== 'failed') void saveToWorkspace(result);
    }, 20);
  };

  const summary = lastOutput?.summary;
  return (
    <Section
      title="Output"
      hint="Run a snapshot that is marked Ready or Approved on all rows and create the target files on this computer."
    >
      {eligible.length === 0 && (
        <MessageBar intent="info" data-testid="output-needs-marker">
          <MessageBarBody>Mark a snapshot Ready or Approved above to create output.</MessageBarBody>
        </MessageBar>
      )}
      {eligible.length > 0 && missing.length > 0 && (
        <MessageBar intent="warning" data-testid="output-needs-data">
          <MessageBarBody>
            The rows of {missing.map((m) => m.name).join(', ')} are not loaded. Load the source
            files first.
          </MessageBarBody>
          <Button size="small" onClick={() => setStage('sources')}>
            Go to Sources
          </Button>
        </MessageBar>
      )}
      {eligible.length > 0 && (
        <div className={s.row}>
          <label>
            <Text block>Snapshot</Text>
            <Select
              aria-label="Snapshot to run"
              value={record?.snapshot.id ?? ''}
              onChange={(_, d) => setChosen(d.value)}
            >
              {eligible.map((r) => (
                <option key={r.snapshot.id} value={r.snapshot.id}>
                  {r.snapshot.name} ({r.marker === 'approved' ? 'Approved' : 'Ready'})
                </option>
              ))}
            </Select>
          </label>
          <Checkbox
            label="CSV files"
            checked={csv}
            onChange={(_, d) => setCsv(d.checked === true)}
          />
          <Checkbox
            label="Excel workbook"
            checked={xlsx}
            onChange={(_, d) => setXlsx(d.checked === true)}
          />
          <label>
            <Text block>Column headings</Text>
            <Select
              aria-label="Column headings"
              value={header}
              onChange={(_, d) => setHeader(d.value as typeof header)}
            >
              <option value="displayName">Field names</option>
              <option value="technicalName">Technical names</option>
            </Select>
          </label>
          {ws && (
            <Checkbox
              label="Save every run into the workspace folder"
              checked={saveEvery}
              onChange={(_, d) => {
                const on = d.checked === true;
                setSaveEvery(on);
                try {
                  window.localStorage.setItem('mms:saveOutputs', on ? 'on' : 'off');
                } catch {
                  /* a per-viewer convenience */
                }
              }}
            />
          )}
          <Button appearance="primary" disabled={busy || missing.length > 0} onClick={run}>
            {busy ? 'Running…' : 'Run on all rows and create files'}
          </Button>
        </div>
      )}

      {lastOutput && summary && (
        <div className={s.card} data-testid="output-summary">
          <Text weight="semibold" size={400}>
            Run summary
          </Text>
          <Text data-testid="output-status">
            {summary.status === 'failed'
              ? 'The run could not be done.'
              : summary.status === 'completedWithErrors'
                ? 'The run finished with errors. Rows that failed are in the errors files.'
                : 'The run finished without errors.'}
          </Text>
          <Text className={s.muted} data-testid="output-snapshot">
            Snapshot “{summary.snapshotName}” · started{' '}
            {new Date(summary.startedAt).toLocaleString()} · finished{' '}
            {new Date(summary.completedAt).toLocaleString()}
          </Text>
          <Text className={s.muted}>
            {Object.values(summary.inputRecordCounts).reduce((a, b) => a + b, 0) > 0
              ? `Input rows: ${fmt(Object.values(summary.inputRecordCounts).reduce((a, b) => a + b, 0))}`
              : 'No input rows.'}{' '}
            · {summary.errorCount} errors · {summary.warningCount} warnings
          </Text>
          {lastOutput.run.status === 'failed' && (
            <div data-testid="output-failure">
              {lastOutput.run.diagnostics.map((d, i) => (
                <div key={i}>{d.message}</div>
              ))}
            </div>
          )}
          {summary.structures.length > 0 && (
            <table className="data" aria-label="Output by structure">
              <thead>
                <tr>
                  <th>Structure</th>
                  <th>Written</th>
                  <th>Errors</th>
                  <th>Warnings</th>
                  <th>Dropped by a join</th>
                </tr>
              </thead>
              <tbody>
                {summary.structures.map((x) => (
                  <tr key={x.targetStructureId} data-testid={`output-structure-${x.name}`}>
                    <td>{x.name}</td>
                    <td>{fmt(x.written)}</td>
                    <td>{fmt(x.errors)}</td>
                    <td>{fmt(x.warnings)}</td>
                    <td>{fmt(x.dropped)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.notes.map((n) => (
            <Text key={n} className={s.muted}>
              Note: {n}
            </Text>
          ))}
          {lastOutput.files.length > 0 && (
            <>
              <table className="data" aria-label="Generated files">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Contents</th>
                    <th>Rows</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lastOutput.files.map((f) => (
                    <tr key={f.name} data-testid={`output-file-${f.name}`}>
                      <td>{f.name}</td>
                      <td>
                        {f.kind === 'output'
                          ? 'Rows for the target'
                          : f.kind === 'errors'
                            ? 'Rows that failed, with reasons'
                            : f.kind === 'diagnostics'
                              ? 'Every problem found'
                              : 'Run summary'}
                      </td>
                      <td>{f.rows === undefined ? '' : fmt(f.rows)}</td>
                      <td>
                        <Button
                          size="small"
                          aria-label={`Download ${f.name}`}
                          onClick={() => downloadFile(f.name, f.content, mimeOf(f))}
                        >
                          Download
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {saved?.ok && (
                <MessageBar intent="success" data-testid="output-saved">
                  <MessageBarBody>
                    Saved {saved.files} files to {saved.path}
                  </MessageBarBody>
                </MessageBar>
              )}
              {saved && !saved.ok && (
                <MessageBar intent="error" data-testid="output-save-error">
                  <MessageBarBody>
                    The files were not saved to the workspace folder: {saved.message} They can still
                    be downloaded.
                  </MessageBarBody>
                </MessageBar>
              )}
              <div className={s.row}>
                {ws && (
                  <Button appearance="primary" onClick={() => void saveToWorkspace(lastOutput)}>
                    Save to workspace folder
                  </Button>
                )}
                <Button
                  onClick={() =>
                    downloadFile(
                      `${summary.snapshotName.replace(/[\\\\/:*?"<>|]+/g, '_')} output.zip`,
                      toZip(lastOutput.files.map((f) => ({ name: f.name, data: fileBytes(f) }))),
                      MIME['zip']!,
                    )
                  }
                >
                  Download all as ZIP
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  );
}
