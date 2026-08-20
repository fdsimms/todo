# The grocery list, the shops, and the kitchen

Everything about what lands in the trolley: how the list is filed, which shop
has what, what the app believes you already have, and the four adjacent ideas
(either/or, alternatives, substitutes, standing swaps) that are easy to
conflate. `docs/arch/recipes.md` is the other half; a change that touches
ingredient lines usually needs both.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## Grocery aisles — a name is the identity, so deleting one needs a tombstone

An aisle is a *string*, held in three places at once: `aisleOrder` (a settings key), the `aisle`
column on every row, and the values of `aisleOverrides` (the remembered filings). So `renameAisle`
has to rewrite all three, and `deleteAisle` has to move the rows to `Other` — every row, not just
this week's list, since the aisle lives on the catalog row.

**`normalizeAisleOrder` re-appends `DEFAULT_AISLES` on every read**, which is the feature (a bigger
default list ships with no migration) and is also why a delete can't just drop the name from the
order — it would be back on the next launch. `hiddenAisles` (`grocery_aisle_hidden`) is the
tombstone that stops it, and it is **derived from the order being saved** by `commitAisleOrder`,
never edited directly: whatever the caller left out is a deletion, so the two can't drift, and
re-adding a deleted built-in by name un-hides it for free. The `used` pass still overrides a
tombstone — a section with no place in the order renders unplaced, which is worse than a
resurrected name, and after a delete nothing carries it anyway.

**`addByName` clamps through `placeAisle`.** Neither the lexicon nor a remembered filing knows what
the user deleted, so without it, deleting Snacks and typing "chips" files the new row under Snacks
and `used` brings the section straight back. For the same reason `deleteAisle` *forgets* the filings
that pointed at the aisle rather than rewriting them to `Other`: rewriting asserts a filing the user
never made, and it would outrank the lexicon for ever after.

`Other` can't be renamed or deleted — it's the floor `aisleForName` returning null lands on.

## Grocery stores (`Shop`) — which shop has which items

The rest of the grocery feature isn't written up here yet; this section covers only stores, which
is where the non-obvious decisions are.

**"Store" is the user-facing word; the code says `Shop`** — `Shop`, `shopId`, `grocery_shops`,
`FinishShoppingSheet`. Same split as Stack/`TaskGroup`, and for a blunter reason: `store` is
already Zustand's word here, and `useGroceryShopStore` sitting next to `useGroceryStore` is a pair
nobody would reliably pick between. Shops live *inside* `useGroceryStore`, like `aisleOrder`.

**`grocery_item_shops` is an aggregate, not a log.** One row per (item, shop) carrying
`purchase_count` / `last_purchased_at`, upserted by `finishShopping`. A row per item per *trip*
was the alternative and grows without bound — the same disease the completed-task retention
window exists to bound, and the reason `GroceryItem` is a forever-row with counters rather than a
tombstone per shop. This table is bounded by (items × stores you actually shop at).

- **`item.purchaseCount >= Σ link.purchaseCount`, and that gap is permanent.** Trips finished
  before this shipped, and any trip finished without naming a store, bump the item and write no
  link. So the item's count is the total and the per-store ones are partial: **never sum links to
  get a total, and never render "6 of 7 trips"**. `describeShops()` owns the wording so no caller
  re-derives it — "Bought 7 times · usually Costco" is true whether or not 6+1 happens to be 7.
- **A store can be told it doesn't have something** (`ItemShopLink.unavailableAt`), and that's the
  only negative in the feature. An *absent* link means "never seen here", which is ignorance; a
  stamped one means the user looked and it wasn't there, which is an answer — so it's a third link
  state, not the absence of one. **A date, not a flag**, and it sits happily on a row that also has
  purchases: a shop that stocked it eleven times and stopped is exactly the case, and zeroing the
  count to say so would destroy the record. Every "where can I get this" read drops a stamped link
  (`shopsForItem`, and so `primaryShopFor`/`exclusiveShopFor`; `itemIdsForShop`, `itemCountsByShop`,
  `planTrip`); only the item sheet's own picker reads it, because that's where it's shown and undone.
  **A purchase clears it automatically** — buying it there refutes the claim, and that's the one
  correction nobody should have to make by hand (`dbFinishGroceryShopping`, mirrored in the store's
  in-memory patch). Taking it back by hand deletes a row that was *only* the claim rather than
  clearing the stamp in place, since a bare `purchaseCount: 0` row is the opposite assertion.
- **It's captured where the trip ends, not in a settings screen.** `FinishShoppingSheet` lists what
  the trip left on the list and asks, once, which of it the store didn't have — the only moment
  anyone knows. Nothing is ticked by default (the usual reason a thing is left is that you didn't
  get to it, so silence has to mean that), the section only exists once a store is named, and
  changing the store clears the ticks rather than refiling them.
- **It's the one thing in `shoppingTrip.ts` allowed to assert an absence**, because it isn't the app
  asserting it. A marked item is dropped from the store's coverage and lands in
  `TripSummary.missing`, which the sheet states flatly where every other line is hedged. It stays
  out of `recordedItems` too: knowing what a shop *lacks* is not knowing its range, so it must
  never read as the app having learned something about the store.
- **A store is only ever credited with what it's been seen with** — a purchase or a hand-assertion.
  There used to be a third, softer bucket (`likelyItemIds`): a store with a couple of items on
  record from an aisle got credited with the rest of your list from that aisle, rendered as its own
  faded clause in every count, bar and sentence. It's gone, and the reasons are in
  `shoppingTrip.ts`'s header — unfalsifiable, twice the copy, and a number nobody can act on. The
  answer to a coverage that looks too low is the correction flow ("Actually, it has more"), which
  turns a guess into a fact the user owns. Don't reintroduce the guess.
- **A link with `purchaseCount: 0` is an assertion**, not an observation — the user tapped a store
  in the item sheet to say "I can get this here". That's the whole distinction and it needs no
  second flag: `primaryShopFor` refuses to call an assertion "usually" (the app would be inventing
  a habit), while `exclusiveShopFor` counts it (availability is exactly what the tap claimed).
  **`linkItemShop` promotes a provisional row** (`inCatalog`), for the same reason starring does:
  saying where you get something is a statement about the item, not about this week's list. Without
  it the next "Remove from list" deletes the row and silently takes the assertion with it.
- **Naming a store is optional and `null` is a real answer**, not a skipped step. It's a
  first-class pill in the finish sheet, it's the default until a trip has ever named one, and
  picking it finishes the trip exactly as every trip did before stores existed. A required
  question between a full trolley and a ticked-off list is how this feature would get turned off.
- **Stores got a table where aisles got a settings key**, which is the opposite call to
  `grocery_aisle_order` and follows the same rule categories did: an aisle is a name and a
  position, so a string list holds it; a store is referenced by every link row it owns, so it
  needs an id that survives a rename. Name strings in the links would break every record the
  moment someone fixed a typo.
- **Both cascades are hand-written** (`dbDeleteGroceryItem`, `dbDeleteGroceryShop`). expo-sqlite
  has foreign keys off, so `ON DELETE CASCADE` would silently do nothing — same reason
  `dbBulkDeleteTasks` walks `parent_id` itself. Readers are resolve-or-shrug anyway
  (`shopsForItem` drops a link whose shop is gone), like every other cross-row pointer here.
- **Manage stores in the setup sheet, browse them in Buy again.** The Stores tab of
  `GroceryAislesSheet` is add/rename/reorder/delete only; the "what does Costco carry" read is the
  filter chip row in `BuyAgainSheet`, because that's the catalog browser and it's open exactly
  when you're deciding what to buy where. **There is still no store chip on the shopping list
  rows** — the row is already dense, and a chip on every row is a column you can't act on. What
  a row can now carry is one quiet caption, and only while a trip is running: see below.

## The active trip — "I'm at this store"

The store used to be captured only at the *end* of a shop, in the finish sheet, which meant the
app never knew where you were while it could still be useful. `src/utils/activeTrip.ts` is the
other half: a trip is a store id plus a start stamp, and while one is running the list says
which rows you don't usually get here.

- **Stored as `(tripShopId, tripStartedAt)`; everything else is derived.** There is no `isActive`
  flag and no timer that ends a trip — the same call `timer.ts` makes about a countdown and
  `isDismissedToday` makes about a dismissal. A flag has to be cleared by something, and that
  something isn't running while the app is closed. The failure this rules out is specific:
  a Saturday-evening trip still marking rows up on Sunday morning.
- **`resolveActiveTrip` is the only sanctioned read** (`activeShop()` on the store). It drops both
  a deleted shop and an aged-out trip, so no caller has to remember to. `TRIP_MAX_MS` is six
  hours — generous enough that a slow shop is never cut off, short enough that an abandoned one
  is gone by morning. Deliberately *not* the logical-day rollover `isDismissedToday` uses: an
  11pm shop is a real thing and a day reset would end it twenty minutes in.
- **Explicit only, and started from the planner.** `ShoppingTripSheet` grows a second verb —
  its header confirm plans a trip (a task, possibly for tomorrow), "Start shopping at X" says
  you're there now. Overloading the one button would set the mode at exactly the wrong moment.
  Offered for a single selection only: you can only stand in one store, and a two-stop plan is
  still a plan. Nothing anywhere infers a trip.
- **Three terminators, and they're in three different places for a reason.** The Clear button and
  `clearList` end it in the store; finishing ends it in `GroceryScreen.handleFinished` rather than
  inside `finishShopping`, because that early-returns on an empty trolley and finishing a shop you
  bought nothing at still ends the trip. Expiry is handled twice — `initialize` repairs at read
  time (not written back, like the aisle order), and `checkTripExpiry` on screen focus clears the
  fields so an expiry that happened while the app was open becomes *visible* rather than merely
  true; a memo whose inputs haven't changed won't re-render itself away.
- **Silence is the default and it's load-bearing** (`tripMarkerFor`). Only three things can be
  said, and each is backed by something the user recorded: `unavailable` ("Not at Safeway", their
  own negative claim), `only` ("Only at Costco", every store on record is one other — a hand
  assertion counts), `usually` ("Usually Trader Joe's", observed purchases). A row this store has
  any link for says nothing, and **so does a row nothing is known about** — the app not having
  watched you buy tahini anywhere is ignorance, not evidence. Marking those would caption most of
  the list on anyone's first trip, which is how the feature would come to read as noise. Same
  discipline as `shoppingTrip.ts`.
- **The banner is a sibling of the list, not its `ListHeaderComponent`** — unlike
  `StartTripPrompt`. A mode indicator that scrolls away is one you can't find to turn off, and
  it's the answer to "why does this row say that" at the moment you're looking at the row. The two
  never render together: the card is for deciding where to go, the banner says you've gone.
- **The row caption is its own third text treatment**, borrowing `note`'s colour and
  `alternatives`' weight. A row can carry all three at once (a noted either/or item on record
  elsewhere); at identical styling they run together into a block you can't read while walking.
  It outranks the recipe caption and only that — provenance is the least useful thing at a shelf,
  while a user's note ("the blue cap one") is exactly what you're there for.
- **The `usually` case can't be seeded into demo mode.** It needs an item bought at two stores
  while you stand in a third, and the demo has two stores anyone would shop at. The seeded trip
  is at Trader Joe's and shows the other two.

## The kitchen — the pantry and the fridge, read as one thing

What the app treats as "have it" is one function, `probablyHaveReason` — an explicit
`onHandUntil` assertion if there is one, otherwise a guess from this item's own purchase cadence.
There is no inventory table and there must not be one: a maintained inventory is the feature that
dies in week three, so it's computed first and corrected second ("Got it" / "Out of it" on
`GroceryItemSheet`, and `finishShopping` stamping what a trip bought).

**Four mechanisms answer two questions, and `src/utils/kitchenInventory.ts` is the read above
them** (#1670). `onHandUntil` and `probablyHaveReason` answer "do I have it"; `expiresAt` and
`Leftover.keepUntil` answer "is it dying". Each is individually well-argued and none of them is
reopened — the notes on why an expiry is a date rather than a `perishable` flag, and why a
`Leftover` isn't a `GroceryItem`, still stand. The problem was one level up: a person has one
mental model here, and a bag of spinach going off Thursday and a container of chilli going off
Thursday are the same fact to the cook.

- **`KitchenEntry` is a view model, computed per render, never stored** — the `ContextRow`
  pattern, carrying only what a row draws so no reader treats it as the source. No schema change;
  it's pure derivation, which is why it's a util and not a store.
- **Membership is `pantryEntries` plus every live `Leftover`.** Deliberately *not* "everything
  carrying an `expiresAt`": that column outlives the food (nothing clears it when the bag is
  finished), so reading it as membership keeps a bag of spinach in the kitchen for ever, months
  past an "Out of it" the user already typed. `probablyHaveReason` stays the single owner of "do
  I have this", and a use-by day is only read off a row it has already vouched for.
- **One freshness ladder, in `src/utils/freshness.ts`.** `describeKeepUntil` and `describeExpiry`
  were word-for-word the same four lines; both are `describeUseBy` now, and `freshnessFor` is the
  one producer of `LeftoverFreshness` (which keeps its name — renaming it is a rename across the
  whole leftovers feature for no behaviour). `needsAttention` draws its line through
  `isUseUpSoon`, so the fridge and the catalog can't drift on where it is. That module imports
  nothing but `dateUtils` on purpose: `leftovers`, `groceryShelfLife` and `kitchenInventory` all
  read *down* into it, and one edge back up makes the three a cycle.
- **It ranks, it doesn't only label.** A screen can show everything; a single row has one line and
  has to pick what to name first. `compareKitchenEntries` sorts on the use-by day itself (which
  *is* the ladder's order — over, due, soon, fresh), then a container ahead of a catalog row
  because a cooked portion spoils harder, then by name. Anything with no day sorts last: an
  undated rice isn't fresher than a dated spinach, it's not in the conversation.
- **"Nothing to report" is a first-class answer.** `useUpEntries` returns `[]` and
  `describeKitchen` returns `''`, so a one-line consumer renders nothing at all rather than an
  empty row — the silence-by-default discipline `tripMarkerFor` runs on. The wording for such a
  row isn't here: copy is easiest to get right with the row in front of you, so it belongs to
  whatever builds one.
- **The generators still own their own triggers.** `useUpEntries` is the shared "what's dying"
  read for *surfaces*. A grocery's use-up task is a lead time back from the expiry (it's meant to
  arrive days early) and a leftover's fires the moment `needsAttention` turns true; folding those
  into one query would change what a grocery use-up task means.

**`KitchenSheet` is a read plus one write, not a second model.** It renders that inventory, the
fridge first and then the pantry cut into aisles. That's the distinction the aggregate view turns
on: nobody should have to check items in and out, but a set the app has already derived per-item
is worth being able to look at, and until this there was no way to answer "do I have flour" short
of opening items one at a time. Don't grow quantities, per-row expiry editing or a check-in
gesture onto it — that's the inventory again.

- **A catalog row carries the ✕; a container doesn't.** "Out of it" is one bit and the ✕ writes
  exactly it (`markOutOfMany`). Closing a container out is a two-way question ("Eaten" / "Thrown
  out"), and guessing "eaten" would write a fridge-history row the user never chose — so its row
  opens `LeftoverSheet`, which asks properly.
- **`LeftoversCard` still renders the fridge alone.** Its rows drag onto a night of the week, and
  a bag of spinach is not a dinner. What it shares with the kitchen is the ladder, not the list.

- **The one write is `addToPantry`**, off the field at the top, and it writes the same assertion
  the item sheet's "Got it" pill writes (`defaultOnHandUntil`) on the same catalog row. It exists
  because that correction was *unreachable* for anything with no row yet — an item sheet opens
  from the list or from Buy again, so "I have flour" was unsayable until flour had been bought
  through the app once. One bit, the one the pills already own; the things it deliberately doesn't
  record are how much and until when.
- **It never touches `onList`.** Saying you have something is not a plan to buy it. It promotes
  `inCatalog` for the reason `linkItemShop` does — otherwise the next "Remove from list" would
  delete the row and take the assertion with it — and it strips a typed quantity ("2 lb flour")
  so the row keys on a name a real purchase can match.
- **The field both filters and adds**, like `PillGroup`'s: what the search can't find is exactly
  what you're offered the chance to add, and "do I have flour" is the moment you learn you never
  said. It's also the one insert path besides `addByName`, so both go through `newItemRow` and a
  column added later can't reach only one of them.
- **Taking it back still goes through `GroceryItemSheet`'s Pantry pills**, which is why a catalog row here
  opens that sheet with them already unfolded (`initialField`). The sheet is dense, and a
  collapsed "Pantry" field halfway down it was in practice no way to say you're out of something
  at all — the caption promising it was simply wrong. Pre-opening it is the fix; a swipe action on
  the row is the check-in gesture, and stays out.

- **Rows on the list are deliberately in it.** An item can be both recently bought and back on the
  list; dropping it would make an item marked "Got it" vanish from the pantry the moment it was
  added to a list, which reads as the assertion having been forgotten. The row says "on the list"
  instead.
- **The row's caption is `probablyHaveReason`'s own words**, verbatim — the same line a week plan
  and the item sheet already show. A second phrasing here is a second thing to keep true.
- **A purchase is read, never asserted** (#1770). `finishShopping` used to stamp a computed
  `onHandUntil` onto everything it bought, which meant `probablyHaveReason` took its assertion
  branch for any row ever bought and the purchase branch below was unreachable — so the pantry
  could only ever say "marked as on hand", crediting the user with a claim a till had made, and
  the demo could only seed corrections. A trip now writes `null` and nothing else: coming home
  with something refutes an "Out of it" sitting on it, the same correction it already makes to
  `ItemShopLink.unavailableAt`. Both halves seed fine as a result.
  - **The negative is a sentinel, not "in the past".** `OUT_OF_IT_UNTIL` suppresses the purchase
    reading; a *lapsed* "Got it" hands the question back to it. Those were one case while nothing
    but `markOutOfIt` could put a past value there, and stamping windows that expire is what
    silently made them two — legacy rows still carry the shape, and read correctly without a
    migration.
  - **One window, two anchors.** `onHandWindowDays` is how long a purchase of this item is worth
    believing in: its own cadence past `MIN_PURCHASES_FOR_CADENCE`, a flat two weeks before that.
    `defaultOnHandUntil` measures it from the tap, `probablyHaveReason` from the till. Written
    twice, the two disagreed — the reading wanted three purchases before trusting a cadence and
    the assertion was happy with one, so a single purchase on a year-old row asserted on-hand for
    a year.
- **`GroceryItemSheet` and `LeftoverSheet` are rendered *inside* `KitchenSheet`'s `Modal`, not
  beside it.** A `Modal` presents from the view controller its React parent belongs to, so a
  sibling would ask the screen's controller to present a second sheet while the kitchen is already
  up. Nesting is what lets it stack — and keeping the kitchen mounted underneath is the point,
  since correcting one row should drop you back into the list you were reading.

## Grocery either/or — two rows you pick between at the shelf

Typing "apples or pears" into the add field offers to put **both on the list under
one `GroceryItem.choiceGroup`**, and ticking either one at the shop takes the others
off (`resolveChoice`). It used to add both plain, on the grounds that a shopping row
has no dish decision to defer — but the loser then sat there looking outstanding, and
`finishShopping` only clears what's checked, so it stayed on the list for ever.

- **The group is an opaque id, where a recipe's is a label.** A recipe renders the
  label as a heading over its options; a grocery list renders no heading at all — each
  row just names its siblings — so a label would be a second thing to keep in step
  with nothing to show for it, and two lines typed alike would silently merge.
- **It resolves destructively, where a recipe's pick doesn't.** `MealPlanEntry.recipeChoices`
  is somewhere to put "mash on Tuesday" without editing the dish; a shopping list has
  nowhere to put "I chose apples". So the tick *is* the choice, and it's a real undo —
  `resolveChoice` snapshots every row first and puts them back exactly, re-inserting the
  provisional ones it deleted and taking the winner's tick off with them.
- **Only rows still on the list are live options.** An off-list catalog row that once
  shared a group is history, not something to take away; and since `alternativeCaptions`
  drops a group that's down to one, a resolved pair stops captioning itself with no extra
  bookkeeping. That shared helper (`recipeComponents.ts`) is the same one the recipe
  screen's either/or ingredients use — same rule, and writing it twice is how they'd drift.
- **`setCheckedMany` deliberately doesn't resolve.** A bulk tick is a sweep over rows the
  user selected by hand; deleting rows they *didn't* select out from under it is not what
  that gesture says.
- **Unlinking lives in the item sheet, not on the row** ("Not an either/or", `clearChoice`,
  which takes the label off every member — one remaining option is not a choice). It's a
  correction, not a shopping decision: at the shelf you resolve a choice by ticking one.

## Substitutes (`ItemSubLink`) — one item standing in for another

**The vocabulary rule, so it can't drift: either/or on the list, alternatives on the
recipe, substitutes on the item — and a substitute marked "always use this instead" is a
standing swap.** Four adjacent terms for four genuinely different things; settled here
rather than left to be re-argued per PR.

The one-line test for which you're looking at: **does the answer depend on the dish?**
If yes it's a `choiceGroup` — both options intended, equals, decided per cooking in
`MealPlanEntry.recipeChoices`, scoped to that recipe. If no it's a substitute — one
intended and one tolerated, ranked rather than equal, consulted when the first isn't
available, and it applies to every recipe naming the item. Item-level is the whole
reason this is a system rather than a field: "I use margarine for butter" is one fact
that reaches all twelve recipes calling for butter, and `RecipeIngredient.nameKey`
already bridges every ingredient line to the catalog, so it gets there with no new
plumbing through the recipes JSON blob.

- **`grocery_item_subs` is shaped like `grocery_item_shops`** — a fact about a pair of
  rows, one row per pair, bounded by how many swaps you actually name. Both cascades in
  `dbDeleteGroceryItem` are hand-written and cover **both directions**, since FKs are
  off and the deleted row can be either half of a pair; the reads shrug a dangling link
  off anyway (`substitutesFor`), like every other cross-row pointer here.
- **Directional, and symmetry is two rows.** "Milk instead of buttermilk" is not
  "buttermilk instead of milk". A `symmetric` flag would make every reader stop and work
  out which way the row it's holding is facing — the same reason two ingredient rows beat
  one line reading "serrano or jalapeño". `linkItemSub`'s `bothWays` writes the pair, so
  the common symmetric case is one tap and the asymmetric one stays expressible;
  `Substitute.isMutual` reports it rather than storing it.
- **Nothing infers a link, and there is no built-in substitution lexicon.** Same
  discipline as `brandStrict` and as the deleted `likelyItemIds` bucket
  (`shoppingTrip.ts`): the user says so, or it isn't recorded. That verdict stands.
- **A substitute is surfaced only where there's a reason to believe it would help** —
  the user asked, the store was marked as not stocking the original, or the original is
  marked "out of it" *and* the substitute is on hand. Never as a general caption, and in
  particular **`probablyHaveReason` returning null is ignorance, not absence**: it's the
  default state of nearly every item, so reading it as "you haven't got this" would
  caption the whole app on nothing. Consequently the recipe ingredient row is silent by
  default — no standing "or margarine" — and you go and ask instead. **The one exception is
  a standing swap**, which the user ticked on this exact pair — see below.
- **The first read is a caption, never a category.** `classifyPlanned` sets
  `ClassifiedIngredient.reason` to `describeSubstitutesOnHand`'s "you have margarine" on a
  **`needToBuy`** row whose linked substitute `probablyHaveReason` answers for — and leaves
  the row exactly where it was. Moving it to `probablyHave` is the tempting version and the
  broken one: those rows arrive **pre-unticked** in both add-to-list sheets, so folding a
  substitute in is how you come home without butter because the app decided margarine
  counted. `reason` now has two producers, told apart by the row's own category; the wording
  lives in one helper because the shelf (#1567) and the recipe row (#1573) want the same
  sentence.
- **Authoring is the ask, not the field.** Links are hand-authored, and nobody
  hand-authors data for a caption they've never seen, so `SubstituteSheet` (opened from
  the field's "Add substitute") is the funnel and `GroceryItemSheet`'s field is where you
  *review* what you already answered. Deliberately **not** `RecipeIngredientSheet`, which
  owns `choiceGroup` — putting substitutes there is how the two merge into one confused
  control.
- **The expanded field is rows, not a `PillGroup`**, unlike Aisle/Stores/Pantry beside
  it. A pill can only express membership, and a substitute also carries a note and a
  direction — with pills you'd tap each lit one to find out whether it says anything at
  all. A grid was mocked alongside and dropped. The collapsed summary names up to two and
  then falls back to a count (`describeSubstitutes`), because `disclosureValue` renders
  `numberOfLines={1}` and a third name truncates mid-word at 390pt.
- **Scoping is the free-text `note`, not a per-recipe override.** Margarine for butter is
  fine in a pan and wrong in laminated pastry; an override rebuilds `choiceGroup` badly,
  and since nothing auto-applies a substitute, a wrong one is a caption you ignore rather
  than a purchase you regret.
- **One-to-many is permanently out.** "Buttermilk → milk + lemon juice" is two items both
  required, which is a recipe rather than a swap — stated in the sheet's own footer, since
  that's where someone wonders about it.
- **A link may carry a user-typed ratio** (`ItemSubLink.ratioFrom`/`ratioTo`, "1 clove" →
  "1/4 tsp") — a real amount conversion, not the built-in substitution table that stays
  banned. **Both null or both set**; one alone isn't a ratio, and a ratio-less link (the
  common case) shows no ratio anywhere rather than inventing a "1:1" stand-in.
  `itemSubs.substituteQuantity()` applies it — and it composes `recipeScale.scaleQuantity`
  as the arithmetic engine rather than reimplementing exact-rational math: a ratio is
  nothing but a scale factor (how many multiples of `ratioFrom` the line names), so handing
  that factor to `scaleQuantity(ratioTo, factor)` gets unit inflection and the container
  refusals for free. The one seam is `scaleQuantity`'s own factor-of-1 shortcut, which
  reports a no-op — right for its callers, wrong here, since a line naming exactly one
  `ratioFrom` is a real conversion (`ratioTo` verbatim), not "nothing to do"; `substituteQuantity`
  special-cases it. **Units must match through `unitKey`, or the line refuses untouched** —
  a ratio written per clove must not silently apply to a whole bulb, and that refusal is the
  one this feature would be untrustworthy without. **On `bothWays`, the reverse row's ratio
  is the forward one swapped**, not copied: the reverse row describes the *other* item's own
  unit on its own left, or a both-ways garlic↔garlic-powder link would claim a clove
  converts to a further clove.
- **A substitute-covered ingredient counts toward "what can I make", as its own clause,
  never folded into the direct-match number** (`recipeUtils.LikelyInPantryCount.viaSubstitute`,
  `PantryCoverage.viaSubstitute`, #1568). "6 likely in pantry · 1 with a substitute", never
  silently "7 likely in pantry" — the same discipline `describeShops` uses for a trailing
  clause it can't sum into the number in front of it, and what keeps a user-authored (hence
  real) link from reading like a guess anyway once it's inside a coverage number nobody can
  take apart. **`countLikelyInPantry` reuses `classifyPlanned`'s own `reason` field** (#1566)
  rather than re-deriving "is a linked substitute on hand" — a `needToBuy` row with a
  non-null `reason` already *is* that answer. `scoreRecipeAgainstCatalog`'s `coverage`
  fraction is untouched by any of this: a substitute link can only ever exist between two
  rows that are already catalog items (`linkItemSub` requires both), so an ingredient with
  no catalog row at all — the case `coverage`'s existence check is blind to — can never carry
  one either; there's nothing there to credit that isn't already counted. What a substitute
  *can* still fix is `avgRecency`: a catalog row that's stale or never bought contributes a
  neutral 0.5 wash on its own, and a linked substitute genuinely on hand lifts that (capped
  below a fresh direct purchase, so **the fully-stocked recipe still wins**) rather than
  leaving a coverable line reading as no better than an unstocked one.

## Standing swaps (`ItemSubLink.standing`) — "always use oat milk for milk"

Someone who never buys dairy milk wants every recipe calling for milk to read, and shop, as
oat milk, without editing twelve recipes. Structurally that is a substitute with auto-apply
on, so it is **one bit on the link and not its own system** — `src/utils/standingSwaps.ts` is
the resolution, `SubstituteSheet`'s "Always use this instead" is the write, and there is no
new table and no settings key.

It is the deliberate exception to the rule above — a substitute informs, it never buys — and
the exception is earned by the mandate: the user named both items and ticked "always", which
is a stronger statement than anything `probablyHaveReason` acts on. Four things keep it
narrow, and none is optional.

- **Read time, on the way out of `flattenRecipeIngredients`** — the same shape
  `ChoiceResolution` uses, and the reason the rule is resolved there rather than at each of
  the eight shopping reads: that gate is already the one they all go through. **Nothing
  persists a swapped name.** The recipe row is untouched, every authoring surface (the
  ingredient sheet, the reorder list, `shareText`) reads the recipe's own words because it
  never passes a swap map, and unticking the bit restores every recipe at once.
- **Recipe view *and* shopping read**, which is the useful answer and the loud one: a cook
  reading the dish needs to know which line they'll be cooking with, and the list has to say
  oat milk or the feature does nothing.
- **Always marked, never silently.** A swapped line renders the substitute's name with
  `describeStandingSwap`'s "instead of milk" directly under it, in the accent tint a scaled
  or converted quantity pill already takes — the `≈` convention, applied to a name instead of
  a number. A ratio'd swap tints the pill too, for the same reason.
- **The recipe stays findable by its own words.** `rankRecipes` passes no swaps (with
  `allOptions`, as it already did), so searching "milk" still finds the dish: a swap changes
  what you buy, not what the recipe says. `recipesUsingIngredient` is raw for the same
  reason.

Three rules the resolver enforces, all pinned by `standingSwaps.test.ts`:

- **One hop, never a chain.** Milk→oat and oat→soy are two rules, each applied to its own
  line; a milk line does not become soy. Chaining means the swap you get depends on a rule
  written about something else.
- **A pair marked standing both ways is dropped entirely.** `linkItemSub` clears the reverse
  bit (and any other standing rule on the same item — one item has one answer), so that state
  is only reachable through a restore; neither direction is a rule anyone meant.
- **A ratio that can't be applied refuses the whole swap.** `substituteQuantity` already
  refuses to convert "1 bulb" through a per-clove ratio; renaming the line anyway would leave
  "1 bulb garlic powder", which is worse than not swapping. The line stays exactly as written.
  A ratio-less link — the common case, and the dietary one — carries the quantity across
  verbatim, which is not an assumed 1:1 but the user having declined to qualify the amount.

- **The wrong-in-one-dish case is `RecipeIngredient.noSwap`, per line** ("this pastry needs
  real butter"). On the recipe, because it's a fact about the dish rather than about one
  cooking, and **deliberately not a `choiceGroup`**: there are no options to pick between, so
  filing it there would mean a group of one — the dead-end state `RecipeIngredientSheet`'s
  Alternatives field exists to make unreachable. Its control appears only when a standing rule
  actually reaches the line (or the line has already opted out), because a toggle explaining a
  rule you haven't written changes nothing.
- **The bit lives on the link; Settings reviews the set.** That's both halves of the question,
  not two homes: `StandingSwapsSheet` (Tasks & projects → Substitutes) is a read over the
  links, and its one write turns a rule off *without* forgetting the substitute. A rule that
  rewrites what lands in the trolley has to be answerable somewhere that isn't "open every
  grocery item and check".

## Deciding at the shelf — an ingredient choice that survives onto the list

"Which pepper" is a question you can only really answer in front of the peppers, and until
`ChoiceResolution.undecided` the add-to-list sheet made you answer it at the kitchen table. Both
halves of the mechanism already existed — a recipe's alternatives (`RecipeIngredient.choiceGroup`)
and the list's own either/or (`GroceryItem.choiceGroup`, resolved destructively by ticking one) —
so this is the wire between them, not a third system.

- **`undecided` names ingredient groups, never component ones.** An ingredient's options are rows,
  and `resolveChoice` can take the losers back off the list with one tick. A component's options are
  two dishes' worth of lines with nothing that could ever un-add the set you didn't cook, so
  `activeComponents` ignores the field and `RecipeToListSheet` only offers the chip on
  `kind === 'ingredient'` groups.
- **A group is keyed by `choiceGroupKey(recipeId, label)`**, because a week can hold two recipes
  that both call their group "Cheese" while posing entirely different questions. Labels alone would
  merge them.
- **The label is translated, not carried.** `addFromPlan` mints one opaque `generateId()` per key
  *per call* — the lifetime of one trolley. Storing "Chili:Pepper" on the rows would put a recipe's
  heading into a list that renders no headings (see `GroceryItem.choiceGroup`), and would silently
  merge two shops of the same recipe weeks apart.
- **A row wanted outright beats a row wanted as an option.** `classifyPlanned` takes the *first*
  non-null group across a merged row's contributors, so a line something else needs unconditionally
  can't arrive on the list as half a choice.
- **Nothing about it is written back to the recipe**, the same rule the existing picks follow: an
  ad-hoc shop isn't attached to a meal, so there's nothing for "I'll decide later" to be a fact
  about. It lives in sheet state and dies with the sheet.
