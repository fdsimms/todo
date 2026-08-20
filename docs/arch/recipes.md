# Recipes: composition, sections, quantities, scaling, cooking

How a recipe is built out of other recipes, how its ingredient lines are read
and transformed, and how it is cooked. `docs/arch/groceries.md` owns the
catalog these lines resolve against.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

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
  never ranks in Buy again, and gets hand-corrected on the list every single time. Separate rows
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
