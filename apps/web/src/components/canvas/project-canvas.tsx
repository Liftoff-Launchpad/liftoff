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
  type EdgeChange,
  type Node as RFNode,
  type OnConnect,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQueryClient } from '@tanstack/react-query';

import { X } from 'lucide-react';
import { LiveAppLogs } from '@/components/logs/live-app-logs';
import { Button } from '@/components/ui/button';
import { AddServiceDialog } from './add-service-dialog';
import { CanvasEmptyState } from './canvas-empty-state';
import { ServiceNode } from './service-node';
import { DatabaseNode } from './database-node';
import { CanvasToolbar } from './canvas-toolbar';
import { CanvasActivity } from './canvas-activity';
import { ConfigDrawer } from './config-drawer/config-drawer';
import { ResourceDrawer } from './config-drawer/resource-drawer';
import { DrawerLogsTab } from './config-drawer/drawer-logs-tab';
import { DrawerVariablesTab } from './config-drawer/drawer-variables-tab';
import { DrawerMetricsTab } from './config-drawer/drawer-metrics-tab';
import { DrawerSettingsTab } from './config-drawer/drawer-settings-tab';
import { StagedChangesBar } from './staged-changes/staged-changes-bar';
import { CommandPalette } from './command-palette/command-palette';
import { DevModeView } from './dev-mode-view';
import { useCanvas, useSaveCanvasLayout, type CanvasNode, type CanvasEdge } from '@/hooks/queries/use-canvas';
import { useCreateResource, type ResourceKind } from '@/hooks/queries/use-resources';
import { useCreateConnection, useDeleteConnection } from '@/hooks/queries/use-connections';
import { useApplyGraph, useTriggerBuild } from '@/hooks/queries/use-environments';
import { toast } from '@/components/ui/use-toast';
import { useStagedChangesStore } from './staged-changes/staged-changes-store';
import { getSocket } from '@/lib/ws-client';
import { WsEvents, type WsDeploymentStatusPayload } from '@liftoff/shared';
import { useAuthStore } from '@/store/auth.store';

const RESOURCE_NODE_TYPES = ['database', 'redis', 'storage'];

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
    label: e.label,
    labelStyle: { fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' },
    labelBgStyle: { fill: 'hsl(var(--card))', fillOpacity: 0.9 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
    style: { stroke: 'hsl(var(--muted-foreground) / 0.35)', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground) / 0.35)' },
  }));
}

export function ProjectCanvas({ projectId }: ProjectCanvasProps) {
  const queryClient = useQueryClient();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const { data: canvasData, isLoading } = useCanvas(projectId);
  const saveLayoutMutation = useSaveCanvasLayout(projectId);
  const createResource = useCreateResource(projectId);
  const createConnection = useCreateConnection(projectId);
  const deleteConnection = useDeleteConnection(projectId);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<RFNode | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'dev'>('canvas');
  const [activityOpen, setActivityOpen] = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [logsPanelOpen, setLogsPanelOpen] = useState(false);

  const addChange = useStagedChangesStore((s) => s.addChange);

  // The env every node belongs to (single-env canvas). Computed early so the
  // Deploy hooks below can bind to it.
  const activeEnvironmentId = useMemo(() => {
    const envNode = nodes.find((n) => n.type === 'service');
    return String(envNode?.data?.environmentId ?? '');
  }, [nodes]);

  const applyGraph = useApplyGraph(projectId);
  const triggerBuild = useTriggerBuild(projectId, activeEnvironmentId);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSaveLayout = useCallback(
    (changedNodes: RFNode[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Persist positions for every node — service and resource nodes alike now
        // carry real row ids, and the backend routes each to the right table.
        const positions = changedNodes.map((n) => ({
          id: n.id,
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
        }));
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
      if (!connection.source || !connection.target) return;

      // Validate BEFORE the optimistic add so we never leave an orphan edge with
      // no backing mutation (and thus no reconciling refetch to roll it back).
      // The consumer (target) determines the env; the backend infers edge kind.
      const targetNode = nodes.find((n) => n.id === connection.target);
      const environmentId = String(targetNode?.data?.environmentId ?? '');
      if (!environmentId) return;

      // Optimistic edge for snappy UX; persistence reconciles via canvas refetch.
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

      createConnection.mutate({
        environmentId,
        sourceId: connection.source,
        targetId: connection.target,
      });
    },
    [setEdges, nodes, createConnection],
  );

  // Intercept edge removals (select + Delete) to delete the persisted Connection.
  // Only fire for edges that exist server-side; optimistic/unpersisted edges are skipped.
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes);
      for (const change of changes) {
        if (change.type === 'remove' && canvasData?.edges.some((e) => e.id === change.id)) {
          deleteConnection.mutate(change.id);
        }
      }
    },
    [onEdgesChange, canvasData, deleteConnection],
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
      const serviceNode = nodes.find((n) => n.type === 'service');
      const environmentId = String(serviceNode?.data?.environmentId ?? '');

      // Resource kinds are persisted as real DRAFT Resource rows; the canvas
      // refetch renders them. They are wired to services by the user drawing an
      // edge (Phase B turns those edges into auto-injected env vars).
      const resourceKindByType: Partial<Record<typeof type, ResourceKind>> = {
        postgres: 'POSTGRES',
        redis: 'REDIS',
        storage: 'SPACES_BUCKET',
      };
      const resourceKind = resourceKindByType[type];

      if (resourceKind) {
        if (!environmentId) return;
        createResource.mutate({
          environmentId,
          kind: resourceKind,
          canvasPosition: {
            x: Math.round((serviceNode?.position.x ?? 400) + 320),
            y: Math.round((serviceNode?.position.y ?? 200) + 200),
          },
        });
        return;
      }

      // worker / cron remain placeholder canvas nodes until their backend kinds
      // ship in Phase D (workers/jobs).
      const placeholderLabel = type === 'worker' ? 'Worker Service' : 'Cron Job';
      const newId = `service-staged-${Date.now()}`;
      const newNode: RFNode = {
        id: newId,
        type: 'service',
        position: {
          x: (serviceNode?.position.x ?? 400) + 280,
          y: (serviceNode?.position.y ?? 200) + 180,
        },
        data: { label: placeholderLabel, environmentId, isStaged: true },
      };
      setNodes((nds) => [...nds, newNode]);
      addChange({
        nodeId: newId,
        type: 'ADD_SERVICE',
        label: `Add ${placeholderLabel}`,
        payload: { type, nodeId: newId },
      });
    },
    [nodes, setNodes, addChange, createResource],
  );

  // Deploy = apply the whole graph: provision managed resources and redeploy
  // services with connection env vars injected. If a service has no image yet,
  // fall back to a fresh build (workflow_dispatch).
  const handleDeploy = useCallback(() => {
    if (!activeEnvironmentId) return;
    applyGraph.mutate(activeEnvironmentId, {
      onSuccess: (result) => {
        toast({
          title: 'Deploying…',
          description: `Provisioning resources and redeploying ${result.deploymentCount} service${
            result.deploymentCount === 1 ? '' : 's'
          }.`,
        });
      },
      onError: (error: unknown) => {
        const message =
          error && typeof error === 'object' && 'response' in error
            ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
            : null;
        const noImage = (message ?? '').toLowerCase().includes('no deployable image');
        if (noImage) {
          toast({
            title: 'Building first…',
            description: 'No image yet — kicking a fresh build, then it will deploy.',
          });
          triggerBuild.mutate();
          return;
        }
        toast({
          title: 'Deploy failed',
          description: message ?? 'Something went wrong applying the graph.',
          variant: 'destructive',
        });
      },
    });
  }, [activeEnvironmentId, applyGraph, triggerBuild]);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    return canvasData?.nodes.find((n) => n.id === selectedNode.id) ?? null;
  }, [selectedNode, canvasData]);

  // Resource nodes (database/redis/storage) carry real Resource ids and must NOT
  // open the service-only drawer (its tabs call /services/* with the resource id).
  const isResourceNode = !!selectedNode && RESOURCE_NODE_TYPES.includes(String(selectedNode.type));

  // Env vars injected into the selected service by inbound connection edges.
  const autoInjectedVars = useMemo(() => {
    if (!selectedNode || isResourceNode || !canvasData) return [];
    const result: Array<{ name: string; source: string }> = [];
    for (const edge of canvasData.edges) {
      if (edge.target !== selectedNode.id) continue;
      const sourceNode = canvasData.nodes.find((n) => n.id === edge.source);
      const sourceLabel = sourceNode?.data.label ?? 'resource';
      for (const name of edge.injectedVars ?? []) {
        result.push({ name, source: sourceLabel });
      }
    }
    return result;
  }, [selectedNode, isResourceNode, canvasData]);

  useEffect(() => {
    if (canvasData) {
      // Preserve local-only staged placeholders (worker/cron nodes that have no
      // backend row yet) across the frequent canvas refetches now triggered by
      // resource/connection mutations — otherwise they'd be wiped while their
      // entry still shows in the StagedChangesBar.
      setNodes((prev) => {
        const staged = prev.filter(
          (n) => n.data?.isStaged && String(n.id).startsWith('service-staged-'),
        );
        return [...toRFNodes(canvasData.nodes), ...staged];
      });
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
    <div ref={reactFlowWrapper} className="h-full w-full overflow-hidden bg-background">
      <CanvasToolbar
        projectId={projectId}
        projectName={canvasData?.projectName ?? 'New project'}
        nodes={nodes}
        mode={viewMode}
        onModeChange={setViewMode}
        onAddClick={() => setCommandPaletteOpen(true)}
        activityOpen={activityOpen}
        onActivityToggle={() => setActivityOpen((open) => !open)}
        logsOpen={logsPanelOpen}
        onLogsToggle={() => setLogsPanelOpen((open) => !open)}
        onDeploy={handleDeploy}
        deploying={applyGraph.isPending}
        canDeploy={Boolean(activeEnvironmentId)}
      />

      {!hasNodes ? (
        <div className="absolute inset-0 pt-16">
          <CanvasEmptyState projectId={projectId} />
        </div>
      ) : viewMode === 'dev' ? (
        <div className="absolute inset-0 top-16 overflow-hidden">
          <DevModeView projectId={projectId} environmentId={activeEnvironmentId} />
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          className="absolute liftoff-canvas"
          style={{ inset: '64px 0 0 0', height: 'calc(100% - 64px)', width: '100%' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="hsl(var(--muted-foreground) / 0.16)"
          />
          <Controls
            position="bottom-left"
            showInteractive={false}
            className="!m-4 !overflow-hidden !rounded-lg !border !border-border/80 !bg-card/90 !shadow-[0_18px_60px_hsl(252_30%_2%/0.35)] [&>button]:!h-10 [&>button]:!w-10 [&>button]:!border-border/80 [&>button]:!bg-card/95 [&>button]:!text-muted-foreground [&>button:hover]:!bg-secondary [&>button:hover]:!text-foreground"
          />
        </ReactFlow>
      )}

      {activityOpen && (
        <aside className="liftoff-panel absolute bottom-4 right-4 top-20 z-20 w-[min(460px,calc(100vw-112px))] animate-in fade-in slide-in-from-right-4 rounded-lg p-6 duration-300">
          <h2 className="text-xl font-semibold">Activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">Recent deployments in this environment.</p>
          <div className="mt-2 max-h-[calc(100%-4rem)] overflow-y-auto">
            {activeEnvironmentId ? (
              <CanvasActivity environmentId={activeEnvironmentId} />
            ) : (
              <p className="mt-8 text-sm text-muted-foreground">No environment yet.</p>
            )}
          </div>
        </aside>
      )}

      {logsPanelOpen && activeEnvironmentId && (
        <aside className="liftoff-panel absolute bottom-4 right-4 top-20 z-20 flex w-[min(720px,calc(100vw-112px))] flex-col overflow-hidden rounded-lg p-5 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Environment logs</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                All services in this environment, interleaved. Click a service node and open its
                Logs tab to filter to that component.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLogsPanelOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <LiveAppLogs environmentId={activeEnvironmentId} />
          </div>
        </aside>
      )}

      {viewMode === 'canvas' && (
        <>
          {hasNodes && (
            <>
              <ConfigDrawer
                open={!!selectedNode && !isResourceNode}
                onClose={() => setSelectedNode(null)}
                nodeLabel={selectedNodeData?.data.label}
                nodeId={selectedNode?.id}
                status={String(selectedNode?.data?.status ?? 'PENDING')}
                repoName={String(selectedNode?.data?.repoName ?? selectedNodeData?.data.label ?? '')}
                region={String(selectedNode?.data?.region ?? selectedNodeData?.data?.region ?? '')}
                replicas={Number(selectedNode?.data?.replicas ?? 1)}
                environmentId={String(selectedNode?.data?.environmentId ?? '') || undefined}
              >
                {selectedNode && !isResourceNode && (
                  <>
                    <DrawerMetricsTab
                      environmentId={String(selectedNode.data?.environmentId ?? '')}
                      serviceName={String(selectedNode.data?.serviceName ?? '') || undefined}
                    />
                    <DrawerVariablesTab
                      serviceId={selectedNode.id}
                      environmentId={String(selectedNode.data?.environmentId ?? '')}
                      autoInjected={autoInjectedVars}
                    />
                    <DrawerLogsTab
                      environmentId={String(selectedNode.data?.environmentId ?? '')}
                      serviceName={String(selectedNode.data?.serviceName ?? '') || undefined}
                    />
                    <DrawerSettingsTab
                      nodeId={selectedNode.id}
                      nodeName={String(selectedNode.data?.serviceName ?? selectedNode.data?.label ?? '')}
                      environmentId={String(selectedNode.data?.environmentId ?? '')}
                      projectId={projectId}
                      instanceSize={String(selectedNode.data?.instanceSize ?? '')}
                      command={
                        selectedNode.data?.command != null ? String(selectedNode.data.command) : null
                      }
                      domains={[]}
                      onServiceDeleted={() => setSelectedNode(null)}
                    />
                  </>
                )}
              </ConfigDrawer>

              <ResourceDrawer
                open={!!selectedNode && isResourceNode}
                onClose={() => setSelectedNode(null)}
                projectId={projectId}
                resourceId={isResourceNode && selectedNode ? selectedNode.id : ''}
                label={String(selectedNode?.data?.label ?? 'Resource')}
                kind={selectedNode?.data?.resourceKind as ResourceKind | undefined}
                status={String(selectedNode?.data?.resourceStatus ?? 'DRAFT')}
                hostname={selectedNode?.data?.hostname ? String(selectedNode.data.hostname) : undefined}
                port={selectedNode?.data?.port ? Number(selectedNode.data.port) : undefined}
                bucketName={
                  selectedNode?.data?.bucketName ? String(selectedNode.data.bucketName) : undefined
                }
                outputs={selectedNode?.data?.outputs as Record<string, string> | undefined}
                config={selectedNode?.data?.resourceConfig as Record<string, unknown> | undefined}
                onDeleted={() => setSelectedNode(null)}
              />

              <StagedChangesBar onDeploy={handleDeploy} />
            </>
          )}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            onAddNewService={() => {
              setCommandPaletteOpen(false);
              setAddServiceOpen(true);
            }}
            onAddService={handleAddService}
            onRedeployAll={handleDeploy}
            onDevMode={() => setViewMode('dev')}
          />
        </>
      )}

      {activeEnvironmentId && (
        <AddServiceDialog
          open={addServiceOpen}
          onOpenChange={setAddServiceOpen}
          environmentId={activeEnvironmentId}
          projectId={projectId}
        />
      )}
    </div>
  );
}
