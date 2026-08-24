import { groceryNameKey, parseGroceryInput } from './groceryParse';

/**
 * Two-way sync between the grocery list and a Reminders list — the rules half.
 * The EventKit calls and the store writes live in `remindersImportSync.ts`
 * beside the one-way drain they replace; everything that *decides* anything is
 * here, pure and testable under the node jest env.
 *
 * The one-way drain reads a list, creates rows and (optionally) deletes what it
 * read. That shape can't answer the question two-way sync lives or dies on:
 * **a reminder that isn't there any more — did the user delete it, or did we
 * never push it?** A name can't answer it either. `remindersImport.ts`'s name
 * index is deliberately wide because there a false match costs a skip and a
 * false miss costs an unbounded re-import; here a wrong answer either resurrects
 * a row the user just deleted or deletes one they just added.
 *
 * So every mirrored pair is a **link**: the reminder's id, the item's id, and a
 * shadow of the state the two last agreed on. That makes each pass a three-way
 * diff rather than a guess — a side that differs from the shadow is a side that
 * changed, and only a side that changed gets to win. Both changed is the only
 * genuine conflict, and the app wins it, because the app is where the rest of
 * the row (its aisle, its price, its store) lives.
 *
 * It is a **reconcile, not a stream of hooks**, and that isn't a shortcut.
 * `onList` is written by a dozen store actions and anything done in the
 * Reminders app while this one is closed is invisible until the next
 * foreground, so a per-mutation push would be permanently behind. A diff
 * converges from whatever state it finds, which is the only version of "never
 * re-add" that survives the app being closed for a week.
 */

/**
 * One mirrored pair. `name` and `checked` are the **shadow**: what both sides
 * said last time this ran, not what either says now. The whole conflict rule is
 * built on that — see `planGroceryReminderSync`.
 *
 * Keyed by list and stored device-local (`groceryImportLinks` in the settings
 * table, which `isSyncedSettingKey` deliberately doesn't cover). EventKit ids
 * name a record on *this* device, so a link that travelled to another phone
 * would point at nothing there, or at something else. Two devices on one
 * iCloud list each keep their own links and meet in the middle by adopting each
 * other's reminders by name — see the unlinked-reminder pass below.
 */
export interface GroceryReminderLink {
  reminderId: string;
  itemId: string;
  /** The title the pair last agreed on. */
  name: string;
  /** The completion state the pair last agreed on. */
  checked: boolean;
  /**
   * Whether a fetch has ever handed this reminder back. False for the one gap
   * where it hasn't yet: the pass that created it, which knows the id only
   * because `createReminderAsync` returned it.
   *
   * A missing reminder is how "the user deleted it there" is recognised, and
   * that read is only safe once EventKit has been seen to hold it. Unconfirmed
   * and missing means we have no idea, so the link is dropped and the row gets
   * a fresh reminder rather than being taken off the list — the same asymmetry
   * the name index in `remindersImport.ts` is built on. A duplicate reminder is
   * visible and recoverable; groceries quietly vanishing off the list before a
   * shop is neither.
   */
  seen: boolean;
}

/** Links by reminder-list id, same per-list shape as `HandledReminderIndex`. */
export type GroceryLinkIndex = Record<string, GroceryReminderLink[]>;

/** Tolerant of anything: a record that won't parse is a record we don't have. */
export function parseGroceryLinks(raw: string | null | undefined): GroceryLinkIndex {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: GroceryLinkIndex = {};
  for (const [listId, links] of Object.entries(parsed as Record<string, unknown>)) {
    if (!listId || !Array.isArray(links)) continue;
    const seenReminders = new Set<string>();
    const seenItems = new Set<string>();
    const kept: GroceryReminderLink[] = [];
    for (const raw of links) {
      if (!raw || typeof raw !== 'object') continue;
      const link = raw as Record<string, unknown>;
      const reminderId = typeof link.reminderId === 'string' ? link.reminderId : '';
      const itemId = typeof link.itemId === 'string' ? link.itemId : '';
      if (!reminderId || !itemId) continue;
      // One reminder mirrors one item and vice versa. A record claiming
      // otherwise is corrupt, and honouring it would have one pass writing two
      // reminders' worth of state onto one row.
      if (seenReminders.has(reminderId) || seenItems.has(itemId)) continue;
      seenReminders.add(reminderId);
      seenItems.add(itemId);
      kept.push({
        reminderId,
        itemId,
        name: typeof link.name === 'string' ? link.name : '',
        checked: link.checked === true,
        // Absent means an older record, whose reminders have all been fetched
        // many times over by now. Defaulting it to false would read every one
        // of them as unconfirmed on the upgrade pass.
        seen: link.seen !== false,
      });
    }
    if (kept.length > 0) out[listId] = kept;
  }
  return out;
}

export function serializeGroceryLinks(index: GroceryLinkIndex): string {
  return JSON.stringify(index);
}

/**
 * The record after one list has been reconciled. An empty bucket is deleted
 * rather than stored as `[]`, so a list that has been emptied — or a mirror
 * that's been switched off — leaves nothing behind. Mirrors
 * `reconcileHandledReminders`, and for the same reason: this must not grow
 * without bound.
 */
export function withGroceryLinks(
  index: GroceryLinkIndex,
  listId: string,
  links: readonly GroceryReminderLink[]
): GroceryLinkIndex {
  const next = { ...index };
  if (links.length > 0) next[listId] = [...links];
  else delete next[listId];
  return next;
}

/** What one grocery row needs to be mirrored. A narrow view of `GroceryItem`. */
export interface MirrorItem {
  id: string;
  name: string;
  nameKey: string;
  quantity: string | null;
  onList: boolean;
  checked: boolean;
}

/** What one reminder needs to be mirrored. A narrow view of `Reminder`. */
export interface MirrorReminder {
  id: string;
  title: string;
  completed: boolean;
}

/**
 * The reminder title a row should carry: the amount in front of the name, the
 * way it was almost certainly typed in the first place. `parseGroceryInput`
 * split them apart on the way in so the name could stay a clean catalog key,
 * and putting them back is what makes "2 lb chicken" read like a shopping list
 * rather than like a catalog dump.
 */
export function mirrorTitleFor(item: { name: string; quantity: string | null }): string {
  const name = item.name.trim();
  const quantity = item.quantity?.trim();
  return quantity ? `${quantity} ${name}`.trim() : name;
}

/**
 * A title typed into the Reminders app, split the way an add field would split
 * it and rejoined in the app's own order. Null when there's no name left to
 * file it under.
 *
 * The rejoin is the point: a link's shadow has to hold a title *both* sides
 * will still produce next pass, and the app produces `mirrorTitleFor`. Storing
 * the raw text instead would make the app look changed on the very next pass
 * and push a normalisation back at a reminder nobody had touched.
 */
export function normalizeMirrorTitle(
  raw: string
): { name: string; quantity: string | null; title: string } | null {
  const { name, quantity } = parseGroceryInput(raw);
  if (!name.trim()) return null;
  return { name, quantity, title: mirrorTitleFor({ name, quantity }) };
}

/** The key `addByName` files a name under. Mirrors `groceryItemKey`. */
function itemKeyFor(name: string): string {
  return groceryNameKey(name) || name.trim().toLowerCase();
}

export interface GroceryReminderPlan {
  /** A list row with no reminder yet. */
  createReminders: { itemId: string; title: string }[];
  /** A reminder whose title or completion no longer matches its row. */
  updateReminders: { reminderId: string; itemId: string; title: string; completed: boolean }[];
  /**
   * A reminder whose row has left the list. Carries the link it came from, so
   * a delete that fails can put it back rather than dropping it — an
   * unrecorded reminder is one the next pass reads as new and adds the row
   * straight back for.
   */
  deleteReminders: { reminderId: string; link: GroceryReminderLink }[];
  /** A reminder with no row yet: import it, exactly as the drain would. */
  addItems: { reminderId: string; title: string }[];
  /** A row to tick or untick, because its reminder was. */
  setChecked: { itemId: string; checked: boolean }[];
  /** A row to rename, because its reminder was renamed. */
  renameItems: { itemId: string; name: string; quantity: string | null; title: string }[];
  /** A row to take off the list, because its reminder was deleted. */
  removeItems: { itemId: string }[];
  /**
   * Every link that survives this pass, carrying the state the two sides agree
   * on *once the actions above have been applied*. The two that mint an id —
   * `createReminders` and `addItems` — can't be here; the caller appends those
   * as each one lands.
   */
  links: GroceryReminderLink[];
}

const EMPTY_PLAN = (): GroceryReminderPlan => ({
  createReminders: [],
  updateReminders: [],
  deleteReminders: [],
  addItems: [],
  setChecked: [],
  renameItems: [],
  removeItems: [],
  links: [],
});

/**
 * What it would take to make the two lists say the same thing, given what they
 * each say now and what they last agreed on.
 *
 * Three passes, in this order, and the order is load-bearing:
 *
 * 1. **Every existing link**, which is where the destructive answers live: a
 *    link whose reminder is gone means the user deleted it there, and a link
 *    whose row has left the list means they removed it here. Both halves
 *    present is the ordinary case and reduces to the shadow diff.
 * 2. **Reminders no link claims.** A name the list already has is *adopted*
 *    rather than added again — that's what stops a second device (or a
 *    re-installed link record, or the user typing something that's already on
 *    the list) from producing a duplicate. Only then is it a genuine import.
 * 3. **Rows no link claims**, which get a reminder written for them.
 *
 * Nothing in pass 2 or 3 may touch something pass 1 already spoke for, which is
 * what `claimedReminders`/`claimedItems`/`claimedKeys` are for. `claimedKeys`
 * is the one that isn't obvious: two reminders reading "milk" are one item's
 * worth of intent, so the second is left alone rather than being adopted onto a
 * row the first already owns, or added as a second row the catalog would refuse
 * anyway.
 *
 * `items` and `reminders` are consumed in the order given, so the caller
 * decides what "oldest first" means (see `importableReminders`).
 */
export function planGroceryReminderSync(
  items: readonly MirrorItem[],
  reminders: readonly MirrorReminder[],
  links: readonly GroceryReminderLink[]
): GroceryReminderPlan {
  const plan = EMPTY_PLAN();

  const remindersById = new Map<string, MirrorReminder>();
  for (const reminder of reminders) {
    if (reminder.id) remindersById.set(reminder.id, reminder);
  }
  const itemsById = new Map(items.map(item => [item.id, item]));
  const itemsByKey = new Map<string, MirrorItem>();
  for (const item of items) {
    if (item.nameKey && !itemsByKey.has(item.nameKey)) itemsByKey.set(item.nameKey, item);
  }

  const claimedReminders = new Set<string>();
  const claimedItems = new Set<string>();
  const claimedKeys = new Set<string>();

  /**
   * One live pair, reconciled against the shadow it last agreed on. Shared by
   * pass 1 and by an adoption in pass 2, which is the same problem with the
   * reminder's own state standing in for a shadow that doesn't exist yet — so
   * an adopted pair that already disagrees resolves the app's way, like any
   * other conflict.
   */
  const reconcilePair = (
    reminder: MirrorReminder,
    item: MirrorItem,
    shadow: { name: string; checked: boolean }
  ): void => {
    claimedReminders.add(reminder.id);
    claimedItems.add(item.id);
    if (item.nameKey) claimedKeys.add(item.nameKey);

    const appTitle = mirrorTitleFor(item);
    const reminderTitle = reminder.title.trim();
    // A rename in the Reminders app is text, not fields, so it has to be split
    // the way an add field would split it before either side can hold it.
    // Unparseable ("2 lb", with no name left) counts as no rename at all.
    const renamed =
      reminderTitle !== shadow.name ? normalizeMirrorTitle(reminderTitle) : null;
    const appRenamed = appTitle !== shadow.name;
    // Both sides changed, or only the app did: the app wins. Only the reminder
    // changed: it wins, and the row is renamed to match.
    const takeReminderName = renamed != null && !appRenamed;
    const title = takeReminderName ? renamed.title : appTitle;

    const reminderChecked = reminder.completed;
    const takeReminderChecked =
      reminderChecked !== shadow.checked && item.checked === shadow.checked;
    const checked = takeReminderChecked ? reminderChecked : item.checked;

    if (takeReminderName) {
      plan.renameItems.push({
        itemId: item.id,
        name: renamed.name,
        quantity: renamed.quantity,
        title: renamed.title,
      });
    }
    if (checked !== item.checked) plan.setChecked.push({ itemId: item.id, checked });
    if (title !== reminderTitle || checked !== reminderChecked) {
      plan.updateReminders.push({
        reminderId: reminder.id,
        itemId: item.id,
        title,
        completed: checked,
      });
    }
    plan.links.push({ reminderId: reminder.id, itemId: item.id, name: title, checked, seen: true });
  };

  // Pass 1 — the links we already hold.
  for (const link of links) {
    const reminder = remindersById.get(link.reminderId);
    const item = itemsById.get(link.itemId);
    const live = item?.onList === true;

    if (!reminder && !live) continue; // Both gone. Nothing to mirror, nothing to say.
    if (!reminder && item && live) {
      // Never confirmed, so its absence proves nothing — see `seen`. Dropping
      // the link hands the row to pass 3, which writes it a fresh reminder.
      if (!link.seen) continue;
      // Deleted in the Reminders app. The row comes off the list and stays in
      // the catalog — `removeFromList` parks rather than deletes, so nothing
      // recorded about the item (its aisle, its store, its price) is lost.
      plan.removeItems.push({ itemId: item.id });
      claimedItems.add(item.id);
      if (item.nameKey) claimedKeys.add(item.nameKey);
      continue;
    }
    if (reminder && !live) {
      // Removed here — off the list, cleared after a shop, or deleted outright.
      plan.deleteReminders.push({ reminderId: reminder.id, link });
      claimedReminders.add(reminder.id);
      continue;
    }
    if (reminder && item) reconcilePair(reminder, item, link);
  }

  // Pass 2 — reminders nothing claims: adopt, or import.
  for (const reminder of reminders) {
    if (!reminder.id || claimedReminders.has(reminder.id)) continue;
    const title = reminder.title.trim();
    if (!title) continue;
    // A reminder we have never seen and that is already done is history, not a
    // capture. Same licence `importableReminders` draws: this mirror's right to
    // write anywhere comes from having taken custody of an open reminder.
    if (reminder.completed) continue;

    const key = itemKeyFor(title);
    if (!key || claimedKeys.has(key)) continue;

    const match = itemsByKey.get(key);
    if (match && match.onList && !claimedItems.has(match.id)) {
      // Already on both lists, just never linked: a second device's push, a
      // name typed into both apps, or the first pass after switching this on.
      // Adopting is the whole no-duplicates guarantee.
      reconcilePair(reminder, match, { name: title, checked: reminder.completed });
      continue;
    }

    plan.addItems.push({ reminderId: reminder.id, title });
    claimedReminders.add(reminder.id);
    claimedKeys.add(key);
    if (match) claimedItems.add(match.id);
  }

  // Pass 3 — rows nothing claims: write a reminder for them.
  for (const item of items) {
    if (!item.onList || claimedItems.has(item.id)) continue;
    if (item.nameKey && claimedKeys.has(item.nameKey)) continue;
    // A row already in the cart with no reminder behind it is not worth
    // writing one for: switching this on mid-shop would otherwise post a
    // completed reminder for everything already picked up, which is a list of
    // things nobody has to buy. It gets one if it's ever un-ticked.
    if (item.checked) continue;
    const title = mirrorTitleFor(item);
    if (!title) continue;
    plan.createReminders.push({ itemId: item.id, title });
    claimedItems.add(item.id);
    if (item.nameKey) claimedKeys.add(item.nameKey);
  }

  return plan;
}
