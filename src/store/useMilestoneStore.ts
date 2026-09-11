import { create } from 'zustand';
import type { Milestone } from '../types';
import {
  dbGetAllMilestones,
  dbInsertMilestone,
  dbUpdateMilestone,
  dbDeleteMilestone,
} from '../db/database';
import { generateId } from '../utils/id';

/**
 * Dated markers read as a before/after split against the mood log — see
 * `docs/arch/mood-log.md` and `src/utils/moodInsights.ts`'s
 * `milestoneMoodContrast`.
 *
 * Its own store rather than a slice of `useMoodStore`, for the reason
 * `useMoodStore` is its own slice of `useTaskStore`: these are rows with their
 * own lifecycle that nothing else points at. It is CRUD and nothing else —
 * the contrast itself lives in the pure module so it can be exercised without
 * standing up SQLite.
 *
 * Loaded wholesale at startup, the same call `useMoodStore` makes: a handful
 * of rows over a lifetime at the very most.
 */

export type MilestonePatch = Partial<Pick<Milestone, 'label' | 'date'>>;

interface MilestoneStore {
  milestones: Milestone[];
  initialized: boolean;
  initialize: () => void;
  addMilestone: (label: string, date: Date) => Milestone | null;
  updateMilestone: (id: string, patch: MilestonePatch) => void;
  removeMilestone: (id: string) => void;
}

export const useMilestoneStore = create<MilestoneStore>((set, get) => ({
  milestones: [],
  initialized: false,

  initialize() {
    set({ milestones: dbGetAllMilestones(), initialized: true });
  },

  // Refuses a blank label, the same rule addNote and addLog follow: the
  // sheet's Save is the only way in.
  addMilestone(label, date) {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const milestone: Milestone = {
      id: generateId(),
      label: trimmed,
      date: date.toISOString(),
      createdAt: new Date().toISOString(),
    };
    dbInsertMilestone(milestone);
    // Kept in date order to match what dbGetAllMilestones hands back on the
    // next launch — a list that reorders itself on relaunch is the usual way
    // one of these drifts.
    set({ milestones: [...get().milestones, milestone].sort((a, b) => a.date.localeCompare(b.date)) });
    return milestone;
  },

  updateMilestone(id, patch) {
    const existing = get().milestones.find(m => m.id === id);
    if (!existing) return;
    const next: Milestone = { ...existing, ...patch };
    if (patch.label !== undefined) next.label = patch.label.trim();
    dbUpdateMilestone(next);
    set({
      milestones: get().milestones
        .map(m => (m.id === id ? next : m))
        .sort((a, b) => a.date.localeCompare(b.date)),
    });
  },

  removeMilestone(id) {
    dbDeleteMilestone(id);
    set({ milestones: get().milestones.filter(m => m.id !== id) });
  },
}));
