import { create } from 'zustand';
import type { RecipeStepTimer, RestTimer, StepTimer } from '../types';
import { dbDeleteSetting, dbGetSetting, dbSetSetting } from '../db/database';
import { generateId } from '../utils/id';
import {
  MAX_STEP_TIMER_SECONDS,
  MIN_STEP_TIMER_SECONDS,
  STEP_TIMER_NUDGE_SECONDS,
  isStepTimerRunning,
  nudgedDuration,
  parseStepTimerQueue,
  pruneStaleStepTimers,
  serializeStepTimerQueue,
  stepTimerElapsed,
} from '../utils/stepTimers';
import { cancelStepAlarm, scheduleStepAlarm } from '../utils/notifications';

/**
 * The countdowns started from cooking steps — the stack cook mode shows in its
 * footer — and the rest between two sets of a workout, which is the same kind
 * of clock with a different alarm policy (see `StepTimer`). One store, two
 * kinds: the rest is never a fourth timer system (docs/arch/workouts.md).
 *
 * **Its own store, and persisted, both for the same reason: a step timer has to
 * outlive the screen that started it.** The point of setting one is that you
 * put the pan on and walk away, which means closing cook mode, leaving the app,
 * and quite possibly the phone locking itself for the whole seven minutes. The
 * alarm is scheduled with the OS and would survive that on its own, but the row
 * saying "4:12 left" only survives if the two raw fields do — and coming back
 * to an app that has forgotten a timer it is about to ring is worse than never
 * having offered one.
 *
 * Written through to the `settings` table on every change, the same key/value
 * store the tag registry and the shared-link queue use. It is deliberately not
 * a table: at most a handful of rows exist at once, none of them outlive the
 * afternoon (`pruneStaleStepTimers`), and nothing ever queries them by anything
 * but "all of them".
 *
 * Deliberately not fields on `useRecipeStore` either. That store owns two
 * timers per recipe, fixed at one cook and one prep, and this is the opposite
 * shape: several at once, belonging to a sentence rather than to the dish, and
 * gone by evening. See `StepTimer` in types/index.ts.
 */
const SETTINGS_KEY = 'stepTimers';

interface StepTimerState {
  timers: StepTimer[];
  /** Whether the persisted stack has been read back yet this launch. */
  hydrated: boolean;
  /** Reads the persisted stack and re-arms its alarms. Safe to call twice. */
  hydrate: () => void;
  /**
   * A workout session's rest, and only the one named when `restId` is given,
   * reading the stack back first if nothing has this launch: a cold launch in
   * the background (woken by the Apple Watch) has no React tree to have done
   * it, and a rest still counting down must not read as none.
   */
  restFor: (sessionId: string, restId?: string | null) => RestTimer | null;
  /**
   * Re-reads from whichever database is now live — what demo mode calls on the
   * way in and the way out, for the reason `useSharedLinkStore.reload` gives:
   * this is a store holding state in memory *and* writing through to
   * `settings`, so without it a timer started in the demo would be written into
   * the real stack on its way out.
   */
  reload: () => void;
  /** Starts a countdown against a step, and returns it. */
  start: (input: {
    recipeId: string;
    recipeName: string;
    stepId: string;
    stepLabel: string;
    /** `stepTimerExcerpt` of the step, when there is one to read. */
    stepExcerpt?: string;
    durationSeconds: number;
  }) => RecipeStepTimer | null;
  /**
   * Starts the rest after a set, replacing any rest already running: there is
   * one rest at a time, and the newest set is the one being rested after.
   */
  startRest: (input: {
    sessionId: string;
    exerciseId: string;
    sessionTitle: string;
    label: string;
    durationSeconds: number;
    /**
     * When the rest began, if not now: a set ticked on the Apple Watch and
     * applied a moment later rests from the tick, as the watch's own countdown
     * does (`tickSet`).
     */
    startedAt?: string;
  }) => RestTimer | null;
  pause: (id: string) => void;
  resume: (id: string) => void;
  /**
   * Adds a minute, from the row's "+1 min", or moves it by `seconds` either way
   * (a rest's −15 s and +30 s; see `nudgedDuration`). Forward also un-rings a
   * timer that just went off.
   */
  addTime: (id: string, seconds?: number) => void;
  /** Puts a timer back to its full length and starts it again — the answer to "per side". */
  restart: (id: string) => void;
  /** Drops one timer: cancelled mid-run, or dismissed after it rang. */
  remove: (id: string) => void;
  /** Drops every timer belonging to one recipe, for "stop them all" at the end of a cook. */
  removeForRecipe: (recipeId: string) => void;
  /**
   * Drops every rest that doesn't belong to `liveSessionId` (all of them for
   * null): a rest is about the workout in progress, and one left over from a
   * session finished, thrown away or deleted on another device would ring
   * about nothing. `WorkoutModeHost` runs it whenever the live session changes.
   */
  removeRestsOutside: (liveSessionId: string | null) => void;
}

function persist(timers: StepTimer[]): void {
  // An empty stack deletes its row rather than storing "[]", same treatment an
  // emptied registry gets.
  if (timers.length === 0) dbDeleteSetting(SETTINGS_KEY);
  else dbSetSetting(SETTINGS_KEY, serializeStepTimerQueue(timers));
}

/**
 * Every write goes through here: persist, then reconcile the one timer's alarm.
 *
 * Scheduling is keyed on the timer's id and always cancels before it schedules
 * (see `scheduleStepAlarm`), so a pause, a "+1 min" and a restart each land as
 * one replacement rather than a second alarm stacked behind the first. Fire and
 * forget, the same shape every `scheduleTaskReminder(...)` call in
 * `useTaskStore` has.
 */
function commit(
  set: (partial: { timers: StepTimer[] }) => void,
  timers: StepTimer[],
  changed: StepTimer | null,
): void {
  persist(timers);
  set({ timers });
  if (changed) scheduleStepAlarm(changed);
}

function load(): StepTimer[] {
  const timers = pruneStaleStepTimers(parseStepTimerQueue(dbGetSetting(SETTINGS_KEY)));
  // Re-arm from what was actually restored. A pending notification survives a
  // relaunch on its own, but not a reinstall, a permission change, or the
  // demo-mode swap that cancelled it — and rescheduling is idempotent, so
  // doing it unconditionally is cheaper than working out which case this is.
  // Same startup discipline as `rescheduleAllTimerAlarms`.
  for (const timer of timers) {
    if (isStepTimerRunning(timer)) scheduleStepAlarm(timer);
    else cancelStepAlarm(timer.id);
  }
  return timers;
}

export const useStepTimerStore = create<StepTimerState>((set, get) => ({
  timers: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const timers = load();
    persist(timers);
    set({ timers, hydrated: true });
  },

  restFor: (sessionId, restId = null) => {
    if (!get().hydrated) get().hydrate();
    return get().timers.find((t): t is RestTimer =>
      t.kind === 'rest' && t.sessionId === sessionId && (restId === null || t.id === restId)) ?? null;
  },

  reload: () => {
    // Whatever was on screen belongs to the other database; its alarms go with
    // it. The load below re-arms only what the now-live database holds.
    for (const timer of get().timers) cancelStepAlarm(timer.id);
    const timers = load();
    set({ timers, hydrated: true });
  },

  start: ({ recipeId, recipeName, stepId, stepLabel, stepExcerpt, durationSeconds }) => {
    const seconds = Math.round(durationSeconds);
    if (!Number.isFinite(seconds)) return null;
    if (seconds < MIN_STEP_TIMER_SECONDS || seconds > MAX_STEP_TIMER_SECONDS) return null;
    const now = new Date().toISOString();
    const timer: RecipeStepTimer = {
      kind: 'recipe',
      id: generateId(),
      recipeId,
      recipeName,
      stepId,
      stepLabel,
      ...(stepExcerpt ? { stepExcerpt } : {}),
      durationSeconds: seconds,
      startedAt: now,
      elapsedSeconds: 0,
      createdAt: now,
    };
    // A step naming one duration can want two timers running against it (two
    // pans, two batches), so nothing here collapses onto an existing row.
    commit(set, [...get().timers, timer], timer);
    return timer;
  },

  startRest: ({ sessionId, exerciseId, sessionTitle, label, durationSeconds, startedAt }) => {
    const seconds = Math.round(durationSeconds);
    if (!Number.isFinite(seconds)) return null;
    if (seconds < MIN_STEP_TIMER_SECONDS || seconds > MAX_STEP_TIMER_SECONDS) return null;
    // Never later than now: a start in the future would count down from a
    // moment that hasn't come, and the elapsed time clamps at zero anyway.
    const nowMs = Date.now();
    const fromMs = startedAt ? Date.parse(startedAt) : NaN;
    const now = new Date(Number.isFinite(fromMs) && fromMs < nowMs ? fromMs : nowMs).toISOString();
    const timer: RestTimer = {
      kind: 'rest',
      id: generateId(),
      sessionId,
      exerciseId,
      sessionTitle,
      label,
      durationSeconds: seconds,
      startedAt: now,
      elapsedSeconds: 0,
      createdAt: now,
    };
    // The rest it replaces goes with its alarm: a rest after set 2 still
    // pending when set 3 is logged would otherwise ring halfway through it.
    const replaced = get().timers.filter(t => t.kind === 'rest');
    for (const old of replaced) cancelStepAlarm(old.id);
    commit(set, [...get().timers.filter(t => t.kind !== 'rest'), timer], timer);
    return timer;
  },

  pause: id => {
    const timer = get().timers.find(t => t.id === id);
    if (!timer || !isStepTimerRunning(timer)) return;
    const paused: StepTimer = { ...timer, startedAt: null, elapsedSeconds: stepTimerElapsed(timer) };
    commit(set, get().timers.map(t => (t.id === id ? paused : t)), paused);
  },

  resume: id => {
    const timer = get().timers.find(t => t.id === id);
    if (!timer || isStepTimerRunning(timer)) return;
    const resumed: StepTimer = { ...timer, startedAt: new Date().toISOString() };
    commit(set, get().timers.map(t => (t.id === id ? resumed : t)), resumed);
  },

  addTime: (id, seconds = STEP_TIMER_NUDGE_SECONDS) => {
    const timer = get().timers.find(t => t.id === id);
    if (!timer) return;
    // Measured from now, not from the original length; see nudgedDuration.
    const extended: StepTimer = { ...timer, durationSeconds: nudgedDuration(timer, seconds) };
    commit(set, get().timers.map(t => (t.id === id ? extended : t)), extended);
  },

  restart: id => {
    const timer = get().timers.find(t => t.id === id);
    if (!timer) return;
    const restarted: StepTimer = {
      ...timer,
      startedAt: new Date().toISOString(),
      elapsedSeconds: 0,
    };
    commit(set, get().timers.map(t => (t.id === id ? restarted : t)), restarted);
  },

  remove: id => {
    if (!get().timers.some(t => t.id === id)) return;
    cancelStepAlarm(id);
    commit(set, get().timers.filter(t => t.id !== id), null);
  },

  removeForRecipe: recipeId => {
    const mine = (t: StepTimer) => t.kind === 'recipe' && t.recipeId === recipeId;
    const going = get().timers.filter(mine);
    if (going.length === 0) return;
    for (const timer of going) cancelStepAlarm(timer.id);
    commit(set, get().timers.filter(t => !mine(t)), null);
  },

  removeRestsOutside: liveSessionId => {
    const stale = (t: StepTimer) => t.kind === 'rest' && t.sessionId !== liveSessionId;
    const going = get().timers.filter(stale);
    if (going.length === 0) return;
    for (const timer of going) cancelStepAlarm(timer.id);
    commit(set, get().timers.filter(t => !stale(t)), null);
  },
}));
