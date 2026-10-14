/**
 * A block the person starts by hand for a set length of time: the rules, with
 * no store and no native call in them.
 *
 * The sixth reason the shield goes up, and the one with no cause but the
 * person's own choice ("no phone for the next hour"). It is shaped like the
 * failed-task block (`penaltyShield.ts`): an end instant and a group, written
 * ahead for the monitor extension so it lifts on time with the app closed.
 *
 * **It has no "end now" button of its own.** A block that its own start button
 * could undo is not a block. Ending one early goes through `releaseAllBlocks`
 * (a key tag or the emergency button), which writes the record. The start
 * flow says so before it begins, since that is the moment someone chooses.
 *
 * **It takes its group when it starts.** The other reasons look their group up
 * in Settings; this one stores the group it was started with, so changing a
 * setting later cannot change what a running block holds.
 */

/** The settings row holding the running block, as JSON. Device-local, like the groups it points at. */
export const MANUAL_BLOCK_SETTING = 'manualBlock';

/** iOS refuses a monitored interval shorter than about a quarter of an hour. */
export const MIN_MANUAL_MINUTES = 15;
/**
 * The armed window's bounds are clock times, so its length has to be under a
 * day to be unambiguous (the same ceiling a penalty has). Half a day is well
 * inside it and longer than anyone means by "for a while".
 */
export const MAX_MANUAL_MINUTES = 12 * 60;

/** What the start flow offers, in minutes; null is "until I end it". */
export const MANUAL_BLOCK_PRESETS: readonly (number | null)[] = [15, 30, 60, 120, 240, null];

export interface ManualBlock {
  /**
   * ISO instant the block ends, or null for one that stays on until it is ended
   * (a key tag or the emergency button). An open-ended block has no clock, so
   * nothing is armed for it with the app closed: it behaves like the key lock,
   * held until something ends it.
   */
  untilIso: string | null;
  /** The app group it holds, resolved when it started. */
  groupId: string;
}

export function manualMinutesProblem(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (!Number.isInteger(minutes) || minutes < MIN_MANUAL_MINUTES) return 'A block has to last at least 15 minutes.';
  if (minutes > MAX_MANUAL_MINUTES) return 'A block can last at most 12 hours.';
  return null;
}

/** The block as stored, or null when the row is missing or malformed. */
export function parseManualBlock(raw: string | null | undefined): ManualBlock | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ManualBlock> | null;
    if (!parsed || typeof parsed.groupId !== 'string') return null;
    if (parsed.untilIso !== null) {
      if (typeof parsed.untilIso !== 'string' || Number.isNaN(new Date(parsed.untilIso).getTime())) return null;
    }
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(parsed.groupId)) return null;
    return { untilIso: parsed.untilIso ?? null, groupId: parsed.groupId };
  } catch {
    return null;
  }
}

/** A block of `minutes` starting at `now`, or an open-ended one when `minutes` is null. */
export function newManualBlock(minutes: number | null, groupId: string, now: Date): ManualBlock {
  return { untilIso: minutes === null ? null : new Date(now.getTime() + minutes * 60_000).toISOString(), groupId };
}

/** Whether the block has an end instant, which decides whether a window is armed for it. */
export function isTimedBlock(block: ManualBlock | null): block is ManualBlock & { untilIso: string } {
  return !!block && block.untilIso !== null;
}

/**
 * Whether `next` would end sooner than `running`. An open-ended block is the
 * longest there is, so a timed one never replaces it and it always replaces a
 * timed one.
 */
export function endsSooner(next: ManualBlock, running: ManualBlock): boolean {
  if (running.untilIso === null) return next.untilIso !== null;
  if (next.untilIso === null) return false;
  return new Date(next.untilIso).getTime() < new Date(running.untilIso).getTime();
}

/**
 * Whether the block wants the apps blocked at `now`. A timed block with an
 * unreadable end is "not blocking", never "blocking for ever"; only a block
 * stored as open-ended (an explicit null) holds until it is ended.
 */
export function manualBlockWanted(block: ManualBlock | null, now: Date): boolean {
  if (!block) return false;
  if (block.untilIso === null) return true;
  const until = new Date(block.untilIso).getTime();
  return !Number.isNaN(until) && until > now.getTime();
}

/** "15 minutes", "1 hour", "2 hours", "1 hour 30 minutes", "until you end it". */
export function describeDuration(minutes: number | null): string {
  if (minutes === null) return 'until you end it';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? '' : `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const mins = m === 0 ? '' : `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  return [hours, mins].filter(Boolean).join(' ');
}
