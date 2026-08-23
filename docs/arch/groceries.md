# The grocery list, the shops, and the kitchen

Everything about what lands in the trolley: how the list is filed, which one of
a thing you're after, which shop has what, what the app believes you already
have, and the five adjacent ideas (products, either/or, alternatives,
substitutes, standing swaps) that are easy to conflate. `docs/arch/recipes.md` is the other half; a change that touches
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

## Products (`ItemProduct`) — which bread, under Bread

A `GroceryItem` is the Platonic ideal: Bread is what recipes call for, what the pantry tracks,
what has one `nameKey`, one aisle, one purchase history, one expiry. An **`ItemProduct`** is one
box on the shelf under it: Arnold's whole wheat, Dave's Killer 21 grain, the store brand seeded
sourdough. `GroceryItem.preferredProductId` points at the one you want, or is null, which is the
common "any bread is bread" case.

This replaced a `brand`/`variant` pair of strings on the item, and the three things wrong with
that pair are the argument for the whole shape:

- **It could only hold the box you want right now.** Switching from Arnold's to Dave's overwrote
  it, so there was nowhere to record having tried the first one, and no object for a rating to
  hang on. That's what `ItemProduct.rating` needed to exist.
- **It never really paired the two words.** "Arnold's" and "wheat" named one box only because
  they happened to sit on the row at the same time. Nothing could be preferred, rated, or
  recorded at a store.
- **Its suggestion chips were catalog-wide.** They were drawn from every brand typed anywhere,
  which is how "Siggi's" came to be offered under a loaf of bread. Brands don't generalise across
  items; within one item they repeat constantly, because a maker you buy makes two or three of
  the thing. `ProductSheet`'s chips are scoped to the item's own products, and that scoping is
  the point rather than an optimisation.

- **Its own table, not a JSON column on the item.** The call turns on the same question every
  time: does anything outside the row hold this id? Here it does — `preferredProductId` and
  `ItemShopLink.productId` both point at a product. (`Recipe.ingredients` is a blob precisely
  because nothing outside that row holds an ingredient's id.) `grocery_item_products` is shaped
  like `grocery_item_shops` and `grocery_item_subs`, with the same hand-written cascades, since
  FKs are off.
- **`productKey` is unique per item, not per catalog.** Two items may both have a "store brand"
  product and those are two different boxes. It's `groceryNameKey` on each half, so an apostrophe
  becomes a space exactly as it does in an item's or a shop's key — "Arnold's" and "Arnolds" are
  two products, the same way "Trader Joe's" and "Trader Joes" are two shops. A product with
  neither half is the item itself, and `addProduct` refuses it.
- **A rating is three states, never a 1-to-5 scale.** The question at the shelf is "have I had
  this and hated it". Four stars versus three is not a distinction anyone reproduces a month
  later; "never again" is. Null — no opinion — is the overwhelmingly common state and is not
  "fine". Nothing infers one, in either direction: buying something is not liking it.
- **A rating sorts, it never filters.** An `avoid` product stays in the list. Remembering that
  you hated it is the whole point, and hiding it takes the memory away exactly when you're
  standing in front of the shelf about to buy it again.
- **Only the first product named becomes the preference.** A first box on an item with no opinion
  plainly is the answer to "which one?"; a second is a box you're recording. Promoting every new
  one would mean the list you build to compare products re-decides for you as you build it.
  `addByName`'s brand chip is the deliberate exception — typing a brand while adding to the list
  *is* a statement about what you're going shopping for.
- **`productStrict` is one flag, and the product picks the granularity.** A product carrying a
  brand and no variant ("any Arnold's") is the brand-level rule; one carrying both is the
  product-level rule its predecessor `brandStrict` couldn't express. Default false, and nothing
  infers it: a preference set as a note to self is not a filter over stores.
- **Per-store claims are keyed by product** (`ItemShopLink.unavailableProductIds`, a JSON map of
  product id → stamp). Its predecessor was a bare `brandUnavailableAt` date that said nothing
  about *which* brand it was about — so switching the item's brand left the claim standing, and
  the shelf caption went on reading "no Dave's Killer at Safeway" off a look you took for
  Arnold's. Keying it to the product fixes that with no rule that has to remember to clear
  anything: switch your preference and the old entry stops matching, switch back and it's intact.
  It also lets one store be missing two of an item's products at once, which a single stamp
  could not say. `ItemShopLink.productId` (what you last got here) is still an **observation** and
  must never filter anything, for exactly the reason its brand-string predecessor couldn't: a
  shelf holds several at once.
- **A merge folds products, it never drops them** (`mergeItems`). The loser's boxes are boxes of
  what is now one item, so they come across the way its purchase count and price run already do,
  deduped by `productKey` with the survivor's row kept and the loser's counters folded in. Its
  rating only fills a silence — two verdicts on one box is a disagreement nothing here can settle.
  Pointers at a deduped id (`ItemShopLink.productId`, the claims, a `PriceObservation`) are
  remapped rather than left to dangle: they would only *read* as absent, but a claim quietly
  ceasing to apply because of a rename is the staleness this whole model was built to avoid.
- **A purchase clears every claim about that store**, not just the one about the box that came
  home. Coming home with something refutes the whole shelf-shaped claim at once, and it's the one
  correction nobody should have to make by hand.

**A barcode names a box, and that is where a scan's memory lives** (`ItemProduct.gtin`). It is the
only globally unique identity in this file — `productKey` right beside it is unique *within* an
item, because two items may each have a "store brand" — so it gets its own partial UNIQUE index and
a release-then-claim write (`dbSetProductGtin`), since pointing a code at a second box has to take
it off the first.

- **It is not on `gtin_lookups`,** and that table's own doc comment is why: it is excluded from
  both sync and backup on the grounds that it records nothing about the user, so a pointer at one
  of their catalog rows kept there would not survive a restore and would never reach a second
  device. What a barcode *denotes* is shared and impersonal; which of your boxes it is, is yours.
- **A second, item-level link is written alongside it**, as a GTIN-keyed `StoreAlias` with a
  null `shopId` (`gtinAliasText`, prefixed so an all-digits receipt line can't key the same).
  The two are different facts and the item-level one is the durable half: it is what answers for
  a row with no box at all, which is the unfound-barcode case, and it is the code most worth
  remembering since nothing about it will ever improve on its own. `gtinItemFor` reads box first,
  alias second.
- **The link is what stops the box being re-derived, and that was a real bug.** `variantFor`
  subtracts the item's own name from the product name, so a row renamed away from the source's
  wording ("vegan sausage" for "Beyond Plant Based Sausages Cajun") leaves nothing to subtract and
  returns null — minting a brand-only second box beside the real one on every scan. Once a barcode
  names a box, `BarcodeScanSheet` uses that box rather than deriving one.
- **A merge folds it like a rating: the survivor's wins, the loser's fills a silence.** It is the
  one product field `dbSetItemProduct` doesn't carry, so `mergeItems` claims an adopted code
  explicitly — release-then-claim is what makes that safe while the loser's row is still waiting
  for the cascade.
- **Nothing infers one.** Like an alias, a link is only written from a scan session the user
  applied. That includes rows the session *mints*, which is the deliberate difference from the
  label alias beside it: a phrase alias on a minted row would map a name to itself and teach
  nothing, where a barcode link on one teaches everything.

**A product is not a substitute, and the line is: same box → product, different thing →
substitute.** A hamburger bun standing in for bread is a different thing you buy, with its own
aisle, its own pantry state and its own recipes calling for it, so it stays an `ItemSubLink`
between two items. Within an item you pick among products; across items you fall back to a
substitute. Recipes are untouched by any of this — `RecipeIngredient.nameKey` bridges to the
*item*, because a recipe calls for bread, not for Arnold's wheat.

**A price run is scoped to the product, and the stamp lives on the observation.** Each
`PriceObservation` carries the `productId` the row preferred when the trip was finished, and
`priceRunForProduct` filters the run at read time — so `typicalPriceFor` and `priceStandingFor`
answer "what does the one I buy cost" instead of "what does bread cost". Three rules hold it up:

- **A stamp, not a third price level.** The runs are already capped blobs on the rows that own
  them, so scoping is a filter rather than a `grocery_product_shops` table with its own cascade
  and its own write path in `dbFinishGroceryShopping`. Nothing outside an observation holds its
  identity, which is the same test that sent `ItemProduct` *to* a table.
- **Below `PRODUCT_RUN_MIN` (2) the whole run answers.** A run filtered to one observation is the
  single-price baseline this whole file exists to reject, wearing a median's clothes — and an
  install upgrading into this has no stamped observations at all, so a run that scoped itself to
  nothing would turn every existing baseline into silence overnight.
- **`lastPricedAmountFor` is deliberately not scoped.** It reads the stored scalar, which is also
  what `setItemPrice` writes when a price is corrected by hand without touching the run; deriving
  it from the filtered run would discard that correction. The *run* is what a product can scope;
  the *last number* is one fact about the row, and the one a user can point at a receipt for.

**The shelf offers the next box when yours isn't there.** A `withoutProduct` marker carries an
`alternativeProduct` — the best thing on record at this store, taken in `productsForItem` order.
Three exclusions: the preferred box (which the caption just refused), anything rated `avoid`, and
anything this store is *also* on record as lacking. **The `avoid` exclusion is the one place a
rating filters rather than sorts**, and the reason is that this is the app recommending rather
than listing: "try the one you told me you hated" is the app not having read its own record. The
caption trades the wanted product's name for the alternative (`Yours isn’t here · try Nancy’s
whole milk`) because the row is one line and naming both cuts off the half that says what to do —
the same trade the `unavailable` branch makes when a substitute joins it. It is deliberately not
that branch's "Not here": the store has the item, just not your box, and collapsing the two
claims would say a shop had nothing when it had the thing and not your version of it.

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
- **Manage stores in the setup sheet, browse them in the catalog.** The Stores tab of
  `GroceryAislesSheet` is add/rename/reorder/delete only; the "what does Costco carry" read is the
  filter chip row in `GroceryCatalogSheet`, because that's the catalog browser and it's open exactly
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
- **Three terminators, and they're in three different places for a reason.** The banner's Stop
  button and `clearList` end it in the store; finishing ends it in `GroceryScreen.handleFinished`
  rather than inside `finishShopping`, because that early-returns on an empty trolley and finishing
  a shop you bought nothing at still ends the trip. Expiry is handled twice — `initialize` repairs
  at read time (not written back, like the aisle order), and `checkTripExpiry` on screen focus
  clears the fields so an expiry that happened while the app was open becomes *visible* rather than
  merely true; a memo whose inputs haven't changed won't re-render itself away.
- **Silence is the default and it's load-bearing** (`tripMarkerFor`). Only three things can be
  said, and each is backed by something the user recorded: `unavailable` ("Not at Safeway", their
  own negative claim), `only` ("Only at Costco", every store on record is one other — a hand
  assertion counts), `usually` ("Usually Trader Joe's", observed purchases). A row this store has
  any link for says nothing, and **so does a row nothing is known about** — the app not having
  watched you buy tahini anywhere is ignorance, not evidence. Marking those would caption most of
  the list on anyone's first trip, which is how the feature would come to read as noise. Same
  discipline as `shoppingTrip.ts`.
- **The banner is a sibling of the list, not its `ListHeaderComponent`.** A mode indicator that
  scrolls away is one you can't find to turn off, and it's the answer to "why does this row say
  that" at the moment you're looking at the row. The two never render together: the card is for
  deciding where to go, the banner says you've gone. `StartTripPrompt` is the list's header while
  it is only an invitation, and is mounted up beside the banner instead once it carries a Finish
  button — the end of a shop is not something to scroll back to the top for either.
- **The banner is where a trip ends, and Finish outranks Stop on it.** It used to spend its only
  button — accent-filled, the one the eye goes to — on Clear, while finishing was reachable only
  from `bag-check-outline`, fifth in a row of header icons. That ranked the escape hatch above the
  action every trip actually ends in. Finish is the filled button now, full width under the store
  name and sized for a walking thumb; Stop (the old Clear, renamed because "clear" beside "finish"
  reads as *clear the list*, which is a different and real action) is the quiet pill beside it. The
  Finish button appears with the first ticked row and not before — an empty cart has nothing to
  finish, and Stop is the honest way out of one.
- **The header icon is gone, and a cart with no trip behind it is finished from `StartTripPrompt`.**
  The badged `bag-check-outline` was the sixth icon in the Groceries header and the only way to
  finish a shop nobody had started a trip for. A small target behind a non-obvious glyph is the
  wrong home for the action every shop ends in, so the card above the list carries it instead: the
  banner during a trip, `StartTripPrompt` outside one, both drawing the same filled
  `Finish · N in cart` on the same first-ticked-row rule. **This still infers nothing** — a tick is
  not a trip, no store is assumed, and no row gets marked up; the card only stops pretending the
  cart is empty, and keeps offering "Start shopping" above the Finish button for anyone who does
  want the store known. With no suggestable stores on file it is the Finish button alone, which is
  the case that stops the card being gated on having stores at all.
- **`StartTripPrompt` never names a store, and its tap always opens the sheet.** It used to read
  "Start shopping at Safeway" and start that trip in one tap whenever exactly one store was on
  file. On a card sitting there before anything has been said, that sentence reads as the app
  asserting where you are rather than offering somewhere to go, and it is the wrong store the
  moment a household has a second one. Naming a store is a claim, so it waits for the sheet, where
  one is preselected (best coverage, else wherever the last trip ended), named, and changeable
  before Start. Same rule as the row captions above: the card says only what it knows. It costs
  the one-store household a tap, which is the trade.
- **The three kitchen screens without a finish sheet route to the one that has it.** Recipes, Meal
  plan and Pantry pass `resetToGroceries(true)`, which lands on Groceries with a stamped
  `openFinish` param the screen turns into an open sheet — the same handoff `resetToMealPlan`'s
  `focusDay` uses, and the same one `dundundun://groceries?finish=1` goes through.
- **The Live Activity can finish a trip too, and it's a `Link` rather than an intent.** A Live
  Activity button's AppIntent runs in the background only and can't bring the app forward (see
  `TimerLiveActivity.swift`'s own note), which is why the trip activity had no button at all until
  now: finishing is a question — which leftovers didn't the store have, what did each thing cost —
  and can only be answered inside the app. The deep link *is* that question asked from the Lock
  Screen. It carries no count, because the attributes are fixed when the trip starts and nothing
  is ever pushed an update; `GroceryScreen` decides on arrival whether there's anything to finish,
  and lands on the list without a sheet when there isn't.
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

**`KitchenScreen` is a read plus one write, not a second model.** It renders that inventory, the
fridge first and then the pantry cut into aisles. That's the distinction the aggregate view turns
on: nobody should have to check items in and out, but a set the app has already derived per-item
is worth being able to look at, and until this there was no way to answer "do I have flour" short
of opening items one at a time. Don't grow quantities, per-row expiry editing or a check-in
gesture onto it — that's the inventory again.

- **It's the fourth screen in the Groceries/Recipes/Meal plan hub, not a sheet popped over
  Groceries.** It used to be — reached by stamping a param on a `navigate('Groceries', ...)` call
  that `GroceryScreen` watched for — which meant it never got the hub row's active/selected state,
  and every call site that wanted to open it (a use-up task's link, Today's own kitchen context
  row) had to carry a copy of the sheet rather than just navigating. It's a real `Tab.Screen` now
  (`AppNavigator`'s `KITCHEN_SCREENS`), so `resetToKitchen` (`navigationRef.ts`) and Today's kitchen
  row both do what `resetToMealPlan`/the meal row already did: navigate there, with a
  `focusKitchenEntry`/`focusStamp` pair (`MealPlanScreen`'s `focusDay`/`focusStamp` shape) when a
  link names one row.
- **Displayed as "Pantry", not "Kitchen"** — the pill's label, the screen's own header title, and
  every string a user actually reads (`describeKitchen`'s "N things in the pantry", the empty
  state, the Settings copy about what turning "Show what needs using up" on does). The route name,
  this screen's own filename, and every symbol in `kitchenInventory.ts` still say `Kitchen`/
  `kitchen*`, the same split `TaskGroup` keeps under the user-facing "Stack": the internal name
  predates the label and still describes what the model actually merges (pantry *and* fridge —
  see above), where "Pantry" alone is a deliberately imperfect fit for a container of leftover
  chili. Don't chase the two into agreement; the display string is what changes when this gets
  renamed again.

- **A catalog row carries the ✕; a container doesn't.** "Out of it" is one bit and the ✕ writes
  exactly it (`markOutOfMany`). Closing a container out is a two-way question ("Eaten" / "Thrown
  out"), and guessing "eaten" would write a fridge-history row the user never chose — so its row
  opens `LeftoverSheet`, which asks properly.
- **`LeftoversCard` still renders the fridge alone.** Its rows drag onto a night of the week, and
  a bag of spinach is not a dinner. What it shares with the kitchen is the ladder, not the list.

- **The one write is `addToPantry`**, off the field at the top, and it writes the same assertion
  the item sheet's "Got it" pill writes (`defaultOnHandUntil`) on the same catalog row. It exists
  because that correction was *unreachable* for anything with no row yet — an item sheet opens
  from the list or from the catalog, so "I have flour" was unsayable until flour had been bought
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
- **`GroceryItemSheet` and `LeftoverSheet` render as plain sibling `Modal`s under the screen**,
  the same way `GroceryScreen` renders its own item sheet — there's no outer `Modal` to nest inside
  of any more now that the kitchen is a screen rather than a sheet, so the nesting `KitchenSheet`
  needed (and `GroceryCatalogSheet` still needs, being itself a `Modal`) doesn't apply here. Correcting a
  row still drops you back into the list you were reading, because the screen underneath was never
  unmounted to begin with.

### The freezer — a paused clock, not a place field

`GroceryItem.frozenAt` and `Leftover.frozenAt` are one ISO instant each, and the whole rule
they drive is `freshness.liveUseBy`: **a frozen thing's use-by day is suspended, never cleared.**

The gap was bug-shaped. `finishShopping` stamps `expiresAt` from the shelf-life lexicon on every
row it buys, and that lexicon is at its shortest exactly where a freezer is most used (chicken 2
days, ground beef 2, salmon 2). Buy a month of meat, freeze it, and the app spawned a fistful of
"Use up" tasks due Monday about food under an inch of ice, which `groceryShelfLife.ts` already
names as the failure that gets a feature turned off. The only escape was `useUpTask: false`, which
is permanent for the item, so silencing this month's frozen chicken silenced next month's fresh
chicken too.

- **One bit that changes behavior, not a location taxonomy.** A fridge/freezer/cupboard picker
  would be data entry that changes nothing for two of its three values, which is the maintained
  inventory this file rules out three times over. Only the freezer earns a field, because only the
  freezer stops a clock.
- **Suspended, not cleared, because the interesting event is the thaw.** `expiresAt` and
  `keepUntil` sit untouched behind a live `frozenAt` and every countdown reads through
  `liveUseBy` (bound per side as `groceryShelfLife.liveExpiresAt` and `leftovers.liveKeepUntil`).
  Clearing on the way in would leave nothing to restart from; stamping a new day at freeze time
  would assert a thaw date the user hasn't picked, and food sits in a freezer for a month or a
  year.
- **The thaw restarts the clock rather than resuming it.** A grocery item re-stamps `expiresAt`
  through `expiresAtForPurchase` — the same shelf life a purchase gets — so thawed chicken keeps
  two days from today. A container gets back *the whole window it was given*, and its `storedAt`
  moves to now (leaving it would have a portion frozen in July read as "40 days in the fridge" the
  moment it thaws). Not the days that were left: freezing arrests the spoiling the window is
  about, so restarting whole is both truer and the safer way to be wrong.
- **Both halves or neither.** A bag of spinach and a container of chilli going in the freezer are
  one fact to the cook, the same argument #1670 made for merging the freshness ladder. The rule
  therefore lives in `freshness.ts` beside that ladder, and `needsAttention` is the single choke
  point on the fridge side — `attentionLeftovers`, `leftoverTasks.wantsUseUpTask`, `describeFridge`
  and the hub pill all ask through it, so a frozen container goes quiet everywhere at once.
- **`freshnessOf` still answers for a frozen container; `liveFreshnessOf` is what a row's colour
  uses.** A history row wants to know what state it was in, and making every colour lookup
  null-check is how one ends up not doing it. But a *live* row tinted from a suspended date is the
  false alarm the feature exists to stop, so the fridge card and the meal-plan picker read the
  nullable one and fall back to `textTertiary`.
- **A live date is a precondition of a use-up task, not a `qualifies` argument.**
  `wantsGeneratedTask` lets an explicit `true` outrank the qualifier, which is right for a
  preference ("I do want reminding about this one") and wrong for this: no countdown means there
  is nothing to want reminding about, and `useUpTaskFields` dates its task off `expiresAt!`. So
  `wantsUseUpTask` returns false before consulting the tri-state, and the store's own duplicate
  date guard is gone — one owner. The opt-in isn't lost, just deferred until the thaw.
- **`FREEZER_SECTION` is the feature's visible surface**, leading the aisles right after the
  fridge and holding both kinds. It could have been a flag that quietly stopped a task, but what
  actually gets lost is the food, not the notification — a section is how you find the chicken you
  froze in July. It's also why a frozen grocery row leaves its aisle: nothing in a freezer is
  filed by the aisle it came from, so `buildKitchenSections` now routes on `section` rather than
  on `kind`.
- **And it's a drop target, which is how the bit gets set now.** Long-pressing a Pantry row drags
  it under another heading, and `utils/kitchenReorder.ts` reads the heading it landed under back
  into a write: the freezer for either kind, the fridge for a container, an aisle for a catalog
  row (which is a thaw and a refiling at once). The section was already how you *find* frozen
  food; dragging is how you say it, without the trip into the item sheet a one-bit correction
  didn't earn. Two moves the stream can describe are refused rather than guessed at — a container
  has no aisle, and a catalog row has no place in the fridge, which is the location taxonomy this
  section rules out above.
  - **An empty place still gets a heading while there's something to put in it.** The freezer is
    unreachable by drag until something is already frozen otherwise, and the list can't grow the
    heading once the drag starts: `ReorderableList` cancels an in-flight drag the moment its row
    keys change. So `buildKitchenRows` emits a dashed target under the heading instead, and the
    same for the fridge when every container in it is frozen.
  - **A drop is a filing and never an order.** The kitchen's rows rank by what's about to be
    wasted (`compareKitchenEntries`), so a drag that lands in the section it came from writes
    nothing at all — the one place this differs from the shopping list, where a drop always
    writes a rank as well as an aisle.
- **A frozen container is still live.** `finishedAt` remains the only thing that ends a leftover,
  and a frozen portion stays plannable onto a night of the week — which is most of what anyone
  freezes one for. `isPlannedPastKeepUntil` is false while frozen, closing the hand-wave in its
  own note ("it may be going in the freezer") now that the app can actually be told.
- **`liveExpiresAt` lives in `groceryShelfLife.ts`, not `groceryExpiry.ts`** where it reads like it
  belongs: that file imports `kitchenInventory` for the link helpers, and `kitchenInventory` is one
  of the callers, so the natural home is a cycle. For the same class of reason `FROZEN_REASON` is a
  constant in `types` rather than beside `describeFrozenSince` in `freshness.ts` —
  `grocerySuggest` produces it and is deliberately free of `dateUtils`, which reaches the settings
  store and so `expo-sqlite`.
- **`probablyHaveReason` reads a live `frozenAt` as on hand.** It has to: the purchase window is
  two weeks and a freezer is measured in months, so without it a bag of chicken frozen in July
  would drop out of the pantry in August while sitting in the freezer, and the app would offer to
  add it to the list. The precedence is exact and each step earns its place — an explicit **"Out of
  it" outranks the freezer** (that bit is what the Pantry row's ✕ writes, so the button would read
  as dead on a frozen row otherwise, and "I'm out of it" is the later statement anyway), the
  freezer outranks the purchase reading, and a live "Got it" is read last.
- **A purchase clears `frozenAt`**, alongside the `onHandUntil` it already cleared, in
  `finishShopping` and its `dbFinishGroceryShopping` mirror. The claim was about the bag you had,
  and the same statement stamps a fresh `expiresAt` — leaving it would suspend that new day the
  instant it landed, so the new bag would read as frozen and never count down.

### Opened, and running low — the other two things a pantry row can say

The freezer above is one of three states added together, and the three are deliberately different
shapes. The freezer *stops* the clock; opening *re-anchors* it; running low doesn't touch the clock
at all and instead reaches into the shopping list. Only the first needed a rule in `freshness.ts`.

**`openedAt` is the third event that re-dates a use-by day**, alongside a purchase and a thaw. For a
sealed thing the purchase is simply the wrong anchor: a jar of salsa bought five weeks ago and
opened on Tuesday keeps a week from Tuesday.

- **It needed a second lexicon, not a second column.** `OPEN_SHELF_LIFE_LEXICON` is a much shorter
  table than `SHELF_LIFE_LEXICON` and holds only jars, tubs, cartons and vacuum packs, because
  opening a bag of spinach restarts nothing — it was already exposed to the same air the fridge is
  full of. Produce, meat and bakery are absent on purpose, and `setOpened` leaves their day alone.
  Same whitelist restraint the first table runs on.
- **It takes the earlier of the two days — unless the old one has already passed, in which case it
  replaces it.** "Only ever bring a deadline forward" is the safer-sounding rule, and it's *nearly*
  right: milk with one day left on its sealed clock doesn't earn a fresh week just because it got
  opened today, so the sealed day wins while it's still ahead of the open lexicon's count. But a
  jar bought five weeks ago carries a day that has long since passed, and the `min` of that and
  "today plus 7" is still the passed day — opening would be inert in exactly the case the feature
  exists for. Past that point it's stale information rather than a real deadline, so opening is
  free to replace it: *new information* about a jar the old guess had written off.
- **The opening is recorded even when it changes nothing**, and the row says "opened 12 Aug" either
  way. Only the date is conditional on the lexicon knowing the name.
- **`shelfLifeDays` is not consulted.** That field means "this one keeps N days once bought", which
  is a claim about the shelf rather than about the open jar.
- It joins the caption's **reason** half rather than the tinted clock half, because opening is
  evidence about the jar and not a state of the countdown. A frozen row drops the clause: naming
  two places for one jar reads as a contradiction.

**`runningLowAt` is the state the "Got it" / "Out of it" pair was missing** — the interesting point
on that scale is in the middle, and it's the one the app had no way to hear about.

- **It couldn't live on `onHandUntil`.** That column is a timestamp with two sentinel readings
  already, and a third would be a third thing for `onHandAssertion` to get wrong.
- **Running low still means you have it**, so `probablyHaveReason` answers for it and a week plan
  still counts it. Some left is exactly what distinguishes it from "Out of it", which still
  outranks it.
- **It never self-expires**, unlike `onHandUntil`. A "Got it" is a guess with a shelf life, so it
  lapses into silence; being nearly out is a fact that stays true until a purchase refutes it.
- **It is the one pantry assertion that touches `onList`**, and the exception that proves
  `addToPantry`'s rule: saying you *have* something is not a plan to buy it, and saying you're
  nearly out is nothing but one. **In one direction only** — marking adds, clearing leaves the list
  alone. `onList` has several owners and nothing on the row records which of them put it there, so
  a clear that removed it would be guessing with someone else's data. The add is undoable the
  moment it happens, which is the honest answer for a mis-tap.

All three are cleared by a purchase, alongside the `onHandUntil` that already was: the bag you
froze, the jar you opened and the tub you were nearly out of are all the old one.

### Nothing leaves the pantry, so the one exit worth noticing is offered as a task

Because membership is `probablyHaveReason` recomputed on every read, nothing is ever *removed* from
the pantry — an item leaves by that function starting to return null. Four things cause that and
three of them are the user speaking: "Out of it", a thaw emptying the freezer, a lapsed "Got it".
The fourth is the purchase reading's own window running out, which writes nothing, changes no row,
and is the one state change in the whole kitchen a person cannot see happen.

`src/utils/pantryCheckTasks.ts` offers to ask about exactly that, as the sixth generated task
("Check if you still have X" — see `docs/arch/generated-tasks.md` for the mechanism and the rules).
Three things about it belong here rather than there:

- **`pantryGuessLapsedDays` lives in `grocerySuggest.ts`, beside the reading it shadows.** The
  window arithmetic has one owner; a second copy in the generator would be free to disagree with
  the very function it is meant to be watching, which is the bug `onHandWindowDays` was written to
  end.
- **It is gated harder than the reading is.** `probablyHaveReason` is happy to guess from a flat
  fortnight below `MIN_PURCHASES_FOR_CADENCE`; asking the user about a guess is a different bar, so
  the check refuses anything with fewer than three purchases behind it.
- **Answering it is the existing pair of pills, not the task.** The row links to
  `GroceryItemSheet` opened on the Pantry field (`kitchenLinkUrl`, which `KitchenScreen` resolves to
  the sheet by id when the item isn't in the list — and a checked item never is, by definition).
  "Got it" or "Out of it" makes the item stop wanting a check, so the task clears itself on the next
  sweep. Ticking it off means "I've dealt with this" and writes nothing to the row — inferring "yes
  I still have it" from a tick is the guess a container's ✕ already refuses to make.

### How a thing left the pantry (`itemDisposal.ts`)

The fridge has recorded this since leftovers shipped: closing a container out is "Finished it" /
"Threw it out" (`LeftoverOutcome`), read back by `describeFridgeHistory`. Marking a catalog row
out of it was one bit, so the same fact about a bag of spinach was thrown away. The asymmetry was
at its most visible in `UseUpResolveSheet`, where completing "Use up spinach" and completing "Use
up leftover chili" open two sheets through one mechanism and only one of them asked what happened.
`GroceryItem.usedUpCount` / `spoiledCount` / `lastSpoiledAt` close it.

- **It is deliberately not a shelf-life estimator, and that's the first thing to not re-open.** The
  obvious reason to want this is to learn how long things really keep, and it's the one thing these
  answers can't support. Both are given when the user *notices* rather than when the food turned:
  the bag found in the drawer on Sunday is recorded at twelve days when it went at five, and a
  "used it up" carries a consumption rate rather than a shelf life. The lag is routinely larger
  than the numbers being estimated (`SHELF_LIFE_LEXICON` runs 2 to 7 days for everything that
  matters), and it biases both readings *later* — which is the direction that gets a use-up task
  arriving after the food is already slime. `groceryShelfLife.ts` keeps its numbers at the cautious
  end on purpose, and a learner fed only late observations would walk them the other way. There is
  also nothing to fit against: the catalog keeps `purchaseCount` and `lastPurchasedAt`, not a
  per-purchase log (see `estimatedPurchaseCadenceDays`, which makes the same admission).
- **So the payoff is a hand-off, not an adjustment.** `shelfLifeDays` stays the correction, made by
  a person holding the thing; the counts say when it's worth making one. Twice
  (`REPEAT_WASTE_THRESHOLD`) turns the offer into "change how long the app thinks it keeps", which
  opens the sheet on the Use by field. One waste is an accident the app has nothing to add to.
- **The ✕ still writes one bit and the question comes after it.** `markOutOfMany` marks the row out
  on the tap, so the pantry is already correct and the answer is pure extra — which is what lets
  the cheapest correction in the app stay one tap, the trade this doc makes above when it gives a
  catalog row a ✕ and a container a sheet. An ignored question leaves nothing wrong.
- **A caller that already knows passes the outcome and nothing is asked.** `CookedUseUpSheet`
  passes `'usedUp'`, because the cooking *is* the answer. It's also the one caller reporting
  several rows at once, and a per-row question about a batch is the "recall five kitchens" the cook
  offer already declines for `bulkSetCooked` — so the offer is raised only when exactly one row
  actually changed.
- **The offer is session-only, like `cookedOffer`.** It's about a tap just made, so there's nothing
  for it to mean on the next launch and nothing to persist a dismissal for. A question about a bag
  of spinach thrown out last Tuesday is not one anybody can answer.
- **Only the spoiled side is ever named, and it's always dated.** "Used it up 5 of 5 times" is not
  evidence about anything, and a line congratulating the user on eating their food is the
  editorialising `describeOutcome` refuses when it picks "Thrown out" over "Wasted". Nothing decays
  the counts, so `describeDisposalHistory` renders the age alongside them for `lastPricedAt`'s
  reason: a bare "went bad 3 times" about a habit fixed a year ago is the UI lying.

### Cooking what's about to go off (`useUpRecipes.ts`)

The kitchen knows what's dying and a recipe knows what it's made of, and nothing joined the two. A
"Use up spinach" task tells you the spinach is going, which you can see, and stops exactly where the
useful part starts.

- **The join is `nameKey` and nothing else.** `RecipeIngredient.nameKey` is already "THE bridge to
  the catalog" and `KitchenEntry.matchKey` is a catalog row's own key, so the match is exact. No
  fuzzy matching: a wrong suggestion costs more than a missing one, and the app already refuses
  this class of guess for a shelf life (`shelfLifeDaysFor`) for the same reason.
- **Groceries only.** A leftover's `matchKey` comes from its own free-typed title rather than from
  the catalog, so it would match only by accident — and you reheat last night's chilli, you don't
  cook with it. Planning a container onto a night is `LeftoversCard`'s job.
- **Ranked by how much dying food a recipe clears**, then by how urgent the worst of it is, then by
  name. One dinner that saves the spinach *and* the mushrooms beats two that save one each, which
  is the whole reason to rank rather than list.
- **Deliberately not ranked by how much of the recipe you already have.** That reads as the better
  question and can't be answered honestly: `probablyHaveReason` returning null is ignorance rather
  than absence, so "you have 6 of 8 ingredients" would be a confident number built on a set that
  was never meant to carry one.
- **It reads; it writes nothing.** No task spawned, no meal planned. The two generators that write
  unattended each had to earn it with a setting and a per-row opt-out, and a suggestion the user
  taps is not in that category.
- On `KitchenScreen` it's the list's `ListHeaderComponent` rather than fixed above it, so it scrolls
  away with the content it's about, and it's hidden while the find-or-add field has text — that
  field filters the list, and a block ignoring the query would be the one part of the screen not
  answering it. Capped at two.

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

**The vocabulary rule, so it can't drift: products *of* an item, either/or on the list,
alternatives on the recipe, substitutes on the item — and a substitute marked "always use this
instead" is a standing swap.** Five adjacent terms for five genuinely different things; settled
here rather than left to be re-argued per PR.

First, is it even the same thing you're buying? A different box of it is a **product** (above) —
Arnold's white instead of Arnold's wheat is not a substitution, it's the other one under the same
item. Everything below is about reaching for a *different item*.

The one-line test for which of those you're looking at: **does the answer depend on the dish?**
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
  hand-authors data for a caption they've never seen, so `SubstituteSheet` is the funnel
  and `GroceryItemSheet`'s field is where you *review* what you already answered.
  Deliberately **not** `RecipeIngredientSheet`, which owns `choiceGroup` — putting
  substitutes there is how the two merge into one confused control.
- **Suggestions are asked for, never fetched on open.** They were, on the
  grounds that opening the sheet was itself the ask — true while the only door
  was the field's "Add substitute". The swap glyph landing here ended it: half
  the opens are now someone reaching for an answer they recorded months ago, and
  each was spending a request on a proposal nobody asked for. "Suggest
  alternatives" is the ask now, in both doors. The key and the feature switch
  still gate the button's existence, so "no key, no traffic" reads the same.
- **The grocery row's swap glyph opens that sheet directly**, and its "already recorded"
  section is why. It used to open `GroceryItemSheet` with `initialField: 'substitutes'` —
  a ~900-line editor scrolled to one collapsed field, in answer to a one-line question
  asked from a list you're standing in a shop holding. The sheet already knew the item's
  existing links (it filters them out of the picker), so showing them is the whole
  difference between the funnel and an answer.
- **"Use instead" is the one action on those rows, and it's opt-in per host.** It applies
  `swapForSubstitute` to the list row — which until then was reachable only by tapping the
  "Not at Safeway · or margarine" caption, so it needed an active trip at a shop marked as
  not stocking the item, and was simply unavailable to someone who just found the shelf
  empty. It renders only where the host passed `onSwap` (`GroceryScreen`), because the
  same sheet opens from the item sheet and both recipe sheets over items that aren't on a
  list at all. Tapping the row *body* reviews the link instead: two readings of "tap a
  substitute", so two targets, and the item sheet's field — where only one reading is
  possible — keeps its whole-row tap.
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
  special-cases it. **The line's unit must be the ratio's unit, or the line refuses untouched** —
  a ratio written per clove must not silently apply to a whole bulb, and that refusal is the
  one this feature would be untrustworthy without. **Being the same unit is not the same test as
  being the same word**, though, which is what it originally checked (`unitKey` on the whole tail,
  so only an inflection collapsed): a ratio written per tsp sat out every line a recipe wrote in
  tbsp, and the hint saying so read as "these units aren't comparable" when the truth was "you
  didn't type the same word". A tablespoon *is* three teaspoons, so `unitFactor` (`unitConvert.ts`)
  now converts a line written in a sibling unit into the ratio's own before the multiply.
  **Same dimension and same system only**, which is the whole of the argument: those are the pairs
  whose true ratio is a whole number, so nothing is rounded and the result stays safe to write back
  (`swapForSubstitute` saves it onto the grocery row). Crossing to metric is the case that must
  round — 1 tsp is 4.929 ml — and a rounded amount is display-only and marked `≈` everywhere else
  in this app, with nowhere to put an `≈` on a saved number, so it still refuses. The clove/bulb
  refusal is untouched by any of this for free: a count word is on nobody's conversion table.
  The second chance is gated on both sides being a bare `amount unit`, which is what carries the
  whole-tail rule through it: "3 cloves, minced" and "14 oz can" both trail prose, so a tin's size
  is never read as a weight to convert. **On `bothWays`, the reverse row's ratio
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
