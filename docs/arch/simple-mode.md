# Simplified mode

One switch (`simpleMode`, Settings → Feature areas) that takes the app down to
an ordinary todo/kitchen app by hiding a few dozen capabilities at once (`SIMPLE_FEATURES` is the
list).

The registry is `src/utils/simpleMode.ts`; the tests that hold it to its promises are
`src/__tests__/simpleMode.test.ts`. Read the module's own doc comment first — this file is the
reasoning, that one is the contract.

## Why a switch rather than dozens

The app accumulated chains, quotas, timed tasks, blockers, follow-up tasks, deliverables, series,
stacks, focus sessions, drift, backfill, look-ahead, deload, barcode scanning, receipt import,
product variants, either/or items, standing swaps, composed recipes, scaling and cook mode. Each
earns its place for whoever uses it. Each costs everybody else a row in a picker, an icon in a
header, or a line in a menu, and none of them is discoverable enough to be worth that cost to
someone who wants a list of things to do.

It composes with `hideHelpText` (hides explanations) and `simpleTaskForm` (decides which rows
start on show), neither of which removes a capability.

## The two rules

1. **It changes what is rendered, never what is stored.** No field is cleared, no row deleted, no
   default changed. `useSettingsStore.test.ts` asserts that flipping it writes exactly one setting:
   itself.
2. **A feature already in use stays on show.** Every gate takes a `set` argument. A chain task
   keeps its chain; a grocery item that already tracks three brands keeps the field listing them.

Rule 2 is what makes rule 1 worth anything. Without it, "nothing is deleted" would be true and
useless, because the data would be sitting behind a switch with no way to see it was there.

The editor gets rule 2 for free, and that is why the whole task editor's gating is one filter in
`EditorGroup`: an `EditorGroupRow` already declares `set`, so `kind` reporting `set: kind !== 'task'`
is exactly "this task has a shape, keep the picker". Twenty-three rows of JSX needed no condition
at all. `GroceryItemSheet` does the same with its `collapsibleRows`, computing `set` per key
because those rows don't declare one.

## Screens split two ways

The one non-obvious decision. `screenShown` treats two kinds of screen differently:

- **Lenses** (`SIMPLE_HIDDEN_SCREENS`: Calendar, Stats, Stuck and the like) go unconditionally.
  Every task they show is reachable from Today or Search, so hiding them costs nothing however
  much data exists.
- **Content screens** (`SIMPLE_CONTENT_SCREENS`: Stacks, Templates, People, Mood, Medications, Food
  log) hold objects that live nowhere else. Hiding one while the user has some would strand real
  data, so each survives for exactly as long as it holds anything (`screenShown`'s
  `contentCounts`).

`SIMPLE_HIDDEN_SCREENS` and `SIMPLE_CONTENT_SCREENS` are derived from the catalog's own `screen` /
`contentScreen` fields rather than written out again, so a screen feature cannot be listed in
Settings and then not gated.

**The navigator's restore guard asks the same question with the same counts.** `initialScreenFromSettings`
can read the content stores directly: `useTaskStore.initialize()` fans out to them, and
`AppGate` runs it and blocks on it before `AppRoot` and the navigator mount at all. Reopening onto a
screen the menu no longer lists is the failure the `kitchenEnabled` guard beside it already exists to
prevent.

Pantry is a member of a hub rather than a menu row, so it is hidden through its feature's `screen:
'Kitchen'` like any other, and the same gate answers for the pill and the restore.

## The lens pills stay

Today's Later and Inbox pills are never dropped, whatever the mode. Each is the only route to a set
of real tasks, and a lens that hides tasks is a leak rather than a simplification. Only Unscheduled
goes, and only while it is empty and isn't the view you are standing on: a task with no date signal
at all is one simplified mode doesn't produce (the default `newTaskDefaults.destination` is
`today`), so on a fresh install the pill is simply never there.

The count behind that runs only while the mode is on, so nobody else pays for the pass over every
task.

## The add button offers what is left

Today's add button is a menu (`AddTaskFab`'s `ITEMS`) and so is a project's (`ADD_MENU_ITEMS` in
`ProjectDetailScreen`). An item that starts a capability the mode hides is listed in
`SIMPLE_ADD_MENU_FEATURES`, and `addMenuItemShown` filters it out, so Today's button is left
holding Task alone. `FabMenu` performs a lone item on the tap rather than accordioning out to offer
it, so the button becomes a plain "open quick add" without either caller branching on the count.

`SIMPLE_ADD_MENU_FEATURES` is a third row map beside the editor's and the grocery sheet's, and the
difference between it and those two is that it takes no `set`. A row in an editor is looking at a
task that either uses the feature or doesn't; a menu item is a blank offer to start a new one, and a
new one is never already in use. So this is the "only *starting* a new one goes" rule below rather
than rule 2: an install with stacks keeps the Stacks screen that edits them, and loses the button
that makes another.

## Two things deliberately outlive the switch

A running focus session keeps the header action that opens it, and a running shopping trip keeps
its banner and the way to finish it. Both can be started before the switch is flipped, and a mode
change that stranded one would leave the user with state they cannot get back to. Only *starting* a
new one goes. Same call `AppNavigator` already makes about the recipe-timer dot and `kitchenEnabled`.

## What it deliberately does not touch

- **The sort and filter sheet's effort chips.** Filtering by a value a task already carries is
  rule 2, not a creation surface. The quick-add *chip* that sets effort is gated; the filter that
  reads it isn't.
- **Priority, tags, categories, projects, subtasks, reminders, repeat, notes.** These are the
  ordinary form, and an app without them isn't a simpler todo app, it's a worse one.
- **The grocery list, catalog, aisles, recipes and the meal plan.** Simplified mode takes the
  machinery underneath the kitchen, not the kitchen.
- **Searching a food by name, and the two settings it needs.** Barcode scanning goes, but the
  food database search (a grocery item's Nutrition, the food log) stays, so the "Look up food
  databases" switch and the FoodData Central key stay in Settings too. A failed search's "Open
  Settings" lands on the key row, and a row simplified mode had hidden left it landing on nothing.
  The Go-UPC key and "Forget saved barcodes" only serve the scanner, so they are still `simple`.
- **`aiFeatureConfig`, and every setting for a hidden feature.** Hidden, never rewritten, so the
  whole thing comes back as it was.

## Tips

`src/utils/tips.ts` is the app's documentation of its own capabilities, so it has to move with
this. A tip exists because someone can't see a control; a tip about a control that isn't there is
the one thing that file can't afford to be. Each affected tip carries a `feature`, and `tipsFor`
drops it, exactly the way `SettingsEntry.simple` drops a settings row.

A large share of the tips go (every tip with a `feature`). The kitchen area empties completely and
that is correct: its tips are about the Pantry screen, which also goes, and `TipsScreen` drops a section with no
tips in it rather than leaving an empty heading. Every read of the whole set goes through `tipsFor`
(the screen's list and unread count, the drawer's badge, `TipHost`'s candidates), so a count can
never name tips the list behind it doesn't show.

"Mark all read" marks what is on screen rather than what exists, so a hidden tip stays unread and
comes back with its feature. That is rule 1 again: hidden, never rewritten.

## Adding a feature to it

1. Add an id to `SimpleFeatureId` and an entry to `SIMPLE_FEATURES`, with the label written the way
   a user would name the thing (Settings renders these verbatim).
2. Write the gate: a `featureShown`/`featureHidden` call, an entry in one of the two row maps, or a
   `screen` on the feature itself.
3. If it has a Settings row, flag that entry `simple: true` in `settingsIndex.ts` and gate the JSX
   that renders it. Search must not turn up a row that isn't rendered.
4. If a tip documents it, set that tip's `feature`. The app must not teach a control it isn't
   showing.

`simpleMode.test.ts` fails if step 2 is skipped: a feature listed under "what simplified mode hides"
and gated nowhere is a promise the app doesn't keep.
