import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { Diagnostic, Relationship } from '@mms/mapping-core';
import { useState } from 'react';
import { FileButton, Notices, Section, SeverityBadge } from '../components/common';
import { datasetsWithoutData } from '@mms/studio-model';
import { useStudio } from '../context';
import { useOptionalWorkspace } from '../workspace';
import { notice, readDictionaryFile, readSourceFiles, type Notice } from '../lib/files';

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  spacer: { marginLeft: 'auto' },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  tableWrap: { overflowX: 'auto' },
});

const pct = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(2)}%`;

export function SourcesStage() {
  const s = useStyles();
  const { state, send, profiles } = useStudio();
  const ws = useOptionalWorkspace();
  const [notices, setNotices] = useState<Notice[]>([]);
  const sources = state.project.sourceDefinitions;
  const rels = state.project.mappingDefinition.relationships;
  const missing = datasetsWithoutData(state);

  // With a workspace, every file the user adds is also copied into the object's folder.
  const keep = async (files: File[], kind: 'sources' | 'dictionary') => {
    if (!ws) return;
    for (const f of files) {
      if (kind === 'sources' && !/\.(csv|xlsx)$/i.test(f.name)) continue;
      const r = await ws.saveInput(kind, f);
      if (!r.ok)
        setNotices((cur) => [
          ...cur,
          notice('warning', `"${f.name}" was not copied into the workspace folder: ${r.message}`),
        ]);
    }
  };

  const addFiles = async (files: File[]) => {
    void keep(files, 'sources');
    const { imported, notices: n } = await readSourceFiles(files);
    setNotices((cur) => [...cur, ...n]);
    for (const i of imported) send({ type: 'sourceAdded', imported: i });
  };
  const attachRows = async (files: File[]) => {
    void keep(files, 'sources');
    const { imported, notices: n } = await readSourceFiles(files);
    setNotices((cur) => [...cur, ...n]);
    for (const i of imported) send({ type: 'rowsAttached', imported: i });
  };
  const addDictionary = async (files: File[]) => {
    void keep(files.slice(0, 1), 'dictionary');
    const r = await readDictionaryFile(files[0]!);
    if ('error' in r) setNotices((cur) => [...cur, notice('error', r.error)]);
    else send({ type: 'dictionaryLoaded', dictionary: r.dictionary, diagnostics: r.diagnostics });
  };

  const datasetName = (id: string): string =>
    sources.flatMap((x) => x.datasets).find((d) => d.id === id)?.name ?? id;
  const fieldName = (id: string): string =>
    sources
      .flatMap((x) => x.datasets)
      .flatMap((d) => d.fields)
      .find((f) => f.id === id)?.displayName ?? id;

  return (
    <>
      <Section
        title="Source files"
        hint="Add the CSV or Excel files you migrate from. An optional field dictionary adds technical names, types and keys."
        actions={
          <div className={s.row}>
            <FileButton
              label="Add source files"
              accept=".csv,.xlsx"
              multiple
              appearance="primary"
              testId="source-files-input"
              onFiles={(f) => void addFiles(f)}
            />
            <FileButton
              label="Add field dictionary"
              accept=".csv"
              testId="dictionary-input"
              onFiles={(f) => void addDictionary(f)}
            />
          </div>
        }
      >
        <Notices
          notices={notices}
          onDismiss={(id) => setNotices((cur) => cur.filter((n) => n.id !== id))}
        />
        {missing.length > 0 && (
          <MessageBar intent="warning" data-testid="missing-data-banner">
            <MessageBarBody>
              The rows of{' '}
              {missing.length === 1 ? 'one dataset are' : `${missing.length} datasets are`} not
              loaded ({missing.map((m) => m.name).join(', ')}). A project keeps the mapping, not the
              rows: choose the same source files again to test or run.
            </MessageBarBody>
            <FileButton
              label="Load source data"
              accept=".csv,.xlsx"
              multiple
              appearance="primary"
              testId="reattach-input"
              onFiles={(f) => void attachRows(f)}
            />
          </MessageBar>
        )}
        {state.dictionary && (
          <MessageBar intent="success">
            <MessageBarBody data-testid="dictionary-loaded">
              Field dictionary loaded: {state.dictionary.entries.length} fields.
            </MessageBarBody>
          </MessageBar>
        )}
        {sources.length === 0 && (
          <div className={s.card}>
            <Text weight="semibold">No files yet</Text>
            <Text className={s.muted}>
              Choose “Add source files” and select one or more .csv or .xlsx files. Each Excel sheet
              becomes its own dataset.
            </Text>
          </div>
        )}
        <div className={s.list}>
          {sources.map((source) => {
            const diags: readonly Diagnostic[] = state.importDiagnostics[source.id] ?? [];
            return (
              <div key={source.id} className={s.card} data-testid={`source-${source.name}`}>
                <div className={s.row}>
                  <Text weight="semibold" size={400}>
                    {source.name}
                  </Text>
                  <Badge appearance="outline">{source.sourceType.toUpperCase()}</Badge>
                  <Button
                    className={s.spacer}
                    size="small"
                    appearance="subtle"
                    onClick={() => send({ type: 'sourceRemoved', sourceId: source.id })}
                    aria-label={`Remove ${source.name}`}
                  >
                    Remove
                  </Button>
                </div>
                {diags.filter((d) => d.severity !== 'info').length > 0 && (
                  <MessageBar
                    intent={diags.some((d) => d.severity === 'error') ? 'error' : 'warning'}
                  >
                    <MessageBarBody>
                      {diags
                        .filter((d) => d.severity !== 'info')
                        .map((d, i) => (
                          <div key={i}>{d.message}</div>
                        ))}
                    </MessageBarBody>
                  </MessageBar>
                )}
                <Accordion collapsible multiple>
                  {source.datasets.map((ds) => {
                    const profile = profiles.get(ds.id);
                    return (
                      <AccordionItem key={ds.id} value={ds.id}>
                        <AccordionHeader>
                          <span data-testid={`dataset-${ds.name}`}>
                            {ds.name} — {profile ? `${profile.rowCount} rows` : 'data not loaded'},{' '}
                            {ds.fields.length} fields
                          </span>
                        </AccordionHeader>
                        <AccordionPanel>
                          <div className={s.tableWrap}>
                            <table className="data" aria-label={`Fields of ${ds.name}`}>
                              <thead>
                                <tr>
                                  <th>Field</th>
                                  <th>Technical name</th>
                                  <th>Type</th>
                                  <th>Key</th>
                                  <th>Filled</th>
                                  <th>Distinct</th>
                                  <th>Unique</th>
                                  <th>Sample values</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ds.fields.map((f) => {
                                  const p = profile?.fields.find((x) => x.fieldId === f.id);
                                  return (
                                    <tr key={f.id}>
                                      <td>{f.displayName}</td>
                                      <td>{f.technicalName ?? ''}</td>
                                      <td>
                                        {f.datatype === 'unknown'
                                          ? (p?.inferredDatatype ?? '')
                                          : f.datatype}
                                      </td>
                                      <td>{f.isKey ? 'Key' : ''}</td>
                                      <td data-testid={`fill-${ds.name}-${f.displayName}`}>
                                        {p ? pct(p.fillPercentage) : ''}
                                      </td>
                                      <td>{p?.distinctCount ?? ''}</td>
                                      <td>
                                        {p
                                          ? p.uniqueness === 'unique'
                                            ? 'Yes'
                                            : p.uniqueness === 'notUnique'
                                              ? 'No'
                                              : ''
                                          : ''}
                                      </td>
                                      <td>{p?.representativeValues.join(', ') ?? ''}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </AccordionPanel>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </div>
            );
          })}
        </div>
      </Section>

      {rels.length > 0 && (
        <Section
          title="Joins between the files"
          hint="The app suggests joins from names, keys and values. Confirm the ones that are right; only confirmed joins are used when mappings run."
        >
          <div className={s.list}>
            {rels.map((r) => (
              <RelationshipCard
                key={r.id}
                r={r}
                left={datasetName(r.leftDatasetId)}
                right={datasetName(r.rightDatasetId)}
                fieldName={fieldName}
              />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function RelationshipCard({
  r,
  left,
  right,
  fieldName,
}: {
  r: Relationship;
  left: string;
  right: string;
  fieldName: (id: string) => string;
}) {
  const s = useStyles();
  const { state, send } = useStudio();
  const note = state.suggestionNotes[r.id];
  const keys = r.keys
    .map((k) =>
      fieldName(k.leftFieldId) === fieldName(k.rightFieldId)
        ? fieldName(k.leftFieldId)
        : `${fieldName(k.leftFieldId)} = ${fieldName(k.rightFieldId)}`,
    )
    .join(' + ');
  return (
    <div className={s.card} data-testid={`relationship-${r.id}`}>
      <div className={s.row}>
        <Text weight="semibold" size={400}>
          {left} ⇄ {right}
        </Text>
        <Badge
          appearance="tint"
          color={
            r.status === 'confirmed' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'
          }
          data-testid={`relationship-status-${r.id}`}
        >
          {r.status === 'suggested'
            ? 'Suggested'
            : r.status === 'confirmed'
              ? 'Confirmed'
              : 'Rejected'}
        </Badge>
        <Text className={s.muted}>{r.cardinality}</Text>
        <div className={s.spacer} />
        {r.status === 'suggested' ? (
          <>
            <Button
              appearance="primary"
              onClick={() =>
                send({ type: 'relationshipDecided', relationshipId: r.id, status: 'confirmed' })
              }
            >
              Confirm join
            </Button>
            <Button
              onClick={() =>
                send({ type: 'relationshipDecided', relationshipId: r.id, status: 'rejected' })
              }
            >
              Reject
            </Button>
          </>
        ) : (
          <Button
            onClick={() =>
              send({ type: 'relationshipDecided', relationshipId: r.id, status: 'suggested' })
            }
          >
            Undo
          </Button>
        )}
      </div>
      <Text>Keys: {keys}</Text>
      <div className={s.row}>
        <label htmlFor={`jt-${r.id}`}>
          <Text>Join type</Text>
        </label>
        <Select
          id={`jt-${r.id}`}
          value={r.joinType}
          onChange={(_, d) =>
            send({
              type: 'relationshipJoinType',
              relationshipId: r.id,
              joinType: d.value as Relationship['joinType'],
            })
          }
        >
          <option value="left">Left join: keep rows without a match</option>
          <option value="inner">Inner join: only rows that match</option>
        </Select>
      </div>
      {note && note.evidence.length > 0 && (
        <Text className={s.muted}>Why: {note.evidence.join('; ')}.</Text>
      )}
      {note?.diagnostics.map((d, i) => (
        <MessageBar key={i} intent="warning">
          <MessageBarBody>
            <SeverityBadge severity={d.severity} /> {d.message}
          </MessageBarBody>
        </MessageBar>
      ))}
    </div>
  );
}
