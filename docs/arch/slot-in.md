# Slot-in: a task that waits for a lighter day

"If the day is full, wait." A task (or every task in a category) whose date is a target rather
than a promise. On a busy day it is held to the next one, and it lands on a day that has room.

Read this before touching `src/utils/slotIn.ts`, `applySlotIns` in `useTaskStore`,
`useSlotInSync`, or the three `slot*` fields on `Task`. Where this note and the code disagree, the
code is what ships, so fix the note.

---

## What it is for

It is the deload sheet's decision made ahead of time, one task at a time, with nothing to review.
A person who is overwhelmed already does this by hand: push the thing they have no energy for to
tomorrow, again and again. The feature makes those pushes so they don't have to, and makes sure
the pushed things still come back.

## The hold is `deferUntil`

The same mechanism as weather waits (`docs/arch/generated-tasks.md`): hiding a task until a
day is what a defer already is, so visibility, Later, the month grid and Look ahead need nothing
new. `slotDecidedOn` is the logical day the pass last decided the task, and a hold is a defer to
**the day after it**. Any other future defer is the person's own and is left alone. One field,
rather than "the day it is held until", because a task held until today and a task let through
today would otherwise carry the same mark, and the pass could not tell which one it had decided.

## Each day is decided once

`useSlotInSync` runs the pass once the task, category and calendar stores have loaded, and again
when the logical day rolls over. The pass records the day in a device-local setting
(`slotInDecidedDay`) and refuses a second run that day, and `slotDecidedOn` (synced) stops a second
device deciding the same task again. **Nothing moves mid-day**: a task let through stays on Today
however the day's load changes, and turning the setting on at noon takes effect tomorrow morning.
Moving rows while someone is looking at the list is the opposite of what this is for.

It is deliberately **not** in `catchUpPasses`. The overnight background run can't read the
calendar, and a day decided without it would let everything through on the day with the
all-day conference.

## How a day is decided (`planSlotIns`)

1. **Must land**: a deadline today or earlier (holding would miss it), pinned, urgent, a running
   timer.
2. **The floor**: the longest-waiting task always lands, even on a full day. Must-land tasks
   don't count toward it, or a task pinned every day would starve the queue.
3. **The cap**: a task that has waited `SLOT_IN_MAX_WAIT_DAYS` (3) lands whatever the day holds.
   The floor alone is not enough. `BUSY_DAY_MINUTES` is a fixed line, and for someone with a lot of
   routine every day is over it, so the queue drained one a day while weekly chores arrived faster
   and waits grew past a week. These count toward the light-day limit below.
4. **A light day takes more**: up to `SLOT_IN_LIGHT_DAY_MAX` in all, each only while it keeps the
   day under `BUSY_DAY_MINUTES`. Each landing counts toward the next one's judgment, or one light
   day would collect the whole queue and stop being light.

**A task let through stays let through.** One that landed on an earlier day and isn't done yet is
not a candidate again (`landedEarlier`): it stays on Today. Decided afresh each morning, it was
always the longest wait, so it took the floor for itself and nothing behind it moved until it was
done. Moving it to a later day by hand makes that day a fresh question.

**A generated task written after the day's pass waits its turn** (`holdLateSlotIns`, called from
`checkReachOutTasks`). The reach-out generator writes the next catch-up as soon as one is done, so
without this a new one landed straight on Today while older ones waited. While anything is waiting
it is held to tomorrow (`planLateArrivals`). Only generated rows: a task the person adds or
re-dates mid-day is one they are looking at.

"Longest wait" is `slotWaitingSinceKey`: the earliest of the pass's own stamp, the start of the
person's own run of pushes (`driftingSince`), and the date. A push by hand counts as waiting.

The load is the busy cue's own reading (`buildDayLoads`, `weightFor`), with the candidates left
out of it, so slot-in agrees with the cue the month grid and the date picker show.

## What can't wait (`canSlotIn`)

A task with no date (no day to be full), a daily repeat or daily target (tomorrow has its own, so
waiting is a skipped day), every-N-hours, a weather wait (which owns `deferUntil`), an
avoid-habit, a reminder at a set moment (it would fire on a day the task is no longer on), and
generated tasks other than catching up with someone: the rest are about a specific day, and a
use-up task's deadline is the day the food spoils.

## Where the answer comes from

The task's own `slotIn` (`true`/`false`), else its category's `slotIn`, read whenever the pass runs
so turning a category on covers the tasks already in it. A project or a kind of generated task can
seed `slotIn` onto new tasks through `TaskFieldDefaults`, which is creation-time like every other
default there. Unlike the three toggles in that type, `false` is written onto the task as an answer
rather than stamped as dismissed, because it has to outrank a category set to wait.

## The app's holds are not the person's pushes

Every write goes through `updateTask` with `SKIP_POSTPONE`. Without it each hold would climb
`postponeCount` toward "You've pushed this 3 times", a prompt about pushes the person never made.

Turning the setting off releases the task at the next pass (`slotReleasePatch`). The editor and the
MCP server also lift a live hold straight away when the answer becomes "Keep the date", since
otherwise the task would stay hidden until tomorrow for no reason anyone could see.

## Where a held task shows

On Later it sorts under "Waiting for a lighter day" with a "Waiting since" chip. On Today it is a
footer reveal beside "later today" and "expired" (`SlotWaitingSection`, fed by `slotWaitingTasks`),
collapsed by default. It is deliberately **not a block at the top of Today**: the feature exists so a
person doesn't have to look at these tasks, and the rows are the ordinary actionable ones (no drag,
since a held task has no slot in the category order).

The hold fields (`deferUntil`, `slotDecidedOn`) stay on a task after it is archived, vacation-paused,
blocked or put in a paused project, so `isSlotWaiting` alone says only that the pass held it. The store
selector therefore also requires `isTaskDeferred`, the gate Later uses, and a new reader of the held
set does the same, or the reveal lists rows that are hidden everywhere else.

## From quick add, a template, and Backfill

- **Quick add**: `~` before a date ("call the dentist ~thu") sets the date and `slotIn: true`
  (`ParsedSchedule.slotIn`, peeled in `parseSuffix`). It shares the sigil with the time estimate,
  which needs a number and a unit ("~30m"), so the two can't read the same text. Only a plain date
  takes the mark: a repeat, deadline, set of dates, window or clock time names an exact moment, and
  a time also brings a reminder, which `canSlotIn` refuses. The word "around" is deliberately not
  read: "walk around tomorrow" is a walk, not a flexible date.
- **Templates**: `TemplateItem.slotIn` seeds the task's answer; null leaves it to the category.
- **Backfill** asks about the tasks on the fullest days first (`dayLoadOf`), since those are the
  answers that change this week.
