import { format } from 'date-fns/format';
import { startOfWeek } from 'date-fns/startOfWeek';
import { subDays } from 'date-fns/subDays';
import { addDays } from 'date-fns/addDays';
import type { ExerciseKind, MuscleGroup, WorkoutSession, WorkoutSet } from '../types';
import { logicalDayStart } from './clockTime';

/**
 * What the sets add up to: estimated 1RMs, personal records and volume. Pure
 * and store-free, like `moodInsights.ts`; see docs/arch/workouts.md.
 *
 * **Everything here is derived, never stored.** A PR is not a column or a row:
 * it is the answer to "is this the best set there has been", asked of the sets
 * every time, so editing or deleting a set (or a session) moves the records
 * with it and nothing can disagree with the log. The cost is the walk, which
 * `analyzeExercise` and `analyzeAll` memoize per array of sets (history grows
 * by about 5,000 sets a year) the way `openTasksOf` caches per task array.
 *
 * **Four rules, and none of them should be relaxed to make a screen fuller:**
 *
 * 1. **A warm-up never counts, and neither does a set that wasn't done.** A
 *    planned set has no `completedAt`; a warm-up is not a statement about what
 *    the person can lift. Drop sets and AMRAP sets are working sets and count.
 * 2. **The 1RM is an estimate and says so.** Epley (`weight x (1 + reps / 30)`),
 *    taken only from a set of ten reps or fewer: the formula is built on heavy
 *    sets and drifts upward on long ones, so a set of 25 is not evidence of a
 *    one-rep max. A set of one rep is the weight itself. Every label that shows
 *    it says "estimated".
 * 3. **Nothing is relative to a body weight.** Volume for a bodyweight
 *    exercise is the reps, never reps times anyone's weight, and there is no
 *    standard, ratio or score. This is the weight rule of docs/arch/health-data.md
 *    (nothing derives anything from a body) carried into the workout log.
 * 4. **A first time is not a record.** A PR is announced only where there is
 *    something earlier to beat, so the first session of an exercise sets no
 *    PRs, and a rep count nobody had done before sets no "best set of N".
 *
 * Kinds that aren't weight and reps still have a best set and a volume, each in
 * its own unit: reps for a bodyweight or assisted set, seconds for a hold,
 * metres for a distance. See `metricsFor`.
 */

/** The most reps a set can have and still feed the 1RM estimate. */
export const E1RM_MAX_REPS = 10;

/** The rep counts a "best set of N" is kept for. Above this a PR is a volume question. */
export const REP_RECORD_MAX = 12;

/** How much of a set a muscle gets when it helps (a secondary muscle) rather than leads. */
export const SECONDARY_MUSCLE_WEIGHT = 0.5;

/** How long a record is called new, in days. */
export const NEW_RECORD_DAYS = 14;

/** How far back Stats' recent records reach, in days. */
export const RECENT_RECORD_DAYS = 30;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Local copies of `dayKeyOf` and `dayKeyToDate`: `dateUtils` reads the settings
// store, which drags the database into every module that imports it, and this
// one stays loadable by the MCP server and by a test with no mocks (like
// `moodInsights.ts`, which does the same).
const dayKeyOf = (date: Date) => format(date, 'yyyy-MM-dd');
const dayKeyToDate = (key: string) => new Date(`${key}T00:00:00`);

/** A set that was done and isn't a warm-up: the only kind any record reads. */
export function countsForRecords(set: Pick<WorkoutSet, 'completedAt' | 'kind'>): boolean {
  return set.completedAt !== null && set.kind !== 'warmup';
}

/**
 * The Epley estimate of a one-rep max for a set, to the nearest 0.1 kg, or
 * null when there is nothing honest to say: no weight, no reps, or more reps
 * than `E1RM_MAX_REPS`. One rep is the weight itself, since Epley would add a
 * thirtieth to a lift that was actually done.
 */
export function estimatedOneRepMax(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || reps === null || !(weightKg > 0) || reps < 1 || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? weightKg : round1(weightKg * (1 + reps / 30));
}

/**
 * What one set adds to a volume, in the unit `volumeUnit` names for its kind,
 * or null when it has nothing to add. Weight times reps for a weighted lift;
 * the reps alone for a bodyweight or assisted one (an assisted set's weight is
 * the help it was given, so multiplying by it would reward more help); seconds
 * for a hold; metres for a distance or a carry.
 */
export function setVolume(set: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>, kind: ExerciseKind): number | null {
  switch (kind) {
    case 'weight_reps':
      return set.weightKg !== null && set.reps !== null ? set.weightKg * set.reps : null;
    case 'bodyweight_reps':
    case 'assisted_reps':
      return set.reps;
    case 'duration':
      return set.durationSeconds;
    case 'distance':
    case 'weight_distance':
      return set.distanceM;
  }
}

export type VolumeUnit = 'kg' | 'reps' | 'seconds' | 'm';

/** The unit a kind's volume is in. `kg` means kilograms, shown in the person's unit. */
export function volumeUnit(kind: ExerciseKind): VolumeUnit {
  switch (kind) {
    case 'weight_reps': return 'kg';
    case 'bodyweight_reps':
    case 'assisted_reps': return 'reps';
    case 'duration': return 'seconds';
    case 'distance':
    case 'weight_distance': return 'm';
  }
}

/** The three readings an exercise's chart can draw. */
export type RecordMetric = 'e1rm' | 'best' | 'volume';

/**
 * The metrics an exercise offers: all three for a weighted lift, and the best
 * set and the volume for every other kind (there is no one-rep max for a
 * pull-up or a plank).
 */
export function metricsFor(kind: ExerciseKind): RecordMetric[] {
  return kind === 'weight_reps' ? ['e1rm', 'best', 'volume'] : ['best', 'volume'];
}

// ==== sessions ====

/** A session as the records see it: when it was, and on which of the person's days. */
export interface RecordSession {
  id: string;
  startedAt: string;
  /** The logical day it started on (`dayResetTime` applied). */
  dayKey: string;
}

/**
 * The logical day an instant belongs to under the person's reset time: a set
 * logged at 1 AM with a 4 AM reset is part of yesterday's training, so a
 * session's day is never a bare `toISOString` cut.
 */
export function sessionDayKey(startedAt: string, dayResetTime: string): string {
  return format(logicalDayStart(new Date(startedAt), dayResetTime), 'yyyy-MM-dd');
}

const sessionsCache = new WeakMap<readonly Pick<WorkoutSession, 'id' | 'startedAt'>[], { reset: string; out: RecordSession[] }>();

/** Sessions as `RecordSession`s, oldest first, memoized per array and reset time. */
export function recordSessions(sessions: readonly Pick<WorkoutSession, 'id' | 'startedAt'>[], dayResetTime: string): RecordSession[] {
  const cached = sessionsCache.get(sessions);
  if (cached && cached.reset === dayResetTime) return cached.out;
  const out = sessions
    .map(s => ({ id: s.id, startedAt: s.startedAt, dayKey: sessionDayKey(s.startedAt, dayResetTime) }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  sessionsCache.set(sessions, { reset: dayResetTime, out });
  return out;
}

/** The days a finished workout was started on. Only the app's own sessions: a Health workout is not read here. */
export function trainingDays(sessions: readonly Pick<WorkoutSession, 'id' | 'startedAt' | 'endedAt'>[], dayResetTime: string): Set<string> {
  const days = new Set<string>();
  for (const s of sessions) if (s.endedAt !== null) days.add(sessionDayKey(s.startedAt, dayResetTime));
  return days;
}

/** The first day of the week a day key falls in, as a day key. */
export function weekKeyOf(dayKey: string, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6): string {
  return dayKeyOf(startOfWeek(dayKeyToDate(dayKey), { weekStartsOn }));
}

/** Finished workouts per week, by the week's first day. A week with none is absent. */
export function sessionsPerWeek(
  sessions: readonly Pick<WorkoutSession, 'id' | 'startedAt' | 'endedAt'>[],
  dayResetTime: string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    if (s.endedAt === null) continue;
    const week = weekKeyOf(sessionDayKey(s.startedAt, dayResetTime), weekStartsOn);
    out.set(week, (out.get(week) ?? 0) + 1);
  }
  return out;
}

// ==== one exercise ====

/** One session's counted sets of one exercise. */
interface SessionGroup {
  session: RecordSession;
  /** Done working sets, in the order they were done. */
  sets: WorkoutSet[];
}

export type RecordType = 'e1rm' | 'weight' | 'repsAt' | 'best' | 'volume';

/** A personal best as it stands, and the session that set it. */
export interface RecordRow {
  type: RecordType;
  /** In kg for `e1rm`, `weight` and `repsAt`; otherwise in the kind's own unit. */
  value: number;
  /** The rep count a `repsAt` row is for. */
  reps?: number;
  /** The set that holds it. Null for a volume, which belongs to a whole session. */
  set: WorkoutSet | null;
  sessionId: string;
  dayKey: string;
}

/** A record a session broke, against everything before that session. */
export interface RecordEvent {
  exerciseId: string;
  sessionId: string;
  dayKey: string;
  type: RecordType;
  reps?: number;
  value: number;
  /** The best before this session. Always present: a first time is not a record. */
  previous: number;
  set: WorkoutSet | null;
}

/** One session on an exercise's chart. */
export interface SessionPoint {
  sessionId: string;
  dayKey: string;
  /** Best estimated 1RM of the session, kg. Null for kinds with none, and when no set qualifies. */
  e1rm: number | null;
  /** The best set: the heaviest (weighted kinds), the most reps, the longest hold or the farthest distance. */
  best: { value: number; set: WorkoutSet } | null;
  /** The session's volume in `volumeUnit(kind)`. Null when no set adds to it. */
  volume: number | null;
  sets: number;
}

export interface ExerciseAnalysis {
  kind: ExerciseKind;
  /** One per session that did it, oldest first. */
  points: SessionPoint[];
  /** The personal bests, in display order. */
  records: RecordRow[];
  /** Every record any session broke, oldest first. */
  events: RecordEvent[];
}

/** Heavier wins; at equal weight, more reps. */
function heavier(a: WorkoutSet, b: WorkoutSet): boolean {
  if (a.weightKg! !== b.weightKg!) return a.weightKg! > b.weightKg!;
  return (a.reps ?? 0) > (b.reps ?? 0);
}

/** The figure `best` ranks sets by, per kind. Null when the set has none. */
function bestFigure(set: WorkoutSet, kind: ExerciseKind): number | null {
  switch (kind) {
    // A set with no reps (a failed 140 x 0) or no distance is an attempt, not a lift.
    case 'weight_reps': return set.weightKg !== null && set.weightKg > 0 && set.reps !== null && set.reps >= 1 ? set.weightKg : null;
    case 'weight_distance': return set.weightKg !== null && set.weightKg > 0 && set.distanceM !== null && set.distanceM > 0 ? set.weightKg : null;
    case 'bodyweight_reps':
    case 'assisted_reps': return set.reps !== null && set.reps > 0 ? set.reps : null;
    case 'duration': return set.durationSeconds !== null && set.durationSeconds > 0 ? set.durationSeconds : null;
    case 'distance': return set.distanceM !== null && set.distanceM > 0 ? set.distanceM : null;
  }
}

/** Whether `a` is a better "best set" than `b` for the kind. */
function betterBest(a: WorkoutSet, b: WorkoutSet, kind: ExerciseKind): boolean {
  const fa = bestFigure(a, kind)!;
  const fb = bestFigure(b, kind)!;
  if (fa !== fb) return fa > fb;
  // Weighted kinds break a tie on reps; the rest have nothing else to compare.
  return kind === 'weight_reps' ? (a.reps ?? 0) > (b.reps ?? 0) : false;
}

interface Held<T = WorkoutSet> {
  set: T;
  sessionId: string;
  dayKey: string;
}

/** The running bests the walk carries from one session to the next. */
interface Standing {
  e1rm: (Held & { value: number }) | null;
  /** The heaviest set (`weight_reps`'s "heaviest weight" and `weight_distance`'s "best"). */
  heaviest: Held | null;
  /** The best set for kinds ranked by one figure (`best`). */
  best: Held | null;
  /** By rep count N: the heaviest set of N or more reps. */
  ladder: Map<number, Held>;
  volume: { value: number; sessionId: string; dayKey: string } | null;
}

function emptyStanding(): Standing {
  return { e1rm: null, heaviest: null, best: null, ladder: new Map(), volume: null };
}

function sessionBests(group: SessionGroup, kind: ExerciseKind) {
  let e1rm: (Held & { value: number }) | null = null;
  let heaviest: WorkoutSet | null = null;
  let best: WorkoutSet | null = null;
  const ladder = new Map<number, WorkoutSet>();
  let volume: number | null = null;
  for (const set of group.sets) {
    const v = setVolume(set, kind);
    if (v !== null) volume = (volume ?? 0) + v;
    if (bestFigure(set, kind) !== null && (best === null || betterBest(set, best, kind))) best = set;
    if (kind !== 'weight_reps' && kind !== 'weight_distance') continue;
    if (bestFigure(set, kind) === null) continue;
    if (heaviest === null || heavier(set, heaviest)) heaviest = set;
    if (kind !== 'weight_reps' || set.reps === null) continue;
    const est = estimatedOneRepMax(set.weightKg, set.reps);
    if (est !== null && (e1rm === null || est > e1rm.value)) {
      e1rm = { value: est, set, sessionId: group.session.id, dayKey: group.session.dayKey };
    }
    for (let n = 1; n <= Math.min(set.reps, REP_RECORD_MAX); n++) {
      const cur = ladder.get(n);
      if (!cur || heavier(set, cur)) ladder.set(n, set);
    }
  }
  return { e1rm, heaviest, best, ladder, volume };
}

/**
 * Walks an exercise's sessions oldest to newest, once, producing the chart's
 * points, the standing personal bests and every record a session broke.
 *
 * A session is judged **as a whole against everything before it**, not set by
 * set: three sets that each nudged the best up are one new record for that
 * session, at its best figure, rather than three events. A "best set of N" is
 * kept as the heaviest set of N *or more* reps, so a heavier set of ten
 * retires the best of eight (it dominates it), and it is only listed, and only
 * announced, while the set holding it has exactly N reps: otherwise one set
 * would appear as eight different records.
 */
function walk(exerciseId: string, kind: ExerciseKind, groups: readonly SessionGroup[]): ExerciseAnalysis {
  const standing = emptyStanding();
  const points: SessionPoint[] = [];
  const events: RecordEvent[] = [];
  const weighted = kind === 'weight_reps';

  for (const group of groups) {
    const { session } = group;
    const now = sessionBests(group, kind);
    const at = { sessionId: session.id, dayKey: session.dayKey };
    const fire = (e: Omit<RecordEvent, 'exerciseId' | 'sessionId' | 'dayKey'>) =>
      events.push({ exerciseId, ...at, ...e });

    points.push({
      sessionId: session.id,
      dayKey: session.dayKey,
      e1rm: now.e1rm?.value ?? null,
      best: now.best ? { value: bestFigure(now.best, kind)!, set: now.best } : null,
      volume: now.volume,
      sets: group.sets.length,
    });

    // Against what stood before this session. Each check needs something to
    // beat (rule 4), and a figure of zero is nothing.
    if (weighted && now.e1rm && standing.e1rm && now.e1rm.value > standing.e1rm.value) {
      fire({ type: 'e1rm', value: now.e1rm.value, previous: standing.e1rm.value, set: now.e1rm.set });
    }
    if ((weighted || kind === 'weight_distance') && now.heaviest && standing.heaviest
      && now.heaviest.weightKg! > standing.heaviest.set.weightKg!) {
      fire({ type: 'weight', value: now.heaviest.weightKg!, previous: standing.heaviest.set.weightKg!, set: now.heaviest });
    }
    if (weighted) {
      for (const [n, set] of [...now.ladder.entries()].sort((a, b) => a[0] - b[0])) {
        const before = standing.ladder.get(n);
        if (before && set.reps === n && set.weightKg! > before.set.weightKg!) {
          fire({ type: 'repsAt', reps: n, value: set.weightKg!, previous: before.set.weightKg!, set });
        }
      }
    }
    if (!weighted && kind !== 'weight_distance' && now.best && standing.best
      && betterBest(now.best, standing.best.set, kind)
      && bestFigure(now.best, kind)! > bestFigure(standing.best.set, kind)!) {
      fire({ type: 'best', value: bestFigure(now.best, kind)!, previous: bestFigure(standing.best.set, kind)!, set: now.best });
    }
    if (now.volume !== null && now.volume > 0 && standing.volume && now.volume > standing.volume.value) {
      fire({ type: 'volume', value: now.volume, previous: standing.volume.value, set: null });
    }

    // Then fold this session into what stands.
    if (now.e1rm && (!standing.e1rm || now.e1rm.value > standing.e1rm.value)) standing.e1rm = now.e1rm;
    if (now.heaviest && (!standing.heaviest || heavier(now.heaviest, standing.heaviest.set))) {
      standing.heaviest = { set: now.heaviest, ...at };
    }
    if (now.best && (!standing.best || betterBest(now.best, standing.best.set, kind))) {
      standing.best = { set: now.best, ...at };
    }
    for (const [n, set] of now.ladder) {
      const cur = standing.ladder.get(n);
      if (!cur || heavier(set, cur.set)) standing.ladder.set(n, { set, ...at });
    }
    if (now.volume !== null && now.volume > 0 && (!standing.volume || now.volume > standing.volume.value)) {
      standing.volume = { value: now.volume, ...at };
    }
  }

  const records: RecordRow[] = [];
  const row = (type: RecordType, value: number, held: { sessionId: string; dayKey: string }, set: WorkoutSet | null, reps?: number) =>
    records.push({ type, value, set, sessionId: held.sessionId, dayKey: held.dayKey, ...(reps !== undefined ? { reps } : {}) });
  if (standing.e1rm) row('e1rm', standing.e1rm.value, standing.e1rm, standing.e1rm.set);
  if ((weighted || kind === 'weight_distance') && standing.heaviest) {
    row('weight', standing.heaviest.set.weightKg!, standing.heaviest, standing.heaviest.set);
  }
  if (!weighted && kind !== 'weight_distance' && standing.best) {
    row('best', bestFigure(standing.best.set, kind)!, standing.best, standing.best.set);
  }
  for (const [n, held] of [...standing.ladder.entries()].sort((a, b) => a[0] - b[0])) {
    if (held.set.reps === n) row('repsAt', held.set.weightKg!, held, held.set, n);
  }
  if (standing.volume) row('volume', standing.volume.value, standing.volume, null);

  return { kind, points, records, events };
}

function groupsFor(sets: readonly WorkoutSet[], sessions: readonly RecordSession[]): SessionGroup[] {
  const bySession = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    if (!countsForRecords(set)) continue;
    if (!bySession.has(set.sessionId)) bySession.set(set.sessionId, []);
    bySession.get(set.sessionId)!.push(set);
  }
  const groups: SessionGroup[] = [];
  // Sessions are oldest first, so the walk is chronological; a set whose
  // session isn't known (deleted on another device) has no day to stand on.
  for (const session of sessions) {
    const list = bySession.get(session.id);
    if (list) groups.push({ session, sets: list.sort((a, b) => a.setIndex - b.setIndex) });
  }
  return groups;
}

// One analysis per array of sets: the arrays are never mutated in place, so
// identity is a sound key. A second entry (kind, sessions) is kept beside it
// because the same sets read with another kind or session list differ.
interface Memo<R> { sessions: readonly RecordSession[]; kind: ExerciseKind | null; extra: unknown; result: R }
const exerciseMemo = new WeakMap<readonly WorkoutSet[], Memo<ExerciseAnalysis>>();
const allMemo = new WeakMap<readonly WorkoutSet[], Memo<Map<string, ExerciseAnalysis>>>();

/**
 * Everything about one exercise from its sets. `sets` is the exercise's own
 * sets from any session (`exerciseHistory`); `sessions` is `recordSessions`'s
 * answer, oldest first. Memoized per array of sets.
 */
export function analyzeExercise(
  exerciseId: string,
  kind: ExerciseKind,
  sets: readonly WorkoutSet[],
  sessions: readonly RecordSession[],
): ExerciseAnalysis {
  const hit = exerciseMemo.get(sets);
  if (hit && hit.kind === kind && hit.sessions === sessions && hit.extra === exerciseId) return hit.result;
  const result = walk(exerciseId, kind, groupsFor(sets, sessions));
  exerciseMemo.set(sets, { sessions, kind, extra: exerciseId, result });
  return result;
}

/**
 * Every exercise in a pile of sets, analyzed once and keyed by exercise id.
 * `kindOf` says what a set of each exercise records, and is part of the cache
 * key, so pass a stable function (one per catalog). Memoized per array of sets.
 */
export function analyzeAll(
  sets: readonly WorkoutSet[],
  sessions: readonly RecordSession[],
  kindOf: (exerciseId: string) => ExerciseKind,
): Map<string, ExerciseAnalysis> {
  const hit = allMemo.get(sets);
  if (hit && hit.sessions === sessions && hit.extra === kindOf) return hit.result;
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, []);
    byExercise.get(set.exerciseId)!.push(set);
  }
  const result = new Map<string, ExerciseAnalysis>();
  for (const [exerciseId, list] of byExercise) {
    result.set(exerciseId, walk(exerciseId, kindOf(exerciseId), groupsFor(list, sessions)));
  }
  allMemo.set(sets, { sessions, kind: null, extra: kindOf, result });
  return result;
}

// ==== reading the answers ====

/** The records an exercise's walk found that belong to one session, most notable first. */
export function recordsInSession(analyses: Iterable<ExerciseAnalysis>, sessionId: string): RecordEvent[] {
  const out: RecordEvent[] = [];
  for (const a of analyses) for (const e of a.events) if (e.sessionId === sessionId) out.push(e);
  return out;
}

const NOTABLE: Record<RecordType, number> = { e1rm: 0, weight: 1, best: 2, repsAt: 3, volume: 4 };

/** Orders records the way a summary lists them: the estimated 1RM first, volume last, rep counts low to high. */
export function byNotability(a: RecordEvent, b: RecordEvent): number {
  return NOTABLE[a.type] - NOTABLE[b.type] || (a.reps ?? 0) - (b.reps ?? 0);
}

/** The most records one exercise lists on a summary. */
export const SUMMARY_RECORDS_PER_EXERCISE = 3;

export interface ExerciseRecordsSummary {
  exerciseId: string;
  records: RecordEvent[];
}

/**
 * A session's records grouped by exercise, in the order the exercises were
 * first mentioned, each capped at `SUMMARY_RECORDS_PER_EXERCISE` by
 * notability: a set can break four records at once, and a list of four lines
 * about one lift is a wall.
 */
export function summarizeRecords(events: readonly RecordEvent[]): ExerciseRecordsSummary[] {
  const byExercise = new Map<string, RecordEvent[]>();
  for (const e of events) {
    if (!byExercise.has(e.exerciseId)) byExercise.set(e.exerciseId, []);
    byExercise.get(e.exerciseId)!.push(e);
  }
  return [...byExercise.entries()].map(([exerciseId, list]) => ({
    exerciseId,
    records: [...list].sort(byNotability).slice(0, SUMMARY_RECORDS_PER_EXERCISE),
  }));
}

/**
 * The newest records for Stats: for each exercise and session, only the most
 * notable one, newest first, within `RECENT_RECORD_DAYS` of `todayKey`, at
 * most `limit`. A year-old PR is not recent however few have come since.
 */
export function recentRecords(
  analyses: Iterable<ExerciseAnalysis>,
  todayKey: string,
  limit = 5,
): RecordEvent[] {
  const cutoff = dayKeyOf(subDays(dayKeyToDate(todayKey), RECENT_RECORD_DAYS));
  const best = new Map<string, RecordEvent>();
  for (const a of analyses) {
    for (const e of a.events) {
      if (e.dayKey < cutoff || e.dayKey > todayKey) continue;
      const key = `${e.exerciseId}|${e.sessionId}`;
      const cur = best.get(key);
      if (!cur || byNotability(e, cur) < 0) best.set(key, e);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey) || byNotability(a, b))
    .slice(0, limit);
}

/** Whether a record's day is recent enough to be called new. */
export function isNewRecord(dayKey: string, todayKey: string): boolean {
  const days = Math.round((dayKeyToDate(todayKey).getTime() - dayKeyToDate(dayKey).getTime()) / 86400000);
  return days >= 0 && days <= NEW_RECORD_DAYS;
}

/**
 * Whether a standing record row deserves the "New" badge: a recent session
 * broke exactly this record. The badge follows the record events and not the
 * row's day, because the events are where "a record" is defined: a first
 * session, or an equal weight with more reps, holds a row but broke nothing.
 */
export function isNewRecordRow(row: RecordRow, events: readonly RecordEvent[], todayKey: string): boolean {
  return events.some(e => e.type === row.type
    && e.reps === row.reps
    && e.value === row.value
    && e.sessionId === row.sessionId
    && isNewRecord(e.dayKey, todayKey));
}

// ==== muscles ====

/** What the muscle read needs to know about an exercise. */
export interface MuscleInfo {
  kind: ExerciseKind;
  primaryMuscles: readonly MuscleGroup[];
  secondaryMuscles: readonly MuscleGroup[];
}

export interface MuscleWeek {
  /**
   * Sets credited to the muscle: 1 for each done working set that mainly
   * trains it and `SECONDARY_MUSCLE_WEIGHT` for each it helps. A set of an
   * exercise that lists a muscle as both counts once, as primary.
   */
  sets: number;
  /** The weight times reps of weighted lifts credited the same way. Other kinds add nothing here: their volume is in other units. */
  volumeKg: number;
}

const muscleMemo = new WeakMap<readonly WorkoutSet[], {
  sessions: readonly RecordSession[]; infoOf: unknown; weekStartsOn: number; result: Map<string, Map<MuscleGroup, MuscleWeek>>;
}>();

/**
 * Sets and volume per muscle per week, over every set given: week start (a day
 * key) to muscle to totals. Warm-ups and sets not done count nothing. A set of
 * an exercise nobody can resolve (`infoOf` returns null) counts for no muscle
 * rather than for a guess. Memoized per array of sets; pass a stable `infoOf`.
 */
export function muscleWeeks(
  sets: readonly WorkoutSet[],
  sessions: readonly RecordSession[],
  infoOf: (exerciseId: string) => MuscleInfo | null,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): Map<string, Map<MuscleGroup, MuscleWeek>> {
  const hit = muscleMemo.get(sets);
  if (hit && hit.sessions === sessions && hit.infoOf === infoOf && hit.weekStartsOn === weekStartsOn) return hit.result;
  const dayOf = new Map(sessions.map(s => [s.id, s.dayKey]));
  const weekOf = new Map<string, string>();
  const result = new Map<string, Map<MuscleGroup, MuscleWeek>>();
  for (const set of sets) {
    if (!countsForRecords(set)) continue;
    const day = dayOf.get(set.sessionId);
    const info = infoOf(set.exerciseId);
    if (!day || !info) continue;
    let week = weekOf.get(day);
    if (week === undefined) weekOf.set(day, (week = weekKeyOf(day, weekStartsOn)));
    if (!result.has(week)) result.set(week, new Map());
    const muscles = result.get(week)!;
    const volume = info.kind === 'weight_reps' ? setVolume(set, info.kind) ?? 0 : 0;
    const credit = (m: MuscleGroup, share: number) => {
      const cur = muscles.get(m) ?? { sets: 0, volumeKg: 0 };
      muscles.set(m, { sets: cur.sets + share, volumeKg: cur.volumeKg + volume * share });
    };
    for (const m of info.primaryMuscles) credit(m, 1);
    for (const m of info.secondaryMuscles) if (!info.primaryMuscles.includes(m)) credit(m, SECONDARY_MUSCLE_WEIGHT);
  }
  muscleMemo.set(sets, { sessions, infoOf, weekStartsOn, result });
  return result;
}

export interface WeekBar {
  /** The week's first day, as a day key. */
  weekKey: string;
  count: number;
  /** The week `todayKey` falls in, still running. */
  current: boolean;
}

/**
 * The last `weeks` weeks of workout counts, oldest first, ending with the
 * current one. A week with none is a zero-height bar rather than a missing
 * one: here the zero is a fact (the sessions are all in the log), unlike a
 * day the mood log never heard about.
 */
export function recentWeekBars(
  counts: ReadonlyMap<string, number>,
  todayKey: string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  weeks = 8,
): WeekBar[] {
  const currentKey = weekKeyOf(todayKey, weekStartsOn);
  const current = dayKeyToDate(currentKey);
  const out: WeekBar[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekKey = dayKeyOf(addDays(current, -7 * i));
    out.push({ weekKey, count: counts.get(weekKey) ?? 0, current: i === 0 });
  }
  return out;
}

export interface MuscleRow {
  muscle: MuscleGroup;
  sets: number;
}

/**
 * The muscles one week trained, most sets first, at most `limit`. Ties break
 * on the muscle's name so the list doesn't reshuffle between renders.
 */
export function topMuscles(week: ReadonlyMap<MuscleGroup, MuscleWeek> | undefined, limit = 6): MuscleRow[] {
  if (!week) return [];
  return [...week.entries()]
    .map(([muscle, w]) => ({ muscle, sets: w.sets }))
    .filter(r => r.sets > 0)
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle))
    .slice(0, limit);
}
