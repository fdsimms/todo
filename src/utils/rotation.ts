/**
 * Rotations — a quota whose units have names.
 *
 * "Listen to a podcast in each of my five languages, once each, some time this
 * week, in whatever order I feel like." That is a count and a period, which is
 * a quota, plus one thing a quota cannot hold: which of the five are still
 * outstanding. So a rotation is `Task.rotationItems` (the named set) and
 * `Task.rotationLog` (what has been picked this period) bolted onto the weekly
 * quota that already exists, rather than a mechanism of its own.
 *
 * Everything about *when the row appears* is the quota's and is untouched. The
 * pace ramp (`quotaExpectedByNow`) surfaces the row when you fall behind and
 * hides it while you are keeping up, so five members across a week produce
 * about five appearances, one at a time. `targetCount` is derived from the
 * set's size (`derivedTargetCount` in useTaskStore), which is what lets the
 * meter, the pace mark, the progress chip, `isQuotaPartial` and
 * `rolloverQuotas` all keep working without knowing rotations exist.
 *
 * Three rules live here and are the ones worth not re-deriving:
 *
 * 1. **A stale ledger is ignored, never swept.** `rotationPeriodStart` stamps
 *    the ledger with the period it belongs to, and `activeRotationLog` returns
 *    nothing when that is not the current period. Same shape as
 *    `quotaStartedAt` being honoured only on its own logical day, and it is why
 *    this feature adds no maintenance pass: an app left closed for a fortnight
 *    opens on a clean week without anything having run while it was shut.
 *
 * 2. **The period is the quota's period, so it honours `weekStartsOn`.**
 *    `quotaWeekStart` is reused verbatim rather than reaching for
 *    `startOfWeek`, which would both ignore `dayResetTime` and split a
 *    Monday-start user's week in the wrong place.
 *
 * 3. **`rotationLastDone` says when, and nothing else.** It exists so the
 *    picker can show "Last done 3 weeks ago" beside a member, which is the
 *    fact. Naming the pattern on top of it — calling someone avoidant, ranking
 *    their languages by neglect — is the line `docs/arch/people.md` and
 *    `docs/arch/mood-log.md` both hold, and nothing here may cross it.
 */
import type { RotationItem, RotationLogEntry, Task } from '../types';
import { quotaWeekStart } from './quotaSchedule';

/** A member paired with what the current period knows about it. */
export interface RotationMember {
  item: RotationItem;
  /** When it was logged in the current period, or null if it hasn't been. */
  doneAt: string | null;
  /** When it was last logged in any period, or null if never. */
  lastDoneAt: string | null;
}

/** Anything carrying a rotation — a `Task`, or a draft on its way to being one. */
export interface RotationCarrier {
  rotationEnabled?: boolean;
  rotationItems?: RotationItem[];
  rotationLog?: RotationLogEntry[];
  rotationPeriodStart?: string | null;
  rotationLastDone?: Record<string, string>;
}

/**
 * A set of one is not a rotation — the same floor `activeChainStep` puts under
 * a chain, and for the same reason: with one member there is nothing to ask,
 * so the picker would be a sheet with a single button and the row would be
 * claiming a choice it doesn't have.
 */
export const MIN_ROTATION_ITEMS = 2;

/**
 * Whether this behaves as a rotation — both the flag and the floor, exactly as
 * `activeChainStep` demands `chainEnabled && items.length > 1`.
 *
 * The flag alone is the editor's question (`taskKindOf`), because a set is
 * empty for as long as it takes to type into it. This is every other reader's
 * question, and it is the stricter one: a stored row carrying the flag with
 * one member — from a template, an import, or a sync — must not draw a picker
 * with a single button in it.
 */
export function isRotationTask(task: RotationCarrier): boolean {
  return task.rotationEnabled === true
    && (task.rotationItems?.length ?? 0) >= MIN_ROTATION_ITEMS;
}

/** Normalizes stored JSON; anything unrecognisable becomes an empty set. */
export function parseRotationItems(raw: unknown): RotationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter(c => typeof c.id === 'string' && typeof c.title === 'string')
    .map(c => ({
      id: c.id as string,
      title: c.title as string,
      linkUrl: typeof c.linkUrl === 'string' && c.linkUrl ? (c.linkUrl as string) : null,
    }));
}

export function parseRotationLog(raw: unknown): RotationLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter(c => typeof c.itemId === 'string' && typeof c.at === 'string')
    .map(c => ({ itemId: c.itemId as string, at: c.at as string }));
}

export function parseRotationLastDone(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

/**
 * The opening instant of the period a rotation counts across.
 *
 * Weekly is the only span a rotation has today, and deliberately so: a set of
 * named things you work through is a week-shaped idea, and `quotaPeriod: 'day'`
 * paired with a five-member set would mean all five every day, which is five
 * tasks rather than a rotation. If a daily rotation ever earns its keep this is
 * the one function that has to learn about `task.quotaPeriod`.
 */
export function rotationPeriodStart(dayStart: Date, weekStartsOn: 0 | 1): Date {
  return quotaWeekStart(dayStart, weekStartsOn);
}

/**
 * The ledger, but only if it belongs to the period being asked about.
 *
 * This is rule 1 above. Returning `[]` for a stale stamp — rather than
 * clearing the column — is what keeps the reset free: nothing has to run at a
 * week boundary for the week to be clean.
 */
export function activeRotationLog(
  task: RotationCarrier,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): RotationLogEntry[] {
  const log = task.rotationLog ?? [];
  if (!log.length) return [];
  const stamp = task.rotationPeriodStart;
  if (!stamp) return [];
  const stamped = new Date(stamp);
  if (Number.isNaN(+stamped)) return [];
  const current = rotationPeriodStart(dayStart, weekStartsOn);
  // Whole-period equality rather than a range test: a stamp is always written
  // as a period start, so two of them agree exactly or name different periods.
  return +rotationPeriodStart(stamped, weekStartsOn) === +current ? log : [];
}

/**
 * Every member, in the user's own order, with what this period knows about it.
 *
 * Order is never re-ranked — not by how long it's been, not by what's left.
 * A set someone arranged by how much they like each option should stay
 * arranged that way, and a picker that re-sorts itself as you use it is one
 * you can't learn. Callers that want the outstanding ones first filter this
 * rather than sorting it.
 */
export function rotationMembers(
  task: RotationCarrier,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): RotationMember[] {
  const log = activeRotationLog(task, dayStart, weekStartsOn);
  const lastDone = task.rotationLastDone ?? {};
  return (task.rotationItems ?? []).map(item => ({
    item,
    doneAt: log.find(e => e.itemId === item.id)?.at ?? null,
    lastDoneAt: lastDone[item.id] ?? null,
  }));
}

/** The members still outstanding this period, in the set's own order. */
export function rotationRemaining(
  task: RotationCarrier,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): RotationItem[] {
  return rotationMembers(task, dayStart, weekStartsOn)
    .filter(m => m.doneAt === null)
    .map(m => m.item);
}

/**
 * How many distinct members have been logged this period.
 *
 * Distinct, because a member may be logged again after it's already down (the
 * picker allows it — listening to Spanish twice is a real thing to do and
 * refusing to record it would be the app arguing with you). A repeat is a real
 * log entry and a real `lastDoneAt` bump; what it is not is progress against
 * the week, because the week is about coverage.
 */
export function rotationDoneCount(
  task: RotationCarrier,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): number {
  const log = activeRotationLog(task, dayStart, weekStartsOn);
  return new Set(log.map(e => e.itemId)).size;
}

/**
 * Whether logging `itemId` would newly cover a member — i.e. whether it should
 * move `progressCount`. False for a repeat, which still logs.
 */
export function rotationCoversNew(
  task: RotationCarrier,
  itemId: string,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): boolean {
  if (!(task.rotationItems ?? []).some(i => i.id === itemId)) return false;
  return !activeRotationLog(task, dayStart, weekStartsOn).some(e => e.itemId === itemId);
}

/**
 * Whole logical days left in the period, counting today as one.
 *
 * Used for the "3 left, 2 days" line, which is the whole reason a rotation is
 * worth more than a plain weekly quota on a busy week: it is the one moment the
 * app can say the week no longer fits, while there is still a week left to do
 * something about it.
 */
export function rotationDaysLeft(dayStart: Date, weekStartsOn: 0 | 1): number {
  const start = rotationPeriodStart(dayStart, weekStartsOn);
  const elapsedDays = Math.round((+dayStart - +start) / 86400000);
  return Math.max(0, 7 - elapsedDays);
}

/**
 * True when what's outstanding no longer fits in the days left.
 *
 * Deliberately not "behind the pace ramp" — that is already drawn, as the gap
 * between the meter's fill and its pace mark, and saying it twice in two
 * visual languages is noise. This is the stronger, discrete claim the ramp
 * can't make: one per day from here is no longer enough.
 */
export function rotationOverCommitted(
  task: RotationCarrier,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): boolean {
  if (!isRotationTask(task)) return false;
  const remaining = rotationRemaining(task, dayStart, weekStartsOn).length;
  if (remaining === 0) return false;
  return remaining > rotationDaysLeft(dayStart, weekStartsOn);
}

/**
 * The row's secondary line: "3 left · 4 days", or null once the set is covered.
 *
 * Null rather than "all done" because the row carries a meter that is already
 * full and a count chip that already reads 5/5; a third element saying the same
 * thing is what makes a row feel crowded.
 */
export function rotationSummary(
  task: RotationCarrier,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): string | null {
  if (!isRotationTask(task)) return null;
  const remaining = rotationRemaining(task, dayStart, weekStartsOn).length;
  if (remaining === 0) return null;
  const days = rotationDaysLeft(dayStart, weekStartsOn);
  return `${remaining} left · ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Applies a pick to a task's rotation state, returning only the fields that
 * change. The caller writes them; this decides them.
 *
 * It rewrites `rotationPeriodStart` and drops a stale ledger on the way
 * through, so the first log of a new week starts the week rather than extending
 * the last one. That makes this the *write*-side half of rule 1, with
 * `activeRotationLog` as the read side — both consult the period, so neither
 * can hand the other a ledger from the wrong one.
 */
export function rotationPick(
  task: RotationCarrier,
  itemId: string,
  at: Date,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): Pick<Task, 'rotationLog' | 'rotationPeriodStart' | 'rotationLastDone'> | null {
  if (!(task.rotationItems ?? []).some(i => i.id === itemId)) return null;
  const current = rotationPeriodStart(dayStart, weekStartsOn);
  const log = activeRotationLog(task, dayStart, weekStartsOn);
  return {
    rotationLog: [...log, { itemId, at: at.toISOString() }],
    rotationPeriodStart: current.toISOString(),
    rotationLastDone: { ...(task.rotationLastDone ?? {}), [itemId]: at.toISOString() },
  };
}

/**
 * Takes the most recent pick back — the long-press undo the quota meter
 * already offers.
 *
 * `rotationLastDone` is deliberately *not* rewound. It records that the member
 * was done at some point, which a mis-tap an instant ago doesn't really
 * falsify, and restoring the previous value would mean keeping a history per
 * member to restore it from. Same shrug `undoSlip` takes about not refunding.
 */
export function rotationUnpick(
  task: RotationCarrier,
  dayStart: Date,
  weekStartsOn: 0 | 1,
): Pick<Task, 'rotationLog' | 'rotationPeriodStart'> | null {
  const log = activeRotationLog(task, dayStart, weekStartsOn);
  if (!log.length) return null;
  return {
    rotationLog: log.slice(0, -1),
    rotationPeriodStart: task.rotationPeriodStart ?? null,
  };
}

/**
 * How long ago a member was last logged, said plainly: "Yesterday", "4 days
 * ago", "3 weeks ago". Null when it has never been logged.
 *
 * Null rather than "Never" because the picker draws nothing for a null, and a
 * member you have not got to yet should look like a plain option rather than
 * wear a mark for it. The first week of a new rotation would otherwise be five
 * rows all reproaching you.
 *
 * Coarse on purpose past a week. The number is there to break a tie between
 * two members you are equally indifferent to, and "3 weeks ago" does that as
 * well as "23 days ago" while reading as a fact rather than a tally.
 */
export function rotationLastDoneLabel(lastDoneAt: string | null, dayStart: Date): string | null {
  if (!lastDoneAt) return null;
  const then = new Date(lastDoneAt);
  if (Number.isNaN(+then)) return null;
  const days = Math.floor((+dayStart - +then) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  // Rounded, not floored. Flooring called 13 days "Last week", which is a
  // fortnight said as though it were a few days — the one direction this line
  // must not err in, since its whole job is to show up a member you have been
  // skipping.
  const weeks = Math.round(days / 7);
  if (weeks === 1) return 'Last week';
  // Nine weeks rather than four: a rotation member skipped for a month is
  // still a number of weeks you can hold in your head, and "2 months ago"
  // said of 35 days would be wrong as well as vaguer.
  if (weeks < 9) return `${weeks} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
