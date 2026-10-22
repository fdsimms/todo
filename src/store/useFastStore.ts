import { create } from 'zustand';
import type { Fast } from '../types';
import { dbDeleteFast, dbGetAllFasts, dbInsertFast, dbUpdateFast } from '../db/database';
import { generateId } from '../utils/id';
import { activeFast, clampFastGoalHours, fastGoalAt, fastStartProblem } from '../utils/fasting';
import { cancelFastGoal, scheduleFastGoal } from '../utils/notifications';

/**
 * Fasts, started and ended by hand on the Food log. The rules are
 * `src/utils/fasting.ts`; this keeps the rows and the one notification that
 * says the goal was reached, which every write here re-schedules or cancels so
 * it can't outlive the fast it was about.
 *
 * Loaded wholesale at startup, like the meter readings: one row a day at most.
 */
interface FastStore {
  fasts: Fast[];
  initialized: boolean;
  initialize: () => void;
  /** Starts a fast, or returns null when one is already running or the start can't be saved. */
  startFast: (startedAt: Date, goalHours: number) => Fast | null;
  /** Ends the running fast at `endedAt` (now by default). */
  endFast: (endedAt?: Date) => Fast | null;
  /** Moves a fast's start or changes its goal. Refuses a start `fastStartProblem` rejects. */
  updateFast: (id: string, patch: { startedAt?: Date; goalHours?: number }) => Fast | null;
  deleteFast: (id: string) => void;
}

const byStart = (a: Fast, b: Fast) => a.startedAt.localeCompare(b.startedAt);

/** Points the goal notification at the running fast, or clears it when nothing runs. */
function syncGoalNotification(fasts: readonly Fast[]): void {
  const running = activeFast(fasts);
  if (running) void scheduleFastGoal(running.goalHours, fastGoalAt(running));
  else void cancelFastGoal();
}

export const useFastStore = create<FastStore>((set, get) => ({
  fasts: [],
  initialized: false,

  initialize() {
    const fasts = dbGetAllFasts();
    set({ fasts, initialized: true });
    // Fasts sync, so one started or ended on another device is only known
    // here once it is read in; re-aiming the notice on every load keeps it
    // from ringing about a fast that ended somewhere else.
    syncGoalNotification(fasts);
  },

  startFast(startedAt, goalHours) {
    if (activeFast(get().fasts)) return null;
    if (fastStartProblem(startedAt, new Date()) !== null) return null;
    const fast: Fast = {
      id: generateId(),
      startedAt: startedAt.toISOString(),
      endedAt: null,
      goalHours: clampFastGoalHours(goalHours),
      createdAt: new Date().toISOString(),
    };
    dbInsertFast(fast);
    const fasts = [...get().fasts, fast].sort(byStart);
    set({ fasts });
    syncGoalNotification(fasts);
    return fast;
  },

  endFast(endedAt = new Date()) {
    const running = activeFast(get().fasts);
    if (!running) return null;
    // A fast ended "before" it began (a start moved forward by a clock change,
    // say) ends at its start rather than with a negative length.
    const end = Math.max(endedAt.getTime(), new Date(running.startedAt).getTime());
    const ended: Fast = { ...running, endedAt: new Date(end).toISOString() };
    dbUpdateFast(ended);
    const fasts = get().fasts.map(f => (f.id === ended.id ? ended : f));
    set({ fasts });
    syncGoalNotification(fasts);
    return ended;
  },

  updateFast(id, patch) {
    const fast = get().fasts.find(f => f.id === id);
    if (!fast) return null;
    const startedAt = patch.startedAt ?? new Date(fast.startedAt);
    if (fastStartProblem(startedAt, new Date(), fast.endedAt ? new Date(fast.endedAt) : null) !== null) return null;
    const next: Fast = {
      ...fast,
      startedAt: startedAt.toISOString(),
      goalHours: patch.goalHours === undefined ? fast.goalHours : clampFastGoalHours(patch.goalHours),
    };
    dbUpdateFast(next);
    const fasts = get().fasts.map(f => (f.id === id ? next : f)).sort(byStart);
    set({ fasts });
    syncGoalNotification(fasts);
    return next;
  },

  deleteFast(id) {
    dbDeleteFast(id);
    const fasts = get().fasts.filter(f => f.id !== id);
    set({ fasts });
    syncGoalNotification(fasts);
  },
}));
