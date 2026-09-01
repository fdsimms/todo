# Generated tasks: the seventeen things that write a task unattended

The shared mechanism behind meal tasks, use-up tasks, the meal-plan nudge,
project reviews, pantry checks and the pantry review, supply reorders, the
daily calendar review, birthdays, the reach-out nudge and weather-matched
tasks.
Read this before adding an eighteenth generator: the whole point of the refactor
it describes is that a new one costs a rules module and a registry entry, not a
column.

The prose below walks the generators in the order they were added. It had
fallen a generator behind once already (`reachOut` shipped without an entry,
leaving this file claiming eleven while twelve were listed), so when adding one:
`GENERATED_KINDS` in `src/utils/generatedTasks.ts` is the authoritative list,
and the count in the two headings above is derived from it rather than from the
number of sections here.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## Generated tasks — the seventeen things that write a task unattended

Each meal of the day becomes a task, a perishable grocery and an ageing leftover each become "Use up
X", an opt-in weekly trigger becomes "Plan meals for…", a project that has gone quiet becomes
"Review X", a grocery whose pantry guess has run out becomes "Check if you still have X", a task's
supply running low becomes "Order more X", and (once a day, when tomorrow has anything on it) the
calendar becomes "Review tomorrow's calendar". The first four were each built by copying the last,
which is fine twice and had reached four — four nullable back-pointer columns on `Task`, four
hand-written "don't pile up" rules, three copies of one opt-out. They now share
`src/utils/generatedTasks.ts` (pure: the kinds, the registry, the opt-out precedence, the lookups)
and `src/store/generatedTaskSync.ts` (the create/update/delete).
**A fifth generator should need neither a column nor a reconcile** — just its own rules module and a
registry entry (#1524). `projectReview` is that fifth, and it cost exactly that: a rules module, a
registry entry, a firing beside the nudge's, and no `extrasFor` case in Settings at all.
`pantryCheck` is the sixth and cost the same; the one column it added
(`GroceryItem.pantryCheckDeclinedAt`) is on its *source* row, which is where every generator's
opt-out already lives. `supplyReorder` is the seventh, sourced from a task rather than a row in
another store — see `src/utils/supply.ts` for its own rules. `calendarReview` is the eighth and adds
no column at all: its source is tomorrow's day key rather than a row, so its opt-out is a
settings-level mark (`calendarReviewLastDayKey`) rather than a stamp anywhere — see the section
below. `birthday` is the ninth (`src/utils/birthdayTasks.ts`). `mealShortfall` is the tenth, and is
the first whose *source row* is one the user edits freely and often — which is why its entire
staleness rule is the creation predicate re-run, rather than a list of mutations to intercept; see
the section below. `birthdayGift` is the eleventh, and costs no rules module of its own at all —
it lives beside `birthday` in the same file and reuses every rule but the lead time and the title.
See `docs/arch/people.md`'s "The birthday-gift task" for why it ships off where `birthday` ships on.

`moodLog` and `moodNudge` are the sixteenth and seventeenth, and they share a
file (`src/utils/moodTasks.ts`) and a firing pass the way `birthday` and
`birthdayGift` share theirs — one subject, two lead-ins, read together in
Settings. Both are day-keyed with no source row, so both use a settings-level
mark rather than a stamp on anything (`moodLogLastDayKey`,
`moodNudgeLastDayKey`), the position `calendarReview` is already in.

**`moodNudge` is the first generator whose trigger is a trend in the user's own
answers** rather than a date, a row, or a threshold crossed once — which makes
it the only one that can be wrong about a *person* rather than about their data.
It never names a feeling back at the user, it fires at most once a week, and it
counts only logged days, so a fortnight away neither builds a run nor breaks
one. Those three rules and the reasoning behind them are in
`docs/arch/mood-log.md`; don't relax one without reading it.

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
- **Those rows are notices** (`notice: true`, see the bullet below): the counter chip and the link
  to that day on the Meal Plan screen are the whole row, and it carries none of the controls that
  would reschedule, duplicate, pin or edit it. It's the notice with nothing left in its panel, so
  it doesn't expand.
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
  `GroceryItem.useUpTask`, `Leftover.useUpTask`), written by `deleteTask` and `bulkDeleteTasks` and
  dispatched in one `writeGeneratedOptOut` switch — both take a `skipGeneratedOptOut` option for the
  app's own housekeeping deletes (`dropGeneratedTask`, `sweepExpiredTasks`), which aren't the user
  declining anything. A selection-bar delete of a live nudge is exactly as much an instruction to
  the source as the single-row path, and for a while only the latter wrote it: bulk-deleting a
  "Catch up with Sarah" task removed the row but handed back an identical one on the next sweep.
  **Don't hoist it into a generic suppression record** keyed by
  `(kind, sourceId)`: that grows without bound, the same disease `remindersImportHandled` has and
  survives only by pruning to what the Reminders list still holds on every drain. A generic record
  has no equivalent pruning pass unless each generator supplies one, at which point it isn't
  generic. On the source row it's bounded for free — whatever deletes the source deletes the "no".
- **Two of them are `notice: true`, and that flag is about the row rather than the generator.**
  `calendarReview` and `mealPlanNudge` ask about a day instead of being a piece of work, so
  `TaskItem` drops every control that treats one as something to plan: the reschedule chip and the
  swipe that opens the same picker, duplicate, the pin, Edit, renaming the title in place, and the
  "Add subtask" field. What stays is the checkbox, the meta chips and the link button, because that
  is how a notice is read and answered. `isNoticeTask` is the read and `TaskItem` is the only
  caller — creation, reconciling and the opt-out are untouched by it.
  - **Being generated is not what makes a row a notice.** The other twelve keep everything. A
    `pantryReview` deferred to Saturday is that generator working as designed, a `weather` rule's
    "put on sunscreen" and a `birthdayGift` are ordinary tasks with an unusual author, and
    deferring a use-up task is the main thing anyone does to one (see the re-dating note above).
    The test is whether there is anything to decide about the row, not who wrote it. Both of these
    pass it the same way: day-keyed with no source row, a title that never varies, and nothing a
    later date could mean — next Monday's nudge is next week's own write, not this one moved.
  - **The panel can end up empty, and then the row doesn't expand at all.** A review task's panel
    is its event list and nothing else now; a nudge's is nothing whatsoever, its detail being the
    Meal Plan screen one tap away on the link button. So `handleContentPress` refuses to expand a
    notice with no notes, no subtasks and no inline block of its own (`expandable`), rather than
    animating a card open onto blank space and spotlighting the list to do it. The row still marks
    itself seen on that tap: it was read.
  - **A notice that already has subtasks still lists them**; only the add field goes. Nothing
    creates one, but a row somebody put a subtask on before this treatment existed must not have it
    hidden, because hidden is lost.
  - **`panelSectionAbove` is the cost of dropping the subtask section.** Every section in the
    expanded panel draws its own top border, which was unconditional only because the always-there
    add-subtask field guaranteed something above it. It is one boolean rather than a running count
    because a notice's panel can hold only its notes and its own block: no notice kind is timed, a
    quota, recurring, chained or in a series. A notice kind that grew one of those would need this
    to become a count.
- **The settings keys stayed per-generator; only the UI merged.** One "Automatic tasks" section
  (`GeneratedTasksSection`) lists all four, replacing three sections here and one in Notifications.
  (It shipped as "Tasks the app adds" and was renamed in #2155; the patch-notes entries naming the
  old title are a record of what it was called then and stay as they are.)
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

- **`reachOut` is the twelfth, and it is `projectReview` one shelf over.** A person somebody asked
  to be reminded about, who it has been a while since they saw, becomes "Catch up with Ansley".
  **The reasoning lives in `docs/arch/people.md`'s "The reach-out nudge"** and is not repeated here:
  that file holds the rules about what this feature may never do, and they are what shaped every
  choice below. What belongs here is only how it sits in the mechanism.
  - **Sourced on the person**, so its opt-out is an ordinary stamp on the source row
    (`Person.reachOutDeclinedAt`), the bounded-for-free placement this doc asks for — whatever
    deletes the person deletes the "no".
  - **The stamp holds for a week rather than a day**, which is the one place it departs from
    `projectReview`'s self-expiring decline. A project put off is still sitting in your work; a nudge
    about a friend returning tomorrow morning reads as the app disagreeing with you about a
    friendship. `declineHoldDays` takes the shorter of a week and the person's own cadence, so
    somebody on a four-day cadence is not silenced for seven by one swipe.
  - **The cap is two, and the tie deliberately does not break on longest-since.** Sorting the due set
    by who you have neglected most is the obvious answer and is exactly what `people.md` rules out,
    even done invisibly. It breaks on `sortOrder` — the hand drag on the People screen — because that
    is the only ranking of people the feature is allowed to contain, being the one somebody made on
    purpose.
  - **Its stale pass judges against the uncapped due set**, not against the two `wantedReachOuts`
    returns. The cap decides who gets a *new* row when several people are due; losing that contest is
    no reason to delete a row the user already deferred. Same split `staleProjectReviewTasks` and
    `stalePantryCheckTasks` both draw, and the same `dropGeneratedTask` so the app's own tidying up
    never writes the source's decline.
  - **The task carries no `personIds`**, for the reason `projectReview` carries no `projectId`:
    filing it under the person it names would let ticking it off reset the very clock that wrote it,
    without anybody having actually reached out. It points at its person through
    `generatedSourceId` like every other generator points at its source.
  - **It ships on**, like `projectReview` and for its argument: the real gate is per-person
    (`nudgeOptIn` + `cadenceDays`, both off on everybody), so an install where nobody has been opted
    in sees nothing new. The setting only decides whether the pass runs at all.

- **`pantryReview` is the thirteenth, and it is `calendarReview` one shelf over, not `pantryCheck`.**
  It asks the drip's question in bulk: one row, "Review what's in the pantry", opening a swipe deck
  over everything the app is currently unsure about (see `docs/arch/groceries.md` for the deck
  itself). Its source is the day key the offer was raised on rather than a row — there is no single
  item it is about — so there is no per-source qualifying predicate, no capped set, and nothing a
  stamp could live on.
  - **It divides from `pantryCheck` on the size of the doubt, and the split is the point.** Below
    `MIN_PANTRY_REVIEW_CARDS` (5) the drip says more: the row names the thing, and one tap on the item
    sheet answers it. Past it, three rows about individual shelves of a cupboard that is doubtful in
    eleven places is the flooding `MAX_PANTRY_CHECK_TASKS` exists to prevent, metered out three at a
    time instead of arriving at once. So `checkPantryCheckTasks` stands down entirely while a review
    row is live, and every call site fires the review pass **first** so the suppression lands in the
    same sweep rather than one behind it.
  - **The suppression is the create half only.** Drip rows raised before the review appeared are left
    alone — a deferred one is the user's — and they clear themselves for free as the deck is
    answered, because a card answered makes its item's lapse null, which is exactly what
    `stalePantryCheckTasks` tests. That is a nicer property than it looks: the two generators tidy up
    after each other without either knowing the other's rules.
  - **`pantryReviewLastDayKey` does two jobs**, where `calendarReviewLastDayKey` does one. It is the
    same unconditional "this day has been considered" mark, recorded before the deck is judged so a
    swiped-away row is not re-diagnosed on the next foreground — *and* it carries the cadence, since
    the check reads it as "how long since the last offer" rather than testing it for existence. There
    is no purchase to spend a decline against the way `pantryCheckDeclinedAt` does (this is about the
    whole catalog, not one row), so a plain `PANTRY_REVIEW_CADENCE_DAYS` is what keeps a cupboard
    question from coming back tomorrow and nagging.
  - **One row at a time.** A live review row a fortnight old means the offer was ignored or deferred,
    and a second is the pile-up every generator here has a rule against — so the pass returns rather
    than raising another, with the mark freshly refreshed so the next offer is a cadence out.
  - **Its stale rule is an empty deck, not `wantsPantryReview`.** That threshold decides whether to
    *raise* an offer; a row already raised and deferred to Saturday must not be deleted because the
    user answered enough cards to put the deck under five, which would be the app taking the question
    back the moment it started being answered. Same split `stalePantryCheckTasks` draws against
    `PANTRY_CHECK_GRACE_DAYS`, and `staleProjectReviewTasks` against its own cap.
  - **It has its own category setting**, unlike `calendarReview` which shares one. That kind shares
    `calendarEventCategory` because the events it describes are already filed by it, so a second
    setting could only agree or contradict. Here there is no prior owner, and sharing
    `pantryCheckTaskCategory` would mean turning this on while the drip is off leaves it with nowhere
    to file — an uncategorized task renders loose at the very top of Today, which is exactly where
    these must not go.
  - **It ships off**, like `pantryCheck` and `mealShortfall`, for their reason: it adds a surface
    rather than replacing one that was already on screen.

- **`calendarReview` is the eighth, and it's structurally `mealPlanNudge` one shelf over, not
  `projectReview`/`pantryCheck`.** Its source is tomorrow's day key rather than a row (a square on
  the calendar, not something a stamp can live on — the position the nudge is already in), so there
  is no per-source qualifying predicate, no capped set, and no stale-vs-still-qualifies distinction
  to draw: there is exactly one task, asking about exactly one day, and the only question is whether
  that day has anything on it (`wantsCalendarReview`, in `calendarReviewTasks.ts`).
  - **`calendarReviewLastDayKey` is the opt-out, and it has to do more work than
    `mealPlanNudgeLastFiredWeekKey`.** The nudge's mark only ever prevents a second stack the *same*
    week; nothing deletes a nudge task early enough for the mark to also need to block a recreate.
    This generator's does: with no source row, nothing else stands between a swiped-away task and an
    identical one on the very next foreground sweep (see `writeGeneratedOptOut`'s `calendarReview`
    case, which — like the nudge's — writes nothing). So the mark is recorded unconditionally the
    moment a day is considered, *before* the "does tomorrow have anything on it" check, and covers
    every outcome: created, or found empty. A day already marked is never re-diagnosed, whatever the
    mark's reason.
  - **It reuses `calendarEventCategory` rather than owning a category of its own**
    (`GeneratedKindSpec.categorized: false` — the one so far). The task and the events it's asking
    about are one subject to the person reading the list, and a second "File them under" setting
    would only ever be able to agree with the first or contradict it. `ensureGeneratedTaskCategory`
    and the two switches in `useCategoryStore.ts` it dispatches through both return early for this
    kind rather than gaining a real arm — there is nothing of its own to ensure or point at.
  - **It fires on time passing, from the same two places `pantryCheck` does** (the launch sequence
    and the Today foreground sweep) — but unlike every other generator, it reads state
    (`useCalendarStore`) that nothing in the launch sequence populates synchronously; the window is
    filled by `useCalendarSync`'s own effect. In practice the launch-sequence firing is close to a
    no-op on a cold start and the foreground sweep does the real work, reading whatever the calendar
    store already has rather than triggering a fresh read itself — the same staleness tolerance
    every other `useCalendarStore` reader (`TodayScreen`'s event rows, time-block scheduling)
    already lives with.
  - **Its row is a notice** (`notice: true`, see the shared bullet above): the events it lists are
    the whole of its expanded panel, and none of the controls that would reschedule, duplicate, pin
    or edit it are offered, because there is no version of "tomorrow's calendar, on Thursday".
  - **It's the one generator gated on `isDemoModeActive()`.** Every other generator's qualifying
    condition is a row in the demo's own throwaway database; this one's is the real device calendar,
    which demo mode must never read from or expose the existence of. The demo's own example task is
    seeded directly in `demoSeed.ts`, the same way `pantryCheck`'s is, rather than left to the real
    sweep.

- **`weather` is the fourteenth, and it's `calendarReview` one shelf over — a rule the user wrote
  matched against a day-keyed reading, rather than a fixed question about a fixed source.** "On a
  sunny day, put on sunscreen" becomes a task the same way "tomorrow has events" does: no source
  row, a settings-level idempotency mark instead of a per-row stamp, and creation through the
  shared `reconcileGeneratedTask`. What's new is that there can be several such rules at once
  (`src/utils/weatherTasks.ts`, `WeatherRule` in `types/index.ts`), each independently askable —
  which is what pushes its source id one level deeper than a plain day key.
  - **The source id is `${dayKey}#${ruleId}`, and the rule id is what keeps two rules from
    colliding on the same day.** `calendarReview` gets away with a bare day key because it asks
    exactly one question a day; a weather rule set can ask several ("sunny → sunscreen" and "cold
    → coat" can both be true of the same clear, chilly morning), and each needs its own row.
  - **Each rule carries its own `lastFiredDayKey`, rather than one shared settings field.**
    `calendarReviewLastDayKey` is a single scalar because there's a single question; here the mark
    has to be per-rule, so it lives on the rule object itself — the same place `pantryCheck`'s
    stamp lives on its source row, and bounded for the same reason: deleting the rule deletes the
    mark with it, no separate pruning pass required. Written unconditionally before the day's
    weather is even checked, the same order `calendarReviewLastDayKey` is written in, so a task
    swiped away doesn't come straight back on the next foreground sweep the same day.
  - **`writeGeneratedOptOut` has nothing to write for this kind either, and for the identical
    reason `calendarReview` has nothing: the "source" is a rule living in settings, not a row.**
    The per-rule mark above is what stands between a delete and a recreate, not an opt-out stamped
    by the generic mechanism.
  - **The reading itself lives in `useWeatherStore`, not in the check function.** Same split
    `useCalendarStore` draws against `checkCalendarReviewTasks`: a small in-memory store
    (`src/store/useWeatherStore.ts`) owns asking the device for a location and asking Open-Meteo
    what the weather is there, refreshed once a day on the same three triggers `useCalendarSync`
    settled on (mount, a relevant settings change, foreground). `checkWeatherTasks` only ever reads
    whatever snapshot is already there — it never fetches — so a cold launch before the first fetch
    resolves finds nothing to do, exactly as `calendarReview` does before `useCalendarSync`'s first
    read lands.
  - **No key, and that's a deliberate choice of provider, not an oversight.** Open-Meteo's forecast
    API needs none, which is the same "no key, no traffic" shape Open Food Facts plays as the
    keyless member of the barcode chain in `productLookup.ts` — made here the *only* source rather
    than a fallback among paid ones, because a weather feature that needed a key pasted into
    Settings would be inert for everyone who never does that, and nothing about checking the
    weather is genuinely provider-specific the way the Anthropic calls are.
  - **Location is read-only from this generator's side — it never requests permission.**
    `getCurrentLocation()` (`src/utils/weatherLocation.ts`) answers null if permission isn't
    already granted rather than prompting; asking is a Settings action, from a row in the rule
    sheet, the same "a background sweep doesn't ask, a person does" line `useCalendarSync`'s own
    `refresh()` draws.
  - **It ships off**, like `pantryCheck` and `pantryReview`, and for a reason of its own on top of
    theirs: it's the one generator that also wants a location fix, which is not something to start
    reading without being asked.

- **`mealShortfall` is the tenth, and it fires on a *meal coming into range*.** Planning a week
  has never required owning any of it, so a dish you can't cook was indistinguishable from one you
  can right up until the night. `mealPlanGroceries.ts` has been able to answer "what's missing for
  this meal" since the add-to-list sheets shipped; the only thing absent was something to say it
  unprompted, on a day you have no reason to be thinking about Thursday.
  - **Structurally it is `pantryCheck`, one shelf over** — same trigger shape (time passing, so it
    runs from the launch sequence and the Today foreground *and* on focus), same clear-then-create
    ordering, same cap of three, same `dropGeneratedTask` so the app's own tidying up never writes
    the source's opt-out.
  - **Its whole answer to a meal plan being a thing people re-plan is that the clear pass re-runs
    the create predicate.** A week can change ~15 ways and none of those mutations knows a row is
    sitting on Today naming the old dish — wiring each one is the "four call sites and still missed
    one" the stacks note warns about. So `staleMealShortfallTasks` asks the creation question again
    and every plan change falls out for free: entry deleted (the lookup misses), recipe swapped or
    swapped for free text, ingredients bought or added to the list, marked cooked, moved out of
    range. A meal merely *renamed* is chased by `drift` instead, the same split
    `staleProjectReviewTasks` draws.
  - **The window is the reason, not a grace period**, and that is the one place it departs from
    `pantryCheck`. `PANTRY_CHECK_GRACE_DAYS` bounds *raising* a question and deliberately doesn't
    judge a live row, since a question already asked doesn't expire. Here the window is the entire
    justification (this task exists because a meal is imminent), so a meal that stops being imminent
    takes its task with it in both directions: pushed to next week the shop is premature, and once
    the day has passed it is moot.
  - **It reads one day wider than the window on each side.** A task whose entry isn't in the set at
    all is treated as a deleted meal, which for one merely dragged to next week would be the right
    answer by luck rather than by reading its new date.
  - **The qualifying set is every `needToBuy` row, `known` ones and not** — the opposite call
    `restockRows` makes, and deliberately. That one narrows to `known` because after a cooking, a
    recipe naming an item the app has never seen says nothing about whether the cook needs to buy
    it; shopping *ahead* inverts it, since an item never bought is exactly what will be missing.
    More to the point, `needToBuy` is what the add-to-list sheet this task links to already offers
    pre-ticked, so narrowing here would let the row disagree with the sheet it opens — the one thing
    `hasShoppableMeals` exists to prevent.
  - **A finished one blocks for ever** (`blocksOnFinished`), alone among the generators still
    firing. A meal is one event: having shopped for Tuesday's ragù, a second row would be an
    invention. That is the reading cook tasks had, inherited because the source is the same kind of
    thing — a night that happens once — not by copying.
  - **Its opt-out is a permanent `false`, not a self-expiring stamp** (`MealPlanEntry.shopTask`,
    beside `cookTask` and exactly its tri-state). `projectReview` and `pantryCheck` both decline
    with a stamp because their sources come round again on their own; a meal on the 22nd does not,
    so "I'm buying this fresh on the day" is an answer about that night and nothing else. It stays
    bounded for free, since whatever deletes the meal deletes the "no".
  - **It narrows `wantsGeneratedTask` rather than reusing it**, which is the one liberty taken with
    the shared plumbing. That helper lets an explicit `true` spawn a task with the source not
    qualifying — right for a cook task, wrong for one whose entire content is a list of things you
    are missing. It would also thrash: the stale pass judges on the shortfall alone, so the create
    pass would write the row and the clear pass delete it, once per sweep, for ever. `shopTask` only
    ever subtracts, and both passes read it.
  - **It ships off**, like `pantryCheck` and for its reason plus one of its own: this reads a plan
    people keep loosely, and a half-filled week answered with shopping rows is the fastest way to
    have the whole thing switched off.

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
- **The row says which meal it is, in the meta line rather than in the title** (`mealSlotOf`, read
  off the source id — no store lookup). Only an unanswered slot names its meal in its own steps
  ("Choose lunch"); the moment something is planned the title becomes the food, and a day's three
  rows sit together under one category with nothing telling them apart. It's a chip beside the
  scheduled one rather than a longer title because the title is also what Search, the Logbook and
  the widget show, and "Cook Peanut Butter Tofu with Sriracha for dinner" wraps to two lines on a
  390pt row. The glyph is `MEAL_SLOT_ICONS`, shared with the Settings row that switches the meal
  on — one meal wearing two glyphs on two screens is the drift the shared primitives exist to stop.
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

**The picker opens two ways, and both mount the same `RecipePickerSheet` — there still isn't a second
one.** An unanswered slot's `linkUrl` carries `&pick=<slot>`, which `openInAppUrl` routes to the Meal
Plan screen with the sheet already open on the right slot — the same call `projectReview` makes in
reverse, and the way to browse or replan the rest of that day alongside this one. Completing the row's
own "Choose" step is the second way: `completionTapFor` returns `'pick-meal'` for it (checked via
`activeMealSlotStepId(task)?.endsWith('-choose')`, always index 0 by construction), and both checkbox
owners — `TaskItem.handleComplete` and `TaskCheckbox.runPress` — short-circuit on that the same way they
already do for `asksOnComplete`/`'ask'`, mounting `RecipePickerSheet` locally instead of running the
ordinary completion, with `dayKey`/`forceSlot` read off `parseMealSlotSource(task.generatedSourceId)`
rather than off navigation params. **Nothing is completed by picking.** `planMeal`'s reconcile rewrites
this same row from "Choose lunch" into "Cook X"/"Eat X" (`mealSlotDrift`, since `chainIndex` is still 0)
exactly as it would if the pick had come from the Meal Plan screen — the checkbox tap never reaches
`completeTask` at all. This is a deliberate reopening of the objection above, not a lapse of it: the
thing that made a second copy wrong was a second *browsing* surface holding its own idea of what
"today" is, and this isn't one — it's the identical component, given the one day+slot the row already
names, with the sheet's own session state (`lastPickedSlot`, `planned`) starting fresh on each mount
either way. The link's slot still beats the sheet's remembered one (`forceSlot`) from either entry
point: "Choose lunch" named the slot before the sheet opened.

- **They still write straight to Today**, rather than proposing into a review surface the way
  `deloadPlan`/`projectPull` do. That fork is real and was deliberately left alone here: it's a
  product decision about all four at once, and this refactor is what makes it a change in one
  place instead of four.

**An answered slot with a recipe to cook links to the recipe, not the meal plan day.** Until now
`linkUrl` always opened the day on the Meal Plan screen — right for a leftover or a typed answer,
which have nothing else to show, but wrong for "Cook X": the row exists to point at the thing you're
about to do, and the meal plan names the meal without showing what's in it. `mealSlotLinkUrl` now
reads the entry (`recipeLinkUrl`, `dundundun://recipe?id=…`, parsed by `deepLinks.isRecipeUrl` /
`recipeUrlId` into `resetToRecipeDetail`) whenever `entry.recipeId && !entry.leftoverId` — exactly
the condition `mealSlotChain` already uses to decide whether there's a Cook step at all. The link is
carried unchanged into "Eat X" (`mealSlotDrift` writes `linkUrl` unconditionally, not just at
`chainIndex === 0`): it's the same dish either way, and there's no second field to hold two
destinations for one row. The picker link for an unanswered slot, and the meal-plan link for a
leftover/takeout/typed answer, are unchanged.

## `screenTime` — the fifteenth, and the second rule the user wrote

"After 30 minutes on the apps I picked, add a task to take a walk." Structurally it is `weather`
(`src/utils/screenTimeRules.ts` is `weatherTasks.ts` with the condition swapped for a number), and
the differences all come from one place: **the app cannot see usage.**

- **The decision isn't the app's.** `weather` reads a forecast and applies the rule itself.
  Here the app arms iOS with a threshold and is told, later and in another process, that it was
  crossed. So `checkScreenTimeTasks` walks the *crossings* rather than the rules, and there is no
  classifier — nothing here corresponds to `weatherCondition.ts`, because there is no reading to
  classify. Usage figures exist only inside a `DeviceActivityReport` extension, which is sandboxed
  with no route back to the app; what a `DeviceActivityMonitor` extension gets is which event
  tripped, not by how much.
- **The idempotency mark can't be spent before the decision.** Every other day-keyed generator
  writes its mark ahead of the qualifying check, so a swiped-away task can't return the same day.
  That order is unavailable when the deciding happens in the OS: `ScreenTimeRule.lastFiredDayKey`
  is written when a crossing is *turned into* a task. There is no "considered and found not to
  apply" case to mark, because a rule that didn't trip produces no crossing at all.
- **Every rule watches one app selection**, and it is not stored in the rule. iOS hands back opaque
  `ApplicationToken`s that only SwiftUI can render, so the picked set lives in the App Group and
  rules differ by threshold and title alone. This is also why the picker sits above the rule list
  rather than inside a rule: a per-rule set of apps isn't a design that was passed over, it isn't
  available.
- **`thresholdMinutes` is per-rule**, which is the one place this deliberately departs from
  `weatherCondition.ts`'s refusal to expose a threshold per rule. That refusal rests on the title
  saying what the bar is for ("Put on sunscreen" wants a lower one than "Bring a heavy coat"). The
  move isn't available here: the number *is* the rule, and 30 and 90 minutes over the same apps are
  an ordinary pair to want.
- **The day key is stamped by the app, not the extension.** The extension has no access to
  `dayResetTime` and `Date()` there is the calendar day, so a crossing would be filed a day early
  for anyone whose day starts at 4am. The app writes the logical day when it arms the monitor and
  the extension reads it back; a crossing with no day to file under is dropped rather than guessed.
- **It ships off**, like `weather` and `pantryCheck`, and for a reason on top of theirs: it wants a
  Screen Time authorization the app doesn't hold. Asking is a Settings action, from the rules
  sheet — never something a sweep does.
- **It is the second generator gated on `isDemoModeActive()`**, and the gate matters more here than
  it does for `calendarReview`. Crossings are drained *destructively* from the OS, so acting on them
  against a database about to be discarded wouldn't merely write fiction, it would lose the crossing
  outright. Both halves refuse: `screenTimeBridge()` won't drain, and `checkScreenTimeTasks` won't
  run. The demo's own example task is seeded directly in `demoSeed.ts`.
- **It does not gate on vacation mode**, following `weather` rather than `mealPlanNudge`. A rule
  about your own phone use is sunscreen, not work: vacation is exactly when somebody might want it.
