'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node as RFNode,
  type OnConnect,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQueryClient } from '@tanstack/react-query';

import { CanvasEmptyState } from './canvas-empty-state';
import { ServiceNode } from './service-node';
import { DatabaseNode } from './database-node';
import { CanvasToolbar } from './canvas-toolbar';
import { ConfigDrawer } from './config-drawer/config-drawer';
import { DrawerVariablesTab } from './config-drawer/drawer-variables-tab';
import { DrawerMetricsTab } from './config-drawer/drawer-metrics-tab';
import { DrawerSettingsTab } from './config-drawer/drawer-settings-tab';
import { StagedChangesBar } from './staged-changes/staged-changes-bar';
import { CommandPalette } from './command-palette/command-palette';
import { DevModeView } from './dev-mode-view';
import { useCanvas, useSaveCanvasLayout, type CanvasNode, type CanvasEdge } from '@/hooks/queries/use-canvas';
import { useStagedChangesStore } from './staged-changes/staged-changes-store';
import { getSocket } from '@/lib/ws-client';
import { WsEvents, type WsDeploymentStatusPayload } from '@liftoff/shared';
import { useAuthStore } from '@/store/auth.store';

interface ProjectCanvasProps {
  projectId: string;
}

const nodeTypes: Record<string, React.ComponentType<any>> = {
  service: ServiceNode,
  database: DatabaseNode,
  redis: DatabaseNode,
  storage: DatabaseNode,
};

function toRFNodes(nodes: CanvasNode[]): RFNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
  }));
}

function toRFEdges(edges: CanvasEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
    style: { stroke: 'hsl(var(--muted-foreground) / 0.25)', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground) / 0.25)' },
  }));
}

export function ProjectCanvas({ projectId }: ProjectCanvasProps) {
  const queryClient = useQueryClient();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const { data: canvasData, isLoading } = useCanvas(projectId);
  const saveLayoutMutation = useSaveCanvasLayout(projectId);
  const { changes: stagedChanges } = useStagedChangesStore();

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<RFNode | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'dev'>('canvas');

  const addChange = useStagedChangesStore((s) => s.addChange);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSaveLayout = useCallback(
    (changedNodes: RFNode[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const positions = changedNodes
          .filter((n) => !n.id.startsWith('db-') && !n.id.startsWith('redis-') && !n.id.startsWith('storage-'))
          .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
        if (positions.length > 0) {
          saveLayoutMutation.mutate(positions);
        }
      }, 500);
    },
    [saveLayoutMutation],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      onNodesChange(changes);

      const positionChanges = changes.filter((c) => c.type === 'position');
      if (positionChanges.length > 0) {
        const changedNodes = nodes.map((n) => {
          const change = positionChanges.find((c) => c.type === 'position' && c.id === n.id);
          if (change && change.type === 'position' && change.position) {
            return { ...n, position: change.position };
          }
          return n;
        });
        debouncedSaveLayout(changedNodes);
      }
    },
    [onNodesChange, nodes, debouncedSaveLayout],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: 'hsl(var(--muted-foreground) / 0.25)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground) / 0.25)' },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const onNodeClick = useCallback((_: unknown, node: RFNode) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setContextMenuPos(null);
  }, []);

  const onPaneContextMenu = useCallback((event: { preventDefault: () => void; clientX: number; clientY: number }) => {
    event.preventDefault();
    setContextMenuPos({ x: event.clientX, y: event.clientY });
    setCommandPaletteOpen(true);
  }, []);

  const handleAddService = useCallback(
    (type: 'postgres' | 'redis' | 'storage' | 'worker' | 'cron') => {
      const typeMap = {
        postgres: { label: 'PostgreSQL', nodeType: 'database' as const, engine: 'postgres' as const },
        redis: { label: 'Redis', nodeType: 'redis' as const, engine: 'redis' as const },
        storage: { label: 'Spaces Bucket', nodeType: 'storage' as const, engine: undefined },
        worker: { label: 'Worker Service', nodeType: 'service' as const, engine: undefined },
        cron: { label: 'Cron Job', nodeType: 'service' as const, engine: undefined },
      };

      const config = typeMap[type];
      const newId = `${config.nodeType}-staged-${Date.now()}`;
      const serviceNode = nodes.find((n) => n.type === 'service');

      const newNode: RFNode = {
        id: newId,
        type: config.nodeType,
        position: {
          x: (serviceNode?.position.x ?? 400) + 280,
          y: (serviceNode?.position.y ?? 200) + 180,
        },
        data: {
          label: config.label,
          environmentId: serviceNode?.data?.environmentId ?? '',
          databaseEngine: config.engine,
          isStaged: true,
        },
      };

      setNodes((nds) => [...nds, newNode]);

      if (serviceNode) {
        const newEdge: Edge = {
          id: `edge-${serviceNode.id}-${newId}`,
          source: serviceNode.id,
          target: newId,
          animated: true,
          style: { stroke: 'hsl(var(--amber-400) / 0.6)', strokeWidth: 2 },
        };
        setEdges((eds) => [...eds, newEdge]);
      }

      addChange({
        nodeId: newId,
        type: 'ADD_SERVICE',
        label: `Add ${config.label}`,
        payload: { type, nodeId: newId },
      });
    },
    [nodes, setNodes, setEdges, addChange],
  );

  const handleDeploy = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
  }, [queryClient, projectId]);

  const activeEnvironmentId = useMemo(() => {
    const envNode = nodes.find((n) => n.type === 'service');
    return String(envNode?.data?.environmentId ?? '');
  }, [nodes]);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    return canvasData?.nodes.find((n) => n.id === selectedNode.id) ?? null;
  }, [selectedNode, canvasData]);

  useEffect(() => {
    if (canvasData) {
      setNodes(toRFNodes(canvasData.nodes));
      setEdges(toRFEdges(canvasData.edges));
    }
  }, [canvasData, setNodes, setEdges]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const accessToken = useAuthStore.getState().accessToken;
    if (!accessToken) return;

    const socket = getSocket(accessToken);
    socket.connect();

    const handleStatus = (payload: WsDeploymentStatusPayload) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.data.environmentId === payload.deploymentId || n.id === payload.deploymentId
            ? { ...n, data: { ...n.data, status: payload.status } }
            : n,
        ),
      );
    };

    const handleComplete = () => {
      queryClient.invalidateQueries({ queryKey: ['canvas', projectId] });
    };

    socket.on(WsEvents.DEPLOYMENT_STATUS, handleStatus);
    socket.on(WsEvents.DEPLOYMENT_COMPLETE, handleComplete);

    return () => {
      socket.off(WsEvents.DEPLOYMENT_STATUS, handleStatus);
      socket.off(WsEvents.DEPLOYMENT_COMPLETE, handleComplete);
    };
  }, [projectId, queryClient, setNodes]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const hasNodes = nodes.length > 0;

  return (
    <div ref={reactFlowWrapper} className="h-full w-full">
      {hasNodes && (
        <CanvasToolbar
          projectId={projectId}
          projectName={canvasData?.projectName ?? 'Project'}
          nodes={nodes}
          mode={viewMode}
          onModeChange={setViewMode}
        />
      )}

      {!hasNodes ? (
        <CanvasEmptyState projectId={projectId} />
      ) : viewMode === 'dev' ? (
        <div className="absolute inset-0 top-12 overflow-hidden">
          <DevModeView projectId={projectId} environmentId={activeEnvironmentId} />
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          nodeTypes={nodeTypes}
          fitView
          className="bg-background"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="hsl(var(--muted-foreground) / 0.1)"
          />
          <Controls className="!bg-card !border-border !rounded-lg !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent" />
        </ReactFlow>
      )}

      {hasNodes && viewMode === 'canvas' && (
        <>
          <ConfigDrawer
            open={!!selectedNode}
            onClose={() => setSelectedNode(null)}
            nodeLabel={selectedNodeData?.data.label}
            nodeId={selectedNode?.id}
          >
            {selectedNode && (
              <>
                <DrawerMetricsTab environmentId={String(selectedNode.data?.environmentId ?? '')} />
                <DrawerVariablesTab
                  nodeId={selectedNode.id}
                  canvasNodes={canvasData?.nodes ?? []}
                  onChange={(vars) => {
                    addChange({
                      nodeId: selectedNode.id,
                      type: 'CHANGE_VARIABLE',
                      label: `Update ${vars.length} variables`,
                      payload: { variables: vars },
                    });
                  }}
                />
                <DrawerSettingsTab
                  nodeId={selectedNode.id}
                  environmentId={String(selectedNode.data?.environmentId ?? '')}
                  instanceSize={String(selectedNode.data?.instanceSize ?? '')}
                  domains={[]}
                />
              </>
            )}
          </ConfigDrawer>

          <StagedChangesBar onDeploy={handleDeploy} />

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            onAddService={handleAddService}
            onRedeployAll={handleDeploy}
            onDevMode={() => setViewMode('dev')}
          />
        </>
      )}
    </div>
  );
}
