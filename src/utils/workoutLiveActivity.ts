import type { Exercise, RestTimer, WorkoutSession, WorkoutSet } from '../types';
import type { WeightUnit } from './weightLog';
import { catalogExercise, exerciseName } from './exerciseCatalog';
import { formatSetLine, nextSet, sessionExercises, setBadge, setLabels, setName } from './workoutSession';
import { REST_NUDGE_FORWARD_SECONDS, isStepTimerRunning, stepTimerRemaining } from './stepTimers';
import { workoutLinkUrl } from './workoutLink';

/**
 * The workout's Live Activity (Lock Screen and Dynamic Island): the set you're
 * on, and the rest between sets. See docs/arch/workouts.md ("Phase 6, as
 * built") and targets/todo-widget/WorkoutLiveActivity.swift.
 *
 * **The first activity in the app that is updated in place.** Every other kind
 * is ended and started again on any change, because nothing about a running
 * timer or a focus step changes under it. A workout changes on every set (and
 * the subtitle on every weight stepped), and ending and starting an activity
 * that often flickers and moves the Lock Screen about, so the native side keeps
 * one activity per session and hands it each new payload as a `ContentState`
 * (`Activity.update`). Only a different session, or none, ends it.
 *
 * **The payload is a pure function of what is stored, never of the clock**,
 * the rule `focusLiveActivity.ts` keeps for the same reason: it is compared to
 * decide whether anything changed, and a payload that read `Date.now()` would
 * differ on every write. A rest's countdown is its start and its end, both
 * fixed when it starts or is nudged, and SwiftUI ticks them on its own.
 *
 * Three states, two of them from here:
 *
 * - `set`: the exercise, "Set 3 of 4 · 82.5 kg × 8", the time since the
 *   workout started, and "Done set".
 * - `rest`: "Rest", what is next, the countdown, "+30 s" and "Skip rest".
 * - **Rest is over** is not sent from here. The rest's end is the activity's
 *   stale date, so the Lock Screen turns to it on its own when the countdown
 *   reaches zero, counting up in orange with "Done set" for the set that is
 *   next. A rest that runs out still moves nothing on (the arch doc's "a step
 *   that runs out waits"); it only changes what the button offers.
 *
 * Every word is written here so it is tested here; the Swift view only lays
 * the fields out.
 */

const TITLE_MAX = 60;
const SUBTITLE_MAX = 90;

export type WorkoutRunPhase = 'set' | 'rest';

export interface WorkoutRun {
  /**
   * The payload below, JSON-encoded: what the native side compares to decide
   * whether to update. The whole payload rather than a hand-listed subset, for
   * the reason `FocusRun.key` gives.
   */
  key: string;
  /** Static for the activity's life: a different session is a different activity. */
  sessionId: string;
  startedAtMs: number;
  phase: WorkoutRunPhase;
  title: string;
  subtitle: string;
  /** The compact Dynamic Island's trailing text during a set ("3 / 4"). Empty shows a clock instead. */
  compact: string;
  /** The rest's start and end, while resting. The end is the activity's stale date. */
  restStartedAtMs: number | null;
  restEndsAtMs: number | null;
  /** The right-hand button, drawn in the brand gold. Empty label: no button. */
  primaryLabel: string;
  primaryUrl: string;
  /** An SF Symbol before the label, or empty for none. */
  primarySymbol: string;
  /** The quieter button beside it. Empty label: no button. */
  secondaryLabel: string;
  secondaryUrl: string;
  /** What the rest's own state becomes once it has run out (drawn natively at the stale date). */
  overTitle: string;
  overLabel: string;
  overUrl: string;
  overSymbol: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function lowerFirst(text: string): string {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** The set the Lock Screen is about, in its own words. */
interface NextSetWords {
  setId: string;
  exerciseName: string;
  /** "Set 3 of 4", "Warm-up", "Drop set". */
  which: string;
  /** "3 / 4", "Warm-up", "Drop set". */
  compact: string;
  /** "82.5 kg × 8", or null when the set records nothing yet. */
  line: string | null;
}

function nextSetWords(sets: readonly WorkoutSet[], exercises: readonly Exercise[], unit: WeightUnit): NextSetWords | null {
  const next = nextSet(sets);
  if (!next) return null;
  const exercise = sessionExercises(sets).find(e => e.exerciseId === next.exerciseId);
  const label = (exercise ? setLabels(exercise.sets).get(next.id) : undefined) ?? '';
  // "of 4" counts the working sets only, the ones the SET column numbers.
  const working = exercise ? exercise.sets.filter(s => setBadge(s.kind) === null).length : 0;
  const isWorking = setBadge(next.kind) === null;
  const kind = catalogExercise(exercises, next.exerciseId)?.kind ?? 'weight_reps';
  return {
    setId: next.id,
    exerciseName: exerciseName(exercises, next.exerciseId),
    which: isWorking ? `Set ${label} of ${working}` : setName(next.kind, label),
    compact: isWorking ? `${label} / ${working}` : setName(next.kind, label),
    line: formatSetLine(next, kind, unit, true),
  };
}

/**
 * Pure. The live session's Live Activity payload, or null when none should
 * show: the setting is off, the Workouts area is off, or no session is in
 * progress. `rest` is the session's rest timer if it has one; a rest that
 * belongs to another session, or isn't running, is treated as no rest.
 */
export function buildWorkoutRun(
  input: {
    session: WorkoutSession | null;
    sets: readonly WorkoutSet[];
    exercises: readonly Exercise[];
    unit: WeightUnit;
    rest: RestTimer | null;
  },
  opts: { enabled: boolean; workoutsEnabled: boolean },
): WorkoutRun | null {
  const { session, sets, exercises, unit, rest } = input;
  if (!opts.enabled || !opts.workoutsEnabled || !session || session.endedAt !== null) return null;

  const startedAtMs = Date.parse(session.startedAt);
  const next = nextSetWords(sets, exercises, unit);
  const setDoneUrl = next ? workoutLinkUrl('set-done', session.id, { set: next.setId }) : '';
  const resting = rest !== null && rest.sessionId === session.id && isStepTimerRunning(rest);

  let body: Omit<WorkoutRun, 'key' | 'sessionId' | 'startedAtMs'>;
  if (resting) {
    const restStartedAtMs = Date.parse(rest.startedAt as string);
    // Measured at its own start rather than now, so the end is a fixed
    // instant; clamped like every countdown in the app, since an inverted range
    // crashes the extension.
    const restEndsAtMs = Math.max(restStartedAtMs, restStartedAtMs + stepTimerRemaining(rest, restStartedAtMs) * 1000);
    const skipUrl = workoutLinkUrl('skip-rest', session.id, { rest: rest.id });
    body = {
      phase: 'rest',
      title: 'Rest',
      subtitle: truncate(next ? `Next: ${next.exerciseName}, ${lowerFirst(next.which)}` : 'All sets done', SUBTITLE_MAX),
      compact: '',
      restStartedAtMs,
      restEndsAtMs,
      primaryLabel: 'Skip rest',
      primaryUrl: skipUrl,
      primarySymbol: '',
      secondaryLabel: `+${REST_NUDGE_FORWARD_SECONDS} s`,
      secondaryUrl: workoutLinkUrl('rest-add', session.id, { rest: rest.id }),
      overTitle: 'Rest is over',
      // Once it has run out, the button is for the set that is next, the way
      // the mock has it; with nothing left, it clears the rest, which is what
      // workout mode's own footer offers then.
      overLabel: next ? 'Done set' : 'Dismiss',
      overUrl: next ? setDoneUrl : skipUrl,
      overSymbol: next ? 'checkmark' : '',
    };
  } else {
    body = {
      phase: 'set',
      title: truncate(next ? next.exerciseName : session.title || 'Workout', TITLE_MAX),
      subtitle: truncate(
        next
          ? (next.line ? `${next.which} · ${next.line}` : next.which)
          : sets.length === 0 ? 'No sets yet' : 'All sets done',
        SUBTITLE_MAX,
      ),
      compact: next ? next.compact : '',
      restStartedAtMs: null,
      restEndsAtMs: null,
      primaryLabel: next ? 'Done set' : '',
      primaryUrl: setDoneUrl,
      primarySymbol: next ? 'checkmark' : '',
      secondaryLabel: '',
      secondaryUrl: '',
      overTitle: '',
      overLabel: '',
      overUrl: '',
      overSymbol: '',
    };
  }

  const run = { sessionId: session.id, startedAtMs, ...body };
  return { key: JSON.stringify(run), ...run };
}

/**
 * The session whose rest the workout activity carries, or null when it isn't
 * wanted. The rest's own timer activity (`restRun` in liveActivity.ts) stands
 * down for that session, so a workout is one activity on the Lock Screen
 * rather than two saying the same countdown.
 */
export function workoutActivitySessionId(
  live: Pick<WorkoutSession, 'id' | 'endedAt'> | null,
  opts: { enabled: boolean; workoutsEnabled: boolean },
): string | null {
  if (!opts.enabled || !opts.workoutsEnabled || !live || live.endedAt !== null) return null;
  return live.id;
}
