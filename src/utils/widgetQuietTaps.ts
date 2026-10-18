import type { GroceryListEntry, Task, WorkoutSetKind } from '../types';
import type { WatchSessionInput } from '../store/useWorkoutStore';
import type { WeightUnit } from './weightLog';
import { completionTapFor, offersMealLogOnCompletion } from './completionTap';
import { workoutTaskEffect } from './workoutTask';
import { WORKOUT_SET_KINDS, weightFromDisplay } from './workoutData';

/**
 * Taps on a widget that apply without bringing the app forward.
 *
 * The widget's first checkbox (`CompleteTaskIntent`) opens the app on every
 * tap, so that the row's completion animation plays and anything the task asks
 * on completion gets asked. For a plain task there's nothing to ask, and ticking
 * three things off the home screen meant three trips into the app and back.
 * Those taps now go to `CompleteTaskQuietlyIntent` and `CheckGroceryItemIntent`
 * (`targets/todo-widget/WidgetQuietIntents.swift`), which run in the widget's
 * own process and only queue the tap. The app applies the queue the next time
 * it comes forward, with nothing on screen moving.
 *
 * **Which tasks still open the app is `widgetTapNeedsApp`, decided twice.**
 * Once when the snapshot is written, to pick the intent a row's checkbox runs,
 * and again here at drain time, because the task may have changed in between
 * (a question added in the editor on another device, a target's last unit
 * coming due). A tap that turns out to need the app is handed to
 * `useWidgetCompletionStore`, which is the path the opening intent already
 * takes, and Today runs it the next time a row for it mounts.
 *
 * What the quiet path costs is immediacy: the next occurrence of a repeating
 * task, its streak and any sync wait until the app next opens. The intent
 * cancels the task's own pending reminder as it queues the tap, so the one
 * thing that would otherwise visibly disagree with the widget (a reminder for
 * something already checked off) doesn't.
 */

/**
 * One queued tap. A JSON record in `widget_quiet_taps.json`, written by the
 * Swift intents and read here.
 */
export interface QuietTap {
  /**
   * `complete` checks a task off, `unit` logs one unit of a daily target (the
   * widget sends these for every target row, so a run of taps is a run of
   * units), `grocery` puts an item in the cart on one list, `choose` picks one
   * option of an either/or on one list (the others come off it), and
   * `groceryAdd` adds `title` to one list. Only the Apple Watch sends the last
   * two: the widget draws no checkbox on an either/or and has no text entry.
   */
  kind: QuietTapKind;
  /**
   * The task id, or the grocery item id. A `groceryAdd` names no existing row,
   * so its id is the watch's own tap id, only to keep the entry well formed.
   * A workout tap's id is the set (`set`), the phone's session (`restAdd`,
   * `restSkip`, `finish`) or the watch's own workout (`watchSession`).
   */
  id: string;
  /** The words to add, for `groceryAdd` only. */
  title?: string;
  /** The grocery list the row was on; null is the home list. Tasks carry null. */
  listId: string | null;
  /** When the tap happened, ISO. */
  at: string;
  /**
   * Set on a tap made on the Apple Watch: the watch's own id for it, which the
   * watch settles its drawing by (WatchSession.swift). Kept through a drain so
   * a tap put back on the queue (`tapsToRequeue`) is still the same tap there.
   */
  watchTapId?: string;
  /** `set`, `restAdd`, `restSkip`, `finish`: the phone's workout the tap was made on. */
  sessionId?: string;
  /**
   * `restAdd`, `restSkip`: the phone's rest the watch was showing, when it was
   * the phone's (absent while the watch was still drawing the rest its own tick
   * started, before the phone had said).
   */
  restId?: string;
  /** `set`: the numbers the set was done at, already in kilograms. */
  values?: WatchTickValues;
  /** `watchSession`: the workout the watch ran on its own, read (`parseWatchSession`). */
  workout?: WatchSessionInput;
}

/**
 * Every kind. The first five tick tasks and grocery rows; the rest are the
 * Apple Watch's workout (phase 8): `set` ticks a set of the phone's workout in
 * progress with the numbers it was done at, `restAdd` and `restSkip` are the
 * rest screen's +30 s and Skip, `finish` is Finish workout, and `watchSession`
 * is a whole workout the watch ran on its own, sent once when it was finished.
 */
export type QuietTapKind =
  | 'complete' | 'unit' | 'grocery' | 'choose' | 'groceryAdd'
  | 'set' | 'restAdd' | 'restSkip' | 'finish' | 'watchSession';

const QUIET_TAP_KINDS: readonly QuietTapKind[] = [
  'complete', 'unit', 'grocery', 'choose', 'groceryAdd', 'set', 'restAdd', 'restSkip', 'finish', 'watchSession',
];

/** The kinds that tick a task, and so the only ones a drain can hand to the app. */
const TASK_KINDS: ReadonlySet<QuietTapKind> = new Set(['complete', 'unit']);

/** A set's numbers from the watch, in kilograms. Only what the watch sent; the rest of the set stays as it is. */
export interface WatchTickValues {
  weightKg?: number;
  reps?: number;
  durationSeconds?: number;
  distanceM?: number;
}

export type QuietTapAction =
  | { type: 'complete'; id: string; at: string }
  | { type: 'logUnit'; id: string }
  /** Needs a person after all: run it through the opening intent's path. */
  | {
      type: 'handToApp';
      id: string;
      at: string;
      /**
       * Set when the task comes from a workout the watch finished, so there is
       * no tap of its own to put back: a drain with nobody there requeues it as
       * a plain `complete` tap (`workoutHandOffTaps`).
       */
      fromWorkout?: true;
    }
  | { type: 'checkGrocery'; itemId: string; listId: string | null }
  | { type: 'chooseOption'; itemId: string; listId: string | null }
  | { type: 'addGrocery'; title: string; listId: string | null }
  /** `tickSet` with the watch's numbers, at the moment it was done. */
  | { type: 'tickWorkoutSet'; sessionId: string; setId: string; at: string; values: WatchTickValues }
  /** The rest's +30 s, on the session's rest (and only that rest, when the tap names one). */
  | { type: 'nudgeRest'; sessionId: string; restId: string | null }
  | { type: 'skipRest'; sessionId: string; restId: string | null }
  | { type: 'finishWorkout'; sessionId: string; at: string }
  | { type: 'addWatchSession'; workout: WatchSessionInput };

/**
 * The workouts a drain is judged against: the phone's one in progress, with
 * the sets still open, and every session already in the log.
 */
export interface QuietTapWorkouts {
  live: { id: string; taskId: string | null; openSetIds: ReadonlySet<string> } | null;
  sessionIds: ReadonlySet<string>;
}

/**
 * Whether a widget tap on this task has to bring the app forward to be done
 * right: anything a tap in the app answers with a sheet, a picker, a refusal or
 * a follow-up question rather than a plain tick or one unit.
 */
export function widgetTapNeedsApp(task: Task, mealLogPrompt: boolean): boolean {
  const tap = completionTapFor(task);
  if (tap === 'log-unit') return false;
  if (tap !== 'complete') return true;
  // Both of these still complete the task, but follow it with a question the
  // app asks in its own UI: "Set a reminder?" and "what did you eat?".
  return Boolean(task.completionTimerMinutes) || offersMealLogOnCompletion(task, mealLogPrompt);
}

/**
 * Reads the queue file. Anything malformed is dropped rather than failing the
 * whole drain: the file is deleted once read, so a bad entry kept back would
 * only be lost later instead.
 */
export function parseQuietTaps(json: string): QuietTap[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const taps: QuietTap[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const fields = entry as Record<string, unknown>;
    const { kind, id, listId, at, watchTapId, title } = fields;
    if (!(QUIET_TAP_KINDS as readonly unknown[]).includes(kind)) continue;
    if (typeof id !== 'string' || id === '') continue;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
    const tap: QuietTap = { kind: kind as QuietTapKind, id, listId: typeof listId === 'string' && listId !== '' ? listId : null, at };
    if (typeof watchTapId === 'string' && watchTapId !== '') tap.watchTapId = watchTapId;
    if (kind === 'groceryAdd') {
      const words = typeof title === 'string' ? title.trim() : '';
      if (words === '') continue;
      tap.title = words;
    }
    if (kind === 'set' || kind === 'restAdd' || kind === 'restSkip' || kind === 'finish') {
      // Every workout tap names the phone's session it was made on: a stale
      // watch must never log onto whatever workout happens to be going now.
      const sessionId = idOf(fields.sessionId) ?? (kind === 'set' ? null : id);
      if (!sessionId) continue;
      tap.sessionId = sessionId;
      const restId = idOf(fields.restId);
      if (restId && kind !== 'set' && kind !== 'finish') tap.restId = restId;
      if (kind === 'set') tap.values = tickValuesFromWatch(fields, fields.unit);
    }
    if (kind === 'watchSession') {
      const workout = parseWatchSession(fields.workout);
      if (!workout || workout.id !== id) continue;
      tap.workout = workout;
    }
    taps.push(tap);
  }
  return taps;
}

/**
 * What to do with each queued tap, judged against the stores as they are now.
 *
 * Taps are walked in order against a working copy of each task, so three
 * units on a target of eight log three, and the one that meets the target
 * completes it (through `logQuotaUnit`, which hands off to `completeTask`
 * itself). Once a task is done, later taps on it are dropped.
 *
 * `isCurrentDay` answers whether a tap's time falls in today's logical day. A
 * unit tapped on an earlier day is dropped rather than logged: the rollover has
 * already closed that day's count, and logging it now would credit today with
 * a glass drunk yesterday. A completion keeps its tap time instead
 * (`completeTask`'s `completedAt`), which is what the opening path does too.
 */
export function planQuietTaps(
  taps: readonly QuietTap[],
  tasks: readonly Task[],
  entries: readonly GroceryListEntry[],
  mealLogPrompt: boolean,
  isCurrentDay: (iso: string) => boolean,
  workouts: QuietTapWorkouts | null = null,
): QuietTapAction[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const working = new Map<string, Task>();
  const settled = new Set<string>();
  const checked = new Set<string>();
  const actions: QuietTapAction[] = [];

  // The workout as this drain leaves it, so a set ticked twice in one queue
  // is ticked once and nothing applies to a workout finished earlier in it.
  const ticked = new Set<string>();
  const finished = new Set<string>();
  const written = new Set<string>();
  const live = workouts?.live ?? null;
  const isLive = (sessionId: string | undefined) => !!live && live.id === sessionId && !finished.has(sessionId);
  const askFor = (taskId: string | null): Task | null => {
    const task = taskId ? byId.get(taskId) ?? null : null;
    return task && workoutTaskEffect(task) === 'ask' ? task : null;
  };

  for (const tap of taps) {
    // ==== the Apple Watch's workout ====
    // Ahead of the task branch below, which would read a set's or a session's
    // id as a task's and find nothing. A tap about a workout that is no longer
    // the one in progress (finished, discarded, another one started since the
    // watch last heard) does nothing: tickSet's own guards say the same.
    if (tap.kind === 'set') {
      if (!isLive(tap.sessionId) || !live!.openSetIds.has(tap.id) || ticked.has(tap.id)) continue;
      ticked.add(tap.id);
      actions.push({ type: 'tickWorkoutSet', sessionId: tap.sessionId!, setId: tap.id, at: tap.at, values: tap.values ?? {} });
      continue;
    }
    if (tap.kind === 'restAdd' || tap.kind === 'restSkip') {
      if (!isLive(tap.sessionId)) continue;
      actions.push({ type: tap.kind === 'restAdd' ? 'nudgeRest' : 'skipRest', sessionId: tap.sessionId!, restId: tap.restId ?? null });
      continue;
    }
    if (tap.kind === 'finish') {
      if (!isLive(tap.sessionId)) continue;
      finished.add(tap.sessionId!);
      actions.push({ type: 'finishWorkout', sessionId: tap.sessionId!, at: tap.at });
      // Finishing completes the task the way its checkbox would; one that asks
      // a question is asked by the app, as a widget tap on it is.
      const ask = askFor(live!.taskId);
      if (ask) actions.push({ type: 'handToApp', id: ask.id, at: tap.at, fromWorkout: true });
      continue;
    }
    if (tap.kind === 'watchSession') {
      const workout = tap.workout;
      if (!workout || written.has(workout.id) || workouts?.sessionIds.has(workout.id)) continue;
      written.add(workout.id);
      actions.push({ type: 'addWatchSession', workout });
      const ask = askFor(workout.taskId);
      if (ask) actions.push({ type: 'handToApp', id: ask.id, at: workout.endedAt, fromWorkout: true });
      continue;
    }

    if (tap.kind === 'groceryAdd') {
      actions.push({ type: 'addGrocery', title: tap.title ?? '', listId: tap.listId });
      continue;
    }
    if (tap.kind === 'choose') {
      const key = `${tap.listId ?? ''}\u0000${tap.id}`;
      if (checked.has(key)) continue;
      const entry = entries.find(e => e.itemId === tap.id && e.listId === tap.listId);
      // Only a row that is still one side of an either/or can be chosen. If
      // the choice was already made (on the phone, say), it is simply done.
      if (!entry?.choiceGroup) continue;
      checked.add(key);
      actions.push({ type: 'chooseOption', itemId: tap.id, listId: tap.listId });
      continue;
    }
    if (tap.kind === 'grocery') {
      const key = `${tap.listId ?? ''}\u0000${tap.id}`;
      if (checked.has(key)) continue;
      const entry = entries.find(e => e.itemId === tap.id && e.listId === tap.listId);
      // Off the list, already in the cart, or one side of an either/or. The
      // widget never offers a tick on that last kind (ticking one option is
      // how the choice gets made, which deletes the others, and that belongs
      // in front of the list), but a row can have become one since.
      if (!entry || entry.checked || entry.choiceGroup) continue;
      checked.add(key);
      actions.push({ type: 'checkGrocery', itemId: tap.id, listId: tap.listId });
      continue;
    }

    if (settled.has(tap.id)) continue;
    const task = working.get(tap.id) ?? byId.get(tap.id);
    if (!task || task.completed || task.archived) continue;

    const tapKind = completionTapFor(task);
    if (tapKind === 'log-unit') {
      if (!isCurrentDay(tap.at)) continue;
      actions.push({ type: 'logUnit', id: tap.id });
      working.set(tap.id, { ...task, progressCount: task.progressCount + 1 });
      continue;
    }
    settled.add(tap.id);
    if (widgetTapNeedsApp(task, mealLogPrompt)) {
      actions.push({ type: 'handToApp', id: tap.id, at: tap.at });
    } else if (tap.kind === 'unit') {
      // The unit that meets the target. logQuotaUnit completes the task itself.
      if (isCurrentDay(tap.at)) actions.push({ type: 'logUnit', id: tap.id });
    } else {
      actions.push({ type: 'complete', id: tap.id, at: tap.at });
    }
  }
  return actions;
}

/**
 * The taps to put back on the queue instead of handing them to the app, when
 * the drain ran with nobody looking (a watch tap that woke the app in the
 * background).
 *
 * A hand-off goes to `useWidgetCompletionStore`, which lives in memory and is
 * read by the Today screen. With the app in the background there may be no
 * screen at all, and iOS can end the process before anyone opens it, so a tap
 * handed off then would be gone with nothing left to retry from. Every tap on
 * a handed-off task goes back, in its original order, so the next foreground
 * drain plans it exactly as this one did and hands it over with a person there.
 */
export function tapsToRequeue(taps: readonly QuietTap[], handedOverIds: ReadonlySet<string>): QuietTap[] {
  return taps.filter(tap => TASK_KINDS.has(tap.kind) && handedOverIds.has(tap.id));
}

/**
 * The taps to queue in place of a workout's hand-off, for the same drain with
 * nobody looking. A workout's own taps are never put back: they apply with or
 * without a screen. Only the question its task asks needs a person, and there
 * is no tap of the task's own to requeue, so each becomes a plain `complete`
 * on that task, at the moment the workout ended, which the next foreground
 * drain hands to the app as it would any tap on a task that asks.
 */
export function workoutHandOffTaps(plan: readonly QuietTapAction[]): QuietTap[] {
  const out: QuietTap[] = [];
  for (const action of plan) {
    if (action.type === 'handToApp' && action.fromWorkout) {
      out.push({ kind: 'complete', id: action.id, listId: null, at: action.at });
    }
  }
  return out;
}

// ==== what the Apple Watch's workout sends back ====

const idOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

const finiteAtLeastZero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

const readUnit = (v: unknown): WeightUnit => (v === 'lb' ? 'lb' : 'kg');

/**
 * A set's numbers as the watch sent them (in `unit`), in kilograms for the
 * store. Only what the watch sent is written: an absent number leaves the
 * set's own value as it is.
 */
export function tickValuesFromWatch(
  raw: { weight?: unknown; reps?: unknown; durationSeconds?: unknown; distanceM?: unknown },
  unit: unknown,
): WatchTickValues {
  const out: WatchTickValues = {};
  const weight = finiteAtLeastZero(raw.weight);
  if (weight !== null) out.weightKg = weightFromDisplay(weight, readUnit(unit));
  const reps = finiteAtLeastZero(raw.reps);
  if (reps !== null) out.reps = Math.round(reps);
  const duration = finiteAtLeastZero(raw.durationSeconds);
  if (duration !== null) out.durationSeconds = Math.round(duration);
  const distance = finiteAtLeastZero(raw.distanceM);
  if (distance !== null) out.distanceM = distance;
  return out;
}

const isoOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};


/**
 * A workout the watch ran on its own, as it sent it (`WatchOwnWorkout.payload`
 * in targets/todo-watch), read into the store's `addWatchSession` input: the
 * done sets only, in kilograms. Null for anything that isn't one, or that has
 * no set done. Malformed sets are dropped rather than failing the workout.
 */
export function parseWatchSession(raw: unknown): WatchSessionInput | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = idOf(r.id);
  const startedAt = isoOf(r.startedAt);
  const endedAt = isoOf(r.endedAt);
  if (!id || !startedAt || !endedAt || !Array.isArray(r.sets)) return null;
  const unit = readUnit(r.unit);
  const sets: WatchSessionInput['sets'] = [];
  for (const entry of r.sets) {
    if (typeof entry !== 'object' || entry === null) continue;
    const s = entry as Record<string, unknown>;
    const setId = idOf(s.id);
    const exerciseId = idOf(s.exerciseId);
    const completedAt = isoOf(s.completedAt);
    if (!setId || !exerciseId || !completedAt) continue;
    const values = tickValuesFromWatch(s, unit);
    sets.push({
      id: setId,
      exerciseId,
      position: Math.round(finiteAtLeastZero(s.position) ?? 0),
      setIndex: Math.round(finiteAtLeastZero(s.setIndex) ?? 0),
      kind: (WORKOUT_SET_KINDS as readonly unknown[]).includes(s.kind) ? (s.kind as WorkoutSetKind) : 'working',
      weightKg: values.weightKg ?? null,
      reps: values.reps ?? null,
      durationSeconds: values.durationSeconds ?? null,
      distanceM: values.distanceM ?? null,
      completedAt,
    });
  }
  if (sets.length === 0) return null;
  return {
    id,
    routineId: idOf(r.routineId),
    programId: idOf(r.programId),
    taskId: idOf(r.taskId),
    title: typeof r.title === 'string' ? r.title : '',
    startedAt,
    endedAt,
    sets,
  };
}
