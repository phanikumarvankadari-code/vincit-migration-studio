import { Badge, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { CellLineage, Diagnostic, Project, TargetField } from '@mms/mapping-core';
import { builtInRoutines } from '@mms/routine-library';
import { SeverityBadge } from '../components/common';

const useStyles = makeStyles({
  panel: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalS,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  arrow: { textAlign: 'center', color: tokens.colorNeutralForeground3, lineHeight: 1 },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  value: { fontFamily: 'monospace' },
});

const show = (v: string | null): string =>
  v === null ? '⟨blank⟩' : v === '' ? '⟨empty⟩' : `"${v}"`;

const KIND_LABEL: Record<string, string> = {
  source: 'Source value',
  constant: 'Constant',
  lookup: 'Lookup',
  condition: 'Condition',
  routine: 'Routine',
  javascript: 'JavaScript',
};

/**
 * Explains where a target value came from, from the final value down to the source cells (SPEC-026).
 * The most recent step is on top, the original source value at the bottom.
 */
export function LineagePanel({
  project,
  field,
  row,
  value,
  lineage,
  lineageRecorded,
  issues,
}: {
  project: Project;
  field: TargetField;
  row: number;
  value: string | null;
  lineage: CellLineage | undefined;
  lineageRecorded: boolean;
  issues: readonly Diagnostic[];
}) {
  const s = useStyles();
  const routineNames = new Map(builtInRoutines().map((r) => [r.id as string, r.name]));
  const fieldNames = new Map<string, string>();
  for (const src of project.sourceDefinitions)
    for (const d of src.datasets)
      for (const f of d.fields) fieldNames.set(f.id, `${d.name}.${f.displayName}`);
  const lookupName = (id: string): string => project.lookups.find((l) => l.id === id)?.name ?? id;
  const stepTitle = (kind: string, ref: string | undefined): string => {
    if (kind === 'routine' && ref) return `${KIND_LABEL.routine}: ${routineNames.get(ref) ?? ref}`;
    if (kind === 'lookup' && ref) return `${KIND_LABEL.lookup}: ${lookupName(ref)}`;
    if (kind === 'condition') return `${KIND_LABEL.condition}${ref ? ` (${ref})` : ''}`;
    return KIND_LABEL[kind] ?? kind;
  };
  const steps = lineage ? [...lineage.steps].reverse() : [];

  return (
    <div className={s.panel} data-testid="lineage-panel" aria-label="Where this value came from">
      <Text weight="semibold" size={400}>
        {field.displayName}, row {row}
      </Text>
      <div className={s.card} data-testid="lineage-final">
        <Text className={s.muted}>Final value</Text>
        <Text className={s.value} weight="semibold">
          {show(value)}
        </Text>
      </div>
      {issues.length > 0 && (
        <div data-testid="lineage-issues">
          {issues.map((d, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <SeverityBadge severity={d.severity} /> <Text>{d.message}</Text>
              <details>
                <summary>Technical details</summary>
                <Text className={s.muted} block>
                  Code: {d.code}
                  {d.routineId ? ` · routine ${d.routineId}` : ''}
                  {d.technicalDetails ? ` · ${d.technicalDetails}` : ''}
                </Text>
              </details>
            </div>
          ))}
        </div>
      )}
      {!lineage && (
        <Text className={s.muted} data-testid="lineage-missing">
          {lineageRecorded
            ? 'This cell has no mapping, so it has no source: its value is blank.'
            : 'Lineage was not recorded for this run (it is only kept for samples of up to 1,000 rows). Run a smaller sample to trace values.'}
        </Text>
      )}
      {steps.map((st, i) => (
        <div key={i}>
          <div className={s.arrow}>↑</div>
          <div className={s.card} data-testid={`lineage-step-${steps.length - i}`}>
            <Text weight="semibold">{stepTitle(st.kind, st.ref)}</Text>
            <Text className={s.value}>
              {show(st.input)} → {show(st.output)}
            </Text>
            {st.note && <Text className={s.muted}>{st.note}</Text>}
          </div>
        </div>
      ))}
      {lineage?.sources.map((src, i) => (
        <div key={i}>
          <div className={s.arrow}>↑</div>
          <div className={s.card} data-testid={`lineage-source-${i + 1}`}>
            <div>
              <Badge appearance="outline" size="small">
                Source
              </Badge>{' '}
              <Text weight="semibold">{fieldNames.get(src.fieldId) ?? src.fieldId}</Text>
            </div>
            <Text className={s.muted}>
              {src.sourceRow !== undefined
                ? `Row ${src.sourceRow} of the dataset`
                : 'No matching row'}
            </Text>
            <Text className={s.value}>Original value: {show(src.value)}</Text>
          </div>
        </div>
      ))}
    </div>
  );
}
