# Generated tasks: the things that write a task unattended

The shared mechanism behind every task the app writes without being asked: meal
tasks, use-up tasks, the meal-plan nudge, project reviews, pantry checks, supply
reorders, the calendar review, birthdays, weather, Health and Screen Time rules,
the mood check-ins and the rest. Read this before adding a generator: the whole
point of the refactor it describes is that a new one costs a rules module and a
registry entry, not a column.

**`GENERATED_KINDS` in `src/utils/generatedTasks.ts` is the list of generators**,
and `GENERATED_KIND_SPECS` beside it holds each one's flags (`pausedOnVacation`,
`notice`, `kitchen`, `sourced`, its setting and its default category). This file
deliberately states no count and no "the Nth generator": both went stale every
time one shipped. Most generators have a section below; when adding one, add a
section, and describe it by what it is rather than by where it falls in the order.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are strong defaults with the reasoning
attached: read the reason before deviating from one. Where this note and the
code disagree, the code is what ships, so fix the note.

---

## The shared mechanism

The first four generators were each built by copying the last: four nullable back-pointer columns
on `Task`, four hand-written "don't pile up" rules, three copies of one opt-out. They now share
`src/utils/generatedTasks.ts` (pure: the kinds, the registry, the opt-out precedence, the lookups)
and `src/store/generatedTaskSync.ts` (the create/update/delete). **A new generator needs neither a
column nor a reconcile of its own** (#1524): a rules module, a registry entry, and a firing in
`maintenancePasses.ts` beside the others. Where it needs an opt-out stamp, that goes on its
*source* row (`GroceryItem.pantryCheckDeclinedAt`, say), which is where every generator's opt-out
lives. A generator with no source row (`calendarReview`, `mealPlanNudge`, the mood check-ins:
anything keyed by a day) keeps a settings-level mark instead (`calendarReviewLastDayKey`).
Two generators that share a subject can share a rules module and a firing pass (`birthday` and
`birthdayGift` in `birthdayTasks.ts`; `moodLog` and `moodNudge` in `moodTasks.ts`).

**Every generator's switch and every rule list syncs** (`SYNCED_SETTING_KEYS`), so a second phone
starts with the person's automations and the MCP server can change them (`docs/arch/mcp-server.md`).
A new generator's `enabledKey` goes on that list; `generatedSync.test.ts` fails until it does. A rule
list is one row, so edits on two devices at once keep the later one, and a rule's day mark travels
with it, which also keeps two phones from firing one rule twice on one day.

What kind of trigger a generator answers is worth naming, because a few are unusual and their rules
follow from it: most fire on a date or a source row; `mealShortfall` and `mealLogNudge` re-run their
creation predicate against a row the user edits freely; `weighIn` fires on the *absence* of data
(it reads Apple Health the way `health` does and is deliberately not part of it, because one reacts
to a reading and the other asks for one); `moodNudge` fires on a trend in the user's own answers;
and `weekendNudge` asks about a span of days rather than one. See each one's section.

`journalLog` and `dreamLog` (`src/utils/journalTasks.ts`, fired by
`checkJournalTasks`) are `moodLog`'s shape over the journal: day-keyed, no
source row, a settings mark each. The journal one takes the same per-segment
setting (`journalLogTimeSegments`, empty for one a day); the dream one is once a
day. See `docs/arch/journal.md`.

`moodLog` and `moodNudge` share a
file (`src/utils/moodTasks.ts`) and a firing pass the way `birthday` and
`birthdayGift` share theirs — one subject, two lead-ins, read together in
Settings. Both are day-keyed with no source row, so both use a settings-level
mark rather than a stamp on anything (`moodLogLastDayKey`,
`moodNudgeLastDayKey`), the position `calendarReview` is already in.

**`moodNudge`'s trigger is a trend in the user's own answers** rather than a
date, a row, or a threshold crossed once, which makes it the one generator that
can be wrong about a *person* rather than about their data.
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
  - **All seven share the firing day's `dueDate`**, deliberately not their own day: the point is
    to plan the week *now*, and dated forward each would be hidden by `isTaskVisible` until the
    day it was meant to prepare for had arrived. The nudge asks about the week it fires in, and
    fires on the first day of the user's week unless they picked another day (#1730).
- **The "n/3 planned" counter on those rows is derived, and its data is its own read.**
  `countPlannedSlots` counts distinct slots (there's no `UNIQUE(date, slot)`, so counting rows
  reports 4/3 for a day with two dinners) and ignores `snack` (a day isn't incomplete for want of
  one, and counting it makes 3/3 unreachable). It can't come from `useMealPlanStore.entries` —
  that's the single window MealPlanScreen owns, which is whichever week the user last looked at
  rather than the one a nudge asks about, so a bare filter could report 0/3 across a fully planned
  week. Hence
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
- **`blocksOnFinished` is for a source that is one event, and that asymmetry is the feature.** A
  planned meal is one event (`mealShortfall`, `mealThaw` and `mealLogNudge` pass it; `mealSlot`
  asks `hasAnyGeneratedTask` directly), so a completed task about it means it was dealt with and a
  second one would be an invention. A grocery item and a leftover are rows that come round again —
  reading the wide set there would mean a staple got exactly one use-up task, ever. A project
  review is a third case: it can go quiet again, so it uses a day-scoped answer instead (below).
- **The use-up cap is filled by one sweep over both kinds, soonest use-by day first** (#2924).
  `useUpTaskCap` is shared by `groceryUseUp` and `leftoverUseUp`, and `reconcileGeneratedTask`
  declines a new one when it is full without suppressing the source, on the understanding that a
  later reconcile will find room. For a leftover that was the foreground sweep; a grocery item had
  none, since every grocery reconcile runs off an edit to that one row, so the fourth perishable
  under a cap of three never got its task after the first three were done. The catch-up pass and
  the Today foreground now run `useGroceryStore.reconcileAllUseUpTasks`, which walks
  `useUpSweepOrder` (`src/utils/useUpSweep.ts`): every live leftover and every grocery item that
  wants a task, in one queue by date, which is also what makes the setting's "closest date first"
  hold across the two kinds. Two refusals keep it from being noisier than the per-row path. It still
  never evicts, so a task already showing keeps its slot. And it skips an item whose task for its
  *current* use-by day was already completed or archived (the task's `deadline` is that day), because
  only a live task blocks a new one on an edit and a sweep that ran on every foreground with that
  rule would hand a ticked-off "Use up spinach" straight back. `useTaskStore.initialize` still runs the
  leftover-only sweep it always has: it runs before settings load, so a grocery half there would be
  judged against the defaults, and the catch-up pass that follows it runs the merged sweep against
  the real ones.
- **The per-source opt-out stays on the source row** (`MealPlanEntry.cookTask`,
  `GroceryItem.useUpTask`, `Leftover.useUpTask`), written by `deleteTask` and `bulkDeleteTasks` and
  dispatched in one `writeGeneratedOptOut` switch — both take a `skipGeneratedOptOut` option for the
  app's own housekeeping deletes (`dropGeneratedTask`, `reconcileGeneratedTask`'s unwanted branch,
  `sweepExpiredTasks`), which aren't the user declining anything: a source that is unwanted only
  for now (a frozen item, until it thaws) must not be left with a permanent "no". A selection-bar
  delete of a live task is exactly as much an instruction to the source as the single-row path, so
  `bulkDeleteTasks` writes it too.
  **Don't hoist it into a generic suppression record** keyed by
  `(kind, sourceId)`: that grows without bound, the same disease `remindersImportHandled` has and
  survives only by pruning to what the Reminders list still holds on every drain. A generic record
  has no equivalent pruning pass unless each generator supplies one, at which point it isn't
  generic. On the source row it's bounded for free — whatever deletes the source deletes the "no".
- **Deleting a generated task from the editor offers "Delete and turn off".** `confirmDeleteGenerated`
  (`src/utils/confirmDeleteGenerated.ts`) asks which of "delete this one" and "delete and turn the
  generator off" is meant, and the second passes `deleteTask`'s `stopGenerator`, which flips the
  kind's Settings switch through `setGeneratorEnabled` (`src/store/generatorSwitch.ts`, also what
  Settings' own row calls). The switch rides the delete's single undo entry, so undoing the delete
  turns the generator back on. `stoppableGenerator` withholds the offer for a generator that is
  already off and for a `notice` row. The prompt shows even with "Confirm before deleting" off,
  because it is the only place the choice is offered. A bulk delete never offers it: a selection
  can mix kinds.
- **Two of them are `notice: true`, and that flag is about the row rather than the generator.**
  `calendarReview` and `mealPlanNudge` ask about a day instead of being a piece of work, so
  `TaskItem` drops every control that treats one as something to plan: the reschedule chip and the
  swipe that opens the same picker, duplicate, the pin, Edit, renaming the title in place, and the
  "Add subtask" field. What stays is the checkbox, the meta chips and the link button, because that
  is how a notice is read and answered. `isNoticeTask` is the read; `TaskItem` and `taskMoves.ts`
  (which refuses to bulk-move or deload a notice) call it, and creation, reconciling and the opt-out
  are untouched by it.
  - **Being generated is not what makes a row a notice.** Every other generator's rows keep
    everything. A
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
- **The settings keys stayed per-generator; only the UI merged.** One section
  (`GeneratedTasksSection`, on the Automations screen in the side menu) lists every generator. It
  was a Settings group called "Automatic tasks" until it moved to the menu as a feature people
  come back to; the settings index still carries its rows (`SettingsGroup.screen`), so a Settings
  search opens Automations on the matched row. Patch-notes entries that call it "Tasks the app
  adds" or "Automatic tasks" are a record of its old names and stay as they are.
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
  - **Its opt-out is a date, not a `false`** (`Project.reviewDeclinedAt`). Most generators write a
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
    across every generator was mocked and rejected: a planned week is a row per meal the user chose
    by planning it, and captioning every one of them is the noise `tripMarkerFor`'s
    silence-by-default rule exists to avoid.
  - **It's the one generator whose reconcile can't ride a source mutation.** A project goes quiet
    by time passing and stops being quiet when some *other* task gets a date, so the check runs on
    the launch sequence and the Today foreground sweep, and `staleProjectReviewTasks` is what
    clears a row whose reason has gone. It judges that against every stall, **not** against the
    capped set `wantedProjectReviews` returns: the cap decides who gets a *new* task when several
    projects are queued, and losing that contest is no reason to delete a row the user already
    deferred to Saturday. The cost, stated plainly: a review task can be stale until the next
    sweep, which the banner — being pure derivation — never could be.

- **`pantryCheck` fires on a *guess expiring* rather than on a source changing.** Nothing is ever taken out of the pantry, because there is no inventory to take it out
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

- **`reachOut` is `projectReview` one shelf over.** A person somebody asked
  to be reminded about, who it has been a while since they saw, becomes "Catch up with Tessa".
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

- **`waitingFollowUp` is `reachOut` one shelf over, sourced on the task rather than the person.**
  A task waiting on somebody (`Task.waitingOnPersonId`), waited on long enough, becomes "Follow up
  with Gideon about 'Get the quote back'". See `src/utils/waitingFollowUpTasks.ts`.
  - **Sourced on the waiting task's own id**, not the person — the one real departure from
    `reachOut`'s shape. A person can be the far end of several independent waits at once, and it's
    the *task* that stops wanting a nudge (released, completed, archived, deleted), not the person:
    reading `personId` as the source would let two waits on the same person collide into one row,
    and freeing one wait would silently clear the other's nudge too.
  - **The decline stamp lives on the waiting task** (`Task.waitingFollowUpDeclinedAt`), the same
    "written directly, bypassing `updateTask`" shape `supplyReorder`'s own opt-out takes in
    `writeGeneratedOptOut` — the caller is `deleteTask` mid-write, and routing a second store action
    through it would run the postpone derivation over a field that isn't one. Held for the same week
    `reachOut` holds its own decline, for the same reason: a nudge about a wait ending tomorrow reads
    as the app disagreeing with you about it.
  - **`Task.waitingOnPersonSince` is what makes "waited long enough" answerable at all.** Nothing
    before this generator recorded when a wait started, so it's stamped by `updateTask` itself on the
    `waitingOnPersonId` transition (null/a different person → this one) — the same "derived on the
    edit, not asked for" shape `driftingSince` takes beside `postponeCount`, guarded the same way
    `pinnedOrder` is against restamping on every unrelated re-save of an already-waiting task. Cleared
    back to null when the wait ends, and the decline stamp is cleared alongside it: a decline about
    the *previous* wait says nothing about a fresh one.
  - **A follow-up day on the wait is when to ask** (`Task.followUpOn`, read by `followUpDue`).
    "Waiting on the contractor, chase it Friday" is set in the editor under "Waiting on someone", and
    the task itself is still held back on Friday, so the follow-up is the only row that can surface
    that day. It fires on the day whether or not the threshold has run; with no day the threshold is
    the only way in. **It is its own field, not the task's `dueDate`**, which is what it read first:
    the task's date says when the task is due, and an overdue task that started waiting asked for a
    follow-up the same minute, about a wait seconds old. A follow-up day earlier than the wait
    counts from the day the wait began, for the same reason. It's cleared with the wait, like the
    two stamps above.
  - **The cap is two and the order is never re-ranked**, for `reachOut`'s own reason applied to a
    task instead of a person: sorting the due set by longest-waiting would still be the app quietly
    deciding whose wait matters most, just measured on the task rather than the person it's about.
    **A named day is outside the cap and the setting both**: it was asked for, and the cap and the
    switch exist to limit the app speaking up unasked. With the setting off, the pass still runs for
    those alone (and its stale pass with it).
  - **The follow-up is filed under the waiting task's project**, so chasing the contractor sits on
    the kitchen's page beside the task it's about, and pauses when the project does.
  - **A completed or archived follow-up holds its source for the decline window**, the same blind
    spot `reachOutsHandledRecently` covers and for the same reason: ticking "Follow up with Gideon"
    off answers *this* nudge, not the wait itself, which is still open until the task it names is
    released or done.
  - **Its stale pass judges against every currently-live wait**, not the capped set — losing the
    contest for a slot is no reason to delete a row the user already deferred, same split every other
    stale pass here draws.
  - **The task carries no `personIds`**, for `reachOut`'s own reason: a task naming somebody is the
    record that something happened with them, and ticking this off would otherwise reset a clock this
    generator has no business touching.
  - **It ships off**, unlike `reachOut` beside it. That one's real gate is a recorded intent (a
    person explicitly opted in); an undated wait has no equivalent — every "Waiting on someone" is a
    candidate the moment it's old enough, so the setting is the only permission it has. A named
    follow-up day is that recorded intent, which is why it doesn't need the setting.
  - **It pauses on vacation**, unlike `reachOut`. A follow-up nudge is a chore about moving a wait
    along, not sunscreen — the test this file sets throughout is whether a generator invents
    something to *do*, and this one does.

- **`pantryReview` is `calendarReview` one shelf over, not `pantryCheck`.**
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
  - **It has its own category setting**, same as every generator — sharing `pantryCheckTaskCategory`
    would mean turning this on while the drip is off leaves it with nowhere to file — an uncategorized
    task renders loose at the very top of Today, which is exactly where these must not go.
  - **It ships off**, like `pantryCheck` and `mealShortfall`, for their reason: it adds a surface
    rather than replacing one that was already on screen.

- **`calendarReview` is structurally `mealPlanNudge` one shelf over, not
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
  - **It owns a category setting of its own** (`calendarReviewTaskCategory`, `categorized: true`),
    same as every other generator, rather than reusing `calendarEventCategory`. It defaults to the
    same "Calendar Events" name that setting does, so an install that upgrades into this files its
    review task exactly where it always did — but the two settings can now be pointed apart.
  - **It fires on time passing, from the catch-up passes `pantryCheck` runs in** (launch, the Today
    foreground sweep and background refresh) — but unlike most generators, it reads state
    (`useCalendarStore`) that nothing in the launch sequence populates synchronously; the window is
    filled by `useCalendarSync`'s own effect. In practice the launch-sequence firing is close to a
    no-op on a cold start and the foreground sweep does the real work, reading whatever the calendar
    store already has rather than triggering a fresh read itself — the same staleness tolerance
    every other `useCalendarStore` reader (`TodayScreen`'s event rows, time-block scheduling)
    already lives with.
  - **Its row is a notice** (`notice: true`, see the shared bullet above): the events it lists are
    the whole of its expanded panel, and none of the controls that would reschedule, duplicate, pin
    or edit it are offered, because there is no version of "tomorrow's calendar, on Thursday".
  - **It is gated on `isDemoModeActive()`, like every generator that reads a device source**
    (the calendar, weather, Screen Time, Health): most generators' qualifying condition is a row in
    the demo's own throwaway database; this one's is the real device calendar, which demo mode must
    never read from or expose the existence of. The demo's own example task is
    seeded directly in `demoSeed.ts`, the same way `pantryCheck`'s is, rather than left to the real
    sweep.

- **`weather` is `calendarReview` one shelf over — a rule the user wrote
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
  - **A rule matches on today's day-level forecast code as well as the instant the snapshot was
    read at, not that instant alone.** The refresh above happens once a day, usually at the first
    open — so a rule that only ever saw the live `current.weather_code` at that moment would warn
    about rain no earlier than the moment it started falling, and often not even then, since the
    per-rule mark (`lastFiredDayKey`) is spent the first time the rule is considered that day.
    `checkWeatherTasks` unions `classifyWeather` over both `weatherCode` (the instant) and
    `todayWeatherCode` (Open-Meteo's own summary for the whole day, `daily.weather_code[0]`), so
    "rain due this afternoon" already matches on a dry morning's first read. It stays a look-ahead
    rather than a second live poll: nothing here fetches again later in the day.
  - **The task's title says *when*, because firing in advance is useless if the row won't admit
    it.** The look-ahead above is what put "Wear rain-appropriate gear" on a screen reading 70°
    and sunny, with nothing on the row connecting the two — the feature working exactly as designed
    and reading as a bug. So the same request also asks for `hourly`, and `weatherWindowFor`
    (`src/utils/weatherTasks.ts`) picks the run of hours the rule's own condition holds for —
    the one under way now or the next one after it — which `describeWeatherWindow` turns into
    "rain from 2pm", "rain until 10am", "rain 2pm to 6pm" or "rain all day", appended in brackets
    after the user's own words.
    - **The day code decides *whether*; the hours only decide *where to point*.** A rule still
      fires off the union above and nothing about matching changed, so an hourly block that
      fails to parse (`todayHours` degrades to null on its own, like `todayHighF` does) costs the
      window and never the task.
    - **It names the rule's condition, not the sky.** A cold rainy hour qualifies as both, and a
      "Wear a coat" rule reporting "rain from 2pm" would be quoting somebody else's reason —
      which is why `conditionNoun` takes a `WeatherCondition` where `weatherConditionNoun` beside
      it takes a raw code.
    - **The phrase is in clock times, never "later" or "in two hours".** Anything relative to the
      moment of writing would be quietly wrong by the afternoon, where "rain from 2pm" stays true
      whenever it is read.
  - **A named hour has to be correctable, which is what finally made the snapshot refresh more
    than once a day.** `SNAPSHOT_STALE_MS` (an hour) in `useWeatherStore`: a morning reading
    settles "is it rainy today", which is all the snapshot used to have to answer, but a forecast
    that moves the rain from 2pm to 4pm leaves a row asserting 2pm for the rest of the day, and a
    wrong specific time is worse than the vague one it replaced. It is **still not a poll** — the
    three triggers are unchanged, so this only decides whether a trigger that was happening anyway
    does anything, and an app opened once a day still fetches once a day.
    - **So `drift` is a real title drift here now**, joining the generators that track their
      source's wording. Creation stays gated on the mark and drift deliberately isn't: a rule
      already considered may still have a row whose window wants correcting, but must never get a
      *new* one. `applyRule` checks `liveGeneratedTask` before it does anything, so a task the
      user swiped away is left deleted rather than being handed back by the correction pass.
  - **From 6pm a rule is asked about tomorrow as well, and that is a second question with a second
    mark.** `WEATHER_AHEAD_FROM_HOUR`, and `WeatherRule.lastAheadDayKey` beside `lastFiredDayKey`.
    Evening rather than any hour because a day-ahead row is only worth having while there is still
    an evening to act on it.
    - **Two marks, because on the evening of the 17th both questions have been answered and they
      have different answers** — "what is today doing" for the 17th, "what is tomorrow doing" for
      the 18th. One scalar would hold whichever was written last, and the other question would be
      asked again on the next foreground sweep, recreating a row already swiped away. That is the
      single thing both marks exist to prevent.
    - **The row is keyed and dated to the day its weather falls on**, not the day it was written
      on, which is what makes the transition free: when the 18th arrives, today's pass reaches for
      `2026-08-18#rule` and finds the row already there, so it drifts rather than creating a
      second one. The clear pass spares tomorrow's key alongside today's for the same reason.
    - **It refuses to write anything it can't put an hour to.** The same-day pass falls back to the
      rule's plain title when the hourly block is missing, because there is still a task worth
      having; a day-ahead row exists precisely to say *when*, so without a window there is nothing
      to say. This is also why tomorrow's conditions come off its hours alone rather than unioning
      a day-level code the way today's does.
    - **"tomorrow" is the one word in the phrase that goes stale, and drift is what answers for
      it.** The title written the evening before reads "snow 7am to 11am tomorrow", and the
      correction pass rewrites it to "snow 7am to 11am" once that day is the one you are on.
    - **A row the forecast no longer backs is dropped, not left as written.** If the day arrives
      and the rule no longer matches, or its window has already passed, `applyRule` removes the row
      through `dropGeneratedTask` (no opt-out). Returning early left last night's "tomorrow" row on
      Today with nothing to correct or remove it.
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
  - **A task can wait for a kind of day, and that is not a rule.** `Task.weatherWait`
    (`src/utils/weatherWait.ts`, applied by `applyWeatherWaits` in `useTaskStore`) holds an existing
    one-off task until the first forecast day that is sunny, rainy, snowy, cold or hot. It creates
    nothing, so it has no source id and no mark; it rides the same snapshot (now carrying the
    two-week daily `forecast`) and the same `weatherTasks` switch.
    - **The task's own `deferUntil` is the hold.** Hiding a task until a day is what a defer
      already is, so no visibility rule knows about weather. While `weatherWait` is set the pass
      owns `deferUntil` and rewrites it as the forecast moves.
    - **A matched day releases the task for good.** Once `deferUntil` arrives the pass clears
      `weatherWait` rather than re-deciding, because a forecast that turns on the day itself must
      not push a task back off Today. A forecast with no match holds the task to the day after the
      forecast ends and looks again on every refresh; the row chip says so (`weatherWaitChipText`).
    - **One-offs only** (`canWaitForWeather`): a repeat, a chain step or a series member has a
      schedule of its own, and the editor does not offer the row for them. A task's own Date is a
      floor: the search starts from it.
    - **It re-runs when its inputs change, from a hook** (`useWeatherWaitSync`), not from
      `useWeatherStore`, since the task store already imports that one. The pass is idempotent,
      which is what stops the write it makes coming back through the task subscription forever.
    - **Cold and hot read the day's high**, since someone waiting on either is asking about the day
      rather than an instant.
    - **Four ways in, one rule.** The task editor, a template item (seeds the field, and only on an
      item that is a plain one-off), quick add's "on the next sunny day" tooltip
      (`parseWeatherWaitInput`) and the MCP `weatherWait` field all write the same column. Each one
      refuses or clears the wait on a repeat, chain, series or subtask through `canWaitForWeather`
      (`weatherCondition.ts`, pure so the MCP package can import it), and quick add offers the phrase
      only while the weather switch is on, since accepting it with nothing reading the forecast
      would be a field dropped without saying so. The MCP write only records the want: the phone
      holds the forecast, so the task leaves Today at its next sync.
  - **A repeating task can skip a day it rained, and that is not a rule either.**
    `Task.rainSkipMm` (`src/utils/rainSkip.ts`, applied by `applyRainSkips` in `useTaskStore`) is a
    threshold in millimetres on one repeating task ("water the garden unless it rained 5 mm").
    - **Rain is yesterday plus today**, from the same Open-Meteo request (`precipitation_sum` and
      one `past_days`; `snapshotFromResponse` finds today by date, so day 0 is no longer assumed).
      Today's figure is the day's forecast, so a morning look is partly a prediction. That reads
      the ground rather than a calendar day, which is the question a watering task asks.
    - **No figure decides nothing.** Neither day's rainfall is never read as dry or as wet, and a
      snapshot from an earlier logical day is refused on its day key, like every weather pass.
    - **It skips, never misses or completes**, through `skipPatch`: a miss is a claim about the
      person in their Logbook. The streak is forgiven the way vacation forgives one (re-dated to
      today, nothing credited), because the rain did the job.
    - **Only today's occurrence, once a day.** `rainSkippedOn` is the pass's mark, so an occurrence
      pulled back onto Today after a skip stays. A withheld task (`isWithheld`) is left alone.
    - **It is recorded in Activity** as an app-written `moved` entry ("Skipped after rain"), the
      only one an unattended pass writes, so a skip nobody saw has somewhere to be found.
    - It runs from the catch-up passes and again whenever a snapshot lands
      (`useWeatherWaitSync`), never in demo mode, and only does anything with the weather switch on,
      since nothing else fetches the rainfall.
    - **Set from the editor's repeat, a template item, quick add or MCP.** Quick add's phrase is
      `parseRainSkipInput` ("unless it rains", optionally with an amount); a bare one takes
      `defaultRainSkipMm` in the person's unit. It is offered only once the repeat is set and the
      weather switch is on. The schedule phrase must reach the end of the title, so
      `parseTaskInputAheadOfRainSkip` reads the repeat past a trailing rain phrase and keeps the
      phrase for the next tooltip; otherwise "every 2 days unless it rains" would offer neither.
  - **It ships off**, like `pantryCheck` and `pantryReview`, and for a reason of its own on top of
    theirs: it's the one generator that also wants a location fix, which is not something to start
    reading without being asked.

- **`mealShortfall` fires on a *meal coming into range*.** Planning a week
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

- **`mealThaw` is `mealShortfall` asking the other question about the same rows** (#2926,
  `src/utils/mealThawTasks.ts`). `probablyHaveReason` reads a live `frozenAt` as on hand, which is
  what keeps the shortfall quiet about chicken in the freezer, and correctly; but being quiet was
  all anything did, and "frozen and planned" is the moment somebody avoiding waste needs telling,
  because a fridge thaw takes a day. So a meal planned for today or tomorrow whose ingredients are
  on hand only frozen gets "Take chicken out of the freezer (Thursday Dinner)".
  - **Everything but the question is borrowed**: the same source row, the same `classifyPlanned`
    over the entry's own picks, scale and standing swaps, the same clear-then-create pass re-running
    the create predicate, the same cap of three, `blocksOnFinished`, and a permanent per-meal `false`
    (`MealPlanEntry.thawTask`, beside `shopTask`) that only ever subtracts. What it asks about is a
    `probablyHave` row whose reason is `FROZEN_REASON`, the freezer's own rung on that ladder, so an
    "Out of it" or "running low" outranks it exactly as it does in the Pantry, and a frozen item also
    on the shopping list reads as being bought fresh.
  - **The window is today and tomorrow, and there is no lead-time setting.** Tomorrow is the day a
    fridge thaw is for; today still has the quick methods. Further out is premature, since food
    moved to the fridge early loses that many days off its clock.
  - **One row per meal, naming everything frozen in it**, and a planned leftover counts: a frozen
    container is still live and plannable (see "A frozen container is still live" in
    `groceries.md`), and a frozen portion planned for tomorrow is the commonest case of all.
  - **Ticking it thaws nothing.** Whether the food actually came out is said in the Pantry, which is
    where the row's link goes (the one frozen row, or the Pantry itself when there are several).
    The stale pass then clears any row whose food is no longer frozen.
  - **Half a pack frozen asks nothing while the other half is out** (#2925). "Freeze some" writes a
    portion box and leaves the item on its own clock, so `probablyHaveReason` answers with the
    item's own reason and the meal is covered by the fresh half. Once that half is marked out of
    it, the frozen portion is what answers (`FROZEN_REASON`) and the thaw row follows. The item's
    own `groceryUseUp` task is untouched by the split, since `wantsUseUpTask` reads only the item.
  - **It ships off**, for `mealShortfall`'s reason: it adds a surface rather than replacing one.

- **`mealLogNudge` asks to log a planned meal nothing was logged for** ("Log breakfast? (Mon
  9/8)"), the half of the completion-time log prompt that a meal whose Eat step was never ticked
  can't reach. `src/utils/mealLogNudgeTasks.ts` is modelled on `mealShortfallTasks.ts`: a want/stale
  pair re-run off the creation predicate, a row per `MealPlanEntry`, and `blocksOnFinished`. Its
  rules are in the module's header; the ones worth knowing before touching it:
  - **It doesn't try to tell whether the meal happened.** `cookedAt` is never consulted, because a
    meal with nothing logged and nothing ticked is exactly the case it exists for. Completing it
    without logging is a legitimate "I'm not bothering".
  - **Completing it opens the same offer completing the Eat step would have** (`completeTask`
    reads its source entry through the meal-slot branch).
  - **Its per-meal "no" is `MealPlanEntry.logMeal`**, the field the completion prompt's "Don't ask
    for this meal" already writes, so declining either holds for both.
  - **"Logged" means the slot has food in it** (`mealLogCoverage.ts`), not only a food log row
    naming the entry, since `mealPlanEntryId` is stamped on one route into the log out of several.
  - **There is no row cap**: unlike a shortfall it isn't competing for shelf space, and the window
    already bounds it.

## A generated row links back to where it is defined

Every row with a `generatedKind` carries a sparkles button in its expanded panel (beside duplicate, not on the collapsed row) that opens its generator on the
Automations screen (`automationEntryIdFor` in `generatedTasks.ts`, opened with
`navigateToSettingsEntry`). The four rule generators (weather, Screen Time, Health, calendar
events) open at their rule list instead of the switch, since the rule is what wrote the row. It
is separate from the row's own link on purpose: that one points at the task's subject (Apple
Weather, the pantry), this one at the setting. A new generator needs no wiring as long as it has a
`gen:<kind>` settings entry; `generatedTasks.test.ts` fails if a kind resolves to nothing. A `notice` row has no action bar,
so it has no button either.

## An estimate set on one is kept on its generator

Every generated task (and every follow-up task) is a fresh one-off row, so an
estimate set or timed on one used to die with it. Editing a generated row's
estimate now writes it back onto the generator that wrote it, and the next row
starts from there. The title plays no part, so a title carrying a date or a
forecast changes nothing. `src/utils/ruleEstimate.ts` has the three homes:

- **A rule somebody wrote** (weather, Screen Time, Health, calendar events):
  on the rule itself, via `ruleEstimateDraft` in each rule's draft.
- **A follow-up rule**: in `followUpTaskDraft`. The source pointer goes stale
  after another cycle, so the write walks forward along `previousOccurrenceId`
  to the row holding the rule now (`liveFollowUpSource`).
- **Every other generator**: one entry per kind in the `generatorEstimates`
  setting, filled in by `addTask` when a draft carrying a `generatedKind` names
  no estimate. Meal tasks are left out (`holdsKindEstimate`): they arrive
  estimated from the recipe, and one figure for every meal would be wrong.

The write-back compares values, not the patch's keys, because an undo snapshot
names both fields without changing them. Only a draft with no estimate of its
own is ever filled, and a task somebody typed never is.

## Task settings: a kind's task, field by field

A kind can have a **Task settings** sheet in Settings (`GeneratedTaskSettingsSheet`, rules in
`src/utils/generatedTaskSettings.ts`): its task laid out like a task, with the fields its generator
writes shown locked and saying where each comes from, and the rest editable. It exists so the
person can see how the automation works, not only switch it on.

- **It is not a task row.** A hidden "prototype" `Task` would have to be excluded from every list,
  sync, Search, Backfill, retention and the MCP replica, and missing one shows a phantom task.
  What the sheet edits is three settings: the kind's own category setting, `generatedTaskDefaults`
  (shared with Backfill), and `generatedTaskExtras` (tags, time of day, a question on completion).
- **A setting fills a field the generator left alone and never overrides one it wrote.** The
  extras are folded into the draft at the top of `newTaskFromDraft` (`generatedExtrasFill`); tags
  add to the draft's, the rest only fill an empty slot. The locked rows are exactly the fields the
  generator writes, several of which its drift rewrites, which is why they can't be offered.
- **Changes apply to tasks created afterwards**, the rule the defaults already had: a live task
  may have been edited, and rewriting it would undo that.
- **Not every kind has one yet.** `TASK_SETTINGS_SPECS` lists the kinds that do, with their owned
  fields; the rest keep the older "Task defaults" and "File them under" rows. Adding a kind is an
  entry there, its owned fields read off its draft builder.
- **The MCP server doesn't expose these**, as it doesn't expose `generatedTaskDefaults`.

## Vacation mode: which of them stand down

`GeneratedKindSpec.pausedOnVacation` is every generator's answer, required the way `kitchen` is
because it isn't guessable from anything else about the generator: without it, generators carried
on writing tasks onto Today throughout a deliberate "hide work from me". **Read the spec for each
generator's answer**; the lists below are the reasoning, not the record.

The rule is the one coined for `weather` below and reused for `screenTime` and `health`:
**sunscreen, not work.** A generator that invents something to *do* is exactly what vacation mode
was switched on to stop, so it pauses (the use-up and pantry generators, the meal plan's, project
reviews, supply reorders, chasing a wait (`waitingFollowUp`), the weekend nudge, the weigh-in).
A generator about your body, your mood, the weather, your own phone use, the people you care about,
or what is on your calendar is not work and keeps running (weather, Screen Time and Health rules,
the mood check-ins, birthdays, reaching out, the calendar review, calendar event rules, leave-by reminders). A birthday missed because you
were away is the exact failure that feature exists to prevent, and what is on tomorrow matters more
when you are travelling, not less.

Three things enforce it, and they are not redundant:

- **The clock-driven passes** check `generatorPausedForVacation` at the top, and skip *without
  recording their period key* — the behaviour `checkMealPlanNudge` already had. That is what makes
  the trigger they declined fire for real the first time the app is opened after vacation ends,
  rather than being marked done in absentia.
- **`reconcileGeneratedTask`** checks it too, for the generators whose trigger is an edit rather
  than a clock (`groceryUseUp`, `leftoverUseUp`). It checks *after* the remove and drift branches,
  so only creation stops: an existing row still follows its source and still goes when the source
  stops wanting it. Gating the whole function would freeze rows their source has finished with, and
  gating `wanted` would delete a row on the way into vacation and write it again on the way out.
- **The rows themselves carry `vacationPause: true`**, stamped by `generatedBy` for every kind
  that pauses, so no generator's draft can forget it. The two gates above only stop *new* rows,
  and several passes write ahead (a week of meal rows), so a row written the day before a trip sat
  on Today for most of it. Paused, it hides while vacation mode is on and comes back when it ends,
  exactly as any task set to pause does, and a person can still switch it off on one row. The one
  override is `mealPlanNudge` with "Also during vacation" on: those rows are written during a trip
  on purpose, so the pass writes them unpaused.

**A kitchen pass's own switch and the kitchen gate stop creating, not clearing.** `mealSlot`,
`pantryCheck`, `pantryReview`, `mealShortfall`, `mealThaw` and `mealLogNudge` check them *below* their stale
pass, not at the top, and short-circuit only when there is nothing live of their kind to clear.
Returning above the clear froze every row already written: "Shop for Ragu" stayed on Today, overdue,
naming a meal dropped from the plan after the switch went off, until somebody deleted it by hand.
Off means stop asking. It is not a decline of the rows already there, so only those whose reason
has gone are removed, and each pass's period mark is still spent only on a run that could have
created. The vacation gate stays at the top, as above: a paused row is hidden rather than on Today,
and the clear catches up the first time the app is opened after vacation ends.

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
| a recipe | Make X → Eat X |
| a leftover, takeaway, a typed answer | Eat X (one step, so `chainEnabled: false`) |

"Already chosen" is the same task with its first step gone, not a different task — which is why the
table is read on every reconcile rather than only at creation. Eight consequences worth not
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
  [Choose, Prepare, Eat] has no honest answer in [Make X, Eat X].
- **The row says which meal it is, in the meta line rather than in the title** (`mealSlotOf`, read
  off the source id — no store lookup). Only an unanswered slot names its meal in its own steps
  ("Choose lunch"); the moment something is planned the title becomes the food, and a day's three
  rows sit together under one category with nothing telling them apart. It's a chip beside the
  scheduled one rather than a longer title because the title is also what Search, the Logbook and
  the widget show, and "Make Peanut Butter Tofu with Sriracha for dinner" wraps to two lines on a
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
- **A day that has gone by takes its untouched rows with it** (`staleMealSlotTasks`). The pass
  never writes a past day, since a meal task is no use once its day has gone, but nothing removed a
  row it *had* written, so a weekend away left six or nine "Choose lunch" rows overdue at the top
  of the section for good. Each run now drops, with `dropGeneratedTask` and no opt-out, every live
  row whose day is before the logical today and that nobody touched: still on step 0, and not moved
  onto today or later by its date or a defer. A started chain is the user's, the same line the
  drift draws, and a moved row was a decision about when to deal with it. The mark is untouched, so
  a dropped day is never written again, and the log nudge is what asks about a past meal.
- **A slot with food logged in it loses its row** (`loggedMealSlotTasks`, run by
  `syncLoggedMealSlotTasks`). Logging lunch by hand answers Choose, Prepare and Eat at once, and the
  row used to stay on Today for a meal already in the log. The join is the (day, slot) pair, the
  same one `mealLogCoverage.ts` makes, and it drops the row even mid-chain. It is a drop with no
  opt-out and never a completion: nothing here may assert a particular planned dish was eaten (see
  `mealLogCoverage.ts`), and `cookedAt` stays unstamped. Triggered by food log writes and by
  `checkMealSlotTasks`; deleting the entry later does not bring the row back.
- **A week at a time** (`MEAL_SLOT_TASK_DAYS`), matching the meal plan's own `upcomingDays` and the
  horizon the weekly nudge asks about. This shipped as today-only, on the grounds that a week of
  rows saying "Choose lunch" would be noise; it isn't, because those meals genuinely are undecided
  and a Later screen that says so is being accurate. What the narrower version actually cost was the
  honest half — a meal you *had* planned had something to say ahead of time, exactly as a cook task
  did, and no row to say it on.

**A leftover planned into a meal that has its own task gets no "Use up X" beside it** (#2932).
Planning last night's chili for dinner put "Eat Chili" and "Use up Chili" on Today together: two
rows, two sections, one container. The meal row is the more specific of the two (it says when), so
`leftoverTasks.plannedMealRowFor` stands the use-up task down while an uneaten entry names the
leftover, dated from the logical today through its `keepUntil`, **and a live `mealSlot` task exists
for that day and slot**. That last condition is the premise itself: with the meal-task generator
off, that meal not one the user gets a task for, or the row swiped away, the use-up task is the only
reminder left, so it stays. A dinner planned after the container goes bad doesn't use it in time,
and a meal already eaten may have left some behind, so neither counts. It narrows `qualifies`
rather than overriding the per-leftover answer, so a leftover the user switched its task on for
keeps it. The meal plan asks from `reconcileMealSlot` (both halves of a change: the entry handed in
and whatever the slot now holds, plus the original of a `bulkReplaceItem`, which names no leftover
afterwards), and runs after the slot's own task since that task's presence is half the rule.
Cooking is deliberately not a trigger: the "was that the last of it?" prompt is still open at that
moment, and the next foreground sweep brings the task back if some is left. The drop goes through
`reconcileGeneratedTask`'s unwanted branch, which writes no opt-out.

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
this same row from "Choose lunch" into "Make X"/"Eat X" (`mealSlotDrift`, since `chainIndex` is still 0)
exactly as it would if the pick had come from the Meal Plan screen — the checkbox tap never reaches
`completeTask` at all. This is a deliberate reopening of the objection above, not a lapse of it: the
thing that made a second copy wrong was a second *browsing* surface holding its own idea of what
"today" is, and this isn't one — it's the identical component, given the one day+slot the row already
names, with the sheet's own session state (`lastPickedSlot`, `planned`) starting fresh on each mount
either way. The link's slot still beats the sheet's remembered one (`forceSlot`) from either entry
point: "Choose lunch" named the slot before the sheet opened.

- **They still write straight to Today**, rather than proposing into a review surface the way
  `deloadPlan`/`projectPull` do. That fork is real and was deliberately left alone: it's a
  product decision about every generator at once, and the shared mechanism is what makes it a
  change in one place.

**An answered slot with a recipe to cook links to the recipe, not the meal plan day.** Until now
`linkUrl` always opened the day on the Meal Plan screen — right for a leftover or a typed answer,
which have nothing else to show, but wrong for "Make X": the row exists to point at the thing you're
about to do, and the meal plan names the meal without showing what's in it. `mealSlotLinkUrl` now
reads the entry (`recipeLinkUrl`, `dundundun://recipe?id=…`, parsed by `deepLinks.isRecipeUrl` /
`recipeUrlId` into `resetToRecipeDetail`) whenever `entry.recipeId && !entry.leftoverId` — exactly
the condition `mealSlotChain` already uses to decide whether there's a Cook step at all. The link is
carried unchanged into "Eat X" (`mealSlotDrift` writes `linkUrl` unconditionally, not just at
`chainIndex === 0`): it's the same dish either way, and there's no second field to hold two
destinations for one row. The picker link for an unanswered slot, and the meal-plan link for a
leftover/takeout/typed answer, are unchanged.

**The recipe link names the planned meal too (`&entry=…`), and resolves it when tapped.** The Meal
Plan screen's own "Open recipe" seeds RecipeDetail with the meal's `recipeChoices` and
`recipeScale`; a link carrying only the recipe id opened a doubled chili at 1× with the default
side, so cook mode read out half the quantities and "Log to food log" logged half the helping
(#2931). The entry's id travels rather than its numbers because `mealSlotDrift` rewrites `linkUrl`
on every reconcile: a scale in the URL would make every scale change a task write, while the id is
stable and `plannedRecipeParams` reads the entry as it stands at the tap. An entry that has gone, or
that now holds a different recipe, gives nothing and the recipe opens on its own defaults.

**A recipe that has since been deleted is not a recipe to cook.** `MealPlanEntry.recipeId` outlives
the recipe on purpose, so every path that builds a slot task from an entry (the daily pass, the
reconcile, `setCookTask`'s create) goes through `slotEntryForTask` first, which hands the projection
a copy with the dead pointer cleared. The slot then reads "Eat X" and links to its day, like a typed
meal, rather than "Make X" linking to "This recipe is gone". Deleting a recipe reconciles the slots
planned from it (`reconcileRecipeSlots`), since nothing about the plan itself changed to trigger one.
It trusts the pointer until the recipe store has loaded (`recipeIsGone`), so a list that failed to
load can't turn every meal on Today into a typed one. Renaming a recipe is the other direction:
`retitleRecipeEntries` rewrites the entries' captured titles, which is what "Make X" and the
calendar event read.

## `screenTime` — a rule the user wrote, about their own phone use

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
- **It is gated on `isDemoModeActive()`** (see `calendarReview`), and the gate matters more here
  than it does for a calendar read. Crossings are drained *destructively* from the OS, so acting on them
  against a database about to be discarded wouldn't merely write fiction, it would lose the crossing
  outright. Both halves refuse: `screenTimeBridge()` won't drain, and `checkScreenTimeTasks` won't
  run. The demo's own example task is seeded directly in `demoSeed.ts`.
- **It does not gate on vacation mode**, following `weather` rather than `mealPlanNudge`. A rule
  about your own phone use is sunscreen, not work: vacation is exactly when somebody might want it.

## `eventTask` — a rule the user wrote, cued by text

"When something on my calendar says *flight*, add a task to pack, two days before."
`src/utils/eventTasks.ts` is `weatherTasks.ts` with the calendar in place of the forecast, and
almost everything that differs follows from one thing: **a rule here is asked about a fortnight of
events at once, where every other rule generator asks one question a day.**

- **It may read a title, and that is a boundary settled elsewhere rather than here.**
  `docs/arch/people.md`'s "Where the two lines actually fall" splits event *titles* from event
  *attendees*: a title is what you typed about your own plans, an attendee list is everyone you
  happen to sit in a room with. `BusyEvent` carries no attendee field and must not grow one. This
  is the second reader of a title after `peopleNamedInTitle`, on the same terms.
- **It is not the "guess is never written down" rule being relaxed.** That rule stops the app
  deciding, off a title, that something is true — which is why `calendarHistory.ts` may only
  *offer*. Nothing is inferred here: the user wrote the word and the task, so the app's whole
  contribution is noticing the word is present. That is exactly where `weather` and `screenTime`
  already stand, and it is why this one may write a row.
- **It deliberately does not parse.** No date, no duration, no category and no priority is read out
  of a title, and `parseTaskInput` is not reached for. That parser is built for text typed into this
  app behind a sigil ("#home", "!high", "tmrw 5p"), and `calendarHistory.ts` already writes down the
  asymmetry: a deliberate sigil earns a low bar, a title somebody wrote for another purpose gets the
  higher one. An event also already carries a real date from EventKit, so the one field a parse
  could plausibly contribute is the one needing it least.
- **The match is whole-word and floored at three characters**, the same test and the same floor
  `peopleNamedInTitle` uses, for the same reason: "gym" firing on "Gymnastics recital" is a rule
  nobody can predict, and a rule nobody can predict is one nobody leaves on.
- **The idempotency mark is a record, not a day key, and this is the one real departure.** A
  weather rule can carry `lastFiredDayKey` because tomorrow is a different question. A rule here is
  asked about every event in the window at once, so a day key cannot say *which* of them has been
  answered. `eventTaskHandled` is therefore keyed by occurrence (`${eventId}|${eventStart}#${ruleId}`)
  and valued by that occurrence's end.
  - **This is not the growing `(kind, sourceId)` record this file rules out.** The objection there
    is that a *generic* suppression record has nothing general to say about when an entry stops
    mattering, so nothing can prune it. Here something can: an occurrence that is over is never
    coming back, which is the expiry `pruneStaleReminders` and `pruneStaleHiddenEvents` already run
    on. It is pruned on every sweep and again on settings load.
  - **A non-matching pair is deliberately not marked.** Weather marks "considered and found not to
    apply" because tomorrow is a fresh question; here the same event asked again tomorrow is the
    same question, and an event renamed to match a rule should fire it.
- **The occurrence key is the event id *and* its start.** EventKit shares one
  `calendarItemIdentifier` across every instance of a recurring series, so keying on the id alone
  would let one standing meeting's task suppress all thirteen. `EventReminder` and `HiddenEvent`
  are both keyed this way already; this is the third.
- **A rule fires on the day its task is due, not the day the event is spotted.** A two-day rule
  against next Friday's flight matches today and is held until Wednesday — writing it now would put
  a row on Today that is not about today. That hold is also what makes a fourteen-day window
  sufficient: by the time a task is wanted, its event is at most `leadDays` away. `EVENT_LEAD_DAYS_MAX`
  is `CALENDAR_WINDOW_DAYS` for exactly that reason, pinned by a test, since a longer lead would
  produce a rule that silently never fires.
- **An event vanishing from the window is not a reason to clear its task**, where a deleted *rule*
  is. The difference is that "gone" is ambiguous: an occurrence leaves the window when it is
  cancelled and also when it simply happens, and the second is the ordinary case. Reading it as
  cancelled would delete the task on the morning after the flight it was written for.
- **Nothing chases the event's date.** `drift` returns null, following the #1953 rule at the top of
  this file: a reconcile that re-dates a row from anything but its source overwrites the field the
  user is most likely to have changed by hand, and deferring one of these is exactly what somebody
  would do.
- **The row says which event asked for it, derived at render and never stored.** The task's title is
  the rule's own words, so "Prep for interview" otherwise lands on Today with nothing naming the
  calendar event behind it. `eventTaskContextLabel` reads the event off `useCalendarStore` by the
  occurrence key in the source id and `TaskItem` shows it as a filled chip ("Interview with Acme ·
  Tomorrow 3:00 PM"). Not stored because the title is whatever the calendar says now, and a copy
  would need chasing. The cost: once the event leaves the window the chip falls back to the day the
  key still names ("Event on Oct 6"), with no time, since an all-day event can't be told apart then.
  `useEventTaskContext` is the one gated subscription; the task row, Search, quick search and the
  Logbook all call it inside the row (a parent subscription would defeat their memo). The Logbook
  and quick search keep it on their single meta line, truncating first. The widget has no subtitle
  line, so `WidgetTask.eventTitle` carries the title alone (never a day word, which would be wrong
  after midnight) and Swift dims it after the task's title on the same line. It is null when the
  calendar wasn't read, as in a background refresh.
- **A rule can fire after its event instead (`afterEvent`), and that needs a window of its own.**
  "Schedule the next appointment" is a task for once the visit has happened. The fortnight
  `useCalendarStore.events` holds can't serve it: it starts today, so an event that ended
  yesterday has left it, and it ends in two weeks, so a follow-up booked for next month is
  invisible. `followUpEvents` is a third read (a week back, `FOLLOW_UP_AHEAD_DAYS` ahead) taken
  only while an enabled follow-up rule exists (`needsFollowUpWindow`), and `checkEventTasks`
  refuses follow-ups until it has loaded, for `loaded`'s reason: an unread window must not read
  as "nothing else is booked". `matchedEventTasks` skips these rules and `matchedFollowUpTasks`
  judges them.
  - **The handled entry outlives the event** (`followUpHandledUntil`: end plus the lookback). The
    usual value is the event's end, which is when the sweep prunes it, so a follow-up written
    after the end would be forgotten at once and rewritten after the user deleted it.
  - **`skipIfUpcoming` is judged across the whole list and is not recorded.** Any other live match
    that hasn't started means the follow-up is booked, so nothing is written for the finished
    ones. The skip is not marked handled: if the booked event is cancelled inside the lookback the
    task is wanted again. With it on, only the latest finished visit is asked about, so a run of
    visits yields one task.
  - **The task lands on the logical today**, not the event's day, which is already behind us.
  - **The sweep re-runs when the windows land** (`useEventTaskSync`). The foreground sweep runs
    before the read finishes, which costs a day for a lead-time rule and the whole task for this.
    It is a hook because `useTaskStore` imports `useCalendarStore`, so the store can't call it.
- **It ships off**, like every generator that adds a surface rather than replacing one, and it is
  gated on `calendarReadEnabled` as well as its own switch — a switched-off calendar read must not
  leave one part of the feature still writing rows.
- **It does not pause on vacation**, following `weather` rather than `mealPlanNudge`. The test this
  file sets is whether a generator *invents* work or reacts to something happening anyway; an event
  already on the calendar is the second. Pausing would also take the feature away at the moment a
  lead-time rule earns its keep, since the flight it is about is usually the one the vacation starts
  with.
- **It is gated on `isDemoModeActive()`** like the other real-device readers, and in demo mode it
  would have nothing to read anyway — the demo database's calendar is never read. `demoSeed.ts`
  seeds the shape directly.

## `travel` — leave-by reminders, with the MTA as a footnote

An upcoming event with a location becomes "Leave for Dentist", with a reminder at the event's start
less `travelLeadMinutes`. `src/utils/travelTasks.ts` holds the rules and `checkTravelTasks` the
sweep. If the user turns on Subway alerts and picks lines, an MTA disruption on one of them during
the trip is appended in brackets: "Leave for Dentist (L running local)". `src/utils/transitAlerts.ts`
reads the feed, `src/services/transitLookup.ts` fetches it, and `useTransitStore` holds it.

It is two features, and the first is useful without the second. The decisions below were each
argued out before it was built; read them before reopening one.

- **An event with a location is the whole trigger, and the app has no home address.** An event
  somebody put an address on is one they travel to. `BusyEvent.location` was already read from
  EventKit and consumed by nothing, so this needed no new permission or read. The location is
  checked for presence and copied onto the task's own `location` field. It is never geocoded or
  sent anywhere.
- **A video call's "location" is not a place.** Calendar apps put the meeting link, or the name of
  the service, in that field, and a "Leave for…" row in front of a Zoom call would be the mistake
  this makes every day. `eventHasLocation` refuses a field that is a link and a closed list of
  exact service names ("Microsoft Teams Meeting", "Zoom", "Google Meet"…). It is a closed list on
  purpose: a pattern would start deciding which real places are really places, and "Zoom Cafe, 12
  Bedford Ave" is somewhere you walk to.
  A room in the location doesn't rescue a call: `BusyEvent.videoCall` is set at read time when the
  event's notes or URL hold a link to a known call host (`hasVideoCallLink`), and
  `eventIsTravelEligible` refuses it. A hybrid meeting you do attend in person gets no row.
- **The travel time is the user's number unless they ask for Apple Maps'.** By default no routing
  service is asked. Asking one means sending the addresses of somebody's appointments, and where
  they are, to a third party, and a computed figure can be wrong in a way the user's own estimate
  isn't. `travelLeadMinutes` is a `CountStepper` in 5-minute steps. **`travelEstimates` (off by
  default, its own switch, location permission asked on the tap that turns it on) is the opt-in:**
  `useTravelTimeStore` asks MapKit's ETA (`src/services/travelTime.ts`, `estimateTravelTime` in
  `todo-eventkit-bridge`) from the starting point to each upcoming event's place, by
  `travelMode`, and `estimatedLeadMinutes` turns it into the lead (plus 5 minutes, up to the next
  5). Four rules hold it to the reasons above:
  - **It says so.** The estimate goes in the title ("Leave for Dentist (25 min by transit)"),
    so a reminder that moved never moved silently, and a wrong figure is visible before it costs
    anything.
  - **The typed number stays the fallback**, per event: one Apple Maps can't place or route keeps
    `travelLeadFor`'s lead, and turning the switch off puts every row back on it on the next sweep.
  - **It is read only while the app is open** (`useTravelTaskSync`'s triggers), and kept in memory.
    A reminder queued the evening before carries the last estimate the app saw; nothing reads the
    position while the app is closed.
  - **An estimate is tied to the place and mode it answered** (`estimateFor`), so an edited
    location or a changed mode is asked again rather than reused, and one older than 20 minutes
    is refreshed for traffic. The destination is the event's map pin when it has one (a place
    picked in quick add), else Apple Maps' first match for the location text.
- **One event can override the mode, how early to arrive and where the trip starts, and that stays in the app.** The quick
  event sheet shows "Getting there" and "Arrive" chips for an event with a place and a time (plus "Start from" while estimates are on), saved
  to `travelEventPrefs` (`TravelEventPref`) by calendar event id, so a repeating event keeps its
  choice every week. EventKit has no public field for a travel mode or arrival buffer, so nothing
  is written to the calendar event. A pref overrides `travelMode` (`travelModeFor`) and shifts the
  reminder by `arriveEarlyMinutes` on top of the lead or estimate (`leadWithArrival`, never below
  zero). Estimates are filed under the mode they were asked for, so a pref asks again, and the same goes for a different starting point (`originPlaceId`: a saved place, `TRAVEL_ORIGIN_PHONE`, or null to follow Settings; `travelOriginForEvent` resolves it, and a removed place follows Settings rather than becoming the phone). The row shows
  a held estimate as a chip (`travelRowNote`); with `travelEstimates` off there is none to show.
- **The starting point is the phone's position or a saved place, chosen once** (`travelOriginPlaceId`,
  shown as "Start from"). The phone's position is the wrong origin for most of what this makes: a
  reminder queued the evening before is estimated from wherever the phone was then. A saved place
  fixes that, and it has to carry a map pin (`originCandidates`), since an address alone has no
  coordinate to send. `travelOriginFor` answers null for a place that was removed or has no pin, and
  the settings row reads its value through the same function, so what it says is what the estimate
  uses. An estimate is filed under `travelOriginKey` (the coordinates, never the name), so moving
  the pin or changing the setting asks again and a rename doesn't. Deliberately not built: a work
  origin chosen by schedule, and the previous event's place as the origin.
- **It is one switch and one number, not a rule list.** It shares `eventTask`'s occurrence key,
  eligibility gate and handled record by importing them, and deliberately not its rules engine.
  That engine's lead is whole days on purpose (`leadTimeReached`) where travel is minutes, and
  `parseEventRules` drops a rule with no cue, which a location trigger would be. With no per-rule
  title or cue there is nothing for a rule to vary, so `RuleListSheet` would be a list of one.
- **The lead can differ per calendar, and that is the only way it varies.**
  `travelLeadByCalendar` maps a calendar id to its own minutes ("Work events get 45 minutes"),
  holding overrides only, so a calendar left on Default keeps following the default when it
  changes; clearing an override deletes the entry rather than storing the default. The calendar is
  the honest key because it is a choice the user already made about where an event belongs.
  Parsing a neighborhood or a distance out of an address is not. The rows appear only once more
  than one calendar is picked, since with one there is nothing to tell apart.
- **All-day events are refused**, the one place this departs from `eventIsRuleEligible`: there is
  no start time to subtract from.
- **The reminder is what makes it useful, and it is deterministic.** Start less lead is known the
  moment the event is, so the evening before is enough to queue a morning reminder. The sweep
  writes through the end of the logical tomorrow, and the row is dated to the event's day, so it
  stays off Today until then.
- **It drifts, unlike `eventTask`.** That generator's title is the rule's and never changes. This
  one's carries the MTA note and its reminder follows the lead, so every handled occurrence that
  still has a live row is reconciled again. `matchedTravelTasks` returns handled occurrences
  flagged rather than skipped, and a handled one with no live row is left alone: the user deleted
  or finished it, and the handled entry is what keeps that answer. `updateTask` requeues the
  reminder on a title change, which is how a note reaches a notification already in the queue.
- **It clears on a change, never on the event happening.** `isTravelTaskStale` clears a row
  whose event was cancelled, moved (a new start is a new key) or lost its location while it is
  still ahead. Once the start has passed it reads nothing into the occurrence leaving the window,
  for `eventTask`'s reason above. The row carries `windowEnd` set to the event's start instead, so
  it expires once leaving is no longer possible and the user's own expiry setting decides what
  happens to it. The start comes back out of the source id (the occurrence key ends in it), so
  the decision needs no calendar read.
- **It is a notice** (`notice: true`). A leave reminder moved to Thursday has nothing to mean, and
  its title and reminder are rewritten by every sweep, so an edit would not survive one anyway.

### The MTA note

- **The feed is `camsys/subway-alerts.json`**, the MTA's keyless JSON rendering of GTFS-realtime
  alerts with its "Mercury" extension carrying `alert_type`. Its own switch (`transitAlerts`, off
  by default) is what stands in front of it, `productLookupEnabled`'s reason: there is no key to
  paste. The request is a plain GET for the whole city's alerts. Nothing about the user's lines,
  trips or calendar is sent; matching happens on the device. `src/__tests__/fixtures/mtaSubwayAlerts.json`
  is a real response, recorded 2026-09-16 and trimmed, so the parser is tested against what the
  MTA actually serves rather than against a remembered schema.
- **Planned work and live incidents are different answers, and that split is the feature.**
  Planned work (an entity id starting `lmm:planned_work:`, or an `alert_type` starting
  "Planned") is published days or weeks ahead, so a 10am read already knows about 11am's and the
  note is still true when the reminder fires. A live delay's `active_period` ends minutes out. So
  `alertIsFresh` gives a live alert 30 minutes from the read and planned work a day.
- **An alert is judged against the trip, not the moment of reading.** `alertOverlaps` asks whether
  any period overlaps leaving-to-arriving. That is what lets planned work starting at 11am show on
  an 11:30 trip read at 10am, and what stops a delay the MTA expects to clear by 10:20 being pinned
  to the same trip.
- **It only reports what can make you late.** Delays, suspensions, skipped stops, reroutes,
  express-to-local and reduced service. Extra service, station notices, boarding changes, adjusted
  schedules and any `alert_type` this doesn't know are dropped, since a note on a "Leave for" row
  is a claim the trip may take longer.
- **The note never alerts on its own, and that is a constraint rather than a choice.**
  `backgroundRefresh.ts` is a `BGProcessingTask` iOS mostly runs overnight, so nothing can re-read
  the feed at 10:55 for an 11:30 reminder while the app is closed. The background run still calls
  `checkTravelTasks` on the last snapshot, which is enough for planned work. A live incident is
  only seen while the app is open: `useTravelTaskSync` refreshes on foreground and every ten
  minutes while it stays in front, the one poll in the app, justified because a delay goes stale
  in minutes where a forecast holds for hours. A reliable push for live incidents would need a
  server, which is the "no backend" promise, and is deliberately not built.
- **The check re-runs when its data lands.** Every other generator checks on the launch sequence
  and the Today foreground sweep, which fire before the calendar read resolves. For a forecast a
  late answer costs nothing; for a delay it is the feature. `useTravelTaskSync` subscribes to the
  calendar, transit and settings stores and re-runs the check on change. It lives in `src/hooks/`
  because `useTaskStore` already imports the calendar and transit stores, so a subscription in
  either reaching back would be an import cycle.
- **Lines are picked globally**, the shape of Screen Time's app selection. Which line serves which
  event can't be known without routing. `TRANSIT_LINES` maps a rider's name for a line to its route
  ids, since "the 6" is two routes and "the S" is three shuttles.

It ships off, does not pause on vacation (an event on the calendar is happening anyway), refuses in
demo mode like the other calendar readers, and is gated on `calendarReadEnabled`. That last gate
turned up a bug: `generatorSwitchedOn` gated `calendarReview` on the calendar read but not
`eventTask`, whose pass also refuses without it, so its switch read "on" over a closed read while
writing nothing. Both are gated now through `CALENDAR_READ_KINDS`, the one list both the switch and
Settings' `blockedBy` read, and `generatedTasks.test.ts` fails if a pass's calendar refusal and that
list disagree.

## `weekendNudge` — the one that asks about a *span*

A weekend with nothing on it becomes "Make plans for the weekend", raised on the
Thursday or Friday before it. Structurally it is `projectReview` one shelf over —
a condition time passing brings about, so it fires from the launch sequence and
the Today foreground sweep rather than off any mutation, with the same
clear-then-create ordering and the same stale pass — but its source is neither a
row nor a single day key, which is what everything below follows from. The rules
themselves live in `src/utils/weekendTasks.ts`; what belongs here is how it sits
in the mechanism.

- **Its source id is the weekend's Saturday, and that names three days rather
  than one.** Every day-keyed generator before it asked about the square its key
  named; this one asks about Friday evening, Saturday and Sunday, and picks the
  Saturday to file it under. So it is in `calendarReview`'s position for every
  purpose the mechanism cares about — unsourced, nothing for
  `writeGeneratedOptOut` to write, a settings-level mark
  (`weekendNudgeLastWeekendKey`) in place of a stamp — and the mark buys
  something the others have to spend a cooldown on. "Once per weekend" is not
  arithmetic here, it is the identity of the key: Thursday's firing marks the
  weekend and Friday's pass finds it marked.
- **The window is asymmetric on purpose, and both halves of that are load
  bearing.** Friday counts only what the user placed in the *evening*
  (`timeSegments` carrying `evening` or `night`), because a Friday with six work
  tasks on it is not a weekend with plans, and reading a bare Friday task as one
  would silence the offer for everybody who works Fridays. Saturday's and
  Sunday's calendar events count and Friday's are deliberately not read at all,
  for the mirror reason: a whole-day busy figure cannot be narrowed to the
  evening the way the task count can.
- **It departs from `dayLoad`'s "no cue is never *this day is free*", and that
  is the one rule here worth arguing with before changing.** A weekend the app
  cannot see the calendar for still nudges. Held to that rule the feature is
  inert for everybody with calendar access off, which is most people; and the two
  failure directions are not symmetrical the way they are for a cue painted on a
  date picker, where being wrong is read while booking something. Being wrong
  here costs one task, once a weekend, on a row with a checkbox on it.
- **`upcomingWeekend` does not roll forward on Saturday and Sunday**, even though
  nothing can be raised on those days. The stale pass runs on them, and a window
  that had rolled forward would read Friday's live row as belonging to a weekend
  that was over and delete it in the middle of the two days it exists to be
  about. The lead-day gate (`isWeekendNudgeLeadDay`) is what stops it firing
  during the weekend, not the window.
- **The project it names is nominated, never inferred** (`Project.weekendSource`,
  off on everybody). Nothing scores a project for weekend-ishness or reads its
  title, and it is deliberately *not* a reading of `Project.kind` — that field is
  presentation only and its own note says it should stay that small, so gating
  behavior on it would be exactly the thing that note forbids. Several nominated
  projects break the tie on `sortOrder`, the hand drag on the Projects screen,
  for the reason `reachOut` breaks its own tie there: it is the only ranking of
  these the user actually made.
- **It reuses the pull sheet rather than growing a surface.** The row's `linkUrl`
  is `projectReviewLinkUrl` — literally that function, not a second spelling of
  the same URL — so "bring something out of this project and put a date on it" is
  answered by the sheet that already does it, scoped to the nominated project.
  The task quoted in the notes comes from `dripCandidate`, so it is the same one
  that sheet will offer first rather than a second opinion about the project.
- **Acting on the row is what clears it**, which is the whole reason the check
  runs on a sweep: pulling a task onto Saturday makes the weekend not bare, and
  nothing about that mutation knows a row is sitting on Today asking for it.
  Same split `staleProjectReviewTasks` draws, and the same `dropGeneratedTask` so
  the app's own tidying up never writes an opt-out.
- **It stands down while a `moodNudge` row is live.** That generator's task is
  "Plan something you enjoy this week", which is this offer with a more specific
  reason behind it, so a low week with a bare weekend would otherwise put two
  rows on Today asking for one thing. This one yields, because the other fired
  off something the user recorded about themselves where this fired off three
  empty days. Structurally it is `checkPantryCheckTasks` standing down while a
  `pantryReview` row is live, and it copies both halves of that: it suppresses
  the **create half only** (a weekend nudge already raised, possibly deferred, is
  the user's, and the stale pass clears it on its own terms), and `checkMoodTasks`
  runs **first** at both call sites so the suppression lands in the same sweep
  rather than one behind it. The read is of a *live row*, deliberately, not of
  `moodNudgeTasks` — a nudge ticked off this morning stops standing in the way.
- **The lead window is a setting, and its floor is in the predicate rather than
  only in the clamp.** `weekendNudgeLeadDays` (default 2, so Thursday and Friday)
  can be narrowed to the Friday alone or widened back to the Monday, which is
  `moodNudgeAfterDays`' argument one shelf over: how much warning you want about
  a bare weekend is a thing only the person planning it can answer. What it may
  never buy is a way into the Saturday or the Sunday — `isWeekendNudgeLeadDay`
  bounds below at 1 as well as above at 5, so a stored 0, a negative, or a value
  from a peer on a different build cannot cross rule 2. The ceiling is the Monday
  because a sixth day runs into the previous weekend.
- **It ships off**, like every generator that adds a surface rather than
  replacing one already on screen, and it is gated on `isDemoModeActive()` for
  `calendarReview`'s reason rather than the general one: the busy half of its
  reading is the real device calendar. The demo's own example row is seeded
  directly in `demoSeed.ts`.
- **`Project.weekendSource` is in the Backfill walkthrough**, unlike
  `autoSchedule`, which that module leaves out for being meaningless until a
  sibling is already set. This one has no such dependency: it is a plain flag
  whose whole meaning is itself, so "missing" is just "off". It is the first
  project field there that is a toggle rather than a value picker, which is why
  `BackfillScreen`'s project step now branches on the field id instead of always
  rendering the cadence stepper. Dismissal stays per field, so "never chase me
  about this project" is not also "never suggest it for a weekend".

## `health` — a rule the user wrote, about a Health reading

"Under six hours of sleep, keep today light." Structurally `weather`
(`src/utils/healthRules.ts` is `weatherTasks.ts` with the condition swapped for
a number), and it sits between its two neighbours on every axis that matters.

Read `docs/arch/health-data.md` first. It holds the rules about what a reader of
a health figure may claim, and they are what shaped every choice below — in
particular the one this generator would be worst to get wrong.

- **The app has the reading, so it decides.** Unlike `screenTime`, nothing here
  happens in another process: `useHealthStore` holds today's numbers and the
  pass compares them against a threshold. So the idempotency mark can be spent
  ahead of the decision, the way weather spends it, with the one exception
  below.
- **The threshold is per rule**, which is `screenTime`'s position rather than
  weather's. Weather refuses a per-rule number because the title carries the
  meaning; that move isn't available here, because the number *is* the rule.
  Six hours and four hours are two different days.
- **A rule reads as a floor or a ceiling, and the metric picks the default.**
  Steps, sleep and exercise are floors only: the mirror describes something
  that has already happened and needs no task. A nutrient can be either (too
  little protein, too much sodium), so `HealthRule.direction` overrides
  `HEALTH_METRIC_DIRECTION` per rule. Either way the task is about a shortfall
  against the number the user picked, never "you did enough".
- **A rule whose hour has not come is skipped without spending its mark**, and
  this is the one thing the generator needs that neither neighbour does. Every
  other day-keyed generator writes its mark ahead of the decision so a swiped-
  away task cannot come straight back. That order is unavailable for a
  shortfall: "under 3,000 steps" is true at 7am for everybody who is not out
  running, so marking the day considered then would mean the rule could never
  fire. `ruleCanBeJudgedYet` gates the whole consideration. Steps, sleep and
  exercise take a fixed hour from `HEALTH_METRIC_EARLIEST_HOUR` (sleep is settled
  by the time anybody looks, steps are not); a nutrient rule carries its own
  `checkpointHour`, defaulting to that table (`usesCheckpoint`). 18:00 is round
  rather than measured, the same admission `weatherCondition.ts` makes about its
  bands.
- **The hour is measured into the logical day**, not off the wall clock. With a
  4am reset, 6pm is fourteen hours in, and reading the clock instead would let a
  step rule fire two hours early for anybody whose day doesn't start at midnight.
- **A missing reading never matches**, and that is the rule the whole feature
  rests on rather than a null guard. HealthKit serves a refused read as an empty
  store, so null covers "you said no" as well as "nothing recorded" — reading it
  as zero would fire "Go for a walk" at everybody who declined to share their
  steps, every single evening.
- **It needs a second switch none of the others do.** `healthTasks` is the
  generator's own key, and `healthReadEnabled` gates the pass as well, because a
  generator that fires off Health data cannot run while the app is not allowed
  to read any. The rules sheet renders a notice card when the read is off, and
  turns it on from there — nobody is left with a toggle that visibly does
  nothing.
- **Its category is its own** (`healthTaskCategory`), defaulting to "Health",
  not the name `ensureHealthCategory` uses ("Biostats"). The Today reading's
  section is information rows only, and no generated task files into it. The
  two settings stay independently clearable. Reusing `healthCategory`
  outright — the `calendarReview` move — was the tempting version and is wrong
  here: "don't show my step count on Today" is not the same instruction as
  "don't add health tasks", and one setting could not tell them apart.
- **`writeGeneratedOptOut` has nothing to write**, for weather's and
  screenTime's reason: the source is a rule in settings, not a row a decline
  could be stamped on.
- **It ships off**, like weather and screenTime, and wants two more switches on
  top of its own before anything happens.
- **It is gated on `isDemoModeActive()`** (see `calendarReview`), and this is the
  sharpest case for it: a reading taken in demo mode is a real person's, and a
  task written from it would be a claim about their body sitting in a database
  about to be thrown away. Both halves refuse — `healthBridge()` won't read and
  `checkHealthTasks` won't run — and the demo's example task is seeded directly.
  What is deliberately *not* seeded is a reading: the honest demo of one is its
  absence.
- **It does not gate on vacation mode**, following `weather` and `screenTime`.
  A short night is sunscreen, not work.

## `weighIn` — the one that fires on missing data

Every other generator here fires because something happened: a date arrived, a
row changed, a reading crossed a rule. This one fires because nothing did.
`checkWeighInTasks` reads the last few days of body mass out of Apple Health
and writes "Record your weight" only when none of those days has a reading on
it. Rules live in `src/utils/weightTasks.ts`, the write path and the chart it
points at in `docs/arch/health-data.md`.

**It is deliberately not part of `health`, despite reading the same store.**
That generator watches a metric the user wrote a threshold for and fires when
the reading crosses it: the data exists, and the task is a response to it. This
one is the mirror image, and folding them together would put "tell me when my
sodium is high" and "remind me to weigh myself" behind one switch. They are two
different permissions, the same way `healthReadEnabled` and `healthTasks`
already are. `moodLog` is the generator it actually resembles, which is why it
sits beside that one in the registry rather than beside `health`.

**The gap trigger is the whole design, and it is better than a cadence.** A
daily check-in that fires whether or not you already logged needs a separate
"did you log today" suppression, which is what `checkMoodTasks` does. Here the
absence *is* the trigger, so the suppression is free: somebody who weighs
themselves every morning unprompted never sees this task, and somebody who has
drifted for a fortnight sees exactly one. `weighInEveryDays` sets the window,
from a day to a month.

Five things worth not re-deriving:

- **It is the only async generator pass**, because it takes a Health read of
  its own rather than judging a snapshot some foreground effect already filled
  in. `useHealthSync` refreshes today's readings on every foreground, but the
  weight series is 180 days and belongs to the Weight screen alone, so
  `readRecentWeights` asks for a short window and stores nothing. The
  maintenance list fires it and moves on; nothing is ordered after it.
- **A null read and an empty window are different answers, and conflating them
  is the bug to avoid.** Null means there was no way to ask (not iOS, no
  Health, demo mode) and is evidence of nothing. `[]` means Health was asked
  and had nothing, which is exactly the case that should write a task. The pass
  returns on null *without spending `weighInLastDayKey`*, so a failed read is
  retried on the next foreground instead of silently answering "no readings"
  for the rest of the day.
- **It needs three switches on, and that is not one too many.**
  `weighInTasks` is the preference; `healthReadEnabled` is what lets the pass
  find out whether to ask; `healthWriteEnabled` is what lets the sheet record
  the answer. A task asking for a weight that the sheet would then refuse to
  save is worse than no task, so the pass checks all three. The two Health
  switches are permissions over a medical record and this one is a preference
  about a task list, so collapsing them would mean granting a data permission
  by turning on a reminder.
- **It pauses on vacation, unlike `moodLog` beside it.** A mood log is a
  personal record that a week away is the interesting part of. Hunting for
  scales in a hotel is a chore, and standing chores down is what vacation mode
  is for.
- **Deleting a request holds for the window, not for a day.** The gap trigger
  answers "how many rows", not "how often": once a window was empty, it stayed
  empty the next morning, so somebody asked every seven days who deleted the
  request was asked again every day after. A delete now stamps
  `weighInDeclinedDayKey` (the `weighIn` arm of `writeGeneratedOptOut`, the
  settings-level stamp a day key's lack of a source row calls for), and the pass
  stands down until `weighInEveryDays` have passed from that day
  (`weighInDeclineHolds`), before it spends a Health read. The pass clearing a
  request whose day has gone uses `dropGeneratedTask`, so an ignored request is
  not a decline: it comes back the next day, because it was never answered.

The row carries `dundundun://weight?log=1` so its link button opens the sheet
that answers it, and `completeWeighInTaskForToday` ticks the request off when a
weight is saved. Both are copied from `moodLog`, and the reason is sharper
here: a mood entry recorded late is still roughly true, while a weight that
was never typed is a number nobody can reconstruct afterwards.

## `waterShortfall` — the water still owed after the daily task was finished

A daily water task can follow the food log's water target (`Task.followWaterTarget`,
a toggle under "Log to Health" in the editor). While the task is open,
`syncWaterQuotaTasks` writes `followedWaterTargetCount` onto its `targetCount`
(the target, plus the exercise boost when today qualifies, over the amount one
unit logs), so a workout at noon just makes the day's task longer. This
generator covers the case that can't: the task was finished at 3 PM and the
target rose at 5.

- **The finished task stays finished.** Reopening it would undo a streak and a
  successor row for a rise nobody could have planned for, and "completed" is a
  record of something that was done. What is owed becomes its own one-off task
  ("Drink 500 ml more water"), written in the unit the person reads water in.
- **The amount is measured against the food log, not the finished task.**
  `waterShortfallMl` is today's target less today's total, rounded up to the
  stepper's step, and null under one step (rounding is not a task). Whatever got
  the day to where it is (the task, the stepper, a bottle logged as food) is the
  same answer.
- **Completing it logs the water it asks for.** The draft carries
  `logHealthMetric: 'waterMl'` and `logHealthAmount`, so it goes through the same
  `logTaskWaterToFoodLog` path the daily task does and moves the same bar.
  `drift` keeps the title and amount current as the total changes.
- **Day-keyed with no source row, `weighIn`'s position.** At most one a day:
  `blocksOnFinished` stops a completed one from being followed by a second, and
  `waterShortfallDeclinedDayKey` (written by `writeGeneratedOptOut`'s
  `waterShortfall` case) stops a deleted one from coming straight back, since the
  target is still above the total. One from a past day is dropped rather than
  deleted quietly, because nobody declined it.
- **A target that can't be known is left alone.** With the exercise boost
  configured and no Health reading for today yet, neither the followed count nor
  this generator acts: an unread value is not "no exercise", and acting on it
  would shrink a boosted target and complete or clear things the day had not
  earned. The same reason `followedWaterTargetCount` returns null.
- **It runs from `syncWaterQuotaTasks`**, which is already called whenever today's
  total, the water target or today's exercise changes (a settings subscription
  and a Health-store subscription in `useHealthSync`, plus the catch-up passes at
  launch). It needs no pass of its own and reads nothing outside the app.
- Ships off, pauses on vacation, and files under its own category setting like
  the rest. Rules are in `src/utils/waterShortfallTasks.ts` and the target
  arithmetic in `src/utils/waterTargetUnits.ts`.

## `snackNudge`: a snack suggestion when the food log runs low

From 3 PM by default, if today's food log states under half of the calorie
target (both adjustable), `reconcileSnackNudge` writes "Have a snack (620 of 2,000 kcal logged)". Rules are
in `src/utils/snackNudgeTasks.ts`; the pass is in `useTaskStore.ts`. It is
`waterShortfall`'s shape: day-keyed with no source row, at most one a day.

- **It can only say what was logged.** A day nobody logged is not a day of
  nothing, so the pass needs at least one entry that states calories
  (`loggedKcalToday` returns null for an empty log and for entries with no
  calorie figure, never zero). The title carries the figures it judged by, so a
  person who ate without logging sees that the log is what fell short, and the
  notes say the task can be dismissed in that case.
- **The target is the stored one, plus the active energy boost when one is
  configured.** With a boost configured and no Health reading for today, the
  pass leaves whatever is there alone: an unread value is not a lower target.
  Same refusal as `reconcileWaterShortfall`.
- **Two triggers.** Every write to today's food log calls it (through
  `syncWaterQuotaTasksIfToday` and the bulk delete), which is what removes the
  task once a snack is logged. The catch-up sweep calls it too, which is what
  brings it on when 3 PM arrives with no write since. The hour and the share
  are settings (`snackNudgeFromHour`, 12 PM to 8 PM; `snackNudgeSharePercent`,
  10 to 90 in steps of 10), clamped on read and write.
- **It refuses in demo mode**, `moodLog`'s position: the demo database holds a
  seeded snack task that no food log backs, and the pass would delete it as
  unwanted on the next sweep.
- **Completed or deleted blocks a second that day**, through `blocksOnFinished`
  and `snackNudgeDeclinedDayKey` (the `snackNudge` arm of `writeGeneratedOptOut`).
  One from a past day is dropped rather than deleted quietly.
- Ships off, pauses on vacation, files under its own category setting (default
  Health).

## `limitWarning`: a "don't do" task per Stay under limit

For each nutrient the person marked Stay under (`nutritionLimits`),
`reconcileLimitWarnings` keeps one negative task (`Task.polarity`): "Stay under
35g sugar · 28g so far". Rules are in `src/utils/limitWarningTasks.ts`; the pass
is in `useTaskStore.ts`, run beside the snack one on the same triggers.

- **A negative task, because a limit is a commitment not to do something.** It
  sits on Today all day, is never checked off, and its streak counts clean days,
  which for a limit is "days within it". It has no date and no recurrence, like
  the avoid-tasks a person makes by hand, and it is keyed by the nutrient so the
  streak stays on one row for as long as the limit does.
- **The app logs the slip.** When today's food log goes past the limit, the pass
  records one slip (`syncLimitAutoSlip`), quietly: no undo entry, no coins and no
  app block, since nobody tapped anything. `limitWarningAutoSlips` remembers the
  day it did, so deleting the entry that took the day over takes that slip back,
  and a slip the person logged is never added to or taken back.
- **It reads the food log, not Apple Health**, for the reason the Health rule
  can't: a rule sees one number from Health, and its threshold is a second figure
  to keep in step with the target. The notes name the day's total and the foods
  behind it, and the link button opens the Food log.
- **Deleting it stops it for that nutrient** (`limitWarningDeclined`), until the
  nutrient is set to Stay under again (`setNutritionLimits` clears it).
  Archiving one stops it too (`blocksOnFinished`). Turning the automation off
  removes them all, rather than leaving rows nothing keeps current.
- Refuses in demo mode, for the snack suggestion's reason. Ships off, pauses on
  vacation (the task hides and its streak holds), files under its own category
  setting (default Health).

## `bookEvent`: booking a saved event again

A saved event (`src/utils/savedEvents.ts`, an event kept for re-adding from the
quick event card) can carry an interval, `bookEveryMonths`, set in Settings ›
Calendar › Saved events. `reconcileBookEvents` writes "Book Optometrist"
`BOOK_LEAD_DAYS` (30) before that interval is up, counted from `lastStart`, the
start of the last event added from it. Rules are in `src/utils/savedEventTasks.ts`.

- **The interval is the opt-in.** The generator's switch ships off, and giving
  an event an interval turns it on (with its category), since a stepper that
  silently did nothing would be the worse answer. Turning the switch off in
  Automations still stops it.
- **The source id is the event and the cycle** (`key|YYYY-MM-DD`). Adding the
  next appointment, from the card or quick add, moves `lastStart` and so the
  id: the old cycle's live task is dropped (no opt-out), and both callers run
  the pass right after so it goes at once. A completed task blocks a second for
  its cycle through `blocksOnFinished`.
- **A delete stamps `bookDeclinedFor`** with the cycle's `lastStart` on the
  saved event itself, so the "no" syncs with the event, lasts exactly one
  cycle, and goes when the event is removed. Undo clears it.
- **The source is a synced setting**, so two devices reconcile the same cycle to
  the same derived id. Nothing is drifted: the due day changes only with a new
  cycle, which is a new source.
- Pauses on vacation, refuses in demo mode, files under its own category
  setting (default Personal).

## A rule's own category

The four rule kinds (weather, Screen Time, Health, calendar events) each have one
"File them under" setting, and each rule can override it with `RuleTaskCategory.category`
(`src/utils/ruleCategory.ts`). A rule with none uses the setting, so older rules read back
unchanged. `ruleCategoryFor` is the one place that decides, and it is what each
generator's draft calls. A rename follows through `renameInRuleCategories`, called from
`renameCategory`. A rule with neither files loose at the top of Today, which is what the setting's None says. (Events,
Screen Time and Health used to write nothing in that case; the hint never said so.)

## Every generator has its own category setting, and deleting a category has to follow them

Each kind has a "File them under" setting (`generatedCategorySetting` in `useCategoryStore`, the
one per-kind switch). Several defaults are categories a person may later delete (Groceries,
People, Meal Plan, Calendar), so a delete has to re-point *every* setting that names the category:
`clearGeneratedCategorySettings`, the sibling of `renameGeneratedCategorySettings`. A setting left
naming a deleted category files the next generated task under a name nothing has, and
`allCategories()` shows that as a section nobody made. Re-pointing leaves each setting holding an
answer, which is what `ensureCategoryFor` leaves alone at startup. The in-app delete
(`useTaskStore.deleteCategory`) and the MCP's `delete_category` both go through it, and a new
generator needs only its arm in `generatedCategorySetting`.
