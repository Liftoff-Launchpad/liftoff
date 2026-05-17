'use client';

import { useCallback } from 'react';
import type { Node as RFNode } from '@xyflow/react';
import type { PipelineNode } from '@liftoff/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NODE_DEFINITIONS } from './node-definitions';

interface NodeConfigPanelProps {
  node: RFNode;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
}

/**
 * Right-side panel for editing a selected node's properties.
 */
export function NodeConfigPanel({ node, onUpdate }: NodeConfigPanelProps): JSX.Element {
  const definition = NODE_DEFINITIONS.find((d) => d.type === node.type);
  const data = (node.data ?? {}) as Record<string, unknown>;

  const handleChange = useCallback(
    (field: string, value: unknown) => {
      onUpdate(node.id, { ...data, [field]: value });
    },
    [node.id, data, onUpdate],
  );

  return (
    <div className="w-64 shrink-0 border-l border-border bg-card/50 backdrop-blur-sm overflow-y-auto">
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Configure
        </h3>
        <p className="text-[10px] text-muted-foreground/70 mt-1">{definition?.label ?? node.type}</p>
      </div>

      <div className="p-3 space-y-3">
        {getConfigFields(node.type as string).map((field) => (
          <div key={field.key}>
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {field.label}
            </Label>
            {field.type === 'number' ? (
              <Input
                type="number"
                value={(data[field.key] as number) ?? field.default}
                onChange={(e) => handleChange(field.key, Number(e.target.value))}
                className="mt-1 h-8 text-xs"
              />
            ) : field.type === 'boolean' ? (
              <label className="flex items-center gap-2 mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(data[field.key] as boolean) ?? false}
                  onChange={(e) => handleChange(field.key, e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-muted-foreground">{field.checkboxLabel}</span>
              </label>
            ) : (
              <Input
                value={(data[field.key] as string) ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={String(field.default)}
                className="mt-1 h-8 text-xs"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  default: unknown;
  checkboxLabel?: string;
}

function getConfigFields(nodeType: string): ConfigField[] {
  switch (nodeType) {
    case 'GitHubPushTrigger':
      return [
        { key: 'branch', label: 'Branch', type: 'text', default: 'main' },
        { key: 'githubWebhook', label: 'Auto-register webhook', type: 'boolean', default: true, checkboxLabel: 'Auto-register GitHub webhook' },
      ];
    case 'ManualTrigger':
      return [];
    case 'ScheduleTrigger':
      return [
        { key: 'cron', label: 'Cron Expression', type: 'text', default: '0 2 * * *' },
      ];
    case 'DockerBuild':
      return [
        { key: 'dockerfilePath', label: 'Dockerfile Path', type: 'text', default: 'Dockerfile' },
        { key: 'context', label: 'Build Context', type: 'text', default: '.' },
      ];
    case 'AutoDetectBuild':
      return [];
    case 'AppService':
      return [
        { key: 'name', label: 'App Name', type: 'text', default: 'my-app' },
        { key: 'port', label: 'Port', type: 'number', default: 3000 },
        { key: 'region', label: 'Region', type: 'text', default: 'nyc3' },
        { key: 'instanceSize', label: 'Instance Size', type: 'text', default: 'apps-s-1vcpu-0.5gb' },
        { key: 'replicas', label: 'Replicas', type: 'number', default: 1 },
        { key: 'healthCheckPath', label: 'Health Check Path', type: 'text', default: '/health' },
      ];
    case 'PostgresDatabase':
      return [
        { key: 'size', label: 'Database Size', type: 'text', default: 'db-s-1vcpu-1gb' },
        { key: 'version', label: 'PostgreSQL Version', type: 'text', default: '15' },
      ];
    case 'SpacesBucket':
      return [
        { key: 'region', label: 'Region', type: 'text', default: 'nyc3' },
      ];
    case 'CustomDomain':
      return [
        { key: 'domain', label: 'Domain Name', type: 'text', default: '' },
      ];
    case 'EnvVars':
      return [
        {
          key: 'variables',
          label: 'Variables (JSON)',
          type: 'text',
          default: '{}',
        },
      ];
    case 'Secret':
      return [
        { key: 'name', label: 'Secret Name', type: 'text', default: '' },
      ];
    default:
      return [];
  }
}