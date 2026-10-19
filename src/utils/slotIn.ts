import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import type { Category, GeneratedKind, Task } from '../types';

/**
 * "If the day is full, wait": a task whose date is a target rather than a
 * promise. Store-free, like `meters.ts` and `weatherWait.ts`: this module is
 * the decision, and `applySlotIns` in `useTaskStore.ts` is what writes it.
 * See `docs/arch/slot-in.md`.
 *
 * **The task's own `deferUntil` is the hold.** Hiding a task until a day is
 * what a defer already is, so nothing in the visibility rules knows about
 * slot-in, and Today, Later, the month grid and Look ahead place a waiting
 * task with no new code. `slotDecidedOn` is how the pass recognises its own
 * hold: a defer to the day after it is the pass's, any other future defer is
 * the person's snooze and is left alone.
 *
 * **Each day is decided once.** A task the pass let through stays on Today
 * whatever happens to the day's load afterwards, and one it held stays held.
 * Moving tasks while someone is looking at the list is the opposite of what
 * this is for.
 *
 * **Everything waiting eventually lands.** At least one waiting task shows
 * every day, even a full one, and the longest wait goes first, so the queue
 * drains at a day's pace no matter how busy the days are. A deadline always
 * wins: a task is never held past one.
 */

/** How many waiting tasks a day that isn't busy takes in all, counting the one that always lands. */
export const SLOT_IN_LIGHT_DAY_MAX = 2;

/**
 * The generated kinds that may wait. A generated task is usually about a
 * specific day (the weather, a meal, food about to go off, whose deadline is
 * the day it spoils), so only the ones that aren't are listed: catching up
 * with someone is as good on Thursday as on Tuesday.
 */
const SLOT_IN_GENERATED_KINDS: ReadonlySet<GeneratedKind> = new Set<GeneratedKind>(['reachOut']);

// The two day-key helpers from dateUtils, restated for the reason meters.ts
// gives: that module reads the settings store. Same keys, local not UTC.
const dayKeyOf = (date: Date) => format(date, 'yyyy-MM-dd');
const dayKeyToDate = (key: string) => new Date(`${key}T00:00:00`);
const nextDayKey = (key: string) => dayKeyOf(addDays(dayKeyToDate(key), 1));
const keyOfIso = (iso: string | null | undefined) => (iso ? dayKeyOf(new Date(iso)) : null);

type SlotInSource = Pick<
  Task,
  | 'parentId' | 'completed' | 'archived' | 'dueDate' | 'targetCount' | 'recurrenceType'
  | 'recurrenceInterval' | 'polarity' | 'reminderTime' | 'generatedKind'
> & Partial<Pick<Task, 'meterName' | 'weatherWait'>>;

/**
 * Whether a task can wait for a lighter day at all, whatever its setting says.
 *
 * It needs a date, since a task with none has no day to be full. The rest are
 * tasks for which waiting means something else already: a daily target or a
 * daily repeat (tomorrow has its own, so waiting is a skipped day), an
 * every-N-hours task, a meter or weather wait (each owns `deferUntil` itself),
 * an avoid-habit (nothing to do), and a reminder set for a moment, which
 * would fire on a day the task is no longer on.
 */
export function canSlotIn(task: SlotInSource): boolean {
  if (task.parentId || task.completed || task.archived || !task.dueDate) return false;
  if (task.targetCount !== null) return false;
  if (task.recurrenceType === 'hours') return false;
  if (task.recurrenceType === 'daily' && task.recurrenceInterval <= 1) return false;
  if (task.meterName || task.weatherWait) return false;
  if (task.polarity === 'negative') return false;
  if (task.reminderTime) return false;
  if (task.generatedKind !== null && !SLOT_IN_GENERATED_KINDS.has(task.generatedKind)) return false;
  return true;
}

/** The task's own answer, else its category's, else no. */
export function effectiveSlotIn(
  task: Pick<Task, 'slotIn' | 'category'>,
  categories: readonly Pick<Category, 'name' | 'slotIn'>[],
): boolean {
  if (typeof task.slotIn === 'boolean') return task.slotIn;
  if (!task.category) return false;
  return categories.find(c => c.name === task.category)?.slotIn === true;
}

/**
 * Whether anyone has turned this on, on a task or a category. Backfill offers
 * the question only then, since a feature nobody uses is not an unanswered one.
 */
export function slotInInUse(
  tasks: readonly Pick<Task, 'slotIn'>[],
  categories: readonly Pick<Category, 'slotIn'>[],
): boolean {
  return categories.some(c => c.slotIn) || tasks.some(t => t.slotIn === true);
}

/** The category supplying the answer, when the task has none of its own. Null when the task answers for itself or nothing does. */
export function slotInFromCategory(
  task: Pick<Task, 'slotIn' | 'category'>,
  categories: readonly Pick<Category, 'name' | 'slotIn'>[],
): string | null {
  if (typeof task.slotIn === 'boolean' || !task.category) return null;
  return categories.some(c => c.name === task.category && c.slotIn) ? task.category : null;
}

/** Whether `deferUntil` is the pass's own hold: a defer to the day after the day it decided. */
export function isSlotHold(task: Pick<Task, 'deferUntil' | 'slotDecidedOn'>): boolean {
  if (!task.slotDecidedOn || !task.deferUntil) return false;
  return keyOfIso(task.deferUntil) === nextDayKey(task.slotDecidedOn);
}

/** Whether the task is being held by the pass right now (its hold is still ahead of today). */
export function isSlotWaiting(task: Pick<Task, 'deferUntil' | 'slotDecidedOn' | 'completed'>, todayKey: string): boolean {
  return !task.completed && isSlotHold(task) && keyOfIso(task.deferUntil)! > todayKey;
}

/** The day a task's date currently puts it on: the later of its date and its defer. */
function effectiveDayKey(task: Pick<Task, 'dueDate' | 'deferUntil'>): string | null {
  const due = keyOfIso(task.dueDate);
  const defer = keyOfIso(task.deferUntil);
  if (due && defer) return defer > due ? defer : due;
  return due ?? defer;
}

/**
 * The day the task was first meant for: the earliest of the pass's own stamp,
 * the start of a run of the person's own pushes (`driftingSince`), and its
 * date. A push by hand counts as waiting just as a hold does, which is the
 * point: something already put off twice should not be put off a third time
 * ahead of something new.
 */
export function slotWaitingSinceKey(
  task: Pick<Task, 'dueDate' | 'deferUntil' | 'slotWaitingSince' | 'driftingSince'>,
): string | null {
  const keys = [task.slotWaitingSince ?? null, keyOfIso(task.driftingSince), keyOfIso(task.dueDate), effectiveDayKey(task)]
    .filter((k): k is string => k !== null);
  return keys.length ? keys.reduce((a, b) => (b < a ? b : a)) : null;
}

/**
 * Whether today's pass should decide this task: it can wait, it is set to,
 * its day has come, and nothing has decided it today. A defer to a later day
 * that isn't the pass's is the person's own, and the task isn't due yet.
 */
export function isSlotInCandidate(
  task: Task,
  categories: readonly Pick<Category, 'name' | 'slotIn'>[],
  todayKey: string,
): boolean {
  if (!canSlotIn(task) || !effectiveSlotIn(task, categories)) return false;
  if (task.slotDecidedOn === todayKey) return false;
  const day = effectiveDayKey(task);
  return day !== null && day <= todayKey;
}

/** Tasks that must show today whatever the day holds. */
function mustLand(task: Task, todayKey: string): boolean {
  // Held to tomorrow, a deadline today or earlier would be missed.
  const deadline = keyOfIso(task.deadline);
  if (deadline !== null && deadline <= todayKey) return true;
  // Pinned, urgent and a running timer all say "today" more plainly than a
  // category default can say "whenever".
  return task.pinned || task.priority === 4 || task.timerStartedAt !== null;
}

export interface SlotInDay {
  todayKey: string;
  /** What is already on today, in the ranked minutes `dayLoad.ts` uses, leaving out the candidates. */
  baseMinutes: number;
  /** The day is spoken for whatever its minutes say (an all-day event, a trip day). */
  full: boolean;
  /** The line a day crosses to read as busy (`BUSY_DAY_MINUTES`). */
  busyMinutes: number;
  /** A task's cost to the day: its estimate, or the stand-in for one with none. */
  minutesOf: (task: Task) => number;
}

export interface SlotInPlan {
  land: Task[];
  hold: Task[];
}

/** Longest wait first, then priority, then the person's own order. */
export function compareSlotInOrder(a: Task, b: Task): number {
  const wa = slotWaitingSinceKey(a) ?? '9999';
  const wb = slotWaitingSinceKey(b) ?? '9999';
  if (wa !== wb) return wa < wb ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.sortOrder - b.sortOrder;
}

/**
 * Splits today's candidates into the ones that show and the ones that wait.
 *
 * In order: everything `mustLand` names; then the longest-waiting task, which
 * always lands so nothing waits for ever; then, on a day that isn't busy,
 * more of them up to `SLOT_IN_LIGHT_DAY_MAX` in all, each only while it keeps
 * the day under the busy line. Each one landed counts toward the load the next is judged on, or
 * one light day would collect the whole queue and stop being light.
 */
export function planSlotIns(candidates: readonly Task[], day: SlotInDay): SlotInPlan {
  const land: Task[] = [];
  const hold: Task[] = [];
  let minutes = day.baseMinutes;
  const rest: Task[] = [];
  for (const task of candidates) {
    if (mustLand(task, day.todayKey)) {
      land.push(task);
      minutes += day.minutesOf(task);
    } else rest.push(task);
  }
  rest.sort(compareSlotInOrder);
  let waitingLanded = 0;
  for (const task of rest) {
    const cost = day.minutesOf(task);
    const fits = !day.full && waitingLanded < SLOT_IN_LIGHT_DAY_MAX && minutes + cost < day.busyMinutes;
    if (waitingLanded === 0 || fits) {
      land.push(task);
      minutes += cost;
      waitingLanded += 1;
    } else hold.push(task);
  }
  return { land, hold };
}

/** The write for a task the pass lets through today. */
export function slotLandPatch(todayKey: string): Partial<Task> {
  return { slotDecidedOn: todayKey };
}

/** The write for a task the pass holds until tomorrow. */
export function slotHoldPatch(task: Task, todayKey: string): Partial<Task> {
  return {
    deferUntil: dayKeyToDate(nextDayKey(todayKey)).toISOString(),
    slotDecidedOn: todayKey,
    slotWaitingSince: slotWaitingSinceKey(task) ?? todayKey,
  };
}

/**
 * The write that lets go of a task the pass no longer has any business with
 * (the setting was turned off, on the task or its category, or the task can
 * no longer wait): a hold still ahead is lifted, and the marks are cleared.
 * Null when there is nothing to undo.
 */
export function slotReleasePatch(task: Task, todayKey: string): Partial<Task> | null {
  if (!task.slotDecidedOn && !task.slotWaitingSince) return null;
  const patch: Partial<Task> = { slotDecidedOn: null, slotWaitingSince: null };
  if (isSlotWaiting(task, todayKey)) patch.deferUntil = null;
  return patch;
}

function shortDay(key: string, todayKey: string): string {
  const date = dayKeyToDate(key);
  const ago = differenceInCalendarDays(dayKeyToDate(todayKey), date);
  return ago >= 0 && ago < 7 ? format(date, 'EEE') : format(date, 'MMM d');
}

/**
 * The row's line about waiting: "Waiting since Mon" while held, "Waited since
 * Mon" once let through after a wait. Null for a task that hasn't waited.
 */
export function slotInChipText(
  task: Pick<Task, 'deferUntil' | 'slotDecidedOn' | 'slotWaitingSince' | 'completed'>,
  todayKey: string,
): string | null {
  if (task.completed || !task.slotWaitingSince) return null;
  if (isSlotWaiting(task, todayKey)) return `Waiting since ${shortDay(task.slotWaitingSince, todayKey)}`;
  if (task.slotWaitingSince < todayKey) return `Waited since ${shortDay(task.slotWaitingSince, todayKey)}`;
  return null;
}
