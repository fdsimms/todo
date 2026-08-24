# Supplies: counting down a stock of something, and asking for more in time

"I have six filters, and every time I do this task one of them is gone."

Read this before touching `src/utils/supply.ts`, the supply half of
`completeTask`, or the `supplyReorder` generator. Moved out of `CLAUDE.md` so it
is read when it applies rather than on every task. The rules here are settled
decisions with the reasoning attached: don't re-derive them from the code, and
don't re-open one without a reason the note doesn't already cover.

---

## Why this isn't the kitchen's job

Two existing models look like they already cover this and neither does.

**Recurrence** knows *when* a task happens and nothing about what it spends.
`recurrenceCount` counts occurrences, but it counts them for the schedule, and
its ending is the schedule stopping.

**The kitchen** knows what you probably have, but derives it from how long ago
you bought the thing — `probablyHaveReason`, `onHandUntil`, the shelf-life
lexicon. That is a decay *guess*, and a food-shaped one: it has nothing to say
about a CPAP filter, a contact lens, a printer cartridge or the dog's flea
treatment, none of which rot on a shelf and none of which come from an aisle.

**Here the app is the meter.** A completion *is* a unit spent, and the app is
what records completions, so the count is exact rather than inferred. Nothing
else in the app gets to know an inventory rather than guess at one, and that
asymmetry is the whole reason this is its own feature rather than a wing of the
pantry. See `docs/arch/groceries.md` for the half that genuinely is a guess.

## The two triggers, and why there are two

Running out is not the moment to find out. The real question is always "will
what I have left outlast the time it takes to get more", and there are two ways
to answer it.

| Trigger | Field | When it's the only one available |
|---|---|---|
| A count | `supplyReorderAt` | Any task `canProject` refuses: `recurrenceFromCompletion`, a live chain, no due date |
| A lead time | `supplyLeadDays` | Never alone; it needs a projectable schedule |

A count is crude: two left is two months of runway on a monthly filter change
and two days on a daily pill, and only one of those leaves time for a delivery.
But it is the only trigger a task with no projectable grid can have, so it can't
be the optional one. A lead time is the answer the count is a proxy for: with a
schedule to walk, `supplyRunOutDate` finds the day the last unit gets spent and
`supplyOrderByDate` works backwards from it.

**Both are live at once and whichever fires first wins.** That direction is
deliberate: filling in the lead time can only ever make the app speak up
*earlier* than the count alone would have. A user who gives the app better
information and finds it went quieter has been punished for it.

## The run-out date rides the one projection walk

`supplyRunOutDate` is `nthOccurrence(task, supplyCount - 1)` — the current
occupant of `dueDate` spends one, so a count of 1 runs out today and a count of
N on the (N-1)th occurrence after.

`nthOccurrence` lives in `calendarMonth.ts` beside `projectOccurrences` and
**shares its walk** (`stepOccurrence`), rather than being a second copy. That is
the rule CLAUDE.md states and the reason it exists: `snoozeEngine` used to keep a
private projection with none of `canProject`'s refusals and folded one day into a
set thirty times. Two things a re-implementation always gets wrong are already
right here — the `recurrenceCount` decrement on the cursor (without it a
three-time task projects for ever), and inheriting `canProject` wholesale so a
from-completion task returns null instead of a grid the app made up.

**Null from the walk means "no date-based answer", never "not urgent".**
`supplyReorderReason` settles the count threshold first precisely so that
distinction can't be got wrong: a supply at zero on an unprojectable schedule
still fires, on the count.

## What it does when it fires — two answers, one trigger

Decided by whether the supply names a grocery catalog row
(`Task.supplyGroceryItemId`):

- **Unlinked** (the ordinary case): a generated `'supplyReorder'` task, carrying
  the source task's own `linkUrl`, because a consumable bought online is a task
  whose entire content is that link. Its `deadline` is the run-out day, so every
  deadline surface in the app reads it for free.
- **Linked**: the item goes on the **shopping list** (`runningLowAt`) and **no
  task is written at all**. A row on Today saying "buy X" beside a line on the
  shopping list saying "buy X" is one errand and two things nagging about it.
  Buying belongs on the list, so the list gets it.

`wantedSupplyReorders` excludes linked supplies itself rather than leaving it to
the caller, and `suppliesWantingList` is its peer. Keep them a pair: a supply
answered twice is the failure this split exists to prevent.

## Restocking is the hard half

Counting down is easy. Every consumable tracker dies on the way back up — the
user buys more, never says so, the count is wrong for ever, and the feature
becomes noise. Three things keep that from happening, and none of them is a
screen anybody has to visit.

- **The reorder task asks on completion.** `deliverableKind: 'number'`, seeded
  from `supplyRefillCount` (`supplyReorderPackSeed`), so topping up is the tap
  you were making anyway. This is the **second reader of a deliverable's
  answer** — see the terms it was added on in `src/utils/deliverables.ts`, which
  are what stop that field becoming a scripting mechanism.
- **A linked supply tops itself up when the item is bought.**
  `restockLinkedSupplies` in `finishShopping`, which is the *only* event that can
  put units back on a linked supply — it has no reorder task to answer.
- **Completing the order without an answer is not a no-op.** It stamps the
  decline. Left alone the supply would still be under threshold, the next sweep
  would write an identical row, and the tick would have achieved nothing: the
  unrefusable-offer trap `projectsReviewedToday` closes one surface over. A tick
  means "I've dealt with this" and nothing more, exactly the reading
  `pantryCheckTasks` gives one.

**`supplyRefillCount ?? reorderAt + 1` is the linked path's one subtlety.** When
the user has said what a pack holds, the credit is exact. When they haven't, the
app credits the least it can that still clears the threshold — enough that the
buy-it/still-low/buy-it loop can't happen, and never a number it invented about
a pack it has never seen.

## The decline stamp, and the one thing it must not do

`supplyDeclinedAtCount` records the count an offer was turned down at, and
silences the offer at that count or fewer. It is spent against the *supply*, not
against the day, for the reason `pantryCheckDeclinedAt` is spent against the
purchase: an order you have already placed should not be asked about again
tomorrow.

**It is cleared whenever the count rises, in `updateTask` and nowhere else.**
Without that, a stamp written at 1 would silence the offer at 1 again after the
next restock, and every restock after that: the suppression would outlive the
thing it was about. Three writes can raise a count (the reorder task's answer,
the editor, a linked purchase), which is exactly why the clear lives at the one
place all three pass through rather than being remembered at each.

It keys on the value **rising**, not on `'supplyCount' in updates`: the editor
writes the whole supply card on every save, so testing for the key would clear
the stamp on a save that only changed the lead time.

## Rules that are not obvious from the code

- **A supply requires a recurrence** (`canHoldSupply`). The count rides onto the
  successor `completeTask` spawns, exactly as `recurrenceCount` and the streak
  do, so a task that spawns none has nowhere to put the decrement — it would sit
  at its starting number for ever while the filters were actually being used.
  The editor only offers the card on a repeating task, and `NO_RECURRENCE`
  clears the supply when a task becomes a dated series, with the rule and for the
  reason `showStreak` is cleared there.
- **A miss spends nothing.** This is the one place the supply and
  `recurrenceCount` deliberately disagree: a missed occurrence burns a cycle of
  the schedule (that is what breaks a streak) but does not burn a filter, because
  nobody changed one. The unattended sweep is the single path that could empty a
  supply with nobody touching the app, and it is the single path that must not.
- **A mid-chain step spends nothing either**, same `advancesBySchedule` gate
  `recurrenceCount` uses. A five-step morning routine would otherwise empty the
  box before breakfast.
- **Undo is free and structural.** The completed row keeps the count it was
  worked at and the *successor* holds the decrement, so `uncompleteTask` deleting
  the successor gives the unit back with it. Nothing adds it back by hand, so
  nothing can get that arithmetic wrong.
- **The count is read off the row on a task row; the date is only in the
  editor.** A second date on a line that already carries the scheduled one is two
  dates competing to be the row's answer to "when".
- **A dangling `supplyGroceryItemId` is resolve-or-shrug**, like every other
  cross-row pointer in this app (`blockedById`, `previousOccurrenceId`).
  `suppliesWantingList` checks the item is still live and otherwise says nothing;
  deleting a catalog row rewrites no tasks.

## The recurrence's own ending

`recurrenceCount` has always been a countdown, and until this its ending was the
one event in the app with no telling at all: `getNextDueDate` returns null, no
successor is written, and a task set to happen ten times simply wasn't there on
the eleventh. Whether that was the schedule finishing or something going wrong
was unanswerable from outside.

Completing the last occurrence now says so in the undo bar
(`finishedRecurrence` in `completeTask`). The undo bar rather than an alert
because it is already on screen for that exact completion, it is where the app's
other "here is what that tap did" lines go, and it costs nothing to ignore.
