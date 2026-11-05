import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
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
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  autoImportTarget,
  previewTarget,
  readTargetTable,
  type TargetFile,
  type TargetPreview,
} from '@mms/studio-model';
import type { TargetLayout } from '@mms/target-parser';
import { useMemo, useState } from 'react';
import { FileButton, Section } from '../components/common';
import { useStudio } from '../context';
import { stripExtension } from '../lib/files';
import { useOptionalWorkspace } from '../workspace';

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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

const ROLES: { key: keyof TargetLayout['columns']; label: string; required?: boolean }[] = [
  { key: 'structure', label: 'Structure name' },
  { key: 'group', label: 'Group' },
  { key: 'displayName', label: 'Field name', required: true },
  { key: 'importance', label: 'Required (importance)' },
  { key: 'type', label: 'Type' },
  { key: 'length', label: 'Length' },
  { key: 'decimals', label: 'Decimals' },
  { key: 'technicalStructure', label: 'Technical structure' },
  { key: 'technicalField', label: 'Technical field' },
  { key: 'key', label: 'Key flag' },
];

const MANUAL_TEMPLATE =
  'Structure,Field,Type,Length,Importance,Key\nHeader,Id,Text,10,mandatory,X\nHeader,Name,Text,40,,\nLines,Quantity,Number,,,\n';

export function TargetStage() {
  const s = useStyles();
  const { state, send, setStage } = useStudio();
  const ws = useOptionalWorkspace();
  const target = state.project.targetDefinition;
  const [file, setFile] = useState<TargetFile | undefined>();
  const [headerRow, setHeaderRow] = useState(1);
  const [layout, setLayout] = useState<TargetLayout | undefined>();
  const [initialError, setInitialError] = useState<string | undefined>();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState(MANUAL_TEMPLATE);
  const [manualError, setManualError] = useState<string | undefined>();

  const targetName = file ? stripExtension(file.name) : 'Target';
  const preview = useMemo(
    () => (file && layout ? previewTarget(file, headerRow, layout, targetName) : undefined),
    [file, layout, headerRow, targetName],
  );
  const headers = useMemo(() => {
    if (!file) return [];
    const t = readTargetTable(file, headerRow);
    return t.ok ? (t.value.source.datasets[0]?.fields.map((f) => f.displayName) ?? []) : [];
  }, [file, headerRow]);

  const loadFile = async (files: File[]) => {
    const f = files[0]!;
    void ws?.saveInput('target', f);
    const isCsv = f.name.toLowerCase().endsWith('.csv');
    const tf: TargetFile = {
      name: f.name,
      content: isCsv ? await f.text() : new Uint8Array(await f.arrayBuffer()),
    };
    setFile(tf);
    const auto = autoImportTarget(tf, stripExtension(f.name));
    if (auto.ok) {
      setHeaderRow(auto.value.headerRow);
      setLayout(auto.value.layout);
      setInitialError(undefined);
    } else {
      setHeaderRow(1);
      setLayout({ mode: 'sectionRows', columns: { displayName: '' } });
      setInitialError(auto.issues.map((i) => i.message).join(' '));
    }
  };

  const acceptTarget = (p: TargetPreview) => {
    send({ type: 'targetLoaded', target: p.target });
    setFile(undefined);
    setLayout(undefined);
  };

  const setColumn = (key: keyof TargetLayout['columns'], value: string) =>
    setLayout((cur) => {
      if (!cur) return cur;
      const columns = { ...cur.columns };
      if (value === '') {
        if (key !== 'displayName') delete columns[key];
        else columns.displayName = '';
      } else columns[key] = value;
      return { ...cur, columns };
    });

  const applyManual = () => {
    const r = autoImportTarget({ name: 'manual.csv', content: manualText }, 'Manual target');
    if (!r.ok) {
      setManualError(r.issues.map((i) => i.message).join(' '));
      return;
    }
    send({ type: 'targetLoaded', target: r.value.target });
    setManualOpen(false);
    setManualError(undefined);
  };

  return (
    <>
      <Section
        title="Target structure"
        hint="Load a file that describes the target (for example the SAP migration template as .xlsx or Excel .xml), or type it in. The app finds the header row and columns; you can correct them."
        actions={
          <div className={s.row}>
            <FileButton
              label="Load target structure file"
              accept=".xlsx,.xml,.csv"
              appearance="primary"
              testId="target-file-input"
              onFiles={(f) => void loadFile(f)}
            />
            <Button onClick={() => setManualOpen(true)}>Create target manually</Button>
          </div>
        }
      >
        {file && layout && (
          <div className={s.card} data-testid="target-wizard">
            <Text weight="semibold" size={400}>
              Check how “{file.name}” is read
            </Text>
            {initialError && (
              <MessageBar intent="warning">
                <MessageBarBody>{initialError}</MessageBarBody>
              </MessageBar>
            )}
            <div className={s.grid}>
              {typeof file.content !== 'string' && (
                <label>
                  <Text block>Header row</Text>
                  <Input
                    type="number"
                    aria-label="Header row"
                    value={String(headerRow)}
                    onChange={(_, d) => setHeaderRow(Math.max(1, Number(d.value) || 1))}
                  />
                </label>
              )}
              <label>
                <Text block>How structures are listed</Text>
                <Select
                  aria-label="How structures are listed"
                  value={layout.mode}
                  onChange={(_, d) =>
                    setLayout({ ...layout, mode: d.value as TargetLayout['mode'] })
                  }
                >
                  <option value="sectionRows">A heading row starts each structure</option>
                  <option value="column">A column names the structure on every row</option>
                  <option value="perSheet">Each sheet is one structure</option>
                </Select>
              </label>
              {ROLES.map((r) => (
                <label key={r.key}>
                  <Text block>
                    {r.label}
                    {r.required ? ' *' : ''}
                  </Text>
                  <Select
                    aria-label={r.label}
                    value={layout.columns[r.key] ?? ''}
                    onChange={(_, d) => setColumn(r.key, d.value)}
                  >
                    <option value="">{r.required ? '— choose —' : '— none —'}</option>
                    {headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            {preview && !preview.ok && (
              <MessageBar intent="error">
                <MessageBarBody>{preview.issues.map((i) => i.message).join(' ')}</MessageBarBody>
              </MessageBar>
            )}
            {preview?.ok && (
              <>
                <Text weight="semibold" data-testid="target-preview-summary">
                  {preview.value.target.structures.length} structures:{' '}
                  {preview.value.target.structures
                    .map((x) => `${x.name} (${x.fields.length})`)
                    .join(', ')}
                </Text>
                {preview.value.target.template && (
                  <Text className={s.muted} data-testid="target-template-note">
                    Template workbook: the structures come from its Field List sheet. The result is
                    written into its data sheets (
                    {preview.value.target.structures
                      .filter((x) => x.templateSheet)
                      .map((x) => x.templateSheet)
                      .join(', ')}
                    ).
                  </Text>
                )}
                {preview.value.diagnostics.map((d, i) => (
                  <MessageBar
                    key={i}
                    intent={
                      d.severity === 'error'
                        ? 'error'
                        : d.severity === 'warning'
                          ? 'warning'
                          : 'info'
                    }
                  >
                    <MessageBarBody>{d.message}</MessageBarBody>
                  </MessageBar>
                ))}
                <div className={s.row}>
                  <Button appearance="primary" onClick={() => acceptTarget(preview.value)}>
                    Use this target
                  </Button>
                  <Button
                    onClick={() => {
                      setFile(undefined);
                      setLayout(undefined);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {!target && !file && (
          <div className={s.card}>
            <Text weight="semibold">No target yet</Text>
            <Text className={s.muted}>
              Load the target definition file, or choose “Create target manually”.
            </Text>
          </div>
        )}

        {target?.template && (
          <Text className={s.muted} data-testid="target-template-loaded">
            Output is written into the template workbook “{target.template.fileName}”.
          </Text>
        )}
        {target && (
          <div className={s.list} data-testid="target-structures">
            {target.structures.map((st) => (
              <div key={st.id} className={s.card} data-testid={`structure-${st.name}`}>
                <div className={s.row}>
                  <Text weight="semibold" size={400}>
                    {st.name}
                  </Text>
                  {st.technicalName && <Badge appearance="outline">{st.technicalName}</Badge>}
                  <Text className={s.muted}>
                    {st.fields.length} fields, {st.fields.filter((f) => f.required).length}{' '}
                    required, {st.fields.filter((f) => f.isKey).length} key
                  </Text>
                </div>
                <Accordion collapsible>
                  <AccordionItem value={st.id}>
                    <AccordionHeader>Show fields</AccordionHeader>
                    <AccordionPanel>
                      <table className="data" aria-label={`Fields of ${st.name}`}>
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Technical name</th>
                            <th>Type</th>
                            <th>Length</th>
                            <th>Required</th>
                            <th>Key</th>
                            <th>Group</th>
                          </tr>
                        </thead>
                        <tbody>
                          {st.fields.map((f) => (
                            <tr key={f.id}>
                              <td>{f.displayName}</td>
                              <td>{f.technicalName ?? ''}</td>
                              <td>{f.datatype}</td>
                              <td>{f.length ?? ''}</td>
                              <td>{f.required ? 'Required' : ''}</td>
                              <td>{f.isKey ? 'Key' : ''}</td>
                              <td>{f.group ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </AccordionPanel>
                  </AccordionItem>
                </Accordion>
              </div>
            ))}
            <div className={s.row}>
              <Button appearance="primary" onClick={() => setStage('map')}>
                Continue to Map
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Dialog open={manualOpen} onOpenChange={(_, d) => setManualOpen(d.open)}>
        <DialogSurface aria-label="Create target manually">
          <DialogBody>
            <DialogTitle>Create target manually</DialogTitle>
            <DialogContent>
              <Text block>
                One line per field: structure, field, type, length, importance (write “mandatory”
                for required), key flag (X for key). The first line names the columns.
              </Text>
              <Textarea
                aria-label="Target definition"
                value={manualText}
                onChange={(_, d) => setManualText(d.value)}
                rows={10}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
              {manualError && (
                <MessageBar intent="error">
                  <MessageBarBody>{manualError}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={applyManual}>
                Use this target
              </Button>
              <Button onClick={() => setManualOpen(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
