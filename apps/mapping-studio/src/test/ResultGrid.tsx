import { Text, makeStyles, tokens } from '@fluentui/react-components';
import type { Diagnostic, TargetStructure } from '@mms/mapping-core';
import type { RowStatus, TargetOutput } from '@mms/transformation-engine';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef } from 'react';

const ROW_H = 32;
const NUM_W = 64;
const STATUS_W = 92;
const COL_W = 150;

const useStyles = makeStyles({
  scroll: {
    height: '440px',
    overflow: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    position: 'relative',
  },
  head: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    display: 'grid',
    height: `${ROW_H}px`,
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  row: {
    display: 'grid',
    position: 'absolute',
    left: 0,
    height: `${ROW_H}px`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  cell: {
    padding: '6px 8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '13px',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  headCell: {
    padding: '6px 8px',
    fontWeight: 600,
    fontSize: '12px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  muted: { color: tokens.colorNeutralForeground4, fontStyle: 'italic' },
  selected: {
    outline: `2px solid ${tokens.colorBrandStroke1}`,
    outlineOffset: '-2px',
    backgroundColor: tokens.colorBrandBackground2,
  },
  error: { backgroundColor: '#fde7e9' },
  warning: { backgroundColor: '#fff4ce' },
  empty: { padding: tokens.spacingVerticalL, color: tokens.colorNeutralForeground3 },
});

const STATUS_TEXT: Record<RowStatus, string> = {
  ready: 'Ready',
  warning: 'Warning',
  error: 'Error',
};
const STATUS_STYLE: Record<RowStatus, { bg: string; fg: string }> = {
  ready: { bg: '#e6f4ea', fg: '#1e6b34' },
  warning: { bg: '#fff4ce', fg: '#7a5800' },
  error: { bg: '#fde7e9', fg: '#a4262c' },
};

export interface CellRef {
  /** 1-based output row. */
  row: number;
  /** 0-based field index. */
  col: number;
}

export function ResultGrid({
  output,
  structure,
  filter,
  diagnostics,
  selected,
  inspectedRow,
  onSelectCell,
  onInspectRow,
  scrollToRow,
}: {
  output: TargetOutput;
  structure: TargetStructure;
  filter: RowStatus | 'all';
  diagnostics: readonly Diagnostic[];
  selected: CellRef | undefined;
  inspectedRow: number | undefined;
  onSelectCell: (c: CellRef) => void;
  onInspectRow: (row: number) => void;
  scrollToRow: { row: number; nonce: number } | undefined;
}) {
  const s = useStyles();
  const parentRef = useRef<HTMLDivElement>(null);
  const fields = structure.fields;
  const template = `${NUM_W}px ${STATUS_W}px repeat(${fields.length}, ${COL_W}px)`;
  const width = NUM_W + STATUS_W + COL_W * fields.length;

  // Output rows (1-based) that pass the status filter.
  const indices = useMemo(() => {
    const out: number[] = [];
    output.rowStatus.forEach((st, i) => {
      if (filter === 'all' || st === filter) out.push(i);
    });
    return out;
  }, [output.rowStatus, filter]);

  // Cells with their own problem are tinted.
  const cellSeverity = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const d of diagnostics) {
      if (
        d.targetStructureId !== structure.id ||
        d.targetRow === undefined ||
        d.targetFieldId === undefined ||
        d.severity === 'info'
      )
        continue;
      const key = `${d.targetRow}/${d.targetFieldId}`;
      if (m.get(key) !== 'error') m.set(key, d.severity);
    }
    return m;
  }, [diagnostics, structure.id]);

  // TanStack Virtual returns functions that React Compiler cannot memoize; nothing here relies on the compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: indices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  useEffect(() => {
    if (!scrollToRow) return;
    const pos = indices.indexOf(scrollToRow.row - 1);
    if (pos >= 0) virtual.scrollToIndex(pos, { align: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToRow]);

  if (indices.length === 0) {
    return (
      <div className={s.scroll} data-testid="result-grid-empty">
        <Text className={s.empty} block>
          {output.rows.rows.length === 0
            ? 'This structure produced no rows.'
            : 'No rows have this status.'}
        </Text>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={s.scroll}
      role="grid"
      aria-label={`Results for ${structure.name}`}
      aria-rowcount={indices.length + 1}
      data-testid="result-grid"
    >
      <div style={{ width, minWidth: '100%' }}>
        <div className={s.head} role="row" style={{ gridTemplateColumns: template, width }}>
          <div className={s.headCell} role="columnheader">
            Row
          </div>
          <div className={s.headCell} role="columnheader">
            Status
          </div>
          {fields.map((f) => (
            <div
              key={f.id}
              className={s.headCell}
              role="columnheader"
              title={`${f.displayName} · ${f.datatype}${f.length ? ` (${f.length})` : ''}${f.required ? ' · required' : ''}${f.isKey ? ' · key' : ''}${f.technicalName ? ` · ${f.technicalName}` : ''}`}
            >
              {f.displayName}
              {f.required ? ' *' : ''}
              {f.isKey ? ' (key)' : ''}
            </div>
          ))}
        </div>
        <div style={{ height: virtual.getTotalSize(), position: 'relative', width }}>
          {virtual.getVirtualItems().map((v) => {
            const i = indices[v.index]!;
            const rowNo = i + 1;
            const st = output.rowStatus[i]!;
            const values = output.rows.rows[i]!;
            return (
              <div
                key={v.key}
                className={s.row}
                role="row"
                aria-rowindex={v.index + 2}
                data-row={rowNo}
                style={{
                  top: v.start,
                  gridTemplateColumns: template,
                  width,
                  backgroundColor:
                    inspectedRow === rowNo ? tokens.colorNeutralBackground1Selected : undefined,
                }}
              >
                <div
                  className={s.cell}
                  role="rowheader"
                  onClick={() => onInspectRow(rowNo)}
                  title="Inspect this row"
                  data-testid={`rownum-${rowNo}`}
                >
                  {rowNo}
                </div>
                <div
                  className={s.cell}
                  role="gridcell"
                  style={{ color: STATUS_STYLE[st].fg, fontWeight: 600 }}
                  data-testid={`rowstatus-${rowNo}`}
                >
                  <span
                    style={{ background: STATUS_STYLE[st].bg, borderRadius: 4, padding: '1px 6px' }}
                  >
                    {STATUS_TEXT[st]}
                  </span>
                </div>
                {fields.map((f, c) => {
                  const v2 = values[c];
                  const sev = cellSeverity.get(`${rowNo}/${f.id}`);
                  const isSel = selected?.row === rowNo && selected.col === c;
                  return (
                    <div
                      key={f.id}
                      role="gridcell"
                      aria-selected={isSel}
                      tabIndex={-1}
                      className={`${s.cell} ${sev === 'error' ? s.error : sev === 'warning' ? s.warning : ''} ${isSel ? s.selected : ''}`}
                      data-testid={`cell-${rowNo}-${f.displayName}`}
                      onClick={() => onSelectCell({ row: rowNo, col: c })}
                    >
                      {v2 === null || v2 === undefined ? (
                        <span className={s.muted}>blank</span>
                      ) : v2 === '' ? (
                        <span className={s.muted}>empty</span>
                      ) : (
                        v2
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
