# Away dates: a project that knows when you are gone

**Status: partly built.** In: the span itself (`src/utils/awayDates.ts`,
`Project.awayStart`/`awayEnd`), the editor rows, the project card's caption,
the look-ahead prefill, the away cue in both day grids (`DayLoad.away`),
scheduled vacation mode (`Project.awayPauses`, `checkAwayVacation`), and the
trip moving (`src/utils/awayShift.ts`, `shiftAwayTasks`, `AwayShiftSheet`).
Still designed and not built: the template nomination, and the destination
with its forecast.

It is written down because the design outgrew a conversation, and because most
of the argument is about *fitting* — which existing rule each decision falls out
of — which is the part that gets re-derived wrongly if it is not recorded.

Read it before building any of it, and before adding a fifth half-implementation
of "the user is away from home" (see below for the four that already exist).

Everything here that says "must" is a constraint the codebase already imposes,
with the place it imposes it named. Everything under "Still open" is genuinely
undecided.

---

## The problem, and why it is not "add a trip feature"

Trip planning is a project shape that repeats. The app already serves it in four
places that share no facts with each other:

- **`src/utils/lookAhead.ts`** models `LookAheadWindow { start, cutoff, awayEnd }`.
  Its header talks about flights and trips outright, `buildPushPlan` pushes work
  past a return date, and `taskMoves.ts`'s own header describes it as the caller
  that "pushes a whole window past a trip".
- **Templates** are already a packing-list engine: `TemplateAnchors { start, end }`,
  per-item offsets counted from either anchor, and `templateQuestions.answerFromDates`
  with its `'nights' | 'days'` distinction, whose comment is about hotel nights
  versus shirts.
- **Groceries** has `isAwayList()`, whose whole meaning is "a list you are away
  from home for".
- **Vacation mode** has `vacationStart`/`vacationEnd`, `Task.vacationPause` and
  `Category.hideOnVacation`.

None of them can tell the others when the trip is. The cost is visible in the
code twice, both times as an apology:

- `LookAheadSheet` has to *ask* when you get back, because `vacationStart` is
  stamped `new Date()` at switch-on — it records when you went, never when you
  are going. Only `vacationEnd` can prefill anything.
- `useTemplateStore.applyTemplate` says of the run's start anchor: *"Its start
  anchor has nowhere to go now that a project carries one date rather than a
  range."*

"Nowhere to go" is the field. The design below is that field plus its readers.

---

## The shape

```ts
// on Project
awayStart: string | null;   // the day you leave
awayEnd: string | null;     // the day you are back
```

Columns `away_start` / `away_end`, appended to the migrations array in
`initDatabase` like any other. Sync needs no work: `syncTracking` tracks
`projects` whole-row on `id`, so new columns ride along.

**They are not a symmetric pair.** `awayEnd` is ignored unless `awayStart` is set
and the end is not before it — the same refusal shape `effectiveWindowEnd()` uses
for `windowStart`/`windowEnd`, and for the same reason: a half-set range that
still answers questions is how a gate ends up deciding something about a span
that was never entered.

A start with no end is legal and means something real. It is exactly
`LookAheadWindow`'s `awayEnd: null` case, which that module already describes as
knowing "a boundary but not a trip". The asymmetry is copied from there rather
than invented here.

**Store both at noon**, the way `getLogicalToday()` already returns noon as
"safe for display". A span entered at home and read after a nine-hour flight
must not move by a calendar day, and midday is the cheap way to guarantee that
without any timezone machinery.

Timezones are otherwise not a problem here, which is worth recording because it
looks like one. `reanchorReminderToWallClock` (#1205) already re-expresses a
`wallClock` reminder under the device's current zone so "9am" still means 9am
after a flight, deliberately without any IANA timezone dependency. Nothing in
this design needs to add to that.

### Why it is called "away"

`trip` is taken, thoroughly and at every layer: `activeTrip.ts`,
`shoppingTrip.ts`, `tripLiveActivity.ts`, the `tripReminderEnabled` setting, the
`shoppingTrips` simplified-mode feature. All of them mean "I am standing in a
shop right now".

"Away" is already this codebase's word for the travel sense — `isAwayList`,
`LookAheadWindow.awayEnd`, `awayEntries`, `describeAwayEntry`, the "Away list"
overline on the grocery screen. Use it.

### What this deliberately is not

- **Not a `ProjectKind`.** That field's own note says it changes presentation and
  never behaviour, and that it should stay that small. Away dates change
  behaviour, so putting them behind a kind would be exactly what the note
  forbids. `weekendSource` already refused this move for itself and said so.
- **Not a `Trip` entity.** `ProjectKind`'s note is also the post-mortem for this:
  a "list of things with no date" was first built as its own entity, with two
  tables, a store, two screens, a drawer row and its own search source, on a
  premise that turned out to be false. A project is already the container.
- **Not a range on `Task`.** `TemplateContainer`'s doc already refused the
  `'task'` container dates for this reason: "there's no Task field to put a
  start/end range in, only single `dueDate`/`deferUntil`." That is still true and
  is not worth changing for this.

### The one discipline

**Never ship the span without at least two readers in the same change.**

`Project` used to carry a `targetStartDate`/`targetEndDate` pair. It was deleted
and collapsed into the single `deadline` because the start half had, across its
whole life, exactly one reader — the "From Jun 1" side of a label. Two fields
where one was decoration read as a schedule the project did not have.

The bar this design has to clear is that bar, not a prohibition on storing a
range. Departure is load-bearing in a way `targetStartDate` never was: it is
`lookAhead`'s `cutoff`, and the day you leave is not a day you have. But that is
only true once something reads it, so storage-first-readers-later is the one
sequencing that recreates the mistake.

---

## The readers

Ranked by cost. Each is independently shippable; the first two are the minimum
that clears the bar above.

1. **Look ahead prefills from it** *(built)*. The sheet stops asking for two dates it could
   know, and can name the trip. Deletes the apology comment.
2. **Away days carry a cue in `WhenPicker`** *(built, and in the month grid
   too)*. There is one choke point:
   `buildDayLoads`, consumed by the picker and by the look-ahead sheet's day
   strip. Once the cue exists, `deloadPlan` and `buildPushPlan` can rank those
   days last instead of treating them as ordinary. This is where the feature
   stops being decoration — and see the rule below, because it is a cue and
   never a refusal.
   - The `dayLoad` rule that "no cue is never *this day is free*" is not in
     tension with this. That rule is about absent information; away dates are
     information the user typed.
3. **Scheduled vacation mode** *(built)*. Its own section below.
4. **The trip moving** *(built)*. Its own section below.
5. **Templates write the span.** Its own section below.
6. **The away grocery list binds to the span**, so Groceries opens on that list
   while you are away instead of `activeListId` being a manual switch.

---

## The span never blocks anything

**A day inside the span is a day you can schedule work on, and no reader here may
refuse one.** This is the rule the rest of the design has to be checked against,
and an earlier draft of this file got it wrong — it said away days should draw as
"unavailable", which is a block wearing a cue's clothes.

People do things on holiday. Checking in for the return flight, confirming the
hotel, taking medication, a work call that could not be moved, the thing you
brought the laptop for. A span that refuses those is worse than no span, because
the user's answer is then to not enter their trip at all, and every other reader
here loses its input.

The vocabulary already exists. `projectPull`'s `StallMode` distinguishes a cadence
that *gates* in nudge mode from one that only *ranks* in ask mode. **The away span
ranks. It never gates.** Concretely:

- **`WhenPicker` cues, it does not dim.** The app has exactly one genuine
  refusal in that component, `allowPast={false}`, and it exists because a date
  that *places* something cannot be in the past. A trip day is a perfectly good
  day to put a task on, so it gets a cue in the same channel `buildDayLoads`
  already paints day weight in, and nothing else.
- **`deloadPlan` and `buildPushPlan` may rank an away day last, never exclude
  it.** Both already propose per-row with everything untickable, so a proposal
  that avoids the trip is a default the user can overrule, which is the whole
  point.
- **Vacation mode is already opt-in per row, and this design inherits that
  rather than replacing it.** `Task.vacationPause` and `Category.hideOnVacation`
  are nominations: arming vacation mode hides what the user has *already said*
  should hide, and leaves everything else exactly where it was. So "vacation
  mode turns itself on when you leave" is not "your tasks disappear". This is
  worth stating because it is the obvious misreading of the section below, and
  because it is also the answer to the objection: the app's existing mechanism
  for "I still need to do things while away" is that you nominate what pauses,
  and nothing here should invent a second, blunter one.

The one-line version, for anyone adding a reader later: **the span tells a
planner what you would rather not do, never what you may not do.**

---

### Display

`deadlineLabel` in `ProjectsScreen` fed one render site, and the away span goes
there through `projectCaption` beside it.

**The span wins the slot rather than sitting beside the deadline.** For a trip
the two say nearly the same thing and the span says it better: the date you have
to be ready by is your departure, not a target you set. A project holding both
still shows its deadline once the trip is over, because `describeAwaySpan` goes
quiet then. And `isProjectPastWindow` belongs to the deadline alone, so an away
caption never wears the Overdue prefix — a trip in three days is not late for
anything.

Copy stays literal, per the user-facing copy rules in `CLAUDE.md`: "Leaves in 6
days", "Away Nov 3 to Nov 10", "Back Tuesday". Not "6 sleeps".

---

## Scheduled vacation mode

*Built.* `Project.awayPauses` is the nomination, `awayPauseDeclinedFor` the
span-scoped refusal, `vacationDrivenBy` the settings key recording who owns the
switch, and `checkAwayVacation` the pass.

**It is the "on" half only.** `checkVacationExpiry` — first in `catchUpPasses` —
already turns vacation off once `vacationEnd` passes. So the whole feature is: on
the departure day, call the existing `setVacationMode(true, awayEnd)`.

That also disposes of the semantics problem for free. `vacationStart` being
stamped `new Date()` is what makes it useless to `LookAheadSheet`; a pass that
fires *on* the departure day rather than arming in advance keeps that stamp
truthful, so nothing about vacation mode's existing shape has to change.

Five hazards, and where each lands.

- **Two trips at once needs no tie-break.** Vacation mode is a boolean, so the
  answer is the union of nominated spans, not a winner. This is the one place the
  design diverges from `weekendSource`, which needs `sortOrder` because it has to
  name a single project.
- **The pass must only turn off what it turned on.** A `vacationDrivenBy:
  projectId | null` setting. A manual switch-on is claimed by nobody and keeps
  its current behaviour exactly. Same rule as `dropGeneratedTask` versus an
  opt-out write: the app's own tidying never overwrites a decision a person made.
- **Turning it off mid-trip must not re-arm tomorrow.** This is the one place to
  break from precedent deliberately. `Project.reviewDeclinedAt` is a *date*
  rather than a permanent `false` because a swipe means "not today". Turning
  vacation off on day three of a seven-day trip does not mean "not today", it
  means "give me my tasks back for this trip" — so a day-scoped stamp would fight
  the user every morning. The stamp has to be span-scoped: the project records
  the `awayStart` it was declined for. Moving the dates later is a new trip in
  every sense that matters, and re-arms.
- **Ordering.** `sweepExpiredTasks` runs first, and launch-only, *because* it has
  to precede vacation turning off (#689): sweeping after would delete tasks
  vacation had been protecting. Arming is the mirror case and takes the mirror
  answer — it goes in `catchUpPasses` immediately after `checkVacationExpiry`, so
  a trip ending and another starting on the same day resolve in that order. And
  it reconciles rather than arms once, because extending the trip in the editor
  has to move `vacationEnd` too.
- **Background is correct, not incidental.** `runBackgroundRefresh` spreads
  `catchUpPasses`, so this arms with the app closed. Reminders going quiet on
  departure morning without anyone opening the app is the feature working.

---

## Look ahead needs both directions

`buildPushPlan` moves the window's work *past* the return, and that is the only
direction it has. But some of what lands during a trip has to happen **before**
you go, and the module already knows which:

```ts
if (wouldMissDeadline(task, destination, dayResetTime)) {
  return { ..., destination: null, selected: false,
           blocker: 'deadline',
           blockerLabel: 'Deadline lands before you are back' };
}
```

Its own comment calls that *"the common case rather than the edge one"*. So the
plan already computes this set, already labels it in the trip's own terms, and
can then do nothing with it: the row is dead, unselected, with a sentence
explaining why it cannot move. **Pulling it forward is the missing action, and
the hard part — knowing which tasks — is already done.**

### The direction is chosen per row, from a rule the module already has

Not "offer both on everything". `AwayEntry.kind` is already `'due' | 'deadline'`,
and the header already says what separates them: a do-date is *"the day a task
becomes available, not a promise it can break"*, and *"only `Task.deadline` is
ever late here"*.

That is the whole rule:

- **A deadline landing inside the span defaults to pulling forward.** It cannot
  wait, and you will not be there.
- **A plain do-date landing inside the span defaults to pushing back.** Nothing is
  broken by doing it later, which is what the existing plan already assumes.

Both stay untickable and overridable per row, as every proposal in this app is.
This is direction as a *default*, not as a gate — the same rule as the section
above.

### Where a pulled task lands

Push has an obvious destination: the day after you are back. Pull does not, and
the wrong answer is the day before departure, which is already the worst day of
the trip.

Take the destination from `buildDayLoads` over the days between now and
departure, which the sheet has computed anyway — the same "spread it across the
best nearby days" judgement `deloadPlan` already makes, rather than a second
placement rule invented here. And keep `describeCrowding`'s silence rule: if
every day before departure is already heavy, the sheet must not imply the work
fits.

### Two refusals, and they are not the same refusal

`wouldMissDeadline` is the *push* refusal. Pull has its own and it is a mirror:
a task cannot be pulled in front of the day it becomes available. `deferUntil`,
`windowStart` and a blocker in `blocking.ts` all say that, and
`deloadBlockerFor`'s hard/soft split is the existing vocabulary for reporting it.

**And a recurring occurrence should not be offered at all.** `AwayEntry.occurrences`
exists precisely because a daily chore reads as one line saying "8 times", and
there is no sense in which eight projected occurrences pull forward. More
sharply: pulling a date-anchored task forward rewrites `dueDate` *and*
`recurrenceAnchorDate`, so doing it to a recurring row moves the grid the rest of
the schedule is measured from. Offer the pull for entries landing once. Leave the
rest to the push, which handles them correctly today by deferring.

### This is the second caller for the same missing arm

`buildPushPlan` sets `mode: 'defer' | 'reschedule'` from `isDateAnchored`, and
`deloadUpdates` implements exactly those two. Neither can express a pull-forward
for a date-anchored task; that rule lives inline in `TaskItem.tsx`.

The trip-moving section below needs the same arm. So this is no longer a refactor
a hypothetical future caller might want — **two readers in this design need it**,
which is the argument for lifting it into `taskMoves.ts` rather than writing a
third copy in the look-ahead sheet.

---

## The trip moving

*Built.* `scheduleMoveUpdates` in `taskMoves.ts` is the lifted rule,
`awayShift.ts` the planner, `shiftAwayTasks` the store action, `AwayShiftSheet`
the offer.

The half that setup does not cover, and the half that had no answer at all.

Two facts:

- **Templates forget their anchors at apply time.** `resolveOffsetDate` turns "14
  days before start" into a `dueDate`, and nothing stores the offset. The link to
  the anchor is gone the moment the run lands, so moving `awayStart` cannot move
  the tasks.
- **There is no bulk shift-by-N-days anywhere in the app.** Deload spreads one
  day across nearby days, look-ahead pushes a window past a return, the bulk bar
  defers. Nothing shifts a set by a delta.

So "the flight moved two days later" is nine manual edits. For a project shape
that repeats, that is plausibly a bigger share of the pain than setup is.

Structurally it is cheap: a pure planner emitting `{ id, updates }[]`, applied
under one undo entry. `deloadTasks` already has that signature. `taskMoves.ts` is
the leaf that owns what moving a task *means*, and its header already names this
caller.

Three sharp edges, all real.

- **Moving a trip *earlier* is a case `taskMoves` cannot express.**
  `deloadUpdates` knows push (`deferUntil`) and plain reschedule, nothing else.
  The pull-forward rule for a date-anchored task — write `dueDate` alongside
  `recurrenceAnchorDate: task.recurrenceAnchorDate ?? task.dueDate`, and only
  ever set it once — lives inline in `TaskItem.tsx`. So the *predicate*
  (`isDateAnchored`) sits in the leaf and the *rule* that consumes it sits in a
  component. Deload and look-ahead never noticed, because they only ever push
  outward. A shift needs both directions, and so does look-ahead's pull (see the
  section above) — two callers, which is the reason to move that rule into the
  leaf that exists precisely so it cannot drift.
- **It must not go through `deloadTasks`.** Both reasons are in that function's
  own comments. Its undo snapshot is `{ dueDate, deferUntil, postponeCount }`, so
  a patch that also wrote `recurrenceAnchorDate` would survive the undo and
  silently rotate the recurrence grid — the exact back-door rotation
  `TaskItem`'s "only ever set once" comment exists to prevent. And it
  deliberately counts `postponeCount`, because "Lighten this day" is the most
  explicit *I am pushing today's work* action in the app; a trip moving because
  the airline moved it is not the user postponing anything, and counting it would
  feed the "you've pushed this five times" prompt with pushes nobody made. So it
  is `pullProjectTasks`' mirror: its own action, exempt from the count,
  snapshotting the anchor.
- **It is a proposal, not an automatic shift.** Deload, look-ahead and pull all
  derive and offer. And not every member should move: "Renew passport" is
  anchored to the trip, "Buy a suitcase" is not, and a completed member should
  not move at all. `deloadBlockerFor`'s hard/soft split is the existing
  vocabulary for "cannot move" versus "movable but unchecked".

### Why the offsets are not stored on the task

The exact fix is `Task.awayOffsetDays` plus an anchor, so a shift is arithmetic
rather than a guess. Rejected: it costs a new `Task` field and, with it, the
four-site `TemplateItem` parity obligation — and it only ever helps tasks a
template run created, never the ones typed into the trip project by hand.

A uniform delta plus a proposal sheet is cheaper and degrades honestly. Shift
every incomplete member by the delta, and let the user untick the ones that were
not trip-relative. The sheet does the work the stored offset would have done, for
the tasks a stored offset would never have covered.

---

## Templates

### The current mapping is wrong for a trip

`applyTemplate` puts `anchors.end` into `Project.deadline`. For a trip, end is the
**return**, so applying a trip template today produces a project whose "target to
finish by" is the day you get home. The thing you have to be done by is
departure.

So a trip run writes `awayStart`/`awayEnd` from the two anchors and leaves
`deadline` alone. One date on the card, and it is the right one.

### The nomination is authored on the template, and cannot be anything else

**Nothing is remembered between runs.** `ApplyTemplateSheet` zeroes every piece of
state on open, answers never leave component state, and `ApplyTemplateOptions` is
input-only. The only persisted per-template run memory is
`scheduleLastFiredKey`, a dedupe key. So any "ask once per template, remember it"
scheme would mean building a memory that does not exist, for this.

That leaves a single authored flag on `TaskTemplate`. An enum would be wrong:
`applyContainer` is the only other per-template setting and it is about *what
object gets created*, which this is not.

**Do not infer it from `fromDates`.** Tempting — exactly one template in the repo
uses `fromDates`, and it is the Trip prep demo with `'nights'`. But `'days'` is
genuinely ambiguous (eight days of renovation is not eight days away), and
inferring is the move `weekendSource`'s note forbids in as many words. A
`'nights'` question is suggestive enough that the template editor could surface
the toggle prominently when one exists. A hint, not a rule.

**The UI cost is zero rows.** `ApplyTemplateSheet` already renders both anchor
rows unconditionally, labelled "Start date" and "End date". The flag relabels them
to "Leaving" and "Coming back", which is also an improvement under the copy rule
about naming the state the user is choosing rather than the data model.

### Two nominations, not one, and this is a safety conclusion

`TemplateSchedule.anchorSpanDays` synthesises an end anchor so unattended runs
still resolve `fromDates` questions. So a trip template can fire on a schedule. If
the template flag also implied the vacation nomination, **a scheduled template run
could silently turn on vacation mode** and hide a chunk of somebody's tasks with
nobody having asked.

So they stay separate:

- **The template flag** says "these anchors are days away from home". It decides
  *placement*, and a template run may set it.
- **`awayPauses` on the project** says "let this trip drive vacation mode". It
  decides *suppression*, and only a hand in the project editor sets it.

Neither implies the other. Same split `nudgeOptIn` and `weekendSource` already
make — two flags because they answer different questions, and collapsing them
would let a quiet answer to one imply a loud answer to the other.

### The reverse direction needs no flag

`resolveAnswers(questions, typedAnswers, anchors)` is live-coupled to the pickers,
so an untouched `{nights}` tracks whatever dates are set. Which means applying a
template *into an existing trip project* can prefill the anchors from that
project's away dates, and `{nights}` comes out right for free. No nomination is
needed, because the project declared itself by having the dates.

Both directions are worth having. New trip: the template makes the project.
Existing trip: the project teaches the run its anchors.

### The trip you have not booked yet

Both directions above assume you know the dates when you apply the template. Often
you do not — the trip is real, the prep is real, and the dates are the *first*
thing on the list to find out. The Trip prep template already opens with exactly
that task: "Pick dates for {destination}", a `deliverableKind: 'date'` task
28 days out.

So the third direction is: **applying the template with no anchors gives a project
with no span, and answering that task fills it in.**

This is a third writer of a deliverable answer, and `deliverables.ts`' header is
explicit that there are two, on stated terms, and that *"a third reader wanting
looser terms than these is a different feature and should say so."* Saying so:

- **The term it keeps.** One kind (`'date'`), written in `completeTask` beside the
  other two, reusing an answer the task was recording anyway. The module's own
  opening line is *"'Pick a date for the trip' isn't done when you tick it, it's
  done when you know the date"*, so this is close to the motivating case rather
  than an extension away from it.
- **The term it loosens, and this is the real one.** Both existing writers are
  safe because nobody can aim them: the chain case reuses a date the successor
  was getting regardless, and the supply case is on a *generated* task whose kind
  the generator sets. Here the task is authored by a user, in their own project,
  so a user chooses the destination. That is genuinely looser and is the thing to
  argue about if this is ever built.
- **What makes it safe anyway: it writes a field, it does not re-date anything.**
  Setting `awayStart` on a project whose members are already dated raises the
  *proposal* from the trip-moving section, per-row and untickable. A user-aimable
  writer that can only ever populate one project field and then ask is a much
  smaller thing than one that can move nine tasks.

**It fills in the start only.** A `'date'` answer records one date and a trip has
two, and the obvious fix — a range deliverable kind — is a new kind for one caller
and should be refused. Nor can the duration come from the template run's own
`{nights}` answer: answers are never persisted (`ApplyTemplateSheet` zeroes on
open, nothing writes back), so 28 days later it is gone.

So the answer writes `awayStart` and leaves `awayEnd` null. That is not a
degraded state, it is the one the field design already declares legal and
meaningful: a boundary but not yet a trip, exactly `LookAheadWindow`'s own
`awayEnd: null` case. The return date arrives later, by hand or from booking the
flights, and the span completes itself.

---

## Net new: a destination, and the forecast for it

Everything above is wiring — existing parts that could not share a fact. This is
the one piece with no machinery behind it that is worth adding, and it earns its
place because **packing is the trip task people actually get wrong, and they get
it wrong because they do not know what the weather will be.**

**`Project.destination`, free text.** `Task.location` carries a note saying
nothing in the app plots it and that a real reader is a future thing; a trip is
that reader. It also gives the template's `{destination}` blank somewhere to live
between runs.

**The forecast is cheaper than it looks.** `weatherLookup.ts` already calls
Open-Meteo's `/v1/forecast` with a latitude, a longitude and `timezone=auto`. It
asks only for `current=`. Pointing it at other coordinates and adding `daily=` is
a small change to a service that exists and needs no key.

Three rules if it is built.

- **It is a sentence, not a rule.** "Nov 3 to 10 in Tokyo, 4 to 11°C, rain on the
  5th." Not weather-conditioned packing items — that would mean extending template
  conditions, which gate on choice questions only, and would stake packing
  decisions on a ten-day forecast. `lookAhead`'s own rule is the right one here:
  *a cue may rank; a sentence may only state.* Let the reader draw the conclusion
  and the reliability objection disappears.
- **Geocoding is a new keyless outbound service and needs its own switch.**
  Turning "Tokyo" into coordinates is a network call the app does not currently
  make. `productLookupEnabled` is the precedent and the reason: once something
  reaches the network without a key, "no key, no traffic" stops being the whole
  privacy answer, and the feature carries its own switch instead.
- **It is a read with no store.** Same shape as `useWeatherStore`'s daily
  snapshot. Nothing about a forecast should be persisted onto the project, where
  it would go stale and then be believed.

---

## What this is not: the itinerary boundary

The recurring question about anything in this file will be why it does not also
hold flights, hotels, confirmation numbers and check-in times. The answer, and it
is worth having one sentence for:

> **This app plans for a trip. It does not run one.**

TripIt and its like are built around an itinerary and live travel-day operations:
parsing booking emails into a chronological plan, then flight delay alerts, gate
changes, seat tracking, airport maps, when to leave for the airport. What they
almost entirely lack is *preparation* — no real packing list, no "this bill lands
mid-trip", no sense that being away has consequences for the rest of your life.
That is the half this app is for, and the two are complementary rather than
competing.

Concretely, an itinerary is refused because:

- **A flight is not a task.** You do not tick it; it happens to you. Every list,
  completion path and visibility rule in this app is about things you do.
- **It needs a start *and end* time, which does not exist.** `windowStart`/
  `windowEnd` are times of day, not a datetime range, and `TemplateContainer`'s
  doc already refused dates on the task container for exactly this reason. So it
  is a new model, not a new field.
- **The live half needs infrastructure this app does not have** and should not
  grow: a paid flight data feed, push, and a backend, against an architecture
  whose first claim is that there is none.

**The better answer is import, not modelling.** `EventImportSheet` already reads a
booking confirmation from a photo or pasted text and produces dated tasks, which
is a slice of the same trick. If an itinerary is ever wanted, growing that path —
an end time, and filing the result into a trip — is a far smaller change than a
new model, and it keeps the plan somewhere the app can already read.

### Also refused, and why

- **Passport numbers, booking references, boarding passes.** There is no
  attachment model, and the one piece of sensitive data the app holds lives in
  the keychain (`secureApiKey.ts`). Storing travel documents is a different app
  with a different threat model.
- **A trip budget.** A whole domain. Groceries has prices; travel spend is not
  the same thing and would need its own everything.
- **Assigning tasks to travelling companions.** There is no sharing model, so an
  assignment has nowhere to go. `docs/arch/people.md` is clear that the people
  layer does not do this kind of thing.
- **A days-until Live Activity.** Live Activities render through SwiftUI's timer
  style with JS supplying start and target, so a days-until countdown is new
  native work for something the line on the project card says just as well.
- **A "you always forget your charger" generator.** The template is already the
  memory and editing it after a trip is the mechanism. A twentieth generator to
  prompt that is a hard sell against the bar the other nineteen cleared.

---

## The gates

- **Demo mode needs none, and this was checked rather than assumed.** The worry
  was a demo trip arming vacation, changing what is hidden, and cancelling real
  reminders through `rescheduleAllReminders`. It cannot: every entry point in
  `notifications.ts` already refuses in demo mode. Settings live in the settings
  table, which the demo swaps with everything else. Worth a test pinning it,
  because "no gate needed" is exactly the claim that ages badly.
- **Simplified mode: a new feature id, gated `set: awayStart !== null`.** Rule 1
  of that mode carries more weight here than usual: it changes what is rendered,
  never what is stored. `featureHidden` hides the editor row and must not touch
  the pass. A project that already has dates keeps behaving; the mode only stops
  dates being added to a new one. Getting that backwards would be a rendering
  switch that silently changes behaviour.
- **Backfill: leave it out.** `weekendSource` qualifies for the walkthrough
  because it is a flag whose whole meaning is itself, so missing reads as off.
  Away dates missing means "not a trip", which is true of nearly every project,
  so the walkthrough would ask a dead question on every row.
- **Demo seed.** The demo's Japan trip is a *task with subtasks*, not a project,
  so there is no trip project to give dates to. Seeding this means adding one,
  and per the demo-seed rule that is part of the change rather than a follow-up.

---

## Still open

- **`createProject`'s signature.** It is positional — `(title, deadline, kind)` —
  and a template can configure nothing else about the project it creates: category
  is forced null for the project container, notes hardcoded, nudge settings from
  global defaults. Two more dates makes five positional arguments. This wants an
  options object, which would also unblock the other things a template cannot set.
  It is the one refactor here that is not about trips, so it deserves a deliberate
  decision rather than being drifted into.
- **Whether an `awayPrep` generated task is worth a twentieth generator.** "Anything
  to do before Japan?", raised on a lead day, linking into the look-ahead sheet
  scoped to the trip. Structurally identical to `weekendNudge`: a span, a lead
  window, a link to a sheet that already exists. It adds a surface rather than
  replacing one, so it would ship off by default. Genuinely unsure it earns its
  place.
- **Ordering interaction between arming vacation and `sweepExpiredTasks`.** The
  ordering above is argued from #689's mirror, but #689 is about the *off*
  direction. A task whose window closes on the departure day, with the sweep
  running before the arm, is swept rather than protected. That may well be right —
  the trip has not started when the sweep runs — but it has not been thought
  through properly.
