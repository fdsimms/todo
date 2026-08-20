# Generated tasks: the five things that write a task unattended

The shared mechanism behind cook tasks, use-up tasks, the meal-plan nudge and
project reviews. Read this before adding a sixth generator: the whole point of
the refactor it describes is that a new one costs a rules module and a registry
entry, not a column.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## Generated tasks — the five things that write a task unattended

A planned meal becomes "Cook X", a perishable grocery and an ageing leftover each become "Use up
X", an opt-in weekly trigger becomes "Plan meals for…", and a project that has gone quiet becomes
"Review X". The first four were each built by copying the last, which is fine twice and had reached
four — four nullable back-pointer columns on `Task`, four hand-written "don't pile up" rules, three
copies of one opt-out. They now share `src/utils/generatedTasks.ts` (pure: the kinds, the registry,
the opt-out precedence, the lookups) and `src/store/generatedTaskSync.ts` (the create/update/delete).
**A fifth generator should need neither a column nor a reconcile** — just its own rules module and a
registry entry (#1524). `projectReview` is that fifth, and it cost exactly that: a rules module, a
registry entry, a firing beside the nudge's, and no `extrasFor` case in Settings at all.

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

- **They still write straight to Today**, rather than proposing into a review surface the way
  `deloadPlan`/`projectPull` do. That fork is real and was deliberately left alone here: it's a
  product decision about all four at once, and this refactor is what makes it a change in one
  place instead of four.
