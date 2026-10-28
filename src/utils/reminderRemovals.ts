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
    const { itemId, inCart, removedAt } = entry as Record<string, unknown>;
    if (typeof itemId !== 'string' || !itemId || seen.has(itemId)) continue;
    if (typeof removedAt !== 'string' || Number.isNaN(Date.parse(removedAt))) continue;
    seen.add(itemId);
    out.push({ itemId, inCart: inCart === true, removedAt });
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
  removed: readonly { itemId: string; checked: boolean }[],
  removedAt: string
): ReminderRemoval[] {
  if (removed.length === 0) return [...existing];
  const incoming = new Set(removed.map(r => r.itemId));
  return [
    ...existing.filter(r => !incoming.has(r.itemId)),
    ...removed.map(r => ({ itemId: r.itemId, inCart: r.checked, removedAt })),
  ];
}

/**
 * The removals still worth asking about. A row drops out when:
 * - it no longer exists;
 * - it is back on the list, since that is a plan to buy it, which answers
 *   the question better than the card could;
 * - it has been bought since it was removed (a trip finished in the app, a
 *   receipt, or this card's own answer on another device);
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
    const removed = Date.parse(r.removedAt);
    if (now.getTime() - removed > REMINDER_REMOVAL_KEEP_DAYS * DAY_MS) return false;
    if (item.lastPurchasedAt && Date.parse(item.lastPurchasedAt) >= removed) return false;
    return true;
  });
}

/**
 * When the confirmed rows were bought, for `finishShopping`. The latest
 * removal among them: a reminder is cleared after the shop, never before it,
 * so that is the closest the record can get, and it is also the stamp that
 * retires every one of them in `liveReminderRemovals`. Never later than now.
 */
export function reminderPurchaseTime(bought: readonly ReminderRemoval[], now: Date): string {
  const latest = Math.max(...bought.map(r => Date.parse(r.removedAt)));
  return new Date(Number.isFinite(latest) ? Math.min(latest, now.getTime()) : now.getTime()).toISOString();
}

/** The rows a fresh card starts with selected: the ones that were in the cart. */
export function defaultBoughtIds(removals: readonly ReminderRemoval[]): string[] {
  return removals.filter(r => r.inCart).map(r => r.itemId);
}
