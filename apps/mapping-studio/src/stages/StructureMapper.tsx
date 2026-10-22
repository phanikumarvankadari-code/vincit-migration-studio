import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  confidenceBand,
  coverageOf,
  suggestStructurePairs,
  type StructureSuggestion,
} from '@mms/mapping-suggest';
import { pairViews } from '@mms/studio-model';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BAND_STYLE, ConfidenceTag, ConflictTag, OriginTag } from '../components/confidence';
import { AiSettingsDialog } from '../editor/AiSettingsDialog';
import {
  AiError,
  aiReady,
  aiSuggestPairs,
  autoConfigure,
  loadAiSettings,
  type AiSettings,
} from '../lib/ai-client';
import { useStudio } from '../context';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    flexWrap: 'wrap',
    margin: `${tokens.spacingVerticalM} 0`,
  },
  wrap: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 220px minmax(0, 1.4fr)',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    gap: tokens.spacingVerticalM,
  },
  col: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, minWidth: 0 },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  row: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap' },
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' },
  pill: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'auto',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    zIndex: 2,
    cursor: 'default',
  },
  panel: {
    marginTop: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
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

interface Line {
  key: string;
  d: string;
  color: string;
  dash?: string;
  width: number;
  opacity?: number;
  testId: string;
  pill?: { x: number; y: number; label: string; bg: string; border: string };
}

const STRONG = 0.8;
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const curve = (x1: number, y1: number, x2: number, y2: number): string => {
  const xm = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${xm} ${y1}, ${xm} ${y2}, ${x2} ${y2}`;
};

/**
 * Step one of mapping: which source dataset drives which target structure. Names may differ, so the suggestions
 * come from the fields. A pair is the structure's driver dataset; helpers are the datasets joined to it.
 */
export function StructureMapper() {
  const s = useStyles();
  const { state, send, pairSuggestions, setPairSuggestions, pairStructures, unpairStructure } =
    useStudio();
  const project = state.project;
  const structures = project.targetDefinition?.structures ?? [];
  const datasets = useMemo(
    () => project.sourceDefinitions.flatMap((d) => d.datasets),
    [project.sourceDefinitions],
  );
  const views = useMemo(() => pairViews(project), [project]);
  const dsName = (id: string): string => datasets.find((d) => d.id === id)?.name ?? id;
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const [showAi, setShowAi] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const [message, setMessage] = useState<{ intent: 'info' | 'error'; text: string } | undefined>();
  const [lines, setLines] = useState<Line[]>([]);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const open = useMemo(
    () =>
      (pairSuggestions ?? []).filter((x) => {
        const v = views.find((p) => p.structureId === x.targetStructureId);
        return v?.driverDatasetId !== x.driverDatasetId;
      }),
    [pairSuggestions, views],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) anchors.current.set(key, el);
    else anchors.current.delete(key);
  };

  const measure = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const right = (key: string) => {
      const el = anchors.current.get(key);
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      return { x: r.right - w.left, y: r.top + 28 - w.top };
    };
    const left = (key: string) => {
      const el = anchors.current.get(key);
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      return { x: r.left - w.left, y: r.top + 28 - w.top };
    };
    const next: Line[] = [];
    for (const v of views) {
      const st = structures.find((x) => x.id === v.structureId)!;
      const t = left(`t:${st.name}`);
      if (!t) continue;
      if (v.driverDatasetId) {
        const a = right(`d:${dsName(v.driverDatasetId)}`);
        if (a)
          next.push({
            key: `pair-${st.id}`,
            d: curve(a.x, a.y, t.x, t.y),
            color: '#1F3A8A',
            width: 2.4,
            testId: `pair-line-${st.name}`,
          });
        for (const h of v.helperDatasetIds) {
          const b = right(`d:${dsName(h)}`);
          if (b)
            next.push({
              key: `help-${st.id}-${h}`,
              d: curve(b.x, b.y, t.x, t.y),
              color: '#8A8F9C',
              dash: '2 5',
              width: 1.4,
              testId: `helper-line-${st.name}-${dsName(h)}`,
            });
        }
      }
    }
    for (const sg of open) {
      const st = structures.find((x) => x.id === sg.targetStructureId);
      if (!st) continue;
      const t = left(`t:${st.name}`);
      const a = right(`d:${dsName(sg.driverDatasetId)}`);
      if (!t || !a) continue;
      const band = BAND_STYLE[confidenceBand(sg.score)];
      next.push({
        key: `sg-${sg.id}`,
        d: curve(a.x, a.y, t.x, t.y),
        color: band.line,
        dash: '6 4',
        width: 2,
        testId: `pair-suggest-${st.name}`,
        pill: {
          x: (a.x + t.x) / 2,
          y: (a.y + t.y) / 2,
          label: `${sg.conflict ? '⚠ ' : ''}${pct(sg.score)} · ${sg.origin === 'rules' ? 'Rules' : sg.origin === 'ai' ? 'AI' : 'Rules+AI'}`,
          bg: '#FFF8E6',
          border: band.line,
        },
      });
      if (sg.conflict) {
        const o = right(`d:${dsName(sg.conflict.driverDatasetId)}`);
        if (o)
          next.push({
            key: `sg-${sg.id}-alt`,
            d: curve(o.x, o.y, t.x, t.y),
            color: '#8A8F9C',
            dash: '2 5',
            width: 1.2,
            opacity: 0.65,
            testId: `pair-suggest-alt-${st.name}`,
          });
      }
    }
    const k = (l: Line[]) =>
      JSON.stringify(
        l.map((x) => [
          x.key,
          x.d.replace(/-?\d+(\.\d+)?/g, (n) => String(Math.round(Number(n)))),
          x.pill?.label,
        ]),
      );
    setLines((cur) => (k(cur) === k(next) ? cur : next));
  };
  const measureRef = useRef(measure);
  useLayoutEffect(() => {
    measureRef.current = measure;
    measure();
  });
  useEffect(() => {
    const again = () => measureRef.current();
    window.addEventListener('resize', again);
    const ro = new ResizeObserver(again);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      window.removeEventListener('resize', again);
      ro.disconnect();
    };
  }, []);

  const suggest = () => {
    const found = suggestStructurePairs(project, { data: state.data });
    setPairSuggestions(found);
    setMessage({
      intent: 'info',
      text:
        found.length === 0
          ? 'No suggestions: no source dataset resembles a target structure.'
          : `${found.length} suggestion${found.length === 1 ? '' : 's'}. Nothing is paired until you accept it.`,
    });
  };

  const askAi = async () => {
    const ctl = new AbortController();
    abortRef.current = ctl;
    let settings = aiSettings;
    if (!aiReady(settings)) {
      if (settings.provider === 'anthropic') {
        setShowAi(true);
        return;
      }
      setBusy('Looking for an Ollama model…');
      try {
        settings = await autoConfigure(settings, ctl.signal);
        setAiSettings(settings);
      } catch (e) {
        setBusy(undefined);
        setMessage({
          intent: 'error',
          text: `${e instanceof AiError ? e.message : 'The AI settings could not be found.'} Check the address or choose a model in AI settings.`,
        });
        setShowAi(true);
        return;
      }
    }
    const rules = suggestStructurePairs(project, { data: state.data });
    setPairSuggestions(rules);
    setBusy(`Asking ${settings.model}…`);
    try {
      const r = await aiSuggestPairs({ project, rules, settings, signal: ctl.signal });
      setPairSuggestions(r.suggestions);
      const n = r.suggestions.filter((x) => x.origin !== 'rules').length;
      setMessage({
        intent: 'info',
        text: `${r.suggestions.length} suggestion${r.suggestions.length === 1 ? '' : 's'} (${n} with AI, ${settings.model}). Nothing is paired until you accept it.${r.problems.length ? ` ${r.problems.length} answer${r.problems.length === 1 ? '' : 's'} could not be used.` : ''}`,
      });
    } catch (e) {
      setMessage({
        intent: 'error',
        text: `${e instanceof AiError ? e.message : 'The AI suggestions failed.'} The rule-based suggestions are still available.`,
      });
    } finally {
      setBusy(undefined);
      abortRef.current = undefined;
    }
  };

  const accept = (list: readonly StructureSuggestion[]) => {
    const n = pairStructures(
      list.map((x) => ({ structureId: x.targetStructureId, driverDatasetId: x.driverDatasetId })),
    );
    setMessage({ intent: 'info', text: `${n} structure${n === 1 ? '' : 's'} paired.` });
  };

  const unpaired = views.filter((v) => !v.driverDatasetId).length;
  const usedBy = (dsId: string) => ({
    drives: views
      .filter((v) => v.driverDatasetId === dsId)
      .map((v) => structures.find((x) => x.id === v.structureId)!.name),
    helps: views
      .filter((v) => v.helperDatasetIds.includes(dsId))
      .map((v) => structures.find((x) => x.id === v.structureId)!.name),
  });

  return (
    <div data-testid="structure-mapper">
      <div className={s.bar}>
        <Button appearance="primary" onClick={suggest}>
          Suggest pairs
        </Button>
        <Button
          onClick={() => void askAi()}
          disabled={busy !== undefined}
          data-testid="ai-suggest-pairs"
        >
          AI suggest pairs
        </Button>
        <Button appearance="subtle" onClick={() => setShowAi(true)}>
          AI settings
        </Button>
        {busy && (
          <>
            <Text className={s.muted} data-testid="ai-busy">
              {busy}
            </Text>
            <Button size="small" onClick={() => abortRef.current?.abort()} data-testid="ai-stop">
              Stop
            </Button>
          </>
        )}
        <Text className={s.muted}>
          Choose which source dataset makes the rows of each target structure. One dataset can feed
          several structures.
        </Text>
      </div>
      {message && (
        <MessageBar
          intent={message.intent === 'error' ? 'error' : 'info'}
          data-testid="pair-message"
        >
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}
      {unpaired > 0 && datasets.length > 0 && (
        <MessageBar intent="warning" data-testid="unpaired-banner">
          <MessageBarBody>
            {unpaired} of {structures.length} target{' '}
            {unpaired === 1 ? 'structure has' : 'structures have'} no source dataset yet. Without
            one, a structure whose mappings read several datasets cannot make rows.
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={s.wrap} ref={wrapRef}>
        <div className={s.col} data-testid="dataset-column">
          <Text weight="semibold">Source datasets</Text>
          {datasets.map((d) => {
            const u = usedBy(d.id);
            const rows = state.data[d.id]?.rows.length;
            return (
              <div
                key={d.id}
                ref={reg(`d:${d.name}`)}
                className={s.card}
                data-testid={`ds-card-${d.name}`}
              >
                <Text weight="semibold">{d.name}</Text>
                <Text size={200} className={s.muted}>
                  {d.fields.length} fields ·{' '}
                  {rows === undefined ? 'rows not loaded' : `${rows} rows`}
                </Text>
                <div className={s.row}>
                  {u.drives.map((n) => (
                    <Badge key={`d-${n}`} appearance="tint" color="brand">
                      Drives {n}
                    </Badge>
                  ))}
                  {u.helps.map((n) => (
                    <Badge key={`h-${n}`} appearance="outline">
                      Helps {n}
                    </Badge>
                  ))}
                  {u.drives.length === 0 && u.helps.length === 0 && (
                    <Badge appearance="outline" color="subtle" data-testid={`unused-${d.name}`}>
                      Not used yet
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
          {datasets.length === 0 && (
            <Text className={s.muted}>No source files yet. Add them in Sources.</Text>
          )}
        </div>
        <div aria-hidden />
        <div className={s.col} data-testid="structure-column">
          <Text weight="semibold">Target structures</Text>
          {structures.map((st) => {
            const v = views.find((p) => p.structureId === st.id)!;
            const driver = v.driverDatasetId
              ? datasets.find((d) => d.id === v.driverDatasetId)
              : undefined;
            const cov = driver ? coverageOf(st, driver, state.data[driver.id]).coverage : undefined;
            const sg = open.find((x) => x.targetStructureId === st.id);
            return (
              <div
                key={st.id}
                ref={reg(`t:${st.name}`)}
                className={s.card}
                data-testid={`st-card-${st.name}`}
                style={driver ? undefined : { borderColor: '#C9863A', background: '#FFFBF2' }}
              >
                <div className={s.row}>
                  <Text weight="semibold">{st.name}</Text>
                  {driver ? (
                    <Badge appearance="tint" color="success" data-testid={`paired-${st.name}`}>
                      Paired
                    </Badge>
                  ) : (
                    <Badge appearance="tint" color="warning" data-testid={`unpaired-${st.name}`}>
                      No source yet
                    </Badge>
                  )}
                  <Text size={200} className={s.muted}>
                    {st.fields.length} fields · {st.fields.filter((f) => f.required).length}{' '}
                    required
                  </Text>
                </div>
                {driver && cov && (
                  <Text size={200} data-testid={`pair-coverage-${st.name}`}>
                    Rows come from <b>{driver.name}</b>: {cov.matched} of {cov.total} fields have a
                    matching source field
                    {cov.requiredTotal > 0
                      ? `, ${cov.requiredMatched} of ${cov.requiredTotal} required`
                      : ''}
                    .
                  </Text>
                )}
                {v.helperDatasetIds.length > 0 && (
                  <div className={s.row} data-testid={`helpers-${st.name}`}>
                    <Text size={200} className={s.muted}>
                      Joined:
                    </Text>
                    {v.helperDatasetIds.map((h) => {
                      const unconfirmed = v.unconfirmedHelperIds.includes(h);
                      const rel = project.mappingDefinition.relationships.find(
                        (r) =>
                          r.status === 'suggested' &&
                          ((r.leftDatasetId === v.driverDatasetId && r.rightDatasetId === h) ||
                            (r.rightDatasetId === v.driverDatasetId && r.leftDatasetId === h)),
                      );
                      return (
                        <span key={h} className={s.row}>
                          <Badge appearance="outline">
                            {dsName(h)} · {unconfirmed ? 'join suggested' : 'join confirmed'}
                          </Badge>
                          {unconfirmed && rel && (
                            <Button
                              size="small"
                              aria-label={`Confirm join ${driver?.name} and ${dsName(h)}`}
                              onClick={() =>
                                send({
                                  type: 'relationshipDecided',
                                  relationshipId: rel.id,
                                  status: 'confirmed',
                                })
                              }
                            >
                              Confirm join
                            </Button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
                {v.strayDatasetIds.length > 0 && (
                  <Text size={200} style={{ color: '#7A3A00' }} data-testid={`stray-${st.name}`}>
                    ⚠ Mappings also read {v.strayDatasetIds.map(dsName).join(', ')}, which is not
                    joined to {driver?.name}.
                  </Text>
                )}
                {sg && (
                  <Text size={200} data-testid={`card-suggestion-${st.name}`}>
                    Suggested: <b>{dsName(sg.driverDatasetId)}</b> ({pct(sg.score)})
                  </Text>
                )}
                <div className={s.row}>
                  <label>
                    <Text size={200} block>
                      Source dataset
                    </Text>
                    <Select
                      size="small"
                      aria-label={`Source dataset for ${st.name}`}
                      data-testid={`driver-select-${st.name}`}
                      value={v.driverDatasetId ?? ''}
                      onChange={(_, d) => {
                        if (d.value)
                          pairStructures([{ structureId: st.id, driverDatasetId: d.value }]);
                        else unpairStructure(st.id);
                      }}
                    >
                      <option value="">None</option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {driver && (
                    <Button
                      size="small"
                      aria-label={`Remove source dataset of ${st.name}`}
                      data-testid={`remove-pair-${st.name}`}
                      onClick={() => unpairStructure(st.id)}
                    >
                      Remove pair
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className={s.overlay}>
          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
            {lines.map((l) => (
              <path
                key={l.key}
                d={l.d}
                fill="none"
                stroke={l.color}
                strokeWidth={l.width}
                strokeDasharray={l.dash}
                opacity={l.opacity ?? 1}
                data-testid={l.testId}
              />
            ))}
          </svg>
          {lines.map(
            (l) =>
              l.pill && (
                <span
                  key={`pill-${l.key}`}
                  className={s.pill}
                  style={{
                    left: l.pill.x,
                    top: l.pill.y,
                    background: l.pill.bg,
                    border: `1px solid ${l.pill.border}`,
                  }}
                  data-testid={l.testId.replace('pair-suggest-', 'pair-score-')}
                >
                  {l.pill.label}
                </span>
              ),
          )}
        </div>
      </div>

      {pairSuggestions !== undefined && (
        <div className={s.panel} data-testid="pair-suggestions">
          <div className={s.suggestion} style={{ borderBottom: 'none' }}>
            <Text weight="semibold">Suggested pairs ({open.length})</Text>
            <Button
              size="small"
              disabled={open.filter((x) => x.score >= STRONG && !x.conflict).length === 0}
              onClick={() => accept(open.filter((x) => x.score >= STRONG && !x.conflict))}
            >
              Accept all High ({pct(STRONG)} or more, no conflict)
            </Button>
            <Button
              size="small"
              appearance="transparent"
              onClick={() => setPairSuggestions(undefined)}
            >
              Close
            </Button>
          </div>
          {open.length === 0 && <Text className={s.muted}>No open suggestions.</Text>}
          {open.map((x) => {
            const st = structures.find((t) => t.id === x.targetStructureId)!;
            return (
              <div key={x.id} className={s.suggestion} data-testid={`pair-suggestion-${st.name}`}>
                <Text>
                  <b>{dsName(x.driverDatasetId)}</b> → <b>{st.name}</b>
                </Text>
                <ConfidenceTag score={x.score} testId={`pair-confidence-${st.name}`} />
                <OriginTag origin={x.origin} testId={`pair-origin-${st.name}`} />
                {x.conflict && (
                  <ConflictTag
                    count={1}
                    title={`${x.conflict.origin === 'ai' ? 'AI' : 'Rules'} prefer ${dsName(x.conflict.driverDatasetId)} (${pct(x.conflict.score)})`}
                    testId={`pair-conflict-${st.name}`}
                  />
                )}
                <Text
                  size={200}
                  className={s.muted}
                  style={{ flex: 1 }}
                  data-testid={`pair-reasons-${st.name}`}
                >
                  {x.reasons.join('; ')}
                  {x.alternatives.length > 0 &&
                    ` · also: ${x.alternatives.map((a) => dsName(a.driverDatasetId)).join(', ')}`}
                </Text>
                <Button size="small" appearance="primary" onClick={() => accept([x])}>
                  Accept
                </Button>
                <Button
                  size="small"
                  onClick={() => setPairSuggestions((cur) => cur?.filter((y) => y.id !== x.id))}
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
