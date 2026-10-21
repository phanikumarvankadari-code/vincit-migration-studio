import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Select,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { SAMPLE_PRESETS, diagnosticsForRow, type SampleConfig } from '@mms/test-engine';
import type { RowStatus } from '@mms/transformation-engine';
import { useMemo, useState } from 'react';
import { SeverityBadge, Section } from '../components/common';
import { useStudio } from '../context';
import { DiagnosticsList } from '../test/DiagnosticsList';
import { LineagePanel } from '../test/LineagePanel';
import { ResultGrid, type CellRef } from '../test/ResultGrid';

const useStyles = makeStyles({
  bar: { display: 'flex', alignItems: 'end', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 380px',
    gap: tokens.spacingHorizontalL,
    alignItems: 'start',
  },
  side: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3 },
  filters: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    flexWrap: 'wrap',
    margin: `${tokens.spacingVerticalS} 0`,
  },
});

const SAMPLES: { value: string; label: string; config: SampleConfig }[] = [
  { value: 'rows100', label: 'First 100 rows', config: SAMPLE_PRESETS.rows100 },
  { value: 'rows1000', label: 'First 1,000 rows', config: SAMPLE_PRESETS.rows1000 },
  {
    value: 'spread100',
    label: '100 rows spread across the data',
    config: { kind: 'spread', count: 100 },
  },
  { value: 'all', label: 'All rows (when safe)', config: SAMPLE_PRESETS.all },
];

const fmt = (n: number): string => n.toLocaleString('en-US');

export function TestStage() {
  const s = useStyles();
  const { state, runSample, preflight } = useStudio();
  const run = state.lastRun;
  const target = state.project.targetDefinition;
  const [sampleKey, setSampleKey] = useState('rows100');
  const [structureId, setStructureId] = useState<string | undefined>();
  const [filter, setFilter] = useState<RowStatus | 'all'>('all');
  const [cell, setCell] = useState<CellRef | undefined>();
  const [inspected, setInspected] = useState<number | undefined>();
  const [scroll, setScroll] = useState<{ row: number; nonce: number } | undefined>();

  const outputs = run?.targets ?? [];
  const activeId =
    structureId && outputs.some((o) => o.rows.targetStructureId === structureId)
      ? structureId
      : outputs[0]?.rows.targetStructureId;
  const output = outputs.find((o) => o.rows.targetStructureId === activeId);
  const structure = target?.structures.find((x) => x.id === activeId);
  const counts = useMemo(() => {
    const c = { all: 0, ready: 0, warning: 0, error: 0 };
    for (const st of output?.rowStatus ?? []) {
      c.all++;
      c[st]++;
    }
    return c;
  }, [output]);

  const structureName = (id: string): string =>
    target?.structures.find((x) => x.id === id)?.name ?? id;
  const fieldName = (sid: string, fid: string): string =>
    target?.structures.find((x) => x.id === sid)?.fields.find((f) => f.id === fid)?.displayName ??
    fid;

  const startRun = () => {
    setCell(undefined);
    setInspected(undefined);
    setFilter('all');
    runSample(SAMPLES.find((x) => x.value === sampleKey)!.config);
  };

  const show = (sid: string, row: number) => {
    setStructureId(sid);
    setFilter('all');
    setInspected(row);
    const o = outputs.find((x) => x.rows.targetStructureId === sid);
    const st = target?.structures.find((x) => x.id === sid);
    // Select the cell the problem is about, if the diagnostic names a field.
    const d = run?.run.diagnostics.find(
      (x) => x.targetStructureId === sid && x.targetRow === row && x.targetFieldId,
    );
    const col = d && st ? st.fields.findIndex((f) => f.id === d.targetFieldId) : -1;
    setCell(col >= 0 && o ? { row, col } : undefined);
    setScroll({ row, nonce: (scroll?.nonce ?? 0) + 1 });
  };

  const selectedField = structure && cell ? structure.fields[cell.col] : undefined;
  const lineageRecorded = output?.lineage !== undefined;
  const cellLineage = output?.lineage?.[cell ? cell.row - 1 : -1]?.[cell?.col ?? -1];
  const cellIssues =
    run && selectedField && cell && activeId
      ? run.run.diagnostics.filter(
          (d) =>
            d.targetStructureId === activeId &&
            d.targetRow === cell.row &&
            d.targetFieldId === selectedField.id,
        )
      : [];
  const rowDiags =
    run && inspected && activeId ? diagnosticsForRow(run.run.diagnostics, activeId, inspected) : [];

  if (!target) {
    return (
      <Section title="Test" hint="Try the mapping on real rows before you rely on it.">
        <MessageBar intent="info">
          <MessageBarBody>Load sources and a target structure first.</MessageBarBody>
        </MessageBar>
      </Section>
    );
  }

  const preflightProblems = preflight.filter((d) => d.severity !== 'info');

  return (
    <Section
      title="Test"
      hint="Run the mapping on a sample, look at the transformed rows here, and trace any value back to its source."
    >
      <div className={s.bar}>
        <label>
          <Text block>Sample</Text>
          <Select aria-label="Sample" value={sampleKey} onChange={(_, d) => setSampleKey(d.value)}>
            {SAMPLES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
        </label>
        <Button appearance="primary" onClick={startRun}>
          Run test
        </Button>
        {run && state.runStale && (
          <Badge color="warning" data-testid="stale-badge">
            Results are out of date: the mapping changed since this run
          </Badge>
        )}
      </div>

      {preflightProblems.length > 0 && (
        <MessageBar
          intent={preflightProblems.some((d) => d.severity === 'error') ? 'error' : 'warning'}
          data-testid="preflight-list"
        >
          <MessageBarBody>
            <Text weight="semibold" block>
              Found before running ({preflightProblems.length}):
            </Text>
            {preflightProblems.map((d, i) => (
              <div key={i}>
                <SeverityBadge severity={d.severity} /> {d.message}
              </div>
            ))}
          </MessageBarBody>
        </MessageBar>
      )}

      {!run && <Text className={s.muted}>Not run yet. Choose a sample and select “Run test”.</Text>}

      {run && (
        <>
          <MessageBar
            intent={
              run.run.status === 'failed'
                ? 'error'
                : run.run.status === 'completedWithErrors'
                  ? 'warning'
                  : 'success'
            }
            data-testid="run-summary"
          >
            <MessageBarBody>
              {run.run.status === 'failed'
                ? 'The test could not run. '
                : run.run.status === 'completedWithErrors'
                  ? 'The test ran with errors. '
                  : 'The test ran without errors. '}
              {run.run.errorCount} errors, {run.run.warningCount} warnings.
            </MessageBarBody>
          </MessageBar>
          <div className={s.cards}>
            {run.structures.map((x) => (
              <div
                key={x.targetStructureId}
                className={s.card}
                data-testid={`run-structure-${x.name}`}
              >
                <Text weight="semibold" size={400}>
                  {x.name}
                </Text>
                <Text>
                  {fmt(x.rows)} rows from {fmt(x.sampledRowCount)} of {fmt(x.driverRowCount)} source
                  rows
                </Text>
                <Text className={s.muted}>
                  {x.ready} ready · {x.warning} warning · {x.error} error
                </Text>
              </div>
            ))}
          </div>

          {structure && output && (
            <>
              <TabList
                selectedValue={activeId}
                onTabSelect={(_, d) => {
                  setStructureId(d.value as string);
                  setCell(undefined);
                  setInspected(undefined);
                  setFilter('all');
                }}
                aria-label="Target structure"
              >
                {outputs.map((o) => (
                  <Tab key={o.rows.targetStructureId} value={o.rows.targetStructureId}>
                    {structureName(o.rows.targetStructureId)}
                  </Tab>
                ))}
              </TabList>
              <div className={s.filters} role="group" aria-label="Filter rows by status">
                {(
                  [
                    ['all', `All (${fmt(counts.all)})`],
                    ['ready', `Ready (${fmt(counts.ready)})`],
                    ['warning', `Warning (${fmt(counts.warning)})`],
                    ['error', `Error (${fmt(counts.error)})`],
                  ] as const
                ).map(([k, label]) => (
                  <Button
                    key={k}
                    size="small"
                    appearance={filter === k ? 'primary' : 'secondary'}
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className={s.layout}>
                <ResultGrid
                  output={output}
                  structure={structure}
                  filter={filter}
                  diagnostics={run.run.diagnostics}
                  selected={cell}
                  inspectedRow={inspected}
                  onSelectCell={(c) => {
                    setCell(c);
                    setInspected(c.row);
                  }}
                  onInspectRow={(r) => {
                    setInspected(r);
                    setCell(undefined);
                  }}
                  scrollToRow={scroll}
                />
                <div className={s.side}>
                  {cell && selectedField && (
                    <LineagePanel
                      project={state.project}
                      field={selectedField}
                      row={cell.row}
                      value={output.rows.rows[cell.row - 1]?.[cell.col] ?? null}
                      lineage={cellLineage}
                      lineageRecorded={lineageRecorded}
                      issues={cellIssues}
                    />
                  )}
                  {inspected !== undefined && output.rows.rows[inspected - 1] && (
                    <div className={s.card} data-testid="row-inspector">
                      <Text weight="semibold" size={400}>
                        Row {inspected} of {structure.name}
                      </Text>
                      <Text className={s.muted}>
                        From row {output.driverRows[inspected - 1]} of the source dataset
                      </Text>
                      <table className="data" aria-label="Row values">
                        <tbody>
                          {structure.fields.map((f, i) => (
                            <tr key={f.id}>
                              <th scope="row">{f.displayName}</th>
                              <td>{output.rows.rows[inspected - 1]![i] ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rowDiags.map((d, i) => (
                        <div key={i}>
                          <SeverityBadge severity={d.severity} /> {d.message}
                        </div>
                      ))}
                    </div>
                  )}
                  {!cell && inspected === undefined && (
                    <Text className={s.muted}>
                      Select a cell to see where its value came from, or a row number to inspect the
                      whole row.
                    </Text>
                  )}
                </div>
              </div>
            </>
          )}

          <DiagnosticsList
            groups={run.diagnosticGroups}
            diagnostics={run.run.diagnostics}
            structureName={structureName}
            fieldName={fieldName}
            onShow={show}
          />
        </>
      )}
    </Section>
  );
}
