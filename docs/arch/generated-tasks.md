# Generated tasks: the six things that write a task unattended

The shared mechanism behind meal tasks, use-up tasks, the meal-plan nudge,
project reviews and pantry checks. Read this before adding a seventh generator:
the whole point of the refactor it describes is that a new one costs a rules
module and a registry entry, not a column.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## Generated tasks — the six things that write a task unattended

Each meal of the day becomes a task, a perishable grocery and an ageing leftover each become "Use up
X", an opt-in weekly trigger becomes "Plan meals for…", a project that has gone quiet becomes
"Review X", and a grocery whose pantry guess has run out becomes "Check if you still have X". The
first four were each built by copying the last, which is fine twice and had reached
four — four nullable back-pointer columns on `Task`, four hand-written "don't pile up" rules, three
copies of one opt-out. They now share `src/utils/generatedTasks.ts` (pure: the kinds, the registry,
the opt-out precedence, the lookups) and `src/store/generatedTaskSync.ts` (the create/update/delete).
**A fifth generator should need neither a column nor a reconcile** — just its own rules module and a
registry entry (#1524). `projectReview` is that fifth, and it cost exactly that: a rules module, a
registry entry, a firing beside the nudge's, and no `extrasFor` case in Settings at all.
`pantryCheck` is the sixth and cost the same; the one column it added
(`GroceryItem.pantryCheckDeclinedAt`) is on its *source* row, which is where every generator's
opt-out already lives.

- **`Task.generatedKind` + `Task.generatedSourceId` replaced `mealEntryId`/`groceryItemId`/
  `leftoverId`.** Those three columns are still on the table, backfilled from and then left
  unwritten, like `task_groups.completed_at` — the migrations array only appends. The backfill in
  `initDatabase` is guarded on `generated_kind IS NULL`, so it touches only legacy rows and is a
  no-op from the second launch (same shape as the `seen_at` one above it). It is the only thing
  standing between an existing install and every generated task reading as user-typed, so
  `database.test.ts` covers it directly.
- **The meal-plan nudge is in the mechanism despite having no source row.** `sourced: false` in the
  registry, and it keys on the kind rather than on `linkUrl` as it used to. The link still opens
  the Meal Plan screen; it just isn't the marker any more, so a task the *user* wrote pointing
  there no longer counts as the app's own. Legacy rows are backfilled off exactly that link, so the
  set it matches is unchanged.
- **It fires as a stack of seven — one task per day of the week it's asking about** — and that's
  what its `generatedSourceId` now holds: a **day key**, where it used to be null. Still not
  `sourced`; a day key names a square on the calendar, not a row, so `writeGeneratedOptOut` has an
  explicit `case 'mealPlanNudge': return` where the `!sourceId` guard used to cover it. Three
  consequences worth not re-deriving:
  - **`liveGeneratedTask` can't answer "is one still live"** — it defaults to matching
    `sourceId === null`, so it matches no nudge task at all now and would hand out a second stack
    every week. `liveGeneratedTasksOfKind` is the kind-only read, and
    `partitionMealPlanNudgeTasks` splits the result into the week being asked about (blocks a
    re-fire) and days that have already passed (deleted by the next firing). One ignored Saturday
    used to silence the nudge for good.
  - **One stack row is reused and retitled weekly**, its id in `mealPlanNudgeGroupId` — state, not
    a preference, like `mealPlanNudgeLastFiredWeekKey` beside it. A stack per firing would leave a
    year of empty stacks nothing prunes. Resolve-or-shrug: deleted stack reads as null, next firing
    makes another.
  - **All seven share the firing day's `dueDate`**, deliberately not their own day — the point is
    to plan next week *now*, and dated forward they'd be hidden by `isTaskVisible` until the week
    they were meant to prepare for had started.
- **The "n/3 planned" counter on those rows is derived, and its data is its own read.**
  `countPlannedSlots` counts distinct slots (there's no `UNIQUE(date, slot)`, so counting rows
  reports 4/3 for a day with two dinners) and ignores `snack` (a day isn't incomplete for want of
  one, and counting it makes 3/3 unreachable). It can't come from `useMealPlanStore.entries` —
  that's the single window MealPlanScreen owns, and the week a nudge asks about is never the week
  on screen, so a bare filter would report 0/3 across a fully planned week. Hence
  `plannedSlotCounts` + `refreshPlannedSlotCounts`, pulled by `useMealPlanNudgeProgress` rather
  than pushed by the ~15 mutators that would each need a line. **An absent count renders no chip**
  — "not looked yet" is a third answer and must not render as 0/3. Full day tints the checkbox with
  the timer's own `circleReady`; nothing ticks a task off by itself (see `timer.ts`).
- **Every read of `generatedSourceId` that means one particular kind goes through
  `generatedSourceOf(task, kind)`.** One column where there were three means two generators can
  hand out the same source id; without the kind check, ticking a leftover's task off could mark a
  *meal* cooked.
- **No generator re-dates a row on a reconcile unless its own date actually moved** (#1953). The
  `drift` callback is where this is enforced, per generator, because "its own date" means something
  different in each: `mealSlot` and `projectReview` never chase (the day is baked into the source id,
  or into the moment the offer was made), `leftoverUseUp` never chases either (its day is stamped
  from `getCurrentDayStart()`, so chasing it is chasing the clock), and `groceryUseUp` chases only
  when `expiresAt` has moved — which it reads off the task's own `deadline`, the field that records
  the expiry the day was last derived from. The failure mode is the same in every case and is worth
  recognising by shape: a reconcile that recomputes a date from something *other* than the source
  silently overwrites the one field the user is most likely to have changed by hand. It bit the
  leftover generator hardest because `reconcileAllLeftoverTasks` runs on every foreground, so a
  deferred "Use up X" came back onto Today at every launch; the grocery one only leaked through the
  mutations that reconcile without re-dating (un-opening a jar, the per-item switch). Deferring is
  the main thing anyone does to these rows, and `skipPostponeCount` means the app doesn't even
  notice it is undoing one.
- **`blocksOnFinished` is cook tasks only, and that asymmetry is the feature.** A meal is one
  event, so a completed cook task means the night happened and a second one would be an invention.
  A grocery item and a leftover are rows that come round again — reading the wide set there would
  mean a staple got exactly one use-up task, ever.
- **The per-source opt-out stays on the source row** (`MealPlanEntry.cookTask`,
  `GroceryItem.useUpTask`, `Leftover.useUpTask`), written by `deleteTask` and dispatched in one
  `writeGeneratedOptOut` switch. **Don't hoist it into a generic suppression record** keyed by
  `(kind, sourceId)`: that grows without bound, the same disease `remindersImportHandled` has and
  survives only by pruning to what the Reminders list still holds on every drain. A generic record
  has no equivalent pruning pass unless each generator supplies one, at which point it isn't
  generic. On the source row it's bounded for free — whatever deletes the source deletes the "no".
- **The settings keys stayed per-generator; only the UI merged.** One "Tasks the app adds" section
  (`GeneratedTasksSection`) lists all four, replacing three sections here and one in Notifications.
  Renaming `mealCookTasks`/`groceryUseUpTasks`/… to a generic pair would be a migration over
  preferences people have already set, for nothing a person can see. The section's *list* comes
  from the registry; its **controls are still hand-written JSX**, the same line `settingsIndex.ts`
  draws — a config able to express a toggle, a category grid, a day-count stepper, a weekday pill
  row and an inline time picker would be harder to read than the rows it replaced.
- **A generator break inside that card is a band, not a hairline** (`groupBreak`). With two
  generators on, the card runs to four rows apiece, and a hairline between one's "File them under"
  and the next one's name reads exactly like the hairline above it — the list stops saying where a
  generator ends.
- **`projectReview` replaced the quiet-projects banner, and that swap is the argument for the
  whole shape.** `ProjectNudgeBanner` was a strip above the Today list ("3 projects gone quiet",
  Review, ✕) and it worked; what was wrong with it is that it sat outside the flow the app is
  about. It couldn't be deferred, snoozed per project, given a reminder or found in Search, its
  only refusal was one global "not today" covering every quiet project at once, and it held the
  header slot above the pinned block whether or not now was the moment. A row can be put off till
  Saturday. **Don't bring the banner back** — `projectNudgeDismissedAt` and the accent
  `quietProjectCount` tint on the Today options row went with it; the "Pull from projects" row
  stays as the way in when you go looking.
  - **The task carries no `projectId`**, and that isn't tidiness. A dated member is exactly what
    makes a project *not* quiet, so filing the row into the project it describes deletes it on the
    next sweep and recreates it on the one after, for ever. It points at its project through
    `generatedSourceId` like every other generator points at its source.
  - **Its opt-out is a date, not a `false`** (`Project.reviewDeclinedAt`). The other four write a
    permanent "no" onto their source, which is right for a staple bought every week and wrong
    here: the only fields a project could carry that on are `nudgeOptIn`/`nudgeCadenceDays`, and
    both mean "never chase me about this again" — far more than a swipe says. Read through
    `isDismissedToday`, the same self-expiring stamp the banner's own dismissal used.
  - **Being ticked off counts as an answer, for the day** (`projectsReviewedToday`). Completing a
    task leaves nothing live, so without this the next foreground writes an identical row.
    `blocksOnFinished` is the mechanism's own answer and is too strong — a project goes quiet again
    every few months and must be able to ask again when it does.
  - **`dropGeneratedTask` now genuinely writes no opt-out.** It always claimed to drop "without
    deciding anything", but it routes through `deleteTask`, which stamps the source; that was
    harmless only because its original callers run *after* the source row is gone. This is the
    first generator whose source outlives its task, so the skip had to become explicit.
  - **It ships on, unlike the nudge beside it**, because it replaced a surface that was already
    there rather than adding one. The real gate is per-project and unchanged (`nudgeOptIn` +
    `nudgeCadenceDays`, both still "never ask" by default), so nobody sees anything new.
  - **Its "Quiet 21 days" chip is filled, and that's the row's marker.** These rows are the app's
    own offers sitting among tasks the user wrote, and at `textTertiary` the chip read as one more
    attribute — the same finding that made `autoScheduledLabel` ("Scheduled for you") the one accent
    chip on a task row. **Deliberately not a "Review" badge before the title**: that restates the
    title's own first word, and to avoid saying it twice the title would have to drop the verb,
    leaving the row reading "Kitchen renovation" (a task to *do* the renovation) on the widget, in
    Search and in the Logbook, none of which render a meta line. The fact the row already carries
    does the job. **And it stays this generator's alone** — a shared "the app wrote this" chip
    across all five was mocked and rejected: a planned week is seven cook tasks the user chose by
    planning the meals, and captioning every one of them is the noise `tripMarkerFor`'s
    silence-by-default rule exists to avoid.
  - **It's the one generator whose reconcile can't ride a source mutation.** A project goes quiet
    by time passing and stops being quiet when some *other* task gets a date, so the check runs on
    the launch sequence and the Today foreground sweep, and `staleProjectReviewTasks` is what
    clears a row whose reason has gone. It judges that against every stall, **not** against the
    capped set `wantedProjectReviews` returns: the cap decides who gets a *new* task when several
    projects are queued, and losing that contest is no reason to delete a row the user already
    deferred to Saturday. The cost, stated plainly: a review task can be stale until the next
    sweep, which the banner — being pure derivation — never could be.

- **`pantryCheck` is the sixth, and it fires on a *guess expiring* rather than on a source
  changing.** Nothing is ever taken out of the pantry, because there is no inventory to take it out
  of (see `docs/arch/groceries.md`): membership is `probablyHaveReason` recomputed on every read, and
  an item leaves it by that function starting to return null. Three of the four ways that happens are
  the user speaking; the fourth is the purchase reading's window running out, which changes no row
  and writes nothing. This offers to ask about exactly that, once.
  - **Structurally it is `projectReview`, one shelf over.** Same trigger shape (time passing, so it
    runs from the launch sequence and the Today foreground sweep), same clear-then-create ordering,
    same cap, same stale pass, and the same decision to decline with a *stamp* rather than a
    permanent `false` — the source earns the question again later, which is what `useUpTask: false`
    could not express.
  - **Its unit of "already answered" is the purchase, not the day.** A project stays quiet
    indefinitely, so `reviewDeclinedAt` lapses at the day boundary and the offer returns tomorrow;
    a cupboard question returning tomorrow is nagging. `pantryCheckDeclinedAt` is spent against the
    item's own `lastPurchasedAt`, so nothing has to clear it on a purchase the way `frozenAt`,
    `openedAt` and `runningLowAt` are cleared — a stamp older than the new purchase is already
    spent. Completions and archivings are read the same way, derived from the rows
    (`pantryCheckAnswers`) exactly as `projectsReviewedToday` is.
  - **Ticking it off is not an answer to the question, only to the task.** The row links to the
    item's own sheet, where "Got it" and "Out of it" live, and either makes the item stop wanting a
    check — so the task clears itself on the next sweep without the completion having to mean
    anything. Reading a tick as "yes I still have it" would write a claim the user never made, the
    same refusal `KitchenScreen` makes about closing a container out.
  - **Two gates keep it from being noise**, both in `pantryCheckTasks.ts`:
    `MIN_PURCHASES_FOR_CADENCE` (below three purchases the window is a flat fortnight standing in
    for a cadence nobody knows, and asking off the back of a number the app made up is how a
    generator gets switched off), and `PANTRY_CHECK_GRACE_DAYS` — without which the qualifying set
    on the day it ships is most of the catalog, back to the first trip ever recorded, and the cap
    would meter that out three at a time for ever. The grace bounds *raising* a question only:
    `stalePantryCheckTasks` judges a live row on the lapse alone, so a task deferred to Saturday
    isn't deleted for being a fortnight old.
  - **It ships off**, unlike `projectReview` beside it, which replaced a surface that was already
    on screen. This adds one.

## `mealSlot` — the fold that turned cook tasks into meal tasks

`mealCook` is retired. It is still in the `GeneratedKind` union (those are storage values, and rows
written before the fold still say it), `writeGeneratedOptOut` still has its case, and
`liveGeneratedTask` still matches it — but it is out of `GENERATED_KINDS`, nothing creates one, and
they drain within a day or two of ordinary use. `mealSlotTasks.ts` is what replaced it.

**The unit stopped being the meal and became the slot.** A cook task was projected from a
`MealPlanEntry`, so it could only exist where a meal had already been planned — which meant the day
the plan was blank was the day the task list said nothing at all. That is the day it is needed: at
noon with no answer, the app knew it had a meal planner, a recipe box, a fridge and a ranked list of
things to cook, and offered none of it from the list you were looking at. So the source id is now
`2026-08-22#lunch` — a day and a slot, a square on the calendar rather than a row.

**What's in the slot decides the steps**, and the task is a chain:

| The slot holds | The chain |
|---|---|
| nothing | Choose → Prepare → Eat |
| a recipe | Cook X → Eat X |
| a leftover, takeaway, a typed answer | Eat X (one step, so `chainEnabled: false`) |

"Already chosen" is the same task with its first step gone, not a different task — which is why the
table is read on every reconcile rather than only at creation. Six consequences worth not
re-deriving:

- **`completeTask` no longer clears `generatedKind` on a mid-chain spawn**, and that one-line change
  is what makes a chained generator possible at all. The clear's reasoning was always a *recurrence*
  one (a second occupant claiming a source the first already answered); a mid-chain step is the same
  run continuing, with exactly one row live at any point in it. Cleared, the task lost its identity
  at step two: no reconcile could reach it, its delete wrote no opt-out, and the next firing pass
  wrote a duplicate underneath it. The clear now stops at `!atChainEnd`, so a repeating chain still
  lets go at the wrap, which is a genuine new cycle.
- **The chain is only rewritten while `chainIndex === 0`.** Once a step has been ticked the
  remaining ones are the user's; a plan change mid-cook updates the title and the link and leaves the
  steps alone. Rewriting would have to remap the index onto a different-length list, and step 1 of
  [Choose, Prepare, Eat] has no honest answer in [Cook X, Eat X].
- **A high-water mark is the entire opt-out** (`mealSlotTasksWrittenThroughDayKey`). There is no
  row to stamp a "no" on, and a generic `(kind, sourceId)` suppression record is exactly what the
  note above forbids, because nothing prunes it. One string solves it instead: the pass only ever
  writes days *after* the mark, so a day it has covered is never revisited and a deleted row stays
  deleted. It also means each launch does one day's work rather than re-deciding the window, which
  is what makes it cheap enough to run on every foreground.
  - **The mark is never rewound**, and that is load-bearing rather than tidy: rewinding makes the
    next pass rewrite the window, and rewriting a window resurrects every row the user deleted in
    it. So switching a meal *on* in Settings calls `backfillMealSlotTasks([slot])`, which fills the
    already-written days with that slot alone. Without it a newly-named meal would produce nothing
    until the horizon rolled past the mark — a week of silence after answering a question.
- **The reconcile in `useMealPlanStore` never creates**, which is why it doesn't go through
  `reconcileGeneratedTask`. Creation belongs to `checkMealSlotTasks` alone — a reconcile that created
  on demand would hand back the row the user swiped away the moment they planned that meal from the
  Meal Plan screen. It is the update half only, and it runs for **both** slots on a move: the one
  the meal landed in and the one it left.
- **It doesn't chase the date.** The day is baked into the source id and never moves, so the only
  thing that can change `dueDate` is the user deferring the row — and rewriting that back onto today
  is the one thing this must not do. `projectReview` draws the same line for the same reason.
- **A week at a time** (`MEAL_SLOT_TASK_DAYS`), matching the meal plan's own `upcomingDays` and the
  horizon the weekly nudge asks about. This shipped as today-only, on the grounds that a week of
  rows saying "Choose lunch" would be noise; it isn't, because those meals genuinely are undecided
  and a Later screen that says so is being accurate. What the narrower version actually cost was the
  honest half — a meal you *had* planned had something to say ahead of time, exactly as a cook task
  did, and no row to say it on.

`MealPlanEntry.cookTask` survives the fold unchanged — it is still the per-meal "no", read by both
the pass and the reconcile, and the one thing a meal task inherits from the cook task it replaces.
The settings keys survive too (`mealCookTasks`, `mealCookTaskCategory`): renaming them would be a
migration over preferences people have already set, for nothing a person can see. What is new is
`mealSlotsEnabled`, which is the only thing the app can't work out for itself — it knows what you
planned, never what you skip.

**Completion moved one step later.** A cook task answered "did this happen" by existing; a chain's
first tick is "I have decided what to have", which is nowhere near having had it. So only the step
that ends the chain stamps `cookedAt` (`completesMealSlot`), and marking a meal cooked from the Meal
Plan screen walks the whole remaining chain rather than ticking one step and leaving "Eat dinner"
outstanding on a night already logged.

**The picker is reached by link, not hosted on Today.** An unanswered slot's `linkUrl` carries
`&pick=<slot>`, which `openInAppUrl` routes to the Meal Plan screen with `RecipePickerSheet` already
open on the right slot — the same call `projectReview` makes in reverse. A second copy of that sheet
over Today would be a second place for "what am I eating" to be answered, which is how two of these
drift apart. The link's slot beats the sheet's remembered one (`forceSlot`): "Choose lunch" named
the slot before the sheet opened.

- **They still write straight to Today**, rather than proposing into a review surface the way
  `deloadPlan`/`projectPull` do. That fork is real and was deliberately left alone here: it's a
  product decision about all four at once, and this refactor is what makes it a change in one
  place instead of four.
