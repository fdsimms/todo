import type { TaskKind } from './taskKinds';
import { TASK_KINDS } from './taskKinds';

/**
 * Simplified mode — the one switch that takes the app down to an ordinary
 * todo/kitchen app.
 *
 * Thirty-odd capabilities have accumulated here that a person who wants a list
 * of things to do never asked for: chains, quotas, timed tasks, blockers,
 * focus sessions, drift, backfill, barcode scanning, receipt import, product
 * variants, standing swaps. Each earns its place for whoever uses it, and each
 * costs everybody else a row in a picker, an icon in a header or a line in a
 * menu. `simpleMode` is the way to say "not for me" once instead of thirty
 * times.
 *
 * **It is a display setting and nothing else.** Same two rules
 * `simpleTaskForm.ts` sets out, and they are what make it safe to flip:
 *
 * 1. It changes what is *rendered*, never what is stored. No field is cleared,
 *    no row is deleted, no default changes. Turn it off and every feature is
 *    back exactly as it was, with its data intact.
 * 2. **A feature already in use stays on show.** A task that is a chain still
 *    renders its chain; a grocery item that already tracks three brands still
 *    lists them. The mode stops you *reaching for* a capability you don't
 *    want; it never hides something you already said. Every gate below takes a
 *    `set` argument for exactly this, and the editor gets it for free — an
 *    `EditorGroupRow` already declares whether it holds a value.
 *
 * **Screens split two ways under that second rule**, which is the one
 * non-obvious thing here. Calendar, Stats, Backfill and Stuck are *lenses*:
 * every task they show is reachable from Today or Search, so hiding them
 * costs nothing and they go unconditionally. Stacks, Templates, People and
 * Mood hold objects that live nowhere else, so hiding them while the user has
 * some would strand real data — those four survive as long as they hold
 * anything (see `screenShown`). An install with none of them loses all four
 * rows; an install with four stacks keeps the one row that can edit them.
 * Mood was declared one of the four from the start but had no branch in
 * `screenShown` for a long time, so it alone was shown unconditionally,
 * including on an install with no entries at all.
 *
 * The list below is the whole scope of the feature. Adding an id here does
 * nothing on its own — a gate has to exist for it — so `simpleMode.test.ts`
 * asserts every id is spent somewhere: named at a call site, mapped to an
 * editor or grocery row below, or carrying a `screen`. The Settings row renders
 * `SIMPLE_FEATURES` directly, so the switch says what it takes away rather than
 * making the user find out; an id listed there and gated nowhere would be a
 * promise the app doesn't keep.
 */

export type SimpleArea = 'tasks' | 'screens' | 'today' | 'kitchen';

export type SimpleFeatureId =
  // What a task can be, beyond a line of text with a date on it.
  | 'timedTasks'
  | 'dailyTargets'
  | 'supplies'
  | 'chains'
  | 'taskSeries'
  | 'deadlines'
  | 'timeWindows'
  | 'timeBlocks'
  | 'blocking'
  | 'followUpTasks'
  | 'deliverables'
  | 'people'
  | 'stacks'
  | 'streakOptions'
  | 'vacationPause'
  | 'effortRating'
  | 'calendarImport'
  // Screens behind the menu.
  | 'templates'
  | 'calendarScreen'
  | 'statsScreen'
  | 'moodScreen'
  | 'backfillScreen'
  | 'stuckScreen'
  // Everything Today offers besides the list itself.
  | 'focusSessions'
  | 'suggestedPins'
  | 'lookAhead'
  | 'deload'
  | 'workloadSubtitle'
  | 'unscheduledLens'
  | 'paintSelect'
  // The kitchen's deep end. The list, the catalog, aisles, recipes and the
  // meal plan all stay — this is the machinery underneath them.
  | 'barcodeScanning'
  | 'receiptImport'
  | 'shoppingTrips'
  | 'pantryTracking'
  | 'productVariants'
  | 'itemChoices'
  | 'substitutes'
  | 'recipeComposition'
  | 'recipeScaling'
  | 'cookMode';

export interface SimpleFeature {
  id: SimpleFeatureId;
  /**
   * What disappears, named the way the user would name it. Rendered verbatim
   * in Settings under the switch, so it reads as a list of things rather than
   * as a list of settings keys.
   */
  label: string;
  area: SimpleArea;
  /**
   * The route this feature *is*, where it's a whole screen. `SIMPLE_HIDDEN_SCREENS`
   * and `SIMPLE_CONTENT_SCREENS` are built from these rather than written out
   * again, so a screen feature can't be listed in Settings and then not gated.
   */
  screen?: string;
  /**
   * A screen holding objects reachable from nowhere else, so it survives as
   * long as it holds any — see `screenShown`.
   */
  contentScreen?: boolean;
}

/** Heading for each area's list of features, in Settings. */
export const SIMPLE_AREA_LABELS: Record<SimpleArea, string> = {
  tasks: 'Task options',
  screens: 'Screens',
  today: 'On the Today screen',
  kitchen: 'Groceries and recipes',
};

export const SIMPLE_AREAS: readonly SimpleArea[] = ['tasks', 'screens', 'today', 'kitchen'];

/**
 * Every capability the switch takes away, in the order Settings lists them.
 *
 * Labels are the user's words, not the code's: "Stacks" rather than
 * `TaskGroup`, "Pantry and freezer tracking" rather than `kitchenInventory`.
 */
export const SIMPLE_FEATURES: readonly SimpleFeature[] = [
  { id: 'timedTasks', label: 'Timed tasks', area: 'tasks' },
  { id: 'dailyTargets', label: 'Daily targets', area: 'tasks' },
  { id: 'supplies', label: 'Supplies', area: 'tasks' },
  { id: 'chains', label: 'Chains', area: 'tasks' },
  { id: 'taskSeries', label: 'Several dates for one task', area: 'tasks' },
  { id: 'deadlines', label: 'Deadlines', area: 'tasks' },
  { id: 'timeWindows', label: 'Time windows', area: 'tasks' },
  { id: 'timeBlocks', label: 'Time blocks on your calendar', area: 'tasks' },
  { id: 'blocking', label: 'Waiting on and Blocks', area: 'tasks' },
  { id: 'followUpTasks', label: 'Follow-up tasks', area: 'tasks' },
  { id: 'deliverables', label: 'Ask on completion', area: 'tasks' },
  { id: 'stacks', label: 'Stacks', area: 'tasks', screen: 'Stacks', contentScreen: true },
  { id: 'streakOptions', label: 'Streak options', area: 'tasks' },
  { id: 'vacationPause', label: 'Vacation pause', area: 'tasks' },
  { id: 'effortRating', label: 'Effort', area: 'tasks' },
  { id: 'calendarImport', label: 'Import event from photo or text', area: 'tasks' },

  { id: 'templates', label: 'Templates', area: 'screens', screen: 'Templates', contentScreen: true },
  // A content screen like Stacks and Templates: it holds Person rows that live
  // nowhere else, so hiding it while it holds any would strand them.
  { id: 'people', label: 'People', area: 'screens', screen: 'People', contentScreen: true },
  { id: 'calendarScreen', label: 'Calendar', area: 'screens', screen: 'Calendar' },
  { id: 'statsScreen', label: 'Stats', area: 'screens', screen: 'Stats' },
  // A content screen like People and Stacks, not a plain hidden one: it holds
  // mood entries that live nowhere else in the app, so hiding it while it holds
  // any would strand them with no way back to them.
  { id: 'moodScreen', label: 'Mood', area: 'screens', screen: 'Mood', contentScreen: true },
  { id: 'backfillScreen', label: 'Backfill', area: 'screens', screen: 'Backfill' },
  { id: 'stuckScreen', label: 'Stuck', area: 'screens', screen: 'Stuck' },

  { id: 'focusSessions', label: 'Focus sessions', area: 'today' },
  { id: 'suggestedPins', label: 'Suggested pins', area: 'today' },
  { id: 'lookAhead', label: 'Look ahead', area: 'today' },
  { id: 'deload', label: 'Lighten an overloaded day', area: 'today' },
  { id: 'workloadSubtitle', label: 'The workload line under the title', area: 'today' },
  { id: 'unscheduledLens', label: 'The Unscheduled view', area: 'today' },
  { id: 'paintSelect', label: 'Drag to select a run of tasks', area: 'today' },

  { id: 'barcodeScanning', label: 'Barcode scanning', area: 'kitchen' },
  { id: 'receiptImport', label: 'Receipt scanning', area: 'kitchen' },
  { id: 'shoppingTrips', label: 'Shopping trips', area: 'kitchen' },
  { id: 'pantryTracking', label: 'Pantry and freezer tracking', area: 'kitchen', screen: 'Kitchen' },
  { id: 'productVariants', label: 'Brands and product variants', area: 'kitchen' },
  { id: 'itemChoices', label: 'Either/or items', area: 'kitchen' },
  { id: 'substitutes', label: 'Substitutes and standing swaps', area: 'kitchen' },
  { id: 'recipeComposition', label: 'Recipes inside recipes', area: 'kitchen' },
  { id: 'recipeScaling', label: 'Scaling a recipe', area: 'kitchen' },
  { id: 'cookMode', label: 'Reading a recipe step by step', area: 'kitchen' },
];

/** The features in one area, for a Settings list that groups them. */
export function simpleFeaturesIn(area: SimpleArea): SimpleFeature[] {
  return SIMPLE_FEATURES.filter(f => f.area === area);
}

const SIMPLE_FEATURE_IDS: ReadonlySet<SimpleFeatureId> = new Set(SIMPLE_FEATURES.map(f => f.id));

/**
 * Is this capability out of reach right now?
 *
 * Takes the id rather than being a bare `if (simpleMode)` at every call site so
 * the gates are greppable — "what does simplified mode do to chains" is one
 * search — and so the test below can prove nothing on the list was forgotten.
 */
export function featureHidden(id: SimpleFeatureId, simpleMode: boolean): boolean {
  return simpleMode && SIMPLE_FEATURE_IDS.has(id);
}

/**
 * Should this capability be on show?
 *
 * `set` is rule 2: a feature the user is already using is never taken away,
 * whatever the mode says. Pass whether *this* task/item/recipe uses it, not
 * whether anything anywhere does.
 */
export function featureShown(id: SimpleFeatureId, simpleMode: boolean, set = false): boolean {
  return set || !featureHidden(id, simpleMode);
}

/**
 * Route names dropped outright — from the menu, or from Settings where the
 * screen is reached from there (Backfill).
 *
 * All five are lenses over tasks, fields and pantry state that Today, Search
 * and the grocery list already reach, so nothing here can strand data. Stacks,
 * Templates, People and Mood are deliberately *not* in this set — see
 * `screenShown`. Pantry is here rather than being a special case in the
 * navigator and a second `featureHidden` call in `HubPills`: it is the screen
 * for the per-item pantry, freezer and use-by state the mode also takes off
 * the item sheet, so with nothing left to fill it there is nothing left for it
 * to show.
 */
export const SIMPLE_HIDDEN_SCREENS: ReadonlySet<string> = new Set(
  SIMPLE_FEATURES.filter(f => f.screen && !f.contentScreen).map(f => f.screen!)
);

/** The screens that hold objects reachable from nowhere else. */
export const SIMPLE_CONTENT_SCREENS: ReadonlySet<string> = new Set(
  SIMPLE_FEATURES.filter(f => f.contentScreen).map(f => f.screen!)
);

/**
 * Does this menu row survive?
 *
 * `contentCounts` answers how many stacks, templates and people exist; a
 * content screen holding something keeps its row however simple the mode is,
 * because the alternative is a stack nobody can edit or delete again.
 * Everything not named in either set is always shown.
 */
export function screenShown(
  routeName: string,
  simpleMode: boolean,
  contentCounts: { stacks: number; templates: number; people?: number; mood?: number } = { stacks: 0, templates: 0 },
): boolean {
  if (!simpleMode) return true;
  if (SIMPLE_HIDDEN_SCREENS.has(routeName)) return false;
  if (routeName === 'Stacks') return contentCounts.stacks > 0;
  if (routeName === 'Templates') return contentCounts.templates > 0;
  if (routeName === 'People') return (contentCounts.people ?? 0) > 0;
  // Mood was declared a content screen from the start and never got its branch,
  // so it was the one of the four shown unconditionally — the row stayed on an
  // install with no entries at all, which is the opposite of what the flag on
  // it says. Every caller passes the count now.
  if (routeName === 'Mood') return (contentCounts.mood ?? 0) > 0;
  return true;
}

/**
 * `EditorGroupRow.key` → the capability it configures.
 *
 * Keys not listed here are the ordinary form and are never touched: title,
 * notes, date, time of day, repeat, remind me, category, project, tags,
 * priority, subtasks, pin, link, phone, email.
 *
 * `EditorGroup` applies this to its own rows, which is the whole of the task
 * editor's gating — one filter in one component rather than a condition
 * threaded through 23 rows of JSX. It works because a row already declares
 * `set`, so rule 2 costs nothing: `kind` reports `set: kind !== 'task'`, and a
 * chain task therefore keeps its picker while a plain one loses it.
 */
export const SIMPLE_EDITOR_ROW_FEATURES: Readonly<Record<string, SimpleFeatureId>> = {
  kind: 'chains',
  people: 'people',
  duration: 'timedTasks',
  dailyTarget: 'dailyTargets',
  supply: 'supplies',
  chain: 'chains',
  moreDates: 'taskSeries',
  deadline: 'deadlines',
  timeWindow: 'timeWindows',
  timeBlock: 'timeBlocks',
  waitingOn: 'blocking',
  blocks: 'blocking',
  followUpTask: 'followUpTasks',
  deliverable: 'deliverables',
  stack: 'stacks',
  effort: 'effortRating',
  vacation: 'vacationPause',
  streak: 'streakOptions',
  showStreak: 'streakOptions',
  streakRequiresWindow: 'streakOptions',
};

/**
 * Does an editor row render?
 *
 * The `kind` row is the one that needs explaining: it offers all four shapes,
 * so it's filed under `chains` arbitrarily — any of the three would do, and
 * the row is kept or dropped as a whole because a picker with one option is
 * not a picker. Its own `set` flag (the task isn't Standard) is what brings it
 * back for a task that already has a shape.
 */
export function editorRowShown(key: string, simpleMode: boolean, set: boolean): boolean {
  const feature = SIMPLE_EDITOR_ROW_FEATURES[key];
  if (!feature) return true;
  return featureShown(feature, simpleMode, set);
}

/**
 * The same, for `GroceryItemSheet`'s collapsible fields.
 *
 * A second map rather than one shared one: the two sheets have their own key
 * spaces and nothing to gain from sharing a namespace (both have a `products`
 * concept that means different things). Aisle, Stores and Used in are not
 * listed and never go — an item still has to be findable in the shop.
 */
export const SIMPLE_GROCERY_ROW_FEATURES: Readonly<Record<string, SimpleFeatureId>> = {
  products: 'productVariants',
  pantry: 'pantryTracking',
  useBy: 'pantryTracking',
  substitutes: 'substitutes',
  // Rides the substitutes switch rather than earning its own: both are the
  // "this item can stand in for that name" half of the catalog, and a mode
  // picker with one toggle per field is the complexity the mode exists to cut.
  varietyOf: 'substitutes',
};

/** Does a grocery item sheet field render? Same `set` rule as the editor's. */
export function groceryRowShown(key: string, simpleMode: boolean, set: boolean): boolean {
  const feature = SIMPLE_GROCERY_ROW_FEATURES[key];
  if (!feature) return true;
  return featureShown(feature, simpleMode, set);
}

/**
 * `FabMenuItem.key` → the capability that item *creates*, for the add buttons on
 * Today and a project.
 *
 * A third map rather than a shared one, same reason as the grocery one above:
 * these are their own key space, and `template` here means "start from a
 * template" where the editor has no such row at all.
 *
 * There is no `set` argument and there can't be one, which is the whole
 * difference between this map and the two above. A row in an editor is looking
 * at a task that either uses the feature or doesn't; a menu item is a blank
 * offer to start a new one. So this is the "only *starting* a new one goes"
 * rule the running focus session and the running shopping trip already follow:
 * an install with stacks keeps the Stacks screen that edits them
 * (`screenShown`), and loses the button that makes another.
 */
export const SIMPLE_ADD_MENU_FEATURES: Readonly<Record<string, SimpleFeatureId>> = {
  chain: 'chains',
  stack: 'stacks',
  template: 'templates',
  import: 'calendarImport',
};

/** Does an add-button menu item render? */
export function addMenuItemShown(key: string, simpleMode: boolean): boolean {
  const feature = SIMPLE_ADD_MENU_FEATURES[key];
  if (!feature) return true;
  return featureShown(feature, simpleMode);
}

/**
 * The kinds the editor's picker offers.
 *
 * `current` is always included even when the mode would drop it, so opening a
 * chain in simplified mode shows a picker that agrees with the task in front
 * of it — and so switching *away* from the chain is still possible, which is
 * the only way back to Standard.
 */
export function taskKindsForMode(simpleMode: boolean, current: TaskKind): TaskKind[] {
  if (!simpleMode) return [...TASK_KINDS];
  return TASK_KINDS.filter(kind => kind === 'task' || kind === current);
}

/**
 * The Today lens pills, given what each holds. Called only once the caller has
 * checked `featureHidden('unscheduledLens', …)`.
 *
 * Only Unscheduled is ever dropped, and only while empty. Later and Inbox stay
 * whatever the mode is: each is the sole route to a set of real tasks, and a
 * lens that hides tasks is not a simplification, it's a leak. Unscheduled
 * qualifies because a task with no date signal at all is one simplified mode
 * doesn't produce in the first place, so for a fresh install the pill is
 * simply never there.
 */
export function visibleLenses<T extends string>(
  lenses: readonly T[],
  counts: Readonly<Partial<Record<T, number>>>,
  current: T,
): T[] {
  return lenses.filter(lens =>
    lens === current || lens !== 'unscheduled' || (counts[lens] ?? 0) > 0);
}
