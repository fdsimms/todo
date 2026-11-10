import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Category, GroceryItem, ItemProduct, ItemSubLink, Person, Project, Recipe, Task } from '../types';
import { backfillFieldCounts, backfillFieldsFor } from './fieldBackfill';
import { categoryBackfillFieldCounts } from './categoryBackfill';
import { projectBackfillFieldCounts } from './projectBackfill';
import { personBackfillFieldCounts } from './peopleBackfill';
import { itemBackfillFieldCounts } from './itemBackfill';
import { recipeBackfillFieldCounts } from './recipeBackfill';
import { dayKeyToDate } from './dateUtils';
import { generatedSourceOf } from './generatedTasks';
import { BACKFILL_AREAS, isBackfillArea, type BackfillArea } from './backfillAreas';

export { BACKFILL_AREAS, isBackfillArea, type BackfillArea };

/**
 * "Fill in missing details" — an offer to open the Backfill screen on one pool
 * once that pool has a lot waiting.
 *
 * **Structurally `pantryReview`, once per pool.** The source id is the pool's
 * name (`BackfillArea`), so each pool has at most one live row and a threshold
 * and a "don't hand it straight back" mark of its own. There is no source row a
 * decline could be stamped on, so the mark lives in settings
 * (`backfillLastDayKeys`, one day key per pool), the position `pantryReview`
 * and `calendarReview` are already in.
 *
 * **The count is the one the Backfill field picker already shows**, summed over
 * the fields it offers (`backfillFieldCounts` and its siblings), so the row can
 * never promise a queue the screen would open empty. A row missing two fields
 * counts twice, the same as it does on the picker.
 */

/** The two pools that belong to the groceries/recipes/meal plan area, and go away with it. */
export const BACKFILL_KITCHEN_AREAS: ReadonlySet<BackfillArea> = new Set<BackfillArea>(['item', 'recipe']);

/**
 * Titles never carry a count: a number in them goes stale as the queue is
 * worked, and the row shows on the widget and in Search, which render no meta
 * line. Each names the verb and the subject together, like the other review rows.
 */
export const BACKFILL_TITLES: Record<BackfillArea, string> = {
  task: 'Fill in missing task details',
  category: 'Fill in missing category details',
  project: 'Fill in missing project details',
  person: 'Fill in missing details for people',
  item: 'Fill in missing grocery item details',
  recipe: 'Fill in missing recipe details',
};

export const BACKFILL_THRESHOLD_MIN = 3;
export const BACKFILL_THRESHOLD_MAX = 200;
export const BACKFILL_THRESHOLD_DEFAULT = 10;

/**
 * How often a pool's offer can come round, in days.
 *
 * A backlog is a slow chore, and one that returned daily would be nagging. Weekly
 * keeps it on the list without it being swiped away over and over.
 */
export const BACKFILL_CADENCE_DAYS = 7;

/** The Backfill screen's own link, optionally opened on one pool. */
export const BACKFILL_LINK_URL = 'dundundun://backfill';

export function backfillLinkUrl(area: BackfillArea): string {
  return `${BACKFILL_LINK_URL}?area=${area}`;
}

/** The pool a backfill row was raised for, or null for any other task. */
export function backfillAreaOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): BackfillArea | null {
  const id = generatedSourceOf(task, 'backfill');
  return isBackfillArea(id) ? id : null;
}

export type BackfillLastDayKeys = Partial<Record<BackfillArea, string>>;

/** Reads the stored marks, dropping anything that is not a pool name and a string. */
export function parseBackfillLastDayKeys(raw: string | null | undefined): BackfillLastDayKeys {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: BackfillLastDayKeys = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isBackfillArea(key) && typeof value === 'string' && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function clampBackfillThreshold(value: number): number {
  return Math.max(BACKFILL_THRESHOLD_MIN, Math.min(BACKFILL_THRESHOLD_MAX, Math.round(value)));
}

/**
 * Whether enough time has passed since this pool's last offer. A null or
 * unparseable mark qualifies: the mark is a convenience, and the worst a bad
 * value can do here is cost one offer.
 */
export function backfillCadenceElapsed(
  lastDayKey: string | null | undefined,
  today: Date,
  cadenceDays: number = BACKFILL_CADENCE_DAYS
): boolean {
  if (!lastDayKey) return true;
  const last = dayKeyToDate(lastDayKey);
  if (Number.isNaN(last.getTime())) return true;
  return differenceInCalendarDays(today, last) >= cadenceDays;
}

export interface BackfillCountInput {
  tasks: Task[];
  categories: Category[];
  projects: Project[];
  people: Person[];
  items: GroceryItem[];
  itemSubs: ItemSubLink[];
  nonFoodAisles: readonly string[];
  itemProducts: readonly ItemProduct[];
  recipes: Recipe[];
  simpleMode: boolean;
  rewardsEnabled: boolean;
  holidaysConfigured: boolean;
  kitchenEnabled: boolean;
}

const sum = (counts: Record<string, number>, ids?: readonly string[]): number =>
  Object.entries(counts).reduce((n, [id, c]) => (!ids || ids.includes(id) ? n + c : n), 0);

/**
 * How many cards each pool has waiting, as the Backfill screen would offer
 * them. Task fields the screen hides (difficulty with rewards off, holidays
 * with none set up, anything simple mode takes away) are left out here too. The
 * kitchen pools read 0 with the area off.
 */
export function backfillAreaCounts(input: BackfillCountInput): Record<BackfillArea, number> {
  const taskFieldIds = backfillFieldsFor(input.simpleMode, input.rewardsEnabled, input.holidaysConfigured).map(f => f.id);
  return {
    task: sum(backfillFieldCounts(input.tasks, input.categories), taskFieldIds),
    category: sum(categoryBackfillFieldCounts(input.categories)),
    project: sum(projectBackfillFieldCounts(input.projects)),
    person: sum(personBackfillFieldCounts(input.people)),
    item: input.kitchenEnabled
      ? sum(itemBackfillFieldCounts(input.items, input.itemSubs, input.nonFoodAisles, input.itemProducts))
      : 0,
    recipe: input.kitchenEnabled ? sum(recipeBackfillFieldCounts(input.recipes)) : 0,
  };
}

/** Whether a pool's backlog is big enough to be worth one row. */
export function wantsBackfillTask(count: number, threshold: number): boolean {
  return count > 0 && count >= threshold;
}

/**
 * Live rows whose pool has nothing left. Judged on the queue being empty, not
 * on the threshold: a row already raised is not taken back because answering
 * some cards put the pool under it (`stalePantryReviewTasks`' rule).
 */
export function staleBackfillTasks<T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>>(
  tasks: readonly T[],
  counts: Record<BackfillArea, number>
): T[] {
  return tasks.filter(t => {
    if (t.generatedKind !== 'backfill' || t.completed || t.archived) return false;
    const area = backfillAreaOf(t);
    return area === null || counts[area] === 0;
  });
}
