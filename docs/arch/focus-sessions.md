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
- **No Live Activity.** The task timer has one (`src/utils/liveActivity.ts`)
  and a focus step is the same shape of run, but it's native work in the widget
  target rather than anything this feature can reach from JS.
- **No reordering on the setup sheet.** The suggester's order is "best first,
  and each one partly chosen for going with the ones above it", which is a
  defensible run order. Dragging inside that sheet is the `SortableList`
  scroll-container dance (see the drag notes in `CLAUDE.md`) for a v1 that
  doesn't need it.
