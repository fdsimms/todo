import type { Task, TimeOfDay } from '../types';
import { normalizeTitle } from './taskInstances';
import { logicalDayStart } from './clockTime';
import { isRealCompletion } from './missed';

/**
 * When you actually get things done — the observed half of the app's schedule.
 *
 * Everything else here records *declared* intent: timeSegments say a task is a
 * morning task, deferUntil says not before Thursday, estimatedMinutes says half
 * an hour. The app has always written down what really happened too — every
 * completion stamps `completedAt` — and never once read it back for anything
 * but the deadline comparison in stats.ts. This module is that read.
 *
 * It's the sibling of effortEstimator: that one learns *how long* things take
 * from `actualMinutes`, this one learns *when* they get done from `completedAt`.
 * Same discipline, deliberately — a shared MIN_SAMPLES floor, a plain-language
 * `reason` on every claim, and abstaining outright rather than reporting a
 * pattern two data points wide.
 *
 * It never reads the settings store, the way clockTime doesn't: every
 * preference it needs (segment boundaries, dayResetTime) is a parameter with a
 * sensible default, so the whole module is exercisable from the `node` test
 * environment without standing one up. `rhythmOptionsFromSettings()` in
 * rhythmsSettings.ts is the thin wrapper that supplies them from the store,
 * and that's what the UI imports.
 */

/** Segment boundaries, shaped like the settings store's own keys. */
export interface SegmentBoundaries {
  morningStart: string;   // "HH:MM"
  afternoonStart: string;
  eveningStart: string;
  nightStart: string;
}

/** The settings store's defaults, so callers and tests can omit boundaries. */
export const DEFAULT_BOUNDARIES: SegmentBoundaries = {
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
};

export interface RhythmOptions {
  boundaries?: SegmentBoundaries;
  dayResetTime?: string;
  /** Only count completions this recent. null/undefined = all of history. */
  windowDays?: number | null;
  /** Injectable clock, for windowDays and for tests. */
  now?: Date;
}

// One or two completions at the same hour is a coincidence, not a rhythm. Same
// floor effortEstimator uses before it will quote a median.
export const MIN_SAMPLES = 3;

// How lopsided a cohort has to be before we'll call its real time-of-day
// something other than what it's labelled. At 3 samples this means all 3.
const MAJORITY_RATIO = 0.6;

// There is deliberately no "quietest stretch" counterpart to the peak. The
// emptiest window inside the active span is always the run-up to bedtime — it
// reported 8–11pm on every realistic profile tried, never the afternoon dip it
// was meant to find, because the tail of the day is genuinely emptier than its
// middle. A line that is always technically true and never informative is
// worse than no line, so the section carries the peak alone.

// The headline reads a stretch of the day, not a single hour: "between 9 and
// 11am" is how people describe when they work, and it's far more stable than
// an argmax that can swing an hour on one task.
const RANGE_HOURS = 3;

const SEGMENTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function boundaryFor(boundaries: SegmentBoundaries, segment: TimeOfDay): string {
  return segment === 'morning' ? boundaries.morningStart
    : segment === 'afternoon' ? boundaries.afternoonStart
    : segment === 'evening' ? boundaries.eveningStart
    : boundaries.nightStart;
}

/**
 * Which part of the day a moment falls in, under the user's own boundaries.
 *
 * The inverse of getTimeOfDayThreshold in visibilityUtils, which turns a
 * segment into the clock time it opens at; nothing needed to go the other way
 * until now. Two things it has to survive: the pre-morning small hours (03:00
 * belongs to *night*, the one segment that wraps past midnight), and boundaries
 * the user has dragged out of their natural order — hence sorting the marks
 * rather than assuming morning < afternoon < evening < night.
 */
export function segmentOf(date: Date, boundaries: SegmentBoundaries = DEFAULT_BOUNDARIES): TimeOfDay {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const marks = SEGMENTS
    .map(segment => ({ segment, at: hhmmToMinutes(boundaryFor(boundaries, segment)) }))
    .sort((a, b) => a.at - b.at);

  // Start on the last segment of the day: a moment before every boundary is
  // still inside the segment that opened yesterday and never closed.
  let current = marks[marks.length - 1].segment;
  for (const mark of marks) {
    if (minutes >= mark.at) current = mark.segment;
  }
  return current;
}

export interface HourRange {
  /** Inclusive start hour, 0–23. */
  startHour: number;
  /** Exclusive end hour, 1–24. */
  endHour: number;
  /** Completions inside the range. */
  count: number;
}

export interface RhythmProfile {
  /** Completions per clock hour, index 0–23. */
  byHour: number[];
  /** Completions per logical weekday, index 0 = Sunday. */
  byWeekday: number[];
  /** Completions per part of the day. */
  bySegment: Record<TimeOfDay, number>;
  /** The busiest RANGE_HOURS-long stretch, or null below MIN_SAMPLES. */
  peakRange: HourRange | null;
  /** The part of the day the most gets finished in, or null below MIN_SAMPLES. */
  peakSegment: TimeOfDay | null;
  /** How many completions the profile was built from. */
  sampleCount: number;
}

function emptySegmentCounts(): Record<TimeOfDay, number> {
  return { morning: 0, afternoon: 0, evening: 0, night: 0 };
}

/** Top-level, non-archived, actually-completed rows with a usable timestamp. */
function completionsOf(tasks: readonly Task[], options: RhythmOptions): Date[] {
  const { windowDays, now = new Date() } = options;
  const cutoff = windowDays != null && windowDays > 0
    ? new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
    : null;

  const out: Date[] = [];
  for (const task of tasks) {
    // Subtasks are steps inside a task, not completions in their own right —
    // counting them would make a 6-subtask task look like a productive hour.
    if (task.parentId) continue;
    if (task.archived) continue;
    if (!isRealCompletion(task) || !task.completedAt) continue;
    const at = new Date(task.completedAt);
    if (Number.isNaN(at.getTime())) continue;
    if (cutoff && at < cutoff) continue;
    out.push(at);
  }
  return out;
}

/** The busiest contiguous window of `span` hours, wrapping past midnight. */
function busiestRange(byHour: number[], span: number): HourRange | null {
  let best: HourRange | null = null;
  for (let startHour = 0; startHour < 24; startHour++) {
    let count = 0;
    for (let i = 0; i < span; i++) count += byHour[(startHour + i) % 24];
    if (best == null || count > best.count) {
      best = { startHour, endHour: startHour + span, count };
    }
  }
  return best;
}

/**
 * The user's completion rhythm across the supplied tasks.
 *
 * Hours are read off the wall clock — "I finish things around 9" means 9 by the
 * clock whatever the logical day is doing. Weekdays are read off the *logical*
 * day, so a 1 AM completion under a 2 AM reset counts on the day the user
 * thinks they were still in, which is the same rule every other screen uses.
 */
export function buildRhythmProfile(tasks: readonly Task[], options: RhythmOptions = {}): RhythmProfile {
  const { boundaries = DEFAULT_BOUNDARIES, dayResetTime = '00:00' } = options;
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  const bySegment = emptySegmentCounts();

  const completions = completionsOf(tasks, options);
  for (const at of completions) {
    byHour[at.getHours()]++;
    byWeekday[logicalDayStart(at, dayResetTime).getDay()]++;
    bySegment[segmentOf(at, boundaries)]++;
  }

  const sampleCount = completions.length;
  if (sampleCount < MIN_SAMPLES) {
    return { byHour, byWeekday, bySegment, peakRange: null, peakSegment: null, sampleCount };
  }

  const peakRange = busiestRange(byHour, RANGE_HOURS);

  let peakSegment: TimeOfDay | null = null;
  for (const segment of SEGMENTS) {
    if (peakSegment == null || bySegment[segment] > bySegment[peakSegment]) peakSegment = segment;
  }

  return { byHour, byWeekday, bySegment, peakRange, peakSegment, sampleCount };
}

/** "9am", "1pm", "12am" — or "09:00" on the 24-hour setting. */
export function formatHour(hour: number, use24Hour = false): string {
  const h = ((hour % 24) + 24) % 24;
  if (use24Hour) return `${String(h).padStart(2, '0')}:00`;
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

/**
 * "9–11am" when a range stays inside one half of the day, "11am–1pm" when it
 * crosses over — dropping the repeated meridiem is what makes it read like a
 * sentence rather than a log line.
 */
export function formatHourRange(range: HourRange, use24Hour = false): string {
  const start = ((range.startHour % 24) + 24) % 24;
  const end = ((range.endHour % 24) + 24) % 24;
  if (use24Hour) return `${formatHour(start, true)}–${formatHour(end, true)}`;
  const sameHalf = (start < 12) === (end < 12);
  const startLabel = sameHalf
    ? String(start % 12 === 0 ? 12 : start % 12)
    : formatHour(start);
  return `${startLabel}–${formatHour(end)}`;
}

/** The one-line headline for the Stats section, or null when there's nothing to say. */
export function describeRhythm(profile: RhythmProfile, use24Hour = false): string | null {
  if (!profile.peakRange || profile.peakRange.count === 0) return null;
  return `Most gets done ${formatHourRange(profile.peakRange, use24Hour)}`;
}

export interface SegmentMismatch {
  /** Cohort key — stable across occurrences, safe as a list key. */
  key: string;
  /** Display title, taken from the most recent completion. */
  title: string;
  /** Live rows still carrying the declared segment, i.e. what a fix would update. */
  taskIds: string[];
  /** What the task says it is. */
  declared: TimeOfDay;
  /** What it actually turns out to be. */
  observed: TimeOfDay;
  /** Completions that landed in `observed`. */
  observedCount: number;
  /** Completions considered, all of which declared `declared`. */
  total: number;
  /** Plain-language justification, in effortEstimator's voice. */
  reason: string;
}

interface Cohort {
  key: string;
  title: string;
  titleAt: string;
  /** Completions that declared exactly one segment, with what they declared. */
  samples: { at: Date; declared: TimeOfDay }[];
  /** Incomplete, unarchived rows, by the segment they currently declare. */
  liveByDeclared: Map<TimeOfDay, string[]>;
}

/**
 * The identity of "this same commitment, over time".
 *
 * A series is explicit. Everything else groups on the normalized title, which
 * is how the Stats screen already keys habits and how getRepeatedInstances
 * groups ad-hoc repeats — worth matching for its own sake, and it survives a
 * retention purge, which walking previousOccurrenceId back to a root does not:
 * deleting a middle occurrence would split one habit into two cohorts, each
 * below MIN_SAMPLES, and the pattern would vanish from the list.
 */
function cohortKeyOf(task: Task): string | null {
  if (task.seriesId) return `series:${task.seriesId}`;
  const key = normalizeTitle(task.title);
  return key ? `title:${key}` : null;
}

/** The segment a row declares, but only when it declares exactly one. */
function soleDeclaredSegment(task: Task): TimeOfDay | null {
  const segments = task.timeSegments ?? [];
  return segments.length === 1 ? segments[0] : null;
}

/**
 * Tasks whose declared time of day disagrees with when they actually get done.
 *
 * This is the payoff of keeping both halves of the schedule: the app can say
 * "you call this a morning task and you have finished it in the evening six
 * times running", which no amount of declared data alone could tell you.
 *
 * Only cohorts with a live row still carrying the declared segment are
 * reported. A purely historical mismatch is trivia — there's nothing left to
 * fix — and every row in this list is meant to be one tap from being right.
 */
export function findSegmentMismatches(
  tasks: readonly Task[],
  options: RhythmOptions = {},
): SegmentMismatch[] {
  const { boundaries = DEFAULT_BOUNDARIES, windowDays, now = new Date() } = options;
  const cutoff = windowDays != null && windowDays > 0
    ? new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
    : null;

  const cohorts = new Map<string, Cohort>();
  const cohortOf = (key: string, title: string): Cohort => {
    let cohort = cohorts.get(key);
    if (!cohort) {
      cohort = { key, title, titleAt: '', samples: [], liveByDeclared: new Map() };
      cohorts.set(key, cohort);
    }
    return cohort;
  };

  for (const task of tasks) {
    if (task.parentId) continue;
    if (task.archived) continue;
    // A stack member's schedule belongs to the stack, not the row — offering
    // to move just this one instance would desync it from the label it hangs
    // off, the same reason group children skip the roster elsewhere.
    if (task.groupId) continue;
    const key = cohortKeyOf(task);
    if (!key) continue;

    if (isRealCompletion(task) && task.completedAt) {
      const declared = soleDeclaredSegment(task);
      if (!declared) continue;
      const at = new Date(task.completedAt);
      if (Number.isNaN(at.getTime())) continue;
      if (cutoff && at < cutoff) continue;
      const cohort = cohortOf(key, task.title.trim());
      cohort.samples.push({ at, declared });
      // Most recent completion wins the display casing, as in taskInstances.
      if (task.completedAt > cohort.titleAt) {
        cohort.title = task.title.trim();
        cohort.titleAt = task.completedAt;
      }
      continue;
    }

    if (!task.completed) {
      const declared = soleDeclaredSegment(task);
      if (!declared) continue;
      const cohort = cohortOf(key, task.title.trim());
      const ids = cohort.liveByDeclared.get(declared) ?? [];
      ids.push(task.id);
      cohort.liveByDeclared.set(declared, ids);
    }
  }

  const mismatches: SegmentMismatch[] = [];
  for (const cohort of cohorts.values()) {
    if (cohort.samples.length < MIN_SAMPLES) continue;

    // A cohort can have been relabelled over its life; judge each declared
    // segment on its own completions rather than blending them together.
    const byDeclared = new Map<TimeOfDay, Date[]>();
    for (const sample of cohort.samples) {
      const list = byDeclared.get(sample.declared) ?? [];
      list.push(sample.at);
      byDeclared.set(sample.declared, list);
    }

    for (const [declared, dates] of byDeclared) {
      if (dates.length < MIN_SAMPLES) continue;
      const liveIds = cohort.liveByDeclared.get(declared);
      if (!liveIds || liveIds.length === 0) continue;

      const observedCounts = emptySegmentCounts();
      for (const at of dates) observedCounts[segmentOf(at, boundaries)]++;

      let observed: TimeOfDay = SEGMENTS[0];
      for (const segment of SEGMENTS) {
        if (observedCounts[segment] > observedCounts[observed]) observed = segment;
      }
      if (observed === declared) continue;

      const observedCount = observedCounts[observed];
      if (observedCount / dates.length < MAJORITY_RATIO) continue;

      mismatches.push({
        key: `${cohort.key}:${declared}`,
        title: cohort.title,
        taskIds: liveIds,
        declared,
        observed,
        observedCount,
        total: dates.length,
        reason: `Done in the ${observed} ${observedCount} of the last ${dates.length} times.`,
      });
    }
  }

  // Strongest evidence first: the most lopsided, then the best-sampled.
  return mismatches.sort((a, b) => {
    const ratio = (b.observedCount / b.total) - (a.observedCount / a.total);
    if (ratio !== 0) return ratio;
    return b.total - a.total;
  });
}

export interface SegmentSuggestion {
  segment: TimeOfDay;
  reason: string;
}

/**
 * When this kind of task actually gets done — the editor's "Suggest" answer for
 * the Time of day row.
 *
 * Tiered exactly like estimateEffort, first tier with enough samples wins, and
 * it abstains rather than guessing: series → this exact title → the strongest
 * shared title word → category and tags. There is deliberately no global tier.
 * Effort has one because "the median task takes 20 minutes" is a defensible
 * prior; "you finish most things in the morning, so do this in the morning" is
 * not — it would put a morning label on every task in the app.
 */
export function suggestSegment(
  title: string,
  opts: { category?: string | null; tags?: string[]; seriesId?: string | null; excludeTaskId?: string | null },
  tasks: readonly Task[],
  options: RhythmOptions = {},
): SegmentSuggestion | null {
  const { boundaries = DEFAULT_BOUNDARIES } = options;
  const trimmed = title.trim();

  const pool = tasks.filter(t =>
    !t.parentId &&
    !t.archived &&
    isRealCompletion(t) &&
    t.completedAt &&
    t.id !== opts.excludeTaskId,
  );

  const decide = (rows: Task[], reason: (segment: TimeOfDay, n: number) => string): SegmentSuggestion | null => {
    if (rows.length < MIN_SAMPLES) return null;
    const counts = emptySegmentCounts();
    for (const t of rows) counts[segmentOf(new Date(t.completedAt!), boundaries)]++;
    let best: TimeOfDay = SEGMENTS[0];
    for (const segment of SEGMENTS) {
      if (counts[segment] > counts[best]) best = segment;
    }
    if (counts[best] / rows.length < MAJORITY_RATIO) return null;
    return { segment: best, reason: reason(best, counts[best]) };
  };

  if (opts.seriesId) {
    const found = decide(
      pool.filter(t => t.seriesId === opts.seriesId),
      (segment, n) => `Done in the ${segment} ${n} times in this set.`,
    );
    if (found) return found;
  }

  const key = normalizeTitle(trimmed);
  if (key) {
    const found = decide(
      pool.filter(t => normalizeTitle(t.title) === key),
      (segment, n) => `Done in the ${segment} ${n} times before.`,
    );
    if (found) return found;
  }

  let bestToken: { token: string; rows: Task[] } | null = null;
  for (const token of titleTokens(trimmed)) {
    const rows = pool.filter(t => titleTokens(t.title).includes(token));
    if (rows.length >= MIN_SAMPLES && (!bestToken || rows.length > bestToken.rows.length)) {
      bestToken = { token, rows };
    }
  }
  if (bestToken) {
    const token = bestToken.token;
    const found = decide(
      bestToken.rows,
      (segment, n) => `${n} past tasks containing "${token}" were done in the ${segment}.`,
    );
    if (found) return found;
  }

  const category = opts.category ?? null;
  const tags = opts.tags ?? [];
  if (category != null || tags.length > 0) {
    const found = decide(
      pool.filter(t => (category != null && t.category === category) || t.tags.some(tag => tags.includes(tag))),
      (segment, n) => `${n} past tasks with a similar category or tag were done in the ${segment}.`,
    );
    if (found) return found;
  }

  return null;
}

// Mirrors effortEstimator's tokenizer — same stopwords, same length floor, so
// the two tiers cohort a title the same way and one can't claim a match the
// other wouldn't.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'with',
  'my', 'your', 'this', 'that', 'from', 'up', 'out', 'about',
]);

function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}
