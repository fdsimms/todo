import type { FoodLogEntry } from '../types';
import type { FoodLogDraft } from '../store/useFoodLogStore';
import { getLogicalDayKey } from './dateUtils';

/**
 * A food log row from a draft, or null for one the log refuses.
 *
 * `useFoodLogStore.addEntry`'s core, lifted out so the MCP server can write an
 * entry without the store, which it cannot load: the store reaches Apple Health
 * and React Native. Same move `taskDraft.ts` and `taskCompletion.ts` made for
 * tasks, and for their reason: a second copy of these rules would drift from
 * the first the next time either changed. The store still owns what is not a
 * row (its windows, and the Health write, which only the device a meal was
 * logged on may make).
 *
 * `siblingsOn` reads a day's rows from SQLite rather than from a loaded window:
 * a meal logged onto a day the screen is not showing must still append to that
 * day's order, not tie with its first row.
 */
export function buildFoodLogEntry(
  draft: FoodLogDraft,
  siblingsOn: (dayKey: string) => readonly FoodLogEntry[],
  newId: () => string,
  now: Date = new Date(),
): FoodLogEntry | null {
  const label = draft.label.trim();
  // An entry with nothing to call it renders as a blank row on a day's list,
  // which is a thing eaten that nobody can identify. Refused rather than
  // stored, the same call addLog makes about an entry recording nothing.
  if (!label) return null;
  if (Object.keys(draft.nutrition.amounts).length === 0) return null;

  const at = draft.at ?? now;
  const dayKey = getLogicalDayKey(at);
  // Appended to the bottom of the day's one running order, same "max + 1"
  // rule Task.sortOrder and TaskGroup.sortOrder both stamp a new row with —
  // never 0, or a manual reorder would be re-shuffled by the next add.
  const daySiblings = siblingsOn(dayKey);
  const sortOrder = daySiblings.length ? Math.max(...daySiblings.map(e => e.sortOrder)) + 1 : 0;
  return {
    id: newId(),
    dayKey,
    atISO: at.toISOString(),
    slot: draft.slot ?? null,
    label,
    recipeId: draft.recipeId ?? null,
    itemId: draft.itemId ?? null,
    productId: draft.productId ?? null,
    mealPlanEntryId: draft.mealPlanEntryId ?? null,
    quantity: draft.quantity.trim(),
    grams: draft.grams,
    nutrition: draft.nutrition,
    sourcePanel: draft.sourcePanel ?? null,
    // Empty at insert. Only the store's Health write fills it, on the device
    // the meal was logged on.
    healthSampleIds: [],
    sortOrder,
    createdAt: now.toISOString(),
  };
}
