import {
  Button,
  MessageBar,
  MessageBarBody,
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
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { buildRelationshipGraph } from '@mms/studio-model';
import { useCallback, useMemo, useState } from 'react';
import { useStudio } from '../context';

const useStyles = makeStyles({
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

interface DatasetNodeData extends Record<string, unknown> {
  label: string;
  detail?: string;
}
type DatasetNode = Node<DatasetNodeData, 'dataset'>;

function DatasetNodeView({ data }: NodeProps<DatasetNode>) {
  return (
    <div
      style={{
        background: '#eaf3fb',
        border: '1.5px solid #7aa7d1',
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 150,
        fontSize: 12,
      }}
      data-kind="dataset"
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontWeight: 600 }}>{data.label}</div>
      {data.detail && <div style={{ color: '#555' }}>{data.detail}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { dataset: DatasetNodeView };

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

/** Datasets as boxes and joins as lines. A join is confirmed or rejected here, as in Sources. */
export function JoinsPicture() {
  const s = useStyles();
  const { state, send } = useStudio();
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const selectedRel = [...selectedEdges].find((id) => id.startsWith('rel|'))?.slice(4);
  const layoutKey = `mms-layout:${state.project.id}:relationships:all`;
  const [positions, setPositions] = useState(() => loadPositions(layoutKey));

  const graph = useMemo(() => buildRelationshipGraph(state.project), [state.project]);
  const nodes = useMemo<DatasetNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'dataset' as const,
        position: positions[n.id] ?? { x: n.column * X_STEP, y: n.row * Y_STEP },
        data: { label: n.label, ...(n.detail ? { detail: n.detail } : {}) },
      })),
    [graph, positions],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.label ? { label: e.label } : {}),
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke:
            e.status === 'confirmed' ? '#2f7d32' : e.status === 'rejected' ? '#b10e1c' : '#b36b00',
          strokeWidth: 2,
          strokeDasharray: e.status === 'confirmed' ? undefined : '6 4',
        },
        selected: selectedEdges.has(e.id),
      })),
    [graph, selectedEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<DatasetNode>[]) => {
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

  const rel = selectedRel
    ? state.project.mappingDefinition.relationships.find((r) => r.id === selectedRel)
    : undefined;

  return (
    <div>
      <Text className={s.muted} block style={{ margin: `${tokens.spacingVerticalM} 0` }}>
        Select a join to confirm or reject it.
      </Text>
      {graph.nodes.length === 0 && (
        <MessageBar intent="info">
          <MessageBarBody>Add source files first. Joins between them appear here.</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.canvas} data-testid="visual-canvas">
        <ReactFlow<DatasetNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {rel && (
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
