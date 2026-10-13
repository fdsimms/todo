import type { GroceryItem } from '../types';
import { GROCERY_NAME_MAX_LENGTH } from '../types';
import { groceryNameKey } from './groceryParse';

/**
 * One item, more than one name: "kombu" on dashima, "scallions" on green onions.
 *
 * `GroceryItem.otherNames` holds the names as typed and the keys are derived
 * here, at read time, so there is no second key column to disagree with them.
 * Every reader that joins a recipe line to the catalog by `nameKey` goes
 * through `itemKeyIndex` (or `catalogItemForKey`, which calls this) instead of
 * building its own map, which is the whole mechanism: a line reading "kombu"
 * finds the dashima row, its panel, its price and its pantry state without any
 * of those readers learning that aliases exist.
 *
 * Three rules keep it from merging things that were never meant to merge:
 *
 * - **An item's own name always wins.** A name that is some item's primary key
 *   is never also an alias of another item, whichever was written first.
 * - **A name two items both claim resolves to neither.** The same refusal
 *   `resolvePluralKey` makes: a coin flip that writes to a row is worse than
 *   a line left unmatched.
 * - **Nothing is renamed.** A line reached through an alias keeps its own
 *   words; the join is read-time only.
 */

/** The derived keys of an item's other names, without its own key or repeats. */
export function otherNameKeysOf(item: Pick<GroceryItem, 'nameKey' | 'otherNames'>): string[] {
  const seen = new Set<string>([item.nameKey]);
  const out: string[] = [];
  for (const name of item.otherNames ?? []) {
    const key = groceryNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Alias key → the one item that claims it. Keys that are some item's primary
 * name, and keys claimed by more than one item, are left out.
 */
export function aliasIndex(items: readonly GroceryItem[]): Map<string, GroceryItem> {
  let primary: Set<string> | null = null;
  const claimed = new Map<string, GroceryItem>();
  const contested = new Set<string>();
  for (const item of items) {
    if (!item.otherNames || item.otherNames.length === 0) continue;
    primary ??= new Set(items.map(i => i.nameKey));
    for (const key of otherNameKeysOf(item)) {
      if (primary.has(key)) continue;
      const other = claimed.get(key);
      if (other && other.id !== item.id) contested.add(key);
      else claimed.set(key, item);
    }
  }
  for (const key of contested) claimed.delete(key);
  return claimed;
}

/**
 * The map every `nameKey` join builds: each item under its own key, then each
 * item's other names under theirs. A catalog never holds two rows with one
 * primary key, so the order among primaries is moot.
 */
export function itemKeyIndex(items: readonly GroceryItem[]): Map<string, GroceryItem> {
  const byKey = new Map<string, GroceryItem>();
  for (const item of items) if (!byKey.has(item.nameKey)) byKey.set(item.nameKey, item);
  for (const [key, item] of aliasIndex(items)) if (!byKey.has(key)) byKey.set(key, item);
  return byKey;
}

/** The item `key` is another name of, or null. Primary names are not consulted. */
export function itemForOtherName(key: string, items: readonly GroceryItem[]): GroceryItem | null {
  if (!key) return null;
  return aliasIndex(items).get(key) ?? null;
}

export interface OtherNamesResult {
  /** The names to store, trimmed, deduplicated and without anything refused. */
  names: string[];
  /** Names left out, each with the plain reason, for the caller to show. */
  refused: { name: string; reason: string }[];
}

/**
 * The list to store for `id` given what was typed. Pure; the caller writes it.
 *
 * Refuses an empty name, the item's own name, a repeat, and a name that already
 * belongs to another item (as its name or as its own other name), because
 * accepting it would make a recipe line ambiguous.
 */
export function cleanOtherNames(
  items: readonly GroceryItem[],
  id: string,
  typed: readonly string[]
): OtherNamesResult {
  const self = items.find(i => i.id === id);
  const others = items.filter(i => i.id !== id);
  const taken = new Map<string, string>();
  for (const item of others) {
    taken.set(item.nameKey, item.name);
    for (const key of otherNameKeysOf(item)) if (!taken.has(key)) taken.set(key, item.name);
  }
  const names: string[] = [];
  const refused: { name: string; reason: string }[] = [];
  const seen = new Set<string>(self ? [self.nameKey] : []);
  for (const raw of typed) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, GROCERY_NAME_MAX_LENGTH).trim();
    const key = groceryNameKey(name);
    if (!key) continue;
    if (self && key === self.nameKey) {
      refused.push({ name, reason: 'That is already this item’s name.' });
    } else if (seen.has(key)) {
      continue;
    } else if (taken.has(key)) {
      refused.push({ name, reason: `“${taken.get(key)}” already uses that name.` });
    } else {
      seen.add(key);
      names.push(name);
    }
  }
  return { names, refused };
}
