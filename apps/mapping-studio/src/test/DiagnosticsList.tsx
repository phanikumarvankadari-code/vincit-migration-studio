import { Button, Select, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { Diagnostic } from '@mms/mapping-core';
import type { DiagnosticGroup } from '@mms/test-engine';
import { useMemo, useState } from 'react';
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
  item: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    paddingBottom: tokens.spacingVerticalS,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

/**
 * All problems of the run, repeats collapsed. Each line says in plain words what is wrong; technical details can be
 * opened. A line with a row can jump to that row in the grid.
 */
export function DiagnosticsList({
  groups,
  diagnostics,
  structureName,
  fieldName,
  onShow,
}: {
  groups: readonly DiagnosticGroup[];
  diagnostics: readonly Diagnostic[];
  structureName: (id: string) => string;
  fieldName: (structureId: string, fieldId: string) => string;
  onShow: (structureId: string, row: number) => void;
}) {
  const s = useStyles();
  const [severity, setSeverity] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const shown = useMemo(
    () => groups.filter((g) => severity === 'all' || g.severity === severity),
    [groups, severity],
  );
  const counts = useMemo(
    () => ({
      error: groups.filter((g) => g.severity === 'error').length,
      warning: groups.filter((g) => g.severity === 'warning').length,
      info: groups.filter((g) => g.severity === 'info').length,
    }),
    [groups],
  );

  return (
    <div className={s.panel} data-testid="diagnostics-list" aria-label="Problems found">
      <div className={s.row}>
        <Text weight="semibold" size={400}>
          Problems
        </Text>
        <Text className={s.muted}>
          {counts.error} errors, {counts.warning} warnings, {counts.info} notes
        </Text>
        <div style={{ marginLeft: 'auto' }}>
          <Select
            aria-label="Show problems"
            value={severity}
            onChange={(_, d) => setSeverity(d.value as typeof severity)}
          >
            <option value="all">All</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="info">Notes</option>
          </Select>
        </div>
      </div>
      {shown.length === 0 && (
        <Text className={s.muted}>
          {groups.length === 0 ? 'No problems were found.' : 'Nothing with this severity.'}
        </Text>
      )}
      {shown.map((g, i) => {
        const example = diagnostics.find(
          (d) =>
            d.code === g.code &&
            d.severity === g.severity &&
            d.targetStructureId === g.targetStructureId &&
            d.targetFieldId === g.targetFieldId,
        );
        return (
          <div key={i} className={s.item} data-testid={`diagnostic-group-${g.code}`}>
            <div className={s.row}>
              <SeverityBadge severity={g.severity} />
              <Text weight="semibold">{g.message}</Text>
              {g.count > 1 && <Text className={s.muted}>({g.count} times)</Text>}
            </div>
            <Text className={s.muted}>
              {g.targetStructureId ? structureName(g.targetStructureId) : 'Whole project'}
              {g.targetStructureId && g.targetFieldId
                ? ` › ${fieldName(g.targetStructureId, g.targetFieldId)}`
                : ''}
              {g.firstTargetRow !== undefined ? ` · first at row ${g.firstTargetRow}` : ''}
            </Text>
            <div className={s.row}>
              {g.targetStructureId && g.firstTargetRow !== undefined && (
                <Button
                  size="small"
                  onClick={() => onShow(g.targetStructureId!, g.firstTargetRow!)}
                >
                  Show in grid
                </Button>
              )}
              <details>
                <summary>Technical details</summary>
                <Text className={s.muted} block>
                  Code: {g.code}
                  {example?.routineId ? ` · routine ${example.routineId}` : ''}
                  {example?.fieldMappingId ? ` · mapping ${example.fieldMappingId}` : ''}
                  {example?.sourceRow !== undefined ? ` · source row ${example.sourceRow}` : ''}
                  {example?.sourceValue !== undefined && example.sourceValue !== null
                    ? ` · source value "${example.sourceValue}"`
                    : ''}
                  {example?.technicalDetails ? ` · ${example.technicalDetails}` : ''}
                </Text>
              </details>
            </div>
          </div>
        );
      })}
    </div>
  );
}
