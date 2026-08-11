# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PR workflow

Once a change is complete and verified (`npx tsc --noEmit && npm test` green, feature manually
exercised where applicable), open a PR automatically — don't wait to be asked. Skip only when
there's a concrete reason (work is incomplete, checks are red, or the user said to hold off);
say why instead of opening one silently.

Don't subscribe to PR activity and don't schedule follow-up check-ins after opening a PR unless
the user explicitly asks for that. Just open the PR and stop.

## GitHub issue labels

When creating an issue, apply exactly four labels from these fixed sets (verbatim strings — don't
invent new ones). Setting a label that doesn't exist yet auto-creates it, so there's no separate
creation step.

1. **Type** (pick one): `bug` (broken vs. intended behavior) · `enhancement` (new feature/capability)
   · `chore` (refactor, upgrade, tooling, dev-only, tracking/meta issues) · `explore` (open-ended
   research/spike, not yet committed to building — "Explore", "Think through", "Spike:",
   "Investigated:", "Decided against:", "Decide whether", or a design question rather than a scoped
   task)
2. **Area** (pick one, whichever the issue is primarily about): `area:task-list` (core tasks,
   categories, tags, projects, templates, chains, stacks, recurrence, notifications, search, editor,
   navigation, drag/drop, widgets, app lock) · `area:groceries` (grocery list, catalog, aisles,
   stores/shops, buy-again) · `area:meal-plan` (meal planning calendar/week view, leftovers
   tracking) · `area:recipes` (recipes, ingredients, recipe import) · `area:app-wide` (settings,
   theming, AI/Claude integration config, performance, accessibility, platform/build/native-target
   work, or anything cutting across the areas above)
3. **Model** — which Claude model is best suited to implement it: `model:haiku` (trivial,
   mechanical, tightly-scoped — a copy fix, one-file bug) · `model:sonnet` (typical feature work or
   bug fix, the default for most issues) · `model:opus` (architecturally significant, spans many
   files/layers, ambiguous requirements, or needs real design tradeoffs)
4. **Effort** — implementation/reasoning effort: `effort:low` (small, one file or one clear code
   path) · `effort:medium` (a few files or some design thought — the default) · `effort:high`
   (spans multiple layers, e.g. db/store/UI, or has real design ambiguity) · `effort:xhigh` (a major
   feature/initiative)

Judge model and effort together (a `bug` is rarely `xhigh`; a big new sync-engine spike is
`model:opus` + `effort:xhigh`; a copy/UI tweak is `model:haiku` + `effort:low`).

## Commands

```bash
npm install          # dependencies; node_modules isn't checked in, so a fresh clone needs
                     # this before tsc or jest will run at all
npx expo start       # start dev server (scan QR with Expo Go)
npx tsc --noEmit     # typecheck — ~10s
npm test             # all 70 suites, 2,614 tests — ~4s, just run the whole thing
npm run test:watch   # watch mode
npx jest src/__tests__/dateUtils.test.ts  # single file, if you want the shorter output
```

**The verification loop is `npx tsc --noEmit && npm test`** — together they're under fifteen
seconds, so there's no reason to skip either or to narrow to a single test file. Both are green
on `main`; if either is red, it's you. Don't run `npx expo export` locally to check your work —
it's the slowest thing CI does and only catches bundle-time breakage (a bad import path, a
missing asset, a native config change), so run it only when you changed one of those. CI runs
`npm test` and `npx expo export --platform ios` on every PR.

There is no ESLint or Prettier config. Match the style of the file you're in; don't reformat
untouched lines.

## Finding your way around

Start from this table instead of searching. Most work lands in one of these files:

| Changing… | Start at |
|---|---|
| what appears on Today / Later / Unscheduled / Inbox | `src/utils/visibilityUtils.ts` + the selectors in `useTaskStore` |
| any task create/complete/defer/delete | `src/store/useTaskStore.ts` |
| the task edit sheet | `src/components/TaskEditor.tsx` |
| a task row — swipes, checkbox, expansion | `src/components/TaskItem.tsx` |
| quick-add text parsing (`"pay rent tmrw 5p #home"`) | `src/utils/parseTaskInput.ts`, `parseNaturalDate.ts` |
| date math, recurrence | `src/utils/dateUtils.ts` |
| a task falling on several dates | `seriesId` in `src/store/useTaskStore.ts` (`applyTaskDates`) — see Series below |
| a column, migration, or row↔object mapping | `src/db/database.ts` (`initDatabase`, `rowToTask`) |
| any model's shape | `src/types/index.ts` — one file, every type |
| colors, spacing, animation | `src/theme/index.ts`, `src/theme/ThemeContext.tsx` |
| pinning, the Pinned Tasks block | `pinnedBlock` in `src/screens/TodayScreen.tsx` — see Pinning below |
| bulk selection | `src/hooks/useTaskSelection.ts` + `src/components/BulkActionBar.tsx` |
| reminders | `src/utils/notifications.ts` |
| how long completed tasks are kept | `src/utils/retention.ts` + `purgeOldCompletedTasks` in `useTaskStore` |
| what the widget shows | `src/utils/widgetSync.ts` → `modules/todo-widget-bridge` |
| importing from Apple Reminders (and so voice capture) | `src/utils/remindersImport.ts` (+ `remindersImportSync.ts`) |
| the Face ID app lock | `src/utils/appLock.ts` + `src/store/useAppLockStore.ts` + `src/components/AppLockGate.tsx` |
| where the Anthropic API key is kept | `src/utils/secureApiKey.ts` |
| the grocery list / catalog | `src/store/useGroceryStore.ts` + `src/screens/GroceryScreen.tsx` |
| which aisle an item lands in | `src/utils/groceryAisles.ts` (offline lexicon) |
| grocery autocomplete, Buy again ranking | `src/utils/grocerySuggest.ts` |
| which store an item comes from | `src/utils/groceryShops.ts` — see Grocery stores below |
| one recipe used inside another | `src/utils/recipeComponents.ts` — see Composed recipes below |
| halving or doubling a recipe | `src/utils/recipeScale.ts` — see Scaling below |

**Read narrowly.** Seven files are over 1,000 lines — `useTaskStore.test.ts` (2.6k),
`TaskEditor.tsx` (2.3k), `TodayScreen.tsx` (2.1k), `QuickAddModal.tsx` (1.6k),
`useTaskStore.ts` (1.5k), `TaskItem.tsx` (1.5k), `TemplateItemEditor.tsx` (1.3k). Grep for the
symbol and read the surrounding range; reading any of them end to end costs more context than
the rest of the task will.

**Tests mirror source 1:1** — `src/utils/foo.ts` → `src/__tests__/foo.test.ts`, same for
stores; that's where a new test goes. Only pure logic is tested (`src/utils`, `src/store`,
`src/db`): Jest runs in the `node` environment with
no React renderer installed, so there are no component or screen tests. Don't add a renderer to
cover a UI change — verify those by reasoning about the code (and by mocking it, see **Mock a
visual change** below), and say so plainly rather than implying you ran them.

## Working style

**Delegate a search, not an edit.** A subagent earns its round trip when the question is a wide
sweep and you only want the conclusion — "every call site of `groupRosterOf`", "which screens
mount `PaintSelectionProvider`", "where does `dayResetTime` get read". Rule of thumb: if
answering it yourself would take more than ~3 grep/read round trips, delegate it instead of
grinding through them inline. When you already know the file from the table above, just grep —
don't spawn an agent for a one-file lookup. Never hand off the writing: one agent making the
whole diff is what keeps it coherent.

**Reach for Explore, not a manual read, on the seven 1,000+ line files.** Grepping and reading
the surrounding range is still the right move (see above), but for an unfamiliar change to
`useTaskStore.ts`, `TaskEditor.tsx`, `TodayScreen.tsx`, or the others in that list, running that
grep-then-read loop through an Explore agent keeps the raw file content out of your own context
— you get the relevant chunk and a citation, not the whole file. Reach for it especially when
you expect more than one round trip into the same file.

**Say the sequence before a change that spans layers.** Anything touching db + store + UI
should be planned in a sentence or two first, because the constraint almost always lives
downstream: the schema and the visibility rules decide what the UI is allowed to do, not the
other way round. When the plan requires understanding current behavior in each layer first,
fan that out — one Explore agent per layer, run in parallel — rather than reading them
sequentially yourself; the layers are independent to read even though the change across them
isn't.

**Mock a visual change instead of describing it.** There are no component tests and no way to
run the app from here, so a change to spacing, hierarchy, colour or a row treatment otherwise
ships as a paragraph asking the user to imagine it. Don't do that. Build a throwaway HTML mock
in the scratchpad using the real values from `src/theme/index.ts`, screenshot it with the
Chromium that's already in the sandbox, **look at the screenshot yourself**, then send it
alongside the answer:

```bash
/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
  --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1330,620 --screenshot=mock.png mock.html
```

Worth doing properly: before and after side by side, at a real device width (390pt), in both
themes — a redesign that only works in dark is the usual way one of these goes wrong, and
seeing them next to each other is most of the value. Hardcode the hex values in the mock; it's
a throwaway file, not app code, and the tokens are what you're checking.

It is a proxy, not a screenshot of the app: CSS flexbox is not Yoga, RN's text metrics differ,
and nothing about gestures, animation or `SwipeableRow` is being exercised. It proves the layout
numbers and the visual hierarchy and nothing else, so label it that way when you send it. Skip
it for logic changes and one-line tweaks; reach for it whenever the question is "does this look
right".

**Stay in scope.** Fix what was asked, in the pattern the surrounding file already uses.
Adjacent code that looks improvable isn't the task; mention it instead of rewriting it.

**This file is the answer.** The conventions below are settled decisions with the reasoning
attached — the "don't do X" notes exist because X was tried. Don't re-derive them from the
code, and don't re-open them without a reason the note doesn't already cover.

## Architecture

### Data flow

```
SQLite (expo-sqlite, WAL mode)
  └── src/db/database.ts       — raw db functions (dbGetAllTasks, dbInsertTask, etc.)
        └── Zustand stores
              ├── src/store/useTaskStore.ts      — all task operations
              ├── src/store/useSettingsStore.ts  — user preferences, persisted to settings table
              └── src/store/useProjectStore.ts   — project CRUD
                    └── React screens / components
```

All database calls are synchronous (expo-sqlite `runSync`/`getAllSync`). There is no backend, and every
piece of user data lives in a local SQLite file on device. The one network call in the app is
`src/services/aiSuggestions.ts`, which posts task titles/notes straight to `api.anthropic.com` using a
user-supplied API key; every feature it powers is inert until the user pastes one into Settings.

Stores are initialized once at app startup (`initialize()` on each store). Mutations always write to SQLite first, then update Zustand state.

### Visibility model

The core differentiator: tasks have multiple reasons to be hidden, checked in `src/utils/visibilityUtils.ts`:

1. `deferUntil` — hidden until a specific day
2. `timeSegments` — hidden until a time-of-day threshold (morning/afternoon/evening)
3. `dueDate` — hidden if due on a future day
4. `vacationPause` + vacation mode — temporarily hidden

`isTaskVisible()` drives the Today screen. `isTaskDeferred()` is just `!isTaskVisible()`. `getVisibleAt()` returns the earliest moment a deferred task surfaces (used to sort the Later screen).

All time comparisons use the configurable `dayResetTime` (default `"00:00"`) to define when the logical day starts — e.g. a 2 AM reset means tasks on a "day" don't surface until 2 AM.

**Expiry needs a window that closes and a day to close it on.** `isTaskExpired()` is the one gate with no way back — `sweepExpiredTasks` deletes what it flags — so it checks both. `effectiveWindowEnd()` ignores a `windowEnd` that isn't after its `windowStart`, because both gates anchor to a single logical day and "22:00–02:00" otherwise compares as past from 02:00 onward: expired before it ever opened. And `windowEnd` is deliberately not a date signal (see `hasNoDateSignal`), so a task carrying only one has no day to be late for — `hasDayArrived()` can't catch that, since with no `dueDate` it's vacuously true. Expiry now demands the same placement `isTaskVisible` does.

### Pinning — a pinned task has two rows, and that's the feature

Pinning adds a **copy** of a task to a "Pinned Tasks" block at the top of Today. The original row
stays exactly where it is, in its own category section, with its pin glyph lit. Both rows are live
and interchangeable — same task, so completing or swiping either does the same thing.

**Never filter pinned tasks out of the main list again.** `listItems` used to do it in one line
(`filtered.filter(t => !t.pinned)`), with an "Everything else" divider collapsing whatever was
left, and essentially every problem the feature had came from that:

- Pinning moved every row below the finger, so the second pin in a run was a tap on a row that had
  just jumped. ~110 lines existed to paper over it — a 3s ceiling timer, five "the run of taps is
  over" interaction signals, a render-time `prevPinnedCount` check to kill a one-frame flash, and a
  `todayDragging` hold. All deleted. Don't reintroduce any of it; nothing moves on a pin now, so
  there is nothing to delay.
- The pinned layout was a *second list component* (a plain `FlatList`), so the first pin remounted
  the list and lost its scroll offset — and because that branch never got `visibleGroupItems`,
  **stacks silently vanished while anything was pinned**. One `ReorderableList` is always mounted now.
- "Everything else" arrived collapsed, so pinning one task hid the day. The eye button in the pinned
  header does that now, on request, and defaults to off (`othersHidden`, session-only).

The block is the list's **`ListHeaderComponent`, not rows in its data** — read that prop's note in
`ReorderableList` before moving it, since a header outside the ScrollView silently offsets the drag
math. As rows it couldn't work: `resolveDrop` derives a dropped row's category from the nearest
header above it, so a pinned row dragged down would inherit a category and a task dragged up into
the block would inherit none.

- **`pinnedOrder` is its own number space** (`Task.pinnedOrder`, `reorderPinnedTasks`), because the
  section is hand-orderable and dragging a pin must not also move the original in Work. Default `0`
  = never ranked, with `sortOrder` breaking ties, so an install that upgrades into the column reads
  exactly as it did. Pinning stamps `max + 1` (appends to the bottom) — on the *transition* only,
  or the editor would reshuffle a pinned task to the bottom on every save.
- **The copy passes `duplicateRow`**, which keeps it out of the paint-select registry — that's keyed
  by task id, and two rows claiming one id means whichever unmounts first evicts a row still on
  screen. Same opt-out the drag overlay's floating copy already used.
- **Expansion is keyed on the row, not the task** (`renderTaskRow`'s `rowKey`, `pin-<id>` for the
  copy), so tapping one row doesn't also expand its twin halfway down the list.
- **`pinnedTasks()` ignores visibility on purpose** — a pinned task shows in the block whether or not
  it's due today. So the copy passes `hidesWhenOnPace: false`, and a pinned task that isn't visible
  today has only the one row rather than two.

### Recurrence

Completing a recurring task creates a new task row with a new `id` and the next computed `dueDate`. The original task is marked completed (not deleted). `getNextDueDate()` in `src/utils/dateUtils.ts` handles all recurrence types; it anchors to the previous `dueDate` for fixed schedules, or to today for `recurrenceFromCompletion`.

### Completed-task retention

Every completion leaves its row behind, so a daily recurring task accumulates one tombstone a day forever. Two read-time collapses exist because of that (`groupRoster`, and `projectProgress`'s separate one); `completedRetentionDays` is what finally bounds it at the source — `null`/forever by default, so an existing install changes nothing until the user picks a window in Settings. Rules live in `src/utils/retention.ts`, the delete in `purgeOldCompletedTasks` (startup, after every other maintenance pass, and again when the window changes).

- **Archived rows are exempt.** Archiving is an explicit "keep this, out of my way"; the window is for tombstones piling up unasked.
- **Only top-level rows are ever named.** A completed subtask under a *live* parent is a checked-off step, not history — `dbBulkDeleteTasks`' `parent_id` cascade takes the subtasks of a purged parent, so listing subtasks directly would be the bug, not the feature.
- **Streaks are safe and that's structural**, not luck: `streakCount`/`streakDate` and their `previous*` snapshot live on the row still running the streak and are never summed back across the chain. The pointers that *do* cross rows (`previousOccurrenceId`, `blockedById`) are resolve-or-shrug at every reader — `canBlock(undefined)` is false, chain walks stop on a missed lookup — and already dangle this way after a manual Logbook delete, so a purge leaves them rather than rewriting rows it isn't deleting.
- **It must not go through `bulkDeleteTasks`**, which arms shake-to-undo. A purge the user didn't just perform sitting under their first shake of the session is not an undo.

### Series (`seriesId`) — one task on several dates

A task the user gave more than one date ("walk the neighbour's dog on the 10th and the 15th") is **N real rows sharing a `seriesId`**, each an ordinary one-off with its own `dueDate` and `recurrenceType: 'none'`. It is deliberately not one row holding a list of dates: `dueDate`/`completedAt`/`streakDate` are singular in every visibility, completion and Logbook path, and Later renders real `Task` rows (`laterSections`), so materialising them is the only way all the dates actually appear there. Projected "ghost" rows were the alternative and would have needed a second, non-completable, non-selectable row type through `TaskItem`/`TodayScreen`/`useTaskSelection`.

**Never reuse `previousOccurrenceId` to link them.** That's the backward completion chain, and `uncompleteTask` deletes whichever row points at the one being uncompleted — un-ticking the 10th would delete the 15th.

- **One entry point**: `applyTaskDates(taskId, dates, repeat?)` creates a series around a task, reconciles an existing one, or dissolves it back to a plain task when the set drops to one date. `addTaskSeries` is the create-from-scratch path. Reconciling never touches completed **or archived** rows — a date that already happened, or that the user filed away, is history and not schedule. (Archived ones used to count as live, so a date edit deleted them.)
- **A series never carries a recurrence rule.** They're two schedules for one task, and the editor will happily save both — so `buildSeriesRow`/`applyTaskDates` strip the rule (`NO_RECURRENCE`) when a set forms. Without that, every row kept the rule and each completed date spawned an extra occupant *of the same series*. For the same reason nothing spawned by `completeTask` inherits `seriesId`: the only way to spawn off a series row is mid-chain, and that lands on a day the set already has.
- **Repeat is optional and separate from recurrence**: `seriesMonthDays` (empty = happens once) holds day-of-month anchors, `seriesRepeatMonths` the interval. The next set is inserted by `completeTask` only once *every* date in the current one is done, so finishing the 10th doesn't conjure a third row while the 15th is outstanding. `getNextSeriesDates()` rebuilds from the stored day numbers rather than shifting the current dates, so a 31st clamped to the 28th for February comes back as the 31st in March. The interval field isn't exposed in the editor yet — the UI ships a monthly on/off toggle.
- **Editing** is scoped like a recurrence: `updateTask(..., {scope: 'series'})` fans `CONTENT_FIELDS` out to the set's *later* incomplete dates, re-anchoring `reminderTime` onto each date's own day (it's an absolute instant, and a set shares an hour, not a moment).
- **Counting**: `groupRoster()` collapses a series to one entry, same as it does recurrence tombstones — otherwise a stack holding a 2-date series reads as 2 members. `getRepeatedInstances()` skips series rows so a deliberate schedule isn't reported as an ad-hoc repeat. **Cascades must expand it again**: the roster names one row per member, so `deleteGroup({cascade:true})` collapsing to it deleted one date of a set and orphaned the rest.
- **`projectProgress` has its own collapse and can't reuse the roster** (`src/store/useProjectStore.ts`). Same disease — a recurring member's tombstones grew the denominator forever — but the cure differs: the roster drops old completions, which is right for a stack (they aren't members) and wrong for a project, where a one-off finished last week is exactly a member and exactly done. So it groups rows by identity (`seriesId`, else the root of the `previousOccurrenceId` chain) and counts each once, done only when nothing in it is outstanding.

### Grocery aisles — a name is the identity, so deleting one needs a tombstone

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

### Grocery stores (`Shop`) — which shop has which items

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
  when you're deciding what to buy where. **There is deliberately no store chip on the shopping
  list rows** — the row is already dense, and while you're shopping you're standing in one store,
  so it's noise precisely when the list is in use.

### Composed recipes (`Recipe.components`) — one recipe used inside another

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

### Scaling (`recipeScale.ts`) — halving and doubling a recipe

**This is the one place in the app that does arithmetic on a `quantity`**, and the only reason it's
allowed to is that it's narrow by construction and always reached through a factor the user picked.
Everything in `mealPlanGroceries.ts`'s header note still holds for every other reader.

The four rules that make it safe, all enforced in `scaleQuantity`:

1. **Only the leading amount is ever touched.** Unit, size clause and container word carry through
   verbatim, apart from pluralising off a closed table.
2. **No unit conversion, ever.** "500 g" doubled is "1000 g", not "1 kg". Knowing those measure the
   same thing is knowledge this app doesn't claim — and "1000 g" is unidiomatic, never wrong.
3. **A quantity whose amount doesn't parse passes through verbatim and flagged** (`scaled: false`).
   "a pinch" doubled is "a pinch", and the UI says so (`describeUnscaled`) rather than inventing
   "2 pinches". Coverage is ~95% of the quantity strings this app produces; the refusals are the
   feature, not a gap to close by guessing.
4. **Arithmetic is exact rational**, so "1/3 cup" tripled is exactly "1 cup" and halved is
   "1/6 cup" — never "0.99" or "0.17".

- **The sharp one: `14 oz can` doubled must become `2 14 oz cans`, not `28 oz can`.** That string is
  one can of a given size, so its leading number is the *size*, not a count — scaling it changes
  what you buy. Halving it refuses outright, having no expression in that notation. Both container
  shapes are recognised off `SIZE_UNITS`/`CONTAINER_UNITS`, exported from `groceryParse` rather than
  copied, so the parser and the scaler can't come to disagree about what a container line is.
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

### Chains

Chain items (`chainItems[]` / `chainIndex`, shown in the editor collocated with Repeat since the two are easy to conflate) are a singly-linked list of steps, independent of recurrence: completing a chained task always advances `chainIndex` and immediately spawns the next task with no `dueDate`, ending after the last item. Repeat changes only what happens at that last item — instead of ending, `chainIndex` wraps to `0` and the whole chain repeats on the recurrence's schedule. See the `spawnsNext`/`atChainEnd` logic in `completeTask()` (`src/store/useTaskStore.ts`). `rowToTask()` maps the legacy `cycle_enabled`/`cycle_index`/`cycle_items` SQLite columns to the `chain*` fields on `Task`.

**A step carries its own `estimatedMinutes`, and every workload read goes through `estimatedMinutesFor()`** (`src/utils/effort.ts`) rather than `task.estimatedMinutes` — the same discipline `displayTitleFor` imposes for titles, and for the same reason: mid-chain, only one step is on the day, but the task-level estimate covers the whole chain. Read raw and a five-step routine charges its full estimate at *every* step, and since completing a step spawns the next onto the same day, the day's planned total never falls as the chain is worked. The step value is optional and falls back to the task's, so a chain nobody has itemised behaves exactly as before. `activeChainStep()` (`src/utils/chain.ts`) is the one place the "which step is live" rule lives — including that a single-item chain doesn't count as one.

### Stacks (`TaskGroup`)

"Stack" is the user-facing name; the code says `TaskGroup` / `group` throughout (table `task_groups`, `useTaskGroupStore`, `TaskGroupHeader`/`TaskGroupEditor`). A stack is a lightweight, stable *label* that several independently-scheduled tasks hang off — deliberately not a `Task`, so it can never be "not due yet" and desync from its members. Membership is `Task.groupId`.

**A stack's membership is a set of task *series*, not of task rows.** This is the one thing to get right. Because `groupId` rides along on the `...effective` spread in `completeTask()`, a completed occurrence keeps its `groupId` forever *and* so does the fresh row it spawns — so the raw child rows grow by one per completion, without bound. Never count, cascade over, or list `groupChildrenOf()`; use **`groupRosterOf()`** (store) / **`groupRoster()`** (`src/utils/visibilityUtils.ts`), which collapses those rows back to one entry per series. `groupChildrenOf()` is only for the rare "all history too" case, like re-filing rows when the stack is deleted.

Two counts exist and they mean different things, so keep them labelled: the roster is *membership* ("8 tasks", shown in the editor), and `isRelevantToGroupToday` filters that to *today's work* ("3/8 today", the badge on the Today row). A member that isn't due today is still a member.

**`TaskGroup.sortOrder` is in the same number space as `Task.sortOrder`** — a stack holds a slot in its category section exactly like a loose task, and `makeCategoryGroups` merges the two by that number. It used to be a per-category 1..M ranking of stacks alone, with stacks always emitted ahead of the section's tasks, which made "task above stack" unrepresentable: the drag animated and the rebuilt layout put the stack back on top. So `resolveDrop` hands out one running rank across tasks *and* stacks, and `reorderWithCategoryUpdates` persists those ranks verbatim rather than renumbering the tasks 1..N — the gaps where the stacks sit are the point. (Group *children* still carry a private within-stack 1..K order, set by `reorderGroupChildren`; that space is unrelated.)

**A stack has no completion state of its own — stored, derived, or dismissed.** Today renders one exactly while it has a visible child (`visibleGroupItems` in `TodayScreen`: `children.length > 0`, and `children` comes from `visibleTasks`), so it leaves in the same commit its last row does and returns whenever a member is visible again. Two designs preceded that and both are gone: a `TaskGroup.completedAt` "user dismissed this for today" stamp (the stack sat on Today saying "all 6 done for today" until tapped — an extra tap per stack per day to acknowledge what the finished rows already said), and before that, clearing that stamp on every event that could give the stack live work, which took four call sites and still missed one. The `completed_at` column is still on `task_groups`, unread and never written. **Don't reintroduce a hidden-for-today flag** — riding on `visibleTasks` is what makes the header and its rows leave together, since a just-ticked row stays in `visibleTasks` for the completion hold (`completionHoldIds`) and the header rides that window out with it.

Cascades (`completeGroup`, `deferGroup`, `pinGroup`, `deleteGroup`) are roster-scoped so they can't mutate completed history. `deleteGroup({cascade:true})` deletes the live members and merely unfiles the past occurrences — deleting a stack must not erase its Logbook and Stats history.

### Apple Reminders import — voice capture, and the only thing that deletes data elsewhere

"Hey Siri, remind me to buy milk" lands in the Reminders app; `src/utils/remindersImportSync.ts`
pulls it into the Inbox and deletes the reminder. Going through Reminders rather than owning a
Siri phrase is deliberate — a phrase has to be anchored on `\(.applicationName)`, and Siri
cannot reliably hear "dundundun". A custom App Intent was built and reverted for exactly that
(plus an iOS 16 floor it forced); don't reach for one again without solving the name.

Three things about `expo-calendar` that nothing in this repo will tell you, each of which cost a
read of the published tarball:

- **`getRemindersAsync` must be called with a null status.** Passing `ReminderStatus.INCOMPLETE`
  makes the JS wrapper throw unless you also give it a date window, and natively that window is
  matched against the **due date** — which a dictated reminder hasn't got. A status query drops
  exactly the reminders this feature exists for. So the fetch is unfiltered, completed reminders
  come back with everything else, and every "may we touch this" rule lives in
  `importableReminders()` instead. That's why the pure module is mostly filters.
- **`getDefaultCalendarAsync()` is not the default *reminders* list.** It asks for **calendar**
  permission (which this app never wants) and returns `defaultCalendarForNewEvents`. There is no
  API for the reminders default, which is why picking a list is the first step of enabling
  rather than a correction to a guess.
- **Never pass an unvalidated list id.** A stale one reaches `predicateForReminders(in: [])` —
  undocumented, and if an empty array ever behaved like `nil` it would mean every reminder on the
  device. The drain re-checks the id against a live `getCalendarsAsync(EntityTypes.REMINDER)`
  every time.

And one about config plugins generally, learned here: **leaving a package out of `app.json`'s
`plugins` does not stop its config plugin running.** Expo autolinks the plugin of any dependency
shipping an `app.plugin.js`, so `expo-calendar`'s ran unasked and wrote two `NSCalendars*` usage
strings this app has no business declaring, plus Android `READ_CALENDAR`/`WRITE_CALENDAR`. The
way to *narrow* a plugin is to list it with options, and the Android half needs
`android.blockedPermissions`, which the plugin adds unconditionally regardless of its options.

**But `calendarPermission` must stay a real string, and this is the one that bricked the app.**
`createPermissionsPlugin` treats `false` as a removal, so setting it deleted
`NSCalendarsUsageDescription`/`NSCalendarsFullAccessUsageDescription` — which reads as exactly
right, since nothing here ever touches a calendar. It isn't. `CalendarModule`'s `OnCreate`
registers a `CalendarPermissionsRequester` and initialises a static `EKEventStore` **whether or
not the app ever calls a calendar API**, and touching EventKit's calendar entity with no usage
description raises an `NSException` inside module registration.

What that costs is the whole app, not the feature. Expo registers modules in one pass in
autolinking order, so the throw took out `expo-calendar` *and every module alphabetically after
it* — font, constants, sqlite, notifications, all of them. Fifteen of twenty modules never
registered. The app then died on the first `requireNativeModule` the bundle happened to reach,
which was `ExpoFontLoader` (via `@expo/vector-icons`, which imports `expo-font` on line 1), and
the black screen that produced is why `index.js` prints the registered-module list on failure —
**that list is the diagnostic**: a short one means registration aborted, and the first missing
package alphabetically is the culprit, not the module named in the error.

The safety rules are load-bearing, not ceremony — this is the one feature that destroys data the
user owns in another app. **Create the task, then delete the reminder**, never the reverse: a
failed delete leaves a visible duplicate, a failed create after a delete loses the capture
silently. The handled record (`remindersImportHandled`) names a reminder the moment its task
exists, before the delete is attempted, because both a *failed* delete and a *slow* one hand the
same reminder back to the next fetch. A list is only offered if `allowsModifications` — a read-only shared list imports
fine and fails every delete, re-importing itself for ever. And nothing runs until the user has
confirmed an alert naming the list and the exact count, keyed on the list id so switching lists
asks again.

**"Already handled" is keyed on the reminder's id and persisted, never inferred from the task.**
With "Delete after importing" off — and after any failed delete — the reminder stays in the list
and is re-read on every foreground, so something has to say "we've seen this one". That used to
be a title match against the store, which is evidence *the user can destroy*: renaming or
deleting the task freed the reminder to import again, and again, with nothing they could do
about it. The record is now a settings row keyed by list (`remindersImportHandled`), holding
every id imported **or deliberately skipped** — a skip has to count, because on the first launch
after this shipped the name index is the only thing that recognises the pre-existing imports, and
recording what it recognises is the entire backfill. It stays bounded by pruning to what the list
still holds on every drain (`reconcileHandledReminders`), so with deletion on it empties itself.
The name index survives as the *first* answer about a reminder the record has never seen, not as
the record.

### App lock, and the one secret this app holds

Everything the app knows is unencrypted on the device, so two things guard it: a
Face ID gate in front of the UI, and the keychain for the API key.

**`locked` is derived, never stored** — `appLockEnabled && !unlocked`, computed in
`useAppLockStore`/`AppLockGate` from a session flag that no launch persists. An
`isLocked` boolean set from an effect has a committed frame where the setting and
the flag disagree, and it goes wrong in both directions: a frame of the task list
at cold start, and a frame of the lock screen the instant you enable the feature.
For the same reason the Settings toggle calls `unlock()` *before*
`setAppLockEnabled(true)`.

- **The grace period is the feature.** A lock that re-prompts on every app switch
  is the one people turn off, and a lock that's off protects nothing. Leaving
  starts a clock (`shouldLockOnResume`); only an expired one re-locks.
- **`prompting` is load-bearing.** iOS reports `inactive` while the unlock sheet
  is up. Counting that as leaving restarts the clock mid-prompt — and at a grace
  of 0, re-locks the moment you pass it, forever.
- **The gate is a `Modal`, not an overlay `View`.** Half the point of the shield
  over a backgrounded app is the app-switcher snapshot, and the user may have left
  with the task editor (itself a `Modal`) open — a sibling of the navigator renders
  *under* that.
- **No biometrics and no passcode enrolled fails open, out loud.** There is no
  second way in — no password, no account, no server — so the alternative is a
  task list nobody can ever open. It alerts rather than opening quietly, and
  leaves the setting on so it resumes when they re-enrol. The same reasoning is
  why turning the lock *on* authenticates first.
- **`resetToDefaults` doesn't touch it**, like vacation mode: "reset appearance and
  formatting" is not a request to take the lock off the app.

The **API key** is in the keychain (`expo-secure-store`), not the settings table.
It migrates itself on the first launch after the update, and the ordering is the
part to leave alone: the keychain copy is written *first*, and the plaintext row
deleted only once that write returns. A failure between the two leaves both, which
the next launch resolves; deleting first would destroy a credential the user
pasted in months ago. **There is no plaintext fallback** — a keychain that won't
take the key means it isn't persisted, not that it goes back in the database.
`secureApiKey.ts` `require`s the native module lazily rather than importing it,
because `useSettingsStore` reaches it and most of the suite reaches that store,
in a `node` environment where loading `expo-modules-core` throws on sight.

### Navigation

`src/navigation/AppNavigator.tsx` uses a bottom tab bar with 4 visible tabs (Today, Search, Projects, More). The remaining screens (Categories, Tags, Templates, Logbook, Stats, Archived) are registered as hidden tabs and reached via `SideMenuDrawer`, which overlays the full screen and is opened by tapping "More" or by edge-swipe from the left.

Today, Later, Unscheduled and Inbox are **not** separate screens — they're four `viewMode` sub-views of `TodayScreen`, switched by the pill row under its header, and they share one set of screen state (selection mode, expanded row, quick-add, editor). They're disjoint lenses over the same tasks (`isUnscheduledTask()` excludes inbox tasks, `isTaskVisible()` excludes both), each backed by its own store selector. Keep it that way when adding a fifth: Inbox used to be its own route, and every switch into it had to hand the destination over as a navigation param, which painted a frame of the *previous* sub-view before the param landed. A segmented control shouldn't navigate.

### Design system

`src/theme/index.ts` exports design tokens (`spacing`, `radius`, `font`, `fontWeight`, `border`, `iconSize`, `animation`, `interaction`) and two color palettes (`darkColors`, `lightColors`). Components consume colors via `useColors()` or `useTheme()` (which also exposes theme-aware `shadows`) from `src/theme/ThemeContext.tsx`. The top-level `colors` export is kept only for non-themed static uses.

**Never hardcode** hex/rgba colors, shadow styles, spring params, `activeOpacity`, or `delayLongPress`. The tokens to reach for:

- `colors.backdrop` — every modal/sheet dim layer
- `colors.blurFallback` — tint overlay behind `SafeBlurView` content
- `colors.onAccent` — text/icons on filled accent/green/red surfaces (always white, both themes)
- `colors.timeMorning/timeAfternoon/timeEvening` — time-of-day segment colors
- `interaction.activeOpacity` (0.7), `interaction.pressScale`, `interaction.delayLongPress` — press behavior
- `animation.spring.snappy/smooth/bouncy` and `animation.duration.*` — every Animated call
- `getShadows(isDark)` via `useTheme().shadows` (`card`, `fab`, `sheet`) — every shadow

**Never put `lineHeight` on a `TextInput` style.** RN maps it straight onto the iOS paragraph style's `minimumLineHeight`/`maximumLineHeight` with no compensating baseline offset (`RCTTextAttributes.mm`), so the glyphs are drawn a full line height below the top of the line box instead of one ascent below it — the text sits low in the field while the caret stays centered, and the placeholder inherits the same attributes so it looks wrong even when empty. `lineHeight` is fine (and wanted) on `Text`. When an input needs a specific box height to keep a row from resizing between display and edit mode, set `height`/`minHeight` instead.

**Shared primitives** (use these instead of hand-rolling):

- `ScreenHeader` (`src/components/ScreenHeader.tsx`) — every screen's large-title header: title, optional subtitle/overline, 34pt icon actions with badges/active tint/loading, or custom `right` content.
- `PressableScale` (`src/components/PressableScale.tsx`) — standard press feedback (spring scale + opacity dip) for buttons, chips, FABs, icon buttons. Full-width list rows keep `TouchableOpacity` with `interaction.activeOpacity` — scaling a full row looks wrong.
- `InlineAction` (`src/components/InlineAction.tsx`) — the small tinted pill that adds a thing to the
  list or grid it sits under: "New task", "Add subtask", "Add tag", "New" in a category picker. It
  replaced the bare accent-coloured text these all used to be, which had drifted into three
  treatments for the same action (bare, dashed-bordered, filled) across five duplicate style
  objects. Accent text was also doing three unrelated jobs at once — *this is a link* / *this is a
  button* / *this is the selected value* — so a card holding two of them read as a stack of links
  floating under the content. **Bare accent text is now only for sheet header buttons (Cancel /
  Save / Done) and the current-value summaries in `EditorRow` / `CollapsibleField`**; an action gets
  a shape. Use `variant="neutral"` for the quieter half of a pair ("Add existing" beside "New
  task"), and — this is the non-obvious one — for an add button sitting at the end of a row of
  *already tinted* chips. Tag chips tint themselves `tagColor(tag) + '33'` and `tagPalette[0]` is
  the accent blue, so an accent pill there reads as one more tag rather than as a control.
- `SheetHeaderButton` (`src/components/SheetHeaderButton.tsx`) — the Cancel / Save / Done / Add text
  button in a sheet header, the second and last home of bare accent text. `role="confirm"` (the
  default) is semibold, `role="cancel"` is regular — weight ranks them, the way iOS ranks nav-bar
  buttons, and **both are accent**: two of the twelve hand-rolled copies this replaced had drifted
  to a grey Cancel. `minWidth` reserves matching width on the light side so the title stays
  optically centered.
- `disclosureValue(colors)` (`src/theme/textStyles.ts`) — the right-aligned "currently set to" text
  in `EditorRow`, `CollapsibleField` and the Settings rows. Spread it and add layout on top. It's a
  shared style rather than four local ones because it had been written as `value` / `summary` /
  `rowValue` / `anchorValue` in three sizes and two weights, which is most of why a value and a
  button were hard to tell apart.
- `CountStepper` (`src/components/CountStepper.tsx`) — the `− value +` control for a small integer
  (Daily target, in both the editor and quick add; a project's nudge cadence). Reach for it instead of a row of preset chips
  whenever the value is an open-ended number: chips have to pick a granularity *and* a ceiling for
  everyone, and Daily target's ([2..6, 8, 10, 12]) made 7 unsayable and 20 unreachable. `allowNull`
  lets − at the floor clear the value, which is how the editor offers "not a quota" without the
  row's × being the only way out. Holding a key repeats after a pause; the arithmetic and the ramp
  are in `src/utils/stepper.ts` (tested), the press handling in the component. When the number needs
  a unit, pair it with a row of unit pills rather than multiplying the presets out — the nudge
  cadence stores days and converts in `src/utils/nudgeCadence.ts`, so switching Weeks→Months keeps
  the count and only the stored day total changes.
- `EmptyState` (`src/components/EmptyState.tsx`) — every empty list: tinted icon circle + title + subtitle + optional CTA, animates in on mount.
- `PinIcon` (`src/components/PinIcon.tsx`) — the pin glyph everywhere pinning is shown or toggled
  (task row, bulk bar, editor's Pin row, category pin-all, Pinned Tasks header),
  and the **one** icon in the app that isn't an Ionicons name. Ionicons has no thumbtack: its `pin`
  is a *map* pin — thin needle, round head — which reads as a location rather than "hold this at
  the top" and goes wispy at `iconSize.sm`. So it's drawn, as two `react-native-svg` paths on the
  same 24-unit grid the Ionicons use, and takes `size` from `iconSize` like they do. Keep the
  stroke at 1.8 grid units — heavier closes up the outline's counter at the 13pt the Pinned Tasks
  header uses. `react-native-svg` is in the tree for this and is autolinked (no config plugin, but
  it *is* a native module, so it needs a fresh build, not just a JS reload). The app's *other*
  `pin-outline` — the "Count days from" anchor row in `TemplateItemEditor` — is a map pin on
  purpose and stays Ionicons.
- `CollapsibleField` (`src/components/CollapsibleField.tsx`) — a picker section inside an editor card. Collapsed it is `LABEL … value ⌄`; expanded it shows a one-line `hint` explaining the field, then the pills. **Every editor picker (category, project, tags, priority, effort, …) uses this** — see the progressive disclosure note below.
- `EditorRow` (`src/components/EditorRow.tsx`) — the `icon — label — value ›` row every editor sheet is built from (Date, Deadline, Remind me, Link, …). Pass `expanded` for rows whose controls unfold in place rather than opening a picker, and the chevron becomes up/down.
- **Filtering by an open-ended set of options (tags, categories) is a bottom sheet with wrapping chips, never a horizontal scrolling chip row.** `LogbookFilterSheet` and `RecipeTagFilterSheet` are the two instances — both replaced a scroll row that had shipped first. A scroll row hides every option past what fits on screen behind a swipe nobody is prompted to make, and a vocabulary the user builds themselves (tags especially) has no ceiling a phone-width row can assume; wrapping puts the whole set on screen at once. The screen itself keeps only a small trigger row: a "Filter"/"Tags" button that opens the sheet, plus whatever's *currently selected* as removable pills (`ActiveFilterPill` in `LogbookScreen`, the `activePill` styles in `RecipesScreen`) — that set stays small by construction, so a scrolling row is still the right shape for it. Don't reach for a horizontal `ScrollView` of chips as the *filter control itself* again; that's the mistake both of these fixed.
- `PaintSelectionProvider` (`src/components/PaintSelection.tsx`) — wraps a task list so that, while bulk selecting, a drag down the checkbox column "paints" a run of rows instead of needing a tap each. Screens get it by spreading `paintProps` from `useTaskSelection` and passing `scrollEnabled={!painting}` to the list; rows register themselves from inside `TaskItem`, so nothing else has to change. The touch is claimed **on touch-down in the capture phase** within `PAINT_GUTTER_WIDTH` of the leading edge — a native scroll can't be taken back once it starts dragging, so deciding later would let the list scroll out from under the paint. That's why a drag started right on the checkboxes can't scroll (the deliberate trade), and why every other pixel of the row scrolls exactly as before. Hit-testing math and its tests live in `src/utils/paintSelect.ts` / `paintSelect.test.ts`.
- `src/utils/haptics.ts` — semantic haptics (`tap`, `success`, `warning`, `error`, `impactLight/Medium/Heavy`). Never import `expo-haptics` directly; pick by meaning so intensities stay consistent.
- `src/utils/layoutAnimation.ts` — `animateLayout()` immediately before a state change that inserts/removes list rows (complete, delete, add, selection-mode toggle). **Never call it on a drag-reorder commit path** (`ReorderableList.onReorder`, `DraggableFlatList.onDragEnd`) — those drive their own row animations.
- **Accessibility on icon-only controls isn't a missing primitive, it's an adoption gap** — `PressableScale` already supplies `accessibilityRole="button"`, and every icon-only `TouchableOpacity` (drag handles, delete X's, calendar day cells, month-nav chevrons) needs an explicit `accessibilityLabel` alongside it, following `TaskItem`'s style (e.g. `` `Reorder subtask ${sub.title}` ``). Hand-rolled on/off controls (a `View` toggle knob inside a `Touchable`, not a real `Switch`) need `accessibilityRole="switch"` + `accessibilityState={{ checked }}` too — see the vacation-pause and archive toggles in `TaskEditor`/`ProjectEditor`.

**Editors are progressive disclosure.** `TaskEditor`, `TemplateItemEditor`, `TaskGroupEditor`, `ProjectEditor` and `TemplateEditor` all follow the same shape: title/notes, then cards under uppercase `groupLabel` headers (Schedule → Organize → Priority & effort → Subtasks → More), rarely-changed rows last. Nothing renders its picker expanded by default — every pill grid lives inside a `CollapsibleField` that shows only its current value until tapped, and picking a single-choice value collapses the section again (`closeField`). Inline controls hung off an `EditorRow` (time-of-day pills, time window, link picker) render only while that row is expanded. When adding a field, give it a `hint` that says what it does in one line: that hint is the only in-app documentation these options have.

**List rows** use the iOS inset-grouped card treatment app-wide — match the styling in `TaskItem.itemWrapper` (Search/Logbook/Tags/Categories/Projects rows follow the same pattern). Section headers are uppercase `font.xs` semibold `textTertiary` with `letterSpacing: 0.8`. The one row that is deliberately *not* a card is `TaskGroupHeader` — a stack heads its tasks rather than sitting among them, so it's a transparent caption (see the note on its `band` style; every filled-card version of it read as a *selected* row, because a brighter card surface is what this app uses for pressed and dragged). What ties it to its tasks is enclosure, not resemblance: `TaskGroupTray` puts the header and the child cards in one `bgSunken` region, and the children drop their own margins to sit on its padding. Grouping a header with its rows by giving the header a card-like treatment is the move that keeps failing here — reach for the region instead.

### Drag and drop — handle with care

`src/components/ReorderableList.tsx` (+ math in `src/utils/reorder.ts`, tests in `reorder.test.ts`) uses JS-driven row animations and a floating drag overlay by deliberate design — see the comments in that file before changing render order, the animation driver, or the PanResponder lifecycle. Safe to touch: overlay styling, autoscroll params, durations, and haptics via `onHoverChange`.

`src/components/SortableList.tsx` — the nested list (a stack's children on Today, subtasks, chain steps) — is now **the same design and shares the same math**: rows render in their original order and are displaced by an `Animated` `translateY`, the dragged row becomes an invisible placeholder carrying the drop slot, and a finger-anchored card floats above. Same rule: styling, durations and haptics are safe; render order, the animation driver and the responder lifecycle are not. It used to re-render the rows in swapped order on every hover change instead, which is what made a drag inside a stack snap rather than animate. Two things are deliberately not copied over, because it doesn't own a scroll view: there is no autoscroll and no `measureLayout` calibration (its rows are direct children, so `onLayout`'s `y` *is* the card's anchor), and the card is clamped to the first/last row's slot **unless** the caller passes `onDragOut` — every other caller sits inside a rounded `overflow: hidden` card that would slice the card at the edge. The one caller that does pass it (Today) instead unclips its container for the duration, via `TaskGroupBody`'s `dragging` → `AnimatedCollapsible`'s `clip`.

**A `SortableList` rendered inside a scrollable must turn that scrollable off for the duration of a drag** — pass `onDragStateChange` and wire it to the container's `scrollEnabled` (see `TaskGroupEditor`, or `draggingStackChild` in `TodayScreen`). Without it the drag doesn't happen at all: a native scroll view only stands down for a JS responder that is one of its **ancestors** (`_shouldDisableScrollInteraction` walks `superview`, not the subtree), and `SortableList`'s responder is a descendant — so the scroll claims the touch on the first finger move and the row is put straight back down. `ReorderableList` is immune because it owns the scroll view it drags inside of and sets `scrollEnabled` itself. The inline subtask list in `TaskItem` can't reach its own container, so it re-exposes the flag as the `onSubtaskDragStateChange` prop — **every screen rendering a `TaskItem` has to pass it** (a `useState` setter, so the row's memo still holds) and add it to its list's `scrollEnabled`, or subtask drag is silently dead on that screen.

Both lists fire the drag-lift haptic themselves (`startDrag`), so callers must not add their own.

**Today's category headers are not draggable, and that isn't an oversight.** Reordering the
sections used to be a long-press on a header inside the task list, and the floating card never
lined up with the finger holding it: the drag had to auto-collapse every other section first
(the headers being reordered are scattered down a list of tasks, so they don't otherwise fit on
screen together), and `calibrateOverlayBase` was measuring a row the collapse was still moving.
It's now `CategoryOrderSheet`, off the Today screen's "…" menu — one row per category, moved a
step at a time (`src/utils/categoryOrder.ts`), which needs no measurement and shows the whole
order at once. Don't put the gesture back; `resolveCategoryReorder`/`categoryHeaderRange` were
deleted with it. Task drag on that list is untouched and still goes through `resolveDrop`.

### Database schema / migrations

`initDatabase()` in `src/db/database.ts` creates tables and runs a list of `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch — they fail silently if the column already exists. When adding a new column, append it to the migrations array rather than modifying the `CREATE TABLE` statement.

Tags and categories are stored as JSON arrays in each task row (`tags TEXT`, `category TEXT`). Tags are additionally tracked in a `tag_registry` key in the `settings` table, so a tag that exists but is currently unused doesn't disappear. Categories used to work the same way, but now live in their own `categories` table (they carry schedule/vacation fields a string list can't hold) — the `category_registry` setting is legacy, read only by the one-time migration in `initDatabase()` that backfills that table.

### iOS native extension targets (widgets, and future Watch/Live Activity targets)

The Today widget (`targets/todo-widget/`) is injected at prebuild time by custom config plugins rather than a checked-in `ios/` folder — `plugins/withAppGroup.js` (App Group entitlement on the main app) and `plugins/withWidgetExtension.js` (the WidgetKit extension as a whole new Xcode target, built via the raw `xcode` npm package).

**Before adding or changing a native target — Watch app, Live Activity, share extension — read `docs/native-targets.md`.** It lists the six non-obvious requirements this one cost a build cycle each to discover (the EAS `appExtensions` declaration, `TargetAttributes` signing, two outright bugs in the `xcode` package, Info.plist placeholder keys, the bridge module's podspec, the App Group path convention). Nothing else in the repo will tell you about them, and each one fails late — at archive or at submission, not at build.

Two fixes that look unrelated to the widget but are load-bearing for *any* second native target existing at all — don't revert them as dead code:
- `enableScreens(false)` near the top of `App.tsx` — works around a `react-native-screens` crash (`RNSTabBarController`) that only reproduces in production builds once the app has more than one native target to build/sign.
- `ios.buildReactNativeFromSource: true` in the `expo-build-properties` plugin config (`app.json`), plus `patches/react-native+0.81.4.patch` (applied via `patch-package` on `postinstall`) — RN 0.81 downloads a prebuilt Core binary by default, which bypasses the patch entirely; the patch itself fixes an RN bug where an `NSException` thrown inside a native module call gets rethrown across a dispatch-queue boundary instead of converted to a JS error, crashing the app. Both were required together — the patch alone has zero effect without also forcing a from-source build.

`enableScreens(false)` has a side effect worth knowing before reaching for `freezeOnBlur` on a tab screen: it forces `@react-navigation`'s `ScreenFallback` → `ResourceSavingView` path instead of the native `react-native-screens` implementation, and `ResourceSavingView` never forwards `freezeOnBlur` — it only moves blurred children `FAR_FAR_AWAY`. So a blurred tab screen stays mounted and keeps re-rendering on every store change; `freezeOnBlur` is inert in this app, and there's no escape hatch for it while `enableScreens` stays off.

That `FAR_FAR_AWAY` is `top: 30000`, which is also why **`automaticallyAdjustKeyboardInsets` must never be
passed bare** — use `useKeyboardInsetScroll` (`src/hooks/`), which is already wired into `ReorderableList`
and every screen-level `FlatList` that had it. RN registers a keyboard listener on *every* mounted
`RCTScrollView` and gates it on that prop alone, then sizes the inset from the scroll view's position in the
window — so a blurred tab parked at y=30000 picks up a ~30,000pt bottom `contentInset`, and the keyboard
*hiding* recomputes the same 30,000 rather than clearing it. Switch to that tab and there's a screenful of
content above thirty thousand points of nothing. The hook passes the screen's own focus state, so a
backgrounded list doesn't listen. It also re-clamps on `keyboardDidHide`, because shrinking an inset never
re-clamps `contentOffset` (RN's own `scrollToOffset:` call short-circuits when the offset didn't change) —
a list left resting inside an inset that goes away has no scroll range left to get back up. Same failure
mode as the content-shrink clamp in `ReorderableList.onContentSizeChange`; math and tests in
`src/utils/scrollClamp.ts`.

**That clamp is judged against the inset the list still has, never against the bare content height.**
Focus-gating the prop means a list blurred while the keyboard was up never hears the dismissal and keeps
its inset for good — and resting inside a live inset is where iOS *put* the list, not a strand. Compared
against content alone, every rubber-band at the end of such a list settled "past" its content and got
yanked up by the width of the inset the moment the bounce finished, which reads as layout shift. So the
settled-scroll clamp passes the inset from the scroll event and the `keyboardDidHide` one passes 0 (the
inset is what just went away) — that asymmetry is the whole design, don't collapse it to one value.

## Key conventions

- **Path alias**: `@/` maps to `src/` (configured in `tsconfig.json` and `package.json` Jest `moduleNameMapper`).
- **IDs**: generated with `src/utils/id.ts` (`generateId()`), not UUIDs.
- **Dates**: always stored and passed as ISO strings; `date-fns` is used for all date arithmetic.
- **Booleans in SQLite**: stored as `0`/`1` integers, converted in `rowToTask()`.
- **JSON fields in SQLite**: `tags`, `recurrenceDays`, `chainItems` (stored in the `cycle_items` column — see Chains above), `timeSegments` are JSON-stringified arrays. `timeSegments` has a legacy code path in `parseTimeSegments()` that handles a plain string (old format).
- **Subtasks**: tasks with `parentId !== null`. Most store selectors filter with `!t.parentId` to exclude them from top-level lists.
- **Patch notes**: when a change in this PR is user-facing, add a new fragment file to `src/patchNotes/entries/` before opening the PR — one JSON file per entry, `{ "message": "...", "date": "YYYY-MM-DD" }`, named after the change (e.g. `icon-action-buttons.json`). Keep the message short and written for someone who isn't reading the diff. Don't edit `src/utils/patchNotes.ts` or `src/utils/patchNotesData.ts` directly (generated, gitignored). Skip it for internal-only changes (refactors, tests, CI, tooling).
