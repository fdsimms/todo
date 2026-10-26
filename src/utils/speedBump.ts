import type { SpeedBumpRule } from '../types';
import { generateId } from './id';
import { DEFAULT_GROUP_ID } from './appGroups';
import { describeDuration, MIN_MANUAL_MINUTES } from './manualBlock';
import { SCREEN_TIME_THRESHOLD_MAX, SCREEN_TIME_THRESHOLD_MIN } from './screenTimeRules';

/**
 * Speed bumps: "after 45 minutes on Social today, block Games for 15".
 *
 * A short block the monitor extension raises by itself when a usage threshold
 * is crossed, store-free like `screenTimeRules.ts` beside it. It shares that
 * file's limit: the app cannot see usage, only be told "this threshold was
 * crossed", so everything here is about what to arm and what to do on the way
 * back. See `docs/arch/nfc-key.md`, "Speed bumps".
 *
 * - **It repeats by arming a ladder.** iOS fires each event once per monitoring
 *   interval, so "every 30 minutes, up to 4 times" is four events at 30, 60, 90
 *   and 120 cumulative minutes, not one event armed again. Time spent while the
 *   group is blocked does not count (the apps cannot be used), so the rungs
 *   measure use, not the clock.
 * - **The extension owns the block.** The app is usually closed when a
 *   threshold is crossed, so the extension writes the live block to the App
 *   Group, raises the shield and arms the window that lifts it. The app only
 *   reads that record back (`liveSpeedBump`) and treats it as one more reason
 *   for the shield; it never starts one.
 * - **It counts one group and blocks another.** `groupId` is what is timed,
 *   `blockGroupId` what is blocked, and a missing block group means the timed
 *   one.
 */

export const SPEED_BUMP_TITLE_MAX_LENGTH = 60;

/** The block cannot be shorter than iOS's quarter-hour floor on a monitored interval. */
export const SPEED_BUMP_BLOCK_MIN = MIN_MANUAL_MINUTES;
export const SPEED_BUMP_BLOCK_MAX = 120;
export const SPEED_BUMP_BLOCK_DEFAULT = 15;
/** What the sheet offers for the block's length, in minutes. */
export const SPEED_BUMP_BLOCK_CHOICES: readonly number[] = [15, 30, 45, 60, 120];

export const SPEED_BUMP_THRESHOLD_DEFAULT = 45;

/**
 * How many times a rule can fire in a day. Every rung is a separate event armed
 * with iOS, and how many events one monitor accepts is not documented, so the
 * ceiling stays small until a device shows more works.
 */
export const SPEED_BUMP_TIMES_MIN = 1;
export const SPEED_BUMP_TIMES_MAX = 6;
export const SPEED_BUMP_REPEAT_MIN = 15;
export const SPEED_BUMP_REPEAT_MAX = 240;
export const SPEED_BUMP_REPEAT_DEFAULT = 30;

export function clampBumpThreshold(minutes: number): number {
  if (!Number.isFinite(minutes)) return SPEED_BUMP_THRESHOLD_DEFAULT;
  return Math.min(SCREEN_TIME_THRESHOLD_MAX, Math.max(SCREEN_TIME_THRESHOLD_MIN, Math.round(minutes)));
}

export function clampBumpBlockMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return SPEED_BUMP_BLOCK_DEFAULT;
  return Math.min(SPEED_BUMP_BLOCK_MAX, Math.max(SPEED_BUMP_BLOCK_MIN, Math.round(minutes)));
}

export function clampBumpTimes(times: number): number {
  if (!Number.isFinite(times)) return SPEED_BUMP_TIMES_MIN;
  return Math.min(SPEED_BUMP_TIMES_MAX, Math.max(SPEED_BUMP_TIMES_MIN, Math.round(times)));
}

export function clampBumpRepeat(minutes: number): number {
  if (!Number.isFinite(minutes)) return SPEED_BUMP_REPEAT_DEFAULT;
  return Math.min(SPEED_BUMP_REPEAT_MAX, Math.max(SPEED_BUMP_REPEAT_MIN, Math.round(minutes)));
}

/** A rule as the sheet adds it: on, once a day, a quarter hour. */
export function newSpeedBumpRule(title: string, groupId?: string): SpeedBumpRule {
  return {
    id: generateId(),
    title: title.slice(0, SPEED_BUMP_TITLE_MAX_LENGTH),
    ...(groupId ? { groupId } : {}),
    thresholdMinutes: SPEED_BUMP_THRESHOLD_DEFAULT,
    blockMinutes: SPEED_BUMP_BLOCK_DEFAULT,
    repeatEveryMinutes: null,
    maxTimes: SPEED_BUMP_TIMES_MIN,
    enabled: true,
  };
}

/**
 * Read the stored list back, tolerantly: a malformed value reads as nothing
 * saved and a bad entry is dropped rather than discarding the list, the way
 * `parseScreenTimeRules` does.
 */
export function parseSpeedBumpRules(raw: string | null | undefined): SpeedBumpRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): SpeedBumpRule[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const rule = entry as Partial<SpeedBumpRule>;
    if (typeof rule.id !== 'string' || rule.id === '') return [];
    if (typeof rule.title !== 'string' || rule.title.trim() === '') return [];
    if (typeof rule.thresholdMinutes !== 'number' || typeof rule.blockMinutes !== 'number') return [];
    const repeats = typeof rule.repeatEveryMinutes === 'number' && rule.repeatEveryMinutes > 0;
    return [{
      id: rule.id,
      title: rule.title.slice(0, SPEED_BUMP_TITLE_MAX_LENGTH),
      ...(typeof rule.groupId === 'string' && rule.groupId !== '' ? { groupId: rule.groupId } : {}),
      ...(typeof rule.blockGroupId === 'string' && rule.blockGroupId !== '' ? { blockGroupId: rule.blockGroupId } : {}),
      thresholdMinutes: clampBumpThreshold(rule.thresholdMinutes),
      blockMinutes: clampBumpBlockMinutes(rule.blockMinutes),
      repeatEveryMinutes: repeats ? clampBumpRepeat(rule.repeatEveryMinutes as number) : null,
      maxTimes: repeats ? clampBumpTimes(typeof rule.maxTimes === 'number' ? rule.maxTimes : SPEED_BUMP_TIMES_MIN) : SPEED_BUMP_TIMES_MIN,
      enabled: rule.enabled !== false,
    }];
  });
}

export function serializeSpeedBumpRules(rules: readonly SpeedBumpRule[]): string {
  return JSON.stringify(rules);
}

/**
 * The cumulative minutes of use at which the rule fires, in order. A rule that
 * does not repeat has one. A rung past the longest threshold a rule can be
 * given is dropped: a day has no more use in it than that.
 */
export function speedBumpRungs(rule: Pick<SpeedBumpRule, 'thresholdMinutes' | 'repeatEveryMinutes' | 'maxTimes'>): number[] {
  const first = clampBumpThreshold(rule.thresholdMinutes);
  if (!rule.repeatEveryMinutes || rule.repeatEveryMinutes <= 0) return [first];
  const every = clampBumpRepeat(rule.repeatEveryMinutes);
  const rungs: number[] = [];
  for (let k = 0; k < clampBumpTimes(rule.maxTimes); k++) {
    const at = first + k * every;
    if (at > SCREEN_TIME_THRESHOLD_MAX) break;
    rungs.push(at);
  }
  return rungs;
}

/** One rule as the native side arms it. */
export interface NativeSpeedBump {
  id: string;
  /** The group whose use is timed. */
  groupId: string;
  /** Every group the block holds; a supergroup is already expanded. */
  blockGroupIds: string[];
  blockMinutes: number;
  /** Cumulative minutes of use that fire it. */
  rungs: number[];
}

/**
 * The rules to hand the OS: enabled ones, with both groups resolved. A disabled
 * rule is left out entirely rather than armed and ignored, because an event the
 * app would discard is still an event iOS wakes an extension for.
 */
export function armableSpeedBumps(
  rules: readonly SpeedBumpRule[],
  /** The rule's timed group, as a plain group that exists (`resolveGroupNow`); a missing group is Default. */
  resolveTimed: (groupId: string | undefined) => string = id => id ?? DEFAULT_GROUP_ID,
  /** The groups the block holds, supergroups expanded and a missing group Default. */
  resolveBlocked: (groupId: string | undefined) => string[] = id => [id ?? DEFAULT_GROUP_ID],
): NativeSpeedBump[] {
  return rules
    .filter(rule => rule.enabled)
    .map(rule => {
      const timed = resolveTimed(rule.groupId);
      return {
        id: rule.id,
        groupId: timed,
        blockGroupIds: resolveBlocked(rule.blockGroupId ?? rule.groupId),
        blockMinutes: clampBumpBlockMinutes(rule.blockMinutes),
        rungs: speedBumpRungs(rule),
      };
    })
    .filter(bump => bump.rungs.length > 0 && bump.blockGroupIds.length > 0);
}

/** The block the extension raised, as it left it in the App Group. */
export interface LiveSpeedBump {
  untilIso: string;
  groupIds: string[];
}

/**
 * The live block from the record the extension wrote, or null when there is
 * none, it has run out, or the record is unreadable. An unreadable record is
 * "not blocking" here, which is the safe side for the app: the extension's own
 * window lifts the shield it raised, and a bump nothing can read should not
 * hold apps for ever.
 */
export function liveSpeedBump(raw: string | null | undefined, now: Date): LiveSpeedBump | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { endIso?: unknown; groupIds?: unknown } | null;
    if (!parsed || typeof parsed.endIso !== 'string' || !Array.isArray(parsed.groupIds)) return null;
    const end = new Date(parsed.endIso).getTime();
    if (Number.isNaN(end) || end <= now.getTime()) return null;
    const groupIds = parsed.groupIds.filter((id): id is string => typeof id === 'string' && id !== '');
    if (groupIds.length === 0) return null;
    return { untilIso: parsed.endIso, groupIds };
  } catch {
    return null;
  }
}

/** "45 min on Social, then Games blocked for 15 minutes". Group names come from the caller. */
export function describeSpeedBump(rule: SpeedBumpRule, timedName: string, blockedName: string): string {
  const rungs = speedBumpRungs(rule);
  const first = `After ${rule.thresholdMinutes} min on ${timedName}`;
  const block = `${blockedName} blocked for ${describeDuration(rule.blockMinutes)}`;
  if (rungs.length <= 1) return `${first}, ${block}.`;
  return `${first}, then every ${rule.repeatEveryMinutes} min, up to ${rungs.length} times a day: ${block}.`;
}
