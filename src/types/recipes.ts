import type { FoodKind } from './grocery';

/**
 * A pot, pan, lid or tub and what it weighs empty, so a weight typed with the
 * food still in it can be turned into the food's own weight. See
 * `src/utils/cookware.ts`.
 *
 * Only a convenience for entering a number: nothing stores which pot a dish was
 * weighed in, and `Recipe.cookedWeightG` stays the food alone.
 */
export type CookwareType = 'Pots' | 'Pans' | 'Baking' | 'Bowls' | 'Mixing bowls' | 'Plates' | 'Glasses' | 'Other';

export interface Cookware {
  id: string;
  name: string;
  /** The type it is listed under, or null to read it from the name (`effectiveCookwareType`). */
  kind: CookwareType | null;
  /** What it weighs empty, in grams. Always above zero. */
  weightG: number;
  sortOrder: number;
  createdAt: string;
}

// A prep clause ("drained and rinsed", "plus more for topping") is a short
// phrase, not a sentence — same order of magnitude as GROCERY_QUANTITY_MAX_LENGTH
// but roomier, since it's prose rather than a number-and-unit. Named generically
// rather than RECIPE_-prefixed: splitPrep() runs on plain grocery quick-add text
// too, not just recipe ingredient lines.
export const PREP_MAX_LENGTH = 60;

// An ingredient section label ("For the cake", "For the frosting") — a
// component name, same order of magnitude as an aisle's.
export const RECIPE_SECTION_MAX_LENGTH = 40;

/**
 * How long a note kept on a recipe step may be.
 *
 * Generous next to `PREP_MAX_LENGTH` because this holds a sentence or two of
 * prose rather than a label, and tight enough that the step it sits under stays
 * the thing being read — see `clampCookAnswer`, which does the shortening that
 * matters before the text ever reaches here.
 */
export const RECIPE_STEP_NOTE_MAX_LENGTH = 500;

/** How many either/or options one step may be tied to (`RecipeStep.onlyWhen`). Far above any real recipe; it only bounds a corrupt blob. */
export const STEP_ONLY_WHEN_MAX = 12;

// One line of a recipe's shopping implication — deliberately not a GroceryItem.
// A GroceryItem is a forever-row carrying purchase counters and everything the
// app knows about a food; "1 tsp smoked paprika" is a line of a recipe. Minting
// a catalog row for every ingredient at *authoring* time would poison the
// catalog and the autocomplete rankings, which are scored on purchase history
// such a row would never have. A row minted deliberately, one at a time, from
// the ingredient sheet is the supported way across.
//
// The bridge to the catalog is `nameKey`, never an id — see the field.
export interface RecipeIngredient {
  id: string;
  // As typed — the label. Same rule as GroceryItem.name.
  name: string;
  // groceryNameKey(name). THE bridge to the catalog, and resolve-or-shrug like
  // every other cross-row pointer here: a miss just falls through to
  // addByName, which is the right behaviour anyway. Kept in step by
  // useGroceryStore.renameItem → useRecipeStore.remapIngredientKey, exactly as
  // renameRememberedAisle keeps the aisle memory in step.
  nameKey: string;
  // The key a catalog rename or merge repointed this line to, while the label
  // still says what it said. A read recomputes `nameKey` from `name`, which
  // would undo the repoint on the next load, so it honors this instead, and only
  // while `nameKey` still equals it: an edit that changes the name recomputes
  // `nameKey` and so retires it. Absent on nearly every line.
  catalogKey?: string;
  // Free text, '' when the recipe didn't say. Nothing does arithmetic on it.
  quantity: string;
  // null means "no opinion", so the lexicon and the user's own filings decide
  // at add time. Deliberately NOT 'Other': asserting Other here would outrank
  // aisleForName and file a known item in the miscellaneous pile forever.
  aisle: string | null;
  // What to do to it, not what it is — "peeled and sliced", "drained and
  // rinsed", "melted". Split out by splitPrep() so it never leaks into `name`:
  // nameKey is the catalog bridge, and "garlic, peeled and sliced" would mint
  // a separate catalog row from plain "garlic" every time the wording of the
  // prep clause changed. null means the line didn't have one, same as aisle.
  prep: string | null;
  // Why it's on the list, not what to do to it — "margaritas" from "Limes for
  // margaritas", "gideong" from "flour for gideong". Split out by
  // splitPurpose() for the same reason prep is: nameKey is the catalog
  // bridge, so a purpose clause staying in `name` would mint a separate
  // catalog row every time the dish it's for changed. null means the line
  // didn't have one, same as prep/aisle.
  purpose: string | null;
  // Which component of the recipe this belongs to — "For the cake", "For the
  // frosting". null means the recipe wasn't authored with sections (the
  // common case), and every existing reader that doesn't know about this
  // field keeps working exactly as it did: it's a label on a flat list, not
  // a nested groups type, so ingredients stay one array everywhere outside
  // the editor and detail view — RecipeIngredientSheet, RecipeDetailScreen's
  // grouping — and adding to the grocery list still flattens straight
  // through (mealPlanGroceries' PlannedIngredient never carries it).
  section: string | null;
  // Which either/or slot this line fills — "Pepper", "Cheese". Lines sharing a
  // non-null group are alternatives ("Serrano *or* jalapeño"), of which exactly
  // one is bought; null (the common case) means the line is always needed.
  // Same label-on-a-flat-list convention `section` above uses, and the same one
  // RecipeComponent.choiceGroup uses a layer up.
  //
  // **This is why an alternative is two rows and not one line reading "serrano
  // or jalapeño".** `nameKey` is the bridge to the grocery catalog, so the
  // one-line spelling mints a catalog item literally called "serrano or
  // jalapeño" — a row that can never match a real purchase, never ranks in Buy
  // again, and has to be hand-corrected on the list every single time. Two rows
  // each carry a clean name, and choosing between them at add time is what puts
  // exactly one of them in the trolley.
  //
  // **Deliberately not shared with RecipeComponent's groups**, even though the
  // labels and the resolution work alike: an ingredient names something you can
  // put in a trolley and a component names a dish (see RecipeComponent), so they
  // stay two lists and one *convention*. Chosen ids from both do travel together
  // in MealPlanEntry.recipeChoices, which is safe because an id says which list
  // it came from by which list holds it.
  choiceGroup: string | null;
  // "This one has to be real butter" — the per-line opt-out from a standing
  // swap (ItemSubLink.standing). Margarine for butter is fine in a pan and
  // wrong in laminated pastry, and a rule that rewrites a line without being
  // asked has to have somewhere for that exception to live.
  //
  // **On the recipe, deliberately, and deliberately not a choiceGroup.** Which
  // pepper you use is a fact about one cooking (MealPlanEntry.recipeChoices);
  // "this pastry needs butter" is a fact about the dish, true every time it is
  // made. And it isn't a choice at all — there are no options to pick between,
  // just one line the standing rule doesn't reach — so filing it with the
  // either/or machinery would mean a group of one, the dead-end state
  // RecipeIngredientSheet's Alternatives field exists to make unreachable.
  //
  // Optional rather than `boolean`, unlike every field above: ingredients live
  // in a JSON blob, so an absent key is already the value nearly every line
  // wants, and requiring it would mean a backfill through every construction
  // site (the parser, the extractor, the editor, the seed) for a bit that is
  // off almost everywhere.
  noSwap?: boolean;
  // A garnish or serving suggestion rather than something the dish needs —
  // "lime wedges, for serving". Doesn't change what's on the recipe or hide
  // the line anywhere it's shown; it only changes the *default* when this
  // recipe's ingredients go on a shopping list (see classifyPlanned in
  // mealPlanGroceries.ts), where an optional line starts unticked instead of
  // ticked. Same optional-boolean convention as noSwap, for the same reason.
  optional?: boolean;
  // A worked example of the name, not an instruction or a name of its own —
  // "avocado oil" from "neutral oil, such as avocado oil". Split out by
  // splitExample() for the same reason prep/purpose are: left in `name`, it
  // reads as neither the generic thing the recipe asked for nor a shoppable
  // item of its own. Optional rather than `string | null` like prep/purpose,
  // same convention noSwap/dismissedCatalogSuggestion use and the same
  // reason: most lines never have one, so requiring the key would mean a
  // backfill through every construction site for a value that's absent
  // almost everywhere.
  //
  // Read by RecipeIngredientSheet to offer declaring the example a variety of
  // this line's own name (GroceryItem.varietyOfKey, see itemVarieties.ts) —
  // "is avocado oil a kind of neutral oil?" — the same offer varietyOfferFor
  // makes from a catalog-name collision, just sourced from the recipe's own
  // wording instead of an existing row's name.
  example?: string;
  // "Not now" on the catalog-match signpost pill (see ingredientCatalogMatch.ts
  // and RecipeDetailScreen), remembered permanently rather than for the
  // current screen visit. Holds the *suggested name* that was turned down, not
  // a boolean, so the pill comes back on its own the moment the offer changes
  // (a rename, a different catalog match) instead of hiding a pill that's now
  // suggesting something new. Same optional-string convention as `aisle`.
  dismissedCatalogSuggestion?: string;
  // Same "not now", for the split-into-alternatives pill. Keyed on the line's
  // own name rather than the suggested split, since that's what the pill's
  // offer is keyed on (see splittableInto in RecipeDetailScreen).
  dismissedSplitSuggestion?: string;
  // "A handful of basil doesn't move the total" — the per-line opt-out from
  // nutrition counting (see recipeNutrition.ts). Excluded from both sides of
  // its coverage fraction, the same as a staple (GroceryItem.isStaple), and
  // for the same reason: a line marked this way isn't a gap in the dish's
  // figures, it's a line the dish's figures were never meant to include.
  //
  // Deliberately per line rather than per catalog item: a pinch of salt is a
  // staple everywhere it's used, but a handful of basil matters plenty in a
  // pesto and nothing in a garnish on someone else's dish — the same
  // ingredient wants counting in one recipe and not in another. Same
  // optional-boolean convention as noSwap/optional, for the same reason.
  excludeFromNutrition?: boolean;
  // "I cooked this in a pan, so some of it stayed there": a cooking fat's line
  // counts toward the dish's nutrition at PAN_OIL_SHARE of the written amount
  // (panOil.ts). Only a cooking fat (oil, butter, ghee) has the question. Absent means nobody has
  // answered, and the recipe's own steps decide; `true` and `false` are answers
  // that the steps no longer overrule. Unlike the optional booleans around it,
  // `false` is stored: it is the answer that beats a guess of `true`.
  cookedInPan?: boolean;
  // "This is a staple you'd already have, not something to shop for" — water at
  // a stated amount, most often ("3/4 cup water" in a brine). Doesn't change
  // what's on the recipe or hide the line anywhere it's shown
  // (RecipeDetailScreen, Cook Mode); it only keeps the line out of a shopping-list
  // add (plannedIngredientsForRecipe/collectPlannedIngredients in
  // mealPlanGroceries.ts, suggestRecipeGroceries's callers). Same
  // optional-boolean convention as noSwap/optional/excludeFromNutrition, for
  // the same reason.
  excludeFromShoppingList?: boolean;
}

/**
 * A blank in a recipe, filled from the kitchen each time it's cooked: "2 cups
 * vegetables, pick any", "a grain, pick one". What makes a "no-recipe recipe"
 * (a grain bowl, a fridge frittata) a recipe at all.
 *
 * **Its own list, deliberately not a `RecipeIngredient`**, for the reason
 * `RecipeComponent` is one: `nameKey` is THE bridge to the grocery catalog, and
 * a line called "vegetables" would mint a catalog row called that, shop for it
 * and count it in the dish's figures. A blank names no food. It contributes
 * nothing to shopping, cost, nutrition or cook mode until a meal fills it.
 *
 * **What fills it lives on the meal, not here**: a `RecipeOverride` aimed at
 * this blank's id, whose `fill` holds the picked lines. The same split
 * `MealPlanEntry.recipeChoices` makes (the recipe is the document, the entry is
 * one cooking of it), and riding the override means every path that already
 * carries a meal's overrides (the shopping sheet, cook mode, the food log, the
 * cook recap) carries the fill too, with nothing new to thread.
 *
 * Resolve-or-shrug like every other cross-row pointer: a fill aimed at a blank
 * the recipe no longer has fills nothing.
 */
export interface RecipeBlank {
  id: string;
  /** The heading it reads under: "Vegetables", "Something crunchy". */
  label: string;
  /**
   * The kind of food that fills it from the kitchen (`foodKinds.ts`). Null is
   * a blank filled only from `options`, the frittata's "feta, goat cheese or
   * cheddar".
   */
  kind: FoodKind | null;
  /** How many things may fill it: 1 is "pick one", null is "pick any". A hint the picker shows, never enforced at save. */
  max: number | null;
  /** The whole amount the picks share ("2 cups"), '' when the recipe doesn't say. Split evenly across picks (`blankFill.ts`). */
  quantity: string;
  /** Names the recipe suggests whether or not they are in the kitchen, in the order written. */
  options: string[];
  /**
   * Names the picker never offers for this blank, whatever the kitchen or the
   * purchase history says: the person long-pressed them and said so. A pick typed
   * in by hand through Other is still allowed, since that is a choice rather than
   * an offer. Absent on a blank stored before this existed.
   */
  excluded: string[];
}

// One recipe used as a part of another — "mashed potatoes" inside both "Steak
// with mash" and "Salmon with mash".
//
// A *reference*, and the reference is the entire point: the alternative is
// copying the component's ingredients into every parent, which is what the user
// already has to do by hand and which stops being true the moment the component
// is edited. Nothing here is a snapshot of the component's contents; flattening
// happens at read time, in src/utils/recipeComponents.ts.
//
// **Deliberately its own list rather than a RecipeIngredient carrying a
// refRecipeId.** TemplateItem does it the other way (a ref item sits among the
// real ones), and that works there because a template's items are already a
// heterogeneous pile of drafts. An ingredient is not: `nameKey` is THE bridge
// to the grocery catalog, and every reader — mergeIngredients' dedupe,
// remapIngredientKeyIn, classifyPlanned, the aisle lexicon — is written on the
// assumption that a line names something you can put in a trolley. A component
// names a dish. Mixing them makes every one of those readers ask "but is this
// one real", which is the hidden-second-row-type shape this app has rejected
// twice already (Series ghost rows, TaskGroup.completedAt).
export interface RecipeComponent {
  // The link's own id, not the target's — so a component can be removed by
  // identity, exactly like an ingredient row.
  id: string;
  // The referenced recipe. **Deliberately no cascade when it's deleted**, same
  // as MealPlanEntry.recipeId and TemplateItem.refTemplateId: foreign keys are
  // off, and resolve-or-shrug is the house rule for every cross-row pointer
  // here. A component that no longer resolves contributes zero ingredients and
  // renders as a broken row the user can remove.
  recipeId: string;
  // Captured at link time and never refreshed, so a dangling link still has
  // something to name. Only ever rendered when recipeId stops resolving — a
  // live component shows the referenced recipe's current name, so a rename
  // propagates the way the whole feature promises.
  name: string;
  // Which either/or slot this component fills — "Side", "Starch". Components
  // sharing a non-null group are *alternatives*: exactly one of them is cooked,
  // so exactly one contributes ingredients and prep steps to any given meal.
  // null (the common case) means unconditional, and every reader that predates
  // this field behaves exactly as it did.
  //
  // **A label on the flat array, not a nested group type** — the same call
  // RecipeIngredient.section makes, and for the same reason: `components` stays
  // one ordered list everywhere outside the pickers, so resolveComponents,
  // recipesUsing and the cycle check need no reshaping.
  //
  // **The default is the group's first component in list order**, deliberately
  // rather than a defaultComponentId on the recipe: an id is a second thing to
  // keep in step with the list (and to repair when that component is removed),
  // while order is already there. makeComponentDefault moves a link to the
  // front of its group, which is the whole of "make this the usual one".
  choiceGroup: string | null;
  // Where this part sits among the recipe's own ingredient lines, and which
  // heading it is under. **Absent means unplaced** (every link that predates the
  // field), which reads as it always did: after the last ingredient, under no
  // heading. Present, it is the position a person dragged the part to, and every
  // surface that flattens the recipe (the shopping list, cook mode, the share
  // text) honors it, so the order on the recipe page is the order everywhere.
  placement?: ComponentPlacement;
  // How much of the part's own batch this dish uses: "1 tbsp" of a 3/4 cup
  // seasoning, "2 fillets" of 4, or a bare "1/4" for a quarter of the batch
  // (a number with no unit counts batches). **Absent means the whole batch**,
  // which is how every link that predates the field reads. Only nutrition
  // reads it (`componentShares`): shopping still flattens the part whole, and
  // an amount the part's `recipeYield` can't be compared against is ignored
  // rather than guessed at.
  amountUsed?: string;
}

// A component's slot among its parent's ingredient lines. `before` names the
// ingredient the part sits directly above, and is the anchor rather than an
// index so it survives an ingredient being added or reordered. null means after
// the last one; an id that no longer resolves reads the same way, and the store
// re-anchors to the next line when it removes one (`reanchorComponents`).
// `section` is the heading it is under, set from the same heading marker an
// ingredient's `section` is, null before the first heading.
export interface ComponentPlacement {
  before: string | null;
  section: string | null;
}

// Which meal of the day a recipe is *for* — a browsing/filtering tag, not a
// schedule. Deliberately not MealSlot (above, used by MealPlanEntry.slot):
// that type is a calendar slot for one planned day and has no 'dessert',
// where this is an intrinsic property of the dish itself — a recipe is
// breakfast food regardless of which day, if any, it ever gets planned onto.
// A closed set for the same reason MealSlot is one: a user-defined string
// list can't be grouped/sorted without a second ordering table (see #1086,
// which builds that grouping on top of this field).
export type RecipeMealType =
  'breakfast' | 'lunch' | 'dinner' | 'side' | 'condiment' | 'snack' | 'dessert' | 'beverage';

// Display order — also the sort key #1086 groups by.
export const RECIPE_MEAL_TYPES: readonly RecipeMealType[] =
  ['breakfast', 'lunch', 'dinner', 'side', 'condiment', 'snack', 'dessert', 'beverage'];

export const RECIPE_MEAL_TYPE_LABELS: Record<RecipeMealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  side: 'Side',
  condiment: 'Condiment',
  snack: 'Snack',
  dessert: 'Dessert',
  beverage: 'Beverage',
};

// What kind of thing `Recipe.source` names — a website reads differently from
// a cookbook (which is also the only one a page number means anything for).
export type RecipeSourceType = 'website' | 'cookbook' | 'magazine' | 'homeRecipe' | 'other';

export const RECIPE_SOURCE_TYPES: readonly RecipeSourceType[] =
  ['website', 'cookbook', 'magazine', 'homeRecipe', 'other'];

export const RECIPE_SOURCE_TYPE_LABELS: Record<RecipeSourceType, string> = {
  website: 'Website',
  cookbook: 'Cookbook',
  magazine: 'Magazine',
  homeRecipe: 'Home recipe',
  other: 'Other',
};

// Whether you'd cook it again, and how much. Three rungs and null (no
// opinion, the common state — nothing infers one, cooking a recipe isn't
// liking it). This is also the recipe box's one "is this any good" signal —
// it replaced a separate favorite star, so the top rung is what floats a
// recipe to the top of the box and what a favorite used to mean.
export type RecipeVote = 'loved' | 'liked' | 'never';

export const RECIPE_VOTE_LABELS: Record<RecipeVote, string> = {
  loved: 'Loved it',
  liked: 'Liked it',
  never: 'Never again',
};

// A book recipes come out of, saved once and pointed at by every recipe read
// from it — so correcting a title or filling in an author later is one edit
// rather than one per recipe.
//
// It exists because `Recipe.source` + `Recipe.author` are free text, and a
// shelf of books entered a page at a time drifts: "Nothing Fancy" and "Nothing
// Fancy " and "Nothing fancy" are three books to everything that groups by
// them, and the author typed on the first import is missing from the next four.
// A row with an id is the same fix `Shop` got for store names, for the same
// reason.
//
// **A linked recipe still carries `source`/`author` as a mirror**, written by
// the store whenever the link or the book changes and never edited directly
// (see `useRecipeStore.linkCookbook`/`renameCookbook`). That's deliberate:
// every existing reader of an attribution — `describeAttribution`, the search
// tier in `rankRecipes`, `shareText`, `recipeHasAttribution` — goes on reading
// a plain string and needs to know nothing about cookbooks, and there is still
// exactly one writer, which is all the drift fix ever needed. The mirror is
// also what survives `deleteCookbook`: losing the book must not lose the fact
// that the recipe came from it.
export interface Cookbook {
  id: string;
  // As typed — the label. "Nothing Fancy", not "nothing fancy".
  title: string;
  // Normalised identity, from `cookbookKey()`. UNIQUE in SQLite, same guarantee
  // Shop.nameKey and Recipe.nameKey get. Keyed on **title and author together**,
  // because two different books really are called "Dinner" and a shelf that
  // can't hold both is worse than one that holds a near-duplicate.
  titleKey: string;
  // null until someone fills it in, which is the common state on an import: a
  // running head gives the title far more often than it gives the author.
  author: string | null;
  sortOrder: number;
  createdAt: string;
}

// A dish you cook, with what it takes to shop for it.
//
// Its own table rather than a TaskTemplate variant: applyTemplate materialises
// Task rows, and a recipe applied has to produce grocery writes. Ingredients
// are a JSON array rather than their own table for the reason templates.items
// is one — nothing outside this row holds an ingredient's id, so an ingredient
// needs no identity that survives a rename, and a blob is one fewer
// hand-written cascade in a database with foreign keys off.
export interface Recipe {
  id: string;
  name: string;
  // From recipeNameKey — so two spellings of one dish can't both exist in one
  // book. Unique per cookbook (`recipeInBook`), not across the box: two books
  // can each hold a "Lentil Soup". Kept by the store, not by an index.
  nameKey: string;
  notes: string;
  sourceUrl: string | null;
  // Legacy single attribution field, superseded by author/source below
  // (#1266). Old recipes may still carry a value here; nothing writes it any
  // more. Kept read-only rather than backfilled: an old value like "Alison
  // Roman, Nothing Fancy" can't be reliably split into a person vs. a
  // publication, so guessing would just move the ambiguity into two fields.
  // describeRecipe() falls back to it only when neither new field is set.
  sourceName: string | null;
  // The person it's from — "Alison Roman". Independent of `source`, same as
  // sourceUrl was independent of sourceName: plenty of recipes name one but
  // not the other, and neither implies the other. null means no attribution
  // was given, not "unknown".
  author: string | null;
  // The publication/cookbook/site it's from — "Nothing Fancy", "NYT Cooking".
  // Independent of `author` for the same reason.
  source: string | null;
  // What kind of thing `source` names. Independent of `source` itself being
  // set — a recipe can carry a source type before it's given a name, though
  // in practice the editor asks for both together. Null means never
  // classified, not "unknown"/"other".
  sourceType: RecipeSourceType | null;
  // A cookbook page number ("142", "112-115"). Only meaningful alongside
  // `sourceType === 'cookbook'` — see useRecipeStore.setSourceType, which
  // clears this the moment the type stops being a cookbook, the same rule
  // `servingsMax` follows for `servings`.
  sourcePage: string | null;
  // The book on the shelf this came out of — see `Cookbook`. Null for the
  // overwhelming majority of recipes, which is every one that isn't from a
  // book: a link import, a paste, something you cook from memory.
  //
  // Set implies `sourceType === 'cookbook'`, and `source`/`author` mirror the
  // book's own. The page stays here rather than on the book, because it's the
  // one part of a cookbook attribution that belongs to the recipe: a book has
  // many pages and this recipe is on one of them.
  cookbookId: string | null;
  // The low end of the servings count, or the whole count when the recipe
  // doesn't give a range ("serves 4"). null means no serving count at all.
  servings: number | null;
  // The high end of a servings range ("serves 4-6" -> servings: 4,
  // servingsMax: 6). null means the recipe isn't a range — just `servings`.
  // Never set without `servings` also set.
  servingsMax: number | null;
  // What the recipe makes when a person-count doesn't fit — "3 cups", "2
  // dozen cookies", "1 loaf". Free text, independent of servings/servingsMax
  // (a dough can have both: "serves 8" and "makes 2 loaves"). null means
  // nothing was given.
  recipeYield: string | null;
  /**
   * What the whole finished dish weighs, in grams, as the recipe is written —
   * `null` until somebody puts the pot on a scale, which is every recipe until
   * they do.
   *
   * **This is the only honest way to log a plate of a cooked dish.** Servings
   * are the app's other answer and they are a guess dressed as a measurement:
   * a lasagne "for four" cut into four unequal pieces is four different meals,
   * and a dish with no servings count can only be logged in fractions of
   * itself. A weight turns the question into arithmetic — the plate over the
   * dish is the fraction of the dish that was eaten — and it is the one number
   * a kitchen scale can actually settle.
   *
   * **As written, never as cooked on one night.** A doubled Sunday weighs
   * twice as much, so the cooking's own `MealPlanEntry.recipeScale` divides on
   * the way in and multiplies on the way out (`cookedDishGrams`). Same split
   * `leftoverKeepDays` makes and `recipeScale` makes from the other side: the
   * recipe is the document, the entry is one instance of having cooked it.
   *
   * **Nothing is derived from it beyond that fraction.** No calorie density,
   * no "servings you should have", no weight goal — the rule
   * `docs/arch/health-data.md` states for the user's own weight applies to this
   * one too. It scales figures the nutrition rollup already produced, and where
   * that rollup declined to answer this stays out of it.
   */
  cookedWeightG: number | null;
  /**
   * How many days this dish's leftovers keep, or null to fall back to
   * LEFTOVER_KEEP_DAYS_DEFAULT. A fish pie is not a chilli, and the keep-for
   * window is a fact about the dish rather than about one night's cooking —
   * which is exactly why it lives here and `MealPlanEntry.recipeScale` doesn't.
   *
   * **A default the log sheet opens on, never a rule it enforces.** Logging is
   * still the one place a `Leftover.keepUntil` is written, and the stepper there
   * shows this number so what's about to be stored is what's on screen — the
   * same reason the store keeps taking an explicit count rather than resolving
   * the recipe itself. See leftoverKeepDaysFor.
   */
  leftoverKeepDays: number | null;
  /**
   * The oven temperature the recipe is cooked at, in the unit it was written
   * in (`ovenTempUnit`), or null when it doesn't use an oven or nobody said.
   * One number for the whole dish: a recipe that steps the heat down mid-bake
   * keeps that in its method, since this exists so mise en place can say
   * "Preheat oven" before the first step.
   *
   * **Stored as written and converted only on display**, the same posture as
   * ingredient amounts (`unitConvert.ts`): 180°C read by someone on US units
   * shows as 350°F without the recipe changing. See `ovenTemp.ts`.
   */
  ovenTemp: number | null;
  /** Meaningless while `ovenTemp` is null; 'F' is the default a new one opens on. */
  ovenTempUnit: 'F' | 'C';
  /**
   * The step the oven comes on at, for a recipe that preheats partway through
   * ("step 10"), or null for the usual case of preheating before cooking starts.
   * A `RecipeStep.id`, so reordering steps keeps it pointing at the same one.
   * Resolve-or-shrug like every cross-row pointer here: a step that is deleted
   * (`removeStep` clears it), or hidden by an either/or pick, reads as null.
   * Meaningless while `ovenTemp` is null.
   */
  ovenTempStepId: string | null;
  // The user-attached photo — a file:// URI under the document directory
  // (src/utils/recipePhoto.ts `pickRecipeImage`), null until one's attached.
  // Deliberately not base64-in-the-row: a recipe photo is a picture the card
  // and detail screen render, not a payload the Messages API reads, so there
  // is no reason to pay SQLite (or every future row read) for the bytes.
  imagePath: string | null;
  // Null means untagged, not "none of these" — most existing recipes predate
  // this field and nothing should guess for them. See RecipeMealType above.
  mealType: RecipeMealType | null;
  // Free-form labels — "vegetarian", "quick", "thai". Deliberately alongside
  // `mealType` rather than replacing it: a meal type is a closed set the box
  // groups by and the meal planner reasons about, while these are whatever the
  // cook wants to slice their own library on. Lowercased and deduped by
  // normalizeRecipeTags (src/utils/recipeTags.ts) — a tag is an identity, so
  // "Thai" and "thai" must not be two chips in the filter row.
  //
  // **No registry, unlike Task.tags.** A task's tag survives with no tasks on
  // it because tag_registry keeps it (there's a Tags screen to create one from,
  // and a tag is how a task gets filed before it exists). A recipe tag is only
  // ever typed onto a recipe, so the vocabulary is derived from the recipes
  // themselves (allRecipeTags) and a tag nobody carries is a typo that cleans
  // itself up rather than a name to maintain.
  tags: string[];
  ingredients: RecipeIngredient[];
  // Headings declared with nothing filed under them yet — see recipeSections.ts.
  // A section otherwise only exists as the `section` string on an ingredient
  // row, so an empty one has nowhere to live without this; entries here are
  // pruned the moment a row actually carries the same label, so this never
  // duplicates what `sectionsOf(ingredients)` already reports. Empty for
  // every recipe that's never had a heading declared ahead of its ingredients,
  // which is most of them.
  emptySections: string[];
  // The recipes this one is partly made of — see RecipeComponent. Empty for
  // every recipe that isn't composed, which is most of them; the ingredient
  // list is still where a plain recipe lives.
  components: RecipeComponent[];
  // Placeholders filled from the kitchen at each cooking — see RecipeBlank.
  // Empty for every recipe that isn't a "no-recipe recipe", which is most of them.
  blanks: RecipeBlank[];
  // "Defrost the chicken", "start the sauce at 5" — real Tasks once "Add prep
  // tasks" on a planned meal walks this list, not a meal-specific reminder
  // path. src/utils/notifications.ts is Task-typed end to end
  // (scheduleTaskReminder(task)), and forking it for one feature is how an
  // app ends up with two reminder systems and one of them quietly broken.
  prepTasks: RecipePrepTask[];
  // The method, as discrete instructions rather than one blob — see `notes`
  // above. Empty for every recipe that predates this: `notes` is what every
  // existing recipe's method lives in, and stays exactly as legible as it
  // always was. Ordered by array position, the same convention `ingredients`
  // and `components` use — there is deliberately no separate order field.
  //
  // **Why this exists at all when `notes` already holds text**: scaling and
  // unit conversion can only ever reach a structured amount, never a sentence
  // — so "add 2 cups of the flour" inside a notes blob doesn't move when the
  // recipe is halved, and a cook mode has no unit to read a step's progress
  // against. A step is deliberately still just `text`, though: no ingredient
  // references and no per-step duration. Both were considered and both are a
  // second list to keep in step with this one, worth adding only once
  // something actually reads them (#1695).
  steps: RecipeStep[];
  // Method headings declared with nothing filed under them yet — the same
  // gap `emptySections` covers for ingredients, for `RecipeStep.section`
  // instead. Pruned the moment a step actually carries the same label, so
  // it never duplicates what `sectionsOf(steps)` already reports. Empty for
  // every recipe that's never had a method heading declared ahead of its
  // steps, which is most of them.
  emptyStepSections: string[];
  sortOrder: number;
  createdAt: string;
  /**
   * How many meal plan entries pointing at this recipe have been marked
   * cooked. Bumped once per "Mark cooked" tap and **never recomputed by
   * scanning entries** — the same discipline that keeps streaks safe from the
   * completed-task purge keeps this safe from the 180-day meal plan entry
   * prune (see MEAL_PLAN_RETENTION_DAYS).
   */
  cookCount: number;
  /** When this recipe was last marked cooked; null if never. */
  lastCookedAt: string | null;
  /**
   * Set from the edit page, or offered the first time the recipe is marked
   * cooked (see useRecipeStore.setVote, MealPlanScreen.setCooked). Null is
   * "no opinion yet", not "fine" — see RecipeVote. This is the recipe box's
   * one rating: there is no separate favorite flag any more, and 'loved' is
   * what a starred recipe used to mean.
   */
  vote: RecipeVote | null;

  /**
   * True while this recipe sits in the box's "Up Next" shelf — a small,
   * manually-ordered queue of things you want to try but haven't put on a
   * day yet. Independent of `vote` (an opinion about a recipe you've
   * already cooked, set the first time it's marked cooked) and of the meal
   * plan (a day it's actually scheduled onto) — this is neither: a recipe
   * can be loved and up next and unscheduled all at once, or any
   * combination of the three.
   */
  upNext: boolean;
  /**
   * Manual position within the Up Next shelf. Same number space Task.pinnedOrder
   * uses: 0 means "never ranked" (every recipe starts here, so an install
   * upgrading into this column reads exactly as it did before), and
   * reorderUpNextRecipes renumbers the shelf from 1 on every drag. Meaningless
   * while upNext is false.
   */
  upNextOrder: number;

  // Duration + cook timer + actual-time logging (#1091).

  /**
   * How long this recipe is expected to take, in minutes. Shown next to
   * ingredient count/servings (see describeRecipe) and doubles as the cook
   * timer's countdown target below — a recipe's duration and "how long to
   * time it for" are the same number, unlike a Task where estimatedMinutes
   * (workload) and timedMinutes (an explicit countdown target) are allowed to
   * differ.
   */
  estimatedMinutes: number | null;
  // The cook timer itself — the same banked-segment design as
  // Task.timerStartedAt/timerElapsedSeconds (see src/utils/timer.ts and its
  // recipe counterpart src/utils/recipeTimer.ts): only these two raw fields
  // are ever stored, and how much time has elapsed or remains is always
  // derived against the current clock, so a phone that was backgrounded or
  // killed mid-cook comes back with the right answer for free.
  timerStartedAt: string | null; // ISO timestamp while a live cook timer runs; null when stopped
  timerElapsedSeconds: number;   // banked from finished run segments; 0 when never run or reset

  /**
   * Actual cook time, logged when a timer session finishes — an aggregate,
   * deliberately not a row-per-session log. A row per cook would grow
   * without bound, which is the exact disease grocery_item_shops was
   * designed around (see the note on ItemShopLink): the fix there was
   * counters bounded by (items × stores), not a trip log, and cookCount/
   * lastCookedAt above already made the same call for "was this cooked" one
   * level up. So a logged session only ever touches three counters:
   * lastCookMinutes (the most recent one, for "took 32m last time"),
   * cookTimeCount and totalCookMinutes (paired, so an average — "usually
   * about 30m across 4 cooks" — is `totalCookMinutes / cookTimeCount` at
   * read time, never re-derived by scanning anything). This is what lets the
   * recorded time diverge from `estimatedMinutes` and be compared against it
   * over repeated cooks, without a table that grows with every meal made.
   */
  lastCookMinutes: number | null;
  cookTimeCount: number;
  totalCookMinutes: number;

  /**
   * How long prep (chopping, marinating, mise en place) takes before the
   * cook clock starts, in minutes — independent of `estimatedMinutes`, which
   * is cook time only now that this exists. `totalMinutes()` (recipeUtils)
   * is prep + cook whenever either is set; neither field derives from it.
   */
  prepMinutes: number | null;
  // The prep timer — its own banked-segment pair, so prep and cook can be
  // timed independently (mise en place while something else already simmers)
  // rather than sharing timerStartedAt/timerElapsedSeconds above.
  prepTimerStartedAt: string | null;
  prepTimerElapsedSeconds: number;
  // Actual prep time logging, the same aggregate shape as
  // lastCookMinutes/cookTimeCount/totalCookMinutes above.
  lastPrepMinutes: number | null;
  prepTimeCount: number;
  totalPrepMinutes: number;
  /**
   * Which Backfill screen fields the user has said not to ask about again on
   * this recipe — "this one genuinely has no serving count", not "not right
   * now" (that's the screen's own session-only skip). Same mechanism as
   * `Task.backfillDismissedFields`, holding `RecipeBackfillFieldId` values.
   */
  backfillDismissedFields: string[];
}

// One prep step on a recipe — TemplateItem's anchor-relative offset model
// reduced to the three fields this needs. Unlike TemplateItem.dueOffsetDays,
// `offsetDays` is never null: a prep step with no date wouldn't have
// anything to remind about, so every step in the list is dated relative to
// the meal by definition.
export interface RecipePrepTask {
  id: string;
  title: string;
  /** Days relative to the meal's date — negative before, 0 the day of. */
  offsetDays: number;
  /** Minutes before the resolved due date a reminder fires; null = no reminder. */
  reminderOffsetMinutes: number | null;
}

// One instruction, as written — "Preheat the oven to 400°F", not a template
// with amounts filled in. Free text and no length cap, same as `Recipe.notes`
// it's the structured replacement for: a step is a sentence or two, not a
// list-row label. See `Recipe.steps` for why this exists as its own list
// rather than staying inside `notes`.
export interface RecipeStep {
  id: string;
  text: string;
  /**
   * How long a timer started from this step should run, in seconds; null means
   * "whatever the sentence says", which is the ordinary case.
   *
   * Cook mode reads durations straight out of the step text (see
   * `parseStepDurations`), and for the great majority of steps that is the
   * whole feature: the number is already written down, and a field asking for
   * it again is a second copy to keep in step with the sentence. This exists
   * for the two cases the text genuinely can't answer — a step that says
   * "until the edges look dry" with a length only the cook knows, and one
   * whose phrasing the parser reads wrong — and it is only ever set by hand
   * from the step editor. **Nothing derived is ever written back here**: a
   * parse is a reading of the text and stays one, so a step whose wording
   * changes gets a new reading rather than an old answer.
   */
  timerSeconds?: number | null;
  /**
   * Which part of the method this step belongs to — "For the sauce", "For the
   * tofu". Absent (not null — see the round-trip note on `note` below) means
   * the recipe wasn't authored with sections, the common case. Same model as
   * `RecipeIngredient.section`: a label on a flat list, not a nested groups
   * type, inferred wherever a step's section differs from the step before it
   * (`RecipeDetailScreen`), with `Recipe.emptyStepSections` covering a heading
   * declared ahead of any step. `recipeSections.ts`'s helpers are generic over
   * `{ id, section }` and are reused here verbatim rather than duplicated.
   */
  section?: string;
  /**
   * A note kept alongside the step, shown under it in cook mode and on the
   * recipe screen; absent on a step nobody has written one for.
   *
   * The first writer is cook mode's own "ask about this step" answer (see
   * `cookQuestions.ts`), which is why the field is a plain note rather than
   * anything naming where the text came from: by the third time the dish is
   * cooked, what matters is that the answer is there, not that a model once
   * supplied it. Kept only when someone presses Keep — nothing is written by
   * asking, the same call `RecipeStep.timerSeconds` makes about a parse.
   *
   * Stored absent rather than null when cleared, so a step that never had one
   * round-trips byte for byte (`normalizeStep`).
   */
  note?: string;
  /**
   * "Only when this option is cooked": ids of the recipe's own either/or
   * options (a `RecipeIngredient` line or a `RecipeComponent` link that has a
   * `choiceGroup`). The step shows when any one of them is the pick, and always
   * shows when the field is absent.
   *
   * Reuses the pick the meal already stores (`MealPlanEntry.recipeChoices`)
   * rather than adding a second mechanism: an option id already says which
   * option it is, and `stepVisible` (`recipeComponents.ts`) is the one reader.
   * **An id that names no option on this recipe is ignored, and a step left
   * with no valid id shows always**: a deleted option must never be able to
   * swallow instructions.
   *
   * Stored absent rather than empty, so a step nobody conditioned round-trips
   * byte for byte (`normalizeStep`).
   */
  onlyWhen?: string[];
}

/**
 * One countdown that runs to the second, survives the app being closed, and
 * rings when it is up: a cook's step timer, or the rest between two sets of a
 * workout. One model and one store (`useStepTimerStore`) for both, told apart
 * by `kind`, rather than a fourth timer system (docs/arch/workouts.md).
 *
 * The two raw fields are `startedAt`/`elapsedSeconds`, the same banked-segment
 * pair `Task` and `Recipe` timers store — how much is left is always derived
 * against the current clock (see `src/utils/stepTimers.ts`), so a phone
 * backgrounded, killed or left face-down through the whole countdown comes
 * back with the right answer.
 *
 * **The kind decides the alarm's policy**, which is the only real difference
 * between the two: a recipe timer rings through quiet hours as a native alarm
 * (a pan is on the heat), a rest timer is a plain notification that quiet
 * hours suppress (see `scheduleStepAlarm`).
 */
export type StepTimer = RecipeStepTimer | RestTimer;

/** The clock every timer kind shares. */
interface TimerClock {
  id: string;
  /** What the countdown runs for. Fixed at start; "+1 min" (or a rest's −15 s / +30 s) moves it. */
  durationSeconds: number;
  /** ISO instant the current run segment began; null while paused. */
  startedAt: string | null;
  /** Seconds banked by earlier segments. */
  elapsedSeconds: number;
  /** ISO instant this was created, so the footer stack keeps a stable order. */
  createdAt: string;
}

/**
 * One countdown a cook started from a step of a recipe.
 *
 * A recipe's cook and prep timers are two fixed clocks measuring the whole
 * cooking; these are ad hoc, several at once, and belong to a sentence rather
 * than to the dish. That's why they're their own model and not a third pair of
 * `Recipe` columns: "7 minutes on the tempeh" and "20 minutes on the rice" are
 * two live timers during one cooking of one recipe, and a field pair can only
 * ever hold one.
 *
 * A timer stored before `kind` existed has none, and reads back as this
 * (`parseStepTimerQueue`).
 */
export interface RecipeStepTimer extends TimerClock {
  kind: 'recipe';
  /** The recipe the step belongs to, so a running timer can name its dish. */
  recipeId: string;
  /**
   * `CookStep.id` — a `RecipeStep.id`, or the synthesized `<recipeId>:notes:<n>`
   * of a step split out of a notes blob. Resolve-or-shrug like every other
   * cross-row pointer here: an edit that deletes the step leaves the timer
   * running, because the pan is still on the heat.
   */
  stepId: string;
  /** The dish's name when the timer started, so the row reads without a lookup. */
  recipeName: string;
  /** "Step 2 of 3" as it read when the timer started. */
  stepLabel: string;
  /**
   * A few words of the step's own text ("Simmer the rice, covered…"), from
   * `stepTimerExcerpt`, so two rows in the stack say which pan is which.
   * Absent on a timer started before it existed, which falls back to the label.
   */
  stepExcerpt?: string;
  /**
   * Set when the step said "every 30 minutes": the timer then rings after
   * each `durationSeconds` and waits for the cook to start the next round, and this is how many rounds the
   * recipe expects ("add 1 cup of water every 30 minutes for 2½ hours" is 5).
   * It is a target for the count to be read against and never a stop: a pot
   * that needs one more cycle gets a sixth ring and reads "6 of 5".
   *
   * Absent for a timer that rings once, which is every timer stored before
   * this existed.
   */
  repeatTarget?: number;
  /**
   * Which round of a repeating timer is running, from 2 up (absent means the
   * first). Each round is a plain countdown that waits at zero until the cook
   * starts the next, so this is stored rather than counted off the clock.
   */
  round?: number;
}

/**
 * The rest after a set of a workout. At most one at a time: logging the next
 * set replaces it (`useStepTimerStore.startRest`). When it runs out it chimes
 * and counts up; it never moves the workout on by itself (a step that runs out
 * waits, `focus-sessions.md`).
 */
export interface RestTimer extends TimerClock {
  kind: 'rest';
  /** The `WorkoutSession` it belongs to. Resolve-or-shrug, like every pointer here. */
  sessionId: string;
  /** The exercise whose set started it. */
  exerciseId: string;
  /** The session's title when the rest started ("Push A"), so the Lock Screen reads without a lookup. */
  sessionTitle: string;
  /** "After set 2 of Barbell bench press", as it read when the rest started. */
  label: string;
}

// Shorter than TITLE_MAX_LENGTH for the same reason a grocery item's is: this
// is a list-row label at a larger font, not a task title.
export const RECIPE_NAME_MAX_LENGTH = 80;
// A byline, not a title — "NYT Cooking" not a full citation.
export const RECIPE_SOURCE_MAX_LENGTH = 60;
// "142" or "112-115" — never a citation, so far shorter than the source name.
export const RECIPE_PAGE_MAX_LENGTH = 12;

// A tag is a chip in a filter row, so it has to stay readable at chip size —
// "weeknight", "make ahead", not a sentence. Shorter than every other recipe
// string for that reason. See Recipe.tags.
export const RECIPE_TAG_MAX_LENGTH = 24;

// A choice group's label ("Side", "Starch") — the same kind of short component
// name an ingredient section carries, and the same ceiling, for the same
// reason: it renders as a section heading above the options it names.
export const RECIPE_CHOICE_GROUP_MAX_LENGTH = RECIPE_SECTION_MAX_LENGTH;
