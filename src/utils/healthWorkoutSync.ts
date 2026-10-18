import type { WorkoutSession } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';

/**
 * Writing a finished workout to Apple Health, and retracting it again.
 *
 * The fourth sibling of `healthCompletionSync.ts`, `healthWeightSync.ts` and
 * `healthFoodSync.ts`, shaped like the meal write because it is the meal
 * write's case again: a record a person made by hand, which they can edit or
 * delete afterwards, so the write keeps the id of what it saved
 * (`WorkoutSession.healthWorkoutId`) and a delete takes it back. See
 * `docs/arch/health-data.md`, "The fourth write, and a read beside it".
 *
 * **One trigger, a person saving one workout.** `finishSession` in
 * `useWorkoutStore` calls `logWorkoutToHealth` when Save is tapped on workout
 * mode's summary, and an edit of a written workout's times rewrites it. Nothing
 * sweeps history: a workout finished while the switch was off, before this
 * shipped, or imported from another app's file stays out of Health. The one
 * delayed caller is a workout an agent logged over MCP
 * (`WorkoutSession.healthWritePending`), the meal write's exception unchanged.
 *
 * **Absent stays absent.** No energy is passed: nothing on the phone measured
 * any, and an estimate from sets is the one figure the workouts plan refuses.
 * No metadata either, so what Health holds is the span and the activity, and an
 * edit that leaves both alone has nothing to rewrite.
 *
 * **The bridge is required at the call, never imported.** `useWorkoutStore`
 * imports this file, and the MCP replica loads that store in Node, where
 * `healthBridge.ts`'s `react-native` import cannot load. Every rule here is
 * plain TypeScript; only the two native calls need the bridge, and the
 * replica never reaches them (it refuses to edit or delete a workout already
 * in Health, and its device-local write switches are off).
 */

function bridge() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./healthBridge') as typeof import('./healthBridge')).healthBridge();
  } catch {
    // Node, where `react-native` can't load: no Health, the same answer as
    // a device without it, rather than a rejection nobody awaits.
    return null;
  }
}

/** The activity a session is written as. Sets of weight and reps are all the app can say happened. */
export const WORKOUT_HEALTH_ACTIVITY = 'traditionalStrengthTraining' as const;

/**
 * How long a workout an agent logged may wait for the phone, counted from when
 * it ended, before it is dropped unwritten. The food log's limit, for its
 * reason: a phone left off, or a switch turned on a month later, must not send
 * a backlog to Health.
 */
export const PENDING_WORKOUT_WRITE_MAX_AGE_DAYS = 7;

/**
 * The bridge's own absurdity checks, made here first so a span it would refuse
 * is never reported as Health refusing the write: an end after the start, at
 * most a day long, and not ending in the future (five minutes of clock skew
 * allowed, as the bridge allows). Pure, exported for its tests.
 */
export function workoutSpanWritable(session: Pick<WorkoutSession, 'startedAt' | 'endedAt'>, now: Date = new Date()): boolean {
  if (session.endedAt === null) return false;
  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (end <= start) return false;
  if (end - start > 24 * 3_600_000) return false;
  return end <= now.getTime() + 5 * 60_000;
}

/**
 * What the pending-write pass does with one flagged session. Pure, and where
 * "a workout an agent logged is written, and history is not" is decided.
 *
 * - `write`: try it now.
 * - `drop`: already written, still live, or ended over the age limit ago;
 *   clear the flag and write nothing.
 *
 * A session has no creation stamp, so its age is from when it ended: a workout
 * logged over MCP more than a week after it happened is not written.
 */
export function pendingWorkoutWriteAction(session: WorkoutSession, now: Date = new Date()): 'write' | 'drop' {
  if (session.healthWorkoutId !== null || session.endedAt === null) return 'drop';
  const age = now.getTime() - new Date(session.endedAt).getTime();
  if (!Number.isFinite(age) || age > PENDING_WORKOUT_WRITE_MAX_AGE_DAYS * 86_400_000) return 'drop';
  return 'write';
}

/**
 * Whether the switches let a workout be written: Log to Health, its Workouts
 * row under it, and the Workouts area the row lives in. Retraction reads none
 * of them.
 */
export function workoutHealthWriteOn(): boolean {
  const { healthWriteEnabled, workoutHealthWrite, workoutsEnabled } = useSettingsStore.getState();
  return healthWriteEnabled && workoutHealthWrite && workoutsEnabled;
}

/** What came of trying to write a workout. The food log's shape, with an id in place of sample ids. */
export interface WorkoutWriteResult {
  outcome:
    /** Saved. `workoutId` is null when the phone was locked as it finished: saved, with no id to keep. */
    | 'written'
    /** A switch is off, so nothing was attempted. */
    | 'off'
    /** No native half: not iOS, no Health on this device, or demo mode. */
    | 'unavailable'
    /** Not finished, or a span the bridge would refuse (see `workoutSpanWritable`). */
    | 'notWritable'
    /** HealthKit refused the save, which in practice means workout sharing is not allowed. */
    | 'refused';
  workoutId: string | null;
  /** Samples saved beside the workout. Always empty today: no energy is passed. */
  sampleIds: string[];
}

const nothing = (outcome: Exclude<WorkoutWriteResult['outcome'], 'written'>): WorkoutWriteResult =>
  ({ outcome, workoutId: null, sampleIds: [] });

/**
 * Writes one finished session to Health, or says why it didn't. Dated by the
 * session's own start and end, never by now.
 */
export async function logWorkoutToHealth(session: WorkoutSession): Promise<WorkoutWriteResult> {
  // Checked here as well as inside `healthBridge()`, for the reason every
  // Health writer gives: a leak would put a real workout in a real record,
  // sourced from a session that was fiction.
  if (isDemoModeActive()) return nothing('unavailable');
  if (!workoutHealthWriteOn()) return nothing('off');
  if (!workoutSpanWritable(session)) return nothing('notWritable');

  const health = bridge();
  if (!health) return nothing('unavailable');

  const saved = await health.writeHealthWorkout(session.startedAt, session.endedAt!, WORKOUT_HEALTH_ACTIVITY, null);
  if (!saved) return nothing('refused');
  return { outcome: 'written', workoutId: saved.workoutId, sampleIds: saved.sampleIds };
}

/**
 * Retracts a workout this app wrote (its id, and any sample ids saved beside
 * it). **Not gated on any switch**, the meal retraction's rule: somebody who
 * turned writing off has if anything asked more clearly for it to go. Refused
 * in demo mode, where the ids would belong to seeded fiction. True when there
 * was nothing to do.
 */
export async function retractWorkoutFromHealth(ids: readonly string[]): Promise<boolean> {
  if (isDemoModeActive()) return false;
  if (ids.length === 0) return true;
  const health = bridge();
  if (!health) return false;
  return health.deleteHealthWorkout(ids);
}
