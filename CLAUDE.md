# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PR workflow

Once a change is complete and verified (`npx tsc --noEmit && npm test` green, feature manually
exercised where applicable), open a PR automatically — don't wait to be asked. Skip only when
there's a concrete reason (work is incomplete, checks are red, or the user said to hold off);
say why instead of opening one silently.

Don't subscribe to PR activity and don't schedule follow-up check-ins after opening a PR unless
the user explicitly asks for that. Just open the PR and stop.

## Bugs found in passing

If you notice a real bug while working on something else — not a style nit, an actual wrong
behavior — and the fix is small (a couple of lines, one clear place, no design judgment call),
just fix it in the same PR rather than only mentioning it. "Stay in scope" (below) is about not
redesigning adjacent code that merely looks improvable; it was never a reason to leave a
confirmed bug for someone else to hit. Note the fix in the PR description so it doesn't get
buried in the diff.

The line is size and confidence, not "did the user ask for this exact thing." A fix that touches
one function and has an obvious right answer: fix it. Anything that needs a design decision,
touches several files, or you're not sure is actually wrong: say so instead of guessing — the
same as any other judgment call in this file.

**"Say so" means ask, not just mention.** A note buried in a PR description or a closing summary
is easy to skim past, and it leaves the bug unfixed with nobody having actually decided that's
fine. When you find one of these mid-task, stop and ask — `AskUserQuestion` if the harness has
it, a plain question in chat otherwise — with the options you'd otherwise have listed unasked.
Don't file it away as a "worth flagging" aside and move on; get a decision and act on it (fix it,
open an issue, or leave it, whichever they pick) before you finish the task it turned up in.

## Similar components found in passing

If a fix or a bit of polish applies to one component and you notice a near-identical sibling has
the same issue — same copy-pasted structure, same missing treatment, same bug — don't leave it
alone just because the user only pointed at the first one. Ask whether to apply it to the others
too, the same "stop and ask, don't just mention" duty as "Bugs found in passing" above, and expect
the answer to usually be yes: a request framed around one instance of a pattern is rarely a
request to leave the rest inconsistent, it's just that the user only noticed (or only ran into)
the one. Raise it as soon as you spot it — `AskUserQuestion` if the harness has it, a plain
question in chat otherwise — rather than filing it away in a PR description as a "happy to also do
the others" aside. This app already has a name for the failure mode a hand-rolled copy invites
(the drift `SheetHeaderButton`, `InlineAction`, and this note's own siblings were created to undo);
leaving three near-identical components unfixed because only the fourth was named is how that
drift starts.

This is distinct from "Stay in scope" below, which is about *unrelated* adjacent code that merely
looks improvable — a different concern living near the one you were asked about. This is the same
concern, in a component that shares the original's code shape closely enough that the fix is the
same mechanical change applied again, not a fresh design judgment call.

## Follow-up and out-of-scope work

A PR description is not read again after it's opened. Don't rely on a "What's left" section, a
closing summary, or a note buried in the diff to carry information forward — that's writing for
an audience that isn't there. Anything worth remembering once the PR merges has to actually exist
as a thing, not as a sentence: either fixed now, or filed as a real GitHub issue (apply the four
labels from the scheme below same as any other issue).

**Never file an issue without asking first,** unless you explicitly ask and the user says yes (or
gives a direct request like "File this" or "Create an issue about X"). Filing is a decision, same
as fixing is, and it's the user's to make — issues pile up unread otherwise, and "I filed it so
it's handled" is exactly the false comfort this rule exists to prevent. This holds even when filing
feels like the obviously right call, and even for a follow-up you noticed yourself rather than one
the user raised. When they ask directly, just create it and use reasonable defaults for the four
labels (enhancement / area:app-wide / model:haiku / effort:low) unless they specify otherwise.

When finishing a task turns up adjacent work you've decided not to do — a related surface, a
follow-up feature, a design question you scoped out, a sharp edge you noticed along the way —
don't narrate that decision in the PR body and move on, and don't silently open an issue for it
either. Before you call the task done: stop and ask — `AskUserQuestion` if the harness has it, a
plain question in chat otherwise — with fix it now / file an issue / leave it as the options, the
same "stop and ask, don't just mention" duty as "Bugs found in passing" above. A PR body can
reference the issue number for context once one exists, but the issue is what persists; the
paragraph explaining your reasoning isn't. Do this for every scope decision the task surfaced, not
just the one you'd think to mention — if a "What's left" list would otherwise have three items,
that's three questions, not three bullet points or three issues filed on your own judgment.

This is "Bugs found in passing" above, generalized past bugs specifically: the thing that must not
happen is a decision (fix it / file it / leave it) made unilaterally, or left sitting only in prose
that nobody is going to reread.

## User-facing copy

Say what a setting does in plain, literal terms — the way the rest of the app already talks
(see any existing row label/subtitle for the tone to match). No jokey metaphors, no cutesy
voice, no invented figures of speech ("how much rope", "offers you a way out", "speaks up").
If a label or subtitle reads like it's trying to be charming or funny, rewrite it to just state
the mechanism. Example: "After this many pushes" / "How much rope a task gets before the picker
offers you a way out" should instead be something like "Reschedule threshold" /
"Show the suggestion after moving a task this many times." This applies to settings rows,
empty states, hints, alerts, and patch notes alike.

**A placeholder that gives an example starts with "e.g.".** Placeholder text is `textTertiary`,
which is also the hint colour, so a bare example sitting in a field reads as a value already
saved — "margaritas, dusting…", "Low fat, 4%, crunchy…" and "Pepper, Cheese…" all did, and #1613
was someone looking at a form they thought they'd already filled in. A trailing "…" doesn't fix
it; the two characters at the *front* do, because that's where the eye lands. A placeholder that
merely names the field ("Recipe name", "Add an ingredient", "Search recipes") needs nothing —
it can't be mistaken for a value because it isn't one.

**And say what a field means where the field is, not in terms of the data model.** "Alternative
for" over a text box holding a *grouping key* was unanswerable without knowing that the first
option of a pair has to be filed as an alternative for itself. If a label only makes sense once
you've read the type, it's the wrong label — name the state the user is choosing between
("Always needed" / "One of a choice") and let the control carry the mechanism.

**American English, not British.** Britishisms had crept into copy across the app — "tick"/
"ticked" instead of "check off"/"checked", "trolley" instead of "cart", "Practise" instead of
"Practice", "autumn" instead of "fall", "fortnight" instead of "two weeks" — cleaned up in
#1635. Anything a user sees (UI text, hints, accessibility labels, alerts, patch notes,
demo-mode content) should read in American English; if you're not sure which side of the
Atlantic a word or spelling falls on, check before using it. This is scoped to user-facing
text only — the codebase's comments and test descriptions have long used British spelling and
phrasing (colour, behaviour, labelled, organised, and so on) as their own established internal
style, and that's a separate, deliberate thing; don't go rewrite comments to "fix" this.

**No em dashes.** A sentence held together by an em dash reads as machine-written, and they had
spread through UI copy, patch notes and PR descriptions alike. Use the punctuation the sentence
actually wants: a period when it's two thoughts, a colon when the second half explains the first,
a comma or "so"/"because" when it's one clause leaning on another, parentheses for a genuine
aside. If none of those fit, the sentence is doing too much and wants splitting. Applies to
everything a person reads outside the code: UI text, hints, accessibility labels, alerts, empty
states, placeholders, patch notes, demo-mode content, commit messages, PR descriptions and issue
bodies. Not scoped to the codebase's own comments, which use them heavily as their established
internal style, same carve-out as British spelling above; don't go rewrite comments to "fix" this.


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
npx tsc --noEmit     # typecheck; ~4s warm, ~20s the first time in a fresh checkout
npm test             # the whole suite, about half a minute — just run all of it
npm run test:watch   # watch mode
npx jest src/__tests__/dateUtils.test.ts  # single file, if you want the shorter output
node scripts/build-module-map.js   # regenerate docs/module-map.md, then commit it
node scripts/check-doc-stats.js    # regenerate the repo-stats block in CLAUDE.md, then commit it
```

**The verification loop is:**

```bash
npx tsc --noEmit && npm test && node scripts/build-module-map.js && node scripts/check-doc-stats.js && git status --short
```

Under a minute together, and `tsc` is incremental (`.tsbuildinfo`, gitignored) so every run after
the first is a few seconds. There's no reason to skip any of it or to narrow to a single test
file. All of it is green on `main`; if anything is red, it's you. Don't run `npx expo export`
locally to check your work — it's the slowest thing CI does and only catches bundle-time breakage
(a bad import path, a missing asset, a native config change), so run it only when you changed one
of those. **CI runs `npx tsc --noEmit`, `npm test`, both doc checks in `--check` mode, and
`npx expo export --platform ios` on every PR, and on every push to `main`** — that whole list,
not just the tests.

**The two generated docs are the single most common reason a PR goes red, and the failure is
entirely avoidable.** `docs/module-map.md` and the `repo-stats` block in this file are generated
from the tree and committed, and CI re-runs their generators with `--check` and fails if the
committed copy differs. They are not optional bookkeeping and not a separate chore: **regenerating
them and committing the result is part of finishing the change, in the same commit.** Concretely:

- **Adding, removing, or renaming any top-level `export` in `src/utils`, `src/store`, `src/hooks`,
  `src/db` or `src/services` changes `docs/module-map.md`.** That's most PRs in this repo. A new
  helper in an existing file counts; so does deleting a dead one. Components and screens don't
  (the map deliberately skips them).
- **Adding a file to `src/`, or pushing one across 1,000 lines, changes the `repo-stats` block.**
  A new test file moves the suite count, which is why a pure test-only PR can still fail this.
- **Stage a brand-new file before regenerating.** `build-module-map.js` enumerates through
  `git ls-files`, so a module you just created is invisible to it until it's tracked: regenerate
  first and the map comes out missing that file's line, `git status` looks clean because the map
  matches what you generated, and CI fails on a file you did add. `git add -A` and *then*
  regenerate, or regenerate a second time after staging.
- **Run the generators (no `--check`) rather than trying to predict whether you're affected.**
  Both are idempotent and take milliseconds: if nothing changed they rewrite the same bytes and
  `git status` stays clean, so running them costs nothing and guessing costs a red PR.
- **Then check `git status` before you commit.** These files are *generated into your working
  tree*, so the loop passing locally is not the signal — an uncommitted regenerated file looks
  exactly like a passing run right up until CI compares against what you actually pushed. That is
  the whole failure mode: the tests were green every single time.
- **Never hand-edit either one, and never edit inside the `repo-stats` markers in this file.**
  Fix the source and regenerate.

One missed regeneration doesn't stay one red PR, which is why the rule above is worth this much
space. The checks used to run on pull requests only, so a merge that skipped them left `main`
itself stale, and every branch cut from `main` afterwards failed a check it hadn't caused — until
someone regenerated. `main` is checked on push now (see `.github/workflows/test.yml`), so
staleness surfaces on the merge that caused it. If the doc check fails on a PR that plainly
touched no exports, pull `main` and regenerate before hunting through your own diff.

**Never resolve a merge conflict in either one by hand, and don't trust a clean merge of them
either.** Both are one line per fact — one per module in the map, one per statistic in the
`repo-stats` block — so git merges them line by line and a merge of two individually correct
generations is not itself a correct generation. A `+N more` counter is a per-line summary, so a
merge takes one side's number instead of recounting (`db/database.ts` sat at `+122` against an
actual `+125` for weeks); a newly added module's line is placed next to whichever context each
side had, so it can land out of the generator's own sort order, which is what put
`src/utils/focusWindow.ts` above `src/utils/focusSuggest.ts` in a file the generator sorts the
other way. Neither shows up as a conflict, and `git status` stays clean, because the file is
committed and unchanged. The fix is always the same: rerun the generator, never edit the file.

`npm install` wires up two things that make that mostly automatic (`scripts/setup-git-hooks.js`,
run from `postinstall`, which sets `core.hooksPath` to `.githooks/`). The merge driver in
`.gitattributes` keeps the generated content out of the line merge entirely, and `.githooks/`
regenerates after a merge and blocks a push whose generated docs are stale. They are a safety
net, not a guarantee: they are per-clone git config, so a clone that never ran `npm install`
doesn't have them, and GitHub's own merge button runs neither. CI's `--check` steps stay the
real gate.

There is no ESLint or Prettier config. Match the style of the file you're in; don't reformat
untouched lines.

## Finding your way around

Start from this table instead of searching. Most work lands in one of these files.

A row that names a `docs/arch/` file means the reasoning behind that feature lives there, and
**reading it is not optional before changing that area** — those notes are settled decisions
with the arguments attached, and the "don't do X" ones exist because X was tried. They sit in
their own files rather than here so a task about groceries doesn't cost every other task 20,000
tokens of context. For anything the table doesn't cover, `docs/module-map.md` lists every module
in `src/utils`, `src/store`, `src/hooks`, `src/db` and `src/services` with the symbols it
exports.

| Changing… | Start at |
|---|---|
| what appears on Today / Later / Unscheduled / Inbox | `src/utils/visibilityUtils.ts` + the selectors in `useTaskStore` |
| any task create/complete/defer/delete | `src/store/useTaskStore.ts` |
| the task edit sheet | `src/components/TaskEditor.tsx` |
| picking a task's category, anywhere | `src/components/CategoryPicker.tsx` (+ `src/utils/categoryPicker.ts`) |
| a task row — swipes, checkbox, expansion | `src/components/TaskItem.tsx` |
| quick-add text parsing (`"pay rent tmrw 5p #home"`) | `src/utils/parseTaskInput.ts`, `parseNaturalDate.ts` |
| what a template asks before it creates anything | `src/utils/templateQuestions.ts` — see `docs/arch/template-questions.md` |
| a task the app writes unasked, and the quiet-project offer | `src/utils/generatedTasks.ts` + `src/utils/projectReviewTasks.ts` — see `docs/arch/generated-tasks.md` (nineteen generators now: `health` and `weekendNudge` are the newest, `moodNudge` is the only one whose trigger is a trend in the user's own answers rather than a date, a row or a one-off threshold, and `weekendNudge` the only one that asks about a span of days rather than a single one) |
| a bare weekend, and the project it offers to fill it from | `src/utils/weekendTasks.ts` + `Project.weekendSource` — see `docs/arch/generated-tasks.md` |
| a weather rule ("sunny -> sunscreen") and the location/forecast read behind it | `src/utils/weatherTasks.ts` + `src/utils/weatherCondition.ts` + `src/store/useWeatherStore.ts` — see `docs/arch/generated-tasks.md` |
| anything read out of Apple Health | `src/store/useHealthStore.ts` + `src/utils/healthBridge.ts` + `modules/todo-health-bridge/` — see `docs/arch/health-data.md`. Read it first: three of its four rules are about what a reader may *claim*, and the big one is that a refused read and a day with nothing recorded are one answer |
| a task that reads as ready when Apple Health reaches a number | `src/utils/healthTarget.ts` + the `health` arm of `src/utils/taskKinds.ts` — `timer.ts` with a reading in place of a clock, and it derives *ready* only. Nothing here completes a task, for the reason `docs/arch/health-data.md` gives at length |
| a meal of the day as a task, and choosing one from Today | `src/utils/mealSlotTasks.ts` — see `docs/arch/generated-tasks.md` |
| a planned meal you haven't got the ingredients for | `src/utils/mealShortfallTasks.ts` — see `docs/arch/generated-tasks.md` |
| date math, recurrence | `src/utils/dateUtils.ts` |
| a timed task's countdown, and splitting it across subtasks | `src/utils/timer.ts` + `src/utils/timerSegments.ts` — see `docs/arch/timed-tasks.md` |
| a stock of something that runs down as a task repeats, and ordering more | `src/utils/supply.ts` — see `docs/arch/supplies.md` |
| a target logged N times a day, its pace ramp, and the same thing counted per week | `src/utils/quotaSchedule.ts` (the span) + `Task.quotaPeriod`. "Three times a week" is a quota with a week-long span, deliberately not a `RecurrenceType`: a recurrence answers "what date is next" and this has no next date to give. Every reader is written against the span, so widening it is the whole feature |
| working a queue of tasks one at a time, with breaks | `src/utils/focusPlan.ts` + `src/store/useFocusStore.ts` — see `docs/arch/focus-sessions.md` |
| a task that asks a question when it's completed | `src/utils/deliverables.ts` (+ `src/utils/bulkCompletion.ts` for the paths that complete several at once) |
| a task falling on several dates | `seriesId` in `src/store/useTaskStore.ts` (`applyTaskDates`) — see Series below |
| the month grid, and drawing an occurrence that has no row | `src/utils/calendarMonth.ts` + `src/screens/CalendarScreen.tsx` — see `docs/arch/month-grid.md` |
| a column, migration, or row↔object mapping | `src/db/database.ts` (`initDatabase`, `rowToTask`) |
| any model's shape | `src/types/index.ts` — one file, every type |
| colors, spacing, animation | `src/theme/index.ts`, `src/theme/ThemeContext.tsx` |
| pinning, the Pinned Tasks block | `pinnedBlock` in `src/screens/TodayScreen.tsx` — see Pinning below |
| bulk selection | `src/hooks/useTaskSelection.ts` + `src/components/BulkActionBar.tsx` |
| reminders | `src/utils/notifications.ts` |
| how long completed tasks are kept | `src/utils/retention.ts` + `purgeOldCompletedTasks` in `useTaskStore` |
| how you're feeling, and what that looks like against your tasks | `src/utils/moodLog.ts` + `src/utils/moodInsights.ts` + `src/utils/moodTasks.ts` — see `docs/arch/mood-log.md` |
| the people you want to keep up with, and their birthdays | `src/store/usePersonStore.ts` + `src/utils/birthdayTasks.ts` — see `docs/arch/people.md` |
| filling a person in from the contact book | `src/utils/contactsImport.ts` + `src/utils/contactsAccess.ts` — see `docs/arch/people.md` |
| what demo mode shows | `src/utils/demoSeed.ts` — see Demo data below |
| the switch that hides the advanced half of the app | `src/utils/simpleMode.ts` — see `docs/arch/simple-mode.md` |
| what the widget shows | `src/utils/widgetSync.ts` → `src/utils/widgetBridge.ts` → `modules/todo-widget-bridge` |
| anything written outside the app's own database (widget, Live Activities, the two queues) | `src/utils/widgetBridge.ts` — the one gate, demo mode included |
| what the app catches up on because time passed, at launch or in the background | `src/utils/maintenancePasses.ts` — one list, three groups; `src/utils/backgroundRefresh.ts` is the only thing that runs while the app is closed |
| importing from Apple Reminders (and so voice capture) | `src/utils/remindersImport.ts` (+ `remindersImportSync.ts`) — see `docs/arch/reminders-import.md` |
| the grocery list and a Reminders list kept in step both ways | `src/utils/groceryReminderMirror.ts` — see `docs/arch/reminders-import.md` |
| the Face ID app lock | `src/utils/appLock.ts` + `src/store/useAppLockStore.ts` + `src/components/AppLockGate.tsx` — see `docs/arch/app-lock.md` |
| where the Anthropic API key is kept | `src/utils/secureApiKey.ts` — see `docs/arch/app-lock.md` |
| the grocery list / catalog | `src/store/useGroceryStore.ts` + `src/screens/GroceryScreen.tsx` |
| a separate list for a week away, and a row in two trolleys at once | `src/utils/groceryLists.ts` + `GroceryListEntry` — see `docs/arch/groceries.md` |
| which aisle an item lands in | `src/utils/groceryAisles.ts` (offline lexicon) — see `docs/arch/groceries.md` |
| which engine answers an AI feature, and the keyless floor under one of them | `src/utils/aiRouting.ts` + `src/services/onDeviceModel.ts` |
| grocery autocomplete, catalog ranking | `src/utils/grocerySuggest.ts` |
| which bread — brands, variants, and rating them | `src/utils/groceryProduct.ts` (`ItemProduct`) — see `docs/arch/groceries.md` |
| two packets of one thing, tracked apart in the pantry | `ItemProduct`'s four pantry columns + `productHaveReason` in `src/utils/grocerySuggest.ts` — see `docs/arch/groceries.md` |
| which store an item comes from | `src/utils/groceryShops.ts` — see `docs/arch/groceries.md` |
| the store you're shopping at right now | `src/utils/activeTrip.ts` — see `docs/arch/groceries.md` |
| what something costs, and which store is cheaper | `src/utils/groceryPrice.ts` |
| what the app thinks you already have | `probablyHaveReason`/`pantryEntries` in `src/utils/grocerySuggest.ts` — see `docs/arch/groceries.md` |
| the app asking whether you still have something | `src/utils/pantryCheckTasks.ts` — see `docs/arch/groceries.md` |
| going through the whole pantry a card at a time | `src/utils/pantryReview.ts` + `src/components/PantryReviewSheet.tsx` — see `docs/arch/groceries.md` |
| whether a thing got used up or went bad | `src/utils/itemDisposal.ts` — see `docs/arch/groceries.md` |
| scanning a barcode into the list | `src/utils/gtin.ts` + `src/services/productLookup.ts` + `src/utils/scanResolve.ts` |
| reading a receipt's text on the device before it goes to the model | `src/utils/receiptOcr.ts` + `modules/todo-vision-bridge` |
| remembering which item a barcode is | `ItemProduct.gtin` + `gtinAliasText` in `src/utils/storeAliases.ts` — see `docs/arch/groceries.md` |
| what a store's receipt shorthand means | `src/utils/storeAliases.ts` (+ the `remembered` tier in `receiptMatch.ts`) |
| whether a store's receipt is worth photographing at all | `Shop.receiptStyle` (`itemized` / `none`) + the refusal branch in `ReceiptImportSheet.tsx` |
| what's in the kitchen and what's about to be wasted | `src/utils/kitchenInventory.ts` (+ the ladder in `src/utils/freshness.ts`) — see `docs/arch/groceries.md` |
| food in the freezer, and the clock that stops while it's there | `frozenAt` + `liveUseBy` in `src/utils/freshness.ts` — see `docs/arch/groceries.md` |
| an opened jar, and being nearly out of something | `openedAt`/`runningLowAt` in `src/utils/grocerySuggest.ts` + `groceryShelfLife.ts` — see `docs/arch/groceries.md` |
| what to cook with what's about to go off | `src/utils/useUpRecipes.ts` — see `docs/arch/groceries.md` |
| "apples or pears" on the shopping list | `resolveChoice` in `src/store/useGroceryStore.ts` — see `docs/arch/groceries.md` |
| "if there's no butter, use margarine" | `src/utils/itemSubs.ts` — see `docs/arch/groceries.md` |
| "white onion is still onion" | `src/utils/itemVarieties.ts` — see `docs/arch/groceries.md` |
| "always use oat milk for milk" | `src/utils/standingSwaps.ts` — see `docs/arch/groceries.md` |
| one recipe used inside another | `src/utils/recipeComponents.ts` — see `docs/arch/recipes.md` |
| "serrano or jalapeño", decided at the shelf | `ChoiceResolution.undecided` in `src/utils/recipeComponents.ts` — see `docs/arch/groceries.md` |
| which heading an ingredient sits under | `src/utils/recipeSections.ts` — see `docs/arch/recipes.md` |
| halving or doubling a recipe | `src/utils/recipeScale.ts` — see `docs/arch/recipes.md` |
| showing amounts in metric or US units | `src/utils/unitConvert.ts` — see `docs/arch/recipes.md` |
| whether an ingredient line is something you already buy | `src/utils/ingredientCatalogMatch.ts` — see `docs/arch/recipes.md` |
| reading a `quantity` string at all — amounts, units, containers | `src/utils/quantity.ts` — see `docs/arch/recipes.md` |
| reading a recipe out one step at a time while cooking | `src/utils/cookMode.ts` + `src/components/CookModeSheet.tsx` — see `docs/arch/recipes.md` |
| either of a recipe's two timers, from any screen | `src/hooks/useRecipeTimer.ts` — see `docs/arch/recipes.md` |
| a timer for the cooking step you're on | `src/utils/stepTimers.ts` + `src/store/useStepTimerStore.ts` — see `docs/arch/recipes.md` |
| a recipe page shared in from another app's share sheet | `src/utils/sharedRecipeLinks.ts` + `targets/todo-share/` — see `docs/arch/recipes.md` |
| syncing between devices | `src/utils/syncEngine.ts` + `syncMerge.ts` + `cloudKitTransport.ts` + `src/store/useSyncStore.ts` |
| exporting or restoring a backup | `src/utils/backup.ts` + `src/utils/backupFile.ts` |
| writing tasks to the system calendar | `src/utils/calendarSync.ts` (+ `deadlineCalendarSync.ts`, `mealCalendarSync.ts`) |
| reading free/busy out of the system calendar | `src/utils/calendarBusy.ts` + `src/store/useCalendarStore.ts` |
| a running list of things with no date (doctor questions, a wish list) | `Project.kind` in `src/types/index.ts` — a project drawn as a list; the members are ordinary undated tasks |
| pulling tasks out of a project | `src/utils/projectPull.ts` |
| what a task is waiting on, and what it blocks | `src/utils/blocking.ts` + `src/utils/blockerRegistry.ts` |
| how loaded a day is, and lightening an overloaded one | `src/utils/dayLoad.ts` + `src/utils/deloadPlan.ts` |
| what lands before a date, and whether it fits | `src/utils/lookAhead.ts` (+ `src/utils/taskMoves.ts`, shared with `deloadPlan`) |
| a recurring habit and whether it's on track | `src/utils/rhythms.ts` (+ `rhythmsSettings.ts`) |
| a habit that's about *not* doing something, and the days it survives | `src/utils/negativeHabits.ts` + `Task.polarity` — the one streak in the app advanced by a rollover pass rather than by a completion, because there is no completion to hang it on |
| what to suggest when a task is snoozed | `src/utils/snoozeEngine.ts` |
| a task that was missed, and the grace it gets | `src/utils/missed.ts` + `src/utils/expiredTaskGrace.ts` |
| the iOS Live Activity | `src/utils/liveActivity.ts` (+ `tripLiveActivity.ts`) |
| search ranking and the quick-search sheet | `src/utils/fuzzySearch.ts` + `src/utils/quickSearch.ts` |
| the numbers on the Stats screen | `src/utils/stats.ts` (+ `cookingStats.ts`) |
| planning a week of work | `src/utils/weekPlan.ts` |
| anything not listed here | `docs/module-map.md` — every logic module and what it exports |

<!-- BEGIN GENERATED: repo-stats -->
<!-- Regenerated by scripts/check-doc-stats.js. Run it after adding or growing a file. -->

**Read narrowly.** 50 files are over 1,000 lines, 32 of
them source rather than tests. The ten biggest source files:

`store/useTaskStore.ts` (7.9k), `components/TaskEditor.tsx` (5.3k), `db/database.ts` (5.2k),
`store/useGroceryStore.ts` (4.8k), `types/index.ts` (4.7k), `screens/TodayScreen.tsx` (4.5k),
`components/TaskItem.tsx` (4.2k), `store/useSettingsStore.ts` (3.2k),
`utils/demoSeed.ts` (3.1k), `components/QuickAddModal.tsx` (3.1k).

Grep for the symbol and read the surrounding range; reading any of them end to end costs more
context than the rest of the task will. `docs/module-map.md` says which file owns what.

The suite is **268 test files**, and `npm test` runs all of them in about half a minute.
`npx tsc --noEmit` is a few seconds once `.tsbuildinfo` exists, so run both, every time.

<!-- END GENERATED: repo-stats -->

**The eleven single-component files carry their own map.** `TaskEditor.tsx`, `TodayScreen.tsx`,
`TaskItem.tsx`, `QuickAddModal.tsx`, `MealPlanScreen.tsx`, `RecipeDetailScreen.tsx`,
`GroceryItemSheet.tsx`, `TemplateItemEditor.tsx`, `LogbookScreen.tsx`, `GroceryScreen.tsx` and
`SuggestMealsSheet.tsx` are each one component holding most of the file, so there are almost no
top-level symbols to grep for — `TaskEditor.tsx` has six in 4,200 lines and
`RecipeDetailScreen.tsx` has two in 1,900.
Each opens with a short header comment saying what's where, and its logic half is divided by
`// ==== <name> ====` banners; `grep -n '// ===='` on one of them is its table of contents. The
banners stop at the JSX, because a `//` comment can't go inside a `return (`: past the render
banner, the landmarks are the props already there (`<EditorGroup label="…">` for a card in the
task editor). Keep a banner accurate when you move code across it, and add one when a file grows
a region that isn't any of the ones listed.

The other files over 1,000 lines don't need this and haven't got it: `useTaskStore.ts`,
`useGroceryStore.ts`, `useSettingsStore.ts` and `useMealPlanStore.ts` each declare a store
interface that already lists every action in order, `database.ts` has 150 top-level functions,
`types/index.ts` is one commented type per block, and `demoSeed.ts` is data. A grep already lands
on a real boundary in all of them.


**Tests mirror source 1:1** — `src/utils/foo.ts` → `src/__tests__/foo.test.ts`, same for
stores; that's where a new test goes. Only pure logic is tested (`src/utils`, `src/store`,
`src/db`): Jest runs in the `node` environment with
no React renderer installed, so there are no component or screen tests. Don't add a renderer to
cover a UI change — verify those by reasoning about the code (and by mocking it, see **Mock a
visual change** below), and say so plainly rather than implying you ran them.

The 1:1 rule holds for every file in `src/utils`, `src/db`, and the task/grocery stores. Two
stores are the deliberate exception and carry no test file: `useTemplateCategoryStore` and
`useWidgetCompletionStore` are thin wrappers over a db read/write or a queue with no branching
logic of their own to pin down — same reasoning as skipping a component test, just for a store
instead of a screen. Don't read their absence as a gap to fill; add one only if the store grows
real logic beyond passing values through.

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

**This file and `docs/arch/` are the answer.** The conventions here are settled decisions with
the reasoning attached — the "don't do X" notes exist because X was tried. Don't re-derive them
from the code, and don't re-open them without a reason the note doesn't already cover. That
applies word for word to the `docs/arch/` files: they were part of this file until they made it
too expensive to load, and being in another file makes them optional to *load*, never optional
to *follow*. If the routing table sends you to one, read it first.

## Architecture

The cross-cutting model lives here: how data flows, what makes a task visible, how dates are
decided, and the design system every screen is built from. Individual features are written up in
`docs/arch/`, one file per area, and the routing table above says which one you need:

| Doc | Covers |
|---|---|
| `docs/arch/groceries.md` | Aisles, stores, the active trip, the kitchen/pantry, either/or, substitutes, standing swaps |
| `docs/arch/recipes.md` | Composed recipes, sections, quantities, scaling, unit conversion, cook mode |
| `docs/arch/generated-tasks.md` | The things that write a task unattended |
| `docs/arch/month-grid.md` | The calendar month view and projected occurrences |
| `docs/arch/template-questions.md` | What a template run asks before it creates anything |
| `docs/arch/timed-tasks.md` | Countdowns, and splitting one across subtasks |
| `docs/arch/supplies.md` | A consumable counted down by a repeating task, and the reorder it asks for |
| `docs/arch/focus-sessions.md` | Focus sessions: the plan, its breaks, and why a step that runs out waits |
| `docs/arch/reminders-import.md` | Apple Reminders import, and the data it deletes elsewhere |
| `docs/arch/app-lock.md` | The Face ID gate and the API key in the keychain |
| `docs/arch/people.md` | The people layer: why it never scores or ranks anybody, and how birthdays work |
| `docs/arch/mood-log.md` | The mood/symptom log, what its insights may claim, and the nudge's three rules |
| `docs/arch/health-data.md` | Reading Apple Health: why nothing is stored, and why a refusal is invisible |
| `docs/arch/simple-mode.md` | Simplified mode: what the one switch hides, and the two rules that make it safe |
| `docs/native-targets.md` | Adding an iOS native target (widget, Watch app, Live Activity) |

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
piece of user data lives in a local SQLite file on device. Three things reach the network, and they are
not equivalent: `src/services/aiSuggestions.ts` posts task titles/notes straight to `api.anthropic.com`
using a user-supplied API key, and every feature it powers is inert until the user pastes one into
Settings; `src/services/recipePage.ts` fetches a recipe page the user pasted a link to;
`src/services/productLookup.ts` asks up to three product databases what a scanned barcode is. **That third one is the
only one that needs no key**, so "no key, no traffic" stopped being the whole privacy answer when it
shipped — it carries its own switch (`productLookupEnabled`) instead. Anything else added on those terms
needs one too.

A fourth thing runs a model and reaches nothing: `src/services/onDeviceModel.ts` puts a prompt
through Apple's on-device `SystemLanguageModel` (iOS 26+), in-process, with no key and no
request. `src/utils/aiRouting.ts` decides which engine answers a feature, and only grocery aisle
sorting is routed there today. Three rules hold it in place and are written up in that file: a
feature's own switch outranks it (on-device is a floor under the features, never a way past a
switch), a key still means Claude (nothing has measured on-device latency for a real batch, and
quietly making a working feature slower is the one outcome this must not have), and the model's
~4k-token window is why nothing needing vision or long context can join the list. It is also the
one integration here that needs no demo-mode gate — nothing leaves the process and no queue is
consumed, so neither half of the rule below applies. That is pinned by a test rather than left
to be rediscovered.

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

### Scheduling decisions and dayResetTime — the grace window bug

**Any computation that decides where to schedule a task — when it should land, which date to suggest, whether to defer it — must use `dayResetTime`-aware helpers.** Using bare `new Date()` ignores the user's configured day boundary and off-by-ones tasks by one day during the "early-morning grace window" before `dayResetTime`.

**The grace window is the period between midnight (00:00 calendar time) and the user's `dayResetTime` setting.** If a user sets their day to start at 02:00 because they work late, anything happening between midnight and 2 AM — pulling project tasks, accepting snooze suggestions, deciding to lighten the day, creating use-up reminders — still belongs to the *previous* logical day, not today. A decision made at 1:30 AM to reschedule something "tomorrow" means "tomorrow by their clock", which is 26.5 hours away, not 24.

**The bug pattern: `new Date()` returns the calendar date, ignorant of `dayResetTime`.** At 1:30 AM on Aug 16 with a 02:00 reset, `new Date()` is Aug 16 but the logical today is still Aug 15. A scheduling decision that reads `new Date()` dates something Aug 16, not Aug 15, landing it one day later than intended.

**The fix: use the helpers in `src/utils/dateUtils.ts`:**
- `getCurrentDayStart()` — equivalent to `getDayStart(new Date(), dayResetTime)`, returns the midnight-equivalent instant of the current logical day. Use this when you need "today's start".
- `getLogicalToday()` — returns a Date set to the current logical day, at noon (safe for display). Use when you need a Date in the current logical day that's definitely in the day (not on a boundary).
- `getLogicalTomorrow()` — equivalent to `addDays(getLogicalToday(), 1)`, returns the next logical day. Use when computing "tomorrow".
- `getDayStart(date, dayResetTime)` — anchors a date to the boundary of its logical day under the given reset time. Use when you need to normalize a date you already have.

**Example of the bug vs the fix:**
```ts
// ❌ WRONG: ignores dayResetTime, off by one during grace window
const today = new Date();
const tomorrowDate = addDays(today, 1);  // at 1:30 AM with 02:00 reset, this is wrong by one day
deloadProposal.tomorrow = { date: tomorrowDate, dayLabel: 'Tomorrow', reason: null };

// ✅ RIGHT: respects dayResetTime
const today = getCurrentDayStart();  // or getLogicalToday()
const tomorrowDate = getLogicalTomorrow(resetTime);  // or addDays(getCurrentDayStart(), 1)
deloadProposal.tomorrow = { date: tomorrowDate, dayLabel: 'Tomorrow', reason: null };
```

**Where to audit during code review:** Any date computation for scheduling purposes — `dueDate`, `deferUntil`, snooze suggestions, project pull dates, use-up task dates, deload plan destinations, or anything else that lands a task on a day. Specifically look for:
- Bare `new Date()` being used to determine "today" or "tomorrow" for scheduling
- `addDays(new Date(), n)` instead of computing from a logical day
- Date comparisons using `new Date()` to establish "before/after today"
- Default parameters that use `new Date()` for task-dating functions

Search the codebase with `grep -n "new Date()" src/utils/` and check whether the result is a scheduling decision or something else (timestamps, display formatting, or expiry checks all have different rules). Don't assume a file is right because the pattern appears elsewhere in it — `src/utils/dateUtils.ts` itself has many correct uses alongside the one-line-per-function rule (e.g., `isTaskExpired()` deliberately uses bare `Date.now()` to capture the *real* current time, since expiry is about wall-clock seconds, not logical days).

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
- **One exception to that: a pinned daily target unpins itself once logging catches it up to pace.**
  Otherwise it would sit pinned at the top of Today, at quota, until the next unit falls due hours
  later — the exact "hidden until later" state pinning is supposed to override for a task that
  merely isn't due, not one that's already met for now. `logQuotaUnit` (`useTaskStore.ts`) is where
  this lives, gated on `isQuotaOnPace`, with the same grace window (`QUOTA_PACE_UNPIN_HOLD_MS`) the
  completion unpin above gets, since either row's meter can still be mid-burst (see
  `QUOTA_HOLD_BACKSTOP_MS`) when the unit that catches it up lands.

### Recurrence

Completing a recurring task creates a new task row with a new `id` and the next computed `dueDate`. The original task is marked completed (not deleted). `getNextDueDate()` in `src/utils/dateUtils.ts` handles all recurrence types; it anchors to the previous `dueDate` for fixed schedules, or to today for `recurrenceFromCompletion`.

There is no rule entity separate from the occurrence holding it, and `dueDate` does double duty: it is both the date this occurrence sits on and the anchor the whole future grid is measured from. That is the deliberate design (materialised rows, same call the Series note makes below), and these four rules are what it costs. They were all shipped as bugs first, so don't undo one by re-deriving it from the code.

- **Moving one occurrence must not rebase the rest, and the two directions need different mechanisms.** Rescheduling a recurring task rebased its entire future: move Tuesday's occurrence to Thursday once and it was a Thursday task for ever. Anything that moves a date-anchored task (`isDateAnchored`, `src/utils/taskMoves.ts`) has to say which of the two it is doing.
  - **Pushing it out writes `deferUntil`**, a floor laid over the stored date, which is what `getEffectiveTaskDate` exists to render and what the successor drops (`deferUntil: null`). A push must also *hide* the task until then, or the one you moved to Saturday still sits on Today, and that is exactly what a defer is. `deloadPlan` and `lookAhead` always did this; `TaskItem`'s own picker did not, which is the half that was wrong.
  - **Pulling it forward writes `dueDate` and `recurrenceAnchorDate`.** A defer cannot pull a task in front of its own date, and there is no "un-hide" to pair with the hide: the only way a task surfaces on Wednesday is for its date to *be* Wednesday. So the date moves honestly and the grid keeps its own anchor to step from. **Don't try to unify the two** — that asymmetry is the schema being honest about two different wants, and collapsing it is what made this a bug in the first place (#1953).
  - **`recurrenceAnchorDate` is consulted only by the recurrence engine**, which is the whole reason it is a grid anchor rather than a placement override: `getNextDueDate`'s base, `projectOccurrences`' walk, and `recurrenceAnchorDayFor`. Every reader of "what day is this on" — visibility, sorting, the widget, Search, the month grid's own cells — keeps reading the real `dueDate` and needs to know nothing. An occurrence-level date that overrode `dueDate` for placement was the obvious shape and would have put all of them in scope.
  - **The projection walk clears it after the first step** (`stepOccurrence`), or every step recomputes the same next date off the same anchor and the walk stalls on one day.
  - **Any `dueDate` written without it clears it**, which is one rule in `updateTask` rather than a `null` at each re-dating call site (the editor's Date row, `skipNextRecurrence`, the chain step on schedule, the expired sweep). A patch naming the field wins outright, which is both the pull-forward writing the pair together and a whole-snapshot undo restoring what was there. `completeTask`'s successor is built as a row rather than patched, so it drops the anchor explicitly alongside `deferUntil`.
- **`getNextDueDate` steps the grid; `{ catchUp: true }` walks it to the present.** Off by default because `projectOccurrences` walks this one occurrence at a time to draw a month, and a first step that skipped to today would drop every earlier cell. On for the two callers *placing a real row* — `completeTask`'s successor and `skipNextRecurrence` — because without it, finishing a task five weeks late spawned a successor dated four weeks ago: overdue on arrival, and five more completions (five more tombstones) to work back to the present. It walks the rule's own grid rather than landing on today outright, so a Friday task caught up is still on a Friday. `rolloverQuotas` reached the same conclusion for quota tasks by its own route and keeps it, since a partial day's record has to land on the day it belongs to.
- **`recurrenceAnchorDay` is what a short month is clamped *from*.** `addMonths` clamps Jan 31 to Feb 28, and with the stored date as the only anchor that clamp fed the next one: Feb 28, Mar 28, Apr 28, for ever, off a single February. Yearly did it to Feb 29. The column holds the day-of-month the grid is anchored to for the picker's "same day as the due date" option (an explicit `recurrenceMonthDay` or `recurrenceWeekOrdinal` already answers this, and `recurrenceFromCompletion` measures from a day rather than a date). It is captured whenever the user *writes* the schedule (`SCHEDULE_FIELDS` in `updateTask`) and deliberately never when the app moves the row itself, which is the entire mechanism: recompute it on an unrelated patch and the successor sitting on Feb 28 hands the drift straight back. Same fix `getNextSeriesDates` already applies to a dated series.
- **A multi-week interval counts weeks from the user's own week start.** `weekStartsOn` is a real setting and the weekday walk used to ignore it, so "every 2 weeks on Fri and Sun" split a Monday-start user's pair across two blocks, 9 days apart instead of 2. With `weekStartsOn: 0` the arithmetic is unchanged.

One walk draws every projection (`projectOccurrences` in `src/utils/calendarMonth.ts`, used by the month grid, `lookAhead` and `snoozeEngine`). Don't write a second: the private copy `snoozeEngine` used to keep had none of `canProject`'s refusals, so a `recurrenceFromCompletion` task — whose next date is answered from today however far the cursor moves — folded one day into the set thirty times and called it a schedule.

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

### Chains

Chain items (`chainItems[]` / `chainIndex`, shown in the editor collocated with Repeat since the two are easy to conflate) are a singly-linked list of steps, independent of recurrence: completing a chained task always advances `chainIndex` and immediately spawns the next task with no `dueDate`, ending after the last item. Repeat changes only what happens at that last item — instead of ending, `chainIndex` wraps to `0` and the whole chain repeats on the recurrence's schedule. See the `spawnsNext`/`atChainEnd` logic in `completeTask()` (`src/store/useTaskStore.ts`). `rowToTask()` maps the legacy `cycle_enabled`/`cycle_index`/`cycle_items` SQLite columns to the `chain*` fields on `Task`.

**A step carries its own `estimatedMinutes`, and every workload read goes through `estimatedMinutesFor()`** (`src/utils/effort.ts`) rather than `task.estimatedMinutes` — the same discipline `displayTitleFor` imposes for titles, and for the same reason: mid-chain, only one step is on the day, but the task-level estimate covers the whole chain. Read raw and a five-step routine charges its full estimate at *every* step, and since completing a step spawns the next onto the same day, the day's planned total never falls as the chain is worked. The step value is optional and falls back to the task's, so a chain nobody has itemised behaves exactly as before. `activeChainStep()` (`src/utils/chain.ts`) is the one place the "which step is live" rule lives — including that a single-item chain doesn't count as one.

**A step carries its own question too, and every deliverable read goes through `deliverableKindFor()`** (`src/utils/deliverables.ts`) rather than `task.deliverableKind` — the third field on the same pattern, for the same reason and with the same `step ?? task` fallback. `deliverableKind` is a `CONTENT_FIELD`, so it rides `...effective` onto every successor: with only that to read, a two-step chain that asks a question at step one asks it again at step two. The readers are the row's "?" glyph, `completionTapFor`, the prompt sheet, Logbook (including its Edit answer item and `setDeliverableValue`), Search, `projectDecisions` and `selectPurgeableTaskIds` — the last two matter because a chain step's recorded answer is a decision the project should list and a row retention must not purge. The *answer* stays on the row (`deliverableValue` is per-occurrence, like `progressCount`) and needs no per-step counterpart, since a chain only has one step live at a time and each step is its own row.

**A `'date'` step can place the step after it, and that's opt-in per step** (`ChainItem.deliverableDatesNextStep`). "Book haircut" is answered with the appointment and "Get haircut" lands on that day instead of on the day the booking got done. In `completeTask` it's one more candidate ahead of the two dates that were already there — `answeredDue ?? nextDue ?? midChainDue` — so the successor's re-anchored `reminderTime` and relative `deadline` follow it for free. Three rules hold it in place:

- **It is deliberately not something a date step just does.** Recording a date and *moving another row* are two different wants, and the second one wants to be visible in the editor rather than being an unannounced second meaning of the kind. The prompt sheet names the step it's about to schedule for the same reason.
- **It never applies at `atChainEnd`.** The last step of a plain chain spawns nothing, and a repeating chain's wrap is the recurrence placing the next cycle — `nextChainStep()` refuses to wrap for exactly this, and `completeTask` checks both.
- **It ignores the `hasNoDateSignal` guard `midChainDue` obeys.** That guard exists so a chain with no placement at all doesn't acquire one by accident; an answer given a second ago is not an accident.

This is the one reader `src/utils/deliverables.ts` was left open for (#1253) and it is still not a general write-anywhere mechanism: one field, one place, reusing the date the successor was getting anyway.

**Every completion path with a person present asks; only the unattended ones complete unanswered.** `completeTask` reads an omitted `deliverableValue` as "nobody asked" and completes with no answer, which is right for the missed sweep, the quota rollover and meal sync, and was wrong for the four paths a person actually taps: the bulk bar, a stack's "complete all", the focus session's Done, and a Live Activity's Done on a task with no row mounted. Each dropped the answer with nothing said, and once an answer can place the next chain step, what was dropped was a task's date rather than only a note. They now go through `useAnswerFirstCompletion` — a three-way confirm (Answer / Complete Without Answering / Cancel) for the paths completing several, `enqueue` straight to the questions for the paths completing one, and `DeliverablePromptQueue` asking them one sheet at a time. **Completing unanswered stays one tap**: the feature's rule is that nothing may ever *require* an answer, so what changed is that it's chosen rather than assumed. Cancel costs nothing, including the selection the bulk bar was built from.

### Stacks (`TaskGroup`)

"Stack" is the user-facing name; the code says `TaskGroup` / `group` throughout (table `task_groups`, `useTaskGroupStore`, `TaskGroupHeader`/`TaskGroupEditor`). A stack is a lightweight, stable *label* that several independently-scheduled tasks hang off — deliberately not a `Task`, so it can never be "not due yet" and desync from its members. Membership is `Task.groupId`.

**A stack's membership is a set of task *series*, not of task rows.** This is the one thing to get right. Because `groupId` rides along on the `...effective` spread in `completeTask()`, a completed occurrence keeps its `groupId` forever *and* so does the fresh row it spawns — so the raw child rows grow by one per completion, without bound. Never count, cascade over, or list `groupChildrenOf()`; use **`groupRosterOf()`** (store) / **`groupRoster()`** (`src/utils/visibilityUtils.ts`), which collapses those rows back to one entry per series. `groupChildrenOf()` is only for the rare "all history too" case, like re-filing rows when the stack is deleted.

Two counts exist and they mean different things, so keep them labelled: the roster is *membership* ("8 tasks", shown in the editor), and `isRelevantToGroupToday` filters that to *today's work* ("3/8 today", the badge on the Today row). A member that isn't due today is still a member.

**`TaskGroup.sortOrder` is in the same number space as `Task.sortOrder`** — a stack holds a slot in its category section exactly like a loose task, and `makeCategoryGroups` merges the two by that number. It used to be a per-category 1..M ranking of stacks alone, with stacks always emitted ahead of the section's tasks, which made "task above stack" unrepresentable: the drag animated and the rebuilt layout put the stack back on top. So `resolveDrop` hands out one running rank across tasks *and* stacks, and `reorderWithCategoryUpdates` persists those ranks verbatim rather than renumbering the tasks 1..N — the gaps where the stacks sit are the point. (Group *children* still carry a private within-stack 1..K order, set by `reorderGroupChildren`; that space is unrelated.)

**A stack has no completion state of its own — stored, derived, or dismissed.** Today renders one exactly while it has a visible child (`visibleGroupItems` in `TodayScreen`: `children.length > 0`, and `children` comes from `visibleTasks`), so it leaves in the same commit its last row does and returns whenever a member is visible again. Two designs preceded that and both are gone: a `TaskGroup.completedAt` "user dismissed this for today" stamp (the stack sat on Today saying "all 6 done for today" until tapped — an extra tap per stack per day to acknowledge what the finished rows already said), and before that, clearing that stamp on every event that could give the stack live work, which took four call sites and still missed one. The `completed_at` column is still on `task_groups`, unread and never written. **Don't reintroduce a hidden-for-today flag** — riding on `visibleTasks` is what makes the header and its rows leave together, since a just-ticked row stays in `visibleTasks` for the completion hold (`completionHoldIds`) and the header rides that window out with it.

Cascades (`completeGroup`, `deferGroup`, `pinGroup`, `deleteGroup`) are roster-scoped so they can't mutate completed history. `deleteGroup({cascade:true})` deletes the live members and merely unfiles the past occurrences — deleting a stack must not erase its Logbook and Stats history.

### Navigation

`src/navigation/AppNavigator.tsx` uses a bottom tab bar with 4 visible tabs (Today, Groceries, Projects, More). Every other screen is registered as a hidden tab and reached via `SideMenuDrawer`, which overlays the full screen and is opened by tapping "More" or by edge-swipe from the left. The Groceries tab drops out (falling back to `tabBarButton: () => null`, same as any drawer-only tab) while `kitchenEnabled` is off in Settings, mirroring the drawer's own "Groceries & Meals" row.

**What the menu contains is `src/utils/navHubs.ts`, not the drawer component.** The drawer draws eight rows; four of them are **hubs** standing in for thirteen destinations. A hub is one menu row plus a `HubPills` row under each member screen's header — the shape `GroceriesHubPills` established for Groceries/Recipes/Meal plan/Pantry, now generalized so the other three are the same code rather than three more copies of it. The hubs are Groceries & Meals, Organize (Categories, Tags, People, Stacks, Templates) and History (Logbook, Stats, Mood, Archived); Tasks, Search, Calendar, Stuck and Tips stand alone.

Four things follow from that and are worth not re-deriving:

- **A hub row names its members in a subtitle, built from the members that survived the gates** rather than written out. A row promising Stats while simplified mode has taken Stats away is a lie the user finds out about one tap later.
- **The drawer has a find field, and it is not optional decoration.** A hub hides four or five destinations behind one label, so without it, consolidating the menu would have made "Drift" strictly *harder* to reach than it was as its own row. `menuDestinations` flattens the same rows the menu draws into the index, so a screen the menu is hiding is not findable either — a result opening a feature you switched off is a way back into it that the switch didn't intend.
- **Route sets are derived, not listed twice.** `DRAWER_TABS`, `RESTORABLE_SCREENS` and `KITCHEN_SCREENS` all come off `NAV_MENU_ROWS`/`NAV_HUBS`. Adding a screen to the menu is one edit.
- **A hub row drops out when every member is gone**, and simplified mode is the only thing that can do that today. Pantry's disappearance under that mode used to be a hand-written special case in `initialScreenFromSettings` plus a second `featureHidden` call inside the pills; it is now just `screen: 'Kitchen'` on the `pantryTracking` feature, so one gate answers for the menu row, the pill and the cold-launch restore alike.

**Two screens are deliberately not in the menu.** `StuckScreen` is the merge of what were the Waiting and Drift rows — both were lists of tasks held out of the daily lists, differing only in whether something else or you are holding them, and `DriftScreen` opened by saying it was "the same shape and same reasoning as WaitingScreen". `BackfillScreen` moved to Settings ("Data & reset" → Fill in) as a pushed `RootStack` card: it is not a task list at all, it fills in empty fields across tasks, categories, projects, people and grocery items, which is maintenance rather than a place to work.

Today, Later, Unscheduled and Inbox are **not** separate screens — they're four `viewMode` sub-views of `TodayScreen`, switched by the pill row under its header, and they share one set of screen state (selection mode, expanded row, quick-add, editor). They're disjoint lenses over the same tasks (`isUnscheduledTask()` excludes inbox tasks, `isTaskVisible()` excludes both), each backed by its own store selector. Keep it that way when adding a fifth: Inbox used to be its own route, and every switch into it had to hand the destination over as a navigation param, which painted a frame of the *previous* sub-view before the param landed. A segmented control shouldn't navigate.

### Design system

`src/theme/index.ts` exports design tokens (`spacing`, `radius`, `font`, `fontWeight`, `border`, `iconSize`, `animation`, `interaction`) and two color palettes (`darkColors`, `lightColors`). Components consume colors via `useColors()` or `useTheme()` (which also exposes theme-aware `shadows`) from `src/theme/ThemeContext.tsx`. The top-level `colors` export is kept only for non-themed static uses.

**When adding a new element above/below existing ones, give it margin on both sides it needs, not just the side that happened to matter for its own layout.** A recurring mistake here: a new row/bar gets `marginTop` to clear whatever's above it, but no `marginBottom`, so the *next* element — which itself has no `marginTop` — ends up jammed right against it. `TaskEditor`'s field-search bar shipped exactly this way (`marginTop: spacing.md` only), and the group label right below it had no top margin of its own, so the two sat with zero gap between them. Don't assume the neighboring element already accounts for spacing on its side — check it, and default to `spacing.md` (16) between stacked blocks, `spacing.lg` (24) between denser groups, rather than shipping a cramped gap and letting it get caught in review.

**Never hardcode** hex/rgba colors, shadow styles, spring params, `activeOpacity`, or `delayLongPress`. The tokens to reach for:

- `colors.backdrop` — every modal/sheet dim layer
- `colors.blurFallback` — tint overlay behind `SafeBlurView` content
- `colors.onAccent` — text/icons on filled accent/green/red surfaces (always white, both themes)
- `colors.timeMorning/timeAfternoon/timeEvening` — time-of-day segment colors
- `interaction.activeOpacity` (0.7), `interaction.pressScale`, `interaction.delayLongPress` — press behavior
- `animation.spring.snappy/smooth/bouncy` and `animation.duration.*` — every Animated call
- `getShadows(isDark)` via `useTheme().shadows` (`card`, `fab`, `sheet`) — every shadow
- `useSheetHiddenOffset()` (`src/hooks/`) — how far down a bottom sheet's card parks while
  hidden. Every one of the ~25 sheets used to hardcode a 600/700-ish pair, which doesn't clear
  a card whose height is data-driven, and re-armed the lower value in the dismiss animation's
  completion callback — putting the card back on screen until the modal unmounted. Read the
  hook's doc comment before touching a sheet's open/close animation; the no-re-arm half of the
  rule lives at the call sites.

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
- `WhenPicker` (`src/components/WhenPicker.tsx`) — **the date picker.** Today/Tomorrow quick
  buttons, a month grid, and (optionally) time-of-day segments and the AI "Suggest" button.
  `allowPast={false}` refuses days before today (dimmed cells, back chevron off, the opening
  month clamped forward) — for a date that *places* something, like a chain step's answer
  scheduling the next step. It's a flag rather than a `minDate` because the floor has to be the
  logical today: a date parameter invites a call site to pass `new Date()`, which is the
  grace-window bug below. Backdating stays the default, since a completion date or a deadline
  that has already passed is a real thing to enter. The three pure bits are in
  `src/utils/calendarGrid.ts` (`isDayBefore`, `clampMonthToEarliest`, `canPageToPreviousMonth`). This is
  the one users actually see most, from the row's own reschedule action, so it's the one to reach
  for **any time a new feature needs to ask "what date?"** — a settings screen, an editor field, a
  bulk action, a sheet. Set `showTimeOfDay`/`showSuggest` to `false` when the date being picked
  isn't a task's own schedule (an end date, a range bound, a decision-task answer). Don't reach for
  `CalendarPicker` out of habit, or because it's what an older screen nearby already does — it's a
  plainer, older component kept alive only for the two things `WhenPicker` doesn't do: `datetime`
  mode (a completion timestamp, not just a day) and `multiple`-date selection (a task's `seriesId`
  set). If neither applies, it's the wrong component, however many other call sites still use it —
  this has already shipped wrong (`CalendarPicker` under a decision task's date question, #1502)
  more than once, and each fix means finding and swapping a call site after the fact instead of
  writing it right the first time.
- `EmptyState` (`src/components/EmptyState.tsx`) — every empty list: tinted icon circle + title + subtitle + optional CTA, animates in on mount. **When rendering inside a `ScrollView`, the ScrollView must have `flex: 1` and its `contentContainerStyle` must use `flexGrow: 1`**, so the content container expands to fill available space and the centered view can actually center vertically. Without that, the empty state content sits at the top of the sheet — the flex:1 on the centered view has nothing to fill. See `EventImportSheet.tsx` for the pattern.
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
- `SegmentedControl` (`src/components/SegmentedControl.tsx`) — **pick exactly one of a small,
  closed set.** The task's kind, the repeat type, priority, a unit, an anchor: one bounded track
  of equal segments, the chosen one raised rather than accent-filled. This is the rule the pill
  had lost — it was doing four unrelated jobs in one styling, and only two of them are pills:

  | Job | Control |
  |---|---|
  | Pick one from a small **closed** set | **`SegmentedControl`** |
  | **Multi**-select toggles (weekdays, time-of-day segments) | pills |
  | Pick from an **open** set the user builds (tags, aisles, stores) | `PillGroup` |
  | Pick a **task category** | `CategoryPicker` |
  | An action ("New task", "Add tag") | `InlineAction` |

  N free-width pills read as N objects, so an editor holding four such rows read as sixteen
  things to consider rather than four questions to answer; a track reads as one field whatever
  it contains. A weekday row next to one *should* look different — that's the rule working.
  Sets too wide for a line take `columns` (an equal-width grid **inside the same track**, rows
  built by `src/utils/segmentColumns.ts` — ragged wrapping is a row of pills again, just inside
  a box). Settings gets it through `SettingsSegments`, which is only the padding: the
  accent-bordered `SettingsPills` that predated this is gone, since two treatments for one job
  is the drift. Priority is in a track *and* keeps its colour — every segment carries its dot
  (`SegmentOption.dot`), which shows more than the old fill did, since that only coloured the
  option you'd already picked. The cases deliberately left as pills (effort, presets beside a
  free input, list filters, a unit beside a stepper) are listed in the component's own doc
  comment with the reason for each; read it before converting or un-converting one.
- `PillGroup` (`src/components/PillGroup.tsx`) — a wrapping grid of pills for picking from an
  open-ended set (aisles, stores). Past `DEFAULT_PILL_LIMIT` (8) it caps itself behind one
  "N more" and grows a field that both filters the set and adds to it, the way `ListBulkBar`'s
  category field does. Selected and `pinned` pills are exempt from the cap — the current value
  and the option meaning *no choice* ("No store", "Usually Produce") are never buried — and
  **order is never re-ranked**, since `aisleOrder` is the user's own walk round the shop.
  Creation is one control in two states: below the cap a "+ New {noun}" opening an inline input,
  above it the `Create "…"` the filter's own text implies. The rule and its tests are in
  `src/utils/pillOverflow.ts`; the component owns only layout. Reach for it instead of mapping a
  list straight into `<TouchableOpacity>` pills whenever the set has no ceiling — that's what
  had the grocery item sheet rendering ~30 pills across two grids, pushing the name/quantity
  fields it exists to edit off the first screen.
- `CategoryPicker` (`src/components/CategoryPicker.tsx`) — **the task-category picker, everywhere
  one is chosen.** `CategoryPickerList` is a find-or-add field over every category, one per row;
  `CategoryPickerSheet` is the same list in a bottom sheet for a host with no room of its own
  (quick add, the bulk bar's Move). Rows, not pills, and no cap: quick add used to show seven and
  hide the rest behind a "N more" that its own sheet — capped to the space above the keyboard —
  usually cut off, so picking anything else meant typing a name from memory. Two columns were
  tried in mock and rejected; "Expiring Groceries" truncates at half width, and a truncated
  category is one you can't recognise, which is the whole problem. Order is the user's own
  (`reorderCategories`), never re-ranked by recency, and the filter/Enter rules live in
  `src/utils/categoryPicker.ts` with their tests. `value` is optional: omit it where there's no
  single current value to tick (a bulk move across several categories). The Settings rows that
  pick a *default* category are deliberately still `PillGroup` — they sit on a page that scrolls,
  so their "N more" is reachable, and their neighbours are the other Settings pill grids.
- `CollapsibleField` (`src/components/CollapsibleField.tsx`) — a picker section inside an editor card. Collapsed it is `LABEL … value ⌄`; expanded it shows a one-line `hint` explaining the field, then the pills (Category's own contents are a `CategoryPickerList` instead — same disclosure, a list inside it). **Every editor picker (category, project, tags, priority, effort, …) uses this** — see the progressive disclosure note below.
- `RuleListSheet` (`src/components/RuleListSheet.tsx`) — the sheet a list of user-authored
  "when X, add this task" rules is edited in: one card, one row per rule (title, a secondary line,
  a toggle, a chevron), tap to expand into a control, a title field and a delete row, plus an
  `InlineAction` to add one and an `EmptyState` when there are none. `WeatherRulesSheet` and
  `ScreenTimeRulesSheet` are both this, and they shipped as near-identical copies first — sixty
  lines of styles matched character for character, which is the drift `SheetHeaderButton` and
  `InlineAction` exist to undo, one level up. **A third rules sheet uses this rather than copying
  one of them.** What a caller supplies is the two ends: `header` (anything above the list — a
  permission card, a picker) and `renderEditor` (the rule-specific control in the expanded row).
  `RuleSheetNoticeCard` beside it is the card shape both use for the first of those. It needs no
  unsaved-changes guard because every edit commits straight through `onChange` as it's made —
  the other valid answer to the pageSheet `onRequestClose` rule below, not a workaround.
- `EditorRow` (`src/components/EditorRow.tsx`) — the `icon — label — value ›` row every editor sheet is built from (Date, Deadline, Remind me, Link, …). Pass `expanded` for rows whose controls unfold in place rather than opening a picker, and the chevron becomes up/down.
- **Filtering by an open-ended set of options (tags, categories) is a bottom sheet with wrapping chips, never a horizontal scrolling chip row.** `LogbookFilterSheet` and `RecipeTagFilterSheet` are the two instances — both replaced a scroll row that had shipped first. A scroll row hides every option past what fits on screen behind a swipe nobody is prompted to make, and a vocabulary the user builds themselves (tags especially) has no ceiling a phone-width row can assume; wrapping puts the whole set on screen at once. The screen itself keeps only a small trigger row: a "Filter"/"Tags" button that opens the sheet, plus whatever's *currently selected* as removable pills (`ActiveFilterPill` in `LogbookScreen`, the `activePill` styles in `RecipesScreen`) — that set stays small by construction, so a scrolling row is still the right shape for it. Don't reach for a horizontal `ScrollView` of chips as the *filter control itself* again; that's the mistake both of these fixed.
- `SelectionDot` (`src/components/SelectionDot.tsx`) — the circle at a row's **trailing** edge that
  says whether it's picked for a bulk edit: empty ring on every eligible row, accent fill + tick on
  the selected ones. Selection used to be shown by filling in the row's own completion checkbox,
  which made a picked task look ticked off and — worse — made a list with nothing yet picked look
  identical to a list that wasn't selecting at all. The empty rings are the more important half.
  It's a *circle* where completion checkboxes are rounded squares (`checkboxRadius`), it sits at the
  opposite end from the checkbox, and it takes the slot the row's own action buttons vacate on
  entering selection mode, so nothing has to move aside for it. It is not its own accessibility
  element — the row already exposes a checkbox with the same state. Two rows use it (`TaskItem`,
  `LogbookScreen`'s row); a third selectable row type should use it too rather than tinting its
  checkbox.
- `PaintSelectionProvider` (`src/components/PaintSelection.tsx`) — wraps a task list so that, while bulk selecting, a drag down the column of `SelectionDot`s "paints" a run of rows instead of needing a tap each. Screens get it by spreading `paintProps` from `useTaskSelection` and passing `scrollEnabled={!painting}` to the list; rows register themselves from inside `TaskItem`, so nothing else has to change. The touch is claimed **on touch-down in the capture phase** within `PAINT_GUTTER_WIDTH` of the **trailing** edge — a native scroll can't be taken back once it starts dragging, so deciding later would let the list scroll out from under the paint. That's why a drag started right on the dots can't scroll (the deliberate trade), and why every other pixel of the row scrolls exactly as before. The gutter follows the dots: it ran along the leading edge while the checkbox was the selection control, and a gesture that isn't over the thing it changes is the bug that pairing them avoids. Hit-testing math and its tests live in `src/utils/paintSelect.ts` / `paintSelect.test.ts`.
- `src/utils/haptics.ts` — semantic haptics (`tap`, `success`, `warning`, `error`, `impactLight/Medium/Heavy`). Never import `expo-haptics` directly; pick by meaning so intensities stay consistent.
- `src/utils/layoutAnimation.ts` — `animateLayout()` immediately before a state change that inserts/removes list rows (complete, delete, add, selection-mode toggle). **Never call it on a drag-reorder commit path** (`ReorderableList.onReorder`, `DraggableFlatList.onDragEnd`) — those drive their own row animations.
- **Accessibility on icon-only controls isn't a missing primitive, it's an adoption gap** — `PressableScale` already supplies `accessibilityRole="button"`, and every icon-only `TouchableOpacity` (drag handles, delete X's, calendar day cells, month-nav chevrons) needs an explicit `accessibilityLabel` alongside it, following `TaskItem`'s style (e.g. `` `Reorder subtask ${sub.title}` ``). Hand-rolled on/off controls (a `View` toggle knob inside a `Touchable`, not a real `Switch`) need `accessibilityRole="switch"` + `accessibilityState={{ checked }}` too — see the vacation-pause and archive toggles in `TaskEditor`/`ProjectEditor`.

**Editors are progressive disclosure.** `TaskEditor`, `TemplateItemEditor`, `TaskGroupEditor`, `ProjectEditor` and `TemplateEditor` all follow the same shape: title/notes, then cards under uppercase `groupLabel` headers (Schedule → Organize → Priority & effort → Subtasks → More), rarely-changed rows last. Nothing renders its picker expanded by default — every pill grid lives inside a `CollapsibleField` that shows only its current value until tapped, and picking a single-choice value collapses the section again (`closeField`). Inline controls hung off an `EditorRow` (time-of-day pills, time window, link picker) render only while that row is expanded. When adding a field, give it a `hint` that says what it does in one line: that hint is the only in-app documentation these options have.

**The task editor's fields are searchable, and the index is the JSX.** The magnifier in
`TaskEditor`'s header opens a `SearchField` that filters the sheet down to matching rows
(`src/utils/editorSearch.ts`, `searchTerms` on `EditorGroup`) — groups with no hit disappear.
Every field always renders regardless of search; search only narrows which of them are on screen.
Three decisions worth not re-deriving:

- **An `EditorGroupRow` carries its own `keywords`**, so there is no `taskEditorIndex.ts` to keep in
  step with the form the way `settingsIndex.ts` must. The rows already declare `label`, which is
  exactly the index a search needs; a separate file would be a second copy that goes stale, and
  #1229 correctly sized that as the expensive part. **The keywords are the feature**, not a nicety
  — a tidier layout can't help someone looking for *blocked*, *away*, *snooze* or *url*, and that
  gets worse with every field added.
- **It filters in place; it does not scroll to a row.** `searchSettings` ranks and jumps because
  Settings renders a *result list* over rows that live behind a navigation step. These rows are the
  form, so the match is shown where it lives — which is also why `filterEditorRows` is deliberately
  unranked (a form that re-sorts as you type is one you can't learn).
- **It's behind the magnifier, not a permanent bar.** The sheet is dense, and a bar every task edit
  pays for to serve the edits that need it is the trade that made the editor long in the first place.
  Closing clears the query, and reopening the sheet resets it — handing someone back a filtered form
  with no visible reason why is the one way this breaks.

**List rows** use the iOS inset-grouped card treatment app-wide — match the styling in `TaskItem.itemWrapper` (Search/Logbook/Tags/Categories/Projects rows follow the same pattern). Section headers are uppercase `font.xs` semibold **`textSecondary`** with `letterSpacing: 0.8` — every one of them, the editor group labels (`EditorGroup`, `CollapsibleField`) and the Settings section labels included. `textTertiary` measures 2.84:1 on `bgSecondary` in dark, under even the 3:1 large-text bar, and these are the one grey the app repeats on every screen; `textSecondary` is 5.22:1 and was already the other grey in use. Raising the size instead was the alternative and was rejected — it makes the headers louder than the rows they label. `textTertiary` is still right where dimness is the *signal* rather than decoration (`CollapsibleField`'s `summaryEmpty`, which is how a field says it has no value). The one row that is deliberately *not* a card is `TaskGroupHeader` — a stack heads its tasks rather than sitting among them, so it's a transparent caption (see the note on its `band` style; every filled-card version of it read as a *selected* row, because a brighter card surface is what this app uses for pressed and dragged). What ties it to its tasks is enclosure, not resemblance: `TaskGroupTray` puts the header and the child cards in one `bgSunken` region, and the children drop their own margins to sit on its padding. Grouping a header with its rows by giving the header a card-like treatment is the move that keeps failing here — reach for the region instead.

**A `presentationStyle="pageSheet"` Modal is dismissible by an iOS swipe-down, and that gesture calls the Modal's `onRequestClose` — not whatever the header's Cancel button runs, if the two aren't the same function.** A bare `onRequestClose={onClose}` on a sheet that stages typed or picked state before an explicit Save/Add is a silent-data-loss bug, not a style choice: the swipe bypasses the save path entirely, the same way it does for `EditorSheet`'s own pageSheet-vs-fullScreen tradeoff noted below. This shipped as a bug for four sheets first (#1681/#1682), and turned out to be the default rather than the exception — a sweep of the rest of the app (#2192) found the identical bare-`onClose` `onRequestClose` on fourteen more. **Any new `pageSheet` Modal holding state that isn't committed immediately needs a `handleCancel`, not a bare `onClose`, wired to both `onRequestClose` and the header's Cancel/Back button:**
```tsx
const handleCancel = () => {
  const dirty = /* differs from what the sheet opened with, or from what's saved */;
  if (!dirty) { onClose(); return; }
  Alert.alert(
    'Discard changes?',
    'You have unsaved changes. Are you sure you want to discard them?',
    [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ],
  );
};
```
Same copy every time, mirroring `TaskEditor`'s own `handleCancel` — don't invent new wording per sheet. The dirty check's *shape* varies with what the sheet stages: `RecipeToListSheet`/`SuggestMealsSheet` (a baseline ref stamped on open, since a recompute can reseed the same state under the user), `ProductSheet`/`SubstituteSheet` (differs from the saved row), `TemplateSuggestionsSheet`/`GroceryAISheet` (any generated batch exists at all, since regenerating costs a real request), `PrepTasksReviewSheet` (something was deselected off an all-checked default). A sheet whose fields **commit immediately** on tap/blur instead (`GroceryItemSheet`, `StandingSwapsSheet`, most plain pickers) has nothing to guard — that's the other valid answer, not a workaround, and no `handleCancel` is needed. Two are their own read: `CategoryEditor`'s `onRequestClose` already runs the same save path "Done" does (autosave instead of a confirm — solves the same bug, just not by asking), and a `presentationStyle="fullScreen"` Modal (`EditorSheet`, `PantryReviewSheet`) has no swipe gesture at all, so there's nothing to guard.

### Drag and drop — handle with care

`src/components/ReorderableList.tsx` (+ math in `src/utils/reorder.ts`, tests in `reorder.test.ts`) uses JS-driven row animations and a floating drag overlay by deliberate design — see the comments in that file before changing render order, the animation driver, or the PanResponder lifecycle. Safe to touch: overlay styling, autoscroll params, durations, and haptics via `onHoverChange`.

**The `drag` callback it hands each row is cached per row key and must stay that way** (`dragHandlerFor`). Neither list virtualizes, so on Today or Later every row there is is mounted; building the callback inline in the render map — which is what it used to do — gave every row a fresh function identity on every render of the list, and that alone was enough to defeat `React.memo` on `TaskItem`. A screen-state change as small as expanding one row re-rendered all of them. Nothing in the callback needs rebuilding: it resolves the row's index from `dataRef` at call time precisely so it can survive the list changing under it, and it reaches `startDrag`/`keyExtractor` through refs so a cached handler can outlive the render that built it. The row props on the other side of that memo are kept referentially stable on purpose too (see the `useCallback`s around `handleRowPress` in `TodayScreen`, and their comment) — the two halves only pay off together, and half of it is worth nothing: `renderTaskRow` shipped with the stable `handleRowPress` wrapped in a fresh arrow (to pass a *row* key rather than the task id), which put every row on Today back to re-rendering on every store write with the memo still in place and looking like it was working. That's what `TaskItem`'s `rowKey` prop is for — when a row needs to call itself something other than its task's id, it says so with a value, not a closure. `SortableList` caches its `drag` the same way, and has to: its rows on Today are a stack's children, which are `TaskItem`s and so memoized. It built the callback inline until a stack's collapse re-rendered every row inside the tray the animation was about to move.

`src/components/SortableList.tsx` — the nested list (a stack's children on Today, subtasks, chain steps) — is now **the same design and shares the same math**: rows render in their original order and are displaced by an `Animated` `translateY`, the dragged row becomes an invisible placeholder carrying the drop slot, and a finger-anchored card floats above. Same rule: styling, durations and haptics are safe; render order, the animation driver and the responder lifecycle are not. It used to re-render the rows in swapped order on every hover change instead, which is what made a drag inside a stack snap rather than animate. Two things are deliberately not copied over, because it doesn't own a scroll view: there is no autoscroll and no `measureLayout` calibration (its rows are direct children, so `onLayout`'s `y` *is* the card's anchor), and the card is clamped to the first/last row's slot **unless** the caller passes `onDragOut` — every other caller sits inside a rounded `overflow: hidden` card that would slice the card at the edge. The one caller that does pass it (Today) instead unclips its container for the duration, via `TaskGroupBody`'s `dragging` → `AnimatedCollapsible`'s `clip`.

**A `SortableList` rendered inside a scrollable must turn that scrollable off for the duration of a drag** — pass `onDragStateChange` and wire it to the container's `scrollEnabled` (see `TaskGroupEditor`, or `draggingStackChild` in `TodayScreen`). Without it the drag doesn't happen at all: a native scroll view only stands down for a JS responder that is one of its **ancestors** (`_shouldDisableScrollInteraction` walks `superview`, not the subtree), and `SortableList`'s responder is a descendant — so the scroll claims the touch on the first finger move and the row is put straight back down. `ReorderableList` is immune because it owns the scroll view it drags inside of and sets `scrollEnabled` itself. The inline subtask list in `TaskItem` can't reach its own container, so it re-exposes the flag as the `onSubtaskDragStateChange` prop — **every screen rendering a `TaskItem` has to pass it** (a `useState` setter, so the row's memo still holds) and add it to its list's `scrollEnabled`, or subtask drag is silently dead on that screen.

**A drag cannot live inside a `presentationStyle="pageSheet"` Modal, and that's why `EditorSheet`
is `fullScreen`** (#1182). A page sheet is presented by a `UISheetPresentationController`, which
owns the pull-down dismissal pan — on its *container* view, an ancestor of the modal's content.
Every RN `Modal` gets its own touch handler on the modal view controller's root view
(`RCTFabricModalHostViewController`), and that handler **destroys its own in-flight touches** the
moment it has to arbitrate with a recognizer from outside that view (`RCTSurfaceTouchHandler`:
`canBePreventedByGestureRecognizer` → `![other.view isDescendantOfView:self.view]` →
`_cancelTouches`). It's deliberate on RN's part, aimed at native recognizers "like iOS 13 modals
that can be pulled down". The symptom is unmistakable and cost three inconclusive audits: the row
lifts, follows the finger for a moment, then snaps back on `onPanResponderTerminate`, in both
directions, with nothing else on screen moving — UIKit asks about simultaneous recognition while
both recognizers are merely *tracking*, so the sheet's pan need never begin.

**`scrollEnabled` is not a way out of that, so don't go back to trying.** Switching the scroll off
is genuinely required (above), but an iOS sheet defers its dismissal pan to the sheet's scroll
view — so switching it off is also what frees that pan to arbitrate immediately. Scroll on, the
scroll cancels the touch; scroll off, the sheet does. Inside a page sheet the drag loses both
ways. A sheet that holds a drag list is `fullScreen` with a `useSafeAreaInsets().top` inset in
place of the page sheet's own (`EditorSheet`, `CategoryOrderSheet`, `GroceryAislesSheet`); the
other ~20 page sheets hold no drag and are left alone.

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

**A new `Task` field is not finished until you've decided whether `TemplateItem` needs it too.**
`TemplateItem` (`src/types/index.ts`) deliberately mirrors a large slice of `Task`'s fields —
`vacationPause`, `excludeFromSuggestions`, `priority`, `effort`, the recurrence fields, and more —
because a template item is what seeds the task it creates: `buildDraftsFromTemplate`
(`src/utils/templateUtils.ts`) reads the item's fields onto the draft, `buildDraftsFromTemplateTree`
calls it, and `useTemplateStore`'s `applyTemplate` hands the result straight to
`useTaskStore.addTask`. Nothing enforces the parity — they're separate interfaces — so adding a
field to `Task` alone compiles fine and ships a setting nobody can pre-set from a template, with no
error to catch it. Before calling a new per-task setting done, ask whether a template item should be
able to seed it (a schedule/behavior toggle usually should; a runtime-only field like `completedAt`
or `streakCount` shouldn't). If yes, that's four sites, not one: the field on `TemplateItem`, its
default in `normalizeTemplateItem` (`src/utils/templateUtils.ts`, tolerant of older stored JSON
missing it), its pass-through in `buildDraftsFromTemplate`, and a matching toggle in
`TemplateItemEditor.tsx` alongside whatever `TaskEditor.tsx` grew.

### iOS native extension targets (widgets, and future Watch/Live Activity targets)

The Today widget (`targets/todo-widget/`) is injected at prebuild time by custom config plugins rather than a checked-in `ios/` folder — `plugins/withAppGroup.js` (App Group entitlement on the main app) and `plugins/withWidgetExtension.js` (the WidgetKit extension as a whole new Xcode target, built via the raw `xcode` npm package).

**Before adding or changing a native target — Watch app, Live Activity, share extension — read `docs/native-targets.md`.** It lists the six non-obvious requirements this one cost a build cycle each to discover (the EAS `appExtensions` declaration, `TargetAttributes` signing, two outright bugs in the `xcode` package, Info.plist placeholder keys, the bridge module's podspec, the App Group path convention). Nothing else in the repo will tell you about them, and each one fails late — at archive or at submission, not at build.

Two fixes that look unrelated to the widget but are load-bearing for *any* second native target existing at all — don't revert them as dead code:
- `enableScreens(false)` near the top of `App.tsx` — works around a `react-native-screens` crash (`RNSTabBarController`) that only reproduces in production builds once the app has more than one native target to build/sign.
- `ios.buildReactNativeFromSource: true` in the `expo-build-properties` plugin config (`app.json`), plus `patches/react-native+0.86.2.patch` (applied via `patch-package` on `postinstall`) — RN downloads a prebuilt Core binary by default, which bypasses the patch entirely; the patch itself fixes an RN bug where an `NSException` thrown inside a native module call escapes across a dispatch-queue boundary instead of being converted to a JS error, crashing the app. Both were required together — the patch alone has zero effect without also forcing a from-source build. **The patch is named for the exact RN version and has to be re-cut on every RN bump**, because `patch-package` matches on that filename: 0.81 threw `convertNSExceptionToJSError(...)` from the `@catch` and 0.86 plain `@throw`s instead, so the diff context changes even though the bug and the fix don't. Re-cut it by editing `node_modules/react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModule.mm` and running `npx patch-package react-native`, then delete the old patch file.

`enableScreens(false)` has a side effect worth knowing before reaching for `freezeOnBlur` on a tab screen: it sends `@react-navigation`'s `ScreenFallback` down its non-native branch instead of the `react-native-screens` implementation, and nothing on that branch forwards `freezeOnBlur`. So a blurred tab screen stays mounted and keeps re-rendering on every store change; `freezeOnBlur` is inert in this app, and there's no escape hatch for it while `enableScreens` stays off.

**What that fallback renders changed with React Navigation v7, and the difference matters.** Under v6 `MaybeScreen` fell back to `@react-navigation/elements`' `ResourceSavingView`, which keeps a blurred child mounted by moving it `FAR_FAR_AWAY` — `top: 30000`. Under v7 (`node_modules/@react-navigation/bottom-tabs/src/views/ScreenFallback.tsx`) it falls back to a plain `View` and nothing is parked off-screen, so a blurred tab screen now sits at its normal offset. `ResourceSavingView` is still exported and still does the 30,000pt trick; bottom tabs just no longer route through it.

That 30,000 is why **`automaticallyAdjustKeyboardInsets` must never be
passed bare** — use `useKeyboardInsetScroll` (`src/hooks/`), which is already wired into `ReorderableList`
and every screen-level `FlatList` that had it. RN registers a keyboard listener on *every* mounted
`RCTScrollView` and gates it on that prop alone, then sizes the inset from the scroll view's position in the
window — so a blurred tab parked at y=30000 picks up a ~30,000pt bottom `contentInset`, and the keyboard
*hiding* recomputes the same 30,000 rather than clearing it. Switch to that tab and there's a screenful of
content above thirty thousand points of nothing. The hook passes the screen's own focus state, so a
backgrounded list doesn't listen. **v7 removing the parking does not make the hook removable**: the rest of
it is about RN's own inset behavior, which is unchanged — the per-`RCTScrollView` keyboard listener gated on
that one prop, and the `keyboardDidHide` re-clamp below, neither of which had anything to do with where the
screen sat. It also re-clamps on `keyboardDidHide`, because shrinking an inset never
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
- **Demo data**: when a change adds a user-facing capability, seed one instance of it in
  `src/utils/demoSeed.ts` in the same PR, and assert it in `useDemoStore.test.ts`. Demo mode swaps
  the whole database for a throwaway one (`useDemoStore`), so it's what someone handed the phone
  actually sees — **a feature with no row in the seed reads as a feature the app doesn't have**,
  not as one that happens to be unused. That's especially true of the capabilities that are
  invisible until something uses them: a composed recipe, an either/or choice group, a per-store
  link, a container in the fridge, a scaled meal. Everything goes through the normal store actions
  rather than raw db inserts, so a seeded row can't drift from the type; the corollary is that a
  field with no store action behind it (a recipe's logged cook minutes, a `lastPurchasedAt`) can't
  be seeded, and that's the honest reason to leave one out — not "it seemed minor". Skip it for
  changes with nothing to show (refactors, tests, tooling).
- **Nothing in demo mode may write outside the demo database.** The swap is invisible from the
  outside: every store reloads, every subscription downstream fires, and every `db*` function keeps
  working and quietly answers about seeded fiction. So anything that reaches past SQLite —
  a notification, a calendar event, a reminder, the widget's App Group, a Live Activity, an iCloud
  push — has to check `isDemoModeActive()` (`src/utils/demoState.ts`) or it does the real thing with
  invented data. The two directions fail differently and both are real: a *write* puts fiction
  somewhere the user can see with the app closed (fake tasks on the home-screen widget, a fake shop
  on the lock screen), while a *read that consumes* destroys real work by draining a queue into a
  database that's about to be thrown away (a checkbox tapped on the widget, a recipe shared in from
  Safari). Where a feature has a natural choke point, gate it there rather than at each call site:
  `widgetBridge()` (`src/utils/widgetBridge.ts`) is the one door to everything behind
  `todo-widget-bridge` precisely because it used to be six hand-rolled copies of the same lazy
  require, and five of them forgot this. Cloud sync gates on the database handle itself
  (`isSyncableDatabase`), which is stronger still. **A new integration needs its own gate and a test
  for it**, in the same PR.
- **Patch notes**: when a change in this PR is user-facing, add a new fragment file to `src/patchNotes/entries/` before opening the PR — one JSON file per entry, `{ "message": "...", "date": "YYYY-MM-DD" }`, named after the change (e.g. `icon-action-buttons.json`). Keep the message short and written for someone who isn't reading the diff. Don't edit `src/utils/patchNotes.ts` or `src/utils/patchNotesData.ts` directly (generated, gitignored). Skip it for internal-only changes (refactors, tests, CI, tooling).
