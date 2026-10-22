import {
  Badge,
  Button,
  Checkbox,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { SourceDataset } from '@mms/mapping-core';
import {
  confidenceBand,
  mappingConfidence,
  suggestMappings,
  type MappingConfidence,
  type MappingSuggestion,
} from '@mms/mapping-suggest';
import { connectFields, scopeOf, sourceNodeId, targetNodeId } from '@mms/studio-model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nowIso, useStudio } from '../context';
import { BAND_STYLE, ConfidenceTag, ConflictTag, OriginTag } from '../components/confidence';
import { AiSettingsDialog } from '../editor/AiSettingsDialog';
import {
  AiError,
  aiReady,
  aiSuggest,
  autoConfigure,
  loadAiSettings,
  type AiSettings,
} from '../lib/ai-client';
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
  /** The second candidate of a suggestion conflict, drawn lighter. */
  alt?: boolean;
}
interface Item {
  key: string;
  kind: 'mapping' | 'suggestion';
  targetFieldId: string;
  segs: Seg[];
  pill?: { x: number; y: number; label: string };
  /** Colour of a suggestion line, from its confidence band. */
  line?: string;
  /** A warning marker for the conflicts of this target, with their messages. */
  warn?: { x: number; y: number; count: number; text: string };
}

const STRONG = 0.8; // High confidence
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
  onEditField: (structureId: string, fieldId: string, preset?: 'constant') => void;
}) {
  const s = useStyles();
  const {
    state,
    send,
    rows,
    profiles,
    suggestions,
    setSuggestions,
    acceptSuggestions,
    conflicts,
    conflictsByField,
    deleteMappings,
  } = useStudio();
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
  // Datasets outside the structure's pair start closed; these are the ones the person opened.
  const [openOutside, setOpenOutside] = useState<ReadonlySet<string>>(new Set());
  const [alsoOthers, setAlsoOthers] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [selectedTarget, setSelectedTarget] = useState<string | undefined>();
  const [focusSuggestion, setFocusSuggestion] = useState<string | undefined>();
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const [showAi, setShowAi] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | undefined>();
  const [showConflicts, setShowConflicts] = useState(true);
  const [drag, setDrag] = useState<{ path: string } | undefined>();
  const [message, setMessage] = useState<{ intent: 'error' | 'info'; text: string } | undefined>();
  const [items, setItems] = useState<Item[]>([]);

  const structure = structures.find((x) => x.id === structureId) ?? structures[0];
  const scope = useMemo(
    () => (structure ? scopeOf(project, structure.id) : undefined),
    [project, structure],
  );
  const driverId = scope?.[0];
  const orderedDatasets = useMemo(
    () =>
      scope
        ? [
            ...datasets.filter((d) => scope.includes(d.id)),
            ...datasets.filter((d) => !scope.includes(d.id)),
          ]
        : datasets,
    [datasets, scope],
  );
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
  // How well each mapping in place matches: a direct copy is scored, the rest is the user's own design (manual).
  const confOf = useMemo(
    () =>
      new Map<string, MappingConfidence>(
        mappings.map((m) => [m.targetFieldId as string, mappingConfidence(project, m, state.data)]),
      ),
    [mappings, project, state.data],
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
      const cs = conflictsByField.get(m.targetFieldId) ?? [];
      next.push({
        key: m.id,
        kind: 'mapping',
        targetFieldId: m.targetFieldId,
        segs,
        ...(confOf.get(m.targetFieldId)?.kind === 'matched'
          ? {
              line: BAND_STYLE[
                (confOf.get(m.targetFieldId) as { band: 'high' | 'medium' | 'low' }).band
              ].line,
            }
          : {}),
        ...(fn ? { pill: { x: px, y: t.y, label: fn } } : {}),
        ...(cs.length > 0
          ? {
              warn: {
                x: xt - 16,
                y: t.y - 14,
                count: cs.length,
                text: cs.map((c) => c.message).join('\n'),
              },
            }
          : {}),
      });
    }
    for (const sg of openSuggestions) {
      const ds = datasets.find((d) => d.id === sg.datasetId);
      const a = find([`s:${sg.sourceFieldId}`, `sd:${ds?.id ?? ''}`], L);
      const t = find([`t:${sg.targetFieldId}`], R);
      if (!a || !t) continue;
      const segs: Seg[] = [{ id: `sg-${sg.id}`, d: curve(xs, a.y, xt, t.y), dim: a.dim || t.dim }];
      if (sg.conflict) {
        const ods = datasets.find((d) => d.id === sg.conflict!.datasetId);
        const o = find([`s:${sg.conflict.sourceFieldId}`, `sd:${ods?.id ?? ''}`], L);
        if (o)
          segs.push({
            id: `sg-${sg.id}-alt`,
            d: curve(xs, o.y, xt, t.y),
            dim: o.dim || t.dim,
            alt: true,
          });
      }
      next.push({
        key: `sg-${sg.id}`,
        kind: 'suggestion',
        targetFieldId: sg.targetFieldId,
        segs,
        line: BAND_STYLE[confidenceBand(sg.score)].line,
        pill: {
          x: (xs + xt) / 2,
          y: (a.y + t.y) / 2,
          label: `${sg.conflict ? '⚠ ' : ''}${pct(sg.score)} · ${sg.origin === 'rules' ? 'Rules' : sg.origin === 'ai' ? 'AI' : 'Rules+AI'}`,
        },
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
          i.warn && [round(i.warn.x), round(i.warn.y), i.warn.count],
          i.line,
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
    if (!structure || !selectedTarget || !mappedTargets.has(selectedTarget)) return;
    if (deleteMappings([{ structureId: structure.id, fieldId: selectedTarget }]) > 0) {
      setMessage({ intent: 'info', text: 'Mapping removed.' });
      setSelectedTarget(undefined);
    }
  }, [structure, selectedTarget, mappedTargets, deleteMappings]);
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
    const r = acceptSuggestions(list);
    setMessage({
      intent: 'info',
      text: `${r.applied} mapping${r.applied === 1 ? '' : 's'} created${r.skipped ? `, ${r.skipped} skipped` : ''}.`,
    });
  };
  const suggest = () => {
    if (!structure) return;
    const found = suggestMappings(project, {
      structureId: structure.id,
      data: state.data,
      ...(scope ? { datasetIds: scope, includeOthers: alsoOthers } : {}),
    });
    setSuggestions(found);
    setMessage({
      intent: 'info',
      text:
        found.length === 0
          ? 'No suggestions: nothing unmapped looks like a source field.'
          : `${found.length} suggestion${found.length === 1 ? '' : 's'}. Nothing is mapped until you accept it.`,
    });
  };
  const abortRef = useRef<AbortController | undefined>(undefined);
  const askAi = async () => {
    if (!structure) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    let settings = aiSettings;
    // One click is enough: with Ollama and no model chosen yet, the settings are found and saved here.
    if (!aiReady(settings)) {
      if (settings.provider === 'anthropic') {
        setShowAi(true);
        return;
      }
      setAiBusy('Looking for an Ollama model…');
      try {
        settings = await autoConfigure(settings, ctl.signal);
        setAiSettings(settings);
      } catch (e) {
        setAiBusy(undefined);
        setMessage({
          intent: 'error',
          text: `${e instanceof AiError ? e.message : 'The AI settings could not be found.'} Check the address or choose a model in AI settings.`,
        });
        setShowAi(true);
        return;
      }
    }
    const rules = suggestMappings(project, {
      structureId: structure.id,
      data: state.data,
      ...(scope ? { datasetIds: scope, includeOthers: alsoOthers } : {}),
    });
    // The rule-based suggestions show at once; the model's answers are merged in when they arrive.
    setSuggestions(rules);
    setAiBusy(`Asking ${settings.model}…`);
    try {
      const r = await aiSuggest({
        project,
        structureId: structure.id,
        rules,
        settings,
        ...(scope && !alsoOthers ? { datasetIds: scope } : {}),
        signal: ctl.signal,
        onProgress: (done, total) =>
          setAiBusy(
            done < total ? `Asking ${settings.model}… batch ${done + 1} of ${total}` : undefined,
          ),
      });
      setSuggestions(r.suggestions);
      const n = r.suggestions.filter((x) => x.origin !== 'rules').length;
      setMessage({
        intent: 'info',
        text: `${r.suggestions.length} suggestion${r.suggestions.length === 1 ? '' : 's'} (${n} with AI, ${settings.model}). Nothing is mapped until you accept it.${r.problems.length ? ` ${r.problems.length} answer${r.problems.length === 1 ? '' : 's'} could not be used.` : ''}`,
      });
    } catch (e) {
      setMessage({
        intent: 'error',
        text: `${e instanceof AiError ? e.message : 'The AI suggestions failed.'} The rule-based suggestions are still available.`,
      });
    } finally {
      setAiBusy(undefined);
      abortRef.current = undefined;
    }
  };

  const fieldName = (fieldId: string): string => {
    for (const d of datasets) {
      const f = d.fields.find((x) => x.id === fieldId);
      if (f) return `${d.name}.${f.displayName}`;
    }
    return fieldId;
  };

  const selRow = selectedTarget ? rowOf.get(selectedTarget) : undefined;
  const structureConflicts = conflicts.filter((c) => c.structureId === structure?.id);

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
        {scope && (
          <Checkbox
            label="Also look in other structures"
            checked={alsoOthers}
            onChange={(_, d) => setAlsoOthers(d.checked === true)}
          />
        )}
        <Button
          onClick={() => void askAi()}
          disabled={aiBusy !== undefined}
          data-testid="ai-suggest"
        >
          AI suggest
        </Button>
        <Button appearance="subtle" onClick={() => setShowAi(true)}>
          AI settings
        </Button>
        {aiBusy && (
          <>
            <Text className={s.muted} data-testid="ai-busy">
              {aiBusy}
            </Text>
            <Button size="small" onClick={() => abortRef.current?.abort()} data-testid="ai-stop">
              Stop
            </Button>
          </>
        )}
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
      {structureConflicts.length > 0 && (
        <div
          className={s.panel}
          style={{ display: 'block', marginTop: 0, marginBottom: 12 }}
          data-testid="conflict-list"
        >
          <div className={s.suggestion} style={{ borderBottom: 'none' }}>
            <ConflictTag count={structureConflicts.length} />
            <Text weight="semibold">Conflicts in {structure?.name}</Text>
            <Button
              size="small"
              appearance="transparent"
              onClick={() => setShowConflicts((v) => !v)}
            >
              {showConflicts ? 'Hide' : 'Show'}
            </Button>
          </div>
          {showConflicts &&
            structureConflicts.map((c) => (
              <div key={c.id} className={s.suggestion} data-testid={`conflict-${c.kind}`}>
                <Text style={{ flex: 1 }}>{c.message}</Text>
                <Button
                  size="small"
                  onClick={() => {
                    setSelectedTarget(c.targetFieldIds[0]);
                    setSelectedSource(undefined);
                  }}
                >
                  Show field
                </Button>
              </div>
            ))}
        </div>
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
            {orderedDatasets.map((d) => {
              const outside = scope !== undefined && !scope.includes(d.id);
              const isCollapsed = outside ? !openOutside.has(d.id) : collapsed.has(d.id);
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
                      (outside ? setOpenOutside : setCollapsed)((cur) => {
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
                    {scope && (
                      <Badge
                        size="small"
                        appearance={d.id === driverId ? 'filled' : 'outline'}
                        color={d.id === driverId ? 'brand' : 'subtle'}
                        data-testid={`scope-tag-${d.name}`}
                      >
                        {d.id === driverId ? 'Driver' : outside ? 'Other structure' : 'Joined'}
                      </Badge>
                    )}
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
                  {(conflictsByField.get(f.id)?.length ?? 0) > 0 && (
                    <ConflictTag
                      count={conflictsByField.get(f.id)!.length}
                      title={conflictsByField
                        .get(f.id)!
                        .map((c) => c.message)
                        .join('\n')}
                      testId={`tgt-conflict-${f.id}`}
                    />
                  )}
                  {r &&
                    (r.mapping ? (
                      <ConfidenceCapsule
                        fieldName={f.displayName}
                        fieldId={f.id}
                        confidence={confOf.get(f.id)}
                        conflicts={conflictsByField.get(f.id)?.length ?? 0}
                        onResolve={() => {
                          setSelectedTarget(f.id);
                          setSelectedSource(undefined);
                        }}
                      />
                    ) : (
                      <StatusPill status={r.status} />
                    ))}
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
                      stroke={suggestion ? (it.line ?? '#b36b00') : (it.line ?? '#3b6ea5')}
                      strokeWidth={on ? 3 : g.alt ? 1.2 : 1.6}
                      strokeDasharray={g.alt ? '2 5' : suggestion ? '6 4' : undefined}
                      opacity={g.alt ? 0.65 : 1}
                      data-testid={`${suggestion ? (g.alt ? 'suggest-alt' : 'suggest') : 'link'}-${it.targetFieldId}`}
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
              it.warn && (
                <button
                  key={`warn-${it.key}`}
                  type="button"
                  className={s.pill}
                  aria-label={`${it.warn.count} ${it.warn.count === 1 ? 'conflict' : 'conflicts'} for this mapping`}
                  title={it.warn.text}
                  data-testid={`conflict-marker-${it.targetFieldId}`}
                  style={{
                    left: it.warn.x,
                    top: it.warn.y,
                    border: '1px solid #C9863A',
                    background: '#FDEBD9',
                    color: '#7A3A00',
                    fontWeight: 700,
                  }}
                  onClick={() => {
                    setSelectedTarget(it.targetFieldId);
                    setSelectedSource(undefined);
                  }}
                >
                  ⚠ {it.warn.count}
                </button>
              ),
          )}
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
                    border: `1px solid ${it.kind === 'suggestion' ? (it.line ?? '#b36b00') : '#3b6ea5'}`,
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
          {selRow.mapping && confOf.get(selRow.fieldId)?.kind === 'matched' && (
            <Text style={{ flexBasis: '100%' }} data-testid="panel-confidence">
              Match confidence:{' '}
              <ConfidenceTag score={(confOf.get(selRow.fieldId) as { score: number }).score} /> —{' '}
              {(confOf.get(selRow.fieldId) as { reasons: string[] }).reasons.join('; ')}
              {(confOf.get(selRow.fieldId) as { band: string }).band === 'low'
                ? '. Check that this is the right source field.'
                : ''}
            </Text>
          )}
          {(conflictsByField.get(selRow.fieldId) ?? []).map((c) => (
            <Text
              key={c.id}
              style={{ color: '#7A3A00', flexBasis: '100%' }}
              data-testid="panel-conflict"
            >
              ⚠ {c.message}
            </Text>
          ))}
          <Button
            appearance="primary"
            onClick={() => onEditField(selRow.structureId, selRow.fieldId)}
          >
            Edit mapping
          </Button>
          {!selRow.mapping && (
            <Button
              data-testid="hard-code"
              onClick={() => onEditField(selRow.structureId, selRow.fieldId, 'constant')}
            >
              Hard-code a value
            </Button>
          )}
          {selRow.mapping && (
            <Button
              onClick={() => {
                deleteMappings([{ structureId: selRow.structureId, fieldId: selRow.fieldId }]);
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
              disabled={
                openSuggestions.filter((x) => x.score >= STRONG && !x.conflict).length === 0
              }
              onClick={() =>
                accept(openSuggestions.filter((x) => x.score >= STRONG && !x.conflict))
              }
            >
              Accept all High ({pct(STRONG)} or more, no conflict)
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
                <ConfidenceTag score={x.score} testId={`confidence-${x.targetFieldId}`} />
                <OriginTag origin={x.origin} testId={`origin-${x.targetFieldId}`} />
                {x.conflict && (
                  <ConflictTag
                    count={1}
                    title={`${x.conflict.origin === 'ai' ? 'AI' : 'Rules'} prefer ${fieldName(x.conflict.sourceFieldId)} (${pct(x.conflict.score)})`}
                    testId={`sg-conflict-${x.targetFieldId}`}
                  />
                )}
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
      <AiSettingsDialog
        key={showAi ? 'open' : 'closed'}
        open={showAi}
        settings={aiSettings}
        onClose={() => setShowAi(false)}
        onSave={setAiSettings}
      />
    </div>
  );
}

/** The mapped state of a target field, coloured by how well the mapping matches. Click it to look at the mapping. */
function ConfidenceCapsule({
  fieldName,
  fieldId,
  confidence,
  conflicts,
  onResolve,
}: {
  fieldName: string;
  fieldId: string;
  confidence: MappingConfidence | undefined;
  conflicts: number;
  onResolve: () => void;
}) {
  const matched = confidence?.kind === 'matched' ? confidence : undefined;
  const band = matched ? BAND_STYLE[matched.band] : undefined;
  const text = matched
    ? `Mapped · ${Math.round(matched.score * 100)}% ${band!.label}`
    : 'Mapped · Manual';
  const label = `${text}${conflicts > 0 ? ` · ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'}` : ''}`;
  return (
    <button
      type="button"
      data-testid={`capsule-${fieldId}`}
      data-band={matched ? matched.band : 'manual'}
      aria-label={`Resolve ${fieldName}: ${label}`}
      title={
        matched
          ? `Click to review: ${matched.reasons.join('; ')}`
          : 'Your own design. Click to open.'
      }
      onClick={(e) => {
        e.stopPropagation();
        onResolve();
      }}
      style={{
        border: `1px solid ${band?.line ?? '#3b6ea5'}`,
        background: band?.bg ?? '#E5EAFB',
        color: band?.color ?? '#1F3A8A',
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
      {conflicts > 0 ? ' ⚠' : ''}
    </button>
  );
}
