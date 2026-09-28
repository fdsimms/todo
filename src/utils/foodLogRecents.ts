import type { FoodLogEntry } from '../types';
import { foodLogEntryEdit, type FoodLogEntryEdit } from './foodLog';

/**
 * What somebody actually eats, for the list they pick it from.
 *
 * **The one reader of `FoodLogEntry.itemId`, and the thing that makes filing a
 * food worth doing.** The entry sheet offered its whole catalog in insertion
 * order, first forty rows, so a food eaten every morning could sit below forty
 * things bought once — and "file it and it's here to pick next time" was true
 * of the list's contents and false of anywhere you'd find it. Linking an entry
 * to a row now buys something: the row comes back up.
 *
 * **It counts ids, never labels.** `mostLoggedFoods` in `nutritionStats.ts`
 * falls back to the label for an entry linked to nothing, and is right to: it
 * reports what a person ate, and dropping every hand-typed food would misreport
 * that. This asks a different question — which of the rows *on this list* to
 * put in front — and a row is an id. The difference shows exactly where this feature lives: a food found in a
 * database and filed onto the Milk row logs under its own database description
 * one week and under "Milk" the next, which is two labels and one row.
 *
 * **A box credits its item as well as itself**, because eating one of an item's
 * boxes is eating the item. Both candidates are offered on the list, and
 * floating the specific pot while leaving the generic food forty rows down
 * would be the same complaint again one level in.
 *
 * **A row also remembers how much it was last eaten in** (`foodLastAmounts`),
 * because the food that floats to the top every morning is usually eaten in
 * the same amount every morning too, and a picker that finds it in one tap and
 * then asks for "250" again has only done half the job.
 *
 * Nothing here reaches a store or a database, so the ranking that decides what
 * a person is offered can be exercised without either.
 */

/** How much a row has been eaten, and when last. */
export interface FoodRecency {
  count: number;
  /** The most recent entry's instant, for breaking ties on count. */
  lastAtISO: string;
}

/**
 * The candidate keys one entry credits.
 *
 * The strings are the entry sheet's own candidate keys rather than bare ids,
 * so the map below is looked up with the key a row already has and neither
 * side has to know how the other spells a product.
 */
export function creditedKeys(entry: Pick<FoodLogEntry, 'itemId' | 'productId' | 'recipeId'>): string[] {
  const keys: string[] = [];
  if (entry.productId) keys.push(`p:${entry.productId}`);
  if (entry.itemId) keys.push(`i:${entry.itemId}`);
  if (entry.recipeId) keys.push(`r:${entry.recipeId}`);
  return keys;
}

/** How often and how recently each row was logged, over whatever entries it is given. */
export function foodLogRecency(entries: readonly FoodLogEntry[]): Map<string, FoodRecency> {
  const out = new Map<string, FoodRecency>();
  for (const entry of entries) {
    for (const key of creditedKeys(entry)) {
      const seen = out.get(key);
      if (!seen) {
        out.set(key, { count: 1, lastAtISO: entry.atISO });
        continue;
      }
      seen.count += 1;
      if (entry.atISO > seen.lastAtISO) seen.lastAtISO = entry.atISO;
    }
  }
  return out;
}

/**
 * The amount each row was last logged in, so eating the same thing again is a
 * tap rather than a retype.
 *
 * **Credited to the entry's own row only**, never to the item behind a box.
 * `creditedKeys` credits both for ranking, because eating a pot of yogurt is
 * eating yogurt. An amount is a different claim: "1 container" is a portion of
 * that pot's panel and may mean nothing to the generic row's, so each row
 * remembers only what was logged against it.
 *
 * **The most recent entry decides, even when it can't be read back.** A dish
 * logged with "Anything else?" lines has no amount a correction would reopen
 * on (`foodLogEntryEdit`), and reaching past it to an older entry would offer
 * an amount that isn't the last one. Such a row recalls nothing.
 *
 * What comes back is the amount as it was written. Whether it still means
 * anything to the food's panel today is `recallAmount`'s question
 * (`foodLog.ts`), asked when the row is picked.
 */
export function foodLastAmounts(entries: readonly FoodLogEntry[]): Map<string, FoodLogEntryEdit | null> {
  const latest = new Map<string, FoodLogEntry>();
  for (const entry of entries) {
    const own = creditedKeys(entry)[0];
    if (!own) continue;
    const seen = latest.get(own);
    if (!seen || entry.atISO > seen.atISO) latest.set(own, entry);
  }
  const out = new Map<string, FoodLogEntryEdit | null>();
  for (const [key, entry] of latest) out.set(key, foodLogEntryEdit(entry));
  return out;
}

/**
 * The same candidates, with the ones that have been eaten in front.
 *
 * **Two groups, and the order inside the second one is not touched.** A list
 * that re-sorts wholesale as you type is one you cannot learn, which is the
 * objection `filterEditorRows` refuses ranking over and `CategoryPicker` keeps
 * its own order for. So this promotes rather than sorts: everything logged
 * moves above everything unlogged, ordered by how often and then how recently,
 * and the long tail of things nobody has eaten stays in exactly the order it
 * arrived in. Filtering the list narrows both groups without shuffling either.
 *
 * A food logged under no row at all — an estimate, a database result nobody
 * filed — credits nothing and so promotes nothing. That is the honest answer
 * rather than a gap: there is no row for it to be.
 */
export function rankByRecency<T extends { key: string }>(
  candidates: readonly T[],
  recency: ReadonlyMap<string, FoodRecency>,
): T[] {
  const eaten: T[] = [];
  const rest: T[] = [];
  for (const candidate of candidates) {
    (recency.has(candidate.key) ? eaten : rest).push(candidate);
  }
  eaten.sort((a, b) => {
    const left = recency.get(a.key)!;
    const right = recency.get(b.key)!;
    if (left.count !== right.count) return right.count - left.count;
    if (left.lastAtISO !== right.lastAtISO) return right.lastAtISO < left.lastAtISO ? -1 : 1;
    return 0;
  });
  return [...eaten, ...rest];
}
