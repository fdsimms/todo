import { format } from 'date-fns/format';
import { logicalDayStart } from './clockTime';

/**
 * Daily phone use, for Mood Insights. Pure, like `screenTimeRules.ts` beside it.
 *
 * **The app can't read usage minutes, so this builds an approximation out of
 * what it can read.** iOS gives usage numbers only to a sandboxed report
 * extension that has no route back to the app (see the monitor extension's
 * header). What the monitor extension *can* report is that a threshold was
 * crossed. So the app arms a ladder of thresholds over everything the person
 * chose to count, one every `USAGE_STEP_MINUTES`, and a day's reading is the
 * highest rung that fired. A day reads 0 until the first rung, 30 after it,
 * and so on: a floor, never a measurement, which is why the screen says "in 30
 * minute steps" and why an insight is phrased "over 4 hours", never "4h 12m".
 *
 * The rungs ride the existing rule and crossing pipeline (`startMonitoring`,
 * `drainCrossings`) under rule ids prefixed `usage:`, so `checkScreenTimeTasks`
 * must never see one: `useScreenTimeStore.refresh` splits them off first.
 *
 * **A day with no row is absent, not zero** (rule 3 of `moodInsights.ts`). A day
 * only gets a row when the monitor was armed on it, so a day the app never
 * watched stays unknown rather than reading as a day of no use.
 */

/** The reserved app group id the person's "count everything" selection is saved under. */
export const USAGE_GROUP_ID = 'usage';

/** The gap between rungs. Coarser than Apple's finest threshold on purpose: the ladder arms one event per rung. */
export const USAGE_STEP_MINUTES = 30;

/** The top rung, ten hours. Use past it reads as the top rung rather than arming a rung nobody reaches. */
export const USAGE_MAX_MINUTES = 600;

const RULE_PREFIX = 'usage:';

/** One reading: the highest rung reached on a logical day. */
export interface ScreenTimeDay {
  dayKey: string;
  minutes: number;
}

/** A rung as `startMonitoring` takes it. */
export interface UsageRung {
  id: string;
  thresholdMinutes: number;
  groupId: string;
  includesPastActivity: true;
}

/** Every rung, lowest first: 30, 60, ... up to `USAGE_MAX_MINUTES`. */
export function usageRungs(): UsageRung[] {
  const rungs: UsageRung[] = [];
  for (let minutes = USAGE_STEP_MINUTES; minutes <= USAGE_MAX_MINUTES; minutes += USAGE_STEP_MINUTES) {
    rungs.push({ id: `${RULE_PREFIX}${minutes}`, thresholdMinutes: minutes, groupId: USAGE_GROUP_ID, includesPastActivity: true });
  }
  return rungs;
}

/** Whether a crossing's rule id is a rung rather than one of the person's rules. */
export function isUsageRuleId(ruleId: string): boolean {
  return usageRuleMinutes(ruleId) !== null;
}

/** The minutes a rung stands for, or null when `ruleId` isn't one. */
export function usageRuleMinutes(ruleId: string): number | null {
  if (!ruleId.startsWith(RULE_PREFIX)) return null;
  const text = ruleId.slice(RULE_PREFIX.length);
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  return minutes > 0 ? minutes : null;
}

/** A crossing as `drainCrossings` returns it. */
export interface UsageCrossingInput {
  ruleId: string;
  dayKey: string;
  /** When the extension was woken, seconds since 1970. Absent from an older build's crossing. */
  atSeconds?: number;
}

/**
 * The logical day a crossing belongs to.
 *
 * From the instant the extension was woken when it recorded one, since the
 * stamped `dayKey` is only the day the app last armed the monitor and goes
 * stale when the app isn't opened for a while. The stamp is the fallback for a
 * crossing an older build recorded, which is the best that crossing offers.
 */
export function usageCrossingDay(crossing: UsageCrossingInput, dayResetTime: string): string {
  if (typeof crossing.atSeconds === 'number' && Number.isFinite(crossing.atSeconds)) {
    // `clockTime`, not `dateUtils`: that one reaches the settings store, and this
    // module stays store-free so its tests don't load the database.
    return format(logicalDayStart(new Date(crossing.atSeconds * 1000), dayResetTime), 'yyyy-MM-dd');
  }
  return crossing.dayKey;
}

/**
 * Raise each day's reading to the highest rung in `crossings`.
 *
 * Returns only the days that changed, so the caller writes what moved. A rung
 * can only raise a reading: a crossing for 60 minutes arriving after one for 90
 * leaves 90, which is what makes a duplicate or a late drain harmless. Rules
 * that aren't rungs are ignored.
 */
export function raisedUsageDays(
  current: ReadonlyMap<string, number>,
  crossings: readonly UsageCrossingInput[],
  dayResetTime: string,
): ScreenTimeDay[] {
  const next = new Map(current);
  const changed = new Set<string>();
  for (const crossing of crossings) {
    const minutes = usageRuleMinutes(crossing.ruleId);
    if (minutes === null) continue;
    const dayKey = usageCrossingDay(crossing, dayResetTime);
    if ((next.get(dayKey) ?? -1) >= minutes) continue;
    next.set(dayKey, minutes);
    changed.add(dayKey);
  }
  return [...changed].sort().map(dayKey => ({ dayKey, minutes: next.get(dayKey) as number }));
}

/** The rungs the monitor was armed with, as a string that changes only when arming again would change something. */
export function usageArmSignature(dayKey: string, rungs: readonly UsageRung[]): string {
  return `${dayKey}|${rungs.map(r => r.id).join(',')}`;
}

/** Hours as the screen says them: 4, 2.5, 10. */
export function usageHoursLabel(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}
