'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node as RFNode,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { PipelineNode, PipelineNodeType, PipelineEdge, PipelineValidationError } from '@liftoff/shared';
import { YamlPreviewPanel } from './yaml-preview-panel';
import { NodePalette } from './node-palette';
import { NodeConfigPanel } from './node-config-panel';
import PipelineNodeComponent from './nodes/pipeline-node';

/* ─── Types ─── */

interface PipelineCanvasProps {
  environmentId: string;
  initialNodes: PipelineNode[];
  initialEdges: PipelineEdge[];
  compiledYaml: string | null;
  isValid: boolean;
  validationErrors: PipelineValidationError[] | null;
  configYaml?: string;
  onSave: (nodes: PipelineNode[], edges: PipelineEdge[]) => void;
  onCompile: () => void;
  onDeploy: () => void;
  isSaving: boolean;
  isCompiling: boolean;
  isDeploying: boolean;
}

/* ─── Edge validation rules ─── */

const TRIGGER_TYPES: PipelineNodeType[] = ['GitHubPushTrigger', 'ManualTrigger', 'ScheduleTrigger'];
const BUILD_TYPES: PipelineNodeType[] = ['DockerBuild', 'AutoDetectBuild'];
const SERVICE_TYPES: PipelineNodeType[] = ['AppService'];
const INFRA_TYPES: PipelineNodeType[] = ['PostgresDatabase', 'SpacesBucket'];
const CONFIG_TYPES: PipelineNodeType[] = ['EnvVars', 'Secret', 'CustomDomain'];

function isValidConnection(sourceType: PipelineNodeType, targetType: PipelineNodeType): boolean {
  if (TRIGGER_TYPES.includes(sourceType)) return BUILD_TYPES.includes(targetType);
  if (BUILD_TYPES.includes(sourceType)) return SERVICE_TYPES.includes(targetType) || INFRA_TYPES.includes(targetType);
  if (INFRA_TYPES.includes(sourceType)) return SERVICE_TYPES.includes(targetType);
  if (CONFIG_TYPES.includes(sourceType)) return SERVICE_TYPES.includes(targetType);
  return SERVICE_TYPES.includes(targetType);
}

/* ─── ID generation ─── */

let idCounter = 0;
function nextId(): string {
  return `node_${Date.now()}_${++idCounter}`;
}

/* ─── Default pipeline from config YAML ─── */

function parseConfigToNodes(configYaml: string | undefined): PipelineNode[] {
  if (!configYaml) return [];

  return [
    { id: 'default-trigger', type: 'GitHubPushTrigger', data: { label: 'GitHub Push', branch: 'main' }, position: { x: 100, y: 50 } },
    { id: 'default-build', type: 'AutoDetectBuild', data: { label: 'Auto-detect Build', autoDetect: true }, position: { x: 100, y: 300 } },
    { id: 'default-service', type: 'AppService', data: { label: 'App Service', name: 'my-app', port: 3000, region: 'nyc3', instanceSize: 'apps-s-1vcpu-0.5gb', replicas: 1, healthCheckPath: '/health' }, position: { x: 100, y: 550 } },
  ];
}

function parseConfigToEdges(nodes: PipelineNode[]): PipelineEdge[] {
  return [
    { id: 'default-edge-0', source: 'default-trigger', target: 'default-build' },
    { id: 'default-edge-1', source: 'default-build', target: 'default-service' },
  ];
}

/* ─── React Flow conversions ─── */

function toRFNodes(nodes: PipelineNode[]): RFNode[] {
  return nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data }, position: n.position }));
}

function toRFEdges(edges: PipelineEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    animated: true,
    style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground))' },
  }));
}

function fromRFNodes(nodes: RFNode[]): PipelineNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type as PipelineNodeType,
    data: n.data as Record<string, unknown>,
    position: n.position,
  }));
}

function fromRFEdges(edges: Edge[]): PipelineEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
}

/* ─── Node type registry ─── */

const nodeTypes: Record<string, React.ComponentType<any>> = {
  GitHubPushTrigger: PipelineNodeComponent,
  ManualTrigger: PipelineNodeComponent,
  ScheduleTrigger: PipelineNodeComponent,
  DockerBuild: PipelineNodeComponent,
  AutoDetectBuild: PipelineNodeComponent,
  AppService: PipelineNodeComponent,
  PostgresDatabase: PipelineNodeComponent,
  SpacesBucket: PipelineNodeComponent,
  CustomDomain: PipelineNodeComponent,
  EnvVars: PipelineNodeComponent,
  Secret: PipelineNodeComponent,
};

/* ─── Component ─── */

export function PipelineCanvas({
  initialNodes,
  initialEdges,
  compiledYaml,
  isValid,
  validationErrors,
  configYaml,
  onSave,
  onCompile,
  onDeploy,
  isSaving,
  isCompiling,
  isDeploying,
}: PipelineCanvasProps): JSX.Element {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const isDefaultPipeline = initialNodes.length === 0 && initialEdges.length === 0 && !!configYaml;

  const defaultNodes = useMemo(() => parseConfigToNodes(configYaml), [configYaml]);
  const defaultEdges = useMemo(() => parseConfigToEdges(defaultNodes), [defaultNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialNodes.length > 0 ? toRFNodes(initialNodes) : toRFNodes(defaultNodes),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialNodes.length > 0 ? toRFEdges(initialEdges) : toRFEdges(defaultEdges),
  );

  const [selectedNode, setSelectedNode] = useState<RFNode | null>(null);
  const hasNodes = nodes.length > 0;

  const selectedNodeCurrent = useMemo(() => {
    if (!selectedNode) return null;
    return nodes.find((n) => n.id === selectedNode.id) ?? null;
  }, [selectedNode, nodes]);

  // Connection validation
  const isValidEdgeConnection = useCallback(
    (connection: Edge | Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      return isValidConnection(sourceNode.type as PipelineNodeType, targetNode.type as PipelineNodeType);
    },
    [nodes],
  );

  // Handle new edge connections
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const sourceType = sourceNode.type as PipelineNodeType;
      const targetType = targetNode.type as PipelineNodeType;
      if (!sourceNode.type || !targetNode.type) return;
      if (!isValidEdgeConnection({ source: sourceNode.type, target: targetNode.type } as Connection)) return;

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground))' },
          },
          eds,
        ),
      );
    },
    [nodes, setEdges],
  );

  // Drag-and-drop from palette
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const rawData = event.dataTransfer.getData('application/reactflow');
      if (!rawData) return;

      const { type, data } = JSON.parse(rawData) as { type: PipelineNodeType; data: Record<string, unknown> };
      const wrapper = reactFlowWrapper.current;
      if (!wrapper) return;

      const bounds = wrapper.getBoundingClientRect();
      const newNode: RFNode = {
        id: nextId(),
        type,
        data,
        position: { x: event.clientX - bounds.left - 90, y: event.clientY - bounds.top - 30 },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  // Node selection
  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: RFNode[] }) => {
    setSelectedNode(selected.length === 1 ? (selected[0] ?? null) : null);
  }, []);

  // Update node data
  const handleNodeUpdate = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data } : n)));
    },
    [setNodes],
  );

  // Save handler
  const handleSave = useCallback(() => {
    onSave(fromRFNodes(nodes), fromRFEdges(edges));
  }, [nodes, edges, onSave]);

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] rounded-xl border border-border overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-foreground tracking-tight">Pipeline</h2>
          {isDefaultPipeline && (
            <span className="text-[10px] text-muted-foreground bg-accent px-1.5 py-0.5 rounded-full font-medium">
              Default
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-all disabled:opacity-50"
          >
            {isSaving ? '💾 Saving…' : '💾 Save'}
          </button>
          <button
            onClick={onCompile}
            disabled={isCompiling || !hasNodes}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-500/30 text-blue-500 hover:bg-blue-500/10 transition-all disabled:opacity-50"
          >
            {isCompiling ? '⚙️ Compiling…' : '⚙️ Compile'}
          </button>
          <button
            onClick={onDeploy}
            disabled={isDeploying || !isValid || !hasNodes}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeploying ? '🚀 Deploying…' : '🚀 Deploy'}
          </button>
        </div>
      </div>

      {/* Main layout: palette | canvas | config panel */}
      <div className="flex flex-1 min-h-0">
        <NodePalette />

        <div ref={reactFlowWrapper} className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onDragOver={onDragOver}
            onDrop={onDrop}
            isValidConnection={isValidEdgeConnection}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
            deleteKeyCode={['Backspace', 'Delete']}
            className="pipeline-canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={15} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
            <Controls className="!bg-card !border-border !rounded-lg !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent" />
            <MiniMap className="!bg-card !border-border !rounded-lg" nodeStrokeWidth={3} pannable zoomable />
          </ReactFlow>
        </div>

        {selectedNodeCurrent && <NodeConfigPanel node={selectedNodeCurrent} onUpdate={handleNodeUpdate} />}
      </div>

      {/* YAML preview */}
      <YamlPreviewPanel yaml={compiledYaml} isValid={isValid} validationErrors={validationErrors} />
    </div>
  );
}