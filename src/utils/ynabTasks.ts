import type { Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import { formatPrice } from './groceryPrice';
import type { YnabCategory, YnabQueue, YnabSnapshot } from './ynabPlan';

/**
 * The `ynab` generator: "Approve 4 transactions in YNAB" while the person's
 * YNAB plan has transactions waiting on them, and, behind its own switch,
 * "Cover $12.40 overspending in Dining Out" for a category that has gone
 * below zero this month. See the `ynab` section of
 * `docs/arch/generated-tasks.md`.
 *
 * Everything here is pure. `useYnabStore` holds the last read of the plan
 * (`src/services/ynab.ts` makes it) and `checkYnabTasks` in `useTaskStore` is
 * the plumbing. The rules, and why:
 *
 * - **The queue task is written once a day at most.** Transactions import
 *   through the day, so "a task whenever the queue isn't empty" would put a
 *   fresh one back the moment one was checked off. The day is spent by writing
 *   the task (`ynabQueueLastDayKey`, per device), so one checked off or deleted
 *   stays gone until tomorrow, and while one is open (yesterday's included)
 *   its count follows the queue instead of a second one being written.
 * - **Nothing here completes a task.** An empty queue, or a category back at
 *   zero or above, makes the row ready (`generatedReadyAt`, through the
 *   reconcile's `satisfied`) and drops the number from its title. The tap stays
 *   the person's.
 * - **An overspent task is about one category in one month**, the source id
 *   says which, and it is written once per pair: one checked off is on record
 *   (`blocksOnFinished`), and one deleted is written to
 *   `ynabOverspentDeclined`. When the month turns, YNAB starts the category
 *   again from what was assigned, so last month's task is withdrawn rather than
 *   left asking about money that has already moved.
 */

/** Where both tasks open. YNAB's web app; on a phone with YNAB installed, the link may open the app. */
export const YNAB_APP_URL = 'https://app.ynab.com/';
/** Where a token is made, for the Settings row that asks for one: Account Settings, then Developer Settings. */
export const YNAB_TOKEN_URL = 'https://app.ynab.com/settings/developer';

// ==== source ids ====

const QUEUE_PREFIX = 'queue:';
const OVERSPENT_PREFIX = 'overspent:';

/** A day's queue task is named by the logical day it was written on. */
export function ynabQueueSourceId(dayKey: string): string {
  return `${QUEUE_PREFIX}${dayKey}`;
}

/** An overspent task is named by the category and the UTC month (`ynabMonthKey`). */
export function ynabOverspentSourceId(categoryId: string, monthKey: string): string {
  return `${OVERSPENT_PREFIX}${monthKey}:${categoryId}`;
}

/** Which of the two tasks a row is, or null when it isn't one of this generator's. */
export function ynabTaskKind(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): 'queue' | 'overspent' | null {
  const sourceId = generatedSourceOf(task, 'ynab');
  if (sourceId?.startsWith(QUEUE_PREFIX)) return 'queue';
  if (sourceId?.startsWith(OVERSPENT_PREFIX)) return 'overspent';
  return null;
}

function overspentParts(sourceId: string): { monthKey: string; categoryId: string } | null {
  if (!sourceId.startsWith(OVERSPENT_PREFIX)) return null;
  const rest = sourceId.slice(OVERSPENT_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon === rest.length - 1) return null;
  return { monthKey: rest.slice(0, colon), categoryId: rest.slice(colon + 1) };
}

/** The month an overspent task's source id names, or null for anything else. */
export function ynabOverspentMonthOf(sourceId: string): string | null {
  return overspentParts(sourceId)?.monthKey ?? null;
}

/** The YNAB category an overspent task's source id names, or null for anything else. */
export function ynabOverspentCategoryOf(sourceId: string): string | null {
  return overspentParts(sourceId)?.categoryId ?? null;
}

// ==== titles ====

/**
 * The queue task's title. It names what the transactions are waiting for:
 * approval, a category, or both, since YNAB lists the two separately and an
 * approved transaction with no category is still something to do.
 */
export function ynabQueueTitle(queue: YnabQueue): string {
  const n = queue.total;
  if (n <= 0) return 'Review transactions in YNAB';
  const noun = n === 1 ? 'transaction' : 'transactions';
  if (queue.uncategorized === 0) return `Approve ${n} ${noun} in YNAB`;
  if (queue.unapproved === 0) return `Categorize ${n} ${noun} in YNAB`;
  return `Review ${n} ${noun} in YNAB`;
}

/** The overspent task's title: by how much while it is below zero, without the amount once covered. */
export function ynabOverspentTitle(category: Pick<YnabCategory, 'name' | 'balanceMinor'>, symbol: string): string {
  if (category.balanceMinor >= 0) return `Cover overspending in ${category.name}`;
  return `Cover ${formatPrice(-category.balanceMinor, symbol)} overspending in ${category.name}`;
}

// ==== deciding ====

/**
 * Whether today's queue task should be written: something is waiting, and no
 * task has been written today already. An open one from an earlier day is
 * handled by the caller (its count follows the queue), so this only decides a
 * new one.
 */
export function wantsYnabQueueTask(queue: YnabQueue | null, todayKey: string, lastDayKey: string | null): boolean {
  if (!queue || queue.total <= 0) return false;
  return lastDayKey !== todayKey;
}

/**
 * The categories an overspent task is wanted for in this read: below zero and
 * not hidden. Hidden is YNAB's own "out of my way", and a task about one would
 * be the app having an opinion the person has already set aside.
 */
export function ynabOverspentCategories(snapshot: YnabSnapshot): YnabCategory[] {
  return snapshot.categories.filter(c => !c.hidden && c.balanceMinor < 0);
}
