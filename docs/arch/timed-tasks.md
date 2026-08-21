# Timed tasks and their subtask stretches

The countdown, and splitting one run across a task's subtasks.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## Timed tasks, and apportioning one across its subtasks

A timed task counts down against `timedMinutes`; how much is left and whether it's ready to
complete are derived from three stored fields against the clock, never written (`src/utils/timer.ts`
says why). Splitting that countdown up — "violin practice" as 5 min scales, 10 min known pieces,
10 min new piece — is **`timedMinutes` on the subtasks**, laid end to end in subtask order
(`src/utils/timerSegments.ts`).

- **The same field, because it's the same kind of number.** A subtask's value is its stretch of the
  parent's run. What a subtask never gets is a *timer* — `TaskItem` gates all of it on
  `parentId === null`, which matters because a subtask does surface as a row of its own in Search,
  and a second start button for one session is two timers on one task.
- **The stretches are read off the clock and nothing is ticked.** No stored "current segment", no
  auto-completing a subtask when its minutes run out. A subtask's tick box and the timer's position
  answer different questions — one is what you decided you're done with, the other is where the
  clock is — and letting either drive the other makes both wrong. Same call `isTimerReady` makes,
  and it survives backgrounding for the same reason.
- **The parent's `timedMinutes` is the sum, and it's stored.** The one deliberate exception to the
  deriving above, and it's what keeps this feature to one module: the countdown, the scheduled
  alarm, the Live Activity and the widget all keep reading the one field they always read, so
  nothing downstream had to learn about segments. The cost is a total to keep in step, so there are
  exactly two writers — `TaskEditor` (`retotalDuration`, on every stretch edit and on a delete) and
  `deleteSubtask` in the store, which has to because a subtask can be deleted from the task row too.
- **Losing the last stretch leaves the duration where it was.** Nulling it would quietly demote a
  25-minute task to an untimed one; the split going away just makes it a flat countdown of the
  length it already had. For the same reason nothing re-totals a parent that isn't timed, so a
  stretch stranded by a kind switch can't promote a plain task.
- **Completed subtasks keep their stretch.** The run's length can't depend on what's been ticked, or
  the countdown would shorten under the user mid-session.
- **The minutes are typed on the subtask rows, not in Duration.** The timer runs through them in
  subtask order, and the rows are where that order is dragged. Duration shows the split read-only
  and totals it — two controls setting one number is the confusion, not the fix. `StepMinutes` is
  the shared field, the same one a chain step's estimate uses.
