# Recipes: composition, sections, quantities, scaling, cooking

How a recipe is built out of other recipes, how its ingredient lines are read
and transformed, and how it is cooked. `docs/arch/groceries.md` owns the
catalog these lines resolve against.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## Shared-in pages (`sharedRecipeLinks.ts`) — the iOS share sheet

"dundundun" in another app's share sheet (NYT Cooking, Safari, a food blog) is an iOS **share
extension**, `targets/todo-share/`, built as a second native target — read
`docs/native-targets.md` before touching it or its config plugin.

The round trip is: the extension captures a web address and appends it to a JSON array in the
App Group container, the app drains that on launch and on foreground
(`useSharedRecipeLinks` → `drainSharedLinks` on the widget bridge), and the queue lands in
`useSharedLinkStore`, which puts a `SharedLinkBanner` at the top of Recipes. Tapping Import
opens the ordinary `RecipeCreateSheet` on its link tab with the address already in the field.

- **The extension captures the address and nothing else.** It's a separate process with a hard
  memory cap, no access to the app's SQLite file and no way to reach the API key in the app's
  keychain, so fetching, extracting and writing a recipe row are all things only the app can
  do. It also can't open the app: `NSExtensionContext.open(_:)` isn't available to this
  extension point, which is why the hand-off is a queue rather than a launch.
- **A shared page waits for a tap; it does not import itself.** The import is a page fetch plus
  an Anthropic call billed to the user's own key, and spending that unasked — for something
  shared in a supermarket aisle three days ago, possibly several at once — is a decision nobody
  made. It also means a failure is reported in the sheet that caused it rather than after the
  fact.
- **The queue is persisted to the `settings` table the moment it's drained.** `drainSharedLinks`
  *deletes* the file it reads, which is the only way a page shared once doesn't queue again on
  every launch — so the store is the sole remaining copy from that instant, and a force-quit
  before the user gets round to the banner would otherwise lose a recipe they explicitly saved.
  That also makes it the one store holding state in memory *and* writing through to `settings`,
  so `useDemoStore` has to `reload()` it on the way in and out; every other store gets that from
  its own `initialize()`.
- **What gets dismissed is the source the recipe ended up with**, not the link the sheet opened
  with (`onCreated(recipeId, sourceUrl)`). The tabs stay live, so someone who opened the banner
  and then pasted a different recipe hasn't dealt with the shared page, and it stays queued.
- **One banner at a time, oldest first.** Addresses are canonicalised through
  `normalizeRecipeUrl` on the way in, so the queue holds exactly what the import would accept
  and a re-share collapses onto the entry already there rather than jumping the line.
- **The banner is gated on `anthropicApiKey`, the same as the add button's import menu.**
  Without a key there is no import to offer, and this would otherwise be the one route into a
  sheet that can only end at "No API key". The extension keeps queueing either way — it's a
  separate process and knows nothing about the keychain — and the queue persists, so a page
  shared before a key is added turns up once there's something to import it with rather than
  being dropped. The key lives in the keychain rather than the `settings` table, so this reads
  the same inside demo mode as outside it.

---

## Composed recipes (`Recipe.components`) — one recipe used inside another

"Steak with mashed potatoes" and "Salmon with mashed potatoes" are two recipes and one shared
mash. A component is a **reference** (`RecipeComponent` = link id + `recipeId` + a captured name),
held in a JSON column like `ingredients`; nothing is copied, so editing the mash reaches every
meal that uses it. The graph walk — flatten, cycle check, reverse lookup — lives in
`src/utils/recipeComponents.ts`, deliberately shaped like the nested-template helpers in
`templateUtils.ts`, since it's the same problem and the app shouldn't grow two answers to it.

- **It's its own list, not a `RecipeIngredient` with a `refRecipeId`.** `TemplateItem` does it the
  other way round, and that works there because a template's items are already a pile of drafts.
  An ingredient isn't: `nameKey` is the bridge to the grocery catalog, and every reader
  (`mergeIngredients`' dedupe, `remapIngredientKeyIn`, `classifyPlanned`, the aisle lexicon) is
  written assuming a line names something you can put in a trolley. A component names a dish.
- **A recipe contributes its lines at most once per flatten** — the one deliberate divergence from
  `expandTemplateItems`, whose visited set is per-branch. Two tasks are two things to do; two
  copies of "1 lb potatoes" are not two purchases, and `mergeQuantities` would silently make it
  "2 lb". A component graph is a set of parts, not a bill of materials with multiplicities.
- **Every shopping read goes through `flattenRecipeIngredients`**, never `recipe.ingredients`:
  `plannedIngredientsForRecipe`, `collectPlannedIngredients`, `countLikelyInPantry`,
  `scoreRecipeAgainstCatalog`, `rankRecipes`' ingredient match, and both "is there anything to
  shop for" gates. Read raw and a dish that's mostly its parts reads as having nothing to buy.
  Prep steps flatten the same way (`flattenRecipePrepTasks`) — offsets are already relative to
  the meal, so a component's step needs no re-anchoring.
- **Each flattened line is attributed to the recipe it's written on**, not to the one the user
  tapped: that's where they'd go to change it, and it's what makes a row wanted by two parts say
  so in `ClassifiedIngredient.sources`. `RecipeToListSheet` falls back to the tapped recipe for a
  row `classifyPlanned` merged across several.
- **`describeRecipe` counts the recipe's own ingredients, plus a "· 1 component" clause.** The
  count has to agree with the list rendered directly beneath it on the detail screen; the clause
  is what stops "3 ingredients" reading as the whole shop.
- **Deleting a component recipe leaves the links dangling**, resolve-or-shrug like every other
  cross-row pointer here (`MealPlanEntry.recipeId`, `TemplateItem.refTemplateId`). Unfiling them
  would edit recipes the user didn't ask to touch, and a restored backup couldn't put them back.
  The delete confirm names the parents first, same as `TemplateEditor`'s does.
- **Scaling is not part of the component graph** — it rides on top of it. A factor applies to every
  flattened line at once, components included (see Scaling below), so a component still contributes
  the quantities it's written with and the parent's factor multiplies them on the way out. Nothing
  about `servings` is consulted, and nothing is written back onto the recipe.

**Alternatives are a label on a flat list**, not a fourth entity — and they exist at *both* levels:
components sharing a `choiceGroup` ("mash *or* roast potatoes", #1252) and ingredients sharing one
("serrano *or* jalapeño", #1117). Exactly one option of a group is cooked and bought. A `Meal`
container above recipes was rejected: a composed recipe already *is* one, and `MealPlanEntry`
already allows two things on one dinner, so ad-hoc pairing needs nothing.

- **The two stay two lists sharing one convention**, never one list. An ingredient names something
  you can put in a trolley (`nameKey` is the catalog bridge); a component names a dish. They share
  `activeIn()` — one generic resolver over anything with an id and a `choiceGroup` — because the
  *rule* is genuinely the same and writing it twice is how the two would drift.
- **Two ingredient rows, never one line reading "serrano or jalapeño".** That spelling mints a
  catalog item literally called "serrano or jalapeño": a row that can never match a real purchase,
  never ranks in the catalog, and gets hand-corrected on the list every single time. Separate rows
  each carry a clean `nameKey`, and choosing between them at add time is what puts exactly one in
  the trolley. This is the entire point of the ingredient half — don't "simplify" it back to a
  parsed `or`.
- **`splitAlternativeNames` (`groceryParse.ts`) notices such a line and *suggests* the split**, in
  the ingredient sheet, applied by `splitIngredientAlternatives`. **The split is verbatim and must
  stay a suggestion**: "chicken or vegetable stock" comes back as `['chicken', 'vegetable stock']`,
  and distributing that trailing noun to fix it is unsafe in exactly the same shape — "butter or
  olive oil" would become "butter oil". Nothing can tell those apart without knowing what the words
  mean, so the parts are shown and the user finishes the job. Same call `splitPrep` makes about
  leading prep words. It matches `or` as a whole word only (so "oregano" is safe), skips quantity
  hedges ("or so", "or more", "or to taste"), and never splits on `/` — that's a fraction far more
  often than a choice.
- **The nudge lives on the ingredient row, the confirm stays in the sheet.** A recipe's ingredient
  row shows a `Split into N…` pill when the parser sees a choice in it (`RecipeDetailScreen`), and
  pressing it only *opens* `RecipeIngredientSheet` — hence the ellipsis. That's deliberate, not a
  missing shortcut: what a person has to check is the parts, which a row can't show without
  truncating them, so there's exactly one place the split is accepted. Suppressed on a row already
  filed under a `choiceGroup`, which is the app asking for something the user has already done.
- **`mergeChoiceGroup` is the undo, and it's a real recombine, not just clearing the label.** The
  Alternatives field's "No alternatives" pill and the per-sibling toggle-off only ever touch one
  row's own `choiceGroup` — that's on purpose (leaving one member shouldn't clear the group for
  whoever else is still in it) but it means neither one actually reverses a split: the sibling
  rows stay behind as separate, permanent lines. `RecipeIngredientSheet`'s "Merge back into one
  line?" offer, mirroring the split offer above it, recombines every member of the *opened* row's
  group back into that one row — named as the members' current names joined with "or", the same
  spelling the split undoes — and removes the rest. It works from whichever member the sheet has
  open, not only the group's default, since there's no reason to require reopening a specific row
  to undo a split made from any of them.

- **The choice is resolved at read time and never written onto the recipe.** `activeComponents`
  picks one option per group, `walk` descends only into that one, and every flatten takes an
  optional `ComponentResolution`. **Passing none resolves to the defaults**, so an unresolved read
  is a complete dish and every caller predating this kept working unchanged.
- **The default is the group's first component in list order**, not a `defaultComponentId`: an id
  is a second thing to keep in step with the list and to repair when that component is removed.
  `makeComponentDefault` moves the link to the front of its group — the promotion *is* a reorder.
- **The pick lives on `MealPlanEntry.recipeChoices`**, because which side you make is a fact about
  a cooking, not about the dish — one recipe, mash on Tuesday and roast on Friday. **One list holds
  both kinds of id** (component links and ingredient lines): every reader asks it the same question,
  and an id says which kind it is by which list holds it. Flat rather than a `{group: id}` map
  because a group can sit on a component several levels down, so a group name alone wouldn't say
  whose group it is. Dangling ids resolve-or-shrug back to the default.
- **`countChoiceAware` is what any "how many" reads**, so `describeRecipe`'s ingredient count and
  `describeComponents` both say one per group rather than one per option.
- **`allOptions` is search-only.** `rankRecipes`' ingredient match passes it so a recipe stays
  findable by an ingredient on the road not taken; nothing that shops or spawns tasks may, and the
  reason is concrete — two sides that share an ingredient each contribute a line, which
  `classifyPlanned` would merge into one doubled quantity. `scoreRecipeAgainstCatalog` and
  `countLikelyInPantry` resolve to the defaults instead, or the coverage denominator inflates with
  lines that will never be bought.
- **The cycle check deliberately ignores choices** (`reachableRecipeIds` walks every option): a loop
  down an unchosen branch is still a loop, and becomes live the moment someone picks that option.
- **An ad-hoc "Add ingredients to list" holds its picks in sheet state and writes nothing** —
  there's no meal for them to be a fact about, and picking the pepper for tonight's shop shouldn't
  edit the recipe. `RecipeToListSheet.initialChoices` seeds them from the entry when the shop is a
  follow-up to cooking one. The week-level `AddWeekToListSheet` deliberately has no chips of its
  own: it aggregates many recipes, and each entry already carries its own answers.

## Component recipes read off a photo (`recipeImportComponents.ts`)

A cookbook page routinely points at another recipe in the same book: "1 cup salsa verde
(page 45)". That is a `Recipe.components` link, and getting it wrong has a concrete cost — the
parent's own "salsa verde" ingredient line and the component's tomatillos both land on the
shopping list, buying a jar of the thing you are about to spend twenty minutes making.
`extractRecipe` returns these as `references` (the model's `referencedRecipes`), and the two
import sheets offer them above the ingredient list.

- **The offer is made during the import, while the book is still open**, not filed away to
  act on later. The app cannot fetch page 45; the only thing that can is the phone already
  held over the book, and it is one page turn away. A stored "you never imported the salsa"
  note is about a book that has gone back on the shelf. Nothing here is persisted: an
  ignored reference leaves no trace, and the ingredient line it was attached to behaves
  exactly as it always did.
- **The whole flow stays inside the sheet that's already open.** The referenced page is read
  into `useRecipeComponentImports` state and nothing is written until the sheet's own
  Create/Add, which lands the parent, the components and the links together. Creating the
  parent first and *then* asking would leave a committed recipe behind a half-finished
  import, so backing out would mean cleaning up.
- **A reference with no locator is dropped, in code and not only in the prompt.** "Serve with
  rice" names a dish and points nowhere; without the gate, the closing line of every method
  becomes a recipe the app pesters you to photograph. `parseExtractedReferences` requires a
  non-empty `reference` — same split `parseExtractedItems` makes between *asking* the model
  for an aisle and *canonicalising* whatever comes back.
- **It is a different field from an ingredient's `component`, and the prompt says so in as
  many words.** That one labels a part of *this* recipe's own list ("For the frosting") and
  lands on `RecipeIngredient.section`; this one names a separate recipe with its own page.
  The two words are one keystroke apart in meaning and the model will otherwise conflate them.
- **Accepting a reference unticks the ingredient line that names it** (`coveredIngredients`,
  matched on `groceryNameKey`), with a note on the row saying why. A row that unticks itself
  with no explanation reads as a bug; a row that stays ticked is the double-buy above.
- **`importableReferences` drops anything `addComponent` would refuse** — the recipe being
  imported into, a component it already has, a link that would be a cycle — using the same
  `wouldCreateRecipeCycle` the store checks with. An offer that ends in a silent no-op is an
  offer not worth making.
- **A created component gets everything a standalone import would**: ingredients, servings,
  time, method and prep tasks. The one thing it doesn't get is references of its own
  (`includeReferences: false`) — a component pointing at a *third* page has nowhere to offer
  that, and a row that grows its own rows is a flow with no bottom. `suggestRecipeGroceries`
  turns them off for the same reason `includeMethod` is off there: nowhere to put the answer.
- **The component import is photo-only.** The main import offers paste and link too, because
  a recipe started from scratch could come from anywhere. A reference has already said where
  it is: page 45 of the book in front of you.
- **A page number is kept, because the source stated it.** `referencePageNumber` pulls "45"
  out of "page 45" and the imported recipe gets `sourceType: 'cookbook'` plus that
  `sourcePage` — the same provenance-not-a-guess argument that lets a link import write the
  site name. A locator that names no page ("opposite") leaves both alone rather than writing
  "opposite" into a field rendered as a page number.

## Sections (`recipeSections.ts`) — the heading an ingredient sits under

`RecipeIngredient.section` is a label on a flat list, not a nested groups type. A *populated*
heading is still only ever inferred — `RecipeDetailScreen` opens one wherever a row's section
differs from the row before it, so **the order already decides the grouping** for any heading that
has rows. Filing a row into one is nothing but moving it: no separate re-file step, no membership
list to keep in sync with the order.

**A heading with nothing under it yet is the one case that model can't represent on its own**,
which is what `Recipe.emptySections: string[]` is for — headings declared ahead of any ingredient,
independent of the row-label inference above. `addEmptySection`/`removeEmptySection`
(`useRecipeStore`) write it; `useRecipeStore`'s `save()` is the one place that reconciles it against
`ingredients`, pruning any name a real row has come to carry — so a declared heading is redundant
the instant something's actually filed under it, and every mutator that can touch `section` gets
that pruning for free rather than each having to remember to call it. `allSectionsOf` is
`sectionsOf` (labels rows use) plus whatever's still declared-and-empty, in that order — pickers
(`RecipeIngredientSheet`'s Section field, the sticky heading field, "New section"'s own duplicate
check) read this, not `sectionsOf` alone, so a heading created ahead of its ingredients is
choosable before anything's filed under it.

- **Declaring a heading is its own control, "New section" up by the Ingredients label — not folded
  into the add-ingredient flow.** The first pass put a `+` on the sticky heading field itself
  (typing a name there already meant "what new ingredients get filed under"), which made one field
  do two unrelated jobs depending on which tiny icon got tapped, and buried section-creation inside
  a flow it has nothing to do with. "New section" reveals its own one-off field (closes itself if
  left empty, same convention `PillGroup`'s "New …" fields use) and is the only way to mint a
  heading; the sticky field went back to being a picker over headings that already exist, same as
  `RecipeIngredientSheet`'s Section field — it used to be free text, on the theory that a picker
  would be empty exactly when someone first needed it, but that gap is what "New section" now
  fills, so a typo there can no longer mint a heading nothing else can find.
- **An empty heading is a real drop target, not a static caption.** `RecipeDetailScreen` builds one
  *merged* list for its ingredients `SortableList` — every ingredient row plus one marker per
  heading, populated or empty, at the position it renders — so a heading is something a row can be
  dropped next to whether or not it has members yet. Headings don't wire up `drag` themselves (only
  ingredients move by being picked up); a dragged ingredient released next to one joins it.
- **`sectionsFromMergedOrder` is the whole derivation, and it's a five-line walk.** Once a heading
  is an explicit marker at a real position in the list, "which section does this row belong to"
  stops being an inference problem — it's whatever marker precedes it, full stop. This replaced
  `resolveSectionDrop`, a ~40-line heuristic that existed only because a *populated* heading used to
  be nothing but two adjacent rows' labels meeting, which made "which neighbour wins" a genuine
  question (reordering the frosting's cream above its sugar makes cream the first frosting row, so
  the row above it is the cake's — pulling cream into the cake over that would have been wrong).
  With an explicit marker in the list there's nothing left to disagree about, and the reorder
  handler recomputes every row's section fresh on every commit rather than diffing before/after to
  guess which one row moved.
- **`SortableList` grew one additive prop for this: `onHoverChange(index | null)`.** A populated
  heading already signals "you're about to join me" for free, from the rows around it visibly
  opening a gap — an empty heading has no neighbours of its own to move, so it has no such
  feedback unless something says so explicitly. The callback fires from the exact lines that already
  update the internal hover state, mirroring `ReorderableList`'s same-named prop but with the
  payload this list's caller actually needs. Nothing about the drag itself changes for a caller that
  doesn't pass it.

## Linking an ingredient to an existing item (`CatalogLinkPicker.tsx`)

`RecipeIngredient.nameKey` is always *derived* from `name` (`groceryNameKey`, never written
directly — see `docs/arch/groceries.md`'s "the join is nameKey and nothing else"), so an imported
or hand-typed line that spells a thing slightly differently than the catalog does mints a second,
near-duplicate row instead of resolving to the one you already have. `CatalogLinkPicker` is a
fuzzy search over the catalog (`rankGrocerySuggestions`, the same ranking `GroceryAddField` uses)
that a line can open to fix that.

- **Picking a result renames the line to the catalog item's own name; nothing writes a key.**
  That's the same `commit(item.name)` convergence `GroceryAddField`'s suggestions use — the
  existing derivation takes it from there, so this needed no schema change and no
  `nameKeyOverride` field. Don't add one; it would be a second way to say the same thing and the
  two could disagree.
- **It's the same component in both places it's offered**: the import review row
  (`ExtractedIngredientRow`, behind a link icon that also reports whether the line as typed
  already resolves to something) and the manual editor (`RecipeIngredientSheet`, behind a "Link
  to an existing item" action). One picker, not two, for the same reason the ingredient/section
  pickers elsewhere in this doc are shared rather than duplicated per host.
- **It doesn't replace the "Did you mean" nudge.** That one is a zero-interaction correction
  offered inline; this picker is the explicit tool you reach for when the nudge has nothing, or
  has the wrong thing. What the nudge *is* widened once — see below.

## Which lines resolve, said out loud (`ingredientCatalogMatch.ts`)

`nameKey` is an exact match and nothing else, which is right for a stored pointer every reader
trusts and is why plural tolerance lives in `matchWeight` rather than in `groceryNameKey`, "where
merging two shelf items would be permanent". The cost was that nothing ever *said* whether a line
had crossed the bridge: a line one character or one leading word off read exactly like a line
naming something genuinely new, and the only way to find out was to open each one. #2061 was
someone watching "skyr" offer to create itself while a Skyr row sat in the catalog.

This module is the other half — everything the exact join can't say, computed at read time,
offered, never written. Five tiers, strongest evidence first: an exact key (`linked`), then
`suggestShorterCatalogName`'s confirmed leading-word trim, a whole-word prefix
("greek yogurt plain" → Greek yogurt), `rankGrocerySuggestions`' own ranking (which is where
plural tolerance already lived), and finally a single character's difference.

- **Nothing here writes, and there is still no second key field.** Taking a suggestion renames
  the line to the catalog item's own name and lets the existing derivation follow — the same
  `commit(item.name)` convergence `CatalogLinkPicker` and `GroceryAddField` both use.
- **The one-edit tier refuses ambiguity rather than ranking it.** Beet, beef and beer are all one
  substitution apart and all real, so a tie suggests nothing; names under four characters are
  skipped outright, since at three "ham"/"jam"/"yam" are all within one edit. It is not Damerau —
  a transposition counts as two edits and is declined — because the picker is still there for
  anything this won't guess at.
- **`unknown` is not a defect.** Most ingredients are bought once and never need a row, so the
  review sheet lists them and says so rather than presenting them as work.
- **The badge and the sheet read the same call.** The row's pill is a signpost to
  `RecipeIngredientSheet` (the same "not a second place to accept" rule the split pill follows),
  so a row promising "Skyr?" that opened onto a sheet with nothing to accept would be the worst of
  both. The sheet's own "Did you mean" is this call, not `suggestShorterCatalogName` alone.
- **Only a line with something to act on is badged.** An exact match is the healthy common case
  and an unplaceable line is the other one; marking either would put a glyph on most rows to say
  "nothing to do here". The `N of M in your groceries` count above the list is where a
  well-matched recipe says so, and it doubles as the way into the review sheet so the batch pass
  needs no menu item. A badge is suppressed while a split is offered, the same mutual exclusion
  the split pill and the "or manchego" caption already keep.
- **Only a paste gets the banner.** Adding one line at a time already shows its own answer where
  you are looking; a paste is the case where six rows land at once and nothing says which the app
  could place.

## Quantities (`quantity.ts`) — the one place a quantity string is read

`quantity` is free text everywhere it's stored (`RecipeIngredient.quantity`, `GroceryItem.quantity`,
`ItemShopLink.lastPriceQuantity`) and that hasn't changed — this is **a parse-on-read value type, not
a migration**. What it replaced is six modules that each pulled a leading amount out of the same
strings and each had its own idea of what "unreadable" meant (#1671). `parseQuantity` is now the only
reader; the scaler, the converter, the price comparison, the substitute ratio, `mergeQuantities` and
`parseGroceryInput`'s container gate are transformations over one type.

- **`raw` is what renders whenever `amount` is null**, so "a pinch" behaves exactly as it always did
  and no caller needs a refusal branch of its own.
- **`amount === null` is every refusal, stated once**: no leading number, the `x2` notation, and a
  percentage ("2%", which is part of a product name). That last one is the single behaviour this
  extraction changed — `mergeQuantities` used to read `%` as a unit and sum "2%" + "2%" to "4 %",
  where scaling, converting and comparing all already refused it.
- **`countNotation` deliberately leaves `amount` null.** Scaling is the only reader with a use for
  `x2`; every other one refused it before the type existed and gets that refusal for free.
- **`container` carries both a size and a count**, because the leading number of "14 oz can" is the
  tin's size and of "2 14 oz cans" is how many tins. `sizeText`/`sizeUnit`/`word` are verbatim: the
  two modules allowed to do arithmetic on a quantity both leave a container's size exactly as
  written, so it is carried rather than restated.
- **`rest` is kept alongside `unit`**, and that isn't redundancy: `substituteQuantity` compares the
  *whole* tail so a per-clove ratio can't take "3 cloves, minced", and `SubstituteSheet`'s hint names
  back what the user typed.
- **A shared parse is not a shared licence.** What each module may *do* with the result is still its
  own rule, written where it lives — scaling never converts, conversion is display-only and marks
  `≈`, `mergeQuantities` still won't collapse units that merely measure alike.

## Scaling (`recipeScale.ts`) — halving and doubling a recipe

**This is the one place in the app that does arithmetic on a `quantity`**, and the only reason it's
allowed to is that it's narrow by construction and always reached through a factor the user picked.
Everything in `mealPlanGroceries.ts`'s header note still holds for every other reader.

Rules 1, 3 and 4 below are `quantity.ts`'s now (the leading amount, the refusals, the rationals).
What's left in `recipeScale` is the multiplication and the shapes it renders back.

The four rules that make it safe, all enforced in `scaleQuantity`:

1. **Only the leading amount is ever touched.** Unit, size clause and container word carry through
   verbatim, apart from pluralising off a closed table.
2. **No unit conversion, ever.** "500 g" doubled is "1000 g", not "1 kg". Scaling multiplies a
   number the user gave, so it has to hand back the same measurement they wrote — "1000 g" is
   unidiomatic, never wrong. Converting is a *different request*, asked separately in Settings and
   answered separately at render time — see Unit conversion below. Nothing in `recipeScale` may
   convert.
3. **A quantity whose amount doesn't parse passes through verbatim and flagged** (`scaled: false`).
   "a pinch" doubled is "a pinch", and the UI says so (`describeUnscaled`) rather than inventing
   "2 pinches". Coverage is ~95% of the quantity strings this app produces; the refusals are the
   feature, not a gap to close by guessing.
4. **Arithmetic is exact rational**, so "1/3 cup" tripled is exactly "1 cup" and halved is
   "1/6 cup" — never "0.99" or "0.17".

- **The sharp one: `14 oz can` doubled must become `2 14 oz cans`, not `28 oz can`.** That string is
  one can of a given size, so its leading number is the *size*, not a count — scaling it changes
  what you buy. Halving it refuses outright, having no expression in that notation. Both container
  shapes are recognised by `parseQuantity` (`Quantity.container`) rather than by each reader, so the
  parser and the scaler can't come to disagree about what a container line is.
- **Plural is `> 1`, not `!= 1`** — "1/2 cup", "1 1/2 cups". A unit that isn't in `UNIT_PLURALS`
  passes through uninflected ("2 bulb"), which is the same trade `groceryParse`'s unit whitelist
  makes: slightly wrong grammar in the user's own word beats "2 pinchs".
- **A factor is a fact about a cooking, not about the dish.** `MealPlanEntry.recipeScale` persists it
  per planned meal (doubling Sunday's chili must not double the recipe, or every other meal that uses
  it as a component); the recipe screen and the add-to-list sheets hold it in view/sheet state and
  write nothing. **Never store it on `Recipe`.** `bulkReplaceItem` deliberately keeps the scale while
  resetting `recipeChoices` — a choice group belongs to the recipe that defined it, but "feeding
  eight on Sunday" survives a swap of what's being cooked.
- **Factor chips are the floor, a servings stepper is layered on where it can be.** `Recipe.servings`
  is nullable and plenty of recipes never had one, so the chips (`½× 1× 1½× 2× 3×`) are what's always
  available. When a recipe does know its own count, `RecipeScaleChips` also renders a `CountStepper`
  targeting servings directly — the open-ended-number case this app otherwise reaches for a stepper
  over a chip row for (see `CountStepper`'s own doc comment). `recipeScale.factorForServings`/
  `targetServingsFor` are the two-way conversion, capped at the same 99 `RecipeEditor` caps
  `Recipe.servings` at. Both controls write the same `value` factor — picking a chip moves the
  stepper, typing a target usually deselects every chip, since most targets aren't a preset.
- **This reopened `parseQuantityAmount`'s refusal of fractions**, which used to be a documented
  decision. It had to: a halved recipe *produces* "1 1/2 cups", so every merged shopping row would
  have degraded to `mergeQuantities`' rule-5 list. `mergeQuantities` now also compares units by
  identity (`unitKey`) and agrees the summed unit with the total, because scaling generates both
  "1/2 cup" and "2 cups" itself and a raw string comparison would list two measurements of one thing
  side by side. It still never collapses units that merely measure alike — "g" and "kg" stay two
  units, since merging those is rule 2 again.

## Unit conversion (`unitConvert.ts`) — showing amounts in the reader's units

The `unitSystem` setting (`asWritten` / `metric` / `us`, default `asWritten`) shows a quantity in
the units the cook thinks in: "1 lb" read as "≈450 g". It is the second module allowed to do
arithmetic on a `quantity`, and it does the one thing scaling's rule 2 forbids — which is the
point. Scaling multiplies a number the user gave and owes them the same measurement back;
converting is the user asking, in Settings, to be shown a *different* measurement of the same
amount, and answering that in the unit they already had answers nothing.

- **Display only, and that's the whole safety argument.** Nothing is written back. Every call site
  renders `convertQuantity(...).text` over a stored string it doesn't touch, which is why the
  **editable fields deliberately don't convert** (`RecipeIngredientSheet`, `GroceryItemSheet`) and
  neither do the previews of text about to be *saved* (`RecipeExtractSheet`, `RecipeCreateSheet`,
  `GroceryAISheet`, `GroceryAddField`'s live token). A field you're about to write has to show what
  will be written. The read-only pills are the four that convert: the ingredient row on
  `RecipeDetailScreen`, both add-to-list sheets, and `GroceryRow`.
- **Converted text is always marked `≈`**, because every conversion here rounds (below). One
  character at every render site, rather than a styling change at each one — and it's what stops a
  converted number reading as the recipe's own words. On `RecipeDetailScreen` a converted pill also
  takes the same tint a scaled one does, since both mean "the app's number, not the recipe's".
- **Scale first, convert second.** The multiplication is exact and the conversion rounds, so
  rounding last is the only order that doesn't compound.
- **A closed table, never a guess** — mass and volume only, keyed by `unitKey` so both inflections
  land on one entry. A count ("3", "x2", "4 cloves"), an unparseable amount ("a pinch") and a unit
  not in the table all pass through verbatim and flagged, exactly as scaling's rule 3 does. **A
  container's size never converts** either ("14 oz can" stays), recognised as the same
  `Quantity.container` the parser and the scaler read: "≈400 g can" is a product nobody sells. `oz`
  is mass and only mass — the parser has no "fl oz", so there is no ambiguous ounce.
- **Rounded to what a person would write**, which is the half that makes it useful and the half that
  makes `≈` mandatory: 1 cup is 240 ml, not 236.59. Metric rounds to a step that widens with
  magnitude; US snaps to a cooking fraction and **refuses to when none is close enough**, saying
  "1.1 lbs" rather than claiming the "1 lb" it isn't. Thirds are a *volume* denominator only — a
  measuring set has a 1/3 cup, and "3 1/3 lbs" is not a number anyone weighs to. The two tolerances
  differ for the same reason (a cup is loose, a scale isn't), and that asymmetry is deliberate: at
  the volume tolerance, 1.5 kg would render "3 1/2 lbs", nearly 90 g out.
- **A merged quantity is converted part by part** (`' · '`, what `mergeQuantities` emits when it
  won't add two measurements together), with one `≈` on the front. Converting only the leading
  measurement would leave the rest of the string as a stray tail.

## Cook mode (`cookMode.ts`) — the method one step at a time

Every other kitchen surface here is built for *preparing* to cook. This is the twenty minutes of
doing it: full screen, one step, the screen held awake, the cook timer in reach throughout. It is
a **read plus one timer**, no schema change and nothing written — `cookSteps` derives the method,
`CookModeSheet` draws it, and position and the ingredient panel's fold die with the modal.

- **It reads the nodes, not a fourth flatten.** `cookSteps` walks `cookedDishes` — the same
  component walk, the same once-per-recipe rule, the same choice resolution the ingredient and
  prep-task flatteners take. Writing a `flattenRecipeSteps` beside them would be a fourth copy of
  one walk to keep in step.
- **The order is the walk's, root first, and the boundary is *said* rather than guessed.** Nothing
  here knows that the mash wants boiling before the steak is seared, so an interleave would be
  asserting a schedule nobody wrote. A step from a component carries `whole: false` and renders
  under that component's name instead.
- **`notes` is the fallback, per node.** Every recipe predating `Recipe.steps` has its method in
  `notes`, so a cook mode reading only the structured list would be inert for most of the box.
  `stepsFromNotes` splits on blank lines when the blob has any and on newlines when it hasn't (a
  method typed as paragraphs wraps its own lines; one typed per line has no blanks to find), and
  takes a leading "1." off because cook mode numbers the steps itself. **A blob with no line
  breaks is one step** — sentence splitting is the tempting third rule and it's wrong, because
  "add 1.5 cups" and "Mr." are what it does to a real method. One long step is unhelpful; half a
  sentence is misleading. It is display only: nothing is written back, and a bad split is fixed by
  writing real steps.
- **The cook timer is the recipe's own**, through `useRecipeTimer` — the hook that now owns the
  clock, the derivation against it and the four store calls for *both* of a recipe's timers.
  `RecipeDetailScreen` reads through the same hook, so "start it here, log it there" is structural
  rather than a promise; a second stopwatch that merely looked alike would have a cook running two
  and logging one. It takes an undefined recipe so a screen can call it above its own "the row is
  gone" guard — and `CookModeSheet` passes `visible ? recipe : undefined`, since a modal mounted
  invisible must not hold a once-a-second interval open.
- **Quantities are the panel's, never the step's.** The ingredient panel runs the same
  scale-then-convert pipeline the recipe row does (exact multiplication first, rounding conversion
  second), so a halved recipe reads correctly mid-step. The step text renders exactly as written:
  nothing parses amounts back out of a sentence, and per-step amounts wait for the ingredient
  references #1695 deferred.
- **Nothing is ticked off by itself.** Finishing the last step closes the sheet and logs nothing —
  logging a cook time is the timer's own ✓, the same call `timer.ts` makes about a countdown.
- **`useKeepAwake` is called from inside the Modal's content** (`ScreenAwake`), not at the top of
  the sheet: the sheet stays mounted with `visible` false, and a lock taken there would hold the
  phone awake for the rest of the session. `expo-keep-awake` was already in the tree as one of
  `expo`'s own dependencies and is autolinked with the rest of them, so declaring it needs no
  config plugin and no fresh build.
- **Cook is the third footer verb on the recipe screen**, beside Plan and Add to list — the one
  that happens *now*, so it leads, and hidden outright when the recipe has no method rather than
  offered greyed out. Its arrival is why the primary shortened to "Add to list": three buttons
  don't fit a 390pt line at the old label.

### Step timers (`stepTimers.ts`) — the time the step already names

A method sentence is where the number lives. "Cook, stirring occasionally, until mostly golden,
7 to 9 minutes" is a recipe telling you exactly what to set a timer for, and until now every
cook read that, picked up the same phone, and typed it into a different app. Cook mode reads it
out of the step and offers it as a chip; a tap starts a countdown that lives in the footer, rings
through a locked phone, and outlives the sheet.

- **It parses to *offer*, never to act.** Nothing starts a timer by itself and nothing is written
  back onto the recipe, which is the entire reason the parse can afford to be dumb about
  ambiguity: a false positive costs a chip nobody presses. A parse that *started* something would
  cost a burnt dinner. Same call `stepsFromNotes` makes about splitting a blob and
  `splitAlternativeNames` makes about "chicken or vegetable stock" — read it, show it, let the
  person finish the job.
- **A range rings at the short end.** "7 to 9 minutes" starts a 7-minute timer, because the alarm
  is a prompt to go and look at the pan rather than a claim that the food is done, and the early
  end is the only one of the two that can't already be too late. `StepDuration.maxSeconds` keeps
  the other end for the caption.
- **Words count as numbers.** The demo box's own steak step says "Sear three minutes a side", and a
  parser reading only digits is inert on a good share of a real recipe box. So are fractions in
  both notations ("1 1/2 hours", "1½"), "half an hour", "an hour and a half", and the abbreviations
  a method actually uses. There is deliberately **no bare `m`/`h`/`s`**: `parseTaskInput` can afford
  those because its "for …" anchor says a duration is coming, and a method sentence has no anchor —
  "5 m" in a recipe is a length more often than a time.
- **A floor and a ceiling, not a cleverer parser.** Under five seconds is refused, which is how
  "add a second layer" and "give it one second" are answered without teaching the parser what "a
  second batch" means. Over twelve hours is refused too: an overnight brine is a real duration and a
  terrible kitchen timer, and it wants a task with a reminder, which the app already has.
- **Lengths are deduplicated, and `Again` is why.** "3 minutes per side, then 3 minutes more" is one
  timer offered twice, and two identical chips read as a parser fault. A rung timer's own **Again**
  is the answer to a duration used twice, along with the second batch and the other side.
- **`RecipeStep.timerSeconds` is the override, and it replaces the parse rather than joining it.**
  It exists for the step whose sentence gives no time ("until the edges look dry") and the one whose
  wording the reading gets wrong; leaving the wrong chip next to the right one would defeat having
  set it. Nothing derived is ever written into it — a parse is a reading of the text and stays one,
  so a step whose wording changes gets a new reading rather than an old answer.
- **`StepTimer` is its own model, in its own settings-backed store.** A recipe's cook and prep timers
  are two fixed clocks measuring the whole cooking; these are ad hoc and several at once ("7 minutes
  on the tempeh" and "20 on the rice" during one dish), so a field pair can't hold them. It persists
  because the whole point of setting one is walking away: the sheet closes, the app backgrounds, the
  phone locks, and an app that had forgotten a timer it was about to ring would be worse than one
  that never offered. Same banked-segment pair (`startedAt`/`elapsedSeconds`) every other timer here
  stores, so nothing is counted down in state. `pruneStaleStepTimers` bounds the stack at four hours
  past ringing — long enough that someone who left the kitchen still finds out, short enough that
  Thursday isn't holding Tuesday's tempeh.
- **The offer scrolls with the step; the running timer doesn't.** Chips sit under the sentence they
  were read out of, which is what makes it obvious the app didn't invent a number. Once started, the
  timer belongs to the footer: pressing Next must not take a running countdown off screen, and Pause
  has to be reachable without navigating back to the step that started it. The recipe screen shows
  the same rows on its timer card, since closing cook mode mid-timer is the ordinary thing to do.
- **A rung timer sinks to the bottom of the stack rather than jumping to the top.** It's the one row
  that wants dealing with, which argues for the top — but the stack is what a thumb aims at with
  hands full, and a row that jumps as it rings moves Pause out from under a finger already on its
  way down. It turns orange and says "Time's up" instead.
- **It rings through quiet hours and through the silent switch**, which is a deliberate divergence
  from `scheduleTimerAlarm` and `scheduleFocusStepAlarm`. Those suppress inside quiet hours and are
  right to: a task timer may have been left running for hours, and "your break is over" delivered at
  7am is noise. This is minutes long and was started on purpose by someone standing at a stove, so
  it goes out through AlarmKit where that's available (falling back to a notification with a sound
  everywhere else). Someone cooking at 11pm with quiet hours from 10 has not asked the app to let
  dinner burn.

