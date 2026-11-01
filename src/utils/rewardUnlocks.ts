import type { CoinEntry, RewardUnlock, Task } from '../types';
import { addDays } from 'date-fns/addDays';
import { baseCoinsFor, bountyCoinsFor, cleanRewardGlyph, isBalanceReset } from './rewards';
import { isNegativeTask } from './negativeHabits';
import { occurrenceFamilyKey } from './searchCollapse';

/**
 * Unlocks: a treat opened by doing a share of the day's work, rather than
 * bought with coins ("Switch, once 60% of today's work is done").
 *
 * They exist beside coin rewards for the tension between the two: saving
 * coins for something big made every small, daily treat a setback. An unlock
 * costs nothing, so it never touches the balance or the savings for a goal.
 *
 * The rules, each for a reason:
 *
 * - **Today's work is counted in coins.** The coins earned today over that
 *   plus what today's open tasks would still pay. Coins already weigh what
 *   counts: a hard task counts double, an easy one half, and a trivial one
 *   (or ten of them) nothing. A share rather than a fixed number, so a light
 *   Sunday asks for less than a packed Tuesday. Deferring tasks lowers the
 *   bar too; that is accepted, since someone gaming it would play anyway.
 *
 * - **A day with nothing on it is open.** No work scheduled is no work owed.
 *
 * - **Required tasks count on the days they are due.** "Also needs the
 *   workout" means today's workout, so a task not due today asks nothing.
 *   Stored as one occurrence's id and resolved to its family
 *   (`occurrenceFamilyKey`), so a repeating task's later rows still match.
 *
 * - **Once play starts, it stays open for the day.** Adding tasks after
 *   starting doesn't lock it mid-game. Before then it follows the work:
 *   unticking a task can close it again, the way undo takes back what an
 *   action gave everywhere else.
 *
 * - **Weekends and vacation can open it all day**, per unlock.
 *
 * - **The play time is a daily allowance, not per stretch.** Stopping and
 *   starting again carries on from what's left. "+15 min" adds to today only.
 *   Nothing enforces it on the console; it is a timer and a notification.
 *
 * - **It moves no coins and writes nothing to the ledger.**
 */

export const DEFAULT_UNLOCK_SHARE = 60;
export const MIN_UNLOCK_SHARE = 5;
export const MAX_UNLOCK_SHARE = 100;
/** How far one press of the share stepper moves it. */
export const UNLOCK_SHARE_STEP = 5;
/** The most play time a day can be set to, in hours. */
export const MAX_PLAY_HOURS = 12;
/** What "+15 min" adds. */
export const PLAY_EXTRA_MINUTES = 15;

export function cleanUnlockSharePct(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_UNLOCK_SHARE;
  return Math.min(MAX_UNLOCK_SHARE, Math.max(MIN_UNLOCK_SHARE, Math.round(value)));
}

/** A play time as stored: whole minutes up to the ceiling, or null for none. */
export function cleanPlayMinutes(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_PLAY_HOURS * 60, Math.round(value));
}

/** What the form (and the MCP server's tools) edit on an unlock. */
export type UnlockDraft = Pick<RewardUnlock, 'title' | 'glyph' | 'sharePct' | 'requiredTaskIds' | 'playMinutes' | 'freeOnWeekends' | 'freeOnVacation' | 'guardsTaskId' | 'pin'>;

/** A draft as stored: trimmed, in range, no repeated requirement, blanks as null. */
export function cleanUnlockDraft(draft: UnlockDraft): UnlockDraft {
  return {
    title: draft.title.trim(),
    glyph: cleanRewardGlyph(draft.glyph),
    sharePct: cleanUnlockSharePct(draft.sharePct),
    requiredTaskIds: Array.from(new Set(draft.requiredTaskIds.filter(Boolean))),
    playMinutes: cleanPlayMinutes(draft.playMinutes),
    freeOnWeekends: !!draft.freeOnWeekends,
    freeOnVacation: !!draft.freeOnVacation,
    guardsTaskId: draft.guardsTaskId || null,
    pin: draft.pin?.trim() || null,
  };
}

// ==== Today's work ====

/** Coins earned in the logical day starting at `todayStart`. A reset is no earning. */
export function coinsEarnedToday(entries: readonly CoinEntry[], todayStart: Date): number {
  const from = todayStart.getTime();
  const to = addDays(todayStart, 1).getTime();
  let total = 0;
  for (const e of entries) {
    if (e.kind !== 'earn' || isBalanceReset(e)) continue;
    const at = Date.parse(e.at);
    if (at >= from && at < to) total += e.amount;
  }
  return total;
}

/**
 * What today's open tasks would still pay. `onToday` is what Today shows
 * (visible, and later today). A "don't do" habit is left out: it pays for a
 * clean day at the rollover, which is not work anyone does today.
 */
export function coinsStillOpenToday(onToday: readonly Task[]): number {
  let total = 0;
  for (const t of onToday) {
    if (t.completed || t.parentId || isNegativeTask(t)) continue;
    total += baseCoinsFor(t) + bountyCoinsFor(t);
  }
  return total;
}

/** The share of today's work done, 0..1. A day with nothing on it counts as done. */
export function workShareDone(earned: number, open: number): number {
  const total = earned + Math.max(0, open);
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, earned / total));
}

/** Coins still to earn before `sharePct` of today's work is done. */
export function coinsShortOf(sharePct: number, earned: number, open: number): number {
  const total = earned + Math.max(0, open);
  return Math.max(0, Math.ceil((total * sharePct) / 100 - earned - 1e-9));
}

// ==== Required tasks ====

function completedOn(task: Task, from: number, to: number): boolean {
  if (!task.completed || task.missedAt || !task.completedAt) return false;
  const at = Date.parse(task.completedAt);
  return at >= from && at < to;
}

/**
 * The family key for a stored required id: the row's own, or, once that row
 * is gone (the retention window), its successor's.
 */
function requiredFamilyKey(id: string, byId: Map<string, Task>, tasks: readonly Task[]): string | null {
  const own = byId.get(id);
  if (own) return occurrenceFamilyKey(own, byId);
  const next = tasks.find(t => t.previousOccurrenceId === id);
  return next ? occurrenceFamilyKey(next, byId) : null;
}

export interface RequiredToday {
  /** Required tasks due today and not done yet: what to show as still needed. */
  pending: Task[];
  /** Required tasks done today. */
  done: Task[];
}

/**
 * Where each required task stands today. A task neither due today nor done
 * today asks nothing; one whose every row is gone is dropped.
 */
export function requiredToday(
  requiredIds: readonly string[],
  tasks: readonly Task[],
  onToday: readonly Task[],
  todayStart: Date,
): RequiredToday {
  if (requiredIds.length === 0) return { pending: [], done: [] };
  const byId = new Map(tasks.map(t => [t.id, t]));
  const from = todayStart.getTime();
  const to = addDays(todayStart, 1).getTime();
  const keys = new Map<string, string>();
  for (const id of requiredIds) {
    const key = requiredFamilyKey(id, byId, tasks);
    if (key) keys.set(key, id);
  }
  const doneKeys = new Map<string, Task>();
  for (const t of tasks) {
    if (!completedOn(t, from, to)) continue;
    const key = occurrenceFamilyKey(t, byId);
    if (keys.has(key)) doneKeys.set(key, t);
  }
  const pendingKeys = new Map<string, Task>();
  for (const t of onToday) {
    if (t.completed || t.parentId) continue;
    const key = occurrenceFamilyKey(t, byId);
    if (keys.has(key) && !doneKeys.has(key)) pendingKeys.set(key, t);
  }
  return { pending: [...pendingKeys.values()], done: [...doneKeys.values()] };
}

/**
 * The ids to keep, each moved to its family's newest row, so a requirement
 * survives the retention window purging the row it was set on. Null when
 * nothing would change.
 */
export function repointRequired(requiredIds: readonly string[], tasks: readonly Task[]): string[] | null {
  if (requiredIds.length === 0) return null;
  const byId = new Map(tasks.map(t => [t.id, t]));
  let changed = false;
  const next = requiredIds.map(id => {
    const key = requiredFamilyKey(id, byId, tasks);
    if (!key) return id;
    let newest: Task | null = null;
    for (const t of tasks) {
      if (t.parentId || occurrenceFamilyKey(t, byId) !== key) continue;
      if (!newest || t.createdAt > newest.createdAt) newest = t;
    }
    if (newest && newest.id !== id) {
      changed = true;
      return newest.id;
    }
    return id;
  });
  return changed ? next : null;
}

// ==== Open or locked ====

export type UnlockStatus =
  | { kind: 'free'; reason: 'weekend' | 'vacation' }
  | { kind: 'open'; share: number; playing: boolean }
  | { kind: 'locked'; share: number; coinsShort: number; pending: Task[] };

export interface UnlockInputs {
  earned: number;
  open: number;
  pending: readonly Task[];
  /** The logical today is a Saturday or Sunday. */
  weekend: boolean;
  vacation: boolean;
  /** Play has started today (`playedToday`). */
  played: boolean;
}

export function unlockStatus(unlock: Pick<RewardUnlock, 'sharePct' | 'freeOnWeekends' | 'freeOnVacation'>, inputs: UnlockInputs): UnlockStatus {
  if (unlock.freeOnVacation && inputs.vacation) return { kind: 'free', reason: 'vacation' };
  if (unlock.freeOnWeekends && inputs.weekend) return { kind: 'free', reason: 'weekend' };
  const share = workShareDone(inputs.earned, inputs.open);
  if (inputs.played) return { kind: 'open', share, playing: true };
  const coinsShort = share * 100 >= unlock.sharePct - 1e-9 ? 0 : coinsShortOf(unlock.sharePct, inputs.earned, inputs.open);
  if (coinsShort === 0 && inputs.pending.length === 0) return { kind: 'open', share, playing: false };
  return { kind: 'locked', share, coinsShort, pending: [...inputs.pending] };
}

export function isUnlockOpen(status: UnlockStatus): boolean {
  return status.kind !== 'locked';
}

// ==== Play time ====

type PlayFields = Pick<RewardUnlock, 'playMinutes' | 'playDay' | 'playUsedMs' | 'playExtraMs' | 'playStartedAt'>;

export interface PlayState {
  /** A stretch is running and time is left. */
  running: boolean;
  /** Time used today, the running stretch included. */
  usedMs: number;
  /** Today's allowance with anything added, or null with no limit. */
  allowanceMs: number | null;
  /** What's left of the allowance, or null with no limit. */
  remainingMs: number | null;
  /** When the running stretch runs out, or null. */
  endsAt: Date | null;
}

export function playState(unlock: PlayFields, now: Date, todayKey: string): PlayState {
  const today = unlock.playDay === todayKey;
  const used = today ? unlock.playUsedMs : 0;
  const extra = today ? unlock.playExtraMs : 0;
  const startedAt = today && unlock.playStartedAt ? Date.parse(unlock.playStartedAt) : null;
  const allowance = unlock.playMinutes !== null ? unlock.playMinutes * 60_000 + extra : null;
  const elapsed = startedAt !== null ? Math.max(0, now.getTime() - startedAt) : 0;
  const total = allowance !== null ? Math.min(allowance, used + elapsed) : used + elapsed;
  const running = startedAt !== null && (allowance === null || used + elapsed < allowance);
  return {
    running,
    usedMs: total,
    allowanceMs: allowance,
    remainingMs: allowance !== null ? Math.max(0, allowance - total) : null,
    endsAt: running && allowance !== null && startedAt !== null ? new Date(startedAt + (allowance - used)) : null,
  };
}

/** Whether play has started on `todayKey`, which keeps the unlock open for the rest of it. */
export function playedToday(unlock: PlayFields, todayKey: string): boolean {
  return unlock.playDay === todayKey && (unlock.playUsedMs > 0 || unlock.playStartedAt !== null);
}

/** The fields to write to start (or carry on) today's play. */
export function startPlay(unlock: PlayFields, now: Date, todayKey: string): PlayFields {
  const today = unlock.playDay === todayKey;
  const state = playState(unlock, now, todayKey);
  if (state.running) return unlock;
  return {
    playMinutes: unlock.playMinutes,
    playDay: todayKey,
    playUsedMs: today ? state.usedMs : 0,
    playExtraMs: today ? unlock.playExtraMs : 0,
    playStartedAt: now.toISOString(),
  };
}

/** The fields to write to stop: the stretch's time folded into what's used. */
export function stopPlay(unlock: PlayFields, now: Date, todayKey: string): PlayFields {
  if (unlock.playDay !== todayKey) return { ...unlock, playStartedAt: null };
  return { ...unlock, playUsedMs: playState(unlock, now, todayKey).usedMs, playStartedAt: null };
}

/** The fields to write to add `minutes` to today's allowance. */
export function addPlayTime(unlock: PlayFields, minutes: number, now: Date, todayKey: string): PlayFields {
  if (unlock.playDay !== todayKey) {
    return { ...unlock, playDay: todayKey, playUsedMs: 0, playExtraMs: minutes * 60_000, playStartedAt: null };
  }
  // A stretch that ran out is folded in and started again, so the added
  // time runs from now rather than being swallowed by the time it was over.
  const state = playState(unlock, now, todayKey);
  const folded = unlock.playStartedAt && !state.running
    ? { playUsedMs: state.usedMs, playStartedAt: now.toISOString() }
    : {};
  return { ...unlock, ...folded, playExtraMs: unlock.playExtraMs + minutes * 60_000 };
}

/** "1:24:37" or "24:37": a countdown. */
export function formatPlayClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "2 hours", "90 minutes", "1 hour": a play time for the form and the card. */
export function describePlayMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return `${minutes} minutes`;
}

// ==== One unlock, today ====

/** Everything an unlock's status is read against. */
export interface UnlockWorld {
  entries: readonly CoinEntry[];
  tasks: readonly Task[];
  /** What Today shows: visible, and later today. */
  onToday: readonly Task[];
  /** Start of the logical today. */
  todayStart: Date;
  /** The logical today's key (`getLogicalDayKey`). */
  todayKey: string;
  vacation: boolean;
}

/** Where one unlock stands now, and the required tasks behind it. */
export function statusOfUnlock(unlock: RewardUnlock, world: UnlockWorld): { status: UnlockStatus; required: RequiredToday } {
  const required = requiredToday(unlock.requiredTaskIds, world.tasks, world.onToday, world.todayStart);
  const weekday = world.todayStart.getDay();
  const status = unlockStatus(unlock, {
    earned: coinsEarnedToday(world.entries, world.todayStart),
    open: coinsStillOpenToday(world.onToday),
    pending: required.pending,
    weekend: weekday === 0 || weekday === 6,
    vacation: world.vacation,
    played: playedToday(unlock, world.todayKey),
  });
  return { status, required };
}
