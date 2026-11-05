import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  mergeYnabCategories,
  ynabMonthKey,
  ynabPlansFrom,
  ynabQueueFrom,
  ynabTransactionIdsFrom,
  type YnabPlan,
  type YnabSnapshot,
} from '../utils/ynabPlan';

/**
 * The person's own YNAB plan, over the network, read-only: the plans on the
 * account (for Settings to pick one), the plan's categories and what is left
 * in each this month, and how many transactions are waiting to be approved or
 * categorized. Paths and fields are checked against YNAB's API reference
 * (api.ynab.com); `src/utils/ynabPlan.ts` says what was checked.
 *
 * **It needs the person's personal access token**, which they make in YNAB
 * under Account Settings, Developer Settings, and paste in. YNAB's tokens
 * can't be limited to reading, so this file is where "read-only" is kept:
 * every request is a GET. The token lives in the keychain
 * (`YNAB_TOKEN_SECURE_KEY`) and never syncs.
 *
 * **No switch, no token, no traffic.** A read needs one of the YNAB features
 * on (`ynabTasks`, `ynabGroceryBudget`), both off by default, plus a token,
 * and refuses in demo mode. What is sent is the token and plain GETs against
 * the person's own plan; nothing from this app goes with them.
 *
 * **The rate limit is 200 requests an hour per token**, over a rolling hour.
 * A read is at most three requests and the app reads every ten minutes while
 * it is open, so a busy hour is a few dozen. The categories read is a delta
 * request (`last_knowledge_of_server`), so a read where nothing changed carries
 * almost nothing back. The two transaction counts are not: YNAB documents a
 * delta as returning what changed, and a transaction approved since the last
 * read no longer matches `type=unapproved`, so a delta of that filtered list
 * can't be relied on to say it left. Both lists are short (only what is
 * waiting), so they are read whole.
 *
 * **Nothing is stored.** The snapshot lives in `useYnabStore`'s memory, the
 * WaniKani snapshot's terms.
 */

const API_BASE = 'https://api.ynab.com/v1';
/** Matching the other background reads: a slow answer means no update, not a wait. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Why a read failed, in terms Settings can say something about. */
export type YnabProblem = 'unauthorized' | 'rateLimited' | 'notFound' | 'unavailable';

export type YnabPlansRead =
  | { ok: true; plans: YnabPlan[] }
  | { ok: false; problem: YnabProblem };

export type YnabRead =
  | { ok: true; snapshot: YnabSnapshot }
  | { ok: false; problem: YnabProblem };

export interface YnabReadOptions {
  planId: string;
  /** Read the approve and categorize counts (the transactions task is on). */
  queue: boolean;
  /** The last read, to merge into and to take `server_knowledge` from. */
  previous: YnabSnapshot | null;
  now: Date;
}

class YnabHttpError extends Error {
  constructor(readonly problem: YnabProblem) {
    super(problem);
  }
}

export function ynabProblemForStatus(status: number): YnabProblem {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  return 'unavailable';
}

/** Whether any YNAB feature is on, which is what lets a read happen at all. */
export function ynabWanted(settings: { ynabTasks: boolean; ynabGroceryBudget: boolean }): boolean {
  return settings.ynabTasks || settings.ynabGroceryBudget;
}

async function getJson(path: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        // Cast for the reason httpSyncTransport.ts gives: mcp/ typechecks
        // against Node's fetch.
        signal: controller.signal as unknown as RequestInit['signal'],
      });
    } catch {
      throw new YnabHttpError('unavailable');
    }
    if (!response.ok) throw new YnabHttpError(ynabProblemForStatus(response.status));
    try {
      return await response.json();
    } catch {
      throw new YnabHttpError('unavailable');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function mayRead(token: string): boolean {
  if (isDemoModeActive()) return false;
  if (!ynabWanted(useSettingsStore.getState())) return false;
  return !!token;
}

/**
 * The plans on the account. Also how Settings checks a token: YNAB refusing it
 * here is the one answer that means the token is wrong. Null when it didn't
 * try (demo mode, every YNAB feature off, no token).
 */
export async function fetchYnabPlans(token: string): Promise<YnabPlansRead | null> {
  if (!mayRead(token)) return null;
  try {
    const plans = ynabPlansFrom(await getJson('/plans', token));
    return plans ? { ok: true, plans } : { ok: false, problem: 'unavailable' };
  } catch (error) {
    return { ok: false, problem: error instanceof YnabHttpError ? error.problem : 'unavailable' };
  }
}

/**
 * One read of a plan. Null when it didn't try (demo mode, every feature off,
 * no token); `{ ok: false }` when it tried and YNAB or the network said no,
 * with the reason.
 *
 * The categories are a delta over `previous` while it is the same plan and
 * the same UTC month. A new month starts a full read: the amounts are for
 * "the current plan month", and the turn of the month changes every one of
 * them without anything having been edited, which a delta isn't documented
 * to report.
 */
export async function fetchYnab(token: string, options: YnabReadOptions): Promise<YnabRead | null> {
  if (!mayRead(token)) return null;
  const { planId, now } = options;
  const monthKey = ynabMonthKey(now);
  const previous = options.previous
    && options.previous.planId === planId
    && options.previous.monthKey === monthKey
    ? options.previous
    : null;
  const plan = `/plans/${encodeURIComponent(planId)}`;

  try {
    const knowledge = previous?.serverKnowledge;
    const categoriesPath = knowledge != null
      ? `${plan}/categories?last_knowledge_of_server=${knowledge}`
      : `${plan}/categories`;
    const merged = mergeYnabCategories(previous?.categories ?? null, await getJson(categoriesPath, token));
    if (!merged) return { ok: false, problem: 'unavailable' };

    let queue: YnabSnapshot['queue'] = null;
    if (options.queue) {
      const unapproved = ynabTransactionIdsFrom(await getJson(`${plan}/transactions?type=unapproved`, token));
      const uncategorized = ynabTransactionIdsFrom(await getJson(`${plan}/transactions?type=uncategorized`, token));
      if (!unapproved || !uncategorized) return { ok: false, problem: 'unavailable' };
      queue = ynabQueueFrom(unapproved, uncategorized);
    }

    return {
      ok: true,
      snapshot: {
        fetchedAt: now.toISOString(),
        planId,
        monthKey,
        categories: merged.categories,
        // A body with no knowledge in it can't be built on: read in full next time.
        serverKnowledge: merged.serverKnowledge,
        queue,
      },
    };
  } catch (error) {
    return { ok: false, problem: error instanceof YnabHttpError ? error.problem : 'unavailable' };
  }
}
