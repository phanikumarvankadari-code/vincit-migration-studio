import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { filterRows, type MappingRow, type MappingStatus, type RowFilter } from '@mms/studio-model';
import { useMemo, useState } from 'react';
import { ConflictTag } from '../components/confidence';
import { useStudio } from '../context';

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
  onHardCode,
}: {
  rows: readonly MappingRow[];
  structures: readonly { id: string; name: string }[];
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
  selectedKey: string | undefined;
  onSelect: (r: MappingRow) => void;
  /** Open the editor on the Constant type for a field that nothing fills. */
  onHardCode?: (r: MappingRow) => void;
}) {
  const s = useStyles();
  const { conflictsByField, deleteMappings } = useStudio();
  const [search, setSearch] = useState(filter.search ?? '');
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shown = useMemo(
    () => filterRows(rows, filter).filter((r) => !onlyConflicts || conflictsByField.has(r.fieldId)),
    [rows, filter, onlyConflicts, conflictsByField],
  );
  const mappedShown = shown.filter((r) => r.mapping);
  const pickedRows = mappedShown.filter((r) => picked.has(r.key));
  const allPicked = mappedShown.length > 0 && pickedRows.length === mappedShown.length;
  const conflictCount = rows.filter((r) => conflictsByField.has(r.fieldId)).length;

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
          <Text block>Conflicts</Text>
          <Select
            aria-label="Filter by conflicts"
            value={onlyConflicts ? 'has' : ''}
            onChange={(_, d) => setOnlyConflicts(d.value === 'has')}
          >
            <option value="">All</option>
            <option value="has">Has conflicts ({conflictCount})</option>
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
        <Button
          disabled={pickedRows.length === 0}
          onClick={() => setConfirmDelete(true)}
          data-testid="delete-selected"
        >
          Delete selected ({pickedRows.length})
        </Button>
      </div>
      <div className={s.wrap}>
        <table className="data" aria-label="Mapping table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <Checkbox
                  aria-label="Select all mapped fields"
                  checked={allPicked}
                  disabled={mappedShown.length === 0}
                  onChange={(_, d) =>
                    setPicked(
                      d.checked === true ? new Set(mappedShown.map((r) => r.key)) : new Set(),
                    )
                  }
                />
              </th>
              <th>Target structure</th>
              <th>Target field</th>
              <th>Required</th>
              <th>Source / value</th>
              <th>Transformation</th>
              <th>Conflicts</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const conflicts = conflictsByField.get(r.fieldId) ?? [];
              return (
                <tr
                  key={r.key}
                  className={`clickable ${selectedKey === r.key ? 'selected' : ''}`}
                  tabIndex={0}
                  aria-label={`${r.structureName} ${r.fieldName}`}
                  data-testid={`row-${r.structureName}-${r.fieldName}`}
                  onClick={() => onSelect(r)}
                  onKeyDown={(e) =>
                    e.target === e.currentTarget &&
                    (e.key === 'Enter' || e.key === ' ') &&
                    onSelect(r)
                  }
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.mapping && (
                      <Checkbox
                        aria-label={`Select ${r.fieldName}`}
                        checked={picked.has(r.key)}
                        onChange={(_, d) =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (d.checked === true) next.add(r.key);
                            else next.delete(r.key);
                            return next;
                          })
                        }
                      />
                    )}
                  </td>
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
                  <td data-testid={`conflicts-${r.structureName}-${r.fieldName}`}>
                    {conflicts.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <ConflictTag
                          count={conflicts.length}
                          title={conflicts.map((c) => c.message).join('\n')}
                        />
                        {conflicts.map((c) => (
                          <span key={c.id} style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {c.message}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td data-testid={`status-${r.structureName}-${r.fieldName}`}>
                    <StatusPill status={r.status} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {!r.mapping && onHardCode && (
                      <Button
                        size="small"
                        aria-label={`Hard-code ${r.structureName} ${r.fieldName}`}
                        onClick={() => onHardCode(r)}
                      >
                        Hard-code
                      </Button>
                    )}
                    {r.mapping && (
                      <Button
                        size="small"
                        aria-label={`Delete ${r.structureName} ${r.fieldName}`}
                        onClick={() => {
                          deleteMappings([{ structureId: r.structureId, fieldId: r.fieldId }]);
                          setPicked((cur) => {
                            const next = new Set(cur);
                            next.delete(r.key);
                            return next;
                          });
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Dialog open={confirmDelete} onOpenChange={(_, d) => !d.open && setConfirmDelete(false)}>
        <DialogSurface aria-label="Delete mappings">
          <DialogBody>
            <DialogTitle>Delete {pickedRows.length} mappings?</DialogTitle>
            <DialogContent>
              {pickedRows
                .map((r) => r.fieldName)
                .slice(0, 6)
                .join(', ')}
              {pickedRows.length > 6 ? ', …' : ''}. You can undo this right after.
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => {
                  deleteMappings(
                    pickedRows.map((r) => ({ structureId: r.structureId, fieldId: r.fieldId })),
                  );
                  setPicked(new Set());
                  setConfirmDelete(false);
                }}
              >
                Delete
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
