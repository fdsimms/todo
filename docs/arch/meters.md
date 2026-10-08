# Meters: a task due at a reading rather than a date

"Change the oil every 5,000 miles." "Descale after 200 shots." "Service the mower every 50 hours."

Read this before touching `src/utils/meters.ts`, `applyMeterHolds` in `useTaskStore`, the
`meter_readings` table, or the meter half of `buildCompletion`. The rules here are strong defaults
with the reasoning attached; where this note and the code disagree, the code is what ships, so fix
the note.

---

## Why it isn't a recurrence

A recurrence knows *when*, and nothing else; this knows *how far*. Bolting a reading onto
`RecurrenceType` would put a number nobody can compute from the calendar into every reader of
`dueDate` (the month grid, Look ahead, `projectOccurrences`, the snooze engine), and none of them
can say when 5,000 miles is. So a meter task is a **plain one-off** (`canFollowMeter`), and
completing one writes the next the way a recurrence does, with a reading where the date would be.
That one-off rule also keeps it apart from `weatherWait`, which owns `deferUntil` the same way.

## The readings belong to the meter

`MeterReading` rows are keyed by `meterKey(name)`, not by a task, because one odometer serves the
oil change, the tire rotation and the inspection. A task names its meter (`Task.meterName`), and
logging one reading moves every task on it. There is no meter table: a meter is the name its
readings and tasks share, the way a tag is a string.

**Rows are only ever inserted or deleted, never edited.** That is what lets the table sync with
nothing but `{ name: 'meter_readings', key: ['id'] }`: two devices logging at once each keep their
row, and there is no last-writer-wins on a value to lose. A typo is fixed by removing the reading
and logging it again (`MeterReadingSheet` lists the last few with a remove button for this).

## The hold is `deferUntil`, and three things end it

Copied from `weatherWait` deliberately: hiding a task until a day is what a defer already is, so
the visibility rules know nothing about meters, and Today, Later, the month grid and Look ahead
place a held meter task with no new code. `decideMeterHold` picks the day; `meterHoldPatch` turns
that into a write; `applyMeterHolds` runs it from the catch-up passes and `useMeterHoldSync`.

The earliest of these wins:

1. **A logged reading at or past `meterDueAt`.** The only one that is a fact.
2. **The day the reading rate projects.** An estimate, and the row says so ("est. Dec 10").
3. **`meterLimitMonths` after the task was made.** "5,000 miles or 6 months, whichever comes
   first", which is how a service interval is actually written.

With none of them (one reading or none, and no limit), the task surfaces `METER_CHECK_IN_DAYS`
after the last reading so the meter gets read.

**Surfacing on the estimate is the feature, not a guess dressed up as one.** Every usage tracker
dies the same way: nobody logs the reading, and the thing that was meant to come up never does
(`supplies.md` says the same about restocking). Coming up on the estimate is the prompt to go and
look, and the loop closes by itself: log a reading below the threshold and the next pass re-holds
the task on a fresh estimate.

**The rate needs a week.** `meterRatePerDay` measures from the latest reading back to the earliest
one at least `METER_RATE_MIN_DAYS` older, inside a year. Two readings a day apart say almost
nothing about monthly mileage, and a meter that went down (a replaced odometer, a typo) has no
rate rather than a negative one.

## The pass only moves its own hold

`meterHeldUntil` is the day the pass last wrote into `deferUntil`. A future defer that doesn't
match is the user's own snooze and is left alone: a surfaced oil change pushed to Saturday must not
bounce back to Today on the next pass, which is what clearing on every release would do. A defer
that has already passed is nobody's any more and is taken over.

A release writes **today** into `deferUntil` rather than clearing it. A meter task has no due date
of its own, and one with no date signal at all is an Unscheduled task (`hasNoDateSignal`), not a
Today one.

Taking the meter off a task (the editor's clear, or `meter: null` over MCP) clears the pass's hold
with it, or the task would stay hidden until a day nothing is tracking any more.

## The next one counts on from the right reading

`nextMeterDueAt`: from a reading logged on the day it was completed, when there is one (that is
the odometer at the oil change); otherwise from where this one was due, or the latest reading if
the meter already ran past that. Never from an estimate. The successor is built in
`buildCompletion`, so the MCP server's completions get it too, and it's held until tomorrow and
marked as the pass's own, so it never flashes through Unscheduled before the pass looks.

## Not on templates

A template item can't carry a meter (`templateItemParity.test.ts` says so): "due at 45,000" is
where one car stood at one moment, and a run can't know where the odometer is now.
