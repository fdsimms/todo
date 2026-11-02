---
paths:
  - "src/store/useTaskStore.ts"
  - "src/store/useTaskGroupStore.ts"
  - "src/store/useProjectStore.ts"
  - "src/utils/dateUtils.ts"
  - "src/utils/visibilityUtils.ts"
  - "src/utils/calendarMonth.ts"
  - "src/utils/taskMoves.ts"
  - "src/utils/scheduleMovePrompt.ts"
  - "src/utils/chain.ts"
  - "src/utils/effort.ts"
  - "src/utils/deliverables.ts"
  - "src/utils/bulkCompletion.ts"
  - "src/utils/retention.ts"
  - "src/utils/openTasks.ts"
  - "src/utils/taskCompletion.ts"
  - "src/utils/taskUpdate.ts"
  - "src/utils/taskDraft.ts"
  - "src/utils/holidays.ts"
  - "src/screens/TodayScreen.tsx"
  - "src/components/TaskItem.tsx"
  - "src/components/TaskGroup*.tsx"
  - "src/components/TaskEditor.tsx"
  - "src/hooks/useAnswerFirstCompletion.ts"
  - "mcp/src/replica.ts"
---

# The task model: pinning, recurrence, retention, series, chains, stacks, projects

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).
These are the decisions every task path leans on, and each was shipped as a bug at least once first.

## Pinning — a pinned task has two rows, and that's the feature

Pinning adds a **copy** of a task to a "Pinned Tasks" block at the top of Today. The original row
stays exactly where it is, in its own category section, with its pin glyph lit. Both rows are live
and interchangeable — same task, so completing or swiping either does the same thing.

**Never filter pinned tasks out of the main list, except one with no category, and never render a
second list for the pinned layout.** An uncategorized task has no section of its own to stay in, so
`listItems` drops its second row while it is pinned (and it comes back on unpin). Filtering moved every row below the finger on each pin (so the next tap in a run landed
on a row that had just jumped), and a second list component remounted the list, lost its scroll
offset and dropped stacks. One `ReorderableList` is always mounted, nothing moves on a pin, and
the eye button in the pinned header hides everything else on request (`othersHidden`,
session-only, off by default).

The block is the list's **`ListHeaderComponent`, not rows in its data** — read that prop's note in
`ReorderableList` before moving it, since a header outside the ScrollView silently offsets the drag
math. As rows it couldn't work: `resolveDrop` derives a dropped row's category from the nearest
header above it, so a pinned row dragged down would inherit a category and a task dragged up into
the block would inherit none.

- **The block growing mustn't move the rows either, and that's `holdRowsOnHeaderResize`**
  (`ReorderableList`). Pinning a task far down Today grows a header that's scrolled out of view,
  which shoved every visible row down by a row's height. iOS's `maintainVisibleContentPosition`
  corrects it natively, anchored on the header or a zero-net-height sentinel below it and **never on
  a row**: a row anchor makes a drag's drop scroll the list by however far the top row moved. Read
  the prop's doc comment before changing the anchor.
- **`pinnedOrder` is its own number space** (`Task.pinnedOrder`, `reorderPinnedTasks`), because the
  section is hand-orderable and dragging a pin must not also move the original in Work. Default `0`
  = never ranked, with `sortOrder` breaking ties, so an install that upgrades into the column reads
  exactly as it did. Pinning stamps `max + 1` (appends to the bottom) — on the *transition* only,
  or the editor would reshuffle a pinned task to the bottom on every save.
- **The copy passes `duplicateRow`**, which keeps it out of the paint-select registry — that's keyed
  by task id, and two rows claiming one id means whichever unmounts first evicts a row still on
  screen. Same opt-out the drag overlay's floating copy already used.
- **Expansion is keyed on the row, not the task** (`renderTaskRow`'s `rowKey`, `pin-<id>` for the
  copy), so tapping one row doesn't also expand its twin halfway down the list. **A pinned stack's
  tray follows the same rule** (`pinnedGroupOpen`, session-only), rather than sharing
  `group.collapsed` with the stack's own tray.
- **`pinnedTasks()` ignores the *clock* gates on purpose** — a pinned task shows in the block whether
  or not it's due today. So the copy passes `hidesWhenOnPace: false`, and a pinned task that isn't
  visible today has only the one row rather than two. It does **not** ignore the hides that aren't a
  clock, and the selector writes its filter by hand rather than reusing
  `isVisibleApartFromVacation`, so a new non-clock hide has to be added there too. Today it excludes
  completed, archived, vacation-paused, *held back* (`isHeldBack` — waiting on another task or on a
  person) and paused-project tasks. Pinning is an answer to "not yet *today*", not to "can't be done
  yet at all": a blocked pinned task would sit at the top of Today with nothing the user could do
  about it.
- **A pin-each-occurrence pin is the one exception to the clock rule.** Its successor is spawned
  pinned, so the pin answers the occurrence, not the schedule: it counts only while the task is
  visible (`isPinnedOnToday`, which the block, the row's glyph and its pin button all read). A
  not-yet-due occurrence shows an unlit pin and no pin button.
- **One exception to that: a pinned daily target unpins itself once logging catches it up to pace.**
  Otherwise it would sit pinned at the top of Today, at quota, until the next unit falls due hours
  later — the exact "hidden until later" state pinning is supposed to override for a task that
  merely isn't due, not one that's already met for now. `logQuotaUnit` (`useTaskStore.ts`) is where
  this lives, gated on `isQuotaOnPace`, with the same grace window (`QUOTA_PACE_UNPIN_HOLD_MS`) the
  completion unpin above gets, since either row's meter can still be mid-burst (see
  `QUOTA_HOLD_BACKSTOP_MS`) when the unit that catches it up lands.

## Recurrence

Completing a recurring task creates a new task row with a new `id` and the next computed `dueDate`. The original task is marked completed (not deleted). `getNextDueDate()` in `src/utils/dateUtils.ts` handles all recurrence types; it anchors to the previous `dueDate` for fixed schedules, or to today for `recurrenceFromCompletion`.

There is no rule entity separate from the occurrence holding it, and `dueDate` does double duty: it is both the date this occurrence sits on and the anchor the whole future grid is measured from. That is the deliberate design (materialised rows, same call the Series note makes below), and these four rules are what it costs. They were all shipped as bugs first, so don't undo one by re-deriving it from the code.

- **Moving one occurrence must not rebase the rest, and the two directions need different mechanisms.** Rescheduling a recurring task rebased its entire future: move Tuesday's occurrence to Thursday once and it was a Thursday task for ever. Anything that moves a date-anchored task (`isDateAnchored`, `src/utils/taskMoves.ts`) has to say which of the two it is doing.
  - **Pushing it out writes `deferUntil`**, a floor laid over the stored date, which is what `getEffectiveTaskDate` exists to render and what the successor drops (`deferUntil: null`). A push must also *hide* the task until then, or the one you moved to Saturday still sits on Today, and that is exactly what a defer is.
  - **Pulling it forward writes `dueDate` and `recurrenceAnchorDate`.** A defer cannot pull a task in front of its own date, and there is no "un-hide" to pair with the hide: the only way a task surfaces on Wednesday is for its date to *be* Wednesday. So the date moves honestly and the grid keeps its own anchor to step from. **Don't try to unify the two** — that asymmetry is the schema being honest about two different wants. Both live in `scheduleMoveUpdates` (`taskMoves.ts`), which every mover calls.
  - **Whether a pull keeps the grid is the person's call, asked at the moment of moving.** Keeping it is right for "just this once" and surprising for "I'm doing it today now" (a daily task pulled from tomorrow onto today comes back the day after tomorrow), so the row's picker and the bulk bar's When ask through `confirmScheduleMove` (`src/utils/scheduleMovePrompt.ts`) whenever `pullForwardChoice` says the two answers differ. "Count from the new date" is `scheduleMoveUpdates`' `restartSchedule`, a plain reschedule. The trip move (`awayShift`) never asks: it shifts a whole span, and keeping each grid is the point of it.
  - **`recurrenceAnchorDate` is consulted only by the recurrence engine**, which is the whole reason it is a grid anchor rather than a placement override: `getNextDueDate`'s base, `projectOccurrences`' walk, and `recurrenceAnchorDayFor`. Every reader of "what day is this on" — visibility, sorting, the widget, Search, the month grid's own cells — keeps reading the real `dueDate` and needs to know nothing. An occurrence-level date that overrode `dueDate` for placement was the obvious shape and would have put all of them in scope.
  - **The projection walk clears it after the first step** (`stepOccurrence`), or every step recomputes the same next date off the same anchor and the walk stalls on one day.
  - **Any `dueDate` written without it clears it**, which is one rule in `updateTask` rather than a `null` at each re-dating call site (the editor's Date row, `skipNextRecurrence`, the chain step on schedule, the expired sweep). A patch naming the field wins outright, which is both the pull-forward writing the pair together and a whole-snapshot undo restoring what was there. `completeTask`'s successor is built as a row rather than patched, so it drops the anchor explicitly alongside `deferUntil`.
- **`getNextDueDate` steps the grid; `{ catchUp: true }` walks it to the present.** Off by default because `projectOccurrences` walks this one occurrence at a time to draw a month, and a first step that skipped to today would drop every earlier cell. On for the two callers *placing a real row* — `completeTask`'s successor and `skipNextRecurrence` — because without it, finishing a task five weeks late spawned a successor dated four weeks ago: overdue on arrival, and five more completions (five more tombstones) to work back to the present. It walks the rule's own grid rather than landing on today outright, so a Friday task caught up is still on a Friday. **A real completion covers the day it happened on** (`coversCompletionDay`, set by `buildCompletion` unless the row is marked missed), so the successor lands strictly after today: a daily task finished a day late used to get today's row back at once, and a one-tap-a-day habit stayed a day behind for ever. A skip or a missed mark covers nothing and still lands on today. `rolloverQuotas` reached the same conclusion for quota tasks by its own route and keeps it, since a partial day's record has to land on the day it belongs to.
- **`recurrenceAnchorDay` is what a short month is clamped *from*.** `addMonths` clamps Jan 31 to Feb 28, and with the stored date as the only anchor that clamp fed the next one: Feb 28, Mar 28, Apr 28, for ever, off a single February. Yearly did it to Feb 29. The column holds the day-of-month the grid is anchored to for the picker's "same day as the due date" option (an explicit `recurrenceMonthDay` or `recurrenceWeekOrdinal` already answers this, and `recurrenceFromCompletion` measures from a day rather than a date). It is captured whenever the user *writes* the schedule (`SCHEDULE_FIELDS` in `updateTask`) and deliberately never when the app moves the row itself, which is the entire mechanism: recompute it on an unrelated patch and the successor sitting on Feb 28 hands the drift straight back. Same fix `getNextSeriesDates` already applies to a dated series.
- **The last occurrence of a counted recurrence says so** in the undo bar (`finishedRecurrence` in `completeTask`), since a schedule ending and a successor going missing otherwise look identical; `docs/arch/supplies.md` has the reasoning.
- **A holiday can skip or move an occurrence, and a caller placing a row writes back where the rule put it.** `Task.recurrenceHolidays` is applied inside the engine (`getNextOccurrence` in `dateUtils.ts`, over `src/utils/holidays.ts`), so the successor, a skip and the month grid agree. A move returns `gridDate`, the rule's own day, which the caller writes to `recurrenceAnchorDate` (the pull-forward mechanism) or the next step measures from the moved day and the schedule drifts. A new caller that places a real row uses `getNextOccurrence`, not `getNextDueDate`, for exactly this.
- **A multi-week interval counts weeks from the user's own week start.** `weekStartsOn` is a real setting and the weekday walk used to ignore it, so "every 2 weeks on Fri and Sun" split a Monday-start user's pair across two blocks, 9 days apart instead of 2. With `weekStartsOn: 0` the arithmetic is unchanged.

One walk draws every projection (`projectOccurrences` in `src/utils/calendarMonth.ts`, used by the month grid, `lookAhead` and `snoozeEngine`). Don't write a second: a private copy misses `canProject`'s refusals (a `recurrenceFromCompletion` task has no projectable future, since its next date is always answered from today).

## Completed-task retention

Every completion leaves its row behind, so a daily recurring task accumulates one tombstone a day forever. Two read-time collapses exist because of that (`groupRoster`, and `projectProgress`'s separate one); `completedRetentionDays` is what finally bounds it at the source — `null`/forever by default, so an existing install changes nothing until the user picks a window in Settings. Rules live in `src/utils/retention.ts`, the delete in `purgeOldCompletedTasks` (startup, after every other maintenance pass, and again when the window changes).

- **A pass that only wants open rows starts from `openTasksOf`** (`src/utils/openTasks.ts`), never a scan of `tasks`. History is most of the array on a phone in use, and every list selector in `useTaskStore` reads from it, cached per task array.
- **Archived rows are exempt.** Archiving is an explicit "keep this, out of my way"; the window is for tombstones piling up unasked.
- **Only top-level rows are ever named.** A completed subtask under a *live* parent is a checked-off step, not history — `dbBulkDeleteTasks`' `parent_id` cascade takes the subtasks of a purged parent, so listing subtasks directly would be the bug, not the feature.
- **Streaks are safe and that's structural**, not luck: `streakCount`/`streakDate` and their `previous*` snapshot live on the row still running the streak and are never summed back across the chain. The pointers that *do* cross rows (`previousOccurrenceId`, `blockedById`) are resolve-or-shrug at every reader — `canBlock(undefined)` is false, chain walks stop on a missed lookup — and already dangle this way after a manual Logbook delete, so a purge leaves them rather than rewriting rows it isn't deleting.
- **An unattended delete never arms shake-to-undo.** A delete the user didn't just perform, sitting under their first shake of the session, is not an undo. The purge bypasses `bulkDeleteTasks` for this; the expiry sweep passes it `registerUndo: false`. Any new pass that deletes on the app's own behalf does one or the other.

## Series (`seriesId`) — one task on several dates

A task the user gave more than one date ("walk the neighbour's dog on the 10th and the 15th") is **N real rows sharing a `seriesId`**, each an ordinary one-off with its own `dueDate` and `recurrenceType: 'none'`. It is deliberately not one row holding a list of dates (`dueDate`/`completedAt`/`streakDate` are singular in every visibility, completion and Logbook path), and not projected "ghost" rows, which would need a second, non-completable row type through every list.

**Never reuse `previousOccurrenceId` to link them.** That's the backward completion chain, and `uncompleteTask` deletes whichever row points at the one being uncompleted — un-ticking the 10th would delete the 15th.

- **One entry point**: `applyTaskDates(taskId, dates, repeat?)` creates a series around a task, reconciles an existing one, or dissolves it back to a plain task when the set drops to one date. `addTaskSeries` is the create-from-scratch path. Reconciling never touches completed **or archived** rows — a date that already happened, or that the user filed away, is history and not schedule.
- **A series never carries a recurrence rule.** They're two schedules for one task, and the editor will happily save both — so `buildSeriesRow`/`applyTaskDates` strip the rule (`NO_RECURRENCE`) when a set forms. Without that, every row kept the rule and each completed date spawned an extra occupant *of the same series*. For the same reason nothing spawned by `completeTask` inherits `seriesId`: the only way to spawn off a series row is mid-chain, and that lands on a day the set already has.
- **Repeat is optional and separate from recurrence**: `seriesMonthDays` (empty = happens once) holds day-of-month anchors, `seriesRepeatMonths` the interval. The next set is inserted by `completeTask` only once *every* date in the current one is done, so finishing the 10th doesn't conjure a third row while the 15th is outstanding. `getNextSeriesDates()` rebuilds from the stored day numbers rather than shifting the current dates, so a 31st clamped to the 28th for February comes back as the 31st in March. The interval field isn't exposed in the editor yet — the UI ships a monthly on/off toggle.
- **Editing** is scoped like a recurrence: `updateTask(..., {scope: 'series'})` fans `CONTENT_FIELDS` out to the set's *later* incomplete dates, re-anchoring `reminderTime` onto each date's own day (it's an absolute instant, and a set shares an hour, not a moment).
- **Counting**: `groupRoster()` collapses a series to one entry, same as it does recurrence tombstones — otherwise a stack holding a 2-date series reads as 2 members. `getRepeatedInstances()` skips series rows so a deliberate schedule isn't reported as an ad-hoc repeat. **Cascades must expand it again**: the roster names one row per member, so `deleteGroup({cascade:true})` collapsing to it deleted one date of a set and orphaned the rest.
- **`projectProgress` has its own collapse and can't reuse the roster** (`src/store/useProjectStore.ts`). Same disease — a recurring member's tombstones grew the denominator forever — but the cure differs: the roster drops old completions, which is right for a stack (they aren't members) and wrong for a project, where a one-off finished last week is exactly a member and exactly done. So it groups rows by identity (`seriesId`, else the root of the `previousOccurrenceId` chain) and counts each once, done only when nothing in it is outstanding.

## Chains

Chain items (`chainItems[]` / `chainIndex`, shown in the editor collocated with Repeat since the two are easy to conflate) are a singly-linked list of steps, independent of recurrence: completing a chained task always advances `chainIndex` and immediately spawns the next task with no `dueDate`, ending after the last item. Repeat changes only what happens at that last item — instead of ending, `chainIndex` wraps to `0` and the whole chain repeats on the recurrence's schedule. See the `spawnsNext`/`atChainEnd` logic in `completeTask()` (`src/store/useTaskStore.ts`). `rowToTask()` maps the legacy `cycle_enabled`/`cycle_index`/`cycle_items` SQLite columns to the `chain*` fields on `Task`.

**A step carries its own `estimatedMinutes`, and every workload read goes through `estimatedMinutesFor()`** (`src/utils/effort.ts`) rather than `task.estimatedMinutes` — the same discipline `displayTitleFor` imposes for titles, and for the same reason: mid-chain, only one step is on the day, but the task-level estimate covers the whole chain. Read raw and a five-step routine charges its full estimate at *every* step, and since completing a step spawns the next onto the same day, the day's planned total never falls as the chain is worked. The step value is optional and falls back to the task's, so a chain nobody has itemised behaves exactly as before. `activeChainStep()` (`src/utils/chain.ts`) is the one place the "which step is live" rule lives — including that a single-item chain doesn't count as one.

**A step carries its own question too, and every deliverable read goes through `deliverableKindFor()`** (`src/utils/deliverables.ts`) rather than `task.deliverableKind` — the third field on the same pattern, for the same reason and with the same `step ?? task` fallback. `deliverableKind` is a `CONTENT_FIELD`, so it rides `...effective` onto every successor: with only that to read, a two-step chain that asks a question at step one asks it again at step two. The readers are the row's "?" glyph, `completionTapFor`, the prompt sheet, Logbook (including its Edit answer item and `setDeliverableValue`), Search, `projectDecisions` and `selectPurgeableTaskIds` — the last two matter because a chain step's recorded answer is a decision the project should list and a row retention must not purge. The *answer* stays on the row (`deliverableValue` is per-occurrence, like `progressCount`) and needs no per-step counterpart, since a chain only has one step live at a time and each step is its own row.

**A `'date'` step can place the step after it, and that's opt-in per step** (`ChainItem.deliverableDatesNextStep`). "Book haircut" is answered with the appointment and "Get haircut" lands on that day instead of on the day the booking got done. In `completeTask` it's one more candidate ahead of the two dates that were already there — `answeredDue ?? nextDue ?? midChainDue` — so the successor's re-anchored `reminderTime` and relative `deadline` follow it for free. Three rules hold it in place:

- **It is deliberately not something a date step just does.** Recording a date and *moving another row* are two different wants, and the second one wants to be visible in the editor rather than being an unannounced second meaning of the kind. The prompt sheet names the step it's about to schedule for the same reason.
- **It never applies at `atChainEnd`.** The last step of a plain chain spawns nothing, and a repeating chain's wrap is the recurrence placing the next cycle — `nextChainStep()` refuses to wrap for exactly this, and `completeTask` checks both.
- **It ignores the `hasNoDateSignal` guard `midChainDue` obeys.** That guard exists so a chain with no placement at all doesn't acquire one by accident; an answer given a second ago is not an accident.

This is the one reader `src/utils/deliverables.ts` was left open for (#1253) and it is still not a general write-anywhere mechanism: one field, one place, reusing the date the successor was getting anyway.

**Every completion path with a person present asks; only the unattended ones complete unanswered.** `completeTask` reads an omitted `deliverableValue` as "nobody asked" and completes with no answer, which is right for the missed sweep, the quota rollover and meal sync, and was wrong for the four paths a person actually taps: the bulk bar, a stack's "complete all", the focus session's Done, and a Live Activity's Done on a task with no row mounted. Each dropped the answer with nothing said, and once an answer can place the next chain step, what was dropped was a task's date rather than only a note. They now go through `useAnswerFirstCompletion` — a three-way confirm (Answer / Complete Without Answering / Cancel) for the paths completing several, `enqueue` straight to the questions for the paths completing one, and `DeliverablePromptQueue` asking them one sheet at a time. **Completing unanswered stays one tap**: the feature's rule is that nothing may ever *require* an answer, so what changed is that it's chosen rather than assumed. Cancel costs nothing, including the selection the bulk bar was built from.

## Stacks (`TaskGroup`)

"Stack" is the user-facing name; the code says `TaskGroup` / `group` throughout (table `task_groups`, `useTaskGroupStore`, `TaskGroupHeader`/`TaskGroupEditor`). A stack is a lightweight, stable *label* that several independently-scheduled tasks hang off — deliberately not a `Task`, so it can never be "not due yet" and desync from its members. Membership is `Task.groupId`.

**A stack's membership is a set of task *series*, not of task rows.** This is the one thing to get right. Because `groupId` rides along on the `...effective` spread in `completeTask()`, a completed occurrence keeps its `groupId` forever *and* so does the fresh row it spawns — so the raw child rows grow by one per completion, without bound. Never count, cascade over, or list `groupChildrenOf()`; use **`groupRosterOf()`** (store) / **`groupRoster()`** (`src/utils/visibilityUtils.ts`), which collapses those rows back to one entry per series. `groupChildrenOf()` is only for the rare "all history too" case, like re-filing rows when the stack is deleted.

Two counts exist and they mean different things, so keep them labelled: the roster is *membership* ("8 tasks", shown in the editor), and `isRelevantToGroupToday` filters that to *today's work* ("3/8 today", the badge on the Today row). A member that isn't due today is still a member.

**`TaskGroup.sortOrder` is in the same number space as `Task.sortOrder`** — a stack holds a slot in its category section exactly like a loose task, and `makeCategoryGroups` merges the two by that number. A separate ranking for stacks would make "task above stack" unrepresentable. So `resolveDrop` hands out one running rank across tasks *and* stacks, and `reorderWithCategoryUpdates` persists those ranks verbatim rather than renumbering the tasks 1..N — the gaps where the stacks sit are the point. (Group *children* still carry a private within-stack 1..K order, set by `reorderGroupChildren`; that space is unrelated.)

**A stack has no completion state of its own — stored, derived, or dismissed.** Today renders one exactly while it has a visible child (`visibleGroupItems` in `TodayScreen`: `children.length > 0`, and `children` comes from `visibleTasks`), so it leaves in the same commit its last row does and returns whenever a member is visible again. The `completed_at` column on `task_groups` is left over from a "dismissed for today" stamp that cost a tap per stack per day; it is unread and never written. **Don't reintroduce a hidden-for-today flag** — riding on `visibleTasks` is what makes the header and its rows leave together, since a just-ticked row stays in `visibleTasks` for the completion hold (`completionHoldIds`) and the header rides that window out with it.

**`TaskGroup.onToday` is a presence bit, not that flag coming back.** A stack arriving on Today
collapses (`syncTodayPresence`, written from `TodayScreen`'s own render of what's on the day), so
an expansion doesn't outlive the stack's stay: one expanded on Monday and finished off would
otherwise come back on Tuesday expanded, dropping its whole roster into the middle of the day. A
stack that never leaves keeps whatever the user set, restarts included. What makes it safe is that
it gates *nothing* — Today still renders a stack exactly while it has a visible child, and a wrong
value costs one tap on the chevron rather than a stack that won't come back. Presence is read off
`visibleTasks` and `upcomingTodayTasks` rather than the filtered list, so a stack the priority
filter hid hasn't left, and it counts Later Today as being on Today, so crossing from one to the
other isn't an arrival. The write waits for both stores to report `initialized`: mid-load every
stack looks absent, and recording that would re-collapse the lot on every cold launch.

Cascades (`completeGroup`, `deferGroup`, `pinGroup`, `deleteGroup`) are roster-scoped so they can't mutate completed history. `deleteGroup({cascade:true})` deletes the live members and merely unfiles the past occurrences — deleting a stack must not erase its Logbook and Stats history.

## Projects

**Anything that lists or counts a project's tasks leaves archived rows out.** Archiving means "out of every list", and `projectProgress`, `projectDecisions`, `projectCompletedRows` and `liveProjectSteps` all filter `!t.archived`, and so does the project page's own list (a drag there goes through `reorderProjectItems`, which reads `liveProjectSteps`, so a row it can't see snaps back). A new reader of a project's members filters it too, and a section's roster needs the same care in the other direction: it can hold tasks filed under other projects, so anything acting on it from a project's page scopes it to `t.projectId === projectId` first.
