import { Badge, Input, Select, Text, makeStyles, tokens } from '@fluentui/react-components';
import { filterRows, type MappingRow, type MappingStatus, type RowFilter } from '@mms/studio-model';
import { useMemo, useState } from 'react';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'end',
    flexWrap: 'wrap',
    marginBottom: tokens.spacingVerticalM,
  },
  wrap: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'auto',
    maxHeight: '60vh',
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

const STATUS_LABEL: Record<MappingStatus, string> = {
  mapped: 'Mapped',
  needsReview: 'Needs review',
  unmapped: 'Unmapped',
  error: 'Error',
};
const STATUS_COLOR: Record<MappingStatus, 'success' | 'warning' | 'subtle' | 'danger'> = {
  mapped: 'success',
  needsReview: 'warning',
  unmapped: 'subtle',
  error: 'danger',
};

export function StatusPill({ status }: { status: MappingStatus }) {
  return (
    <Badge appearance="tint" color={STATUS_COLOR[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function MappingTable({
  rows,
  structures,
  filter,
  onFilter,
  selectedKey,
  onSelect,
}: {
  rows: readonly MappingRow[];
  structures: readonly { id: string; name: string }[];
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
  selectedKey: string | undefined;
  onSelect: (r: MappingRow) => void;
}) {
  const s = useStyles();
  const [search, setSearch] = useState(filter.search ?? '');
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  return (
    <div>
      <div className={s.bar}>
        <label>
          <Text block>Structure</Text>
          <Select
            aria-label="Filter by structure"
            value={filter.structureId ?? ''}
            onChange={(_, d) => onFilter({ ...filter, structureId: d.value || undefined })}
          >
            <option value="">All structures</option>
            {structures.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <Text block>Status</Text>
          <Select
            aria-label="Filter by status"
            value={filter.status ?? ''}
            onChange={(_, d) =>
              onFilter({ ...filter, status: (d.value || undefined) as RowFilter['status'] })
            }
          >
            <option value="">All</option>
            <option value="requiredUnmapped">Required and unmapped</option>
            <option value="unmapped">Unmapped</option>
            <option value="mapped">Mapped</option>
            <option value="needsReview">Needs review</option>
            <option value="error">Error</option>
          </Select>
        </label>
        <label>
          <Text block>Search</Text>
          <Input
            aria-label="Search fields"
            value={search}
            onChange={(_, d) => {
              setSearch(d.value);
              onFilter({ ...filter, search: d.value || undefined });
            }}
          />
        </label>
        <Text className={s.muted} data-testid="table-count">
          {shown.length} of {rows.length} fields
        </Text>
      </div>
      <div className={s.wrap}>
        <table className="data" aria-label="Mapping table">
          <thead>
            <tr>
              <th>Target structure</th>
              <th>Target field</th>
              <th>Required</th>
              <th>Source / value</th>
              <th>Transformation</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.key}
                className={`clickable ${selectedKey === r.key ? 'selected' : ''}`}
                tabIndex={0}
                aria-label={`${r.structureName} ${r.fieldName}`}
                data-testid={`row-${r.structureName}-${r.fieldName}`}
                onClick={() => onSelect(r)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(r)}
              >
                <td>{r.structureName}</td>
                <td>
                  {r.fieldName}{' '}
                  {r.isKey && (
                    <Badge size="small" appearance="outline">
                      Key
                    </Badge>
                  )}
                </td>
                <td>
                  {r.required && (
                    <Badge
                      size="small"
                      color={r.status === 'unmapped' ? 'danger' : 'subtle'}
                      appearance={r.status === 'unmapped' ? 'filled' : 'tint'}
                    >
                      Required
                    </Badge>
                  )}
                </td>
                <td>{r.source}</td>
                <td>{r.transformation}</td>
                <td data-testid={`status-${r.structureName}-${r.fieldName}`}>
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
