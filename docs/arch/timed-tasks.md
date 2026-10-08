# Timed tasks and their subtask stretches

The countdown, and splitting one run across a task's subtasks.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are strong defaults with the reasoning
attached: read the reason before deviating from one. Where this note and the
code disagree, the code is what ships, so fix the note.

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
- **A daily or weekly target can carry a countdown per unit, in the same field.** On a target,
  `timedMinutes` is the length of one unit's countdown, not a whole-task duration, and the task
  still reads as a target (`taskKindOf`'s precedence), so there is no fifth kind. `bakedFields`'
  target arm sets it from `unitMinutes` and every other kind clears it. The clock is spent
  rather than finished: `logQuotaUnit` resets it (and cancels its alarm) so the next unit starts
  full, the unit that completes the task resets instead of `stopTimer` (which would write one
  unit's minutes over the task as its measured time), and `rolloverQuotas` clears banked seconds
  on the successor. Logging never waits on the countdown, same as completing a timed task early.
  Subtask stretches don't apply: the editor and `deleteSubtask` only re-total a task that isn't a
  target, or a stretch left on a subtask would overwrite the per-unit length.
- **The minutes are typed on the subtask rows, not in Duration.** The timer runs through them in
  subtask order, and the rows are where that order is dragged. Duration shows the split read-only
  and totals it — two controls setting one number is the confusion, not the fix. `StepMinutes` is
  the shared field, the same one a chain step's estimate uses.
