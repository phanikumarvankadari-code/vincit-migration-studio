import {
  Badge,
  Button,
  Checkbox,
  Input,
  MessageBar,
  MessageBarBody,
  OverlayDrawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { DataType } from '@mms/mapping-core';
import {
  DRAFT_TYPES,
  draftToMapping,
  emptyDraft,
  mappingToDraft,
  previewMapping,
  type DraftType,
  type MappingDraft,
  type MappingRow,
} from '@mms/studio-model';
import { useMemo, useState } from 'react';
import { SeverityBadge } from '../components/common';
import { useStudio } from '../context';
import {
  ConditionForm,
  ConstantForm,
  DirectForm,
  LookupForm,
  RoutineForm,
  settingsTemplate,
} from './forms';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  meta: { display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap', alignItems: 'center' },
  muted: { color: tokens.colorNeutralForeground3 },
  preview: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalS,
  },
});

export function MappingEditor({
  row,
  onClose,
  preset,
}: {
  row: MappingRow;
  onClose: () => void;
  /** Start on this mapping type when the field has no mapping yet. */
  preset?: 'constant';
}) {
  // Remount for every field so the draft always starts from the saved mapping.
  return (
    <EditorBody key={`${row.key}/${preset ?? ''}`} row={row} onClose={onClose} preset={preset} />
  );
}

function EditorBody({
  row,
  onClose,
  preset,
}: {
  row: MappingRow;
  onClose: () => void;
  preset: 'constant' | undefined;
}) {
  const s = useStyles();
  const { state, send, registry } = useStudio();
  const initial = useMemo<{ draft: MappingDraft | undefined; locked: boolean }>(() => {
    if (!row.mapping) {
      if (preset === 'constant') {
        const c = emptyDraft('constant', row.fieldId);
        const t = row.datatype as DataType;
        return {
          draft: c.type === 'constant' ? { ...c, datatype: t === 'unknown' ? 'string' : t } : c,
          locked: false,
        };
      }
      return { draft: emptyDraft('direct'), locked: false };
    }
    const d = mappingToDraft(state.project, row.mapping);
    return { draft: d, locked: d === undefined };
  }, [row, state.project, preset]);
  const [draft, setDraft] = useState<MappingDraft | undefined>(initial.draft);
  const [locked, setLocked] = useState(initial.locked);
  const targetStructure = state.project.targetDefinition?.structures.find(
    (x) => x.id === row.structureId,
  );
  const fieldFormat = targetStructure?.fields.find((f) => f.id === row.fieldId)?.dateFormat;
  const structureFormat = targetStructure?.dateFormat;
  const targetFormat = fieldFormat ?? structureFormat;
  const [needsReview, setNeedsReview] = useState(row.mapping?.status === 'needsReview');

  const result = useMemo(
    () =>
      draft
        ? draftToMapping(state.project, row.structureId, row.fieldId, draft, { needsReview })
        : undefined,
    [draft, state.project, row, needsReview],
  );
  const preview = useMemo(
    () =>
      result?.ok
        ? previewMapping(state, result.mapping, result.lookups, { routines: registry })
        : undefined,
    [result, state, registry],
  );

  const changeType = (type: DraftType) => {
    setLocked(false);
    setDraft(emptyDraft(type, row.fieldId));
  };

  const save = () => {
    if (!result?.ok) return;
    send({ type: 'mappingSaved', mapping: result.mapping, lookups: result.lookups });
    onClose();
  };

  return (
    <OverlayDrawer
      open
      position="end"
      size="large"
      onOpenChange={(_, d) => !d.open && onClose()}
      aria-label={`Edit mapping for ${row.fieldName}`}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" onClick={onClose} aria-label="Close editor">
              Close
            </Button>
          }
        >
          {row.structureName} › {row.fieldName}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className={s.stack} data-testid="mapping-editor">
          <div className={s.meta} data-testid="editor-target-meta">
            <Badge appearance="outline">{row.datatype}</Badge>
            {row.length !== undefined && <Badge appearance="outline">length {row.length}</Badge>}
            {row.required && <Badge color="danger">Required</Badge>}
            {row.isKey && <Badge color="brand">Key</Badge>}
            {row.technicalName && <Badge appearance="outline">{row.technicalName}</Badge>}
          </div>

          {(row.datatype === 'date' || row.datatype === 'dateTime') && (
            <label>
              <Text block weight="semibold">
                Date format of this field
              </Text>
              <Input
                aria-label="Target date format"
                placeholder={structureFormat ?? 'for example yyyy-MM-dd'}
                value={fieldFormat ?? ''}
                onChange={(_, d) =>
                  send({
                    type: 'targetFieldFormat',
                    structureId: row.structureId,
                    fieldId: row.fieldId,
                    dateFormat: d.value.trim() === '' ? null : d.value.trim(),
                  })
                }
              />
              <Text className={s.muted}>
                {structureFormat ? `Empty uses the structure default (${structureFormat}). ` : ''}
                Date Format steps start with this as their output format.
              </Text>
            </label>
          )}

          <label>
            <Text block weight="semibold">
              Mapping type
            </Text>
            <Select
              aria-label="Mapping type"
              value={draft?.type ?? ''}
              onChange={(_, d) => changeType(d.value as DraftType)}
            >
              {locked && <option value="">(this mapping cannot be edited here)</option>}
              {DRAFT_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>
          {draft && (
            <Text className={s.muted}>{DRAFT_TYPES.find((t) => t.type === draft.type)?.help}</Text>
          )}

          {locked && (
            <MessageBar intent="warning">
              <MessageBarBody>
                This mapping uses features this form cannot show (for example custom JavaScript or a
                combined condition). It is kept as it is. Choose a mapping type to replace it.
              </MessageBarBody>
            </MessageBar>
          )}

          {draft?.type === 'direct' && <DirectForm draft={draft} onChange={setDraft} />}
          {draft?.type === 'direct' && (row.datatype === 'date' || row.datatype === 'dateTime') && (
            <MessageBar intent="info" data-testid="date-direct-hint">
              <MessageBarBody>
                A direct mapping copies the source date as it is. If the source is written
                differently{targetFormat ? ` from ${targetFormat}` : ''}, convert it.{' '}
                <Button
                  size="small"
                  data-testid="convert-to-date-format"
                  onClick={() =>
                    setDraft({
                      type: 'routine',
                      source: draft.source,
                      steps: [
                        {
                          kind: 'routine',
                          routineId: 'date.convert',
                          configuration: settingsTemplate('date.convert', targetFormat),
                          onError: 'stop',
                        },
                      ],
                    })
                  }
                >
                  Convert with Date Format
                </Button>
              </MessageBarBody>
            </MessageBar>
          )}
          {draft?.type === 'constant' && <ConstantForm draft={draft} onChange={setDraft} />}
          {draft?.type === 'lookup' && <LookupForm draft={draft} onChange={setDraft} />}
          {draft?.type === 'conditional' && <ConditionForm draft={draft} onChange={setDraft} />}
          {draft?.type === 'routine' && (
            <RoutineForm draft={draft} onChange={setDraft} targetDateFormat={targetFormat} />
          )}

          {result && !result.ok && (
            <MessageBar intent="warning" data-testid="editor-problems">
              <MessageBarBody>
                <Text weight="semibold" block>
                  To save this mapping:
                </Text>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {result.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </MessageBarBody>
            </MessageBar>
          )}

          <div className={s.preview} data-testid="mapping-preview">
            <Text weight="semibold" block>
              Preview on the first rows
            </Text>
            {!preview && <Text className={s.muted}>Complete the mapping to see a preview.</Text>}
            {preview && !preview.ok && (
              <Text className={s.muted} data-testid="preview-message">
                {preview.message}
              </Text>
            )}
            {preview?.ok && (
              <table className="data" aria-label="Preview">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>
                      {preview.sourceLabels.length > 0 ? preview.sourceLabels.join(', ') : 'Source'}
                    </th>
                    <th>Result</th>
                    <th>Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.driverRow}>
                      <td>{r.driverRow}</td>
                      <td>
                        {r.sources.length === 0
                          ? ''
                          : r.sources
                              .map((v) => (v === null ? '⟨blank⟩' : v === '' ? '⟨empty⟩' : v))
                              .join(', ')}
                      </td>
                      <td data-testid={`preview-result-${r.driverRow}`}>
                        {r.value === null ? '⟨blank⟩' : r.value}
                      </td>
                      <td>
                        {r.issues.map((d, i) => (
                          <div key={i}>
                            <SeverityBadge severity={d.severity} /> {d.message}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Checkbox
            label="Needs review"
            checked={needsReview}
            onChange={(_, d) => setNeedsReview(d.checked === true)}
          />
        </div>
      </DrawerBody>
      <DrawerFooter>
        <Button appearance="primary" disabled={!result?.ok} onClick={save}>
          Save mapping
        </Button>
        {row.mapping && (
          <Button
            onClick={() => {
              send({ type: 'mappingRemoved', structureId: row.structureId, fieldId: row.fieldId });
              onClose();
            }}
          >
            Remove mapping
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}
