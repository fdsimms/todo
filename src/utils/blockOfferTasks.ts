import type { BlockOfferRule, Task } from '../types';
import { generateId } from './id';
import { parseRuleCategory } from './ruleCategory';
import { generatedSourceOf } from './generatedTasks';
import { describeDuration, MAX_MANUAL_MINUTES, MIN_MANUAL_MINUTES } from './manualBlock';
import type { ReleaseRecord } from './shieldRelease';

/**
 * Block offers: "block Games for an hour and earn 10 coins".
 *
 * The rules module for the `blockOffer` generator (see `generatedTasks.ts` and
 * `docs/arch/generated-tasks.md`), store-free like `screenTimeRules.ts` beside
 * it. Orchestration lives in `checkBlockOfferTasks` (`useTaskStore.ts`) and the
 * accepting step in `blockOfferAccept.ts`.
 *
 * The rules that make this one different from the other rule generators:
 *
 * - **The task starts a block, and its tick pays only after the block ran.**
 *   Tapping the checkbox of an offer nobody has accepted starts the block
 *   instead of completing the task (`completionTapFor`'s `start-block`). The
 *   task reads ready once the block's whole window has passed
 *   (`blockOfferRunOutcome`), and the person's tick is what pays, so the app
 *   still never pays coins on its own.
 * - **Ending the block early forfeits it.** A key tag or the emergency button
 *   writes a release record naming `manual`; one inside the window deletes the
 *   task. The rule's day mark was spent when the offer was made, so it does not
 *   return that day.
 * - **The amount is fixed on the rule**, and copied onto the run when the block
 *   starts, so editing a rule never changes what an accepted offer pays.
 *
 * Coins here never unlock anything in the app. The direction is the reverse of
 * the one `docs/arch/rewards.md` rules out: the person chooses to block, and
 * the coins follow.
 */

export const BLOCK_OFFER_TITLE_MAX_LENGTH = 80;

export const BLOCK_OFFER_COINS_MIN = 1;
export const BLOCK_OFFER_COINS_MAX = 500;
export const BLOCK_OFFER_COINS_DEFAULT = 10;
export const BLOCK_OFFER_MINUTES_DEFAULT = 60;

/** The lengths the rule sheet offers. Every one is inside the manual block's range. */
export const BLOCK_OFFER_MINUTE_CHOICES: readonly number[] = [15, 30, 60, 120, 240];

export function clampBlockOfferMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return BLOCK_OFFER_MINUTES_DEFAULT;
  return Math.min(MAX_MANUAL_MINUTES, Math.max(MIN_MANUAL_MINUTES, Math.round(minutes)));
}

export function clampBlockOfferCoins(coins: number): number {
  if (!Number.isFinite(coins)) return BLOCK_OFFER_COINS_DEFAULT;
  return Math.min(BLOCK_OFFER_COINS_MAX, Math.max(BLOCK_OFFER_COINS_MIN, Math.round(coins)));
}

/** "Block Games for 1 hour". The name is the group's, so it reads as the apps it holds. */
export function blockOfferTitle(groupName: string, minutes: number): string {
  return `Block ${groupName} for ${describeDuration(minutes)}`.slice(0, BLOCK_OFFER_TITLE_MAX_LENGTH);
}

/** "10 coins" / "1 coin", for a row or an alert. */
export function describeOfferCoins(coins: number): string {
  return `${coins} ${coins === 1 ? 'coin' : 'coins'}`;
}

/** A rule as the sheet adds it: on, never offered, ten coins for an hour. */
export function newBlockOfferRule(title: string, groupId?: string): BlockOfferRule {
  return {
    id: generateId(),
    title: title.slice(0, BLOCK_OFFER_TITLE_MAX_LENGTH),
    ...(groupId ? { groupId } : {}),
    minutes: BLOCK_OFFER_MINUTES_DEFAULT,
    coins: BLOCK_OFFER_COINS_DEFAULT,
    enabled: true,
    lastFiredDayKey: null,
  };
}

/**
 * Read the stored list back, tolerantly: a malformed value reads as nothing
 * saved and a bad entry is dropped rather than discarding the list, the way
 * `parseScreenTimeRules` does.
 */
export function parseBlockOfferRules(raw: string | null | undefined): BlockOfferRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): BlockOfferRule[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const rule = entry as Partial<BlockOfferRule>;
    if (typeof rule.id !== 'string' || rule.id === '') return [];
    if (typeof rule.title !== 'string' || rule.title.trim() === '') return [];
    if (typeof rule.minutes !== 'number' || typeof rule.coins !== 'number') return [];
    return [{
      id: rule.id,
      title: rule.title.slice(0, BLOCK_OFFER_TITLE_MAX_LENGTH),
      ...(typeof rule.groupId === 'string' && rule.groupId !== '' ? { groupId: rule.groupId } : {}),
      minutes: clampBlockOfferMinutes(rule.minutes),
      coins: clampBlockOfferCoins(rule.coins),
      enabled: rule.enabled !== false,
      lastFiredDayKey: typeof rule.lastFiredDayKey === 'string' ? rule.lastFiredDayKey : null,
      ...parseRuleCategory(rule),
    }];
  });
}

export function serializeBlockOfferRules(rules: readonly BlockOfferRule[]): string {
  return JSON.stringify(rules);
}

/** `${dayKey}#${ruleId}` — a square on the calendar and the rule that named it. */
export function blockOfferSourceId(dayKey: string, ruleId: string): string {
  return `${dayKey}#${ruleId}`;
}

export function parseBlockOfferSourceId(
  sourceId: string | null | undefined,
): { dayKey: string; ruleId: string } | null {
  if (!sourceId) return null;
  const index = sourceId.indexOf('#');
  if (index <= 0 || index === sourceId.length - 1) return null;
  return { dayKey: sourceId.slice(0, index), ruleId: sourceId.slice(index + 1) };
}

/** The rule id a block-offer task came from, or null for any other task. */
export function blockOfferRuleIdOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return parseBlockOfferSourceId(generatedSourceOf(task, 'blockOffer'))?.ruleId ?? null;
}

export function isBlockOfferTask(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): boolean {
  return task.generatedKind === 'blockOffer';
}

// ==== runs ====

/** The settings row holding accepted offers, as JSON. Device-local, like the block it started. */
export const BLOCK_OFFER_RUNS_SETTING = 'blockOfferRuns';

/** Runs older than this are dropped even if their task still exists; a block is at most half a day. */
const RUN_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * One accepted offer: the block it started and what it was promised. It is the
 * terms as they stood at the tap, so a rule edited or deleted afterwards
 * changes nothing about an offer already taken.
 */
export interface BlockOfferRun {
  taskId: string;
  ruleId: string;
  /** ISO instant the block started. */
  startedAt: string;
  /** ISO instant it ends. */
  untilIso: string;
  coins: number;
}

export function parseBlockOfferRuns(raw: string | null | undefined): BlockOfferRun[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): BlockOfferRun[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const run = entry as Partial<BlockOfferRun>;
      if (typeof run.taskId !== 'string' || typeof run.ruleId !== 'string') return [];
      if (typeof run.startedAt !== 'string' || Number.isNaN(new Date(run.startedAt).getTime())) return [];
      if (typeof run.untilIso !== 'string' || Number.isNaN(new Date(run.untilIso).getTime())) return [];
      if (typeof run.coins !== 'number' || !Number.isFinite(run.coins)) return [];
      return [{
        taskId: run.taskId,
        ruleId: run.ruleId,
        startedAt: run.startedAt,
        untilIso: run.untilIso,
        coins: clampBlockOfferCoins(run.coins),
      }];
    });
  } catch {
    return [];
  }
}

export function serializeBlockOfferRuns(runs: readonly BlockOfferRun[]): string {
  return JSON.stringify(runs);
}

/** The runs after adding `run`, one per task, with the ones that can no longer matter dropped. */
export function withRunAdded(runs: readonly BlockOfferRun[], run: BlockOfferRun, now: Date): BlockOfferRun[] {
  return [...runs.filter(r => r.taskId !== run.taskId), run]
    .filter(r => now.getTime() - new Date(r.untilIso).getTime() < RUN_KEEP_MS);
}

export type RunOutcome =
  /** The window has not ended and nothing cut it short. */
  | 'running'
  /** The window ended with nothing cut short: the task is owed its tick. */
  | 'ready'
  /** A key tag or the emergency button ended the block inside the window. */
  | 'forfeited';

/**
 * Whether the block ran to its end. Read off the release log rather than the
 * manual block's own state, because a block that has lapsed and one that was
 * ended look the same once it is gone; only the record tells them apart.
 */
export function blockOfferRunOutcome(
  run: Pick<BlockOfferRun, 'startedAt' | 'untilIso'>,
  releases: readonly Pick<ReleaseRecord, 'at' | 'ended'>[],
  now: Date,
): RunOutcome {
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.untilIso).getTime();
  const cutShort = releases.some(r => {
    const at = new Date(r.at).getTime();
    return r.ended.includes('manual') && at >= start && at < end;
  });
  if (cutShort) return 'forfeited';
  return now.getTime() >= end ? 'ready' : 'running';
}

/**
 * What ticking this task pays, or null for a task that is not a block offer.
 *
 * Zero until the block has run (`generatedReadyAt`), which is what stops every
 * route that completes without asking (a bulk tick, the widget, an agent) from
 * paying for a block that never happened. The run's own figure wins, then the
 * rule's, because a phone that did not start the block has the rule (rules
 * sync) but not the run (runs stay on the device that blocked).
 */
export function blockOfferCoinsFor(
  task: Pick<Task, 'id' | 'generatedKind' | 'generatedSourceId' | 'generatedReadyAt'>,
  runs: readonly Pick<BlockOfferRun, 'taskId' | 'coins'>[],
  rules: readonly Pick<BlockOfferRule, 'id' | 'coins'>[],
): number | null {
  if (!isBlockOfferTask(task)) return null;
  if (!task.generatedReadyAt) return 0;
  const run = runs.find(r => r.taskId === task.id);
  if (run) return run.coins;
  const ruleId = blockOfferRuleIdOf(task);
  return rules.find(r => r.id === ruleId)?.coins ?? 0;
}

/**
 * Whether tapping this task's checkbox should offer to start the block rather
 * than complete it: a block offer nobody has finished a block for.
 */
export function offersBlockStart(task: Pick<Task, 'generatedKind' | 'generatedReadyAt' | 'completed'>): boolean {
  return task.generatedKind === 'blockOffer' && !task.completed && !task.generatedReadyAt;
}
