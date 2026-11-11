import { create } from 'zustand';
import type { Experiment } from '../types';
import {
  dbGetAllExperiments,
  dbInsertExperiment,
  dbUpdateExperiment,
  dbDeleteExperiment,
} from '../db/database';
import { generateId } from '../utils/id';
import { keepUnchanged } from '../utils/structuralSharing';
import { cleanExperimentSymptoms, experimentRefusal } from '../utils/experiments';

/**
 * Experiments: a change tried for a set stretch of days, read against the
 * stretch before it — see `docs/arch/mood-log.md`, "Experiments", and
 * `src/utils/experiments.ts`, which holds the read.
 *
 * CRUD and nothing else, the shape `useMilestoneStore` takes and for its
 * reason: rows with their own lifecycle that nothing else points at. Loaded
 * wholesale at startup, since there are a handful over a lifetime.
 */

export interface ExperimentDraft {
  label: string;
  /** Any time on the first day; stored as noon of it. */
  startDate: Date;
  /** Any time on the last day; stored as noon of it. */
  endDate: Date;
  symptoms: string[];
  note: string | null;
}

export type ExperimentPatch = Partial<ExperimentDraft>;

interface ExperimentStore {
  experiments: Experiment[];
  initialized: boolean;
  initialize: () => void;
  addExperiment: (draft: ExperimentDraft) => Experiment | null;
  updateExperiment: (id: string, patch: ExperimentPatch) => Experiment | null;
  removeExperiment: (id: string) => void;
}

/**
 * Noon on the date's own calendar day, the anchor `WhenPicker` and
 * `Milestone.date` use, so a zone or DST boundary can't move it to another day.
 */
function noonIso(date: Date): string {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

const byStart = (a: Experiment, b: Experiment) =>
  a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt);

export const useExperimentStore = create<ExperimentStore>((set, get) => ({
  experiments: [],
  initialized: false,

  initialize() {
    set(state => keepUnchanged(state, { experiments: dbGetAllExperiments(), initialized: true }));
  },

  // Refuses what `experimentRefusal` refuses (a blank name, an end before the
  // start), the same check the sheet shows under its fields.
  addExperiment(draft) {
    if (experimentRefusal(draft)) return null;
    const experiment: Experiment = {
      id: generateId(),
      label: draft.label.trim(),
      startDate: noonIso(draft.startDate),
      endDate: noonIso(draft.endDate),
      symptoms: cleanExperimentSymptoms(draft.symptoms),
      note: cleanNote(draft.note),
      createdAt: new Date().toISOString(),
    };
    dbInsertExperiment(experiment);
    set({ experiments: [...get().experiments, experiment].sort(byStart) });
    return experiment;
  },

  updateExperiment(id, patch) {
    const existing = get().experiments.find(e => e.id === id);
    if (!existing) return null;
    const merged: ExperimentDraft = {
      label: patch.label ?? existing.label,
      startDate: patch.startDate ?? new Date(existing.startDate),
      endDate: patch.endDate ?? new Date(existing.endDate),
      symptoms: patch.symptoms ?? existing.symptoms,
      note: patch.note !== undefined ? patch.note : existing.note,
    };
    if (experimentRefusal(merged)) return null;
    const next: Experiment = {
      ...existing,
      label: merged.label.trim(),
      startDate: patch.startDate ? noonIso(patch.startDate) : existing.startDate,
      endDate: patch.endDate ? noonIso(patch.endDate) : existing.endDate,
      symptoms: cleanExperimentSymptoms(merged.symptoms),
      note: cleanNote(merged.note),
    };
    dbUpdateExperiment(next);
    set({ experiments: get().experiments.map(e => (e.id === id ? next : e)).sort(byStart) });
    return next;
  },

  removeExperiment(id) {
    dbDeleteExperiment(id);
    set({ experiments: get().experiments.filter(e => e.id !== id) });
  },
}));
