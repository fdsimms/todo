import type { ItemPick } from './grocery';
import type { FoodNutrition } from './nutrition';
import { RECIPE_NAME_MAX_LENGTH } from './recipes';
import type { RecipeIngredient } from './recipes';

// Which meal of the day a plan entry sits in. A closed set rather than free
// text: it orders the day, and a day whose sections are user-defined strings
// can't be sorted without inventing a second ordering table.
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

// The order a day is read in. MEAL_SLOTS is the sort key for entries sharing a
// date — see slotRank in src/utils/mealPlan.ts.
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/**
 * What a task that logs to the food log can file its entry under: a meal, or
 * 'other' for something eaten outside of one (a supplement, a shake). It is a
 * separate type because `Task.logMealSlot` null already means the feature is
 * off, and a food log entry's own "no meal" is `slot: null`; `logSlotToMealSlot`
 * (src/utils/mealLog.ts) is the one place the second turns into the first.
 */
export type LogMealSlot = MealSlot | 'other';

export const LOG_MEAL_SLOTS: readonly LogMealSlot[] = [...MEAL_SLOTS, 'other'];

export const LOG_MEAL_SLOT_LABELS: Record<LogMealSlot, string> = {
  ...MEAL_SLOT_LABELS,
  other: 'Other',
};

/**
 * A glyph per meal, borrowed from the time-of-day pills in quick add — the same
 * three parts of the day a meal's own slot names. Snack gets the cup, since
 * it's the one with no part of the day to name.
 *
 * Beside the labels rather than in either of the two screens that draw it (the
 * Settings rows that switch a meal on, the meal chip on a task row), because
 * one meal wearing two different glyphs on two screens is the drift the shared
 * primitives exist to stop.
 */
export const MEAL_SLOT_ICONS: Record<MealSlot, string> = {
  breakfast: 'sunny-outline',
  lunch: 'partly-sunny-outline',
  dinner: 'moon-outline',
  snack: 'cafe-outline',
};


/**
 * "This time" instead of the recipe's own line, kept on one planned meal.
 *
 * `targetId` is a `RecipeIngredient` id or a `RecipeComponent` link id on the
 * recipe (any level down), and `replacement` is what this cooking uses in its
 * place: a parsed ingredient line, or null to leave the line out. The recipe is
 * never edited, which is the whole point: a one-off swap ("store-bought fish")
 * must not become a standing option the recipe has to carry forever.
 *
 * Resolved at read time by `flattenRecipeIngredients` and `activeComponents`
 * (`recipeComponents.ts`), the same seam and the same reason as
 * `MealPlanEntry.recipeChoices`, and carried on `ChoiceResolution.overrides`.
 * **A reader builds its resolution from an entry through `entryResolution`,
 * never by hand**: a hand-built `{ chosen }` silently drops the override and
 * shops for the line it replaced (`noBareEntryResolution.test.ts` enforces it).
 *
 * Resolve-or-shrug like every other cross-row pointer: a `targetId` that names
 * nothing on the recipe any more replaces nothing.
 */
export interface RecipeOverride {
  targetId: string;
  replacement: RecipeIngredient | null;
  /** Shown beside the replaced line, for the one thing worth saying about the swap. */
  note?: string;
  /**
   * Set only when `targetId` names a `RecipeBlank`: the lines that fill it this
   * time, in the order picked. `replacement` is null on such a row. Absent on
   * every override that replaces a line.
   */
  fill?: RecipeIngredient[];
}

/**
 * One thing planned for one meal of one day.
 *
 * **Its own row, never a Task, and never a Task carrying a marker.** Four
 * concrete failures if it were one: sweepExpiredTasks deletes next week's plan,
 * purgeOldCompletedTasks eats the history, completing a recurring one spawns
 * phantom dinners, and seriesId becomes a second, conflicting way to say "this
 * on several dates". A Task-with-a-flag is the hidden-second-row-type move this
 * app has already rejected twice in writing (Series ghost rows, and
 * TaskGroup.completedAt).
 */
export interface MealPlanEntry {
  id: string;
  /**
   * A `YYYY-MM-DD` **local day key**, deliberately unlike every other date in
   * this app, which stores an ISO instant. A meal slot is a calendar day rather
   * than a moment: an instant would reopen the dayResetTime question (does
   * Tuesday's dinner belong to Tuesday at 02:00?) and make a range read shift
   * under the user the moment they travel. Built with dayKeyOf().
   */
  date: string;
  slot: MealSlot;
  /**
   * Null is a first-class answer — Thursday is allowed to just say "leftovers",
   * and such an entry holds its place, renders on the week and counts toward
   * "6 dinners planned" with no second-class treatment. Every planner that
   * demands a recipe per night is abandoned on a Wednesday.
   *
   * **Deliberately no cascade when the recipe is deleted.** Foreign keys are off
   * in expo-sqlite so ON DELETE CASCADE would silently do nothing anyway, but
   * here no cascade is the choice rather than an accident: deleting a recipe
   * must not blank last Tuesday. Readers are resolve-or-shrug and fall back to
   * `title`, exactly as TemplateItem.refTemplateName does.
   */
  recipeId: string | null;
  /** Captured at plan time, so the row still reads right when recipeId stops resolving. */
  title: string;
  /**
   * Orders entries within one (date, slot). There is deliberately no
   * UNIQUE(date, slot) — two things on one dinner is real (chicken *and* a
   * salad), and a uniqueness constraint would make the second one unsayable.
   */
  sortOrder: number;
  createdAt: string;
  /**
   * When this meal was actually made, set by a "Mark cooked" row action; null
   * until then. This is the one thing this row tracks about the *past* rather
   * than the plan — bumping it also bumps the recipe's cookCount/lastCookedAt,
   * but those live on the recipe and are never derived back from entries (see
   * Recipe.cookCount), so a purged entry never un-counts a cooking.
   */
  cookedAt: string | null;
  /**
   * The tracked leftover this meal is eating, if the user picked one instead of
   * a recipe or free text. Mutually exclusive with `recipeId` in practice —
   * both pickers commit through the same MealPick — but not enforced in the
   * schema, because a row that somehow carried both should still render rather
   * than be rejected.
   *
   * Same resolve-or-shrug, no-cascade contract as `recipeId`: finishing or
   * deleting a leftover must not blank last Tuesday, and `title` is the
   * captured fallback. **Pointing at a leftover is not eating all of it** — see
   * Leftover.finishedAt for why the two states are separate.
   */
  leftoverId: string | null;
  /**
   * Which alternative was picked for each of the recipe's choice groups — a
   * list of ids, each naming either a `RecipeComponent` link ("roast potatoes
   * rather than mash") or a `RecipeIngredient` line ("jalapeño rather than
   * serrano"). Empty means every group falls back to its default, which is what
   * every entry planned before this shipped says.
   *
   * **The pick lives here rather than on the recipe** because it is a fact
   * about a cooking, not about the dish: Tuesday's steak comes with mash and
   * Friday's with roast potatoes, out of one recipe. Same split cookedAt
   * already makes — the recipe is the document, the entry is one instance of
   * having planned it.
   *
   * **One list for both kinds**, rather than two fields, because every reader
   * asks the same question of it ("did this group's option win?") and an id
   * already says which kind it is by which list holds it. A pick that names
   * neither is simply a pick nothing matches.
   *
   * A flat list rather than a `{group: id}` map, because an id is unique across
   * the whole library — and it has to be, since a choice group can sit on a
   * *component* several levels down rather than on the recipe this entry points
   * at, so a group name alone wouldn't say whose group it is.
   *
   * Resolve-or-shrug like every other cross-row pointer here: an id whose row
   * has since been removed names no option, so its group quietly falls back to
   * its default rather than the meal losing its side.
   */
  recipeChoices: string[];
  /**
   * One-off replacements for this cooking only; see `RecipeOverride`. Empty on
   * every entry planned before it shipped. Like `recipeChoices` and
   * `recipeScale` it belongs to the recipe this entry points at, so it resets
   * when the recipe is swapped or goes dangling, and it does NOT carry when a
   * meal or week is copied: "this time" is about this time.
   */
  recipeOverrides: RecipeOverride[];
  /**
   * Which of two interchangeable items went into this cooking ("either one",
   * `ItemSubLink.either`), across every recipe in it. Empty means nothing has
   * been answered, which is **undecided and not a default**: lines read as
   * written and nutrition refuses until it is. Like `recipeChoices` it is a
   * fact about one cooking, so it resets when the recipe is swapped and does
   * not carry on a copy. Optional: absent and empty read the same.
   */
  itemPicks?: ItemPick[];
  /**
   * How much of the recipe this meal makes — 1 for as-written, 2 for a doubled
   * Sunday, 0.5 for cooking for one. Applied to every ingredient quantity when
   * the meal is shopped for (see collectPlannedIngredients), components
   * included, and to the servings the meal is described with.
   *
   * **A fact about a cooking, not about the dish**, for exactly the reason
   * `recipeChoices` above is: doubling Sunday's chili must not double the
   * recipe, or every other meal in the week that uses it — including as a
   * component of something else — silently doubles too. The recipe stays the
   * document; the entry is one instance of having planned it.
   *
   * Never null in practice (the column defaults to 1, which is what every entry
   * planned before this shipped says), but read through
   * recipeScale.normalizeScale anyway, so a hand-edited row or a restored
   * backup carrying 0 renders as-written rather than as nothing.
   */
  recipeScale: number;
  /**
   * Whether this meal's slot gets a task on Today — `true`/`false` when the
   * user has said so for this meal, `null` when they haven't and
   * `mealSlotsEnabled` decides (see utils/mealSlotTasks.ts).
   *
   * It outlived the cook tasks it was built for: a meal task is keyed by a day
   * and a slot rather than by a meal, but "not this one" is still a thing a
   * *meal* says, so this stays the per-meal answer both the daily pass and the
   * reconcile read. An explicit `true` is also the one way a task appears
   * outside that pass — a lunch you cook once a month can have a task without
   * lunch being a meal you want asked about every day.
   *
   * **Three states rather than a boolean, because "no" has to be sayable
   * separately from "not yet asked".** Deleting the spawned task records
   * `false` here, and that's the whole reason the field exists: without a
   * tombstone the next edit to this meal reconciles the task straight back,
   * and a row the user deleted reappearing is the one outcome that would make
   * the feature intolerable. Same shape, and the same reasoning, as
   * grocery `hiddenAisles` — a delete needs somewhere to be remembered when
   * the thing deleted is derived from something else.
   *
   * `null` for every meal planned before this shipped, which reads as "follow
   * the setting" and is what makes the rollout silent: nothing is backfilled,
   * so no cook tasks appear for meals already on the calendar — only ones
   * planned from here on.
   *
   * A fact about a cooking, not about the dish, exactly like recipeChoices and
   * recipeScale above: "I need reminding to make this on Sunday" says nothing
   * about the recipe, which may well be a component of something else.
   */
  cookTask: boolean | null;
  /**
   * Whether this meal gets a "Shop for Tue ragu" task when the kitchen can't
   * currently make it — `true`/`false` when the user has said so for this meal,
   * `null` when they haven't and `mealShortfallTasks` decides (see
   * utils/mealShortfallTasks.ts).
   *
   * Exactly `cookTask`'s tri-state above, for exactly its reasons, and a
   * separate field rather than a second reader of it because the two answer
   * different questions about the same night: `cookTask` is "remind me to make
   * this", this is "warn me if I can't". A meal you cook from memory every week
   * wants the second and not the first; one you shop for on the day wants the
   * reverse.
   *
   * The tombstone half matters more here than anywhere else, because this is
   * the only generator whose source the user re-plans freely: every other way a
   * shortfall task can go away is the app noticing the plan changed
   * (`staleMealShortfallTasks`), so without a per-meal `false` a swiped-away row
   * would come back on the very next sweep with the meal untouched.
   *
   * `null` for every meal planned before this shipped, which reads as "follow
   * the setting" — and since the setting ships off, an existing install sees
   * nothing new until it is switched on.
   */
  shopTask: boolean | null;
  /**
   * Whether finishing this meal offers to log what was eaten — `true`/`false`
   * when the user has said so for this meal, `null` when they haven't and
   * `mealLogPrompt` decides (see utils/mealLog.ts).
   *
   * `cookTask`'s tri-state a third time, for its reasons, and a separate field
   * for the reason `shopTask` is separate from `cookTask`: these answer
   * different questions about the same night. A meal you want reminding to
   * cook is not necessarily one you want counted, and a takeaway you never
   * cook at all is exactly one you might.
   *
   * **It gates an offer, not a write.** A plan is a plan and plans go wrong:
   * the dinner was cooked and then everyone went out. Nothing here ever logs
   * unasked, so a `true` means "ask me", never "record it" — see
   * `docs/arch/health-data.md` on why a false entry in a health record costs
   * more than a missing one.
   *
   * `null` for every meal planned before this shipped, which reads as "follow
   * the setting".
   */
  logMeal: boolean | null;
  /**
   * Whether this meal gets a "Take chicken out of the freezer" task the day
   * before (#2926): `false` once the user has swiped one away for this meal,
   * `null` (or absent) when the `mealThawTasks` setting decides. See
   * utils/mealThawTasks.ts.
   *
   * `shopTask`'s tri-state a fourth time, for its tombstone reason above:
   * every other way a thaw task goes is the app noticing the plan or the
   * freezer changed, so without a per-meal `false` a deleted row would come
   * back on the next sweep. Only `false` is ever read, the same subtract-only
   * reading `shopTask` gets.
   *
   * **Optional in the type**, unlike the three above: `rowToMealPlanEntry`
   * always fills it, and an entry built anywhere else (a copied week, a saved
   * meal, a test fixture) reads its absence as `null`, which is what it would
   * have been.
   */
  thawTask?: boolean | null;
  /**
   * The device calendar event mirroring this meal, or null when there isn't
   * one (#1494) — the household's shared answer to "what's for dinner
   * Thursday", which a local task can't give.
   *
   * Same direction of authority as `Task.calendarEventId`, and the opposite
   * of `cookTask` right above: **the entry is the master** — it owns the
   * title, the day and the slot, reconciling rewrites exactly those on the
   * device event, and nothing flows back. A cook task is a projection the
   * user can talk back to (deleting it says "not this meal"); a calendar
   * event isn't, because expo-calendar exposes no `EKEventStoreChanged`
   * bridge, so an event moved or deleted on the device is invisible from
   * here. Hence no tri-state opt-out to match `cookTask`'s: there is no
   * gesture that would write one.
   *
   * Not in `MealPlanDraft` — nothing may create an entry pre-pointed at an
   * event. Written only by `reconcileMealEvent` in useMealPlanStore, from
   * whatever the device write returned.
   *
   * **This device's, and it doesn't sync** (#2950): an EventKit id names a
   * record on one phone, so the column is kept off the wire in both directions
   * (`SYNC_DEVICE_LOCAL_COLUMNS` in db/syncTracking.ts). Each device holds the
   * id of the event *it* wrote, and a peer's edit to the meal leaves it alone.
   * The event itself still follows that edit: the reload after a sync rewrites
   * it, or deletes it when the peer removed the meal (`reconcileSyncedEvents`,
   * with the rules in `mealEventsAfterSync`).
   */
  calendarEventId: string | null;
  /**
   * The calendar server's id for that same event (`calendarItemExternalIdentifier`),
   * read back after every write, or null until one is (#2950). Read only when
   * `calendarEventId` no longer resolves, which is what a backup restored on a
   * new phone leaves every meal with: the event is looked up by this and
   * adopted rather than written a second time beside the one the old phone
   * wrote (`writeAllDayEvent` in utils/calendarEventLink.ts). Device-local in
   * sync and kept in backups, like `calendarEventId`. Optional so a row or
   * fixture from before it reads as null.
   */
  calendarEventExternalId?: string | null;
}

/**
 * A meal chosen for a week with no day or slot yet: "tacos, soup and salmon
 * this week, whichever nights suit". A separate row type rather than a
 * `MealPlanEntry` with a null `date`, because every reader of an entry (the
 * slot's Today task, the calendar event, nudges, shortfall and thaw tasks,
 * cooking stats, the purge) takes `date` to be a day key, and a pool meal has
 * none of the things those hang off.
 *
 * A pool meal is not a planned meal until it is placed: placing deletes this
 * row and plans a real entry (`placePoolEntry` in `useWeekPoolStore`). What it
 * does share with the plan is the week's shopping, cost and nutrition, which
 * read it through `poolAsEntries` (`utils/weekPool.ts`).
 */
export interface WeekPoolEntry {
  id: string;
  /**
   * The `YYYY-MM-DD` day key of the first day of the week it belongs to, as the
   * meal plan screen showed that week when it was added (its `weekStartsOn`).
   * Changing the week-start setting leaves old rows on the week they were
   * filed under, which `purgeOldPoolEntries` clears with the rest.
   */
  weekStart: string;
  /** Null for a typed title with no recipe, like `MealPlanEntry.recipeId`. */
  recipeId: string | null;
  /** Captured at add time so the row still reads right if the recipe goes. */
  title: string;
  sortOrder: number;
  createdAt: string;
}

/**
 * A meal the person said they skipped: "no breakfast today". Set from the
 * meal strip on Today (`MealStrip.tsx`), keyed by the day and the meal rather
 * than by a planned entry, because the meal most often skipped is one nobody
 * planned and so has no `MealPlanEntry` to carry a flag.
 *
 * **Its own row, not a `MealPlanEntry` with a marker**, for the reason
 * `WeekPoolEntry` is: every reader of an entry (the shopping list, the
 * calendar event, cooking counts, "6 dinners planned") would have to learn to
 * step over it, and the one that forgets turns a skipped breakfast into a
 * planned one. Nor is it a food log row: the log is what was eaten, and Health
 * reads it.
 *
 * The id is derived from the day and the meal (`spawnSeed.mealSkip`), so two
 * phones that each skip the same breakfast before syncing write one row, and
 * un-skipping on either deletes it everywhere.
 */
export interface MealSkip {
  id: string;
  /** A `YYYY-MM-DD` logical day key, like `MealPlanEntry.date`. */
  dayKey: string;
  slot: MealSlot;
  createdAt: string;
}

/**
 * Something cooked that's now sitting in the fridge, with a clock on it.
 *
 * Its own row rather than a GroceryItem or a Recipe, because it is neither: a
 * grocery item is a forever-row with a purchase count, an aisle and a shop, all
 * meaningless here, and its identity is a `nameKey` — but "leftover chilli" made
 * twice in one week is two containers with two different clocks, so the name
 * can't be the identity. A recipe is a reusable document; this is one perishable
 * instance of having cooked one. And it is deliberately not a field on the
 * MealPlanEntry it came from either: a leftover outlives the meal that made it,
 * gets eaten across several later meals, and can be logged with no planned meal
 * behind it at all.
 *
 * **It is also not a Task**, for the reasons MealPlanEntry gives. What it can
 * have is a *replica* Task — "Use up the chilli" — projected the same way
 * #1106 projects one from a perishable grocery item: a separate ordinary row
 * pointing back here via Task.leftoverId, spawned/updated/dropped by
 * src/utils/leftoverTasks.ts, never a second lifecycle grafted onto this row.
 */
export interface Leftover {
  id: string;
  /** What's in the container. Captured, not derived — see recipeId. */
  title: string;
  /**
   * The recipe it was made from, when it was logged off a cooked meal. Null for
   * anything logged by hand, which is a first-class answer: half a takeaway is a
   * leftover and has no recipe. Resolve-or-shrug with no cascade, exactly like
   * MealPlanEntry.recipeId — `title` is what actually renders.
   */
  recipeId: string | null;
  /** The planned meal it was logged from, if any. Same no-cascade contract. */
  sourceEntryId: string | null;
  /** ISO instant it went in the fridge. Age is counted in *calendar* days off this. */
  storedAt: string;
  /**
   * A `YYYY-MM-DD` local day key — the day it should be eaten or thrown out by.
   *
   * Stored as the resolved day rather than as a "keep for 4 days" number, for
   * the reason #1106 gives for preferring a real expiry date to a perishable
   * flag: an absolute day can drive *when* to nudge, and editing the stored-on
   * date later doesn't silently drag the deadline with it. The editor still
   * talks in days and converts (see keepUntilKeyFor / keepDaysBetween).
   */
  keepUntil: string;
  /**
   * ISO instant the container was emptied or binned; null while it's still in
   * the fridge. **This is not set by planning a meal against it** — a pot of
   * soup feeds two dinners, so "used for a meal" and "no longer tracked" are
   * separate states and only an explicit action closes this one out.
   */
  finishedAt: string | null;
  /** Which ending it got. Null exactly while `finishedAt` is null. */
  outcome: LeftoverOutcome | null;
  /**
   * ISO instant this container went in the freezer, or null while it's in the
   * fridge. Exactly `GroceryItem.frozenAt`, and read through the same
   * `freshness.liveUseBy`.
   *
   * Both halves of the kitchen get this or neither usefully does: a bag of
   * spinach and a container of chilli going off Thursday are the same fact to
   * the cook (#1670), and so are the two of them going in the freezer on
   * Saturday. `isPlannedPastKeepUntil` already conceded as much in prose —
   * planning a container past its day is fair because "it may be going in the
   * freezer" — and this is that sentence with somewhere to be recorded.
   *
   * **It does not close the container out.** `finishedAt` is still the only
   * thing that ends a leftover's life, and a frozen one is as live as any
   * other: it stays plannable onto a night of the week, which is most of what
   * anyone freezes a portion *for*. What stops is the countdown and the nudge
   * (`needsAttention`).
   */
  frozenAt: string | null;
  /**
   * What's in the container, in grams, or null when nobody weighed it, which
   * is most containers.
   *
   * **The container's half of `Recipe.cookedWeightG`.** A weight is only worth
   * having where something can divide by it: this one is measured against the
   * dish's own cooked weight, so eating the container works out to the
   * fraction of the recipe it held. Without the recipe's weight it measures
   * nothing, which is why nothing asks for it on a container logged by hand
   * off a takeaway.
   *
   * Per container rather than per cooking, because that is what a scale can
   * answer: two tubs off one pot are rarely halves.
   */
  weightG: number | null;
  /**
   * What the whole container holds, as a nutrition panel, or null when nobody
   * has looked it up, which is most containers and every one from before this
   * existed.
   *
   * **The container's own figures, so the food log can log it from the fridge
   * with real numbers.** One panel for the whole container (`perServing`, the
   * container being the serving), never per 100 g: a hand-logged container has
   * no density to convert with. Usually `source: 'estimated'`. A recipe-backed
   * container needs none (its figures come from the recipe, see
   * `leftoverFigures.ts`) and only carries one if the person set it. Unknown is
   * not the same as an empty panel, so this is nullable and never `{}`.
   */
  nutrition: FoodNutrition | null;
  createdAt: string;
  /**
   * The per-leftover answer to "does this get a use-up task" — true, false, or
   * null to hand the question back to the leftoverUseUpTasks setting. Same
   * semantics as GroceryItem.useUpTask: `false` is what deleting the task
   * records, so a leftover you've already been reminded about once doesn't
   * spawn another the moment it crosses back into "soon".
   */
  useUpTask: boolean | null;
}

/**
 * How a leftover ended. Recorded because "we ate it" and "it went off" are the
 * two things the whole feature is trying to tell apart, and a single
 * finished-flag would throw that away at the moment it's cheapest to capture.
 */
export type LeftoverOutcome = 'eaten' | 'tossed';

/**
 * How close to its keep-until day a leftover is. Four states rather than a
 * boolean because the nudge has to arrive *before* the waste, and "one day
 * left" and "three days past" are not the same message.
 */
export type LeftoverFreshness = 'fresh' | 'soon' | 'due' | 'over';

// A container label, not a title — same reasoning as RECIPE_NAME_MAX_LENGTH,
// and the same number, since a leftover's name usually *is* a recipe's.
export const LEFTOVER_NAME_MAX_LENGTH = RECIPE_NAME_MAX_LENGTH;

/**
 * The keep-for window a freshly logged leftover starts with.
 *
 * Three or four days is the usual food-safety advice for cooked leftovers, and
 * this app rounds toward the cautious end. It's a starting point the stepper
 * moves, never a rule — see LEFTOVER_KEEP_DAYS_MAX.
 */
export const LEFTOVER_KEEP_DAYS_DEFAULT = 3;
/** Same day it was made — for something that genuinely won't last the night. */
export const LEFTOVER_KEEP_DAYS_MIN = 0;
/**
 * The ceiling on the keep-for stepper. Generous on purpose: a frozen portion is
 * a real leftover, and CountStepper exists precisely so a ceiling nobody asked
 * for doesn't make a legitimate answer unsayable.
 */
export const LEFTOVER_KEEP_DAYS_MAX = 365;

/**
 * How long a *closed-out* leftover is kept, in days.
 *
 * Same disease the meal plan prune exists for — one row per container forever —
 * and deliberately a much shorter window, because a finished leftover has no
 * Logbook, no stats and nothing pointing at it once its meal entries have aged
 * out. A leftover that is still *live* is never purged however old it is: an
 * eight-week-old container nobody closed out is exactly what this feature is
 * for, and quietly deleting it would be the app taking the user's side of the
 * conversation.
 */
export const LEFTOVER_RETENTION_DAYS = 60;

/**
 * How long a planned meal is kept, in days.
 *
 * Entries are the first per-event rows this app adds since the grocery model
 * was built to avoid exactly that, so the prune is not optional. It is
 * deliberately *not* wired to `completedRetentionDays`: that setting is a
 * promise about the user's Logbook, and quietly reusing it would mean "keep
 * completions forever" also means "keep four years of dinners".
 */
export const MEAL_PLAN_RETENTION_DAYS = 180;
