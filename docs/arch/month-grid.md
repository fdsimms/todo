# The month grid and projected occurrences

The calendar screen, and the one place in the app that draws an occurrence
which has no database row.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

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
  vacation-paused, blocked, behind a time segment. The grid answers "what date is this on", the
  same call `pinnedTasks()` makes; `isTaskVisible` is Today's question. `windowStart`/`windowEnd`
  are correspondingly *not* a fourth signal: they're clock times within a day, with no cell to
  land in.
- **The reset time deliberately doesn't reach the bucketing.** `getTaskDayStart` only moves the
  clock time inside the date it was handed and never rolls it to another day, so
  `dayKeyOf(getTaskDayStart(d, r))` is `dayKeyOf(d)` for every `r`. Threading `dayResetTime`
  through the buckets would read like it did something. Projection takes it because
  `getNextDueDate` does.
- **Three dot states, not two.** `solid` (real work outstanding), `done` (rows here, all ticked),
  `projected` (hollow). Collapsing `done` into `projected` makes a finished Tuesday read as a
  guess; collapsing it into `solid` makes a month you've cleared look untouched.
- **Its own route, not a fifth Today lens** — see the Navigation note in `CLAUDE.md`. And paging months carries
  the selection with it: a detail pane naming a day outside the grid renders "Nothing on this day"
  about a day that simply isn't in range.
