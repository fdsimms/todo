import type { MeterReading, Task } from '../types';
import { addDays } from 'date-fns/addDays';
import { addMonths } from 'date-fns/addMonths';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';

/**
 * A task due at a reading rather than a date: "change the oil every 5,000
 * miles", "descale after 200 shots", "service the mower every 50 hours".
 * Store-free, like `weatherWait.ts`: this module decides, and
 * `applyMeterHolds` in `useTaskStore.ts` writes. See `docs/arch/meters.md`.
 *
 * **The task's own `deferUntil` is the hold.** Nothing in the visibility rules
 * knows about meters, exactly as nothing there knows about weather: hiding a
 * task until a day is what a defer already is, so Today, Later, the month grid
 * and Look ahead all place a held meter task with no new code.
 *
 * **Three things can end the hold, and the earliest wins.**
 *
 * 1. A logged reading at or past `meterDueAt`. The only one that is a fact.
 * 2. The day the reading rate projects the meter to get there. An estimate,
 *    and the row says so ("est. Nov 3"), but it is the answer to the failure
 *    every usage tracker dies of: nobody logs the reading. Surfacing on the
 *    estimate is the prompt to go and look, and logging a lower reading than
 *    the threshold sends the task straight back to Later on a fresh estimate.
 * 3. `meterLimitMonths` after the task was made: "5,000 miles or 6 months,
 *    whichever comes first", which is how a service interval is written.
 *
 * With none of the three to go on (one reading or none, and no time limit)
 * the task surfaces `METER_CHECK_IN_DAYS` after the last reading so the meter
 * gets read, rather than staying hidden for ever on no information.
 */

// The two day-key helpers from dateUtils, restated: that module reads the
// settings store, which the MCP package can't load, and this one is shared
// with it (mcp/src/taskFields.ts, meterTools.ts). Same keys, local not UTC.
const dayKeyOf = (date: Date) => format(date, 'yyyy-MM-dd');
const dayKeyToDate = (key: string) => new Date(`${key}T00:00:00`);

/** How long a meter task with nothing to estimate from stays held before it asks for a reading. */
export const METER_CHECK_IN_DAYS = 30;

/**
 * The shortest span a rate is measured over. Two readings a day apart say
 * almost nothing about a car's monthly mileage, and a rate read off them would
 * swing the estimate by weeks.
 */
export const METER_RATE_MIN_DAYS = 7;

/** How far back readings count toward a rate: last year's driving says little about this month's. */
export const METER_RATE_WINDOW_DAYS = 365;

/** Longest meter name kept: "Car", "Espresso machine", not a sentence. */
export const METER_NAME_MAX_LENGTH = 40;

/** The key a reading is filed under: trimmed and lowercased, so "Car" and "car " are one meter. */
export function meterKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Whether a task may follow a meter. Only a plain one-off: a repeating task
 * already has a schedule saying when it is next due, a chain step or series
 * member is placed by its chain or set, and a task waiting on weather has
 * handed its `deferUntil` to a different pass. Two passes owning one field
 * would undo each other on every refresh.
 */
export function canFollowMeter(
  task: Pick<Task, 'recurrenceType' | 'chainEnabled'> &
    Partial<Pick<Task, 'seriesId' | 'parentId' | 'weatherWait' | 'polarity'>>,
): boolean {
  return task.recurrenceType === 'none' && !task.chainEnabled && !task.seriesId && !task.parentId
    && !task.weatherWait && task.polarity !== 'negative';
}

type MeterFields = Required<Pick<Task, 'meterName' | 'meterUnit' | 'meterEvery' | 'meterDueAt' | 'meterLimitMonths'>>;

/** Whether a task follows a meter at all: a name, a positive interval and a reading to be due at. */
export function hasMeter(task: Partial<MeterFields>): boolean {
  return !!task.meterName?.trim()
    && typeof task.meterEvery === 'number' && task.meterEvery > 0
    && typeof task.meterDueAt === 'number' && Number.isFinite(task.meterDueAt);
}

/** The fields a task without a meter carries, for clearing one off. */
export const NO_METER: MeterFields = {
  meterName: null, meterUnit: null, meterEvery: null, meterDueAt: null, meterLimitMonths: null,
};

/** One meter's readings, oldest first. */
export function readingsFor(readings: readonly MeterReading[], name: string): MeterReading[] {
  const key = meterKey(name);
  return readings
    .filter(r => r.meterKey === key)
    .sort((a, b) => (a.readAt < b.readAt ? -1 : a.readAt > b.readAt ? 1 : 0));
}

/** The most recent reading of a meter, or null if it has never been read. */
export function latestReading(readings: readonly MeterReading[], name: string): MeterReading | null {
  const own = readingsFor(readings, name);
  return own.length ? own[own.length - 1] : null;
}

/**
 * How fast the meter runs, per day, or null when the readings can't say.
 *
 * Measured from the latest reading back to the earliest one in the last year
 * that is at least `METER_RATE_MIN_DAYS` older. A meter that went down (a
 * replaced odometer, a typo) or didn't move has no rate to project with, and
 * null is the honest answer: the task falls back to its time limit or a
 * check-in rather than an estimate built on nonsense.
 */
export function meterRatePerDay(readings: readonly MeterReading[], name: string): number | null {
  const own = readingsFor(readings, name);
  if (own.length < 2) return null;
  const latest = own[own.length - 1];
  const latestAt = new Date(latest.readAt);
  const earliestAllowed = addDays(latestAt, -METER_RATE_WINDOW_DAYS);
  const base = own.find(r => {
    const at = new Date(r.readAt);
    return at >= earliestAllowed && differenceInCalendarDays(latestAt, at) >= METER_RATE_MIN_DAYS;
  });
  if (!base) return null;
  const days = differenceInCalendarDays(latestAt, new Date(base.readAt));
  const rate = (latest.value - base.value) / days;
  return rate > 0 ? rate : null;
}

/** The day key the rate says the meter reaches `meterDueAt` on, or null without a rate. */
export function projectedMeterDay(
  task: Partial<MeterFields>,
  readings: readonly MeterReading[],
): string | null {
  if (!hasMeter(task)) return null;
  const latest = latestReading(readings, task.meterName!);
  const rate = meterRatePerDay(readings, task.meterName!);
  if (!latest || rate === null) return null;
  const remaining = task.meterDueAt! - latest.value;
  const days = remaining <= 0 ? 0 : Math.ceil(remaining / rate);
  return dayKeyOf(addDays(new Date(latest.readAt), days));
}

/** The day the time limit runs out, counted from when the task was made, or null with no limit. */
export function meterLimitDay(task: Partial<MeterFields> & Pick<Task, 'createdAt'>): string | null {
  const months = task.meterLimitMonths;
  if (typeof months !== 'number' || months <= 0) return null;
  return dayKeyOf(addMonths(new Date(task.createdAt), months));
}

/** Why a meter task is on Today, or why it is waiting. */
export type MeterHoldReason = 'reached' | 'projected' | 'limit' | 'checkIn';

/**
 * A meter set up with no reading to be due at yet (quick add on a meter never
 * read, or the editor left "Next due at" empty): a name and an interval, and
 * nothing for the hold to measure against.
 */
export function meterAwaitingStart(task: Partial<MeterFields>): boolean {
  return !!task.meterName?.trim() && typeof task.meterEvery === 'number' && task.meterEvery > 0
    && (task.meterDueAt === null || task.meterDueAt === undefined);
}

/**
 * The due reading for a meter awaiting its start, once the meter has one: the
 * latest reading plus the interval, the same rule the editor applies to an
 * empty "Next due at". Null while the meter has never been read.
 */
export function meterStartPatch(
  task: Partial<MeterFields>,
  readings: readonly MeterReading[],
): Pick<Task, 'meterDueAt'> | null {
  if (!meterAwaitingStart(task)) return null;
  const latest = latestReading(readings, task.meterName!);
  return latest ? { meterDueAt: latest.value + task.meterEvery! } : null;
}

/** What the meter pass should do with one task. */
export type MeterHoldDecision =
  | { kind: 'none' }
  /** Due now: surface it on Today. */
  | { kind: 'release'; reason: MeterHoldReason }
  /** Hold until `dayKey`, which is the earliest of the estimate, the limit and the check-in. */
  | { kind: 'defer'; dayKey: string; reason: Exclude<MeterHoldReason, 'reached'> };

/**
 * Decides one task against its meter's readings. `todayKey` is the logical day.
 * A hold whose day has already arrived is a release, so a task surfaced on its
 * estimate stays on Today until a reading says otherwise.
 */
export function decideMeterHold(
  task: Partial<MeterFields> & Pick<Task, 'createdAt' | 'completed' | 'archived'> & Parameters<typeof canFollowMeter>[0],
  readings: readonly MeterReading[],
  todayKey: string,
): MeterHoldDecision {
  if (task.completed || task.archived || !hasMeter(task) || !canFollowMeter(task)) return { kind: 'none' };
  const latest = latestReading(readings, task.meterName!);
  if (latest && latest.value >= task.meterDueAt!) return { kind: 'release', reason: 'reached' };

  const candidates: { dayKey: string; reason: Exclude<MeterHoldReason, 'reached'> }[] = [];
  const projected = projectedMeterDay(task, readings);
  if (projected) candidates.push({ dayKey: projected, reason: 'projected' });
  const limit = meterLimitDay(task);
  if (limit) candidates.push({ dayKey: limit, reason: 'limit' });
  if (!candidates.length) {
    const from = latest ? new Date(latest.readAt) : new Date(task.createdAt);
    candidates.push({ dayKey: dayKeyOf(addDays(from, METER_CHECK_IN_DAYS)), reason: 'checkIn' });
  }
  const earliest = candidates.reduce((a, b) => (b.dayKey < a.dayKey ? b : a));
  if (earliest.dayKey <= todayKey) return { kind: 'release', reason: earliest.reason };
  return { kind: 'defer', dayKey: earliest.dayKey, reason: earliest.reason };
}

/**
 * The write a decision comes to, or null when there is nothing to change.
 *
 * **The pass only moves a hold it wrote itself.** `meterHeldUntil` is the day
 * it last wrote into `deferUntil`, and a future defer that doesn't match is the
 * user's own snooze: a surfaced oil change pushed to Saturday must not bounce
 * back to Today on the next pass. A defer that has already passed is nobody's
 * hold any more and is taken over.
 *
 * A release writes today rather than clearing the date. A meter task has no
 * due date of its own, and one with no date signal at all would land in
 * Unscheduled instead of on Today.
 */
export function meterHoldPatch(
  task: Pick<Task, 'deferUntil'> & Partial<Pick<Task, 'meterHeldUntil'>>,
  decision: MeterHoldDecision,
  todayKey: string,
): Pick<Task, 'deferUntil' | 'meterHeldUntil'> | null {
  if (decision.kind === 'none') return null;
  const deferKey = task.deferUntil ? dayKeyOf(new Date(task.deferUntil)) : null;
  const ours = deferKey !== null && deferKey === (task.meterHeldUntil ?? null);
  if (deferKey !== null && deferKey > todayKey && !ours) return null;
  if (decision.kind === 'release') {
    if (deferKey !== null && deferKey <= todayKey) return null;
    return { deferUntil: dayKeyToDate(todayKey).toISOString(), meterHeldUntil: todayKey };
  }
  if (ours && deferKey === decision.dayKey) return null;
  return { deferUntil: dayKeyToDate(decision.dayKey).toISOString(), meterHeldUntil: decision.dayKey };
}

/**
 * The reading the next occurrence is due at, once this one is completed.
 *
 * Counted from a reading logged on the day it was done, when there is one:
 * that is the odometer at the oil change, which is exactly where the next
 * 5,000 miles start. Otherwise from where this one was due, or from the latest
 * reading if the meter had already run past that, so doing it late doesn't
 * bring the next one due early. Never from an estimate.
 */
export function nextMeterDueAt(
  task: Partial<MeterFields>,
  readings: readonly MeterReading[],
  completedDayKey: string,
): number | null {
  if (!hasMeter(task)) return null;
  const own = readingsFor(readings, task.meterName!);
  const sameDay = own.filter(r => dayKeyOf(new Date(r.readAt)) === completedDayKey);
  const latest = own.length ? own[own.length - 1].value : null;
  const baseline = sameDay.length
    ? sameDay[sameDay.length - 1].value
    : Math.max(task.meterDueAt!, latest ?? -Infinity);
  return baseline + task.meterEvery!;
}

/** "45,000" or "1,234.5": a reading as the row and the editor print it. */
export function formatMeterValue(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** "45,000 miles", or the bare number with no unit. */
export function formatMeterAmount(value: number, unit: string | null | undefined): string {
  const u = unit?.trim();
  return u ? `${formatMeterValue(value)} ${u}` : formatMeterValue(value);
}

/**
 * Reads a typed reading: "45,120", "45120", "1234.5". Null for anything that
 * isn't a non-negative number, so a stray letter is refused rather than read
 * as zero.
 */
export function parseMeterNumber(text: string): number | null {
  const clean = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/**
 * The row's chip: "Due at 45,000 miles", then what the app knows about when.
 * "· now 45,120" once a reading has reached it, "· est. Nov 3" from the rate,
 * and "· log a reading" when the meter has never been read (or, with no due
 * reading yet, "Every 5,000 miles · log a reading"). Null on a task with no
 * meter.
 */
export function meterChipText(
  task: Partial<MeterFields>,
  readings: readonly MeterReading[],
): string | null {
  if (meterAwaitingStart(task)) return `Every ${formatMeterAmount(task.meterEvery!, task.meterUnit)} · log a reading`;
  if (!hasMeter(task)) return null;
  const head = `Due at ${formatMeterAmount(task.meterDueAt!, task.meterUnit)}`;
  const latest = latestReading(readings, task.meterName!);
  if (!latest) return `${head} · log a reading`;
  if (latest.value >= task.meterDueAt!) return `${head} · now ${formatMeterValue(latest.value)}`;
  const projected = projectedMeterDay(task, readings);
  if (projected) return `${head} · est. ${format(dayKeyToDate(projected), 'MMM d')}`;
  return head;
}

/** "Last read 44,120 miles on Oct 2", for the editor and the log sheet. Null if never read. */
export function describeLatestReading(
  readings: readonly MeterReading[],
  name: string,
  unit: string | null | undefined,
): string | null {
  const latest = latestReading(readings, name);
  if (!latest) return null;
  return `Last read ${formatMeterAmount(latest.value, unit)} on ${format(new Date(latest.readAt), 'MMM d')}`;
}

/** Every meter name readings exist for, as most recently typed, newest-read first. */
export function knownMeterNames(readings: readonly MeterReading[]): string[] {
  const byKey = new Map<string, { name: string; at: string }>();
  for (const r of readings) {
    const seen = byKey.get(r.meterKey);
    if (!seen || r.readAt >= seen.at) byKey.set(r.meterKey, { name: r.meterName, at: r.readAt });
  }
  return [...byKey.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map(v => v.name);
}

/** What the editor holds while a meter is being set up: typed text, so a half-typed "45,0" isn't snapped to a value. */
export interface MeterInput {
  name: string;
  unit: string;
  everyText: string;
  dueText: string;
  limitMonths: number | null;
}

/** A task's meter as the editor shows it. */
export function meterInputFromTask(task: Partial<MeterFields> | null | undefined): MeterInput {
  return {
    name: task?.meterName ?? '',
    unit: task?.meterUnit ?? '',
    everyText: typeof task?.meterEvery === 'number' ? formatMeterValue(task.meterEvery) : '',
    dueText: typeof task?.meterDueAt === 'number' ? formatMeterValue(task.meterDueAt) : '',
    limitMonths: task?.meterLimitMonths ?? null,
  };
}

/**
 * The fields the editor saves. A blank name means no meter at all. With a
 * name, everything typed is kept as typed, even when it isn't enough to hold
 * the task yet: a missing "due at" is filled from the latest reading plus the
 * interval when there is one, and otherwise left empty for `meterSetupGap` to
 * say so, never silently dropped.
 */
export function meterFieldsFromInput(input: MeterInput, readings: readonly MeterReading[]): MeterFields {
  const name = input.name.trim().slice(0, METER_NAME_MAX_LENGTH);
  if (!name) return { ...NO_METER };
  const every = parseMeterNumber(input.everyText);
  const typedDue = parseMeterNumber(input.dueText);
  const latest = latestReading(readings, name);
  return {
    meterName: name,
    meterUnit: input.unit.trim() || null,
    meterEvery: every !== null && every > 0 ? every : null,
    meterDueAt: typedDue ?? (latest && every ? latest.value + every : null),
    meterLimitMonths: input.limitMonths !== null && input.limitMonths > 0 ? input.limitMonths : null,
  };
}

/**
 * What a named meter still needs before it can hold a task, in words for the
 * editor, or null once it is complete. Shown rather than enforced: the fields
 * save as typed, and the task stays an ordinary one until this is answered.
 */
export function meterSetupGap(fields: MeterFields): string | null {
  if (!fields.meterName) return null;
  if (fields.meterEvery === null) return 'Enter how far the meter runs between times.';
  if (fields.meterDueAt === null) return 'Enter the reading it is next due at, or log the meter’s current reading.';
  return null;
}

/** One meter as the Meters screen lists it. */
export interface MeterOverview {
  key: string;
  /** As most recently typed, by a reading or a task. */
  name: string;
  /** From the first open task on it that names one: readings carry no unit. */
  unit: string | null;
  /** Newest first. */
  readings: MeterReading[];
  ratePerDay: number | null;
  /** Open, unarchived tasks following it. */
  tasks: Task[];
}

/**
 * Every meter there is: the ones with readings and the ones only a task names
 * so far. Most recently read first, then the unread ones by name, so the
 * screen opens on the meter somebody is actually reading.
 */
export function meterOverview(readings: readonly MeterReading[], tasks: readonly Task[]): MeterOverview[] {
  const open = tasks.filter(t => t.meterName?.trim() && !t.completed && !t.archived && !t.parentId);
  const names = new Map<string, string>();
  for (const name of knownMeterNames(readings)) names.set(meterKey(name), name.trim());
  for (const t of open) if (!names.has(meterKey(t.meterName!))) names.set(meterKey(t.meterName!), t.meterName!.trim());
  return [...names.entries()]
    .map(([key, name]) => {
      const own = readingsFor(readings, name).reverse();
      const onIt = open.filter(t => meterKey(t.meterName!) === key);
      return {
        key,
        name,
        unit: onIt.find(t => t.meterUnit?.trim())?.meterUnit?.trim() ?? null,
        readings: own,
        ratePerDay: meterRatePerDay(readings, name),
        tasks: onIt,
      };
    })
    .sort((a, b) => {
      const at = a.readings[0]?.readAt ?? '';
      const bt = b.readings[0]?.readAt ?? '';
      if (at !== bt) return at < bt ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * "About 50 miles a day", or a week's worth when a day's is under one ("About
 * 6 shots a week"). Rounded, because the rate is two readings' worth of
 * arithmetic and a decimal would claim more than that.
 */
export function describeMeterRate(ratePerDay: number, unit: string | null | undefined): string {
  const u = unit?.trim();
  if (ratePerDay >= 1) return `About ${formatMeterValue(Math.round(ratePerDay))}${u ? ` ${u}` : ''} a day`;
  const perWeek = Math.max(1, Math.round(ratePerDay * 7));
  return `About ${formatMeterValue(perWeek)}${u ? ` ${u}` : ''} a week`;
}
