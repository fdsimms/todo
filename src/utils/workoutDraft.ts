// A routine, or a workout somebody did, described in words and read into the
// shapes the app already has. The model's reply is a `WorkoutDraft` (names, not
// ids), and this file is everything that happens to it before a person sees it:
// reading it defensively, turning a name into the library's exercise, and
// building either a `WorkoutRoutineItem` list for the routine editor or an
// `ImportedSession` for the same review sheet a Strong/Hevy file goes through.
//
// Two rules hold it in place, and neither is the model's to keep:
//
//   - **Nothing is invented.** A weight, rep count, rest or progression that
//     the description didn't state stays empty, so the editor shows a blank
//     rather than a number somebody might save believing it was theirs.
//   - **Nothing stated is dropped quietly.** Text that wasn't a lift goes to the
//     notes, a name that isn't plainly one of the person's exercises waits for a
//     choice (`matchExerciseName`, the import's own matcher), and a set cut for
//     length says so in the notes.
//
// The model call is `draftWorkoutFromText` in `src/services/aiSuggestions.ts`;
// docs/arch/workouts.md ("Describing a workout") has the reasoning.
import type { ExerciseKind, ProgressionScheme, RoutineSetTarget, WorkoutRoutineItem, WorkoutSetKind } from '../types';
import type { ExerciseInput } from '../store/useWorkoutStore';
import { MAX_ROUTINE_SETS, MAX_WARMUP_SETS, defaultTargets } from './workoutRoutine';
import { REST_SECONDS_MAX, cleanWorkoutName, exerciseNameKey } from './workoutData';
import { MAX_WEIGHT_KG, unitToKg, type WeightUnit } from './weightLog';
import {
  NEW_EXERCISE_PREFIX,
  guessEquipment,
  inferExerciseKind,
  type ImportedSession,
  type ImportedSet,
  type NameResolution,
} from './workoutCsv';
import { generateId } from './id';

/** What a description is read as. A routine is a plan; a log is a workout that already happened. */
export type DescribeMode = 'routine' | 'log';

/** The longest description sent. The text is the person's own, so this is a typo and cost check, not a style one. */
export const DESCRIBE_MAX_LENGTH = 2000;

export const MAX_DRAFT_EXERCISES = 30;

/** One set as the description gave it. A routine reads `reps`..`repsMax` as a range; a log reads `reps`. */
export interface DraftSet {
  kind: WorkoutSetKind;
  reps: number | null;
  repsMax: number | null;
  weight: number | null;
  /** The unit the description used, or null when it named none (the person's own unit is then assumed). */
  weightUnit: WeightUnit | null;
  durationSeconds: number | null;
  distanceM: number | null;
  rpe: number | null;
}

export interface DraftExercise {
  /** The name as the model wrote it: the library's when one clearly fit, else the person's own words. */
  name: string;
  sets: DraftSet[];
  restSeconds: number | null;
  supersetWithPrevious: boolean;
  progression: ProgressionScheme | null;
  warmupRamp: boolean;
}

export interface WorkoutDraft {
  title: string;
  /** Whatever in the description wasn't a lift: "finish with abs", "felt tired". */
  notes: string;
  /** `YYYY-MM-DD`, for a log. Null reads as today. */
  date: string | null;
  /** `HH:MM`, for a log. */
  time: string | null;
  durationMinutes: number | null;
  exercises: DraftExercise[];
}

// ==== reading the reply ====

const SET_KINDS: readonly WorkoutSetKind[] = ['warmup', 'working', 'drop', 'amrap'];
const SCHEMES: readonly ProgressionScheme[] = ['double', 'linear', 'percent', 'rpe'];

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A whole number in range, else null. An out-of-range count is a misreading, not something to clamp into a believable one. */
function whole(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

function positive(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null;
}

function readSet(raw: unknown): DraftSet | null {
  const r = record(raw);
  if (!r) return null;
  const kind = SET_KINDS.includes(r.kind as WorkoutSetKind) ? (r.kind as WorkoutSetKind) : 'working';
  const reps = whole(r.reps, 1, 1000);
  const repsMax = whole(r.repsMax, 1, 1000);
  return {
    kind,
    reps: reps ?? repsMax,
    repsMax: reps !== null && repsMax !== null && repsMax !== reps ? repsMax : null,
    weight: positive(r.weight, 5000),
    weightUnit: r.weightUnit === 'kg' || r.weightUnit === 'lb' ? r.weightUnit : null,
    durationSeconds: whole(r.durationSeconds, 1, 86_400),
    distanceM: positive(r.distanceM, 1_000_000),
    rpe: typeof r.rpe === 'number' && r.rpe >= 1 && r.rpe <= 10 ? r.rpe : null,
  };
}

/**
 * The model's tool input as a draft. Throws `No answer returned` when no
 * exercise survives, which `describeAIError` already words ("Nothing usable
 * came back"). Set counts are capped at what the editor holds, and a set cut
 * for it is said in the notes rather than lost.
 */
export function readWorkoutDraft(input: unknown): WorkoutDraft {
  const r = record(input);
  const rawExercises = r && Array.isArray(r.exercises) ? r.exercises : [];
  const cut: string[] = [];
  const exercises: DraftExercise[] = [];
  for (const raw of rawExercises) {
    const e = record(raw);
    if (!e) continue;
    const name = cleanWorkoutName(text(e.name, 200));
    if (!name) continue;
    const all = (Array.isArray(e.sets) ? e.sets : []).map(readSet).filter((s): s is DraftSet => s !== null);
    const warmups = all.filter(s => s.kind === 'warmup');
    const work = all.filter(s => s.kind !== 'warmup');
    if (warmups.length > MAX_WARMUP_SETS || work.length > MAX_ROUTINE_SETS) cut.push(name);
    exercises.push({
      name,
      sets: [...warmups.slice(0, MAX_WARMUP_SETS), ...work.slice(0, MAX_ROUTINE_SETS)],
      restSeconds: whole(e.restSeconds, 0, REST_SECONDS_MAX),
      supersetWithPrevious: e.supersetWithPrevious === true && exercises.length > 0,
      progression: SCHEMES.includes(e.progression as ProgressionScheme) ? (e.progression as ProgressionScheme) : null,
      warmupRamp: e.warmupRamp === true,
    });
    if (exercises.length >= MAX_DRAFT_EXERCISES) break;
  }
  if (exercises.length === 0) throw new Error('No answer returned');

  const notes = [
    text(r?.notes, 2000),
    ...cut.map(n => `Only the first sets of ${n} were kept.`),
  ].filter(Boolean).join('\n');
  const date = typeof r?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date.trim()) ? r.date.trim() : null;
  const time = typeof r?.time === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(r.time.trim()) ? r.time.trim() : null;
  return {
    title: cleanWorkoutName(text(r?.title, 200)),
    notes,
    date,
    time,
    durationMinutes: whole(r?.durationMinutes, 1, 1440),
    exercises,
  };
}

// ==== names ====

/** The distinct exercise names a draft uses, first spelling kept, with how many sets name each. */
export function draftNames(draft: WorkoutDraft): { key: string; name: string; sets: number }[] {
  const seen = new Map<string, { key: string; name: string; sets: number }>();
  for (const e of draft.exercises) {
    const key = exerciseNameKey(e.name);
    const held = seen.get(key);
    if (held) held.sets += e.sets.length;
    else seen.set(key, { key, name: e.name, sets: e.sets.length });
  }
  return [...seen.values()];
}

const kgOf = (s: DraftSet, fallback: WeightUnit): number | null => {
  if (s.weight === null) return null;
  const kg = Math.round(unitToKg(s.weight, s.weightUnit ?? fallback) * 1000) / 1000;
  return kg > 0 && kg <= MAX_WEIGHT_KG ? kg : null;
};

/** The library entry a name the person has no exercise for becomes: its kind read off the sets, its equipment off the words. */
export function newExerciseFor(name: string, sets: readonly DraftSet[], fallback: WeightUnit): ExerciseInput {
  return {
    name: cleanWorkoutName(name),
    kind: inferExerciseKind(sets.map(s => ({
      weightKg: kgOf(s, fallback), reps: s.reps, durationSeconds: s.durationSeconds, distanceM: s.distanceM,
    }))),
    equipment: guessEquipment(name),
    primaryMuscles: [],
  };
}

// ==== a routine ====

/** What the routine editor opens on. `new:` ids in `items` name an exercise that is created when the routine is saved, never before. */
export interface RoutineDraft {
  name: string;
  notes: string;
  items: WorkoutRoutineItem[];
  /** Keyed by the name key an item's `new:` id carries. */
  newExercises: Record<string, ExerciseInput>;
}

const REPS_KINDS: readonly ExerciseKind[] = ['weight_reps', 'bodyweight_reps', 'assisted_reps'];
const WEIGHT_KINDS: readonly ExerciseKind[] = ['weight_reps', 'assisted_reps', 'weight_distance'];
const DISTANCE_KINDS: readonly ExerciseKind[] = ['distance', 'weight_distance'];

/**
 * An exercise's planned sets. Only the values this kind of exercise records are
 * kept (a weight on a plank has nowhere to go), warm-ups come first, and a
 * description with no sets for it gets the same three the editor gives an
 * exercise added by hand, rather than none.
 */
function targetsFor(e: DraftExercise, kind: ExerciseKind, fallback: WeightUnit): RoutineSetTarget[] {
  if (e.sets.length === 0) return defaultTargets(kind);
  const targets = e.sets.map((s): RoutineSetTarget => {
    const reps = REPS_KINDS.includes(kind);
    const repsMin = reps ? s.reps : null;
    const t: RoutineSetTarget = {
      kind: s.kind,
      repsMin,
      repsMax: reps ? (s.kind === 'amrap' ? repsMin : s.repsMax ?? s.reps) : null,
    };
    if (WEIGHT_KINDS.includes(kind)) t.weightKg = kgOf(s, fallback);
    if (s.rpe !== null) t.rpe = s.rpe;
    if (kind === 'duration') t.durationSeconds = s.durationSeconds;
    if (DISTANCE_KINDS.includes(kind)) t.distanceM = s.distanceM;
    return t;
  });
  if (!targets.some(t => t.kind !== 'warmup')) targets.push({ kind: 'working', repsMin: null, repsMax: null });
  return [...targets.filter(t => t.kind === 'warmup'), ...targets.filter(t => t.kind !== 'warmup')];
}

/**
 * The routine a draft describes, with each exercise name settled by
 * `resolutions` (keyed by name key, as the import's are). A name with no
 * resolution, or `skip`, is left out. `kindOf` reads what a library exercise
 * records.
 */
export function routineFromDraft(
  draft: WorkoutDraft,
  resolutions: Readonly<Record<string, NameResolution | undefined>>,
  kindOf: (exerciseId: string) => ExerciseKind,
  fallback: WeightUnit,
): RoutineDraft {
  const items: WorkoutRoutineItem[] = [];
  const newExercises: Record<string, ExerciseInput> = {};
  let supersetKey: string | null = null;
  let previousKept = false;

  for (const e of draft.exercises) {
    const key = exerciseNameKey(e.name);
    const resolution = resolutions[key];
    if (!resolution || resolution.kind === 'skip') { previousKept = false; supersetKey = null; continue; }
    let exerciseId: string;
    let kind: ExerciseKind;
    if (resolution.kind === 'exercise') {
      exerciseId = resolution.exerciseId;
      kind = kindOf(exerciseId);
    } else {
      newExercises[key] ??= newExerciseFor(e.name, draft.exercises
        .filter(x => exerciseNameKey(x.name) === key).flatMap(x => x.sets), fallback);
      exerciseId = `${NEW_EXERCISE_PREFIX}${key}`;
      kind = newExercises[key].kind;
    }

    // A superset joins the item before it, so it needs that one to have been kept.
    let key2: string | null = null;
    if (e.supersetWithPrevious && previousKept && items.length > 0) {
      supersetKey ??= generateId();
      const before = items[items.length - 1];
      if (!before.supersetKey) items[items.length - 1] = { ...before, supersetKey };
      key2 = supersetKey;
    } else {
      supersetKey = null;
    }

    const targets = targetsFor(e, kind, fallback);
    const ramp = e.warmupRamp && kind === 'weight_reps' && !targets.some(t => t.kind === 'warmup');
    items.push({
      exerciseId,
      supersetKey: key2,
      restSeconds: e.restSeconds,
      progression: e.progression ? { scheme: e.progression, incrementKg: null } : null,
      targets,
      ...(ramp ? { warmupRamp: true } : {}),
    });
    previousKept = true;
  }
  return { name: draft.title, notes: draft.notes, items, newExercises };
}

// ==== a workout that happened ====

/** A local calendar day as `YYYY-MM-DD`. Not `dateUtils.dayKeyOf`, which would pull the settings store into a module that is otherwise pure. */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** How far ahead of now a start may be and still be a workout that happened. The MCP server's `log_workout` allows the same. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

/**
 * When a described workout started. A day with no time is noon, which is still
 * ahead of "this morning" when the day is today, so it is held to now then.
 * `todayKey` is the logical day, which is what the model was told "today" was.
 */
export function startOfDescribed(date: string | null, time: string | null, todayKey: string, now: Date): Date {
  const day = date ?? todayKey;
  const [y, m, d] = day.split('-').map(Number);
  const clock = time ? time.split(':').map(Number) : null;
  const at = new Date(y, m - 1, d, clock ? clock[0] : 12, clock ? clock[1] : 0);
  return !clock && at.getTime() > now.getTime() && localDay(at) === localDay(now) ? new Date(now.getTime()) : at;
}

export type SessionFromDraft =
  | { ok: true; session: ImportedSession; skippedSets: number }
  | { ok: false; error: string };

/**
 * The workout a draft describes, as the import's own `ImportedSession`, so it
 * goes through the same review (names matched or created, duplicates left
 * out) as a file does. A set with no reps, weight, time or distance records
 * nothing and is left out, and counted.
 */
export function sessionFromDraft(draft: WorkoutDraft, fallback: WeightUnit, todayKey: string, now: Date): SessionFromDraft {
  const start = startOfDescribed(draft.date, draft.time, todayKey, now);
  if (start.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    return { ok: false, error: 'That date is in the future. A logged workout is one that already happened. Describe it as a routine to plan it.' };
  }
  const sets: ImportedSet[] = [];
  let skipped = 0;
  // Both halves of a pair carry the key, the first as well as the one that said "with the one before".
  const keys: (string | null)[] = draft.exercises.map(() => null);
  draft.exercises.forEach((e, i) => {
    if (e.supersetWithPrevious && i > 0) {
      keys[i - 1] ??= generateId();
      keys[i] = keys[i - 1];
    }
  });
  draft.exercises.forEach((e, i) => {
    for (const s of e.sets) {
      const weightKg = kgOf(s, fallback);
      if (s.reps === null && weightKg === null && s.durationSeconds === null && s.distanceM === null) { skipped++; continue; }
      sets.push({
        exerciseName: e.name,
        kind: s.kind,
        weightKg,
        reps: s.reps,
        durationSeconds: s.durationSeconds,
        distanceM: s.distanceM,
        rpe: s.rpe,
        note: null,
        supersetKey: keys[i],
      });
    }
  });
  if (sets.length === 0) {
    return { ok: false, error: 'None of that had reps, weight, time or distance to log. Add the numbers, or describe it as a routine.' };
  }
  const end = draft.durationMinutes ? new Date(start.getTime() + draft.durationMinutes * 60_000) : start;
  return {
    ok: true,
    skippedSets: skipped,
    session: {
      id: generateId(),
      source: 'text',
      title: draft.title || 'Workout',
      startedAt: start.toISOString(),
      startPrecisionMs: 60_000,
      endedAt: end.toISOString(),
      notes: draft.notes,
      sets,
    },
  };
}
