# The calendar screen and projected occurrences

The calendar screen, and the walk that draws an occurrence which has no database row
(`calendarMonth.ts`, which `WhenPicker`, Look ahead and the snooze engine read).

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are strong defaults with the reasoning
attached: read the reason before deviating from one. Where this note and the
code disagree, the code is what ships, so fix the note.

---

## The calendar is a view of the calendar

The screen shows the person's calendar events first, and a task only when it has a clock time.
It used to list every task due, with a deadline or returning on the day, plus projected repeats and
completions, which made it read as one more task list. What it does now:

- **A day's list is an agenda** (`calendarAgenda.ts`, drawn by `CalendarAgenda`): its events and
  the tasks something places in the day (a time window, a reminder, a time block), one list in
  start order, with free stretches of an hour or more said between lines and a now line on today.
  "Has a time" is exactly what the Day view's clock places by, because the agenda is
  `buildDayTimeline` laid out as a list rather than a second reading of the day.
- **Every other task is one line, never rows** ("3 tasks without a time"), leading to the list that
  owns them: Today for today or a day gone by (an overdue task lives there), Later scrolled to the
  day for one still to come (`showTodayViewMode('later', dayKey)`, `laterTaskForDay`). Don't put
  task rows back on the day: the task lists already show them, and that duplication is what this
  replaced.
- **A timed task's box ticks, unticks or asks its question**, and anything else a row's box can
  mean (a target's unit, a slip, a meal pick) goes to the task's row on Today
  (`resetToLocateTask`) rather than restating `completionTapFor`'s whole switch here. Tapping the
  line opens the editor.
- **A cell's marks are its events**, a dot per event in its calendar's color, up to three
  (`dayEventColors`). It replaced the task-load shade and the deadline dot: those measured tasks,
  and the grid is now read for which days have things on them. `WhenPicker` keeps the shade, since
  picking a day for a task is exactly when task load is the question.
- **Hidden events are left off the grid and the agenda** (`useHiddenEventsStore`), as on Today,
  but stay in the event sheet a tap opens, which is where they are unhidden.
- **There is no bulk selection, no task drag onto a day, and no projected repeats** on this screen
  any more. The first two needed task rows; the third drew tasks that have no time to place them by.
- **Its own route, not a fifth Today lens** — see the Navigation note in `CLAUDE.md`. And paging months carries
  the selection with it: an agenda naming a day outside the grid would be about a day the
  buckets don't reach.
- **Four views: Day, 3 Day, Month and Schedule.** Week was dropped for Schedule, the two weeks
  from today as one list (`scheduleBlocks` folds each run of empty days into one line; today is
  always its own section). All four read the same buckets and events, built over `rangeDays`:
  the month's grid, two days past it (so 3 Day starting on the grid's last cell has its other
  columns), and in Schedule the two weeks from today. Switching to Schedule moves the month to
  today's, which keeps that range short.
- **3 Day** (`MultiDayTimeline`) is `buildDayTimeline` for each day on one shared axis; a
  column's header opens that day in the Day view. Its columns are a third of the width, so it
  spends the width on titles: 4pt side margins, a one-line hour gutter, and overlaps that
  **cascade** (`cascadeEntries`: a later start sits on top, offset 22pt, at an opaque fill) where
  Day splits them into lanes. A half-width lane left about 40pt of text. An all-day event on
  several days is one bar across them (`layoutAllDay`).
- **Dragging works in Day and 3 Day** (`DayTimeline`, `MultiDayTimeline`): a long-press on empty time then a drag down
  makes an event that long (the quick-add card opens with the span), a long-press on an event
  moves it, and its foot's grip stretches it. The arithmetic is `draggedRange` (quarter-hour
  snaps, never shorter than one, kept inside the day). Only an event wholly on the day can be
  lifted: a block the day clipped is part of an event. The responder is a descendant of the
  screen's scroll view, so the drag switches that scroll off for its length (`onDragStateChange`),
  the SortableList rule. A move goes through `moveEvent` in `useEventPeopleStore`, which carries
  the people linked to the event over to its new start (the link is keyed by occurrence) and
  writes one occurrence of a repeating event, never the series (`rescheduleEventDirect`, through
  `rewriteEvent`). The moved block is drawn at its new time until the next read brings it back
  there (`pendingMove`, matched on the occurrence's start as well as its id, since a repeating
  event's occurrences share one). In 3 Day a moved block also tracks sideways and lands on the
  column it is dropped over, at the same clock position (`draggedColumn`, whole columns, past
  halfway); making and stretching stay on their own day.
- **Tapping an event opens the event sheet on it** (`TodayEventsSheet`'s `focus`): the sheet
  narrows to that event with its details open, says how soon it starts, and offers Join when its
  URL or notes hold a call link (`videoCallLink`, read on the tap since notes are never kept).

## Projected occurrences

`calendarMonth.ts` reads a month of `dueDate` / `deadline` / `deferUntil` and owns the rules for
walking a repeat forward. The calendar screen uses its buckets only to find each day's real rows.
No schema change and no new column: it's a read over dates that already exist.

- **A dot may be projected; a row may not.** A recurring task's future occurrences aren't in the
  database — completing one spawns the next — so drawing the schedule means rendering something
  that doesn't exist. That's the thing the Series note in `CLAUDE.md` rejected for Later, and it's rejected
  there for a reason that doesn't apply here: a ghost in a *task list* needs a non-completable,
  non-selectable row type threaded through `TaskItem`/`TodayScreen`/`useTaskSelection`, whereas
  nothing on a day cell was ever tappable. So the boundary is drawn at the row: `dayDetail` returns
  real `Task`s and `{taskId, title}` captions for the projections. Deliberately not `Task` — hand a
  caption a Task and it ends up rendered as one.
- **Four things are never projected**, each of them a schedule the app doesn't actually promise:
  a **completed row** (recurrence leaves a tombstone per completion *and* spawns the successor, so
  walking tombstones draws every future occurrence once per completion the task has ever had —
  the same unbounded growth `groupRoster` exists to collapse); **`recurrenceFromCompletion`**
  (anchored to a completion that hasn't happened, so `getNextDueDate` answers from *today* and a
  walk would lay a fictional track from now to the edge of the grid); a **live chain** (completing
  advances `chainIndex` and spawns the next step *undated* — the recurrence only advances at chain
  end, so `getNextDueDate` isn't its next date at all); and an **archived row**. `canProject` is
  the one place that list lives.
- **Nor is a day before today, on a grid a person reads** (`projectFrom`, which `WhenPicker` passes as
  the logical today). An overdue recurring task is walked from its stored
  date, so its walk crosses days already gone, and no path will ever put a row there: a completion
  lands after today and a skip on today. The real overdue row still shows on its own day. Windows
  that start today (Look ahead, the weekend read) don't need it.
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
  clock gates, except that a pin-each-occurrence pin counts only while its task is visible, and it
  drops blocked, vacation-paused and paused-project tasks.) `windowStart`/`windowEnd`
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
- **A shade, in `WhenPicker`.** The tint behind a day's date steps up with how much is on it
  (`shadeFor` in `dayLoad.ts`: something, busy, full, the last two at `weightFor`'s thresholds).
  It replaced a dot per mark kind in three states, up to fourteen symbols with no legend, which read
  as noise. Don't add a second mark back to a cell without a reason that outweighs that.

## What else the grid shows about a day

`calendarExtras.ts` buckets the things the app already knows about a date that aren't a task's own
date: a project's away span (drawn as a named band under each row of the grid), planned meals (listed under
the day, not marked on the cell, and read through `entriesInRangeLive`, never the meal store's loaded window, which is only the week
Meal Plan last opened), birthdays and project deadlines.

- **Kept out of the task buckets.** A bucket's marks are read as work by `dayLoad` and the
  outstanding counts. None of these is work landing on the day, so they live in their own map and
  touch none of those.
- **The trip band asks `isAwayDay`**, the same as the away dashes `WhenPicker` draws, so the return
  day is never covered and a trip with no return date covers its departure only. Being away doesn't
  shade a cell; the band says it.

## Where a day's events come from

- **One lookup for a day's events, `eventsForDay`,** used by every view. The store's fortnight
  read answers first, then the grid read (`refreshGrid`, every event over `rangeDays`,
  taken on focus, on paging and whenever the fortnight read changes), then the trip read 90 days
  out, which holds multi-day events only. A day none of them covers is "not read", never "nothing
  scheduled", and the agenda says which.
- **The grid read is its own read**, like the trip and past reads: only this screen draws a far
  day's meetings, so it reads them while it is shown rather than widening the read every
  foreground pays for.
- **An empty stretch of a timeline is tappable**, in the Day view and in each 3 Day column
  (`slotMinutesAt` snaps it down to the quarter hour): a task at that time is seeded with
  `windowStart` on the column's day, the field that places a task on the axis, and an event with
  an hour-long span. Blocks sit above the tap layer and keep their own taps.
