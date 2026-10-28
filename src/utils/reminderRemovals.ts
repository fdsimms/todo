import type { GroceryItem } from '../types';

/**
 * Rows the Reminders mirror took off the grocery list because their reminders
 * were deleted, kept so the person can say which of them were bought.
 *
 * Reminders hides a completed reminder and the usual way to tidy them is to
 * delete them ("Clear" on the completed section, or a swipe). The mirror reads
 * a deleted reminder as "taken off the list there" and parks the row
 * (`planGroceryReminderSync`), which is right for the list and left nothing
 * else behind: a household that shops from Reminders never finishes a trip in
 * the app, so none of what it bought reached the purchase record the pantry is
 * read from (`probablyHaveReason`, `docs/arch/groceries.md`).
 *
 * **Dated from the check, not the deletion.** A list is usually cleared days
 * after the shop, and the item's purchase cadence is measured from the date,
 * so the mirror keeps when each row was checked and the purchase uses that
 * (`ReminderRemoval.checkedAt`), falling back to the removal only when no
 * check time is known.
 *
 * **Confirmed, never assumed.** A deleted reminder is either a list cleared
 * after a shop or a thing that stopped being wanted, and only the person
 * knows which. So nothing here writes a purchase: it holds the rows until
 * `ReminderRemovalsCard` asks, and the answer goes through `finishShopping`,
 * so a confirmed row carries exactly the record a trip finished in the app
 * would. A row that was in the cart when it went (`inCart`) is the strong
 * case and starts selected; one that wasn't starts off.
 *
 * **Device-local**, beside the mirror's own links (`groceryImportLinks`). Only
 * the device whose mirror saw the reminder go knows it went. Two phones on
 * one Reminders list each hold their own, and a confirmation on either retires
 * both, because the purchase it records syncs and `liveReminderRemovals` drops
 * anything bought since it was removed.
 */
export interface ReminderRemoval {
  itemId: string;
  /** Whether the row was checked (in the cart) when its reminder was deleted. */
  inCart: boolean;
  /** When the mirror took it off the list. ISO. */
  removedAt: string;
  /**
   * When it was checked, for a row that was in the cart and whose check time
   * the mirror knew (`GroceryReminderLink.checkedAt`). The purchase is dated
   * from this rather than `removedAt`, because a list is usually cleared days
   * after the shop and the item's purchase cadence is measured from the date.
   */
  checkedAt?: string;
}

/**
 * How long an unanswered removal is offered. A shop confirmed two weeks late
 * would date the purchase two weeks wrong and skew the item's cadence more
 * than it helps it, and a card that never leaves is screen furniture.
 */
export const REMINDER_REMOVAL_KEEP_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tolerant of anything: a record that won't parse is a record we don't have. */
export function parseReminderRemovals(raw: string | null): ReminderRemoval[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ReminderRemoval[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { itemId, inCart, removedAt, checkedAt } = entry as Record<string, unknown>;
    if (typeof itemId !== 'string' || !itemId || seen.has(itemId)) continue;
    if (typeof removedAt !== 'string' || Number.isNaN(Date.parse(removedAt))) continue;
    seen.add(itemId);
    const dated = inCart === true && typeof checkedAt === 'string' && !Number.isNaN(Date.parse(checkedAt));
    out.push({ itemId, inCart: inCart === true, removedAt, ...(dated ? { checkedAt } : {}) });
  }
  return out;
}

export function serializeReminderRemovals(removals: readonly ReminderRemoval[]): string {
  return JSON.stringify(removals);
}

/**
 * Adds one mirror pass's removals. A row already held is replaced rather than
 * listed twice: the newer removal is the one the question is about.
 */
export function addReminderRemovals(
  existing: readonly ReminderRemoval[],
  removed: readonly { itemId: string; checked: boolean; checkedAt?: string }[],
  removedAt: string
): ReminderRemoval[] {
  if (removed.length === 0) return [...existing];
  const incoming = new Set(removed.map(r => r.itemId));
  return [
    ...existing.filter(r => !incoming.has(r.itemId)),
    ...removed.map(r => ({
      itemId: r.itemId,
      inCart: r.checked,
      removedAt,
      ...(r.checked && r.checkedAt ? { checkedAt: r.checkedAt } : {}),
    })),
  ];
}

/** When a confirmed removal was bought: its check, else when it came off the list. */
export function purchaseTimeOf(removal: ReminderRemoval): string {
  return removal.checkedAt ?? removal.removedAt;
}

/**
 * The removals still worth asking about. A row drops out when:
 * - it no longer exists;
 * - it is back on the list, since that is a plan to buy it, which answers
 *   the question better than the card could;
 * - it has been bought since it was checked, or removed if it never was (a
 *   trip finished in the app, a receipt, or this card's own answer, here or
 *   on another device);
 * - it has waited longer than `REMINDER_REMOVAL_KEEP_DAYS`.
 *
 * Only the home list matters (`onList` is the home list's mirror column),
 * because the Reminders mirror only ever reads home.
 */
export function liveReminderRemovals(
  removals: readonly ReminderRemoval[],
  items: readonly Pick<GroceryItem, 'id' | 'onList' | 'lastPurchasedAt'>[],
  now: Date
): ReminderRemoval[] {
  if (removals.length === 0) return [];
  const byId = new Map(items.map(i => [i.id, i]));
  return removals.filter(r => {
    const item = byId.get(r.itemId);
    if (!item || item.onList) return false;
    if (now.getTime() - Date.parse(r.removedAt) > REMINDER_REMOVAL_KEEP_DAYS * DAY_MS) return false;
    if (item.lastPurchasedAt && Date.parse(item.lastPurchasedAt) >= Date.parse(purchaseTimeOf(r))) return false;
    return true;
  });
}

/**
 * The confirmed rows as `finishShopping` calls, one per day they were bought,
 * oldest first. A trip records one time for everything in it, and items
 * checked on different days were different shops, so each day gets its own.
 * Within a day the latest time stands for all of it, which is also the stamp
 * that retires every row in the group (`liveReminderRemovals`). Never later
 * than now.
 */
export function purchaseGroups(
  bought: readonly ReminderRemoval[],
  now: Date
): { purchasedAt: string; itemIds: string[] }[] {
  const byDay = new Map<string, { latest: number; itemIds: string[] }>();
  for (const r of bought) {
    const time = Math.min(Date.parse(purchaseTimeOf(r)), now.getTime());
    // The local calendar day, from the date's own fields. Not `dayKeyOf`,
    // whose module reaches the settings store and the database; this one is
    // only a grouping key and never stored.
    const d = new Date(time);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const group = byDay.get(key);
    if (group) {
      group.latest = Math.max(group.latest, time);
      group.itemIds.push(r.itemId);
    } else {
      byDay.set(key, { latest: time, itemIds: [r.itemId] });
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.latest - b.latest)
    .map(g => ({ purchasedAt: new Date(g.latest).toISOString(), itemIds: g.itemIds }));
}

/** The rows a fresh card starts with selected: the ones that were in the cart. */
export function defaultBoughtIds(removals: readonly ReminderRemoval[]): string[] {
  return removals.filter(r => r.inCart).map(r => r.itemId);
}
