'use client';

import { Plus, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabsContent } from '@/components/ui/tabs';
import type { CanvasNode } from '@/hooks/queries/use-canvas';

interface Variable {
  key: string;
  value: string;
}

interface DrawerVariablesTabProps {
  nodeId: string;
  canvasNodes: CanvasNode[];
  variables?: Variable[];
  onChange?: (variables: Variable[]) => void;
}

function parseLinkedValue(value: string): { isLinked: boolean; nodeName?: string; varKey?: string } {
  const match = value.match(/^\$\{\{([^.]+)\.([^}]+)\}\}$/);
  if (match) {
    return { isLinked: true, nodeName: match[1], varKey: match[2] };
  }
  return { isLinked: false };
}

function wrapWithBraces(text: string): string {
  return `{${text}}`;
}

export function DrawerVariablesTab({ nodeId, canvasNodes, variables = [], onChange }: DrawerVariablesTabProps) {
  const [vars, setVars] = useState<Variable[]>(variables);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAddVariable = () => {
    const newVars = [...vars, { key: '', value: '' }];
    setVars(newVars);
    setEditingIndex(newVars.length - 1);
    onChange?.(newVars);
  };

  const handleRemoveVariable = (index: number) => {
    const newVars = vars.filter((_, i) => i !== index);
    setVars(newVars);
    setEditingIndex(null);
    onChange?.(newVars);
  };

  const handleKeyChange = (index: number, key: string) => {
    const newVars = vars.map((v, i) => (i === index ? { ...v, key } : v));
    setVars(newVars);
    onChange?.(newVars);
  };

  const handleValueChange = (index: number, value: string) => {
    const newVars = vars.map((v, i) => (i === index ? { ...v, value } : v));
    setVars(newVars);

    const hasTrigger = value.includes('${{');
    setShowAutocomplete(hasTrigger);
    const queryPart = hasTrigger ? value.split('${{')[1] ?? '' : '';
    setAutocompleteQuery(queryPart);

    if (!hasTrigger) {
      onChange?.(newVars);
    }
  };

  const handleInsertLink = (targetNodeId: string, nodeLabel: string, outputKey: string) => {
    if (editingIndex === null) return;

    const linkedValue = '${{ ' + nodeLabel + '.' + outputKey + ' }}';
    const newVars = vars.map((v, i) => (i === editingIndex ? { ...v, value: linkedValue } : v));
    setVars(newVars);
    setShowAutocomplete(false);
    setEditingIndex(null);
    onChange?.(newVars);
  };

  const filteredNodes = canvasNodes.filter(
    (n) =>
      n.id !== nodeId &&
      n.data.label.toLowerCase().includes(autocompleteQuery.toLowerCase()),
  );

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingIndex]);

  return (
    <TabsContent value="variables" className="m-0 p-10">
      <div className="flex items-center justify-between gap-4">
        <h4 className="text-lg font-semibold">Service Variables</h4>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <button type="button" className="hover:text-foreground">Shared Variable</button>
          <button type="button" className="hover:text-foreground">Raw Editor</button>
          <Button variant="outline" size="sm" onClick={handleAddVariable}>
            <Plus className="mr-2 h-3 w-3" />
            New Variable
          </Button>
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <div className="space-y-2">
          {vars.map((variable, index) => {
            const { isLinked, nodeName, varKey } = parseLinkedValue(variable.value);

            return (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="KEY"
                  value={variable.key}
                  onChange={(e) => handleKeyChange(index, e.target.value)}
                  className="flex-1 font-mono text-sm"
                />
                <div className="relative flex-1">
                  {isLinked && nodeName && varKey ? (
                    <div className="flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1.5 text-sm">
                      <span className="font-mono text-blue-400">${'{'}{'{'}</span>
                      <span className="font-medium text-blue-300">{nodeName}</span>
                      <span className="text-blue-400">.</span>
                      <span className="font-mono text-blue-300">{varKey}</span>
                      <span className="font-mono text-blue-400">{'}'}{'}'}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveVariable(index)}
                        className="ml-1 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <Input
                      ref={index === editingIndex ? inputRef : undefined}
                      placeholder="value"
                      value={variable.value}
                      onChange={(e) => handleValueChange(index, e.target.value)}
                      onFocus={() => setEditingIndex(index)}
                      onBlur={() => setTimeout(() => setShowAutocomplete(false), 200)}
                      className="flex-1 font-mono text-sm"
                    />
                  )}
                  {showAutocomplete && editingIndex === index && (
                    <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-lg">
                      {filteredNodes.length > 0 ? (
                        filteredNodes.map((node) => {
                          const outputs = node.data.outputs ?? {};
                          return (
                            <div key={node.id} className="py-1">
                              <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                                {node.data.label}
                              </p>
                              {Object.keys(outputs).map((key) => (
                                <button
                                  key={key}
                                  type="button"
                                  onMouseDown={() => handleInsertLink(node.id, node.data.label, key)}
                                  className="flex w-full items-center px-2 py-1 text-sm hover:bg-accent"
                                >
                                  <span className="font-mono">{node.data.label}{'.'}{key}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })
                      ) : (
                        <p className="px-2 py-2 text-xs text-muted-foreground">No linked nodes available</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {vars.length === 0 && (
          <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-border bg-background/35 text-center">
            <div>
              <p className="font-medium text-muted-foreground">No Environment Variables</p>
              <p className="mt-2 text-sm text-muted-foreground">Import all variables using the Raw Editor.</p>
            </div>
          </div>
        )}
      </div>
    </TabsContent>
  );
}
