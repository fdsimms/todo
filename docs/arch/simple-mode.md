# Simplified mode

One switch (`simpleMode`, Settings → Tasks & projects → Feature areas) that takes the app down to
an ordinary todo/kitchen app by hiding about thirty capabilities at once.

The registry is `src/utils/simpleMode.ts`; the tests that hold it to its promises are
`src/__tests__/simpleMode.test.ts`. Read the module's own doc comment first — this file is the
reasoning, that one is the contract.

## Why a switch rather than thirty

The app accumulated chains, quotas, timed tasks, blockers, extra tasks, deliverables, series,
stacks, focus sessions, drift, backfill, look-ahead, deload, barcode scanning, receipt import,
product variants, either/or items, standing swaps, composed recipes, scaling and cook mode. Each
earns its place for whoever uses it. Each costs everybody else a row in a picker, an icon in a
header, or a line in a menu, and none of them is discoverable enough to be worth that cost to
someone who wants a list of things to do.

`hideHelpText` and `simpleTaskForm` were the first two answers to this and they are both still
right, but neither removes a capability: one hides explanations, the other decides which surviving
rows start on show. This is the third and bluntest, and it composes with both rather than
replacing them.

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

- **Lenses** (Calendar, Stats, Backfill, Waiting, Drift) go unconditionally. Every task they show
  is reachable from Today or Search, so hiding them costs nothing however much data exists.
- **Content screens** (Stacks, Templates) hold objects that live nowhere else. Hiding one while
  the user has some would strand real data, so each survives for exactly as long as it holds
  anything. An install with no stacks and no templates loses both rows.

`SIMPLE_HIDDEN_SCREENS` and `SIMPLE_CONTENT_SCREENS` are derived from the catalog's own `screen` /
`contentScreen` fields rather than written out again, so a screen feature cannot be listed in
Settings and then not gated.

**The navigator's restore guard asks the same question with the same counts.** `initialScreenFromSettings`
can read the stack and template stores directly: `useTaskStore.initialize()` fans out to both, and
`AppGate` runs it and blocks on it before `AppRoot` and the navigator mount at all. Reopening onto a
screen the menu no longer lists is the failure the `kitchenEnabled` guard beside it already exists to
prevent.

Pantry isn't a `screenShown` case, because it was never a menu row: its only route in is the hub pill
row, so it gets its own line in that guard.

## The lens pills stay

Today's Later and Inbox pills are never dropped, whatever the mode. Each is the only route to a set
of real tasks, and a lens that hides tasks is a leak rather than a simplification. Only Unscheduled
goes, and only while it is empty and isn't the view you are standing on: a task with no date signal
at all is one simplified mode doesn't produce (the default `newTaskDefaults.destination` is
`today`), so on a fresh install the pill is simply never there.

The count behind that runs only while the mode is on, so nobody else pays for the pass over every
task.

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
- **`aiFeatureConfig`, and every setting for a hidden feature.** Hidden, never rewritten, so the
  whole thing comes back as it was.

## Tips

`src/utils/tips.ts` is the app's documentation of its own capabilities, so it has to move with
this. A tip exists because someone can't see a control; a tip about a control that isn't there is
the one thing that file can't afford to be. Each affected tip carries a `feature`, and `tipsFor`
drops it, exactly the way `SettingsEntry.simple` drops a settings row.

Thirty of the seventy tips go. The kitchen area empties completely and that is correct: all six of
its tips are about the Pantry screen, which also goes, and `TipsScreen` drops a section with no
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
