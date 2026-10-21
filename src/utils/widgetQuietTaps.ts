import type { GroceryListEntry, Task, WorkoutSet, WorkoutSetKind } from '../types';
import type { WatchSessionInput } from '../store/useWorkoutStore';
import type { WeightUnit } from './weightLog';
import { completionTapFor, offersMealLogOnCompletion } from './completionTap';
import { workoutTaskEffect } from './workoutTask';
import { storedKgFromShown } from './dumbbellLoad';
import { WORKOUT_SET_KINDS, weightFromDisplay, weightToDisplay } from './workoutData';
import type { WatchWorkoutSpan } from './watchHealthWorkout';

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
   * `restSkip`, `finish`, `measuring`, `healthWorkout`), the watch's own
   * workout (`watchSession`) or a workout in Health (`healthRetracted`).
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
  /**
   * `set`: the numbers the person changed on the watch, already in
   * kilograms. A number they didn't touch isn't sent, so the set keeps its own.
   */
  values?: WatchTickValues;
  /** `set`, `finish`: the unit the watch showed weights in, for `changedWatchValues`. */
  unit?: WeightUnit;
  /**
   * `finish`: the sets the watch had done that the phone may not have heard
   * of yet, in the order done, so a Finish that overtakes their own taps
   * still records them (and their notes).
   */
  doneSets?: WatchDoneSet[];
  /** `finish`: notes written on the watch the phone may not have heard of yet. */
  notes?: { setId: string; note: string }[];
  /** `watchSession`: the workout the watch ran on its own, read (`parseWatchSession`). */
  workout?: WatchSessionInput;
  /** `setNote`: the words, trimmed. */
  note?: string;
  /**
   * `addSet`: the exercise the set is added to. `superset`: the partner, or
   * absent to leave the superset. `set`: the set's exercise, so
   * a tick that overtakes the `addSet` of a set added on the watch can add it.
   */
  exerciseId?: string;
  /** `addExercise`: the ids the watch gave the sets it laid out, in order. */
  setIds?: string[];
  /** `moveExercise`: which way. */
  direction?: 'up' | 'down';
  /** `measuring`: whether the watch started measuring the session (true) or stopped without saving (false). */
  on?: boolean;
  /** `healthWorkout`: the id of the workout the watch saved, or null when it saved locked with no id to give. */
  healthWorkoutId?: string | null;
  /**
   * `healthWorkout`: the times the watch saved it at, ISO, both or neither
   * (`WatchWorkoutSpan`). Absent for a save made locked.
   */
  workoutStart?: string;
  workoutEnd?: string;
}

/**
 * Every kind. The first five tick tasks and grocery rows; the rest are the
 * Apple Watch's workout (phase 8): `set` ticks a set of the phone's workout in
 * progress with the numbers it was done at, `restAdd` and `restSkip` are the
 * rest screen's +30 s and Skip, `finish` is Finish workout, and `watchSession`
 * is a whole workout the watch ran on its own, sent once when it was finished.
 * And the four the watch adds to the phone's workout: `setNote` (a dictated
 * note on a set), `addSet` and `addExercise` (with the ids the watch gave
 * them), `moveExercise` (up or down), `superset` (an exercise paired with
 * the one in `exerciseId`, or taken out of its superset when that is absent),
 * and `useSuggestion` (the load card's Use).
 *
 * And the three of the watch's HealthKit session (phase 9): `measuring` (the
 * watch started measuring the session, or stopped without saving), which
 * holds the phone's own Health write back; `healthWorkout` (the watch saved
 * the session's workout to Health, with this id); and `healthRetracted` (the
 * watch dealt with a workout the phone asked it to retract, named by `id`).
 */
export type QuietTapKind =
  | 'complete' | 'unit' | 'grocery' | 'choose' | 'groceryAdd'
  | 'set' | 'restAdd' | 'restSkip' | 'finish' | 'watchSession'
  | 'setNote' | 'addSet' | 'addExercise' | 'moveExercise' | 'superset' | 'useSuggestion'
  | 'measuring' | 'healthWorkout' | 'healthRetracted';

const QUIET_TAP_KINDS: readonly QuietTapKind[] = [
  'complete', 'unit', 'grocery', 'choose', 'groceryAdd', 'set', 'restAdd', 'restSkip', 'finish', 'watchSession',
  'setNote', 'addSet', 'addExercise', 'moveExercise', 'superset', 'useSuggestion', 'measuring', 'healthWorkout', 'healthRetracted',
];

/**
 * The kinds that name the phone's session they are about, put back in the
 * order made (`inTimeOrder`). Most act only on the workout in progress; the
 * Health two act on any session in the log, finished or not.
 */
const SESSION_KINDS: ReadonlySet<QuietTapKind> = new Set([
  'set', 'restAdd', 'restSkip', 'finish', 'setNote', 'addSet', 'addExercise', 'moveExercise', 'superset', 'useSuggestion',
  'measuring', 'healthWorkout',
]);

/** The longest note a set keeps from the watch: dictation, not an essay. */
export const WATCH_NOTE_MAX = 500;

/** The kinds that tick a task, and so the only ones a drain can hand to the app. */
const TASK_KINDS: ReadonlySet<QuietTapKind> = new Set(['complete', 'unit']);

/** A set's numbers from the watch, in kilograms. Only what the watch sent; the rest of the set stays as it is. */
export interface WatchTickValues {
  weightKg?: number;
  reps?: number;
  durationSeconds?: number;
  distanceM?: number;
}

/** A set done on the watch, carried in its Finish. */
export interface WatchDoneSet {
  id: string;
  exerciseId: string;
  at: string;
  values: WatchTickValues;
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
  | { type: 'addWatchSession'; workout: WatchSessionInput }
  /** `editSet` with the note. */
  | { type: 'noteWorkoutSet'; sessionId: string; setId: string; note: string }
  /** `markWatchMeasuring`: the watch started or stopped measuring a session. */
  | { type: 'watchMeasuring'; sessionId: string; on: boolean }
  /** `recordWatchHealthWorkout`: the watch saved a session's workout to Health. */
  | { type: 'watchHealthWorkout'; sessionId: string; workoutId: string | null; span: WatchWorkoutSpan | null }
  /** The watch dealt with a workout the phone asked it to retract (`useWatchHealthStore.retracted`). */
  | { type: 'watchHealthRetracted'; workoutId: string }
  /** `addPlannedSet` with the watch's id. */
  | { type: 'addWorkoutSet'; sessionId: string; exerciseId: string; setId: string }
  /** `addSessionExercise` with the watch's ids. */
  | { type: 'addWorkoutExercise'; sessionId: string; exerciseId: string; setIds: string[] }
  /** `moveSessionExercise`. */
  | { type: 'moveWorkoutExercise'; sessionId: string; exerciseId: string; direction: 'up' | 'down' }
  /** `joinSessionSuperset` with a partner, `leaveSessionSuperset` without. */
  | { type: 'supersetWorkoutExercise'; sessionId: string; exerciseId: string; partnerId: string | null }
  /**
   * `applyProposal`, workout mode's own Use. `warmupIdPrefix` (the watch's tap
   * id) names any warm-ups a ramp adds `<prefix>-w<i>`, the ids the watch drew
   * them under.
   */
  | { type: 'useWorkoutSuggestion'; sessionId: string; exerciseId: string; warmupIdPrefix?: string };

/**
 * The workouts a drain is judged against: the phone's one in progress, with
 * its sets, and every session already in the log.
 */
export interface QuietTapWorkouts {
  live: {
    id: string;
    taskId: string | null;
    sets: readonly Pick<WorkoutSet, 'id' | 'exerciseId' | 'kind' | 'completedAt' | 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>[];
  } | null;
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
    if (SESSION_KINDS.has(kind as QuietTapKind)) {
      // Every workout tap names the phone's session it was made on: a stale
      // watch must never log onto whatever workout happens to be going now.
      // The rest and finish taps' own id is the session, so they may leave it out.
      const ownId = kind === 'restAdd' || kind === 'restSkip' || kind === 'finish' || kind === 'measuring' || kind === 'healthWorkout';
      const sessionId = idOf(fields.sessionId) ?? (ownId ? id : null);
      if (!sessionId) continue;
      tap.sessionId = sessionId;
      const restId = idOf(fields.restId);
      if (restId && (kind === 'restAdd' || kind === 'restSkip')) tap.restId = restId;
      if (kind === 'set') {
        tap.values = tickValuesFromWatch(fields, fields.unit);
        tap.unit = readUnit(fields.unit);
        const exerciseId = idOf(fields.exerciseId);
        if (exerciseId) tap.exerciseId = exerciseId;
      }
      if (kind === 'finish') {
        tap.unit = readUnit(fields.unit);
        const doneSets = parseDoneSets(fields.sets, fields.unit);
        if (doneSets.length > 0) tap.doneSets = doneSets;
        const notes = parseNotes(fields.notes);
        if (notes.length > 0) tap.notes = notes;
      }
      if (kind === 'setNote') {
        const note = typeof fields.note === 'string' ? fields.note.trim().slice(0, WATCH_NOTE_MAX) : '';
        if (note === '') continue;
        tap.note = note;
      }
      if (kind === 'addSet') {
        const exerciseId = idOf(fields.exerciseId);
        if (!exerciseId) continue;
        tap.exerciseId = exerciseId;
      }
      if (kind === 'addExercise') {
        tap.setIds = Array.isArray(fields.setIds) ? fields.setIds.filter((x): x is string => idOf(x) !== null) : [];
      }
      if (kind === 'superset') {
        // No partner is "leave"; a partner that isn't an id is a tap to drop.
        if (fields.exerciseId !== undefined && fields.exerciseId !== null && idOf(fields.exerciseId) === null) continue;
        const partner = idOf(fields.exerciseId);
        if (partner) tap.exerciseId = partner;
      }
      if (kind === 'moveExercise') {
        if (fields.direction !== 'up' && fields.direction !== 'down') continue;
        tap.direction = fields.direction;
      }
      if (kind === 'measuring') {
        // Absent reads as started: an older watch that sends the kind at all
        // only sends it when it starts.
        tap.on = fields.on !== false;
      }
      // `workoutId` from the watch; `healthWorkoutId` from a tap the app put
      // back on the queue itself for a drain in front (widgetSync.ts).
      if (kind === 'healthWorkout') {
        tap.healthWorkoutId = idOf(fields.workoutId) ?? idOf(fields.healthWorkoutId);
        // `start`/`end` from the watch, the long names from a requeued tap.
        const start = isoOf(fields.start) ?? isoOf(fields.workoutStart);
        const end = isoOf(fields.end) ?? isoOf(fields.workoutEnd);
        if (start && end) {
          tap.workoutStart = start;
          tap.workoutEnd = end;
        }
      }
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
  /**
   * What an exercise's weights are multiplied by to be shown (2 for a two-dumbbell
   * exercise logged as a pair total, `dumbbellLoad.ts`). The watch is sent shown
   * weights and sends them back, and `tickValuesFromWatch` can't know the exercise,
   * so the weights it read are put back to one dumbbell's here, where it is known.
   */
  weightScaleFor: (exerciseId: string) => number = () => 1,
): QuietTapAction[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const working = new Map<string, Task>();
  const settled = new Set<string>();
  const checked = new Set<string>();
  const actions: QuietTapAction[] = [];

  // The workout as this drain leaves it, so a set ticked twice in one queue
  // is ticked once, a set or exercise added earlier in it can be ticked or
  // moved later in it, and nothing applies to a workout finished earlier in it.
  const finished = new Set<string>();
  const written = new Set<string>();
  const live = workouts?.live ?? null;
  const workingSets = new Map<string, WorkingSet>((live?.sets ?? []).map(s => [s.id, {
    exerciseId: s.exerciseId,
    kind: s.kind,
    done: s.completedAt !== null,
    values: { weightKg: s.weightKg, reps: s.reps, durationSeconds: s.durationSeconds, distanceM: s.distanceM },
  }]));
  const inSession = (exerciseId: string) => [...workingSets.values()].some(s => s.exerciseId === exerciseId);
  const isLive = (sessionId: string | undefined) => !!live && live.id === sessionId && !finished.has(sessionId);
  // Use's warm-ups, by the prefix of the ids the watch drew them under.
  const warmupPrefixes = new Map<string, string>();
  /**
   * The set a tap names, as this drain has it. A set the watch added whose
   * own `addSet` hasn't arrived (a message can overtake a transfer, docs in
   * workouts.md) is added here, under the watch's id, when its exercise is in
   * the workout; a warm-up a Use earlier in the drain adds is known by its
   * id. Anything else is a set the workout doesn't have: null.
   */
  const ensureSet = (sessionId: string, setId: string, exerciseId: string | undefined): WorkingSet | null => {
    const found = workingSets.get(setId);
    if (found) return found;
    const ramp = /^(.*)-w\d+$/.exec(setId);
    const rampExercise = ramp ? warmupPrefixes.get(ramp[1]) : undefined;
    if (rampExercise) {
      const warmup: WorkingSet = { exerciseId: rampExercise, kind: 'warmup', done: false, values: null };
      workingSets.set(setId, warmup);
      return warmup;
    }
    if (!exerciseId || !inSession(exerciseId)) return null;
    const added: WorkingSet = { exerciseId, kind: 'working', done: false, values: null };
    workingSets.set(setId, added);
    actions.push({ type: 'addWorkoutSet', sessionId, exerciseId, setId });
    return added;
  };
  const tick = (sessionId: string, setId: string, set: WorkingSet, at: string, sent: WatchTickValues, unit: WeightUnit) => {
    set.done = true;
    actions.push({ type: 'tickWorkoutSet', sessionId, setId, at, values: changedWatchValues(perDumbbell(sent, weightScaleFor(set.exerciseId)), set.values, unit) });
  };
  const askFor = (taskId: string | null): Task | null => {
    const task = taskId ? byId.get(taskId) ?? null : null;
    return task && workoutTaskEffect(task) === 'ask' ? task : null;
  };

  for (const tap of inTimeOrder(taps)) {
    // ==== the Apple Watch's workout ====
    // Ahead of the task branch below, which would read a set's or a session's
    // id as a task's and find nothing. A tap about a workout that is no longer
    // the one in progress (finished, discarded, another one started since the
    // watch last heard) does nothing: tickSet's own guards say the same.
    if (tap.kind === 'set') {
      if (!isLive(tap.sessionId)) continue;
      const set = ensureSet(tap.sessionId!, tap.id, tap.exerciseId);
      if (!set || set.done) continue;
      tick(tap.sessionId!, tap.id, set, tap.at, tap.values ?? {}, tap.unit ?? 'kg');
      continue;
    }
    if (tap.kind === 'setNote') {
      // On a set done or still to do, as workout mode lets a note go on either.
      if (!isLive(tap.sessionId) || !workingSets.has(tap.id) || !tap.note) continue;
      actions.push({ type: 'noteWorkoutSet', sessionId: tap.sessionId!, setId: tap.id, note: tap.note });
      continue;
    }
    if (tap.kind === 'addSet') {
      // To an exercise in the workout, under an id nothing in it has yet: a
      // repeat of the same addition adds nothing.
      if (!isLive(tap.sessionId) || !tap.exerciseId || !inSession(tap.exerciseId) || workingSets.has(tap.id)) continue;
      workingSets.set(tap.id, { exerciseId: tap.exerciseId, kind: 'working', done: false, values: null });
      actions.push({ type: 'addWorkoutSet', sessionId: tap.sessionId!, exerciseId: tap.exerciseId, setId: tap.id });
      continue;
    }
    if (tap.kind === 'addExercise') {
      if (!isLive(tap.sessionId) || inSession(tap.id)) continue;
      const setIds = (tap.setIds ?? []).filter(id => !workingSets.has(id));
      for (const id of setIds) workingSets.set(id, { exerciseId: tap.id, kind: 'working', done: false, values: null });
      // An exercise added with no sets named still lays its sets out; it is
      // in the workout from here on either way.
      // (A stand-in row, a warm-up so it never counts as a working set logged.)
      if (setIds.length === 0) workingSets.set(`\u0000${tap.id}`, { exerciseId: tap.id, kind: 'warmup', done: true, values: null });
      actions.push({ type: 'addWorkoutExercise', sessionId: tap.sessionId!, exerciseId: tap.id, setIds });
      continue;
    }
    if (tap.kind === 'moveExercise') {
      if (!isLive(tap.sessionId) || !tap.direction || !inSession(tap.id)) continue;
      actions.push({ type: 'moveWorkoutExercise', sessionId: tap.sessionId!, exerciseId: tap.id, direction: tap.direction });
      continue;
    }
    if (tap.kind === 'superset') {
      // Both exercises in the workout in progress. Whether they can be paired
      // (already together, or alone) is the store's answer, as a move past the end is.
      if (!isLive(tap.sessionId) || !inSession(tap.id) || (tap.exerciseId && !inSession(tap.exerciseId))) continue;
      actions.push({ type: 'supersetWorkoutExercise', sessionId: tap.sessionId!, exerciseId: tap.id, partnerId: tap.exerciseId ?? null });
      continue;
    }
    if (tap.kind === 'useSuggestion') {
      // Workout mode's own rule for when the card offers Use: not once a
      // working set of the exercise has been logged.
      const logged = [...workingSets.values()].some(s => s.exerciseId === tap.id && s.done && (s.kind === 'working' || s.kind === 'amrap'));
      if (!isLive(tap.sessionId) || !inSession(tap.id) || logged) continue;
      if (tap.watchTapId) warmupPrefixes.set(tap.watchTapId, tap.id);
      actions.push({
        type: 'useWorkoutSuggestion', sessionId: tap.sessionId!, exerciseId: tap.id,
        ...(tap.watchTapId ? { warmupIdPrefix: tap.watchTapId } : {}),
      });
      continue;
    }
    if (tap.kind === 'restAdd' || tap.kind === 'restSkip') {
      if (!isLive(tap.sessionId)) continue;
      actions.push({ type: tap.kind === 'restAdd' ? 'nudgeRest' : 'skipRest', sessionId: tap.sessionId!, restId: tap.restId ?? null });
      continue;
    }
    if (tap.kind === 'finish') {
      if (!isLive(tap.sessionId)) continue;
      // The sets done on the watch, and the notes written there, that the
      // phone may not have heard of: Finish carries them, so one that
      // overtakes their own taps still records them. Each applies only if it
      // hasn't already (a set already done is left, as `tickSet` leaves it).
      const sessionId = tap.sessionId!;
      for (const done of [...(tap.doneSets ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
        let set = ensureSet(sessionId, done.id, done.exerciseId);
        if (!set && !inSession(done.exerciseId)) {
          // An exercise added on the watch whose own addExercise hasn't
          // arrived: added with this set's id, its other sets after it.
          set = { exerciseId: done.exerciseId, kind: 'working', done: false, values: null };
          workingSets.set(done.id, set);
          actions.push({ type: 'addWorkoutExercise', sessionId, exerciseId: done.exerciseId, setIds: [done.id] });
        }
        if (!set || set.done) continue;
        tick(sessionId, done.id, set, done.at, done.values, tap.unit ?? 'kg');
      }
      for (const { setId, note } of tap.notes ?? []) {
        if (workingSets.has(setId)) actions.push({ type: 'noteWorkoutSet', sessionId, setId, note });
      }
      finished.add(sessionId);
      actions.push({ type: 'finishWorkout', sessionId: tap.sessionId!, at: tap.at });
      // Finishing completes the task the way its checkbox would; one that asks
      // a question is asked by the app, as a widget tap on it is.
      const ask = askFor(live!.taskId);
      if (ask) actions.push({ type: 'handToApp', id: ask.id, at: tap.at, fromWorkout: true });
      continue;
    }
    // ==== the watch's HealthKit session ====
    // Not limited to the workout in progress: the watch saves its workout as
    // the phone's finishes, and can be heard from long after. The store reads
    // the row again and decides (`markWatchMeasuring`, `recordWatchHealthWorkout`).
    if (tap.kind === 'measuring') {
      actions.push({ type: 'watchMeasuring', sessionId: tap.sessionId!, on: tap.on !== false });
      continue;
    }
    if (tap.kind === 'healthWorkout') {
      actions.push({
        type: 'watchHealthWorkout', sessionId: tap.sessionId!, workoutId: tap.healthWorkoutId ?? null,
        span: tap.workoutStart && tap.workoutEnd ? { start: tap.workoutStart, end: tap.workoutEnd } : null,
      });
      continue;
    }
    if (tap.kind === 'healthRetracted') {
      actions.push({ type: 'watchHealthRetracted', workoutId: tap.id });
      continue;
    }
    if (tap.kind === 'watchSession') {
      const workout = tap.workout;
      if (!workout || written.has(workout.id) || workouts?.sessionIds.has(workout.id)) continue;
      written.add(workout.id);
      actions.push({
        type: 'addWatchSession',
        workout: {
          ...workout,
          sets: workout.sets.map(s => (s.weightKg === null ? s : { ...s, weightKg: storedKgFromShown(s.weightKg, weightScaleFor(s.exerciseId)) })),
        },
      });
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

/**
 * What of a tick's numbers to write: the ones that change the set. The watch
 * sends only the numbers the person turned the Crown on, and this is the
 * phone's own guard on top of that: a weight that reads the same in the unit
 * shown as the set's own is dropped (a weight sent back as 132.3 lb would
 * otherwise turn 60 kg into 60.01 kg, and could read as a new record), and so
 * is a 0 sent for a number the set doesn't have (an empty box is not a 0). A
 * set this drain added has no numbers to compare yet, so everything sent goes.
 */
export function changedWatchValues(
  sent: WatchTickValues,
  current: WorkingSetValues | null,
  unit: WeightUnit,
): WatchTickValues {
  if (!current) return { ...sent };
  const out: WatchTickValues = {};
  if (sent.weightKg !== undefined) {
    const same = current.weightKg !== null && weightToDisplay(current.weightKg, unit) === weightToDisplay(sent.weightKg, unit);
    if (!same && !(current.weightKg === null && sent.weightKg === 0)) out.weightKg = sent.weightKg;
  }
  if (sent.reps !== undefined && sent.reps !== current.reps && !(current.reps === null && sent.reps === 0)) out.reps = sent.reps;
  if (sent.durationSeconds !== undefined && sent.durationSeconds !== current.durationSeconds
    && !(current.durationSeconds === null && sent.durationSeconds === 0)) out.durationSeconds = sent.durationSeconds;
  if (sent.distanceM !== undefined && sent.distanceM !== current.distanceM
    && !(current.distanceM === null && sent.distanceM === 0)) out.distanceM = sent.distanceM;
  return out;
}

/** A tick's numbers with its weight put back to one dumbbell's (`weightScaleFor`). */
function perDumbbell(sent: WatchTickValues, scale: number): WatchTickValues {
  return sent.weightKg === undefined || scale === 1 ? sent : { ...sent, weightKg: storedKgFromShown(sent.weightKg, scale) };
}

/** A set's numbers as the drain has them, to compare a tick's against. */
export interface WorkingSetValues {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
}

/** A set of the live workout as a drain has it. `values` is null for one added in this drain. */
interface WorkingSet {
  exerciseId: string;
  kind: WorkoutSetKind;
  done: boolean;
  values: WorkingSetValues | null;
}

/**
 * The taps with each session's workout taps put in the order they were made
 * (by `at`, ties kept in queue order), each in a slot one of them held, so
 * the taps around them keep their places. Two channels carry the watch's
 * taps, ordered within each but not across them, so the queue can hold a
 * workout's taps out of order.
 */
export function inTimeOrder(taps: readonly QuietTap[]): QuietTap[] {
  const out = [...taps];
  const slots = new Map<string, number[]>();
  taps.forEach((tap, i) => {
    if (!SESSION_KINDS.has(tap.kind) || !tap.sessionId) return;
    if (!slots.has(tap.sessionId)) slots.set(tap.sessionId, []);
    slots.get(tap.sessionId)!.push(i);
  });
  for (const indices of slots.values()) {
    const ordered = indices
      .map(i => taps[i])
      .map((tap, k) => ({ tap, k, ms: Date.parse(tap.at) }))
      .sort((a, b) => a.ms - b.ms || a.k - b.k)
      .map(x => x.tap);
    indices.forEach((slot, k) => { out[slot] = ordered[k]; });
  }
  return out;
}

/** A Finish's carried sets, as the watch sent them (in `unit`). Malformed ones are dropped. */
function parseDoneSets(raw: unknown, unit: unknown): WatchDoneSet[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchDoneSet[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const s = entry as Record<string, unknown>;
    const id = idOf(s.id);
    const exerciseId = idOf(s.exerciseId);
    const at = isoOf(s.at);
    if (!id || !exerciseId || !at) continue;
    out.push({ id, exerciseId, at, values: tickValuesFromWatch(s, unit) });
  }
  return out;
}

/** A Finish's carried notes. */
function parseNotes(raw: unknown): { setId: string; note: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { setId: string; note: string }[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const s = entry as Record<string, unknown>;
    const setId = idOf(s.id);
    const note = typeof s.note === 'string' ? s.note.trim().slice(0, WATCH_NOTE_MAX) : '';
    if (setId && note) out.push({ setId, note });
  }
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
      note: typeof s.note === 'string' && s.note.trim() !== '' ? s.note.trim().slice(0, WATCH_NOTE_MAX) : null,
      supersetKey: idOf(s.supersetKey),
    });
  }
  if (sets.length === 0) return null;
  const workout: WatchSessionInput = {
    id,
    routineId: idOf(r.routineId),
    programId: idOf(r.programId),
    taskId: idOf(r.taskId),
    title: typeof r.title === 'string' ? r.title : '',
    startedAt,
    endedAt,
    sets,
  };
  // Saved to Health by the watch itself, with what it measured (phase 9). An
  // object with no id is a save made locked, which still means the phone
  // writes nothing of its own.
  if (typeof r.health === 'object' && r.health !== null && !Array.isArray(r.health)) {
    workout.health = { workoutId: idOf((r.health as Record<string, unknown>).workoutId) };
  }
  return workout;
}
