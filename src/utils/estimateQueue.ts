import type { MealSlot } from '../types';
import type { EstimateContextFood, NutritionEstimate } from './nutritionEstimate';

/**
 * Meals described while there was no connection, kept until one can be
 * estimated.
 *
 * **The queue holds descriptions, never entries.** `nutritionEstimate.ts` and
 * `docs/arch/health-data.md` license a dietary figure on one argument: it exists
 * because a person entered or confirmed it. A queued meal that logged itself
 * when the signal came back would be an estimate the app stored unconfirmed,
 * which is exactly what that argument rules out. So a request waits, the
 * estimate it comes back with waits again (`ready`), and nothing reaches the
 * food log until somebody taps Log on it. Until then it adds nothing to a
 * day's totals and writes nothing to Health.
 *
 * **It keeps when the meal was eaten, not when it was answered.** `atISO` is
 * the moment the person was logging for, so confirming at bedtime still lands
 * on the lunch it was.
 *
 * **Only failures that waiting can fix are queued** (`isQueueableFailure`). A
 * rejected key, a switched-off feature, demo mode and a description the model
 * could not read would fail the same way on every retry, so they show inline
 * as they always did instead of sitting in a list that never clears.
 *
 * **Nothing here is ever deleted on the app's behalf.** What somebody typed is
 * their input, so a request that keeps failing is marked `failed` and left
 * for them to retry or remove.
 */

/** More than this and the list stops being a few meals you meant to log. */
export const MAX_PENDING_ESTIMATES = 20;

export type PendingEstimateStatus =
  /** Not answered yet: still offline, or not tried since it was saved. */
  | 'waiting'
  /** An estimate is in hand and waits for a person to log or discard it. */
  | 'ready'
  /** Reached the API and was refused for a reason retrying will not change. */
  | 'failed';

export interface PendingEstimate {
  id: string;
  /** The text the estimate is asked for, answers and typed amount already folded in. */
  description: string;
  /** Which meal it was, as chosen when it was saved. */
  slot: MealSlot | null;
  /** The moment the meal was eaten, ISO. */
  atISO: string;
  /** The planned meal this was logging, carried onto the entry. */
  mealPlanEntryId: string | null;
  /** The user's own figures the description may refer to, captured when it was saved. */
  context: EstimateContextFood[];
  status: PendingEstimateStatus;
  /** Set once `status` is `ready`. */
  estimate: NutritionEstimate | null;
  /** Set once `status` is `ready`: when the figures came back, ISO. */
  estimatedAtISO: string | null;
  /** Set when `status` is `failed`: what to tell the person. */
  error: string | null;
  createdAt: string;
}

/**
 * Whether a failed estimate request is worth keeping to try again.
 *
 * Mirrors the order `describeAIError` reads a message in, so the two cannot
 * disagree about what a failure was. Everything that did not reach the API, or
 * that the API reported as its own trouble (rate limit, a 5xx, a timeout), can
 * clear by itself. A bad or missing key, a feature that is off, demo mode, any
 * other 4xx and a reply that came back unusable cannot, and are refused here.
 *
 * Anything unrecognized is queued: a failed `fetch` surfaces as a bare
 * `TypeError("Network request failed")` whose text varies, and an unknown error
 * is far likelier to be the connection than a fault retrying would repeat.
 */
export function isQueueableFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  if (message === 'No API key' || message.startsWith('No API key configured')) return false;
  if (message === 'AI feature disabled') return false;
  if (message === 'AI features are off in demo mode.') return false;
  if (message === 'No estimate returned') return false;
  if (message === 'No suggestions returned' || message === 'No answer returned') return false;
  if (message === 'Response was truncated') return false;
  if (error instanceof SyntaxError) return false;
  if (message === 'Request timed out') return true;
  if (message === 'API error 429') return true;
  if (message.startsWith('API error 5')) return true;
  // 401 is the key; any other 4xx is a request the API will refuse again.
  if (message.startsWith('API error')) return false;
  return true;
}

/** Whether a queue of this size can take one more. */
export function canQueueAnother(pending: readonly PendingEstimate[]): boolean {
  return pending.length < MAX_PENDING_ESTIMATES;
}

/**
 * The same request already waiting, so tapping Save for later twice does not
 * list one meal twice. Compared on the text and the moment, since the same dish
 * eaten at lunch and again at dinner is two meals.
 */
export function findDuplicate(
  pending: readonly PendingEstimate[],
  description: string,
  atISO: string,
): PendingEstimate | null {
  const key = description.trim().toLowerCase();
  return pending.find(p => p.atISO === atISO && p.description.trim().toLowerCase() === key) ?? null;
}

/** Oldest first, which is the order they were eaten in and the order they are answered in. */
export function sortPending(pending: readonly PendingEstimate[]): PendingEstimate[] {
  return [...pending].sort((a, b) => a.atISO.localeCompare(b.atISO) || a.createdAt.localeCompare(b.createdAt));
}

/** The ones a drain should ask the API about. A `failed` one is retried by hand. */
export function awaitingEstimate(pending: readonly PendingEstimate[]): PendingEstimate[] {
  return sortPending(pending).filter(p => p.status === 'waiting');
}

/**
 * The heading count and its words: how many are waiting for a connection and
 * how many are ready to log, said apart because they ask different things of
 * the person (nothing, and a tap).
 */
export function describePending(pending: readonly PendingEstimate[]): string {
  const ready = pending.filter(p => p.status === 'ready').length;
  const failed = pending.filter(p => p.status === 'failed').length;
  const waiting = pending.length - ready - failed;
  const parts: string[] = [];
  if (ready > 0) parts.push(`${ready} ready to log`);
  if (waiting > 0) parts.push(`${waiting} waiting for a connection`);
  if (failed > 0) parts.push(`${failed} could not be estimated`);
  return parts.join(', ');
}

const SUMMARY_FIGURES: readonly { key: 'calorieKcal' | 'proteinG' | 'carbsG' | 'fatG'; suffix: string }[] = [
  { key: 'calorieKcal', suffix: ' cal' },
  { key: 'proteinG', suffix: ' g protein' },
  { key: 'carbsG', suffix: ' g carbs' },
  { key: 'fatG', suffix: ' g fat' },
];

/**
 * The headline figures of a ready estimate, in one line, so what a tap would
 * log is on screen before the tap (the rule `EstimatePanel` keeps for its own
 * Log button). A figure the model did not state is left out rather than shown
 * as zero, the rule `FoodNutrition.amounts` states.
 */
export function summarizeEstimate(estimate: NutritionEstimate): string {
  return SUMMARY_FIGURES
    .flatMap(({ key, suffix }) => {
      const value = estimate.amounts[key];
      return value === undefined ? [] : [`${Math.round(value).toLocaleString('en-US')}${suffix}`];
    })
    .join(' · ');
}
