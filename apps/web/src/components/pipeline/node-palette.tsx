'use client';

import { type DragEvent, useCallback } from 'react';
import { NODE_DEFINITIONS, NODE_CATEGORIES, type NodeDefinition } from './node-definitions';

/**
 * Sidebar palette of draggable pipeline nodes grouped by category.
 */
export function NodePalette(): JSX.Element {
  const onDragStart = useCallback((event: DragEvent<HTMLDivElement>, definition: NodeDefinition) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({
        type: definition.type,
        data: { ...definition.defaultData },
      }),
    );
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <div className="w-56 shrink-0 border-r border-border bg-card/50 backdrop-blur-sm overflow-y-auto">
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Components
        </h3>
        <p className="text-[10px] text-muted-foreground/70 mt-1">Drag onto the canvas</p>
      </div>

      {NODE_CATEGORIES.map(({ label, category, color }) => {
        const items = NODE_DEFINITIONS.filter((d) => d.category === category);
        return (
          <div key={category} className="p-2">
            <div className="flex items-center gap-1.5 px-1 mb-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
            </div>
            <div className="space-y-1">
              {items.map((def) => (
                <div
                  key={def.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, def)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-grab
                    bg-background/60 border border-border/50 hover:border-border
                    hover:bg-accent/50 active:cursor-grabbing transition-all duration-150
                    hover:shadow-sm"
                  title={def.description}
                >
                  <span className="text-sm" role="img" aria-label={def.label}>
                    {def.icon}
                  </span>
                  <span className="text-xs font-medium text-foreground">{def.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}