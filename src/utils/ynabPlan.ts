/**
 * The person's YNAB plan, read in memory: the shapes `src/services/ynab.ts`
 * builds out of the API's answers, and the pure reads the generator and the
 * grocery trip banner make of them. See the `ynab` section of
 * `docs/arch/generated-tasks.md` and "The active trip" in
 * `docs/arch/groceries.md`.
 *
 * Checked against YNAB's own API reference (api.ynab.com, OpenAPI 1.89.0):
 *
 * - **A budget is a "plan" now.** Since v1.79.0 every path is
 *   `/plans/{plan_id}/…` and the response keys say `plans` and `plan`. The old
 *   `/budgets/…` paths still answer but are no longer documented, so nothing
 *   here uses them.
 * - **Amounts are milliunits**: 1,000 is one unit of the plan's currency
 *   whatever its decimal places. This app keeps money in hundredths
 *   (`MINOR_PER_MAJOR` in `groceryPrice.ts`), so a YNAB amount is divided by
 *   ten and rounded, for every currency, because the app's prices are
 *   hundredths for every currency too.
 * - **A category's amounts are for the current plan month in UTC**, and the
 *   categories list answers delta requests (`last_knowledge_of_server`). A
 *   delta carries the categories that changed, with deleted ones flagged, so
 *   a read is merged into the last one rather than replacing it.
 *
 * Nothing here is written to the database. It is another service's answer
 * about the person's money, kept in `useYnabStore`'s memory, so it never
 * reaches sync, a backup or the MCP replica.
 */

/** A YNAB amount (milliunits) in this app's minor units (hundredths). */
export function ynabMinorFromMilliunits(milliunits: number): number {
  return Math.round(milliunits / 10);
}

/**
 * The UTC month YNAB's category amounts are for, as `YYYY-MM`. UTC on
 * purpose, and the one place in the app a month is read off UTC: it names
 * YNAB's month, not the person's, so a read after 7 PM on the last day of
 * the month in New York is already about the next one.
 */
export function ynabMonthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface YnabPlan {
  id: string;
  name: string;
}

export interface YnabCategory {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  /** What is available in it this month, in minor units. Negative when overspent. */
  balanceMinor: number;
  hidden: boolean;
}

/** The transactions waiting on the person: not yet approved, or with no category. */
export interface YnabQueue {
  unapproved: number;
  uncategorized: number;
  /** Distinct transactions in either list, so one that is both counts once. */
  total: number;
}

/** One read of a plan, merged into the reads before it. */
export interface YnabSnapshot {
  /** When the read landed (ISO). */
  fetchedAt: string;
  planId: string;
  /** The UTC month (`ynabMonthKey`) the category balances are for. */
  monthKey: string;
  categories: YnabCategory[];
  /** What to pass as `last_knowledge_of_server` next time, or null for a full read. */
  serverKnowledge: number | null;
  /** Null when the queue wasn't asked about (the transactions task is off). */
  queue: YnabQueue | null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The plans out of `GET /plans`, or null when the body isn't that answer. */
export function ynabPlansFrom(body: unknown): YnabPlan[] | null {
  const plans = (body as { data?: { plans?: unknown } })?.data?.plans;
  if (!Array.isArray(plans)) return null;
  const out: YnabPlan[] = [];
  for (const plan of plans) {
    const id = asString((plan as { id?: unknown })?.id);
    const name = asString((plan as { name?: unknown })?.name);
    if (id && name) out.push({ id, name });
  }
  return out;
}

/**
 * The categories out of `GET /plans/{id}/categories`, merged over `previous`
 * (null for a full read): a category in the answer replaces the one with its
 * id, a deleted one goes, and everything the answer doesn't mention stays as
 * it was. A group's rename reaches its categories even when they themselves
 * didn't change. Internal categories (Ready to Assign, Uncategorized) and
 * internal groups are left out, since nobody budgets into them.
 *
 * Null when the body isn't a categories answer at all, so a bad read can't
 * empty the list.
 */
export function mergeYnabCategories(
  previous: readonly YnabCategory[] | null,
  body: unknown,
): { categories: YnabCategory[]; serverKnowledge: number | null } | null {
  const data = (body as { data?: { category_groups?: unknown; server_knowledge?: unknown } })?.data;
  if (!data || !Array.isArray(data.category_groups)) return null;
  const byId = new Map<string, YnabCategory>((previous ?? []).map(c => [c.id, c]));
  for (const group of data.category_groups) {
    const g = group as { id?: unknown; name?: unknown; deleted?: unknown; internal?: unknown; hidden?: unknown; categories?: unknown };
    const groupId = asString(g.id);
    if (!groupId) continue;
    const groupName = asString(g.name) ?? '';
    const groupGone = g.deleted === true || g.internal === true;
    if (groupGone) {
      for (const [id, c] of byId) if (c.groupId === groupId) byId.delete(id);
      continue;
    }
    for (const [id, c] of byId) {
      if (c.groupId === groupId && c.groupName !== groupName) byId.set(id, { ...c, groupName });
    }
    if (!Array.isArray(g.categories)) continue;
    for (const category of g.categories) {
      const c = category as { id?: unknown; name?: unknown; deleted?: unknown; internal?: unknown; hidden?: unknown; balance?: unknown };
      const id = asString(c.id);
      if (!id) continue;
      if (c.deleted === true || c.internal === true) {
        byId.delete(id);
        continue;
      }
      const name = asString(c.name);
      if (!name || typeof c.balance !== 'number' || !Number.isFinite(c.balance)) continue;
      byId.set(id, {
        id,
        name,
        groupId,
        groupName,
        balanceMinor: ynabMinorFromMilliunits(c.balance),
        hidden: c.hidden === true || g.hidden === true,
      });
    }
  }
  const serverKnowledge = typeof data.server_knowledge === 'number' ? data.server_knowledge : null;
  return { categories: [...byId.values()], serverKnowledge };
}

/** The ids of the live transactions in one `GET /plans/{id}/transactions?type=…` answer, or null. */
export function ynabTransactionIdsFrom(body: unknown): string[] | null {
  const transactions = (body as { data?: { transactions?: unknown } })?.data?.transactions;
  if (!Array.isArray(transactions)) return null;
  const ids: string[] = [];
  for (const t of transactions) {
    const id = asString((t as { id?: unknown })?.id);
    if (id && (t as { deleted?: unknown }).deleted !== true) ids.push(id);
  }
  return ids;
}

/** The queue out of the two filtered transaction reads. */
export function ynabQueueFrom(unapprovedIds: readonly string[], uncategorizedIds: readonly string[]): YnabQueue {
  return {
    unapproved: unapprovedIds.length,
    uncategorized: uncategorizedIds.length,
    total: new Set([...unapprovedIds, ...uncategorizedIds]).size,
  };
}

/**
 * One category out of a snapshot, only while the snapshot is about the month
 * it is now in UTC: last month's balance is not what is left this month.
 */
export function ynabCategoryNow(
  snapshot: YnabSnapshot | null,
  categoryId: string | null,
  now: Date,
): YnabCategory | null {
  if (!snapshot || !categoryId) return null;
  if (snapshot.monthKey !== ynabMonthKey(now)) return null;
  return snapshot.categories.find(c => c.id === categoryId) ?? null;
}

/** The categories a picker offers: visible ones, by group and then name, the order YNAB lists them close to. */
export function ynabPickableCategories(snapshot: YnabSnapshot | null): YnabCategory[] {
  if (!snapshot) return [];
  return snapshot.categories
    .filter(c => !c.hidden)
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
}
