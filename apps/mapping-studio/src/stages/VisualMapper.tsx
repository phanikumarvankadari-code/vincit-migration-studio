import {
  Button,
  MessageBar,
  MessageBarBody,
  Select,
  Switch,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeMouseHandler,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react';
import {
  buildMappingGraph,
  buildRelationshipGraph,
  connectFields,
  disconnectTarget,
  parseNodeId,
  type GraphNodeKind,
} from '@mms/studio-model';
import { useCallback, useMemo, useState } from 'react';
import { StatusPill } from './MappingTable';
import { useStudio, nowIso } from '../context';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    alignItems: 'end',
    flexWrap: 'wrap',
    margin: `${tokens.spacingVerticalM} 0`,
  },
  canvas: {
    height: '560px',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
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
  muted: { color: tokens.colorNeutralForeground3 },
});

interface MapNodeData extends Record<string, unknown> {
  label: string;
  detail?: string;
  kind: GraphNodeKind;
  muted?: boolean;
  required?: boolean;
}
type MapNode = Node<MapNodeData, 'map'>;

const KIND_STYLE: Record<GraphNodeKind, { bg: string; border: string }> = {
  source: { bg: '#eaf3fb', border: '#7aa7d1' },
  target: { bg: '#eef7ee', border: '#7fb27f' },
  constant: { bg: '#fff8e6', border: '#d8b45a' },
  lookup: { bg: '#f3ecfa', border: '#a98bd0' },
  condition: { bg: '#fdeef0', border: '#d98b96' },
  routine: { bg: '#eaf6f6', border: '#76b7b7' },
  javascript: { bg: '#f2f2f2', border: '#9a9a9a' },
  dataset: { bg: '#eaf3fb', border: '#7aa7d1' },
};

function MapNodeView({ data }: NodeProps<MapNode>) {
  const c = KIND_STYLE[data.kind];
  return (
    <div
      style={{
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 150,
        opacity: data.muted ? 0.65 : 1,
        fontSize: 12,
      }}
      data-kind={data.kind}
    >
      {data.kind !== 'source' && <Handle type="target" position={Position.Left} />}
      <div style={{ fontWeight: 600 }}>
        {data.label}{' '}
        {data.required && (
          <span title="Required" style={{ color: '#b10e1c' }}>
            *
          </span>
        )}
      </div>
      {data.detail && <div style={{ color: '#555' }}>{data.detail}</div>}
      {data.kind !== 'target' && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
const nodeTypes = { map: MapNodeView };

const X_STEP = 270;
const Y_STEP = 78;

function loadPositions(key: string): Record<string, { x: number; y: number }> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, { x: number; y: number }>) : {};
  } catch {
    return {};
  }
}
function savePositions(key: string, value: Record<string, { x: number; y: number }>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* layout is a convenience; losing it is fine */
  }
}

export function VisualMapper({
  onEditField,
}: {
  onEditField: (structureId: string, fieldId: string) => void;
}) {
  const s = useStyles();
  const { state, send, rows } = useStudio();
  const structures = state.project.targetDefinition?.structures ?? [];
  const [mode, setMode] = useState<'mapping' | 'relationships'>('mapping');
  const [structureId, setStructureId] = useState<string>(structures[0]?.id ?? '');
  const [showAll, setShowAll] = useState(true);
  const [message, setMessage] = useState<{ intent: 'error' | 'info'; text: string } | undefined>();
  const [selectedTarget, setSelectedTarget] = useState<string | undefined>();
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const selectedRel = [...selectedEdges].find((id) => id.startsWith('rel|'))?.slice(4);

  const layoutKey = `mms-layout:${state.project.id}:${mode}:${mode === 'mapping' ? structureId : 'all'}`;
  const [positions, setPositions] = useState(() => loadPositions(layoutKey));
  const [lastKey, setLastKey] = useState(layoutKey);
  if (lastKey !== layoutKey) {
    setLastKey(layoutKey);
    setPositions(loadPositions(layoutKey));
  }

  const graph = useMemo(
    () =>
      mode === 'mapping'
        ? buildMappingGraph(state.project, { structureId, showAllSources: showAll })
        : buildRelationshipGraph(state.project),
    [mode, state.project, structureId, showAll],
  );

  const nodes = useMemo<MapNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'map' as const,
        position: positions[n.id] ?? { x: n.column * X_STEP, y: n.row * Y_STEP },
        data: {
          label: n.label,
          kind: n.kind,
          ...(n.detail ? { detail: n.detail } : {}),
          ...(n.muted ? { muted: true } : {}),
          ...(n.required ? { required: true } : {}),
        },
        selected: n.id === selectedTarget,
      })),
    [graph, positions, selectedTarget],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.label ? { label: e.label } : {}),
        markerEnd: { type: MarkerType.ArrowClosed },
        style:
          e.kind === 'relationship'
            ? {
                stroke:
                  e.status === 'confirmed'
                    ? '#2f7d32'
                    : e.status === 'rejected'
                      ? '#b10e1c'
                      : '#b36b00',
                strokeWidth: 2,
                strokeDasharray: e.status === 'confirmed' ? undefined : '6 4',
              }
            : { strokeWidth: 1.5 },
        selected: selectedEdges.has(e.id),
      })),
    [graph, selectedEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<MapNode>[]) => {
      setPositions((cur) => {
        let next = cur;
        for (const c of changes)
          if (c.type === 'position' && c.position) next = { ...next, [c.id]: c.position };
        if (next !== cur && changes.some((c) => c.type === 'position' && c.dragging === false))
          savePositions(layoutKey, next);
        return next;
      });
    },
    [layoutKey],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const r = connectFields(state.project, structureId, c.source, c.target, nowIso());
      if (r.ok) {
        send({ type: 'projectEdited', project: r.project });
        setMessage({ intent: 'info', text: 'Mapping created.' });
      } else setMessage({ intent: 'error', text: r.message });
    },
    [state.project, structureId, send],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      let project = state.project;
      let removed = 0;
      let skipped = false;
      for (const e of deleted) {
        if (!e.target.startsWith('tgt|')) {
          skipped = true;
          continue;
        }
        const r = disconnectTarget(project, structureId, e.target, nowIso());
        if (r.ok) {
          project = r.project;
          removed++;
        }
      }
      if (removed > 0) send({ type: 'projectEdited', project });
      setMessage(
        skipped
          ? {
              intent: 'error',
              text: 'A link inside a chain cannot be removed on its own. Open the field to change its steps, or remove the whole mapping.',
            }
          : { intent: 'info', text: removed > 0 ? 'Mapping removed.' : 'Nothing was removed.' },
      );
    },
    [state.project, structureId, send],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSelectedEdges((cur) => {
      const next = new Set(cur);
      let changed = false;
      for (const c of changes) {
        if (c.type !== 'select') continue;
        changed = true;
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
      return changed ? next : cur;
    });
  }, []);
  const onNodeClick: NodeMouseHandler = (_, node) => {
    setSelectedTarget(node.id.startsWith('tgt|') ? node.id : undefined);
  };
  const onEdgeClick: EdgeMouseHandler = () => setSelectedTarget(undefined);

  const targetField = selectedTarget ? parseNodeId(selectedTarget)?.parts[0] : undefined;
  const targetRow = targetField ? rows.find((r) => r.fieldId === targetField) : undefined;
  const rel = selectedRel
    ? state.project.mappingDefinition.relationships.find((r) => r.id === selectedRel)
    : undefined;

  return (
    <div>
      <div className={s.bar}>
        <label>
          <Text block>Picture</Text>
          <Select
            aria-label="Picture"
            value={mode}
            onChange={(_, d) => {
              setMode(d.value as 'mapping' | 'relationships');
              setSelectedTarget(undefined);
              setSelectedEdges(new Set());
              setMessage(undefined);
            }}
          >
            <option value="mapping">Mapping flow</option>
            <option value="relationships">Joins between datasets</option>
          </Select>
        </label>
        {mode === 'mapping' && (
          <>
            <label>
              <Text block>Structure</Text>
              <Select
                aria-label="Structure"
                value={structureId}
                onChange={(_, d) => setStructureId(d.value)}
              >
                {structures.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </label>
            <Switch
              label="Show all source fields"
              checked={showAll}
              onChange={(_, d) => setShowAll(d.checked)}
            />
          </>
        )}
        <Text className={s.muted}>
          {mode === 'mapping'
            ? 'Drag from a source field to a target field to map it. Select a target field to edit or remove its mapping.'
            : 'Select a join to confirm or reject it.'}
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
      <div className={s.canvas} data-testid="visual-canvas">
        <ReactFlow<MapNode>
          key={`${mode}-${structureId}-${showAll}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onEdgesChange={onEdgesChange}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          nodesConnectable={mode === 'mapping'}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {mode === 'mapping' && targetRow && (
        <div className={s.panel} data-testid="target-panel">
          <Text weight="semibold">{targetRow.fieldName}</Text>
          <StatusPill status={targetRow.status} />
          <Text className={s.muted}>
            {targetRow.mapping
              ? `${targetRow.source} · ${targetRow.transformation}`
              : 'Not mapped yet'}
          </Text>
          <Button
            appearance="primary"
            onClick={() => onEditField(targetRow.structureId, targetRow.fieldId)}
          >
            Edit mapping
          </Button>
          {targetRow.mapping && (
            <Button
              onClick={() => {
                const r = disconnectTarget(
                  state.project,
                  targetRow.structureId,
                  targetRow.fieldId,
                  nowIso(),
                );
                if (r.ok) send({ type: 'projectEdited', project: r.project });
                setSelectedTarget(undefined);
              }}
            >
              Remove mapping
            </Button>
          )}
        </div>
      )}
      {mode === 'relationships' && rel && (
        <div className={s.panel} data-testid="relationship-panel">
          <Text weight="semibold">{rel.id}</Text>
          <Text>{rel.status}</Text>
          <Button
            appearance="primary"
            onClick={() =>
              send({ type: 'relationshipDecided', relationshipId: rel.id, status: 'confirmed' })
            }
            disabled={rel.status === 'confirmed'}
          >
            Confirm join
          </Button>
          <Button
            onClick={() =>
              send({ type: 'relationshipDecided', relationshipId: rel.id, status: 'rejected' })
            }
            disabled={rel.status === 'rejected'}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
