# The month grid and projected occurrences

The calendar screen, and the one place in the app that draws an occurrence
which has no database row.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are strong defaults with the reasoning
attached: read the reason before deviating from one. Where this note and the
code disagree, the code is what ships, so fix the note.

---

## The month grid — the one place a projected occurrence is drawn

`CalendarScreen` reads a month of `dueDate` / `deadline` / `deferUntil`; `calendarMonth.ts` owns
every rule it renders. No schema change and no new column — it's a read over dates that already
exist, which is why the whole feature is a util plus a screen.

- **A dot may be projected; a row may not.** A recurring task's future occurrences aren't in the
  database — completing one spawns the next — so drawing the schedule means rendering something
  that doesn't exist. That's the thing the Series note in `CLAUDE.md` rejected for Later, and it's rejected
  there for a reason that doesn't apply here: a ghost in a *task list* needs a non-completable,
  non-selectable row type threaded through `TaskItem`/`TodayScreen`/`useTaskSelection`, whereas
  nothing on a day cell was ever tappable. So the boundary is drawn at the row: `dayDetail` returns
  real `Task`s for the day's list and `{taskId, title}` captions for the projections, under
  "Expected". Deliberately not `Task` — hand a caption a Task and it ends up rendered as one.
- **Four things are never projected**, each of them a schedule the app doesn't actually promise:
  a **completed row** (recurrence leaves a tombstone per completion *and* spawns the successor, so
  walking tombstones draws every future occurrence once per completion the task has ever had —
  the same unbounded growth `groupRoster` exists to collapse); **`recurrenceFromCompletion`**
  (anchored to a completion that hasn't happened, so `getNextDueDate` answers from *today* and a
  walk would lay a fictional track from now to the edge of the grid); a **live chain** (completing
  advances `chainIndex` and spawns the next step *undated* — the recurrence only advances at chain
  end, so `getNextDueDate` isn't its next date at all); and an **archived row**. `canProject` is
  the one place that list lives.
- **The walk decrements `recurrenceCount` itself.** It's "occurrences remaining, including this
  one" and `completeTask` takes one off per spawn — walking without it projects a repeat-3-times
  task all the way to the edge of the grid, because `getNextDueDate` reads the count off the row
  it's handed and that row never runs down. `recurrenceEndDate` needs no such care; it already
  returns null.
- **A relative deadline is projected with its occurrence** (`deadlineOffsetDays`,
  `deadlineMonthDay`), reusing `getDeadlineFromOffset`/`getDeadlineFromMonthDay` rather than
  restating the arithmetic — the sign is the whole meaning of that field. A *fixed* `deadline`
  doesn't carry forward, so it has nothing to project.
- **Placement, not visibility.** A task shows on its day whether or not it's actionable there —
  vacation-paused, blocked, behind a time segment. The grid answers "what date is this on";
  `isTaskVisible` is Today's question. (Pinning is the opposite call: `pinnedTasks()` ignores the
  clock gates but does drop blocked, vacation-paused and paused-project tasks.) `windowStart`/`windowEnd`
  are correspondingly *not* a fourth signal: they're clock times within a day, with no cell to
  land in.
- **The reset time deliberately doesn't reach the bucketing.** `getTaskDayStart` only moves the
  clock time inside the date it was handed and never rolls it to another day, so
  `dayKeyOf(getTaskDayStart(d, r))` is `dayKeyOf(d)` for every `r`. Threading `dayResetTime`
  through the buckets would read like it did something. Projection takes it because
  `getNextDueDate` does.
- **A projected step carries the holiday anchor the real successor would.** `stepOccurrence` asks
  `getNextOccurrence`, and when a holiday moved the occurrence (`Task.recurrenceHolidays`) it
  puts the rule's own day on the cursor as `recurrenceAnchorDate`. Cleared instead, as every
  other step clears it, the projection would step from the moved day and drift a day per holiday,
  so the grid would disagree with the rows the app actually writes.
- **Three dot states, not two.** `solid` (real work outstanding), `done` (rows here, all ticked),
  `projected` (hollow). Collapsing `done` into `projected` makes a finished Tuesday read as a
  guess; collapsing it into `solid` makes a month you've cleared look untouched.
- **Its own route, not a fifth Today lens** — see the Navigation note in `CLAUDE.md`. And paging months carries
  the selection with it: a detail pane naming a day outside the grid renders "Nothing on this day"
  about a day that simply isn't in range.
- **The week view is a slice of the same grid, not a second walk.** It draws one row of the
  month's `DayCell`s over seven per-day sections, every one resolved from the month's buckets
  (`dayDetail` per day, `dayRows` for the one-row-per-task list). That works because the selected
  day always sits in the displayed month, so its whole week is inside that month's 42 cells; paging
  a week goes through `stepDay`, which moves the month along when the week crosses into the next.
  A task can land on two days of one week (due Monday, deadline Friday), so its rows are keyed by
  day and task, the same per-row expansion the pinned copy on Today uses.

## What else the grid shows about a day

`calendarExtras.ts` buckets the things the app already knows about a date that aren't a task's own
date: a project's away span (drawn as a named band under the week row), planned meals (a green dot,
and read through `entriesInRangeLive`, never the meal store's loaded window, which is only the week
Meal Plan last opened), birthdays, project deadlines, and what was completed that logical day.

- **Kept out of the task buckets.** A bucket's marks are read as work by the dots, the outstanding
  counts and `dayLoad`. None of these is work landing on the day, so they live in their own map and
  touch none of those.
- **A trip band and the weight cue agree by construction.** Both ask `isAwayDay`, so the return day
  is never covered and a trip with no return date covers its departure only. On an away day the cell
  draws no dashes; the band says it.
- **Completions file on their logical day**, the way Logbook groups them, and a task the day already
  lists (due and ticked the same day) is not listed again under Completed. Missed rows stay out.

## Events on the week and the day

- **One lookup for a day's events, `eventsForDay`,** used by the day view for the selected day and
  by the week view for each of its seven. It is where the fortnight read, the trip read past it, and
  "not known" are decided, so the two views can't answer the same day differently.
- **The week lists events as plain lines, not on a clock.** Tapping one opens the same event sheet
  the day view's timeline opens.
- **An empty stretch of the day timeline is tappable** (`slotMinutesAt` snaps it down to the quarter
  hour): a task at that time is seeded with `windowStart`, the field that places a task on the axis,
  and an event with an hour-long span. Blocks sit above the tap layer and keep their own taps.

## Dragging a task onto a day

Long-press a Due or Returning row in the month or week view and drop it on a cell. Three decisions:

- **The drop is the date picker's move, not a new one.** It goes through `confirmBulkSetWhen`, so a
  push lays `deferUntil`, a pull moves `dueDate`, and a repeating task is asked about its schedule,
  exactly as the row's own reschedule does. Dropping on the day it's already listed under does nothing
  (`isMoveDrop`).
- **Deadline rows don't lift**, and nothing lifts in the day view (no grid to drop on). Moving a
  deadline is a different question from moving the work.
- **The aimed cell is on a `DropTargetChannel`, never screen state**, and the card rides an Animated
  value, so a drag re-renders two cells per crossing rather than the screen. The responder sits on
  the screen's root, an ancestor of the scroll view, and scrolling is off for the drag's length.
  Cells are measured once, at lift (`calendarDrag.ts` hit-tests against those rectangles).
