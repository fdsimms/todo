import type { GroceryItem } from '../types';
import { groceryNameKey } from './groceryParse';
import { catalogItemForKey } from './groceryPlural';
import { OUT_OF_IT_UNTIL } from './grocerySuggest';
import type { DisposalOutcome } from './itemDisposal';

/**
 * One catalog row as Siri can see it: an id to act on and a name to hear.
 *
 * Deliberately not a `GroceryItem` subset with more on it. This is the one
 * thing in the app written somewhere a *different process* reads and then
 * speaks back to the user, so it carries the two fields the intent needs and
 * nothing that would make a stale copy say something wrong about the row — a
 * quantity, an aisle or a use-by date read out of a file written before the
 * last shop is worse than silence.
 */
export interface PantryIndexEntry {
  id: string;
  name: string;
}

/**
 * A ceiling on how many rows the intent process has to read, not a product
 * decision: the catalog is unbounded and this file is parsed inside an
 * `EntityStringQuery` that Siri is waiting on. At ~50 bytes an entry the cap is
 * some tens of kilobytes, well under anything that would be felt, and a catalog
 * large enough to hit it has long since stopped being a list anybody dictates
 * from.
 */
export const MAX_PANTRY_INDEX_ENTRIES = 500;

/**
 * The rows "mark X used up" can actually do something to, for
 * `MarkDisposedIntent`'s entity query to match a spoken name against.
 *
 * **The filter is `markOutOfMany`'s own**, deliberately rather than
 * `pantryEntries`' richer idea of what you have. That action takes the rows
 * whose `onHandUntil` isn't already the out-of-it sentinel and no-ops on the
 * rest, so any wider set here offers Siri names whose marks return 0 and
 * change nothing — the user says a sentence, the app comes forward, and
 * nothing happens, with no way to tell that from a failure. Narrower would be
 * worse in the other direction: `probablyHaveReason` answers null for a row
 * the app has no opinion about, and a row nobody has bought through the app is
 * exactly the one somebody is most likely to have to say out loud.
 *
 * Sorted by name so an unchanged catalog serialises to identical bytes. The
 * index rides the widget snapshot's debounce, which fires on any grocery
 * write, and most of those don't touch this set at all.
 */
export function buildPantryIndex(items: readonly GroceryItem[]): PantryIndexEntry[] {
  return items
    .filter(item => item.onHandUntil !== OUT_OF_IT_UNTIL && item.name.trim() !== '')
    .map(item => ({ id: item.id, name: item.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_PANTRY_INDEX_ENTRIES);
}

/** One thing said to Siri, waiting for a foreground to be applied. */
export interface QueuedDisposal {
  id: string | null;
  name: string;
  outcome: DisposalOutcome;
}

/**
 * The queue `drainPendingDisposals` hands back, as far as it can be trusted.
 *
 * **Every entry is checked rather than cast.** This is the one input in the app
 * that crossed a process boundary as a file: it was written by an intent
 * running against whatever build of the app was installed at the time, which
 * after an update need not be this one. A field added or an outcome renamed
 * later would arrive here as a shape the types promise and the data doesn't,
 * and the failure would be a `undefined` walked into the store rather than
 * anything that announces itself.
 *
 * Unparseable and empty are one answer, deliberately: the native half deletes
 * the file whether or not it decoded, so there is nothing to recover and
 * nothing to retry. Silence is the honest outcome — the alternative is an alert
 * about a sentence the user said a while ago and has stopped thinking about.
 */
export function parseQueuedDisposals(json: string): QueuedDisposal[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const parsed: QueuedDisposal[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, outcome } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (outcome !== 'usedUp' && outcome !== 'spoiled') continue;
    parsed.push({ id: typeof id === 'string' && id !== '' ? id : null, name, outcome });
  }
  return parsed;
}

/**
 * The row a queued disposal is about: the id Siri resolved, else the name it
 * heard.
 *
 * **Both halves are queued and both are needed.** The id is the better answer
 * — Siri picked it against the index, with its own disambiguation UI if the
 * spoken name matched more than one row — but it is a pointer into a file
 * written at some earlier moment, so it can name a row deleted or merged
 * since. `markOutOfMany` resolve-or-shrugs on an unknown id exactly as every
 * other cross-row pointer in this app does, which here means returning 0 and
 * changing nothing: the user says a sentence, the app comes forward, and the
 * silence is indistinguishable from it having worked.
 *
 * So a miss falls back to the name, through the same `groceryNameKey` +
 * `catalogItemForKey` lookup every find-or-insert in the app uses — which also
 * buys the plural handling the id path doesn't need and the spoken path very
 * much does. "Bananas" finds the row called "Banana".
 *
 * Returns null when neither answers, which is the honest outcome for a name
 * that has no row: this deliberately never mints one. Saying you finished
 * something the catalog has never heard of is far more likely to be a
 * misheard word than a new item worth filing.
 */
export function resolveQueuedPantryItem(
  queued: { id?: string | null; name?: string | null },
  items: readonly GroceryItem[]
): GroceryItem | null {
  if (queued.id) {
    const byId = items.find(item => item.id === queued.id);
    if (byId) return byId;
  }
  const name = queued.name?.trim();
  if (!name) return null;
  return catalogItemForKey(groceryNameKey(name), items);
}
