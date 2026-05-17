'use client';

import { Database, Plus, Rocket, Search, Terminal, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  category: string;
  icon: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddService: (type: 'postgres' | 'redis' | 'storage' | 'worker' | 'cron') => void;
  onRedeployAll: () => void;
  onDevMode: () => void;
}

const INITIAL_ITEMS: CommandItem[] = [
  {
    id: 'add-postgres',
    label: 'Add PostgreSQL',
    category: 'DATABASE',
    icon: <Database className="h-4 w-4" />,
    action: () => {},
  },
  {
    id: 'add-redis',
    label: 'Add Redis',
    category: 'DATABASE',
    icon: <Database className="h-4 w-4" />,
    action: () => {},
  },
  {
    id: 'add-storage',
    label: 'Add Spaces Bucket',
    category: 'STORAGE',
    icon: <Plus className="h-4 w-4" />,
    action: () => {},
  },
  {
    id: 'add-worker',
    label: 'Add Worker Service',
    category: 'COMPUTE',
    icon: <Terminal className="h-4 w-4" />,
    action: () => {},
  },
  {
    id: 'add-cron',
    label: 'Add Cron Job',
    category: 'COMPUTE',
    icon: <Terminal className="h-4 w-4" />,
    action: () => {},
  },
  {
    id: 'redeploy',
    label: 'Redeploy All',
    category: 'ACTIONS',
    icon: <Rocket className="h-4 w-4" />,
    action: () => {},
  },
  {
    id: 'dev-mode',
    label: 'Developer Mode',
    category: 'ACTIONS',
    icon: <Workflow className="h-4 w-4" />,
    action: () => {},
  },
];

export function CommandPalette({ open, onOpenChange, onAddService, onRedeployAll, onDevMode }: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredItems = INITIAL_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase()),
  );

  const groupedItems = filteredItems.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category]!.push(item);
    return acc;
  }, {});

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelectedIndex(0);
    }
  }, [open]);

  const handleSelect = (item: CommandItem) => {
    switch (item.id) {
      case 'add-postgres':
        onAddService('postgres');
        break;
      case 'add-redis':
        onAddService('redis');
        break;
      case 'add-storage':
        onAddService('storage');
        break;
      case 'add-worker':
        onAddService('worker');
        break;
      case 'add-cron':
        onAddService('cron');
        break;
      case 'redeploy':
        onRedeployAll();
        break;
      case 'dev-mode':
        onDevMode();
        break;
    }
    onOpenChange(false);
  };

  let flatIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search or add a service…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 p-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto p-2">
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category} className="mb-2">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </p>
              {items.map((item) => {
                const isSelected = flatIndex === selectedIndex;
                const currentIndex = flatIndex;
                flatIndex++;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors',
                      isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                    )}
                  >
                    <span className="text-muted-foreground">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}

          {filteredItems.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No results found</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
