/**
 * Patterns: how the person's habits are going and how their moods line up
 * with what they do. The two reads an assistant is most often asked for and
 * least able to do well from raw rows, because both are about *which* rows
 * count and *how little* data is too little to say anything.
 *
 * Neither invents a rule. `habit_patterns` is the Stats screen's rhythm and
 * estimate reads (`rhythms.ts`, `estimateCalibration.ts`) plus the streak and
 * pace the rows already carry; `mood_insights` is the Mood screen's card list
 * (`moodInsights.ts`), composed the way `MoodScreen` composes it, with the same
 * retention clipping and the same kitchen gate. So every refusal those modules
 * make (a floor of paired days, a coefficient never shown, an unlogged day
 * never a zero) is made here too, by the same code.
 *
 * What the server cannot add is Apple Health: a Node process has no HealthKit,
 * so the steps and sleep findings the phone shows are absent here, and the
 * result says so rather than reporting nothing found.
 */
import type { Task, TimeOfDay } from '../../src/types';
import type { Replica, ReplicaLib } from './replica';
import { describeRepeat, type RepeatInput } from './taskFields';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const DEFAULT_PATTERN_DAYS = 90;
const MAX_HABITS = 40;

function boundaries(replica: Replica) {
  const s = replica.settings();
  return {
    morningStart: s.morningStart,
    afternoonStart: s.afternoonStart,
    eveningStart: s.eveningStart,
    nightStart: s.nightStart,
  };
}

// ---------------------------------------------------------------------------
// habit_patterns
// ---------------------------------------------------------------------------

export interface Rhythm {
  /** The busiest three-hour stretch, "9 AM–12 PM". */
  peakHours: string;
  peakPartOfDay: TimeOfDay;
  byWeekday: Record<string, number>;
  /** How many completions the pattern is drawn from. */
  completions: number;
}

export interface HabitPattern {
  /** The live row, the one complete_task and update_task act on. */
  id: string;
  title: string;
  repeat?: RepeatInput;
  /** A "don't do this" habit: its streak counts clean days rather than completions. */
  avoid?: true;
  /** As the app keeps it: consecutive completions (or clean days), last counted on `asOf`. */
  streak?: { count: number; asOf: string };
  target?: { count: number; per: 'day' | 'week'; done: number; onPace: boolean };
  /** Over the window. Missed means swept as missed, not merely not done. */
  completed: number;
  missed: number;
  lastCompletedAt?: string;
  /** When it actually gets done, once there are enough completions to say. */
  rhythm?: Rhythm;
  /** The part of the day it is set to, where that disagrees with when it is done, and the app's own reason. */
  timeOfDayMismatch?: { setTo: TimeOfDay; doneIn: TimeOfDay; reason: string };
}

export interface HabitPatterns {
  windowDays: number;
  /** Across every completion in the window. Null below the app's own floor. */
  overall: {
    rhythm: Rhythm | null;
    /**
     * Timed tasks against their estimates: above 1 means things take longer
     * than expected. A pace, never a verdict. Null below five timed tasks.
     */
    estimates: { ratio: number; samples: number; summary: string | null } | null;
  };
  habits: HabitPattern[];
  /** More habits than were listed. */
  more?: number;
}

function rhythmOf(lib: ReplicaLib, tasks: readonly Task[], options: Parameters<ReplicaLib['rhythms']['buildRhythmProfile']>[1]): Rhythm | null {
  const profile = lib.rhythms.buildRhythmProfile(tasks, options);
  if (!profile.peakRange || !profile.peakSegment) return null;
  return {
    peakHours: lib.rhythms.formatHourRange(profile.peakRange),
    peakPartOfDay: profile.peakSegment,
    byWeekday: Object.fromEntries(
      profile.byWeekday.map((n, i) => [WEEKDAYS[i], n]).filter(([, n]) => (n as number) > 0)
    ),
    completions: profile.sampleCount,
  };
}

/** The same identity the rhythm mismatch uses: a series, else the normalized title. */
function cohortKey(lib: ReplicaLib, task: Task): string | null {
  if (task.seriesId) return `series:${task.seriesId}`;
  const key = lib.taskInstances.normalizeTitle(task.title);
  return key ? `title:${key}` : null;
}

function isHabit(task: Task): boolean {
  return task.recurrenceType !== 'none' || task.polarity === 'negative' || (task.targetCount ?? 0) >= 2;
}

export function habitPatterns(replica: Replica, input: { days?: number } = {}): HabitPatterns {
  const lib = replica.lib();
  const windowDays = Math.min(Math.max(input.days ?? DEFAULT_PATTERN_DAYS, 7), 730);
  const { dayResetTime } = replica.settings();
  const options = { boundaries: boundaries(replica), dayResetTime, windowDays };
  const all = replica.tasks();
  const since = Date.now() - windowDays * 86_400_000;

  const history = new Map<string, Task[]>();
  for (const t of all) {
    if (t.parentId || !t.completed) continue;
    const key = cohortKey(lib, t);
    if (key) history.set(key, [...(history.get(key) ?? []), t]);
  }

  const mismatches = new Map<string, { setTo: TimeOfDay; doneIn: TimeOfDay; reason: string }>();
  for (const m of lib.rhythms.findSegmentMismatches(all, options)) {
    for (const id of m.taskIds) mismatches.set(id, { setTo: m.declared, doneIn: m.observed, reason: m.reason });
  }

  const live = all.filter(t => !t.parentId && !t.completed && !t.archived && isHabit(t));
  const habits = live.map((t): HabitPattern => {
    const key = cohortKey(lib, t);
    const rows = (key ? history.get(key) : undefined) ?? [];
    const recent = rows.filter(r => r.completedAt && Date.parse(r.completedAt) >= since);
    const done = recent.filter(r => replica.isRealCompletion(r));
    const last = rows
      .filter(r => replica.isRealCompletion(r) && r.completedAt)
      .reduce<string | undefined>((m, r) => (!m || r.completedAt! > m ? r.completedAt! : m), undefined);
    const target = t.targetCount != null && lib.visibility.isQuotaTask(t)
      ? {
          count: t.targetCount,
          per: (t.quotaPeriod === 'week' ? 'week' : 'day') as 'day' | 'week',
          done: t.progressCount ?? 0,
          onPace: lib.visibility.isQuotaOnPace(t),
        }
      : undefined;
    const rhythm = rhythmOf(lib, rows, options);

    return {
      id: t.id,
      title: replica.displayTitle(t),
      ...(describeRepeat(t) ? { repeat: describeRepeat(t)! } : {}),
      ...(t.polarity === 'negative' ? { avoid: true as const } : {}),
      ...(t.streakCount > 0 && t.streakDate ? { streak: { count: t.streakCount, asOf: t.streakDate.slice(0, 10) } } : {}),
      ...(target ? { target } : {}),
      completed: done.length,
      missed: recent.length - done.length,
      ...(last ? { lastCompletedAt: last } : {}),
      ...(rhythm ? { rhythm } : {}),
      ...(mismatches.has(t.id) ? { timeOfDayMismatch: mismatches.get(t.id)! } : {}),
    };
  });
  // Most practised first: the habits a question is likely about.
  habits.sort((a, b) => b.completed - a.completed || a.title.localeCompare(b.title));

  const calibration = lib.calibration.calibrationFrom(all);
  return {
    windowDays,
    overall: {
      rhythm: rhythmOf(lib, all, options),
      estimates: calibration
        ? { ratio: Math.round(calibration.ratio * 100) / 100, samples: calibration.samples, summary: lib.calibration.describeCalibration(calibration) }
        : null,
    },
    habits: habits.slice(0, MAX_HABITS),
    ...(habits.length > MAX_HABITS ? { more: habits.length - MAX_HABITS } : {}),
  };
}

// ---------------------------------------------------------------------------
// mood_insights
// ---------------------------------------------------------------------------

/** One "with it against without it" row. The two day counts are always reported. */
export interface Contrast {
  label: string;
  daysWith: number;
  daysWithout: number;
  /** Average mood, 1 to 5, on each side. */
  moodWith: number;
  moodWithout: number;
}

export interface MoodInsights {
  /** The rules every finding here was held to. Repeat them when explaining a finding. */
  rules: string[];
  summary: { loggedDays: number; daysWithMood: number; averageMood: number | null; lowDays: number; loggingStreak: number };
  /** Does what gets done move with mood? A direction and a strength, never a number. */
  moodAndCompletions: {
    days: number;
    strength?: string;
    direction?: 'more done on better days' | 'less done on better days';
    averageDoneOnGoodDays?: number;
    averageDoneOnLowDays?: number;
    note?: string;
  };
  byCategory: Contrast[];
  byRepeatingTask: Contrast[];
  bySymptom: Contrast[];
  byContextTag: Contrast[];
  byFood: Contrast[];
  /** The app's own sentences about calories and sugar against mood and completions. */
  nutrients: string[];
  byTimeOfDay: { partOfDay: TimeOfDay; entries: number; averageMood: number }[];
  milestones: { label: string; date: string; daysBefore?: number; daysAfter?: number; moodBefore?: number; moodAfter?: number; note?: string }[];
  /** Logged days older than the completed-task retention window, which the task comparisons cannot use. */
  daysOutsideTaskHistory?: number;
  appleHealth: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const CONTRAST_CAP = 6;

export function moodInsights(replica: Replica): MoodInsights {
  const lib = replica.lib();
  const mi = lib.moodInsights;
  const settings = replica.settings();
  const today = replica.todayKey();
  const logs = replica.allMoodLogs();
  const tasks = replica.tasks();

  const cutoff = lib.retention.retentionCutoff(settings.completedRetentionDays as never, new Date(), settings.dayResetTime);
  const knownFrom = cutoff === null ? null : replica.logicalDayKeyOf(cutoff.toISOString());
  // The phone reads 90 days of food for this, and the kitchen switch drops the lot.
  const food = settings.kitchenEnabled ? replica.foodLogEntries(replica.shiftDayKey(today, -89), today) : [];
  const days = mi.buildMoodDays(logs, tasks, settings.dayResetTime, [], knownFrom, lib.nutritionStats.foodDayInputs(food));

  const names = (vocabulary: string[], keyOf: (s: string) => string) => {
    const out = new Map<string, string>();
    for (const name of vocabulary) out.set(keyOf(name), name);
    return out;
  };
  const symptomNames = names(lib.moodLog.symptomVocabulary(logs), lib.moodLog.symptomKey);
  const tagNames = names(lib.moodLog.contextTagVocabulary(logs), lib.moodLog.contextTagKey);
  const taskTitles = mi.taskContrastTitles(tasks);
  const foodNames = lib.nutritionStats.foodKeyNames(food, {
    items: new Map(replica.groceryItems().map(i => [i.id, i.name])),
    recipes: new Map(replica.recipes().map(r => [r.id, r.name])),
  });
  const contrasts = (rows: ReturnType<typeof mi.categoryMoodContrasts>, label: (key: string) => string): Contrast[] =>
    rows.slice(0, CONTRAST_CAP).map(r => ({
      label: label(r.label),
      daysWith: r.withDays,
      daysWithout: r.withoutDays,
      moodWith: round(r.moodWith),
      moodWithout: round(r.moodWithout),
    }));

  const summary = mi.moodSummary(days, today);
  const completion = mi.moodCompletionInsight(days);
  const seg = boundaries(replica);

  return {
    rules: [
      `Associations, never causes. Say "on days you…", not "because".`,
      `Nothing is compared below ${mi.MIN_PAIRED_DAYS} days with both a mood and a record, and each side of a contrast needs ${mi.MIN_CONTRAST_DAYS} days.`,
      'A day nobody logged is unknown, not a zero.',
      'There is deliberately no medication-against-symptom comparison: you take a painkiller because something hurts, so the comparison would point backwards.',
    ],
    summary: {
      loggedDays: summary.loggedDays,
      daysWithMood: summary.moodDays,
      averageMood: summary.averageMood === null ? null : round(summary.averageMood),
      lowDays: summary.lowDays,
      loggingStreak: summary.streak,
    },
    moodAndCompletions: completion.strength && completion.direction
      ? {
          days: completion.dayCount,
          strength: completion.strength,
          direction: completion.direction === 'more' ? 'more done on better days' : 'less done on better days',
          ...(completion.completedOnGoodDays != null ? { averageDoneOnGoodDays: round(completion.completedOnGoodDays) } : {}),
          ...(completion.completedOnLowDays != null ? { averageDoneOnLowDays: round(completion.completedOnLowDays) } : {}),
        }
      : {
          days: completion.dayCount,
          note: completion.dayCount < mi.MIN_PAIRED_DAYS
            ? `Not enough yet: ${completion.dayCount} of the ${mi.MIN_PAIRED_DAYS} days needed.`
            : 'No relationship to report.',
        },
    byCategory: contrasts(mi.categoryMoodContrasts(days), k => k),
    byRepeatingTask: contrasts(mi.taskMoodContrasts(days), k => taskTitles.get(k) ?? k),
    bySymptom: contrasts(mi.symptomMoodContrasts(days), k => symptomNames.get(k) ?? k),
    byContextTag: contrasts(mi.contextTagMoodContrasts(days), k => tagNames.get(k) ?? k),
    byFood: settings.kitchenEnabled ? contrasts(mi.foodMoodContrasts(days), k => foodNames.get(k) ?? k) : [],
    nutrients: settings.kitchenEnabled ? mi.nutrientFindings(days).map(f => f.text) : [],
    byTimeOfDay: mi.moodByTimeOfDay(logs, iso => lib.rhythms.segmentOf(new Date(iso), seg)).map(r => ({
      partOfDay: r.segment,
      entries: r.entryCount,
      averageMood: round(r.mood),
    })),
    milestones: replica.milestones().map(m => {
      const c = mi.milestoneMoodContrast(days, replica.logicalDayKeyOf(m.date));
      return c
        ? { label: m.label, date: m.date.slice(0, 10), daysBefore: c.beforeDays, daysAfter: c.afterDays, moodBefore: round(c.moodBefore), moodAfter: round(c.moodAfter) }
        : { label: m.label, date: m.date.slice(0, 10), note: 'Not enough logged days on both sides yet.' };
    }),
    ...(knownFrom !== null
      ? { daysOutsideTaskHistory: days.filter(d => d.dayKey < knownFrom && d.mood !== null).length }
      : {}),
    appleHealth: 'Not readable by this server, so the steps and sleep findings the phone shows are not here.',
  };
}
