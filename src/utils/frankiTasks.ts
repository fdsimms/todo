import type { Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import { hourKeyOf, reviewHeldUntil, reviewQueueAt, type ReviewQueue } from './reviewQueue';
import { minutesReadToday, minutesStudiedToday, type FrankiStudyDay } from './frankiStudy';
import { logicalDayStart } from './clockTime';

/**
 * The `franki` generator, from the person's flashcards (Franki, their Anki
 * collection). Its reviews task works one of two ways (`frankiReviewMode`):
 * "Franki: 42 cards left" once a day, ready once every card due today is done,
 * new cards included; or "Franki: 30 reviews" in waves, whenever that many
 * come due. Beside it, "Read & Listen: Thai", a task for each language chosen
 * for the day (below) while a text is waiting in it and none was read today, and "Franki: 12 of 20 min" once a day while
 * a study-time goal is set. See the `franki` section of
 * `docs/arch/generated-tasks.md`.
 *
 * Everything here is pure. `useFrankiStore` holds the last read of Franki's
 * server (`src/services/franki.ts` makes it) and `checkFrankiTasks` in
 * `useTaskStore` is the plumbing. The reviews task is WaniKani's, rule for
 * rule (`reviewQueue.ts`): the forecast is the learning cards Anki says come
 * due later today. The Read & Listen tasks are day-keyed, one per language:
 *
 * - **Once a day per language, spent by writing it.** Only while a text is
 *   waiting in that language and nothing in it was read to the end since the
 *   logical day began. A day that doesn't qualify yet can later (a text gets
 *   written), so declining spends nothing.
 * - **Which languages get one is Franki's call**, not this app's: which to read next
 *   depends on what has been read, which Franki holds. Its status lists today's
 *   languages (`readToday`, Franki's Settings, Daily reading tasks), and this app
 *   writes one task for each, deciding nothing (`wantedFrankiReadLanguages`).
 * - **Nothing here completes a task.** A text read today, or a queue read as
 *   empty, makes the row ready (`isFrankiTaskReady`). The tap stays a person's.
 * - **Yesterday's goes** at the day's first pass, like WaniKani's lessons.
 *
 * The once-a-day cards task and the goal task are day-keyed the same way:
 * written once a day while there's something to do, spent by writing, ready
 * rather than completed, and yesterday's goes. The cards task counts new cards
 * only from Franki's own report (`frankiNew`, its deck list's count, progress
 * gates included); without one from today it counts what Anki says is due,
 * and never reads as done, since the new cards left aren't known.
 *
 * The cram tasks follow Franki's crams (Practice, Cram: the plan for a day
 * coming up, a lesson or a trip), which live only on Franki's phone and reach
 * its server while Franki's "Share today's counts and crams" is on:
 *
 * - **Practice, once a day while a cram runs** (`cram:<day>:<id>`), written
 *   like a Read & Listen task: once a day, spent by writing it, not written
 *   when the cram was already practiced today, ready once it has been.
 * - **Check off the words used, once its day is over** (`cramdone:<id>`), as
 *   Franki's own Today card asks. Not day-keyed: it stays until Franki says the
 *   cram is finished (then it's ready) and goes once Franki stops listing it
 *   (finished on an earlier day, or deleted). Written once per cram.
 */

/** Read & Listen's side of a read: the language being read and its shelf. */
export interface FrankiReadListen {
  /** The language's code on Franki's server ("th", "pl"). */
  language: string;
  /** Its name in English, for the title ("Thai"). */
  name: string;
  /** Texts waiting to be read in it. */
  waiting: number;
}

/** One language Franki lists for today's Read & Listen tasks (its `read_and_listen_today`). */
export interface FrankiReadToday {
  language: string;
  name: string;
  /** Whether a text in it was read to the end since Franki's study day began. */
  done: boolean;
}

/** The languages that already got a Read & Listen task on one logical day, this device's own record. */
export interface FrankiReadSpent {
  dayKey: string;
  languages: string[];
}

export function parseFrankiReadSpent(raw: unknown): FrankiReadSpent | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const v = value as { dayKey?: unknown; languages?: unknown } | null;
  if (!v || typeof v.dayKey !== 'string' || !Array.isArray(v.languages)) return null;
  return { dayKey: v.dayKey, languages: v.languages.filter((l): l is string => typeof l === 'string') };
}

/** Today's spent languages: the record, or none once its day has passed. */
export function frankiReadSpentToday(spent: FrankiReadSpent | null, todayKey: string): string[] {
  return spent && spent.dayKey === todayKey ? spent.languages : [];
}

/** The record with one more language spent today. */
export function withFrankiReadSpent(spent: FrankiReadSpent | null, todayKey: string, language: string): FrankiReadSpent {
  const languages = frankiReadSpentToday(spent, todayKey);
  return { dayKey: todayKey, languages: languages.includes(language) ? languages : [...languages, language] };
}

/**
 * One read of Franki's server. `reviewsNow` is every card due now, reviews and
 * learning cards alike; `upcoming` is the learning cards coming due later in
 * Anki's study day. New cards aren't counted: Franki's own progress gate can
 * hold them back where Anki's count wouldn't.
 */
export interface FrankiSnapshot extends ReviewQueue {
  /** When the read landed (ISO). */
  fetchedAt: string;
  /** When Anki's next study day starts (ISO), when the server said. */
  dayEndsAt: string | null;
  /** The language being read in Franki. Null when the server didn't say (Read & Listen isn't set up there). */
  readListen: FrankiReadListen | null;
  /**
   * The languages Franki says get a Read & Listen task today, or null from a
   * server from before it chose them (no task is written or taken away then).
   */
  readToday: FrankiReadToday[] | null;
  /**
   * New cards left today as Franki's deck list counts them, progress gates
   * included, or null when Franki hasn't reported since Anki's day began
   * (its "Share today's counts" setting is off, or it hasn't synced today).
   */
  frankiNew: number | null;
  /** The last study days, oldest first (`frankiStudy.ts`); empty from an older server. */
  studyDays: FrankiStudyDay[];
  /**
   * Franki's open crams, and any finished today, as Franki last reported
   * them. Null when Franki never has (its sharing setting is off, or the
   * server is older): no cram task is written or taken away then.
   */
  crams: FrankiCram[] | null;
}

/** One of Franki's crams, as its server reports it (`franki_crams`). */
export interface FrankiCram {
  /** Franki's id for it ("thai-lesson-2026-11-20"): letters, digits and hyphens. */
  id: string;
  name: string;
  /** Its day, `YYYY-MM-DD`. */
  date: string;
  /** When its day ends in Franki (ISO): practice runs until then. */
  endsAt: string;
  /** When it was last practiced (ISO), or null. */
  practicedAt: string | null;
  /** When Franki's Finish was pressed for it (ISO), or null. */
  finishedAt: string | null;
}

/** How the reviews task works: once a day for all of today's cards, or in waves. */
export type FrankiReviewMode = 'daily' | 'waves';
export const FRANKI_REVIEW_MODE_DEFAULT: FrankiReviewMode = 'daily';

export function parseFrankiReviewMode(value: unknown): FrankiReviewMode {
  return value === 'waves' || value === 'daily' ? value : FRANKI_REVIEW_MODE_DEFAULT;
}

/** The study-time goal's stepper: minutes a day. */
export const FRANKI_GOAL_MINUTES_DEFAULT = 20;
export const FRANKI_GOAL_MINUTES_MIN = 5;
export const FRANKI_GOAL_MINUTES_MAX = 240;
export const FRANKI_GOAL_MINUTES_STEP = 5;

/** `frankiGoalMinutes` clamped to the stepper, with null (no goal) kept as null. */
export function clampFrankiGoalMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const stepped = Math.round(value / FRANKI_GOAL_MINUTES_STEP) * FRANKI_GOAL_MINUTES_STEP;
  return Math.min(FRANKI_GOAL_MINUTES_MAX, Math.max(FRANKI_GOAL_MINUTES_MIN, stepped));
}

export const FRANKI_REVIEW_THRESHOLD_DEFAULT = 10;
export const FRANKI_REVIEW_THRESHOLD_MIN = 1;
export const FRANKI_REVIEW_THRESHOLD_MAX = 500;

/** Where each task opens: Franki's deck list, and its Read & Listen tab. */
export const FRANKI_REVIEW_URL = 'franki://';
export const FRANKI_READ_URL = 'franki://read';

/** A cram's practice task opens the cram; its check-off task opens At the lesson, where the words are checked off. */
export function frankiCramUrl(id: string): string {
  return `franki://cram?id=${encodeURIComponent(id)}`;
}

export function frankiCramCheckOffUrl(id: string): string {
  return `franki://cram-lesson?id=${encodeURIComponent(id)}`;
}

/** A language's Read & Listen task opens Franki's shelf already on that language (`?language=de`). */
export function frankiReadUrl(language: string): string {
  return `${FRANKI_READ_URL}?language=${encodeURIComponent(language)}`;
}

/** `frankiReviewThreshold` clamped to what the stepper offers, defaulting anything unusable. */
export function clampFrankiReviewThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return FRANKI_REVIEW_THRESHOLD_DEFAULT;
  return Math.min(FRANKI_REVIEW_THRESHOLD_MAX, Math.max(FRANKI_REVIEW_THRESHOLD_MIN, Math.round(value)));
}

/**
 * The status address for what the person typed: the sync server's address
 * ("anki.example.com"), Read & Listen's ("…/reader") or the route's own. A
 * bare host gets its https://. Null when there's nothing to read from. The one
 * reader of `frankiServer`, so Settings and the fetch can't disagree on it.
 */
export function frankiStatusUrl(typed: string | null | undefined): string | null {
  let base = (typed ?? '').trim();
  if (!base) return null;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/api\/status$/i, '').replace(/\/reader$/i, '');
  return `${base}/reader/api/status`;
}

// ==== source ids ====

const REVIEWS_PREFIX = 'reviews:';
const READ_PREFIX = 'read:';
const DAY_PREFIX = 'day:';
const GOAL_PREFIX = 'goal:';
const CRAM_PREFIX = 'cram:';
const CRAM_DONE_PREFIX = 'cramdone:';

/** A wave of reviews is named by the hour its task was placed at. */
export function frankiReviewSourceId(at: Date): string {
  return `${REVIEWS_PREFIX}${hourKeyOf(at)}`;
}

/** A day's Read & Listen task in one language is named by the logical day and the language's code. */
export function frankiReadSourceId(dayKey: string, language: string): string {
  return `${READ_PREFIX}${dayKey}:${language}`;
}

/** The once-a-day cards task is named by the logical day. */
export function frankiDailySourceId(dayKey: string): string {
  return `${DAY_PREFIX}${dayKey}`;
}

/** The study-time goal task is named by the logical day. */
export function frankiGoalSourceId(dayKey: string): string {
  return `${GOAL_PREFIX}${dayKey}`;
}

/** A day's practice task for one cram is named by the logical day and the cram's id. */
export function frankiCramSourceId(dayKey: string, id: string): string {
  return `${CRAM_PREFIX}${dayKey}:${id}`;
}

/** A cram's check-off task is named by the cram alone: it isn't a day's. */
export function frankiCramDoneSourceId(id: string): string {
  return `${CRAM_DONE_PREFIX}${id}`;
}

export type FrankiTaskKind = 'reviews' | 'read' | 'day' | 'goal' | 'cram' | 'cramDone';

/** Which of the tasks a row is, or null when it isn't one of this generator's. */
export function frankiTaskKind(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): FrankiTaskKind | null {
  const sourceId = generatedSourceOf(task, 'franki');
  if (sourceId?.startsWith(REVIEWS_PREFIX)) return 'reviews';
  if (sourceId?.startsWith(READ_PREFIX)) return 'read';
  if (sourceId?.startsWith(DAY_PREFIX)) return 'day';
  if (sourceId?.startsWith(GOAL_PREFIX)) return 'goal';
  if (sourceId?.startsWith(CRAM_PREFIX)) return 'cram';
  if (sourceId?.startsWith(CRAM_DONE_PREFIX)) return 'cramDone';
  return null;
}

/** The day a day-keyed task (Read & Listen, the cards, the goal, a cram's practice) is for, or null for a wave or a cram's check-off. */
export function frankiTaskDayKey(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  const sourceId = generatedSourceOf(task, 'franki');
  if (sourceId?.startsWith(READ_PREFIX)) return sourceId.slice(READ_PREFIX.length).split(':')[0];
  if (sourceId?.startsWith(CRAM_PREFIX)) return sourceId.slice(CRAM_PREFIX.length).split(':')[0];
  for (const prefix of [DAY_PREFIX, GOAL_PREFIX]) {
    if (sourceId?.startsWith(prefix)) return sourceId.slice(prefix.length);
  }
  return null;
}

/**
 * The language a Read & Listen task is for, or null for one written before
 * there was a task per language (`read:<day>`), which the pass replaces.
 */
export function frankiReadTaskLanguage(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  const sourceId = generatedSourceOf(task, 'franki');
  if (!sourceId?.startsWith(READ_PREFIX)) return null;
  const rest = sourceId.slice(READ_PREFIX.length);
  const at = rest.indexOf(':');
  return at === -1 ? null : rest.slice(at + 1) || null;
}

/** The cram a practice or check-off task is for, or null for any other row. */
export function frankiCramTaskId(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  const sourceId = generatedSourceOf(task, 'franki');
  if (sourceId?.startsWith(CRAM_DONE_PREFIX)) return sourceId.slice(CRAM_DONE_PREFIX.length) || null;
  if (!sourceId?.startsWith(CRAM_PREFIX)) return null;
  const rest = sourceId.slice(CRAM_PREFIX.length);
  const at = rest.indexOf(':');
  return at === -1 ? null : rest.slice(at + 1) || null;
}

// ==== titles ====

export function frankiReviewTitle(count: number): string {
  if (count <= 0) return 'Franki reviews';
  return `Franki: ${count} ${count === 1 ? 'review' : 'reviews'}`;
}

export function frankiReadTitle(readListen: Pick<FrankiReadListen, 'name'> | null): string {
  return readListen?.name ? `Read & Listen: ${readListen.name}` : 'Read & Listen';
}

export function frankiDailyTitle(left: number): string {
  if (left <= 0) return 'Franki: today’s cards';
  return `Franki: ${left} ${left === 1 ? 'card' : 'cards'} left`;
}

export function frankiGoalTitle(minutes: number, goal: number): string {
  return `Franki: ${minutes} of ${goal} min`;
}

/** "Practice for Thai lesson (in 3 days)": counted in calendar days from today's key, never below today. */
export function frankiCramPracticeTitle(cram: Pick<FrankiCram, 'name' | 'date'>, todayKey: string): string {
  const days = Math.max(0, calendarDaysBetween(todayKey, cram.date));
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return `Practice for ${cram.name} (${when})`;
}

export function frankiCramCheckOffTitle(cram: Pick<FrankiCram, 'name'>): string {
  return `Check off the words you used in ${cram.name}`;
}

/** Whole days from one `YYYY-MM-DD` to another, by the calendar, so a DST change can't make one 23 hours. */
function calendarDaysBetween(fromKey: string, toKey: string): number {
  const utc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toKey) - utc(fromKey)) / 86_400_000);
}

// ==== the once-a-day cards task ====

/**
 * Every card still to do today: due now, the learning cards coming due later
 * today, and the new cards Franki's deck list has left. `newKnown` is false
 * when Franki hasn't reported today, so the new cards left are unknown and
 * the count is a floor.
 */
export function frankiCardsLeft(snapshot: FrankiSnapshot): { count: number; newKnown: boolean } {
  const later = snapshot.upcoming.reduce((sum, arrival) => sum + arrival.count, 0);
  return {
    count: snapshot.reviewsNow + later + (snapshot.frankiNew ?? 0),
    newKnown: snapshot.frankiNew !== null,
  };
}

/** Whether today's cards task should be written now: once a day, while cards are left. */
export function wantsFrankiDailyTask(input: {
  snapshot: FrankiSnapshot;
  todayKey: string;
  lastDayKey: string | null;
}): boolean {
  if (input.lastDayKey === input.todayKey) return false;
  return frankiCardsLeft(input.snapshot).count > 0;
}

// ==== the study-time goal ====

/**
 * Whether today's goal task should be written now: once a day, while a goal
 * is set and the minutes studied today are read and under it.
 */
export function wantsFrankiGoalTask(input: {
  snapshot: FrankiSnapshot;
  todayKey: string;
  lastDayKey: string | null;
  goal: number | null;
  countReading: boolean;
  now: Date;
}): boolean {
  const { snapshot, todayKey, lastDayKey, goal, countReading, now } = input;
  if (goal === null || lastDayKey === todayKey) return false;
  const minutes = minutesStudiedToday(snapshot.studyDays, now, countReading);
  return minutes !== null && minutes < goal;
}

/**
 * The minutes line under a Franki row ("18 min studied today", "6 min read
 * today"), or null for none: nothing studied yet, a read that doesn't cover
 * today, or the goal task, whose title already says it.
 */
export function frankiRowMinutes(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  snapshot: FrankiSnapshot | null,
  now: Date,
  countReading: boolean,
): string | null {
  if (!snapshot) return null;
  const kind = frankiTaskKind(task);
  if (kind === 'reviews' || kind === 'day') {
    const minutes = minutesStudiedToday(snapshot.studyDays, now, countReading);
    return minutes ? `${minutes} min studied today` : null;
  }
  if (kind === 'read') {
    const language = frankiReadTaskLanguage(task);
    const minutes = language ? minutesReadToday(snapshot.studyDays, now, language) : null;
    return minutes ? `${minutes} min read today` : null;
  }
  return null;
}

// ==== Read & Listen ====

/**
 * The languages that should get a Read & Listen task written now: those Franki
 * lists today that weren't read to the end and haven't had their task today
 * (`spentToday`, so declining spends nothing but writing does, and a task
 * checked off or deleted stays gone).
 */
export function wantedFrankiReadLanguages(readToday: FrankiReadToday[], spentToday: string[]): string[] {
  return readToday.filter(l => !l.done && !spentToday.includes(l.language)).map(l => l.language);
}

// ==== crams ====

/** The crams this device already wrote a task for: practice today, and the check-off tasks ever written. */
export interface FrankiCramSpent {
  dayKey: string;
  /** The crams whose practice task was written on `dayKey`. */
  practiced: string[];
  /** The crams whose check-off task was written, on any day (kept to the crams Franki still lists). */
  checkedOff: string[];
}

export function parseFrankiCramSpent(raw: unknown): FrankiCramSpent | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const v = value as { dayKey?: unknown; practiced?: unknown; checkedOff?: unknown } | null;
  if (!v || typeof v.dayKey !== 'string') return null;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  return { dayKey: v.dayKey, practiced: strings(v.practiced), checkedOff: strings(v.checkedOff) };
}

/**
 * The record with one more task written: `practice` today, or `checkOff`. The
 * check-off list keeps only the crams in `listed`, so one Franki stopped
 * listing doesn't stay in it for good.
 */
export function withFrankiCramSpent(
  spent: FrankiCramSpent | null,
  todayKey: string,
  written: { practice: string } | { checkOff: string },
  listed: readonly string[],
): FrankiCramSpent {
  const practiced = spent && spent.dayKey === todayKey ? spent.practiced : [];
  const checkedOff = (spent?.checkedOff ?? []).filter(id => listed.includes(id));
  if ('practice' in written) {
    return { dayKey: todayKey, practiced: practiced.includes(written.practice) ? practiced : [...practiced, written.practice], checkedOff };
  }
  return { dayKey: todayKey, practiced, checkedOff: checkedOff.includes(written.checkOff) ? checkedOff : [...checkedOff, written.checkOff] };
}

/**
 * Where a cram is: `running` until its day ends in Franki (practice), then
 * `over` until Franki's Finish is pressed (check off the words used), then
 * `finished`. Franki's own `isRunning` / `isAwaitingFinish`, from what it sent.
 */
export type FrankiCramStage = 'running' | 'over' | 'finished';

export function frankiCramStage(cram: Pick<FrankiCram, 'endsAt' | 'finishedAt'>, now: Date): FrankiCramStage {
  if (cram.finishedAt) return 'finished';
  return now.getTime() < Date.parse(cram.endsAt) ? 'running' : 'over';
}

/** Whether a cram was practiced since the logical day began. */
export function frankiCramPracticedToday(cram: Pick<FrankiCram, 'practicedAt'>, dayStart: Date): boolean {
  return cram.practicedAt !== null && Date.parse(cram.practicedAt) >= dayStart.getTime();
}

/**
 * What each cram's tasks should be now. `keepPractice` / `keepCheckOff`: a
 * task already there stays (a cram that stops being listed, or moves on, takes
 * it away). `writePractice` / `writeCheckOff`: a task not there yet is written,
 * once (spent by writing, so one checked off or deleted stays gone).
 */
export function frankiCramPlan(input: {
  cram: FrankiCram;
  now: Date;
  dayStart: Date;
  spent: FrankiCramSpent | null;
  todayKey: string;
}): { keepPractice: boolean; writePractice: boolean; keepCheckOff: boolean; writeCheckOff: boolean } {
  const { cram, now, dayStart, spent, todayKey } = input;
  const stage = frankiCramStage(cram, now);
  const practicedSpent = spent && spent.dayKey === todayKey ? spent.practiced : [];
  return {
    keepPractice: stage === 'running',
    writePractice: stage === 'running' && !practicedSpent.includes(cram.id) && !frankiCramPracticedToday(cram, dayStart),
    keepCheckOff: stage !== 'running',
    writeCheckOff: stage === 'over' && !(spent?.checkedOff ?? []).includes(cram.id),
  };
}

/**
 * Whether a Franki row reads as ready to check off: its queue is empty, a text
 * was read today, every card due today is done, the study-time goal is met, a cram
 * was practiced today, or a cram whose day is over was finished in Franki. Derived only, from the latest read. A reviews task
 * still held for the forecast is never ready: the queue is empty *because*
 * the cards haven't come due yet.
 */
export function isFrankiTaskReady(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'> & Partial<Pick<Task, 'dueDate' | 'windowStart'>>,
  snapshot: FrankiSnapshot | null,
  now: Date,
  dayResetTime = '00:00',
  goal: { minutes: number | null; countReading: boolean } = { minutes: null, countReading: true },
): boolean {
  if (!snapshot) return false;
  const kind = frankiTaskKind(task);
  if (kind === 'reviews') {
    const heldUntil = reviewHeldUntil({ dueDate: task.dueDate ?? null, windowStart: task.windowStart ?? null }, dayResetTime);
    if (heldUntil && heldUntil.getTime() > now.getTime()) return false;
    return reviewQueueAt(snapshot, now) === 0;
  }
  if (kind === 'read') {
    const language = frankiReadTaskLanguage(task);
    return language !== null && (snapshot.readToday?.find(l => l.language === language)?.done ?? false);
  }
  if (kind === 'day') {
    // Unknown new cards are not none left.
    const left = frankiCardsLeft(snapshot);
    return left.newKnown && left.count === 0;
  }
  if (kind === 'goal') {
    if (goal.minutes === null) return false;
    const minutes = minutesStudiedToday(snapshot.studyDays, now, goal.countReading);
    return minutes !== null && minutes >= goal.minutes;
  }
  if (kind === 'cram' || kind === 'cramDone') {
    const id = frankiCramTaskId(task);
    const cram = snapshot.crams?.find(c => c.id === id);
    if (!cram) return false;
    return kind === 'cram'
      ? frankiCramPracticedToday(cram, logicalDayStart(now, dayResetTime))
      : cram.finishedAt !== null;
  }
  return false;
}
