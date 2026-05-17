import { create } from 'zustand';

export type StagedChangeType =
  | 'ADD_SERVICE'
  | 'REMOVE_SERVICE'
  | 'CHANGE_VARIABLE'
  | 'CHANGE_SCALING'
  | 'CHANGE_DOMAIN';

export interface StagedChange {
  id: string;
  nodeId: string;
  type: StagedChangeType;
  label: string;
  payload: unknown;
}

interface StagedChangesState {
  changes: StagedChange[];
  addChange: (change: Omit<StagedChange, 'id'>) => void;
  removeChange: (id: string) => void;
  clearAll: () => void;
}

export const useStagedChangesStore = create<StagedChangesState>((set) => ({
  changes: [],

  addChange: (change) =>
    set((state) => ({
      changes: [
        ...state.changes,
        { ...change, id: `staged_${Date.now()}_${Math.random().toString(36).slice(2)}` },
      ],
    })),

  removeChange: (id) =>
    set((state) => ({
      changes: state.changes.filter((c) => c.id !== id),
    })),

  clearAll: () => set({ changes: [] }),
}));
