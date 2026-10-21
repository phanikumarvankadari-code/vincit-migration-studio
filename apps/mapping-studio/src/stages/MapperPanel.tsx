import {
  Badge,
  Button,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { SourceDataset } from '@mms/mapping-core';
import { suggestMappings, type MappingSuggestion } from '@mms/mapping-suggest';
import {
  applySuggestions,
  connectFields,
  disconnectTarget,
  sourceNodeId,
  targetNodeId,
} from '@mms/studio-model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nowIso, useStudio } from '../context';
import { StatusPill } from './MappingTable';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    alignItems: 'end',
    flexWrap: 'wrap',
    margin: `${tokens.spacingVerticalM} 0`,
  },
  wrap: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 200px minmax(0, 1fr)',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  pane: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  paneHead: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    padding: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  scroll: { overflowY: 'auto', maxHeight: '520px', minHeight: '260px' },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    width: '100%',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground3,
    border: 'none',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    cursor: 'pointer',
    userSelect: 'none',
    minHeight: '34px',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  selected: { backgroundColor: tokens.colorBrandBackground2 },
  fieldName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  muted: { color: tokens.colorNeutralForeground3 },
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' },
  pill: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'auto',
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    maxWidth: '150px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    zIndex: 2,
  },
  panel: {
    marginTop: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  suggestion: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: `${tokens.spacingVerticalXS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
});

interface Seg {
  id: string;
  d: string;
  dim: boolean;
}
interface Item {
  key: string;
  kind: 'mapping' | 'suggestion';
  targetFieldId: string;
  segs: Seg[];
  pill?: { x: number; y: number; label: string };
}

const STRONG = 0.7;
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const curve = (x1: number, y1: number, x2: number, y2: number): string => {
  const xm = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${xm} ${y1}, ${xm} ${y2}, ${x2} ${y2}`;
};
const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * Two-panel mapper (SPEC-031): sources on the left, one target structure on the right, lines between them.
 * It draws the canonical mapping and edits it through the same project functions as the Mapping Table.
 */
export function MapperPanel({
  onEditField,
}: {
  onEditField: (structureId: string, fieldId: string) => void;
}) {
  const s = useStyles();
  const { state, send, rows, profiles } = useStudio();
  const project = state.project;
  const structures = project.targetDefinition?.structures ?? [];
  const datasets = useMemo<SourceDataset[]>(
    () => project.sourceDefinitions.flatMap((d) => d.datasets),
    [project.sourceDefinitions],
  );

  const [structureId, setStructureId] = useState<string>(structures[0]?.id ?? '');
  const [srcSearch, setSrcSearch] = useState('');
  const [tgtSearch, setTgtSearch] = useState('');
  const [tgtFilter, setTgtFilter] = useState<'all' | 'unmapped' | 'requiredUnmapped'>('all');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedTarget, setSelectedTarget] = useState<string | undefined>();
  const [focusSuggestion, setFocusSuggestion] = useState<string | undefined>();
  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | undefined>();
  const [drag, setDrag] = useState<{ path: string } | undefined>();
  const [message, setMessage] = useState<{ intent: 'error' | 'info'; text: string } | undefined>();
  const [items, setItems] = useState<Item[]>([]);

  const structure = structures.find((x) => x.id === structureId) ?? structures[0];
  const mappings = useMemo(
    () => project.mappingDefinition.mappings.filter((m) => m.targetStructureId === structure?.id),
    [project.mappingDefinition.mappings, structure?.id],
  );
  const rowOf = useMemo(
    () =>
      new Map(
        rows.filter((r) => r.structureId === structure?.id).map((r) => [r.fieldId, r] as const),
      ),
    [rows, structure?.id],
  );
  const usedSources = useMemo(
    () => new Set(mappings.flatMap((m) => m.sourceReferences.map((r) => r.fieldId as string))),
    [mappings],
  );
  const mappedTargets = useMemo(
    () => new Set(mappings.map((m) => m.targetFieldId as string)),
    [mappings],
  );
  const openSuggestions = useMemo(
    () =>
      (suggestions ?? []).filter(
        (x) => x.targetStructureId === structure?.id && !mappedTargets.has(x.targetFieldId),
      ),
    [suggestions, structure?.id, mappedTargets],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) anchors.current.set(key, el);
    else anchors.current.delete(key);
  };

  const q = srcSearch.trim().toLowerCase();
  const visibleSources = (d: SourceDataset) =>
    d.fields.filter(
      (f) =>
        q === '' ||
        f.displayName.toLowerCase().includes(q) ||
        (f.technicalName ?? '').toLowerCase().includes(q),
    );
  const tq = tgtSearch.trim().toLowerCase();
  const visibleTargets = (structure?.fields ?? []).filter((f) => {
    if (
      tq &&
      !f.displayName.toLowerCase().includes(tq) &&
      !(f.technicalName ?? '').toLowerCase().includes(tq)
    )
      return false;
    if (tgtFilter === 'unmapped') return !mappedTargets.has(f.id);
    if (tgtFilter === 'requiredUnmapped') return f.required && !mappedTargets.has(f.id);
    return true;
  });

  // Where every line starts and ends, measured from the rows on screen. A row that is hidden or scrolled out of
  // sight keeps its line, pinned to the edge of its panel (or to the dataset header).
  const measure = () => {
    const wrap = wrapRef.current;
    const lp = leftRef.current;
    const rp = rightRef.current;
    if (!wrap || !lp || !rp || !structure) return;
    const w = wrap.getBoundingClientRect();
    const L = lp.getBoundingClientRect();
    const R = rp.getBoundingClientRect();
    const find = (keys: string[], pane: DOMRect) => {
      for (const k of keys) {
        const el = anchors.current.get(k);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const y = Math.min(Math.max(mid, pane.top + 6), pane.bottom - 6);
        return { y: y - w.top, dim: mid < pane.top || mid > pane.bottom };
      }
      return undefined;
    };
    const xs = L.right - w.left;
    const xt = R.left - w.left;
    const next: Item[] = [];
    for (const m of mappings) {
      const t = find([`t:${m.targetFieldId}`], R);
      if (!t) continue;
      const fn =
        m.mappingType !== 'direct' || m.transformations.length > 0
          ? (rowOf.get(m.targetFieldId)?.transformation ?? m.mappingType)
          : undefined;
      const px = xt - 100;
      const segs: Seg[] = [];
      for (const ref of m.sourceReferences) {
        const ds = datasets.find((d) => d.id === ref.datasetId);
        const a = find([`s:${ref.fieldId}`, `sd:${ds?.id ?? ''}`], L);
        if (!a) continue;
        segs.push({
          id: `${m.id}|${ref.fieldId}`,
          d: fn ? curve(xs, a.y, px, t.y) : curve(xs, a.y, xt, t.y),
          dim: a.dim || t.dim,
        });
      }
      if (fn) segs.push({ id: `${m.id}|out`, d: `M ${px} ${t.y} L ${xt} ${t.y}`, dim: t.dim });
      next.push({
        key: m.id,
        kind: 'mapping',
        targetFieldId: m.targetFieldId,
        segs,
        ...(fn ? { pill: { x: px, y: t.y, label: fn } } : {}),
      });
    }
    for (const sg of openSuggestions) {
      const ds = datasets.find((d) => d.id === sg.datasetId);
      const a = find([`s:${sg.sourceFieldId}`, `sd:${ds?.id ?? ''}`], L);
      const t = find([`t:${sg.targetFieldId}`], R);
      if (!a || !t) continue;
      next.push({
        key: `sg-${sg.id}`,
        kind: 'suggestion',
        targetFieldId: sg.targetFieldId,
        segs: [{ id: `sg-${sg.id}`, d: curve(xs, a.y, xt, t.y), dim: a.dim || t.dim }],
        pill: { x: (xs + xt) / 2, y: (a.y + t.y) / 2, label: pct(sg.score) },
      });
    }
    const key = (list: Item[]) =>
      JSON.stringify(
        list.map((i) => [
          i.key,
          i.segs.map((g) => [
            g.id,
            g.d.replace(/-?\d+(\.\d+)?/g, (n) => String(round(Number(n)))),
            g.dim,
          ]),
          i.pill && [round(i.pill.x), round(i.pill.y), i.pill.label],
        ]),
      );
    setItems((cur) => (key(cur) === key(next) ? cur : next));
  };
  const measureRef = useRef(measure);
  // Measure after every render; the guard above stops it when nothing moved.
  useLayoutEffect(() => {
    measureRef.current = measure;
    measure();
  });
  useEffect(() => {
    const again = () => measureRef.current();
    const left = leftRef.current;
    const right = rightRef.current;
    left?.addEventListener('scroll', again);
    right?.addEventListener('scroll', again);
    window.addEventListener('resize', again);
    const ro = new ResizeObserver(again);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      left?.removeEventListener('scroll', again);
      right?.removeEventListener('scroll', again);
      window.removeEventListener('resize', again);
      ro.disconnect();
    };
  }, []);

  const connect = useCallback(
    (sourceFieldId: string, targetFieldId: string) => {
      if (!structure) return;
      const r = connectFields(
        project,
        structure.id,
        sourceNodeId(sourceFieldId),
        targetNodeId(targetFieldId),
        nowIso(),
      );
      setSelectedSource(undefined);
      if (r.ok) {
        send({ type: 'projectEdited', project: r.project });
        setSelectedTarget(targetFieldId);
        setMessage({ intent: 'info', text: 'Mapping created.' });
      } else setMessage({ intent: 'error', text: r.message });
    },
    [project, structure, send],
  );

  // A source field is dragged by pointer. A press without movement just selects it (then click a target).
  const press = useRef<{ fieldId: string; x: number; y: number; moved: boolean } | undefined>(
    undefined,
  );
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
      p.moved = true;
      const from = anchors.current.get(`s:${p.fieldId}`)?.getBoundingClientRect();
      const w = wrapRef.current?.getBoundingClientRect();
      const l = leftRef.current?.getBoundingClientRect();
      if (from && w && l)
        setDrag({
          path: curve(
            l.right - w.left,
            from.top + from.height / 2 - w.top,
            e.clientX - w.left,
            e.clientY - w.top,
          ),
        });
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      press.current = undefined;
      if (!p) return;
      if (p.moved) {
        setDrag(undefined);
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-target-field]');
        if (hit) connect(p.fieldId, hit.getAttribute('data-target-field')!);
      } else {
        setSelectedSource((cur) => (cur === p.fieldId ? undefined : p.fieldId));
        setSelectedTarget(undefined);
        setMessage(undefined);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [connect]);

  // Delete removes the mapping of the selected target field (not while typing in a box).
  const removeSelected = useCallback(() => {
    if (!structure || !selectedTarget) return;
    const r = disconnectTarget(project, structure.id, selectedTarget, nowIso());
    if (r.ok) {
      send({ type: 'projectEdited', project: r.project });
      setMessage({ intent: 'info', text: 'Mapping removed.' });
      setSelectedTarget(undefined);
    }
  }, [project, structure, selectedTarget, send]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)))
        return;
      removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeSelected]);

  const accept = (list: MappingSuggestion[]) => {
    const r = applySuggestions(
      project,
      list.map((x) => ({
        structureId: x.targetStructureId,
        targetFieldId: x.targetFieldId,
        sourceFieldId: x.sourceFieldId,
      })),
      nowIso(),
    );
    if (r.applied > 0) send({ type: 'projectEdited', project: r.project });
    setMessage({
      intent: 'info',
      text: `${r.applied} mapping${r.applied === 1 ? '' : 's'} created${r.skipped ? `, ${r.skipped} skipped` : ''}.`,
    });
  };
  const suggest = () => {
    if (!structure) return;
    const found = suggestMappings(project, { structureId: structure.id, data: state.data });
    setSuggestions(found);
    setMessage({
      intent: 'info',
      text:
        found.length === 0
          ? 'No suggestions: nothing unmapped looks like a source field.'
          : `${found.length} suggestion${found.length === 1 ? '' : 's'}. Nothing is mapped until you accept it.`,
    });
  };

  const fieldName = (fieldId: string): string => {
    for (const d of datasets) {
      const f = d.fields.find((x) => x.id === fieldId);
      if (f) return `${d.name}.${f.displayName}`;
    }
    return fieldId;
  };

  const selRow = selectedTarget ? rowOf.get(selectedTarget) : undefined;

  return (
    <div data-testid="mapper">
      <div className={s.bar}>
        <label>
          <Text block>Structure</Text>
          <Select
            aria-label="Structure"
            value={structure?.id ?? ''}
            onChange={(_, d) => {
              setStructureId(d.value);
              setSelectedTarget(undefined);
              setSelectedSource(undefined);
              setMessage(undefined);
            }}
          >
            {structures.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </label>
        <Button appearance="primary" onClick={suggest}>
          Suggest mappings
        </Button>
        <Text className={s.muted}>
          Drag a source field onto a target field, or click one and then the other. Click a target
          field or a line to edit or remove its mapping.
        </Text>
      </div>
      {message && (
        <MessageBar
          intent={message.intent === 'error' ? 'error' : 'info'}
          data-testid="graph-message"
        >
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}
      {selectedSource && (
        <MessageBar intent="info" data-testid="pick-target">
          <MessageBarBody>
            {fieldName(selectedSource)} is selected. Click the target field to map it to.
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={s.wrap} ref={wrapRef}>
        <div className={s.pane}>
          <div className={s.paneHead}>
            <Text weight="semibold">Sources</Text>
            <Input
              size="small"
              placeholder="Search source fields"
              aria-label="Search source fields"
              value={srcSearch}
              onChange={(_, d) => setSrcSearch(d.value)}
            />
          </div>
          <div className={s.scroll} ref={leftRef} data-testid="source-pane">
            {datasets.length === 0 && (
              <Text className={s.muted} block style={{ padding: tokens.spacingVerticalM }}>
                No source files yet. Add them in Sources.
              </Text>
            )}
            {datasets.map((d) => {
              const isCollapsed = collapsed.has(d.id);
              const shown = visibleSources(d);
              return (
                <div key={d.id}>
                  <button
                    type="button"
                    className={s.group}
                    ref={reg(`sd:${d.id}`)}
                    aria-expanded={!isCollapsed}
                    data-testid={`dataset-group-${d.name}`}
                    onClick={() =>
                      setCollapsed((cur) => {
                        const next = new Set(cur);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      })
                    }
                  >
                    <span aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                    <Text weight="semibold">{d.name}</Text>
                    <Text size={200} className={s.muted}>
                      {d.fields.length} fields
                    </Text>
                  </button>
                  {!isCollapsed &&
                    shown.map((f) => {
                      const fill = profiles.get(d.id)?.fields.find((x) => x.fieldId === f.id);
                      return (
                        <div
                          key={f.id}
                          ref={reg(`s:${f.id}`)}
                          className={`${s.field} ${selectedSource === f.id ? s.selected : ''}`}
                          data-testid={`src-${f.id}`}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            press.current = {
                              fieldId: f.id,
                              x: e.clientX,
                              y: e.clientY,
                              moved: false,
                            };
                          }}
                        >
                          <span className={s.fieldName}>
                            <Text>{f.displayName}</Text>{' '}
                            <Text size={200} className={s.muted}>
                              {f.technicalName ? `${f.technicalName} · ` : ''}
                              {f.datatype}
                              {f.length ? `(${f.length})` : ''}
                            </Text>
                          </span>
                          {f.isKey && (
                            <Badge size="small" appearance="outline">
                              Key
                            </Badge>
                          )}
                          {fill && (
                            <Text size={200} className={s.muted} title="Share of rows with a value">
                              {fill.fillPercentage}%
                            </Text>
                          )}
                          {usedSources.has(f.id) && (
                            <span title="Used by a mapping" aria-label="Used by a mapping">
                              ●
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>

        <div aria-hidden />

        <div className={s.pane}>
          <div className={s.paneHead}>
            <Text weight="semibold">{structure?.name ?? 'Target'}</Text>
            <Input
              size="small"
              placeholder="Search target fields"
              aria-label="Search target fields"
              value={tgtSearch}
              onChange={(_, d) => setTgtSearch(d.value)}
            />
            <Select
              size="small"
              aria-label="Show target fields"
              value={tgtFilter}
              onChange={(_, d) => setTgtFilter(d.value as typeof tgtFilter)}
            >
              <option value="all">All fields</option>
              <option value="unmapped">Unmapped</option>
              <option value="requiredUnmapped">Required unmapped</option>
            </Select>
          </div>
          <div className={s.scroll} ref={rightRef} data-testid="target-pane">
            {visibleTargets.map((f) => {
              const r = rowOf.get(f.id);
              return (
                <div
                  key={f.id}
                  ref={reg(`t:${f.id}`)}
                  className={`${s.field} ${selectedTarget === f.id ? s.selected : ''}`}
                  data-target-field={f.id}
                  data-testid={`tgt-${f.id}`}
                  onClick={() => {
                    if (selectedSource) connect(selectedSource, f.id);
                    else {
                      setSelectedTarget(f.id);
                      setMessage(undefined);
                    }
                  }}
                >
                  <span className={s.fieldName}>
                    <Text>{f.displayName}</Text>
                    {f.required && (
                      <span title="Required" style={{ color: tokens.colorPaletteRedForeground1 }}>
                        {' '}
                        *
                      </span>
                    )}{' '}
                    <Text size={200} className={s.muted}>
                      {f.technicalName ? `${f.technicalName} · ` : ''}
                      {f.datatype}
                      {f.length ? `(${f.length})` : ''}
                    </Text>
                  </span>
                  {f.isKey && (
                    <Badge size="small" appearance="outline">
                      Key
                    </Badge>
                  )}
                  {r && <StatusPill status={r.status} />}
                </div>
              );
            })}
            {visibleTargets.length === 0 && (
              <Text className={s.muted} block style={{ padding: tokens.spacingVerticalM }}>
                No target fields match.
              </Text>
            )}
          </div>
        </div>

        <div className={s.overlay} aria-hidden={false}>
          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
            {items.map((it) =>
              it.segs.map((g) => {
                const suggestion = it.kind === 'suggestion';
                const on = selectedTarget === it.targetFieldId || focusSuggestion === it.key;
                return (
                  <g key={g.id} opacity={g.dim ? 0.35 : 1}>
                    <path
                      d={g.d}
                      fill="none"
                      stroke={suggestion ? '#b36b00' : '#3b6ea5'}
                      strokeWidth={on ? 3 : 1.6}
                      strokeDasharray={suggestion ? '6 4' : undefined}
                      data-testid={`${suggestion ? 'suggest' : 'link'}-${it.targetFieldId}`}
                    />
                    {!suggestion && (
                      <path
                        d={g.d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={12}
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onClick={() => {
                          setSelectedTarget(it.targetFieldId);
                          setSelectedSource(undefined);
                        }}
                      />
                    )}
                  </g>
                );
              }),
            )}
            {drag && (
              <path
                d={drag.path}
                fill="none"
                stroke="#3b6ea5"
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            )}
          </svg>
          {items.map(
            (it) =>
              it.pill && (
                <button
                  key={`pill-${it.key}`}
                  type="button"
                  className={s.pill}
                  style={{
                    left: it.pill.x,
                    top: it.pill.y,
                    border: `1px solid ${it.kind === 'suggestion' ? '#b36b00' : '#3b6ea5'}`,
                    background: it.kind === 'suggestion' ? '#fff8e6' : '#eaf3fb',
                    color: '#222',
                  }}
                  title={it.pill.label}
                  data-testid={`${it.kind === 'suggestion' ? 'score' : 'fn'}-${it.targetFieldId}`}
                  onClick={() => {
                    if (it.kind === 'suggestion')
                      setFocusSuggestion((c) => (c === it.key ? undefined : it.key));
                    else {
                      setSelectedTarget(it.targetFieldId);
                      setSelectedSource(undefined);
                    }
                  }}
                >
                  {it.pill.label}
                </button>
              ),
          )}
        </div>
      </div>

      {selRow && (
        <div className={s.panel} data-testid="target-panel">
          <Text weight="semibold">{selRow.fieldName}</Text>
          <StatusPill status={selRow.status} />
          <Text className={s.muted}>
            {selRow.mapping ? `${selRow.source} · ${selRow.transformation}` : 'Not mapped yet'}
          </Text>
          <Button
            appearance="primary"
            onClick={() => onEditField(selRow.structureId, selRow.fieldId)}
          >
            Edit mapping
          </Button>
          {selRow.mapping && (
            <Button
              onClick={() => {
                const r = disconnectTarget(project, selRow.structureId, selRow.fieldId, nowIso());
                if (r.ok) send({ type: 'projectEdited', project: r.project });
                setSelectedTarget(undefined);
              }}
            >
              Remove mapping
            </Button>
          )}
        </div>
      )}

      {suggestions !== undefined && (
        <div className={s.panel} style={{ display: 'block' }} data-testid="suggestions">
          <div className={s.suggestion} style={{ borderBottom: 'none' }}>
            <Text weight="semibold">Suggested mappings ({openSuggestions.length})</Text>
            <Button
              size="small"
              disabled={openSuggestions.filter((x) => x.score >= STRONG).length === 0}
              onClick={() => accept(openSuggestions.filter((x) => x.score >= STRONG))}
            >
              Accept all at {pct(STRONG)} or more
            </Button>
            <Button size="small" appearance="transparent" onClick={() => setSuggestions(undefined)}>
              Close
            </Button>
          </div>
          {openSuggestions.length === 0 && (
            <Text className={s.muted}>No open suggestions for this structure.</Text>
          )}
          {openSuggestions.map((x) => {
            const target = structure?.fields.find((f) => f.id === x.targetFieldId);
            return (
              <div
                key={x.id}
                className={s.suggestion}
                data-testid={`suggestion-${x.targetFieldId}`}
                style={
                  focusSuggestion === `sg-${x.id}`
                    ? { background: tokens.colorBrandBackground2 }
                    : undefined
                }
              >
                <Text>
                  {fieldName(x.sourceFieldId)} → <b>{target?.displayName ?? x.targetFieldId}</b>
                </Text>
                <Badge appearance="tint" color={x.score >= STRONG ? 'success' : 'warning'}>
                  {pct(x.score)}
                </Badge>
                <Text size={200} className={s.muted} style={{ flex: 1 }}>
                  {x.reasons.join('; ')}
                  {x.alternatives.length > 0 &&
                    ` · also: ${x.alternatives.map((a) => fieldName(a.sourceFieldId)).join(', ')}`}
                </Text>
                <Button size="small" appearance="primary" onClick={() => accept([x])}>
                  Accept
                </Button>
                <Button
                  size="small"
                  onClick={() => setSuggestions((cur) => cur?.filter((y) => y.id !== x.id))}
                >
                  Reject
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
