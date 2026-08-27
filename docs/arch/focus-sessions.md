# Focus sessions

Working a queue of tasks one at a time, against their own estimates, with
breaks between them.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## The shape of it

A session is a **plan** (an ordered run of `FocusStep`s, each either work on
one task or a break) plus a **cursor** into it and a **clock** on the step the
cursor is sitting on. That's the whole model, and the three parts have
deliberately different lifetimes:

| | Where it lives | When it changes |
|---|---|---|
| The plan | `FocusSession.steps`, stored | Built once at start; only ever shrinks, when a task leaves it |
| The cursor | `FocusSession.stepIndex`, stored | Only when the user advances |
| Position in the step | Derived from `stepStartedAt` + `stepElapsedSeconds` | Continuously, off the wall clock |

`src/utils/focusPlan.ts` is all of the arithmetic and is pure;
`src/store/useFocusStore.ts` is the row and the writes; `src/utils/focusSuggest.ts`
decides what to put in front of you in the first place.

## Running out is not moving on

**A step that reaches zero does not advance.** The chime fires (a local
notification, `scheduleFocusStepAlarm`), the countdown starts counting *up* as
an over-run, and the session sits exactly where it is until the user taps.

This is the one place the feature parts company with a classic pomodoro timer,
and it isn't a shortcut. JS timers don't run while the app is backgrounded, so
"advance on its own" can only ever mean "reconstruct, on next open, what would
have happened if the phone had been in front of you". Open the app an hour
later and it would tell you you're 40 minutes into the third stretch and had a
break you never took. Every number on the screen would be fiction.

The same reasoning `src/utils/timer.ts` gives for deriving `isTimerReady`
instead of storing it, and `src/utils/timerSegments.ts` gives for never ticking
a subtask: a phone that was off for an hour comes back with the right answer
for free. Here the right answer is "you left in the middle of this, and it has
been waiting".

The corollary is that `stepIndex` is the one piece of session state that is
*not* clock-derived. Don't make it derived.

## The plan is stored, not re-derived

`buildFocusPlan` runs once, when the setup sheet is confirmed. Re-running it on
read would be cheaper to write and would be wrong twice over: editing a task's
estimate mid-session would resize a stretch already under way, and changing a
setting in Settings would move the finish line of a session someone already
agreed to. A plan is a commitment to a shape of the next hour.

It only ever shrinks. `pruneFocusPlan` drops the stretches of a task that can
no longer be worked; nothing adds a step, and nothing reorders one.

## Breaks: two triggers, whichever fires first

`focusRestAfterMinutes` and `focusRestAfterTasks` both run, and the first to
fire inserts the break. Either can be off (`null`); with both off the plan is a
straight run of work, which is a legitimate thing to ask for and not a broken
plan. Every Nth break is a long one (`focusLongRestEvery`).

Two rules that are easy to get backwards:

- **The task counter ticks on a task's last stretch, not on every stretch.** A
  90-minute task split into four is one task finished. Without this, "break
  every 2 tasks" would put breaks *inside* a single long task, which is the
  minute trigger's job.
- **A long task is split into equal parts, not into cap-sized parts plus a
  remainder.** 60 minutes at a 25-minute cap is 20 + 20 + 20, not 25 + 25 + 10.
  The stub the greedy version leaves is always the last thing you do on that
  task, where the momentum two stretches bought is worth the most, and a
  ten-minute coda reads as an afterthought rather than as a third of the work.

The shipped defaults are a classic pomodoro (25 / 5 / 15 every fourth) with the
task-count trigger **off** — on at 1 it turns a queue of three short tasks into
three breaks in twenty minutes.

The setup sheet's own Breaks toggle (`FocusSetupSheet`) lets a session run
without breaks even when Settings has them configured, for the one-off "not
this time" case — going to Settings to turn both triggers off and back on
again would be a strange way to skip breaks for a single session. It's a
session-only override, one direction only: it can silence Settings' triggers
for the run about to start, never add breaks Settings doesn't already have,
and it's left off the sheet entirely once Settings already has none
configured, since there'd be nothing left for it to do. The plan preview and
`onStart` both build from the same effective options, so the summary the user
agreed to and the plan the session actually runs never disagree.

## The time window

The setup sheet's "Time available" is a hard constraint on what gets
suggested, not a weight: say you have forty minutes and only a queue that fits
in forty minutes is offered. A suggestion that overruns the time you said you
had is not a worse suggestion, it is the wrong answer to the question asked.
Off (`null`) by default, and then the soft `FOCUS_BUDGET_MINUTES` penalty
shapes the queue's length as it did before.

Three things to keep right:

- **Fit is measured against the plan, never the estimates.** `planTotalMinutes`
  builds the real run and counts its breaks. An hour of estimates is an hour
  and ten minutes of wall clock under the shipped settings, so a queue chosen
  by summing estimates overruns by exactly the rest it was going to need. This
  is why `FocusContext` carries `planOptions` at all: the scorer would rather
  not know about breaks, but a window that ignored them would be a window that
  lies.
- **The pick is "best that fits", not "best, if it fits".** A 55-minute task
  that can't fit the 30 minutes left is filtered out of the round rather than
  winning it and then being rejected, which would end the queue early and leave
  the window half empty. It fills greedily by score rather than solving for the
  tightest packing: a queue chosen to waste the fewest minutes would put three
  small chores ahead of the one thing that actually matters.
- **The soft budget penalty switches off while a window is set.** Two opinions
  about length, one hard and one soft, would only reorder picks that all fit
  anyway, for no reason the user could see.

### "Until my next meeting"

`src/utils/focusWindow.ts` turns the next thing on the calendar into a window,
offered as a pill beside the stepper. It is a *source* for `windowMinutes` and
nothing more: everything downstream sees an ordinary number of minutes and
knows nothing about where it came from, which is why the calendar arrived after
the window and changed nothing about it.

- **Gated on `loaded`, not just on the setting.** Per that flag's own note in
  `useCalendarStore`, an empty event list and a calendar the app couldn't open
  look identical, and only one of them means the afternoon is free.
- **A horizon, because a meeting six hours out isn't what bounds the next
  hour.** Past `FOCUS_CALENDAR_HORIZON_MINUTES` the pill doesn't appear;
  under `FOCUS_WINDOW_MIN` it doesn't either, since there'd be nothing to
  suggest for it.
- **The gap is floored and carries no buffer.** Rounding up would put the last
  stretch inside the meeting. A buffer would be kinder but would make the
  pill's own label a lie: it says "Until 2:30", so the number behind it has to
  be the time until 2:30.

A pill rather than a segment, per the carve-out list in `SegmentedControl`'s
doc comment: it's a preset beside a free input, the set on screen isn't the set
of possible values, and a preset is a shortcut rather than a value.

The control is a `CountStepper` in 15-minute steps rather than preset chips,
per the rule in `CLAUDE.md`: the value is an open-ended number, and chips would
have to pick both a granularity and a ceiling for everyone. `allowNull` at the
floor is what "Any" is. Window figures are printed with `formatClockDuration`
(1h 20m) rather than `formatDuration` (1.3h): a window came off a clock, and
the decimal form asks the reader to do the arithmetic back to 2:30 themselves. Changing the window re-picks from scratch rather than
trimming what's on screen, because a different amount of time is a different
question and the best answer to it is rarely a prefix of the answer to the old
one. The window itself is *not* reset when the sheet reopens: how long you tend
to have is a fact about your day, not about this sheet.

## Starting from what's pinned

The pinned block's own header carries a shortcut into the same setup sheet,
seeded from `pinnedTasks()` instead of the scorer (`FocusSetupSheet`'s
`pinnedSeed` prop, `focusQueueFromPinned` in `focusSuggest.ts`). It reuses the
sheet rather than skipping it, on purpose: this is still "a commitment to a
shape of the next hour" (see above), and the window, the plan preview,
ticking and swapping all still have to happen somewhere — a second, bypass
path would either duplicate all of that or drop it.

What's different is only the initial pick. Pinning is already a hand-ranked
shortlist (`pinnedOrder`), so `focusQueueFromPinned` takes that order as-is
instead of re-scoring it — "next that fits" rather than "best that fits".
Eligibility and the time window are the same rules the scored path uses: a
pinned task that's completed, archived, a subtask, blocked, or that no longer
fits what's left of the window drops out of the queue exactly as it would
there. With no window set (the sheet's default), that means every eligible
pinned task starts ticked — the literal request this shortcut exists to
answer.

## On the Lock Screen

`src/utils/focusLiveActivity.ts` puts the step you're on into a Live Activity,
the third of three (`liveActivity.ts` for a running timer, `tripLiveActivity.ts`
for a shopping trip) and shaped like the trip one: there's only ever one
session, so the native side reconciles against zero-or-one activities rather
than a keyed set. It renders in `targets/todo-widget/FocusLiveActivity.swift`,
behind the `focusLiveActivity` setting, iOS 17+.

This used to be listed below as deliberately absent, on the grounds that it was
native work in the widget target rather than anything this feature could reach
from JS. That stopped being true once the timer and trip activities shipped the
whole path — an attributes struct compiled into both the app and the extension,
a reconcile function on the bridge, and a `dundundun://` link back. What's left
here is the same three files those two need.

- **The payload is a pure function of the stored session, never of the clock.**
  A step ends at `stepStartedAt + (its minutes - what's already banked)`, which
  is fixed the moment the step's clock starts, so SwiftUI ticks the countdown
  itself and nothing is ever pushed. That matters more here than it does for a
  timer run: the activity is drawn with the task's title, so it re-syncs on
  every task write, and a payload that read `Date.now()` would differ every
  time — tearing the activity down and starting a new one on each keystroke in
  the list behind it.
- **`staleDate` is how "running out is not moving on" survives the trip to the
  Lock Screen.** The bridge hands ActivityKit the step's own end as the stale
  date, so `context.isStale` flips exactly when the step runs out, with nothing
  pushed to it. Before: a countdown, and a button that pauses. After: the same
  figure counting *up* as an over-run, in orange, and a button that moves to
  the next step. The step still doesn't advance on its own. Without this the
  activity could only sit at 0:00, which is the one thing the feature is not.
- **A paused session stays on the Lock Screen** showing a frozen figure
  (`pausedRemaining`, formatted JS-side, since there's nothing to tick) and a
  Resume button. The timer activity ends instead when its timer pauses, and
  that's the right answer there: a paused timer isn't running. A session is a
  longer-lived thing than a stretch of it, and one that vanished on a pause
  would read as one that had ended.
- **`key` is the whole payload, JSON-encoded.** The native side keeps the
  activity while the key matches and restarts it when it doesn't, so the key
  has to cover every field that's drawn — a hand-listed subset is the kind that
  stops covering the field added next to it. It is never parsed, only compared.
- **Every button is a link, not an AppIntent** (`dundundun://focus?do=next|pause|resume`,
  handled in `deepLinks.ts`), because a Live Activity button's intent runs in
  the background only and can't bring the app forward — the constraint
  `TimerLiveActivity.swift`'s header argues at length. The action is applied
  *and* the session sheet opens: the store can answer "pause" or "next" on its
  own, and the sheet arriving on top is how you see that it did.

## One mechanism for a task leaving the plan

A task can stop being workable three ways: completed from inside the session,
completed from the Today list sitting right behind it, or deleted. All three go
through `syncWithTasks(tasks)`, which prunes the plan and records the
completions. There is deliberately no `completeCurrentTask` action on the store
— the session sheet completes through `useTaskStore` like any other row, so
recurrence, chains, streaks and the Logbook all behave identically, and the
session notices on the next sync.

Two details in `pruneFocusPlan`:

- **Steps behind the cursor are never touched.** They're the record of what the
  session has done; rewriting them would make "step 4 of 9" mean something
  different every time you looked at it.
- **The step clock only resets when the current step is genuinely a different
  one.** Pruning a task three stretches ahead must not restart the stretch
  you're sitting in.

Only *completion* is added to `completedTaskIds`. A deleted task was not an
achievement, and skipping one (`skipTask`) says so too.

## A daily target is logged, not ticked

The session's tick action goes through `logQuotaUnit` for a quota task, exactly
as the meter on its row does, and the button says "Log one" rather than "Done".
It ran through `completeTask` at first, which fills `progressCount` to the
target: one tap in a session finished all eight glasses, while the same task's
row on Today only ever added one. Two surfaces disagreeing about what a tick
means is worse than either answer.

The last unit still completes the task, because `logQuotaUnit` hands off to
`completeTask` when it meets the target — so recurrence, streaks and the
Logbook are unchanged, and the session notices through `syncWithTasks` like any
other completion.

**An on-pace quota task can be marked Done for now instead of Skipped.**
`useFocusStore.finishForNow` replaces Skip in the secondary row exactly while
`isQuotaOnPace(quotaTask)` holds. Mechanically it's `skipTask`'s own
`pruneFocusPlan` — the task's remaining stretches leave the plan, no unit is
logged, the task itself is untouched — with one addition: the id is stamped
onto `completedTaskIds` anyway. That's a deliberate exception to "only
completion is added to `completedTaskIds`" above: being on pace already means
today's obligation is met for now, so ending the session should read as a task
handled, not one abandoned.

The count is spelled out on the stage above the clock, with
`quotaUnitsToPace` (`visibilityUtils.ts`) and `formatQuotaCatchUp`
(`quotaUnit.ts`) between them saying how many logs put it back on pace and how
many finish the day. That sentence exists because a session is the one place a
target is worked with no row in front of you: on Today the answer is implicit
in the row being there, and going quiet when it isn't. **Both numbers, not
one** — they only coincide as the day's span closes, and "how many before this
goes quiet" is the question someone mid-session is actually asking.

## Correcting an estimate from what it actually took

A session's Done tap can offer to update the task's estimate to the clock
reading for the step just finished (`focusMeasuredMinutes` in
`focusPlan.ts`, wired in `FocusSessionSheet.handleDone`). It reuses
`applyMeasuredTime`/`useTaskStore.setMeasuredTime` — the same mechanism the
standalone stopwatch writes through — so the corrected number gets the same
"Timed" label on the row and in the Logbook, and the same in-place correction
affordance, regardless of which one measured it.

Three gates, and each exists because the naive version is wrong in a specific
way:

- **Offered only from this Done tap, never from `syncWithTasks`.** A task
  ticked off from the Today list while the session runs behind it is caught
  there, but the session's clock reading has no relationship to when that
  work actually happened — the task could have been finished long before the
  step's clock says, or well after. Only the in-the-moment tap is a stand-in
  for a stopwatch; the background sync path never offers this.
- **Only a task worked in a single stretch (`step.partCount === 1`).** The
  session doesn't keep what a split task's earlier stretches cost — see "The
  plan is stored, not re-derived" above and the "not a timesheet" note in
  `focusPlan.ts` — so a step that's part 2 of 3 can only speak for a third of
  the task. `focusMeasuredMinutes` returns null rather than a number that
  quietly undercounts.
- **Skipped entirely mid-chain when the active step carries its own
  estimate** (`measuredTimeAppliesTo` in `effort.ts`). `estimatedMinutesFor`
  reads a chain step's own estimate ahead of the task-level fields
  `applyMeasuredTime` writes, so applying it there would change nothing a
  reader ever sees — a silent no-op is worse than not offering at all.

- **A real miss, not any miss** (`measuredTimeDiffersEnough` in `effort.ts`).
  Unlike `applyMeasuredTime` itself — which has no threshold, because a
  deliberate stopwatch run is already a decision to measure — this reading is
  a byproduct of running the plan, so it needs to actually disagree before
  it's worth a tap: the greater of 5 minutes or 25% of the existing estimate.
  A 5-minute task running 6 is normal slop, not a correction; a 4-hour
  estimate running 20 minutes over is the same story at a different scale.
  A task with no estimate at all skips the threshold — there's nothing to
  weigh the reading against — and is offered worded as "Save" rather than
  "Update".

## Why the store takes tasks as arguments

`useTaskStore.initialize` fans out to `useFocusStore.initialize`, so an import
the other way would close the cycle. Every focus action that needs the task
list is handed it. The side benefit is that the whole store tests with plain
objects and no store standing behind it.

## What is deliberately not here

- **No session history.** The row is deleted when the session ends. Stats on
  focus time is a real feature and a separate one; a `focus_sessions` table
  accumulating finished rows would need its own retention rule (see
  `src/utils/retention.ts` for why that isn't free).
- **Not in the backup, and not synced.** It describes what one device is doing
  right now, against task ids a restore is about to replace wholesale. Two
  phones sharing one session's cursor is not a state this feature has, and
  syncing the row would invent it. Both exclusions are argued in
  `BACKUP_EXCLUDED_TABLES` and `SYNC_EXCLUDED_TABLES`.
- **No reordering on the setup sheet.** The suggester's order is "best first,
  and each one partly chosen for going with the ones above it", which is a
  defensible run order. Dragging inside that sheet is the `SortableList`
  scroll-container dance (see the drag notes in `CLAUDE.md`) for a v1 that
  doesn't need it.
