import type { FoodNutrition } from './nutrition';

// One row of the grocery catalog — which is also the shopping list. A row is
// created the first time an item is typed and then lives forever: `onList`
// says "I intend to buy this", `checked` says "it's in the trolley", and
// finishing a trip clears both rather than deleting anything. That's what
// makes the second "Milk" a toggle instead of a duplicate, and what gives
// autocomplete and the catalog something to rank.
//
// Deliberately not a Task: a task is an occurrence you complete once, so
// modelling groceries as tasks floods Inbox/Unscheduled (neither predicate has
// an escape hatch but projectId) and leaves a completion tombstone per trip.
/**
 * One remembered price, as recorded by a finished trip.
 *
 * The whole point of keeping several is that a *single* last price is a poor
 * baseline: last week's happened to be a sale, and everything measured against
 * it reads as a jump. A short run of them answers "what does this usually
 * cost", which is the question a price is actually asked.
 *
 * **The quantity travels with the amount** and is not optional bookkeeping —
 * "$4.99" means nothing without "for 12 oz", which is the same ambiguity
 * `lastPriceQuantity` exists to close. A run of observations at mixed sizes is
 * normalized before anything is computed over it, or refused outright; see
 * `priceHistory.ts`.
 */
export interface PriceObservation {
  /** Minor units, same as every other price here. */
  minor: number;
  /** What that price was for, as written. Null when the row named no amount. */
  quantity: string | null;
  /** ISO. */
  at: string;
  /**
   * Which box this price was for — the item's preferred product at the moment
   * the trip was finished, or null when it had none.
   *
   * **This is what makes a run answer "what does the one I buy cost" rather
   * than "what does bread cost".** Without it a run mixes Arnold's whole wheat
   * with the store brand seeded sourdough, and the median describes neither —
   * the same disease `lastPriceQuantity` exists to cure one level down, where
   * "$4.99" means nothing without "for 12 oz".
   *
   * **Stamped on the observation rather than kept in a per-product table**,
   * which is the cheaper half of the same answer: the runs are already capped
   * blobs on the rows that own them, so scoping is a filter at read time
   * (`priceRunForProduct`) instead of a third price level with its own table,
   * its own cascade and its own write path in `dbFinishGroceryShopping`.
   *
   * **Null is the honest fallback, not a gap.** An observation recorded before
   * this shipped, or on a trip for an item with no preference, genuinely
   * doesn't know which box came home — the same thing `ItemShopLink.productId`
   * refuses to guess. Such observations stay in the run and are what a filtered
   * run falls back to when it has too little of its own to be a baseline.
   *
   * Resolve-or-shrug at every reader: an id naming a product that has since
   * been deleted or merged away simply never matches a filter, which reads as
   * "not this box" rather than as an error.
   */
  productId?: string | null;
}

/**
 * A shopping list other than the one at home — "Airbnb", "Beach house",
 * "Camping". Named, created by the user, and deleted when the trip is over.
 *
 * **There is no row for the home list, and that's the whole migration story.**
 * `GroceryItem.listId` is null for it, so every row that existed before this
 * shipped is already on it and nothing had to be backfilled. It also means the
 * one list that must always exist can't be renamed into nothing or deleted by
 * accident: it isn't data.
 *
 * **A list is a scope on the trolley, not a second catalog.** There is still
 * one `GroceryItem` per thing you buy — one aisle, one purchase history, one
 * pantry state, one set of substitutes — and a list only says which trolley a
 * row is in right now. That's why membership lives on the item beside `onList`
 * rather than in a join table: a row can only be on one list at a time for the
 * same reason it can only have one `checked` and one `sortOrder`.
 *
 * **Every list but home is an "away" list, and an away trip records nothing.**
 * Finishing one takes the checked rows off and stops there: no purchase count,
 * no price, no store link, no use-by countdown, and none of the pantry claims a
 * purchase normally refutes. Groceries bought for a rented kitchen 400 miles
 * away are not evidence about yours, and the failure that rules out is
 * concrete — a week at the beach otherwise leaves the app certain there are
 * eggs in your fridge and quoting you Cape Cod prices for months. There is
 * deliberately no per-list switch for this: "home" and "away" is the whole
 * distinction, and a flag would be a second thing to explain and a second state
 * for every purchase path to respect.
 */
export interface GroceryList {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

/**
 * One row's place in one list's trolley — the membership record, and the source
 * of truth for every list including the one at home.
 *
 * **A row can be in two trolleys at once, and that is the whole reason this is a
 * table rather than a column on the item.** The staples you need in both
 * kitchens are the ordinary case, not an edge one: adding "milk" to the Airbnb
 * list must not take it off the list at home, which is exactly what a singular
 * `GroceryItem.listId` did. Everything that has to differ per list is therefore
 * here rather than on the item:
 *
 * - **`checked`** must be, or ticking milk off at the shop near the rental would
 *   show it as in the cart at home, and the next trip there would buy it.
 * - **`choiceGroup`** must be, because an either/or is *this* trolley's "apples
 *   or pears" — see `GroceryItem.choiceGroup`, which says so in as many words.
 * - **`sortOrder`** must be, because each list is walked in its own order. This
 *   is the one of the three that would merely have been untidy shared; it comes
 *   along because the other two settle the shape anyway.
 *
 * Everything that is a fact about the *thing you buy* stays on `GroceryItem` and
 * is emphatically not duplicated here: one aisle, one purchase history, one
 * pantry state, one set of products, one set of substitutes. A list scopes the
 * trolley, never the catalog.
 *
 * **`listId` is null for the list at home**, which has no `GroceryList` row —
 * see that type. In SQLite it is stored as `''` instead, because the table is
 * keyed on (item, list) and SQLite treats NULLs in a key as distinct, so a null
 * would let one row join one list twice.
 *
 * **The item's own `onList`/`checked`/`sortOrder`/`choiceGroup` mirror the home
 * entry** and are maintained by the single function that writes these. That is
 * what lets every reader written before separate lists existed keep working
 * unchanged and keep meaning what it always meant.
 */
export interface GroceryListEntry {
  itemId: string;
  /** Null is the list at home. Stored as '' — see above. */
  listId: string | null;
  checked: boolean;
  sortOrder: number;
  choiceGroup: string | null;
  /** When this row joined this list. The per-list half of `lastAddedAt`. */
  addedAt: string;
}

/** One recipe's own amount of a grocery row. See `GroceryItem.recipeSources`. */
export interface GroceryRecipeSource {
  recipeId: string | null;
  title: string;
  quantity: string | null;
}

/**
 * What a food is, for filling a recipe's blank ("a grain", "any vegetables").
 * A closed set rather than free text, for the reason `RecipeMealType` is one:
 * a blank names one of these and a catalog item answers to it, so both sides
 * have to agree on the spelling. The labels and the name guess live in
 * `src/utils/foodKinds.ts`.
 */
export type FoodKind =
  'vegetable' | 'fruit' | 'legume' | 'grain' | 'protein' | 'dairy' | 'nuts' | 'sauce' | 'herb';

export interface GroceryItem {
  id: string;
  // What the user last typed — the label. "Whole milk" and "milk" reading
  // identically in the list would be worse than a near-duplicate.
  name: string;
  // Normalised identity, from groceryNameKey(). UNIQUE in SQLite, which is
  // where the no-duplicates guarantee actually lives.
  nameKey: string;
  /**
   * Whether `name` is still the words a barcode lookup supplied, rather than
   * words a person chose.
   *
   * A scan mints a row named after whatever the product database calls it, and
   * `shopperNameFor` deliberately only tidies that text rather than
   * understanding it: knowing "Great Value 2% Reduced Fat Milk" means milk
   * means knowing what the words mean, which is the guess that whole path
   * refuses to make offline. The review step is where a person is meant to fix
   * it, and in practice a lot of rows go through untouched, so the catalog
   * fills up with a product database's phrasing.
   *
   * **It is recorded, never inferred.** There is no reading of a name that
   * tells you who wrote it, and guessing from length or capitalisation would
   * queue up rows a person typed on purpose. So the scan path sets it on the
   * rows it mints, and only on the ones whose proposed name was left alone.
   *
   * **`renameItem` clears it**, which is what makes it mean "still wearing the
   * barcode's words" rather than "arrived by scan once". Nothing else writes
   * it; a merge keeps the survivor's own answer, since the survivor's name is
   * the one that stays.
   *
   * False on every row that predates the column, which is the honest reading:
   * nothing recorded how those were named, and a queue is a worse place to
   * find that out than the item sheet is.
   */
  nameFromScan: boolean;
  // Which of this item's products the user wants — the one to reach for. Null
  // (the common case) means no opinion: any bread is bread.
  //
  // This pointer replaced a `brand`/`variant` pair of strings on this row. The
  // pair could only ever hold the box you want *right now*, so switching from
  // Arnold's wheat to Dave's Killer overwrote it — which left nowhere to
  // record that you'd tried the first one and hated it, and no object for a
  // rating to hang on. It also never really paired the two words: "Arnold's"
  // and "wheat" named one box only because they sat on the row together.
  //
  // The item stays the Platonic ideal — one nameKey bridging recipes, Buy
  // again, the pantry and the aisle lexicon, one purchase history, one expiry,
  // one set of substitutes. The products hanging off it are the boxes on the
  // shelf. See ItemProduct, and `docs/arch/groceries.md`.
  //
  // Resolve-or-shrug at every reader (`preferredProductOf`), like every other
  // cross-row pointer here: a dangling id reads as "no opinion" rather than
  // throwing. Nothing should dangle — deleting a product clears this — but the
  // readers don't lean on that.
  preferredProductId: string | null;
  // "Only this one" — whether a store has to be on record with the preferred
  // product to count as having the item at all (shopsForItem and everything
  // built on it, including trip coverage and the shelf captions).
  //
  // **Default false, and that's what makes this safe to ship.** A preference
  // set before this existed, or set as a note to self, is a preference and not
  // a rule; turning every one of them into a filter would silently rewrite
  // which stores the app suggests. Nothing infers it — the user says so.
  //
  // **The product chooses the granularity, which is why there is one flag and
  // not two.** A product carrying a brand and no variant ("any Arnold's") is
  // the brand-level rule; one carrying both ("Arnold's wheat") is the
  // product-level rule its predecessor `brandStrict` couldn't express. That
  // was a real gap — the old per-store evidence was a bare brand string, so
  // there was no variant-level claim to filter on. `ItemShopLink.unavailableProductIds`
  // is that claim now, and it's made against a product.
  //
  // It is deliberately a fact about the *item*, not about the occasion. The
  // honest version of "it doesn't matter when it's for a recipe" needs to know
  // why a row is on the list this week, and the only signal available
  // (sourceRecipeId) is stamped solely on rows addFromPlan genuinely creates —
  // so a catalog staple re-added for a recipe carries none, which is exactly
  // the case it would have to get right. Guessing there would drop stores on
  // evidence the app doesn't have; this is a switch instead.
  //
  // Inert with no preferred product: there is nothing to be strict about.
  productStrict: boolean;
  // Never null, unlike Task.category: an unrecognised item is *in* the Other
  // aisle rather than aisle-less, which keeps the null branch out of every
  // grouping and sorting path.
  aisle: string;
  // Free text ("2 lb", "x3", "a bunch"). Nothing does arithmetic on it — the
  // parser exists to get it out of the name so the name stays a clean key.
  quantity: string | null;
  // Whether `quantity` is the app's own writing (a recipe's cooking amount,
  // true for one shop) rather than the user's standing preference. The field
  // has two owners with different lifetimes and can't tell them apart on its
  // own: `addFromPlan` only writes into an empty or recipe-owned slot, and
  // finishing the shop or taking the row off the list clears a recipe-owned
  // quantity outright, since the shop it was for has happened. `setQuantity`
  // — the user typing an amount by hand — always takes ownership.
  quantityFromRecipe: boolean;
  note: string;
  /**
   * Whether this row is in the trolley of the **list at home** — see
   * `GroceryListEntry`, which is where every list's membership actually lives.
   *
   * A mirror of that list's entry, maintained on every membership write, and
   * kept because it is what every reader that predates separate lists means by
   * "on the list": the home list is the original one and these columns have
   * always held it. Nothing writes them except the one function that writes an
   * entry, so the two can't drift.
   *
   * **It is deliberately not "in some trolley".** The four readers that want
   * that broader question — `hasUserFacts`, `catalogPruneCandidates`,
   * `pantryCheckTasks`, and the Pantry row's "on the list" caption — ask
   * `onListAnywhere` (`src/utils/groceryLists.ts`) instead, because a row on the
   * Airbnb list must not be swept as unused or asked about as absent.
   */
  onList: boolean;
  // Invariant: checked implies onList.
  checked: boolean;
  // There is deliberately no `inCatalog` here any more (#1998). Every row is a
  // catalog row: coming off the list parks it, and the only thing that ever
  // removes one unasked is `clearList` sweeping rows that carry nothing anyone
  // put there (see `hasUserFacts` in `src/utils/groceryFacts.ts`). The flag it
  // replaced had to be set by hand by every feature that recorded a fact about
  // an item, and a feature that forgot destroyed that fact on the next
  // unrelated "Remove from list". The `in_catalog` column is still in SQLite,
  // written 1 and never read, the same way `task_groups.completed_at` is.
  sortOrder: number;
  // Bumped by finishShopping, never by clearList. Together with
  // lastPurchasedAt this *is* the autocomplete ranking signal, which is the
  // real reason a finished trip must not delete rows.
  purchaseCount: number;
  lastAddedAt: string | null;
  lastPurchasedAt: string | null;
  // How many days usually pass between buying this, as a running average of
  // the gaps between purchases (`nextPurchaseIntervalDays`), updated by each
  // home trip. Null until a second purchase gives it a gap to measure, which
  // includes every row bought before this column existed. It replaced a
  // cadence read off the row's age (`now - createdAt` over the count), which a
  // catalog row made long before its first purchase stretched to months.
  purchaseIntervalDays: number | null;
  createdAt: string;
  // The pantry override — an explicit "Got it"/"Out of it" assertion, and
  // *only* that. A future value reads as "on hand" regardless of what
  // grocerySuggest.probablyHaveReason's purchase reading would say on its
  // own; OUT_OF_IT_UNTIL reads as "confirmed not on hand" and *suppresses*
  // that reading, rather than letting stale purchase history overrule what
  // the user just said with their own hands. null defers entirely to the
  // purchase reading. Self-expiring: once a future date passes this reads
  // exactly as null again, so "Got it" never needs a separate action to wear
  // off — which is why the negative is a sentinel and not merely "in the
  // past", or a lapsed "Got it" would be indistinguishable from one.
  //
  // finishShopping used to set this forward on every purchase, which made the
  // assertion branch the only reachable one and told people they had marked
  // things on hand that a till had (#1770). A trip now only ever *clears* it:
  // coming home with something refutes an "Out of it" left on it, the same
  // correction a purchase already makes to ItemShopLink.unavailableAt.
  onHandUntil: string | null;
  // The recipe this item is on the list for, if any. Set when addFromPlan
  // creates a genuinely new catalog row, and restamped when it re-lists a row
  // that had fallen off every list — a row with no list membership left has
  // nothing to be credited to except the recipe that just put it back. A row
  // still standing on the list keeps its existing credit as far as typing a
  // known item goes, or a recipe re-adding one it already credited — but a
  // *different* recipe wanting the same standing row (see
  // `mergeOnListRecipeNeed` in useGroceryStore) drops this to null rather
  // than keep crediting just one of the two, same reasoning
  // `mealPlanGroceries` applies to a week's own overlapping ingredients. A
  // snapshot pair rather than a live id lookup: sourceRecipeTitle is captured
  // at each (re)listing and never refreshed in between, resolve-or-shrug like
  // every other cross-row pointer here — a later recipe rename or delete
  // doesn't touch it.
  //
  // **Scoped to the list membership it's about, not to the row.** It answers
  // "why is this on my list right now", so removeFromList/removeFromListMany
  // and finishShopping all clear it alongside quantityFromRecipe (same
  // reasoning: the shop it was for is over). A row that falls off the list
  // and comes back later gets re-credited on that re-add, same as any other
  // "fallen off every list" case above — it never carries a stale credit for
  // a recipe from a shop that already happened.
  sourceRecipeId: string | null;
  sourceRecipeTitle: string | null;
  /**
   * What each recipe asked of this row, once more than one has: the other half
   * of the single credit above, which drops to null the moment a second recipe
   * wants the same row. Empty or absent for a row one recipe (or none) put on
   * the list. **Read only through `recipeLedgerFor` (`recipeSources.ts`)**: it
   * is meaningful only while `quantityFromRecipe` is true, which is what lets
   * every site that ends a shop (finishing it, taking the row off the list)
   * stay correct by clearing that flag, without each one also clearing this.
   */
  recipeSources?: GroceryRecipeSource[];
  // "apples or pears" — two rows you'll pick between at the shelf, sharing this
  // label. Same idea as RecipeIngredient.choiceGroup and resolved by the same
  // rule (exactly one of a group is bought), with two differences that follow
  // from where it lives:
  //
  // It is an **opaque id, not a name**. A recipe's group label is a heading on
  // the ingredient list, so it has to mean something; a grocery list renders no
  // heading for it — each row just names its siblings — so a label would be a
  // second thing to keep in step with nothing to show for it, and two lines
  // typed alike would silently merge into one group.
  //
  // And it is **resolved destructively**: picking one at the shelf takes the
  // others off the list (see resolveChoice). A recipe's pick is a fact about a
  // cooking that lives on MealPlanEntry and leaves the recipe alone, but a
  // shopping list has nowhere to put "I chose apples" — an unresolved loser
  // just sits there looking outstanding, and finishShopping would leave it on
  // the list for ever.
  choiceGroup: string | null;
  /**
   * The generic name this item is a variety of, as a `groceryNameKey` —
   * "white onion" carries `'onion'`. Null (the overwhelmingly common case)
   * means the item is not a variety of anything, or nobody has said so.
   *
   * This is the one *vertical* relation between catalog identities, and it's
   * deliberately a key rather than an item id: the generic side is what recipe
   * lines say (`RecipeIngredient.nameKey` is the bridge), and plenty of
   * generics never exist as a row of their own — you buy white onions and red
   * onions, and "Onion" is only ever a word recipes use. Same precedent as the
   * aisle overrides, which are keyed by nameKey and outlive rows.
   *
   * The semantics are asymmetric on purpose, and that asymmetry is the whole
   * feature: a *specific* item satisfies a *generic* ask (a recipe line saying
   * "onion" is answered by white onion in the pantry — classifyPlanned,
   * useUpRecipes), while a generic never satisfies a specific one (a line
   * saying "red onion" matches only red onion; the parent and its other
   * varieties surface as a "you have white onion" caption, the same informing-
   * never-buying rule substitutes follow). Where a substitute is a lateral
   * link between two different things, this says the item *is* the thing,
   * more precisely named.
   *
   * Single hop, never a chain: readers ask "which items declare themselves
   * varieties of this key" (`itemVarieties.ts`) and don't walk further, so a
   * mis-filed chain can't loop and "vegetable" never transitively claims
   * every onion. Nothing infers one — the user says so, same discipline as
   * substitutes — and `renameItem`/`mergeItems` re-point declarations at a
   * generic whose key changes.
   */
  varietyOfKey: string | null;
  /**
   * Other names this same item goes by: "kombu" on dashima, "scallions" on
   * green onions. Absent or empty means none.
   *
   * This is the same thing under another word, where `varietyOfKey` is a kind
   * of it and a substitute is a different thing you would tolerate. Stored as
   * the names as typed; the keys are derived (`groceryNameKey`) wherever a
   * name is resolved (`itemAliases.ts`), so there is no second key column to
   * drift from them. The item's own `nameKey` always wins over any item's
   * other name, and a name two items both claim resolves to neither.
   * Optional rather than required for the reason `Ingredient.example` is:
   * most items never have one.
   */
  otherNames?: string[];
  /**
   * What kind of food this is, as the person filed it ("tofurky is a
   * protein"). **Absent means "go by the name"** (`guessFoodKinds`), which is
   * every item nobody has filed; an empty list is an answer ("not something a
   * blank should offer") and is kept, so a wrong guess can be turned off.
   * Read only through `foodKindsOf`, which applies that rule. Optional for the
   * reason `otherNames` is: most items are never filed by hand.
   */
  foodKinds?: FoodKind[];
  // Always on hand — salt, pepper, water, the things nobody actually shops
  // for. Set by hand on GroceryItemSheet, and unlike onHandUntil it never
  // expires: a staple isn't a guess about recent purchases, it's a standing
  // fact about the kitchen. classifyPlanned (mealPlanGroceries.ts) sorts a
  // staple into its own section when a recipe's ingredients are added to the
  // list, so "salt" doesn't sit in Need to buy next to what the trip is
  // actually for.
  isStaple: boolean;
  /**
   * A `YYYY-MM-DD` local day key — the day this should be used up by, or null
   * for anything that doesn't go off on a schedule worth naming.
   *
   * A date rather than a `perishable` flag, for the reason `Leftover.keepUntil`
   * gives: a flag can only say *whether* to nudge, while a day can say *when*,
   * which is the thing the user is actually trying to get ahead of. Stored as
   * the resolved day rather than as "keeps for 5 days" so a later correction to
   * the purchase history can't silently drag the deadline with it.
   *
   * Written by `finishShopping` from the shelf-life lexicon (see
   * groceryShelfLife.ts) and by hand in `GroceryItemSheet`. Every purchase
   * re-stamps it: buying spinach again is fresh spinach, not the old bag.
   *
   * **Distinct from `onHandUntil`, which is nearby and answers a different
   * question.** That one is "do I still have this" — an availability guess that
   * feeds the pantry and a week plan, and that self-expires into silence. This
   * one is "is it about to be wasted", and it earns a real Task.
   */
  expiresAt: string | null;
  /**
   * ISO instant the user said they were nearly out, or null.
   *
   * **The state between "Got it" and "Out of it", and the one the pair was
   * missing.** Those two are the ends of a scale whose interesting point is in
   * the middle: noticing the jar is nearly empty is the moment you'd want it on
   * the list, and it's a moment the app had no way to hear about. `onHandUntil`
   * couldn't carry it — that column is a timestamp with two sentinel readings
   * already, and a third would be a third thing for `onHandAssertion` to get
   * wrong.
   *
   * **Running low still means you have it.** `probablyHaveReason` answers for a
   * low row, so it stays in the pantry and a week plan still counts it: there
   * is some left, which is exactly what distinguishes this from "Out of it".
   * What changes is that the row goes on the list, unless the person has
   * switched "Running low adds to the list" off.
   *
   * **It lapses, which is read at the time and never written.** The stamp stays
   * on the row, but `isRunningLow` stops counting it after up to two weeks (the
   * item's own purchase window when that is shorter). It once held until a
   * purchase cleared it, which only works if every purchase goes through the
   * app: one bought off the books left the row claiming "some left" for good,
   * and since a low row counts as on hand, it hid the item from a week plan's
   * shortfalls. A lapsed mark hands the question to the pantry check
   * (`pantryCheckLapse`). A purchase still clears it, and so does saying either
   * of the other two things.
   */
  runningLowAt: string | null;
  /**
   * ISO instant this was opened, or null for a jar still sealed and for the
   * bulk of a catalog where opening means nothing.
   *
   * **The third event that re-anchors a use-by day**, alongside a purchase and
   * a thaw. `expiresAt` is a fact about one purchase, and for a sealed thing
   * the purchase is the wrong anchor: a jar of salsa bought five weeks ago and
   * opened on Tuesday keeps a week from Tuesday, where the purchase-based guess
   * wrote it off a month back. `OPEN_SHELF_LIFE_LEXICON` is the second, much
   * shorter table that says which names that's true of.
   *
   * **Recorded even when it changes nothing.** A name the open lexicon has
   * never heard of still stamps this and still says so on the row: opening a
   * bag of spinach doesn't restart anything, but "opened Aug 12" is a true and
   * useful thing for the pantry row to say either way. Only the date is
   * conditional.
   *
   * Cleared by a purchase, exactly like `frozenAt` and for the same reason: the
   * jar you opened is not the jar you have just carried home.
   */
  openedAt: string | null;
  /**
   * ISO instant this went in the freezer, or null for anything that didn't.
   *
   * **The clock stops while this is set, and restarts when it's cleared.**
   * `finishShopping` stamps `expiresAt` from the shelf-life lexicon on
   * everything it buys, and that lexicon is at its most aggressive exactly
   * where a freezer is most used — chicken 2 days, ground beef 2, salmon 2.
   * Without this, a month of meat bought on Saturday spawns a fistful of "Use
   * up" tasks due Monday about food under an inch of ice, which is the
   * "spawns a task about food that's fine" failure `groceryShelfLife.ts` names
   * as the one that gets a feature turned off.
   *
   * **An instant, not a flag**, matching `lastPricedAt` and
   * `ItemShopLink.unavailableAt` rather than `isStaple`: what a frozen row has
   * to say is *when it went in*, since a freezer is the one place food outlives
   * every window the rest of the pantry reasons in. It also means the pantry
   * can keep showing it — see `probablyHaveReason`, which reads a live
   * `frozenAt` as on hand the way it reads a staple, because a purchase window
   * of two weeks would otherwise drop a frozen thing out of the kitchen while
   * it's still very much in the kitchen.
   *
   * **`expiresAt` is left alone while this is set, never cleared.** The stored
   * day goes quiet rather than away (`freshness.liveUseBy` is the single
   * reader), because what ends a freeze is a thaw and a thaw restarts the
   * count from a fresh shelf life. Stamping the new day at freeze time would
   * assert a thaw date the user hasn't picked; clearing it would leave nothing
   * to put back.
   */
  frozenAt: string | null;
  /**
   * A remembered shelf life, in days — "spinach keeps 5 days" — kept apart
   * from `expiresAt` on purpose: this is a fact about the *item*, and
   * `expiresAt` is a fact about one purchase of it.
   *
   * Set by hand in `GroceryItemSheet` when the item isn't currently on hand
   * (see `onHandUntil`), because there's nothing to count down from yet — the
   * clock starts when it's actually bought. **Only a real purchase activates
   * it**: `finishShopping` reads this as the shelf life for the row it just
   * bought, ahead of the `groceryShelfLife.ts` lexicon guess, and stamps
   * `expiresAt` from it. Marking "Got it" by hand deliberately does *not*
   * consult this — "Got it" doesn't say *when*, so it could be days-old
   * already, and guessing the countdown starts today would as often be wrong
   * as right.
   *
   * Editing "Use by" while the item *is* on hand writes `expiresAt` directly,
   * same as before this field existed, and updates this alongside it — a
   * correction made once is remembered for next time, the same way the app
   * already learns a purchase cadence.
   */
  shelfLifeDays: number | null;
  /**
   * What you last paid for this, in whole minor units of the one currency the
   * app knows about (cents/pence) — `429`, never `4.29`. An integer because
   * this is the number a trip estimate sums, and floats accumulate a tail.
   *
   * **Wherever you bought it.** `ItemShopLink` carries the same three fields
   * per store, and the split is exactly the one `purchaseCount` already makes:
   * a trip finished without naming a store writes this and no link, so this is
   * the price and the link ones are partial. Never reconcile them, and never
   * sum links to get an item's price.
   *
   * A price is a remembered observation, never a ledger the user maintains —
   * the same principle the pantry is built on. Nothing expires it, but nothing
   * renders it bare either: see `lastPricedAt`.
   */
  lastPriceMinor: number | null;
  /**
   * When that price was seen. A date rather than nothing, for the reason
   * `ItemShopLink.unavailableAt` is one: a price ages, and "$3.19 (March)" is a
   * fact you can weigh where a bare "$3.19" from eighteen months ago is the UI
   * lying. Every read renders the age alongside the number.
   */
  lastPricedAt: string | null;
  /**
   * `quantity` as it stood when the price was recorded — a verbatim snapshot,
   * never parsed and never divided into a per-unit price.
   *
   * Load-bearing: "milk $4.29" means nothing if last time was a gallon and this
   * week it's a pint. Deriving "$0.21/oz" from it would need a normalised unit,
   * which inherits every refusal `parseQuantityAmount` makes ("a bunch" has no
   * per-unit price) — so the string is shown next to the price and the reader
   * does the comparing.
   *
   * Null rather than `quantity` when a recipe wrote that quantity
   * (`quantityFromRecipe`): "3 cups" is what the week's cooking needed, not
   * the pack the price was paid for, and `recipeCost` divides by this string.
   */
  lastPriceQuantity: string | null;
  /**
   * Whether this item gets a "Use up X" task when it has an expiry — an
   * explicit per-item answer, or null for "the groceryUseUpTasks setting
   * decides". Exactly `MealPlanEntry.cookTask`'s tri-state, and for the same
   * two reasons.
   *
   * `false` is what deleting the task records, so the next purchase doesn't
   * hand back a task the user has already thrown away — a staple bought every
   * week is precisely the row that would otherwise nag for ever. `true` is the
   * opt-in for one item with the feature off, which is what makes the setting
   * safe to default off.
   */
  useUpTask: boolean | null;
  /**
   * When the user last swiped away a "Check if you still have X" task for this
   * row — the pantry check's opt-out (see `src/utils/pantryCheckTasks.ts`).
   *
   * **A stamp rather than `useUpTask`'s tri-state boolean**, for the reason
   * `Project.reviewDeclinedAt` is one: a permanent `false` says "never ask me
   * about this item again", which is far more than a swipe means. A pantry
   * check is about one purchase running out of credibility, and the same row
   * earns a new question every time it's bought and lapses again.
   *
   * **It expires against `lastPurchasedAt` rather than against the day.** A
   * project stays quiet indefinitely, so its decline lapses at the day
   * boundary and the offer comes back tomorrow; a pantry question that came
   * back tomorrow would be nagging about a cupboard. The purchase is the unit
   * here — declined after the last purchase means "don't ask again until I buy
   * it" — which is also why nothing clears this on a purchase the way
   * `frozenAt`/`openedAt`/`runningLowAt` are cleared: a stamp that predates the
   * new purchase is already spent, so there is no second place to keep in step.
   */
  pantryCheckDeclinedAt: string | null;
  /**
   * When the pantry review deck (`src/utils/pantryReview.ts`) last got an
   * answer about this row, or null if it never has.
   *
   * **The answer already writes a column, so this exists only to stop the deck
   * asking again the next time it opens.** "Still have it" renews
   * `onHandUntil` and "Running low" sets `runningLowAt`, and both of those make
   * the row *asserted* rather than absent — which is a tier the deck
   * deliberately still cards (the app has been told, so it asks last, but it
   * does ask). Reopening the deck an hour later therefore dealt the same
   * twenty cards back, with the pass that had just answered them as the reason
   * they qualified.
   *
   * **A stamp rather than a flag, and read against the clock rather than
   * against a purchase.** Unlike `pantryCheckDeclinedAt` there is no one
   * purchase this is spent against: a review answer is about the cupboard as it
   * stands, not about one till receipt losing credibility, and "out of it" is
   * the only answer that takes a row out of the deck for good (by the sentinel,
   * not by this). So it lapses on plain elapsed days —
   * `PANTRY_REVIEW_QUIET_DAYS` — after which the row is a fair question again.
   *
   * Nothing else reads it, and nothing clears it on a purchase: a stamp older
   * than the quiet window is already spent, so there is no second place to keep
   * in step.
   */
  pantryReviewedAt: string | null;
  /**
   * How many times the user has said they finished this, and how many times
   * they've said it went bad — the two ways a thing leaves the pantry, counted.
   *
   * **The fridge already kept this and the pantry threw it away.** Closing a
   * container out is "Finished it" / "Threw it out" (`LeftoverOutcome`), read
   * back by `describeFridgeHistory`; marking a catalog row out of it was one
   * bit, so the same fact about a bag of spinach was discarded. Completing
   * "Use up spinach" and completing "Use up leftover chili" both land in
   * `UseUpResolveSheet`, and until this only one of them remembered what
   * happened.
   *
   * **Counts, never a rate, and deliberately not a shelf-life estimate.** The
   * obvious use — learn how long things really keep — is the one thing these
   * can't do. Both answers are recorded when the user *notices*, not when the
   * food turned, and that lag is routinely longer than the shelf lives in
   * `SHELF_LIFE_LEXICON` (2 days for chicken, 4 for berries). So both readings
   * are biased late and would drag a learned estimate *longer*, which is the
   * direction that makes a use-up task arrive after the food is already slime.
   * `shelfLifeDays` stays the correction, made by a person looking at the
   * thing; what these do is tell that person when it's worth making.
   *
   * **Nothing decays them.** A count is a count, which is why `lastSpoiledAt`
   * sits alongside — `lastPricedAt`'s argument exactly: a bare "went bad 3
   * times" from two years ago is the UI lying, so every read renders the age
   * with it.
   */
  usedUpCount: number;
  spoiledCount: number;
  /**
   * When the user last said this went bad. Null for a row that never has,
   * including every row that predates these columns.
   *
   * Only the spoiled side gets a date. "Used it up" is the ordinary outcome
   * and its age says nothing anyone would read; going bad is the one worth
   * dating, because that's the count a caption qualifies and the prompt fires
   * on.
   */
  lastSpoiledAt: string | null;
  /**
   * The last few prices this item was bought at, newest first, capped at
   * `PRICE_HISTORY_LIMIT`.
   *
   * **Bounded by construction, which is what keeps it an aggregate rather than
   * a log** — the objection `grocery_item_shops` was shaped around. A rolling
   * window also answers non-stationarity for free: prices drift, packaging
   * changes, and a median over everything ever paid would quietly mislead
   * after a year. There is no window to choose because the window is the cap.
   *
   * **Written by a finished trip and nothing else.** A hand-typed price still
   * sets `lastPriceMinor` and is deliberately not recorded here: a trip is the
   * app watching a purchase happen, which is the same standard
   * `probablyHaveReason` holds itself to (#1770), and it means clearing a price
   * by hand has nothing here to un-say.
   */
  priceHistory: PriceObservation[];
  /**
   * What this food is made of, or null when nothing has established it yet.
   *
   * The generic answer for the catalog row, which is what a recipe ingredient
   * resolves to and so what a recipe's own nutrition is summed from. A box on
   * the shelf can disagree (`ItemProduct.nutrition`) and wins when it does, so
   * read the pair through `nutritionFor` rather than this field directly.
   *
   * **Null is unknown, never "contains nothing".** Most of the catalog will sit
   * at null for a long time, since a food only gains figures when a barcode, a
   * lookup or a person supplies them.
   */
  nutrition: FoodNutrition | null;
  /**
   * Which Backfill screen fields the user has said not to ask about again on
   * this item — "this genuinely isn't a variety of anything", not "not right
   * now" (that's the screen's own session-only skip). Same mechanism as
   * `Task.backfillDismissedFields`, holding `ItemBackfillFieldId` values.
   */
  backfillDismissedFields: string[];
}

// How many days before an item's expiry its "Use up X" task falls due.
//
// One day rather than zero: the task exists to get the thing eaten, and a
// reminder that arrives on the day it's already questionable has given up the
// evening someone could have cooked with it — the same call needsAttention()
// makes for a leftover. Zero is still sayable (use it on the day), and the
// ceiling is generous for the same reason LEFTOVER_KEEP_DAYS_MAX is.
// How many days before the Saturday the weekend nudge may first be raised.
// Two, so the window is Thursday and Friday: two days rather than one because
// the pass only runs when the app is opened, and a Friday-only offer is silent
// for anybody who does not open it that day. The floor is 1 (the Friday) rather
// than 0, since zero would put the offer on the Saturday itself, which is the
// one day the generator exists to stay off; the ceiling is 5 (the Monday),
// because a sixth day runs into the previous weekend. See
// src/utils/weekendTasks.ts.
export const WEEKEND_NUDGE_LEAD_DAYS_DEFAULT = 2;
export const WEEKEND_NUDGE_LEAD_DAYS_MIN = 1;
export const WEEKEND_NUDGE_LEAD_DAYS_MAX = 5;

// How many one-off tasks or events may already be on the weekend and it still
// counts as under-planned enough to nudge about. Default 1, so a single thing
// (one movie, one dinner) doesn't read as a fully planned weekend — the offer
// is about whether there's still room, not about literal emptiness. The floor
// is 0 (only a truly bare weekend counts) and the ceiling is 4 (a weekend
// naming four things is planned by any reading, so a fifth mustn't buy a way
// past that). See src/utils/weekendTasks.ts.
export const WEEKEND_NUDGE_PLAN_THRESHOLD_DEFAULT = 1;
export const WEEKEND_NUDGE_PLAN_THRESHOLD_MIN = 0;
export const WEEKEND_NUDGE_PLAN_THRESHOLD_MAX = 4;

export const GROCERY_USE_UP_LEAD_DAYS_DEFAULT = 1;
export const GROCERY_USE_UP_LEAD_DAYS_MIN = 0;
export const GROCERY_USE_UP_LEAD_DAYS_MAX = 14;

// How many days ahead of a planned meal its "Shop for X" task is raised.
//
// The mirror image of the pair above — that one counts backwards from a date
// something goes bad, this one counts backwards from a date something is
// needed — so it gets its own constants rather than sharing them: the two are
// answered by different habits and a person who shops on Saturdays has no
// reason to want their yoghurt chased on the same cadence.
//
// Two rather than one, unlike the use-up default, because the failure being
// prevented is different in kind. A use-up task that arrives late costs the
// item; a shop that arrives late costs the meal, and "you need three things for
// tomorrow" the evening before is exactly the blindsiding this generator
// exists to stop. Zero is still sayable (tell me on the day), and the ceiling
// matches the meal plan's own horizon — a warning about food a fortnight out is
// a warning about a plan you'll re-make first.
export const MEAL_SHORTFALL_LEAD_DAYS_DEFAULT = 2;
export const MEAL_SHORTFALL_LEAD_DAYS_MIN = 0;
export const MEAL_SHORTFALL_LEAD_DAYS_MAX = 14;

// How many "Use up X" tasks — grocery and leftover use-up tasks together — are
// allowed to be live at once (#1675). null (the default) is unlimited: this
// is a governor for a well-stocked kitchen with both generators on, not a
// behavior change for anyone who hasn't hit it. A source that's declined a
// slot isn't suppressed, just deferred until one opens up.
export const USE_UP_TASK_CAP_MIN = 1;
export const USE_UP_TASK_CAP_MAX = 20;

// The furthest out a use-by date can be set by hand, in days. Long enough for a
// freezer bag, short enough that the stepper can still reach the far end.
export const GROCERY_EXPIRY_DAYS_MAX = 365;

/**
 * Why a frozen thing is in the kitchen — `probablyHaveReason`'s word for it,
 * and the leading half of a frozen row's caption in `kitchenInventory`.
 *
 * Here rather than in `freshness.ts` beside `describeFrozenSince`, which is
 * where it reads like it belongs, for a module-weight reason: `grocerySuggest`
 * is one of the two producers and is deliberately free of `dateUtils` (which
 * reaches `useSettingsStore` and so `expo-sqlite`), so importing `freshness`
 * for one string would drag SQLite into every pure grocery test. `types` is
 * already where the kitchen's other shared constants live and costs nothing.
 */
export const FROZEN_REASON = 'in the freezer';

/**
 * Why a nearly-empty thing is still in the kitchen — `probablyHaveReason`'s
 * word for it, beside `FROZEN_REASON` and here for the same module-weight
 * reason.
 */
export const RUNNING_LOW_REASON = 'running low';

/**
 * Why a portion that has come back out of the freezer is still in the kitchen
 * — `productHaveReason`'s word for a thawed `ItemProduct.isPortion` box, and
 * here beside the other two for the same module-weight reason.
 *
 * Its own phrase rather than "marked as on hand", which is what the same
 * assertion reads as on an ordinary box: nobody tapped "Got it" on this one.
 * They took it out of the freezer, and that is the fact the row can state.
 */
export const THAWED_PORTION_REASON = 'out of the freezer';

// Shorter than TITLE_MAX_LENGTH on purpose — this is a shelf label, not a task
// title, and a long one wrecks the row layout at the bigger grocery font size.
export const GROCERY_NAME_MAX_LENGTH = 80;
export const GROCERY_QUANTITY_MAX_LENGTH = 24;
// Roomier than GROCERY_QUANTITY_MAX_LENGTH: a recipe's own amount is allowed to
// carry a parenthetical source count ("1 packet (1/4 ounce, 7 g)", "3 oz (from
// about 2 limes)") per extractRecipe's own prompt, which a grocery list's plain
// "2 lb" never needs room for. Used for RecipeGroceryItem.quantity on the way
// to RecipeIngredient.quantity — never for GroceryItem's own quantity field.
export const RECIPE_INGREDIENT_QUANTITY_MAX_LENGTH = 60;
// Shorter than a name on purpose: this is a brand, not a second name for the
// thing. Matches SHOP_NAME_MAX_LENGTH, which is the same kind of proper noun.
export const GROCERY_BRAND_MAX_LENGTH = 40;
// A product's note — "the blue bag", "too sweet". Room for a sentence and no
// more: this is a reminder to yourself at the shelf, not the item's own note.
export const GROCERY_PRODUCT_NOTE_MAX_LENGTH = 120;
// Its own constant rather than a second use of the brand's, because the two
// cap different things — a maker's name against a product line — and one of
// them changing shouldn't silently move the other. Same length for now.
export const GROCERY_VARIANT_MAX_LENGTH = 40;

// What the user thought of one product, once they've tried it. Null — the
// overwhelmingly common state — is no opinion: a product nobody has rated is
// one nobody has judged, which is a different answer from 'fine'.
//
// Three answers rather than a 1..5 scale on purpose. The question this answers
// at the shelf is "have I had this and would I get it again", and a scale asks
// for a precision nobody applies consistently to a bag of chips — four stars
// versus three is not a distinction anyone reproduces a month later, while
// "never again" is. 'fine' exists because "tried it, it was okay" is a verdict
// that silence cannot carry: without it a product you have had and shrugged at
// reads the same as one you have never bought. The reason lives in
// `ItemProduct.note`, not in a second field.
export type ProductRating = 'loved' | 'fine' | 'avoid';

// One box on the shelf — Arnold's wheat, Dave's Killer 21 grain, the store
// brand. A product *of* a GroceryItem, never a GroceryItem itself.
//
// **The item is the Platonic ideal and this is a thing you can actually pick
// up.** Bread is what recipes call for, what the pantry tracks, what has an
// aisle and an expiry and a purchase history; the products under it are which
// bread. That split is the whole reason this type exists: brand and variant
// used to be two loose strings on the item, which meant the item could
// remember the box you want *now* and nothing else — no record of the ones
// you've tried, and nowhere for `rating` to live.
//
// It is deliberately **not** a second GroceryItem. Folding "Arnold's wheat"
// into the catalog as its own row would mint a name that can never match
// "bread" the ingredient, and split one item's purchase history, pantry state
// and expiry in two — the exact reason brand was kept out of `nameKey` in the
// first place.
//
// **And it is not a substitute.** A hamburger bun standing in for bread is a
// different thing you buy, with its own aisle, its own pantry state and its own
// recipes calling for it, so it's an ItemSubLink between two items. The line:
// *same box → product, different thing → substitute*. Within an item you pick
// among products; across items you fall back to a substitute.
//
// Its own table (`grocery_item_products`), shaped like `grocery_item_shops`
// and `grocery_item_subs`, rather than a JSON blob on the item the way
// `Recipe.ingredients` is one. That call turns on the same question every
// time: does anything outside the row hold this id? Here it does —
// `GroceryItem.preferredProductId` and `ItemShopLink.productId` both point at
// a product, and a rating is a thing you'd want to look up across items.
export interface ItemProduct {
  id: string;
  // The item this is a product of. Cascade-deleted with it by hand, since FKs
  // are off — same as every other link table here.
  itemId: string;
  // Who makes it — "Arnold's", "Good Culture". Null is a variant with no maker
  // worth naming ("the low fat one"), which is an ordinary state.
  //
  // **Nothing parses this out of typed text, and that's the decision, not a
  // gap.** `RecipeIngredient.prep` and `purpose` are split off marked-up
  // clauses — a comma, a trailing "for X" — while a brand has no marker at all,
  // so telling "Good Culture cottage cheese" from "sliced almonds" means
  // knowing what the words mean. That's the guess splitPrep already refuses to
  // make.
  brand: string | null;
  // Which one of that brand — "wheat", "low fat", "4%", "crunchy".
  //
  // Separate from `brand` rather than more room inside it because the two are
  // different kinds of fact, and because the pair is what makes a product: the
  // maker is stable and is what a store gets recorded against, while the
  // product line is what actually varies within it.
  //
  // **A product with a brand and no variant is the brand-level statement**
  // ("any Arnold's"), and that's what lets `GroceryItem.productStrict` be one
  // flag instead of two — see its note.
  variant: string | null;
  // Normalised identity from `productKeyFor()`, UNIQUE per item in SQLite,
  // which is where "one row per box" actually lives. Same discipline as
  // GroceryItem.nameKey, scoped to the item rather than the catalog: two items
  // may both have a "store brand" product and those are different boxes.
  //
  // Invariant: never empty. A product with neither a brand nor a variant is
  // the item itself, and `addProduct` refuses it.
  productKey: string;
  // See ProductRating. Null is no opinion.
  rating: ProductRating | null;
  // Free text — "the blue bag", "too sweet", "only at the big Safeway".
  // A string whose empty value is "nothing written", like GroceryItem.note,
  // rather than nullable: nothing tests it for null.
  note: string;
  // How many finished trips brought this one home, and when the last did.
  //
  // Partial in exactly the way ItemShopLink's counters are, and for the same
  // reason: a trip finished before this feature existed, or one that bought an
  // item with no preferred product, bumps `GroceryItem.purchaseCount` and
  // writes nothing here. So the item's count is the total and these are a
  // subset of it. Nothing sums them to produce a total.
  purchaseCount: number;
  lastPurchasedAt: string | null;
  // The barcode on this box, once a scan has been confirmed against it. Null
  // for every product named by hand, which is most of them.
  //
  // **This is the one identity here that is globally unique**, unlike
  // `productKey` right above it, and the two are unique for opposite reasons:
  // a product key is scoped to its item because two items may each have a
  // "store brand", while a GTIN denotes one box in the world. Hence its own
  // partial UNIQUE index rather than a second `(item_id, …)` one, and hence
  // `dbSetProductGtin`'s release-then-claim write: moving a barcode to another
  // box has to take it off the first.
  //
  // **It lives here, and not on `gtin_lookups`, because it is a personal
  // fact.** That table is excluded from both sync and backup on the grounds
  // that it records nothing about the user (see `GtinLookup`), so a pointer at
  // one of their catalog rows kept there would not survive a restore and would
  // never reach a second device. What a barcode *denotes* is shared; which of
  // your boxes it is, is yours.
  gtin: string | null;
  /**
   * This box's own "Got it"/"Out of it", read exactly like
   * `GroceryItem.onHandUntil` — a future instant is on hand, OUT_OF_IT_UNTIL is
   * a confirmed absence, null defers to the item.
   *
   * **The four pantry columns here exist because a box is the thing you
   * actually have**, and one item can hold two of them at once: two brands of
   * vegan ground beef are interchangeable at the stove and are still two
   * separate packets in the freezer, one of which may be open, frozen or gone
   * while the other isn't. Before these, the pantry had one slot per item, so
   * saying anything about one packet said it about both.
   *
   * **A box only enters the pantry when the user says so** — see
   * `grocerySuggest.productHaveReason`, which reads these four and nothing
   * else. There is deliberately no per-box purchase reading to match
   * `probablyHaveReason`'s: `purchaseCount` here only ever bumps for whichever
   * box was *preferred* at the till (see `dbFinishGroceryShopping`), so
   * guessing from it would vouch for one brand and stay silent about the other
   * — and it would put a row in the pantry for every box anyone had ever named.
   * The item's own purchase reading stays the answer to "do I have any of
   * this"; these say which packet.
   *
   * `runningLowAt` deliberately has no counterpart here. It's the one pantry
   * assertion that writes `onList` (see its note on the item), and being nearly
   * out of one brand while a full packet of the other sits beside it is not a
   * reason to buy more.
   */
  onHandUntil: string | null;
  /**
   * This box's use-by day, `YYYY-MM-DD`, or null to fall back to the item's.
   * Same meaning as `GroceryItem.expiresAt` — "is this about to be wasted" —
   * scoped to the packet the date is actually about, which is the whole reason
   * two packets of one item can't share one.
   */
  expiresAt: string | null;
  /**
   * ISO instant this box went in the freezer. Suspends its countdown exactly as
   * `GroceryItem.frozenAt` suspends the item's, through the same
   * `freshness.liveUseBy`, and reads as on hand for the same reason: a freezer
   * outlives every window the rest of the pantry reasons in.
   */
  frozenAt: string | null;
  /**
   * ISO instant this box was opened, re-anchoring its use-by day off
   * `OPEN_SHELF_LIFE_LEXICON` the way `GroceryItem.openedAt` does. The one of
   * these four with the clearest claim to being per-box: an open jar and a
   * sealed one of the same thing are the case the item-level column could never
   * tell apart.
   */
  openedAt: string | null;
  /**
   * This box's own label panel, or null to fall back to the item's generic
   * figures — the same fall-through the four pantry columns above use, for a
   * sharper reason. The whole point of a product row is that Fage 5% and
   * Chobani 0% are different boxes, and their nutrition is exactly where they
   * differ: an item-level figure standing in for both would be wrong for at
   * least one of them.
   *
   * This is where a barcode's figures land, since a GTIN denotes one box in the
   * world and a label panel is that box's own statement about itself.
   */
  nutrition: FoodNutrition | null;
  /**
   * True for the one unnamed box "Freeze some" makes (`freezePortion`): part
   * of a pack that went in the freezer while the rest stayed out and kept
   * counting down (#2925). Every other box is a *brand*, and this is the one
   * that isn't — it is a place some of the item went, not a thing anyone buys
   * or rates.
   *
   * **It is a box because a box already had the four pantry columns** a split
   * pack needs, and a box's row already joins its item's rather than replacing
   * it. The item's own `frozenAt` couldn't say it: freezing the item suspends
   * the fresh half's clock and drops its use-up task, and leaving it unfrozen
   * left the frozen half nowhere to be written down. A second catalog row
   * would split one food's purchase history and recipes in two, which is why
   * `ItemProduct` exists in the first place.
   *
   * **Its identity is `productKey` = `PORTION_PRODUCT_KEY`**, a key
   * `productKeyFor` can never produce, so the item's UNIQUE `(item_id,
   * product_key)` index is what holds it to one per item and what folds two
   * phones' portions into one on sync. This flag is the reading side of that
   * and is what every reader tests (`isPortionBox`), so nothing ever compares
   * keys.
   *
   * **Nothing that treats a box as a brand sees one.** It is left out of the
   * Products list (`productsForItem`), can't be preferred, rated, renamed or
   * given a barcode, isn't a "saved brand" to lose when the item is forgotten,
   * and never earns a purchase count (only a preferred box does). It shows in
   * exactly one place: the pantry, as frozen stock of its item.
   *
   * **An item-level "Out of it" doesn't reach it while it's frozen**, which is
   * the one exception to "the item's Out of it outranks every box". "I've used
   * up the chicken" said about the half in the fridge is not a statement about
   * the half in the freezer, and a portion is not a brand you ran out of. Once
   * it's thawed it's more of the item in the fridge again, and the item's
   * "Out of it" takes it with the rest. It's deleted rather than marked when
   * it's used up: a named box is a memory worth keeping after the packet is
   * gone, and a portion is nothing but the packet.
   */
  isPortion: boolean;
  createdAt: string;
}

/**
 * The `productKey` every portion box carries. It has no `|` in it, and
 * `productKeyFor` always joins a brand and a variant with one, so no named box
 * can ever collide with it however it is spelled. See ItemProduct.isPortion.
 */
export const PORTION_PRODUCT_KEY = 'portion';

/**
 * Whether a box is a frozen-portion box rather than a brand — the one test
 * every reader that lists, counts or prefers boxes makes before treating it as
 * one. Here beside the type rather than in `groceryProduct.ts` because the
 * readers include `grocerySuggest` and `groceryFacts`, which that module reads
 * down into, so the obvious home is a cycle. Optional in its input so a caller
 * holding a narrowed `Pick` of a box can still ask.
 */
export function isPortionBox(product: { isPortion?: boolean } | null | undefined): boolean {
  return product?.isPortion === true;
}

/**
 * "At this store, a line reading GV MLK 2% GAL means milk."
 *
 * The memory that makes matching improve instead of staying at 85%. A receipt
 * line and a looked-up product name are both somebody else's words for
 * something in your catalog, and until this the app re-guessed them from
 * scratch every trip, getting the same ones wrong every time.
 *
 * **Written from a confirmation, not from a guess.** An alias is only recorded
 * when a person applied a review sheet with the row resolved — see
 * `rememberAliases`. The app's own reading is never fed back into itself, which
 * would let one bad match harden into a permanent rule.
 *
 * **Keyed by `id`, not by the pair it is unique on**, for the reason
 * `grocery_item_products` gives, plus one specific to this table: sync's
 * `row_key` joins composite keys with `|`, safe only because every other key in
 * the app is base36 from `generateId()`. This one would be a receipt's printed
 * text, which can contain anything.
 */
export interface StoreAlias {
  id: string;
  /**
   * The store whose printer produced this text, or `''` for a text that isn't
   * store-specific (a product name off a barcode lookup).
   *
   * Empty string rather than null because the UNIQUE index over
   * `(shop_id, raw_key)` is what stops two rows claiming one phrase, and SQLite
   * treats NULLs as distinct in a unique index — so a nullable column here
   * would enforce nothing at all for exactly the rows that need it.
   */
  shopId: string;
  /** The printed text, normalized by `aliasKeyFor()`. */
  rawKey: string;
  /** The catalog row this text means. Resolve-or-shrug, like every pointer here. */
  itemId: string;
  /**
   * How many times this has been confirmed. Not currently read by matching — a
   * remembered alias already outranks every similarity tier, so there is
   * nothing for a count to break a tie between. It's here because the write
   * path has it for free and because "confirmed nine times" is what a future
   * review screen would sort on.
   */
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
}

/**
 * What a barcode turned out to be, remembered so it is only ever looked up once.
 *
 * A cache of a *shared* fact, and the only thing in this app that is. Every
 * other grocery row records something about you — what you buy, where, what it
 * cost, whether you liked it. This records what a GTIN denotes, which is the
 * same answer for everyone and never changes, so it is keyed by the barcode
 * rather than by an item and is safe to keep for ever.
 *
 * It deliberately does **not** point at a `GroceryItem`. The resolution from a
 * scanned product to a row in your catalog is a judgement made in front of the
 * user at review time (see `scanResolve.ts`), and freezing the first answer
 * onto the cache row would mean a correction made once could never be revisited
 * — and would put a personal decision inside a table whose whole point is that
 * it holds none. Remembering the correction is `store_aliases`' job, which is
 * its own change.
 */
export interface GtinLookup {
  /** Canonical GTIN-14, from `normalizeGtin()`. */
  gtin: string;
  /**
   * Whether any source knew this barcode.
   *
   * **A miss is cached too**, which is the point rather than an optimisation: a
   * barcode nobody has heard of is the case that would otherwise hit the
   * network on every single unpack for ever. Misses expire, hits don't — see
   * `GTIN_MISS_TTL_DAYS`.
   */
  found: boolean;
  /** The product as the source names it, full and unabbreviated. Empty on a miss. */
  name: string;
  /** Who makes it, when the source says. Null is ordinary, not a gap. */
  brand: string | null;
  /** The pack size as the source prints it ("1 gal", "500 g"). Null when unstated. */
  quantity: string | null;
  /**
   * How the source files it — OFF's most specific `categories_tags` entry,
   * FDC's `brandedFoodCategory`, Go-UPC's `category`. Read by
   * `aisleForProductCategory` as a last resort for a row's aisle.
   *
   * **Null on every barcode cached before this column existed**, and nothing
   * refetches to fill it in. A hit never expires (see `found`), so a backfill
   * would mean re-asking the network for every code the user has ever scanned,
   * on the first launch after an upgrade, to improve a guess that already has a
   * working fallback. Those rows just keep landing on `aisleForName`, which is
   * exactly what they did before.
   */
  category: string | null;
  /**
   * The nutrition panel the source stated, or null when it stated none this
   * build could read.
   *
   * **Null on every barcode cached before this column existed, and nothing
   * refetches to fill it in** — the same call `category` made one column over,
   * for the same reason. A hit never expires (see `found`), so a backfill would
   * mean re-asking the network about every code the user has ever scanned, on
   * the first launch after an upgrade, unprompted. Those rows read as a product
   * whose nutrition is simply unknown, and rescanning the box fills them in.
   *
   * **Unknown here is not zero**, which matters more than it does for the
   * fields above: a null `brand` renders as no brand and a null panel must
   * render as no panel, never as a food containing none of anything. See
   * `FoodNutrition.amounts`.
   */
  nutrition: FoodNutrition | null;
  /** Which source answered, for telling a thin record from a good one later. Empty on a miss. */
  source: string;
  /** ISO. When this was asked, which is what expires a miss. */
  fetchedAt: string;
}

/**
 * How the shopping list groups what's still to buy: by aisle (the default and
 * the only one a drag can file into), by the recipe a row came from, or by the
 * store it is usually bought at (#2938). Three lenses on one list, never
 * layered; see `buildGroceryRecipeSections` and `buildGroceryStoreSections`.
 */
export type GroceryGroupBy = 'aisle' | 'recipe' | 'store';

// A place you shop. "Store" everywhere the user can read; `Shop` in code,
// because `store` is already Zustand's word here (useGroceryStore,
// useTaskStore) and `useGroceryStoreStore` is not a name anyone should type.
// Same split as Stack/TaskGroup.
export interface Shop {
  id: string;
  // As typed — the label. "Trader Joe's", not "trader joe s".
  name: string;
  // Normalised identity, from groceryNameKey(). UNIQUE in SQLite, same as
  // GroceryItem.nameKey, so two spellings of one store can't both exist.
  nameKey: string;
  sortOrder: number;
  createdAt: string;
  // "It has everything, but don't send me there" — Amazon is the canonical
  // case. Keeps the store fully available for manual linking (the item
  // sheet's picker, finishShopping's "which store") while pulling it out of
  // primaryShopFor/exclusiveShopFor and the grocery-run task button's store
  // picker. Same naming convention as Category.excludeFromSuggestions.
  excludeFromSuggestions: boolean;
  /**
   * What this store's receipts are good for. See ReceiptStyle.
   *
   * **Data, not a hardcoded special case.** The store this was built for is one
   * local shop whose register prints every line as "GROCERIES" with a price and
   * no name, but nothing about that is special enough to earn a branch in the
   * code — plenty of small stores do it, and the user is the only one who knows
   * which of theirs does.
   */
  receiptStyle: ReceiptStyle;
  /**
   * The aisles this store sells from, or `null` for a store that sells
   * everything. A pharmacy that stocks Personal Care and Household and nothing
   * else is the case this exists for: without it the finish sheet asks, every
   * trip, which of your fourteen groceries it didn't have.
   *
   * **`null` is the unscoped value and the default**, so nothing changes for a
   * store nobody has scoped. An empty array would have to mean "sells
   * nothing", which is not a thing anyone wants to say about a shop, so
   * clearing the last aisle writes `null` rather than `[]`.
   *
   * **An inclusion list, never an exclusion list.** A store is defined by the
   * short list here, and `normalizeAisleOrder` re-appends `DEFAULT_AISLES` on
   * every read — so with exclusions, an aisle that ships in a later version
   * would silently join every scoped store's range.
   *
   * **This is the user asserting a range, never the app inferring one**, which
   * is what puts it on the same side of the line as `ItemShopLink.unavailableAt`
   * rather than with the `likelyItemIds` guess `shoppingTrip.ts` deleted. Three
   * rules keep it there, and they live in `groceryShops.isOutOfRange`:
   * a positive link outranks it, nothing is ever materialised into link rows,
   * and it gates only what the app asks and asserts, never what the user can do.
   *
   * Aisle names are strings, so this is the fourth place one lives (after
   * `aisleOrder`, `GroceryItem.aisle` and the values of `aisleOverrides`):
   * `renameAisle` rewrites it and `deleteAisle` drops from it.
   */
  aisles: string[] | null;
  /**
   * The order you walk this store's aisles in, or `null` to walk it in the
   * usual order (`useGroceryStore.aisleOrder`), which is every store until
   * somebody arranges one (#2938).
   *
   * **Read through `shopWalkOrder` (groceryShops.ts), never directly.** The
   * list here is what somebody arranged on the day they arranged it: an aisle
   * added since is missing from it, and sorts where the usual order puts it
   * relative to its neighbours rather than dropping off the end. `Other` is
   * never stored and always walks last.
   *
   * **Applied only where the store is known**: the list while a trip at this
   * store is running, and this store's own section in the store lens.
   * Everywhere else (the kitchen, every aisle picker) keeps the usual order.
   * Arranged from the Aisles tab of `GroceryAislesSheet` during a trip here,
   * and cleared from the same place ("Use the usual order").
   *
   * **An order that walks the same as the usual one is saved as `null`**
   * (`shopAisleOrderToSave`), so a drag that ends where it began leaves the
   * store following the usual order, and any later change to it.
   *
   * Aisle names are strings, so this is the fifth place one lives (after
   * `aisleOrder`, `GroceryItem.aisle`, the values of `aisleOverrides` and
   * `aisles` above): `renameAisle` rewrites it and `deleteAisle` drops from it.
   * It is about the store rather than the device, so it syncs and is backed up
   * with the rest of the row.
   */
  aisleOrder: string[] | null;
}

/**
 * Whether a store's receipt is worth photographing.
 *
 * - `itemized` — an ordinary receipt with names on it. Scan it.
 * - `none` — nothing an extractor can use. Either the store hands you no paper
 *   at all, or what it prints has no item names on it ("GROCERIES ... 4.18").
 *   Both spend a request to learn nothing, so the sheet refuses and says why
 *   rather than reading it anyway.
 *
 * A third value, `opaque`, used to split that second case out: a receipt with
 * prices but no names still carries *real prices*, so instead of extraction it
 * offered pairing — what the trip bought in one column, what the paper charged
 * in the other, tap one then the other. It was removed because the pairing had
 * no information to work from (`autoPairing` could only ever decide the forced
 * cases, so the assignment was the user's to do by hand, row by row), and a
 * store that prints no names is now simply a store whose receipt can't be
 * read. Stores already marked `opaque` migrate to `none` in `initDatabase`.
 */
export type ReceiptStyle = 'itemized' | 'none';

export const RECEIPT_STYLES: ReceiptStyle[] = ['itemized', 'none'];

export function isReceiptStyle(value: unknown): value is ReceiptStyle {
  return RECEIPT_STYLES.includes(value as ReceiptStyle);
}

// One (item, shop) pair — an aggregate, deliberately NOT a log of trips.
//
// A row per item per trip would grow without bound, which is the disease the
// whole grocery catalog was designed around: GroceryItem is a forever-row
// carrying counters rather than a completion tombstone per shop. This is that
// same decision one level down, so the table is bounded by (items × stores you
// actually shop at) instead of by how long you've had the app.
//
// INVARIANT: item.purchaseCount >= sum of its links' purchaseCount. Trips
// finished before this feature shipped — and any trip finished without picking
// a store — bump the item and write no link. So the item-level count is the
// total and these are partial: never sum links to get a total, and never
// render "6 of 7 trips".
export interface ItemShopLink {
  itemId: string;
  shopId: string;
  // 0 means asserted by hand ("I get this at Costco") and never observed on a
  // trip. That's the whole distinction — it doesn't need a second flag.
  purchaseCount: number;
  lastPurchasedAt: string | null;
  // "They don't have it here" — the negative claim, stamped when it was made.
  //
  // A link row is therefore one of three things, and the count alone can't say
  // which: an observed purchase, a hand-assertion of availability
  // (purchaseCount 0, no stamp), or a store the user has said doesn't stock
  // this. The negative is the *current* answer and the count is history, so
  // both can sit on one row — a shop that stocked it eleven times and stopped
  // is exactly the case, and zeroing the count to express it would destroy the
  // record. Every "where can I get this" read (shopsForItem, primaryShopFor,
  // exclusiveShopFor, itemIdsForShop, planTrip) drops a stamped link; only the
  // item sheet's own store list, which exists to show and undo it, reads it.
  //
  // A date rather than a boolean because stock changes and the claim ages: it
  // says *when* you found the gap, which is what makes "not at Safeway (March)"
  // a fact you can weigh rather than a permanent verdict. Buying the thing
  // there clears it automatically — a purchase refutes the claim outright, and
  // that's the one correction nobody should have to make by hand.
  unavailableAt: string | null;
  /**
   * What you last paid for this item *here*, same three fields and same rules
   * as `GroceryItem`'s (minor units, stamped, with the quantity it was for).
   *
   * This is the half that answers "where is it cheaper" — see `cheapestShopFor`
   * — and it's why prices live on the existing aggregate rather than in a log
   * table: the comparison only ever needs the last number per store, which is
   * bounded by (items × stores) exactly as the counters above already are.
   *
   * The negative claim outranks it, like everywhere else: a store the user has
   * said doesn't stock the item is not a place to buy it cheaply, whatever
   * price it last had.
   */
  lastPriceMinor: number | null;
  lastPricedAt: string | null;
  lastPriceQuantity: string | null;
  /**
   * This store's own last few prices, newest first — same rules and same cap as
   * `GroceryItem.priceHistory`.
   *
   * Kept per store as well as per item because the question is per store: what
   * Costco usually charges and what Safeway usually charges are different
   * numbers, and a median mixing them describes neither shop. The item's own
   * run stays the fallback for a trip that named no store, which is a real and
   * supported answer — so the same purchase lands in both, exactly as
   * `lastPriceMinor` already does at both levels.
   */
  priceHistory: PriceObservation[];
  /**
   * The product you last got here — Arnold's wheat at Safeway, the store brand
   * at Costco. An **observation**, paired with lastPurchasedAt above, and
   * deliberately not a claim about what the store stocks.
   *
   * **It must never filter anything, because a store carries several products
   * of a thing.** Having got the store brand at Safeway once is not evidence
   * that Safeway hasn't got Arnold's wheat — it says nothing at all about the
   * rest of the shelf. Reading a mismatch here as "they haven't got yours" is
   * an absence inferred from something that isn't evidence of absence, which is
   * the error shoppingTrip.ts removed `likelyItemIds` to be rid of. The only
   * thing that drops a store is `unavailableProductIds` below, which the user
   * asserts.
   *
   * A *match* is the safe direction and is all this is read for: if the last
   * thing you got here was the one you want, this store demonstrably had it.
   *
   * Written by finishShopping, and only for a strict item — on a row with no
   * rule there is nothing to record, since the app has no idea which box came
   * home.
   *
   * Resolve-or-shrug, like every other cross-row pointer here.
   */
  productId: string | null;
  /**
   * "They haven't got *this one* here" — one entry per product the user has
   * said this store is missing, mapping the product's id to when they said so.
   *
   * The product-level twin of unavailableAt, and a genuinely different claim:
   * the store stocks the item, it just hasn't got the box you want. Every
   * "where can I get this" read drops such a link when the item is strict and
   * the claim names the *preferred* product, and **this is the only thing that
   * does** — see productId above for why an observed mismatch can't.
   *
   * **A map rather than one stamp, and keyed by product rather than implied.**
   * Its predecessor was a bare `brandUnavailableAt` date, which said nothing
   * about *which* brand it was about: switching the item's brand left the claim
   * standing, so the shelf caption would go on reading "no Dave's Killer at
   * Safeway" off a look you took for Arnold's. A claim stamped against the
   * product it was made about can't do that — switch the preferred product and
   * the old entry simply stops matching, and switching back finds it intact,
   * with no rule anywhere that has to remember to clear it. It also lets one
   * store be missing two of an item's products at once, which the single stamp
   * could not say.
   *
   * Dates rather than flags, for exactly unavailableAt's reasons: stock
   * changes, so a claim ages and says *when* you looked. An absent key is
   * unknown, and unknown always counts — the app not having watched you check
   * is ignorance. A purchase here clears the whole map, since coming home with
   * something refutes every claim about this store's shelf at once.
   *
   * JSON in SQLite, like `priceHistory` on this same row: nothing outside this
   * link holds a claim's identity, and the map is bounded by how many products
   * of one item you've actually looked for at one store.
   */
  unavailableProductIds: Record<string, string>;
}

// One (item, substitute) pair — "if there's no butter, use margarine".
//
// Shaped like ItemShopLink above because it's the same problem: a fact about a
// pair of rows, one row per pair, bounded by how many swaps you actually name.
//
// **A substitute is not an alternative**, and the distinction is the whole
// reason this is its own thing rather than another `choiceGroup`. The one-line
// test is whether the answer depends on the dish:
//
// - An *alternative* (`RecipeIngredient.choiceGroup`) lives on the recipe. Both
//   options are intended, they're equals, and which one you make is decided per
//   cooking (`MealPlanEntry.recipeChoices`).
// - A *substitute* lives on the item. One is intended and one is tolerated,
//   they're ranked rather than equal, it's consulted when the first isn't
//   available, and it applies to every recipe naming the item.
//
// Item-level is what makes this a system rather than a field: "I use margarine
// for butter" is one fact that reaches all twelve recipes calling for butter,
// and `RecipeIngredient.nameKey` already bridges every ingredient line to the
// catalog, so it gets there with no new plumbing through the recipes JSON.
//
// **Directional, and symmetry is two rows.** "Milk instead of buttermilk" is
// not "buttermilk instead of milk". A `symmetric` flag would make every reader
// stop and work out which way the row it's holding is facing — the same reason
// two ingredient rows beat one line reading "serrano or jalapeño".
//
// **Nothing infers one.** Same discipline as `GroceryItem.productStrict` and as
// the deleted `likelyItemIds` bucket in shoppingTrip.ts: the user says so, or
// it isn't recorded. There is no built-in substitution lexicon and there is not
// going to be one.
//
// One-to-many is permanently out: "buttermilk → milk + lemon juice" is two
// items both required, which is a recipe rather than a swap.
export interface ItemSubLink {
  // What the recipe asks for.
  itemId: string;
  // What you'd accept instead.
  subItemId: string;
  // The caveat, free text — "fine for frying, not for baking". Margarine for
  // butter is right in a pan and wrong in laminated pastry, and this is where
  // that goes: per-recipe scoping would rebuild `choiceGroup` badly, and since
  // nothing auto-applies a substitute, a wrong one is a caption you ignore
  // rather than a purchase you regret.
  note: string | null;
  createdAt: string;
  /**
   * "1 clove" → "1/4 tsp" — a user-typed conversion for the common case where
   * the substitute genuinely needs a different amount, not just a different
   * name. **Both null or both set; one alone is not a ratio.**
   *
   * The two things this is emphatically not: the app computing a ratio it was
   * never told (a built-in buttermilk→milk table — still out, and staying
   * out, same verdict as the deleted `likelyItemIds` bucket), and a claim that
   * generalizes past the amount it was stated for (¼ tsp per clove is a linear
   * model of something that isn't reliably linear — right at 3 cloves, wrong
   * at 20 in a garlic-forward dish; `note` carries that caveat, this doesn't
   * try to).
   *
   * Stored as the two strings the user typed, not a computed float: that's
   * what was written, it carries both units, and it round-trips into the
   * editor unchanged — the same instinct behind `quantity` being free text
   * everywhere else in this app. See `itemSubs.substituteQuantity` for the
   * one place arithmetic is done on these, and its refusals.
   *
   * A ratio-less link — the common case — shows no ratio anywhere. Rendering
   * "1 : 1" as a stand-in would invent a fact the user didn't state.
   */
  ratioFrom: string | null;
  ratioTo: string | null;
  /**
   * **A standing swap** — "I never buy dairy milk, so every recipe calling for
   * milk reads and shops as oat milk." One bit on the link rather than its own
   * system, because structurally that is all it is (#1571).
   *
   * It is the one deliberate exception to the rule every other read of a
   * substitute obeys: a substitute informs, it never buys. What earns the
   * exception is the mandate — the user named both items and ticked "always",
   * which is a stronger statement than anything `probablyHaveReason` acts on.
   * Four things keep it safe, and none of them is optional:
   *
   * - **Read time only.** `standingSwaps.applyStandingSwap` rewrites a line on
   *   the way out of `flattenRecipeIngredients`, the way `ChoiceResolution`
   *   resolves an either/or. Nothing writes the swapped name onto the recipe,
   *   so unticking this restores every recipe at once.
   * - **Always marked.** A swapped line says what the recipe said, wherever it
   *   is shown — the same call `unitConvert` makes with `≈`.
   * - **Directional and never chained.** `bothWays` writes the reverse row
   *   without this bit, and one item has at most one standing swap; a swap's
   *   target is never itself swapped.
   * - **A ratio that can't be applied refuses the whole swap.** Renaming the
   *   line while leaving an amount the ratio couldn't convert is worse than
   *   not swapping at all.
   *
   * The escape hatch for a swap that's wrong in one dish (butter to margarine
   * in laminated pastry) is `RecipeIngredient.noSwap`, per line.
   */
  standing: boolean;
  /**
   * **"Either one"** — butter and vegan butter are interchangeable for this
   * person, and which one went into a cooking is theirs to say each time.
   * Written on both rows of the pair (it is the one bit that is symmetric by
   * construction), and exclusive with `standing`: "always this one" and "ask me"
   * are two different answers to the same question, so setting either clears the
   * other on the items it names.
   *
   * Nothing is rewritten until a meal says which was used
   * (`MealPlanEntry.itemPicks`), and until it does the pair is **undecided**, not
   * defaulted: a recipe line for either one reads as written, and a read that
   * would put figures on a plate (`recipeNutritionLines`) refuses, the way it
   * already refuses an undecided either/or, because the two have different
   * nutrition and a guess logs the wrong one. See `itemEither.ts`.
   */
  either?: boolean;
}

/**
 * One answer to an "either one" pair for a single cooking: `use` is the
 * `nameKey` that went into it, `pair` is `eitherPairKey` of the two (sorted, so
 * the key is the same whichever item a line names). Stored on
 * `MealPlanEntry.itemPicks` and `FoodLogEntry.itemPicks`.
 */
export interface ItemPick {
  pair: string;
  use: string;
}

/**
 * The most a price can be, in minor units — £10,000. Not a validation rule
 * anyone should hit, just the ceiling that stops a mistyped card number
 * becoming a trip estimate.
 */
export const GROCERY_PRICE_MINOR_MAX = 1_000_000;

/**
 * One-tap presets for the currency symbol, not a closed list any more (#1476)
 * — a dozen doesn't cover everyone shopping in something else, so the setting
 * itself takes any short string. Kept here anyway: this string is concatenated
 * into every rendered price, so a validated length is what stands between a
 * real symbol and a total nobody can read, not membership in this array. There
 * is one currency at a time and nothing converts between them.
 */
export const CURRENCY_SYMBOLS: readonly string[] = [
  '$', '£', '€', '¥', '₹', '₩', 'R$', 'zł', 'kr', '₽', '₺', '₴',
];
export const DEFAULT_CURRENCY_SYMBOL = '$';
// 1–3 characters, matching the longest preset above ("R$"/"zł"/"kr") — long
// enough for everyone's symbol, short enough that it can't make a price
// unreadable.
export const CURRENCY_SYMBOL_MAX_LENGTH = 3;

// Shorter than a grocery item's: this is a chip label that has to sit in a row
// of other chips in a sheet, not a list row that owns its width.
export const SHOP_NAME_MAX_LENGTH = 40;

// Shorter again: an aisle is a section header above a list of items, and the
// longest built-in ('Meat & Seafood') is 14.
export const AISLE_NAME_MAX_LENGTH = 32;
