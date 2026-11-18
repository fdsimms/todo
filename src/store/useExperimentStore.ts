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
import { DEFAULT_EXPERIMENT_DAYS, cleanExperimentSymptoms, endOfLength, experimentDayKey, experimentRefusal, startedAtFor } from '../utils/experiments';
import { getLogicalToday } from '../utils/dateUtils';

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
  /** Any time on the first day; stored as noon of it. Null plans it for later. */
  startDate: Date | null;
  /** Any time on the last day; stored as noon of it. Null with a start runs until stopped. */
  endDate: Date | null;
  /**
   * The planned length, used to place the last day when a planned one is
   * started. Null for open-ended. Ignored when `endDate` is given.
   */
  days?: number | null;
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
  /**
   * Begins a planned experiment: `startDate` (default: given by the caller,
   * normally today) and a last day from its planned `days`, or from `days`
   * given here. Refuses one already started.
   */
  startExperiment: (id: string, start: { startDate: Date; days?: number | null }) => Experiment | null;
  /** Ends a started experiment on `endDate`. Refuses a planned one, one already ended, or a day before its start. */
  stopExperiment: (id: string, endDate: Date) => Experiment | null;
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

// Planned ones (no start) sort after dated ones, in the order they were made.
const byStart = (a: Experiment, b: Experiment) =>
  (a.startDate ?? '9').localeCompare(b.startDate ?? '9') || a.createdAt.localeCompare(b.createdAt);

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
      startDate: draft.startDate ? noonIso(draft.startDate) : null,
      endDate: draft.endDate ? noonIso(draft.endDate) : null,
      days: draft.days !== undefined ? draft.days : (draft.startDate && draft.endDate ? null : DEFAULT_EXPERIMENT_DAYS),
      symptoms: cleanExperimentSymptoms(draft.symptoms),
      note: cleanNote(draft.note),
      startedAt: draft.startDate ? startedAtFor(draft.startDate, new Date(), getLogicalToday()) : null,
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
      startDate: patch.startDate !== undefined ? patch.startDate : (existing.startDate ? new Date(existing.startDate) : null),
      endDate: patch.endDate !== undefined ? patch.endDate : (existing.endDate ? new Date(existing.endDate) : null),
      days: patch.days !== undefined ? patch.days : existing.days,
      symptoms: patch.symptoms ?? existing.symptoms,
      note: patch.note !== undefined ? patch.note : existing.note,
    };
    if (experimentRefusal(merged)) return null;
    const next: Experiment = {
      ...existing,
      label: merged.label.trim(),
      startDate: patch.startDate !== undefined ? (patch.startDate ? noonIso(patch.startDate) : null) : existing.startDate,
      endDate: patch.endDate !== undefined ? (patch.endDate ? noonIso(patch.endDate) : null) : existing.endDate,
      days: merged.days ?? null,
      symptoms: cleanExperimentSymptoms(merged.symptoms),
      note: cleanNote(merged.note),
      // The recorded moment belongs to the day it was recorded for: moving the first day drops it.
      startedAt: patch.startDate !== undefined && patch.startDate && existing.startDate
        && experimentDayKey(noonIso(patch.startDate)) === experimentDayKey(existing.startDate)
        ? existing.startedAt : (patch.startDate !== undefined ? null : existing.startedAt),
    };
    dbUpdateExperiment(next);
    set({ experiments: get().experiments.map(e => (e.id === id ? next : e)).sort(byStart) });
    return next;
  },

  startExperiment(id, { startDate, days }) {
    const existing = get().experiments.find(e => e.id === id);
    if (!existing || existing.startDate) return null;
    const length = days !== undefined ? days : existing.days;
    const endDate = length === null ? null : endOfLength(startDate, length);
    if (experimentRefusal({ label: existing.label, startDate, endDate, days: length })) return null;
    const next: Experiment = {
      ...existing,
      startDate: noonIso(startDate),
      endDate: endDate ? noonIso(endDate) : null,
      days: length,
      startedAt: startedAtFor(startDate, new Date(), getLogicalToday()),
    };
    dbUpdateExperiment(next);
    set({ experiments: get().experiments.map(e => (e.id === id ? next : e)).sort(byStart) });
    return next;
  },

  stopExperiment(id, endDate) {
    const existing = get().experiments.find(e => e.id === id);
    if (!existing || !existing.startDate) return null;
    if (experimentRefusal({ label: existing.label, startDate: new Date(existing.startDate), endDate })) return null;
    const next: Experiment = { ...existing, endDate: noonIso(endDate) };
    dbUpdateExperiment(next);
    set({ experiments: get().experiments.map(e => (e.id === id ? next : e)).sort(byStart) });
    return next;
  },

  removeExperiment(id) {
    dbDeleteExperiment(id);
    set({ experiments: get().experiments.filter(e => e.id !== id) });
  },
}));
