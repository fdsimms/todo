# Reading (mostly) and writing (four times) Apple Health

The whole of it: the bridge, the store, the Settings section, the row on Today,
the Mood screen's health axis, the Activity rings, the `health` generator, the short-night line
under "Lighten today", the Weight screen and its chart, the Sleep screen, heart rate during a
workout (measured on the Apple Watch, read back on the workout page), and the four things
this app writes back — a nutrient sample, on completion of a task that opted
into logging one; a body-mass sample, when somebody records a weight; a
meal's nutrition, when somebody adds it to the food log; and a finished
strength workout, when somebody saves one (or the Apple Watch that measured it
saves it) — plus the rules any further reader or writer has to be built against.

Read this before touching `modules/todo-health-bridge/`,
`src/utils/healthBridge.ts`, `src/utils/healthCompletionSync.ts`,
`src/utils/healthWeightSync.ts`, `src/utils/healthBloodPressureSync.ts`,
`src/utils/bloodPressureLog.ts`, `src/screens/BloodPressureScreen.tsx`, `src/utils/healthFoodSync.ts`,
`src/utils/healthWorkouts.ts`, `src/utils/healthWorkoutSync.ts`,
`src/utils/heartRateZones.ts`, `src/utils/watchHealthWorkout.ts`,
`targets/todo-watch/WatchHealthSession.swift`, `src/utils/weightLog.ts`, `src/store/useFoodLogStore.ts`,
`src/store/useHealthStore.ts`, `src/screens/settings/HealthSettings.tsx`,
`src/screens/WeightScreen.tsx`, `src/utils/sleepLog.ts`,
`src/screens/SleepScreen.tsx`, `healthContextRows` in
`src/utils/dayContextRows.ts` or the health half of
`src/utils/moodInsights.ts` — and before adding any reader *or writer* of a
health figure anywhere else. Most of what follows is about what a reader is
allowed to claim rather than about how to get the number; the "Writing exactly
one thing", "The second write" and "The third write" sections are where the
concerns are about a writer instead.

The rules here are strong defaults with the reasoning
attached: read the reason before deviating from one. Where this note and the
code disagree, the code is what ships, so fix the note.

---

## It is a reading, not the app's data

The shape is `useWeatherStore` / `useCalendarStore`, arrived at by the same
argument: an answer somebody else owns, consulted rather than kept. A small
in-memory store holds one day-keyed snapshot, refreshed on the three triggers
those two settled on (mount, a relevant settings change, foreground), and every
reader takes whatever snapshot is already there. Nothing else calls the bridge.

**There is no table, and there must not be one.** Three separate reasons, and
each is sufficient on its own:

- Health already syncs across a person's own devices through iCloud, so there is
  nothing for two devices to disagree about and nothing a merge would resolve.
  That is exactly the argument `SYNC_EXCLUDED_TABLES` makes for the barcode
  cache, one shelf over.
- A copy in this app's SQLite is half a health record in `backup.ts`'s export
  file, put there to answer a question the phone can already answer.
- The app's own account of itself is that every piece of *user data* lives in a
  local SQLite file. A reading never becomes user data, so that stays true
  without qualification.

The historical reads a trend would want (see the deferred work below) are
answered by HealthKit directly: query the window on demand rather than caching
one. This is the one place the design is deliberately less efficient than it
could be, and the cost is a query nobody notices.

## Read authorization is not observable, and that is Apple's design

`HKHealthStore.authorizationStatus(for:)` is truthful about *write* access and
answers `.notDetermined` for reads whatever the truth is. A refused read is
served as an empty store, so that an app cannot learn what somebody declined to
share — knowing an app was refused permission to read blood glucose is itself a
health disclosure.

Four consequences, all of them load-bearing:

- **There is no permission state to render and no error path to write.** The
  nearest thing the system will say is `getRequestStatusForAuthorization`, which
  answers whether asking again would put a sheet on screen. `unnecessary` means
  "already asked" and is equally true of everything-allowed and
  everything-refused. `HealthSettings` therefore says "Not asked yet" or
  "Already asked" and never says allowed or blocked, which is the one place it
  departs from `CalendarSettings` beside it.
- **`requestAuthorization` reports only that the sheet was shown.** The native
  `success` flag means it was presented and dismissed without error, and carries
  nothing about what was chosen. The bridge answers `'requested'`, deliberately
  not `'granted'`. Mapping it to a grant would invent the one fact Apple
  withholds, and every screen built on it would be wrong for exactly the people
  who said no.
- **Absent is never zero.** `HealthDay.steps` is `number | null`, and null covers
  a refusal, a day with nothing recorded and a device that never records any,
  with no way to tell them apart. This is already rule 3 of `moodInsights` ("a
  day you didn't log is not a zero"), except that here the API forces it rather
  than the design choosing it. A real 0 survives as 0: a day spent in bed is a
  genuine reading, and collapsing it to null is the mirror bug.
  `healthReadings.test.ts` pins both directions.
- **A rule may only fire on a reading that arrived.** "Under 3,000 steps" is
  sayable. "No workouts this week" is not, because absence has two meanings.
  Anything added later has to be a threshold on a number that is present.

## A reading is a claim; an entry is a statement

`lowMoodDeloadNote` can say "You've logged a low mood three days running"
because the person logged it. Nothing here was logged by anybody: a phone left
on the nightstand, a Watch not worn, a nap counted as a night. So copy
attributes the source rather than asserting the fact, and never rounds a
doubtful number into a confident sentence.

This is also why the step read takes the largest single source rather than the
sum. A phone and a watch both record steps for one walk and HealthKit does not
de-duplicate them for a statistics query — the Health app's own total is
computed by logic Apple has never exposed. Summing over-counts anyone wearing a
Watch, which is most of the people this is for; taking the maximum under-counts
a day split between devices. The second is the error to prefer, because it never
claims more steps than some one device actually recorded.

And the rule `moodNudge` already holds applies here in full: **it never names a
state back at the user and never diagnoses.** Health data is the second thing in
this app that can be wrong about a person rather than about their data. See
`docs/arch/mood-log.md`.

## Nothing asks, except a person

`useHealthSync` never raises the permission sheet — the same line
`weatherLocation.ts` draws for location, and for a sharper reason: a sweep that
put a Health sheet on screen would be asking about a person's body on its own
initiative. The two places that ask are both a deliberate tap in Settings:
switching the row on, and the access row's own button.

`healthBridge()` is the one door and refuses in demo mode, which is the sharpest
case that gate has had. Demo mode swaps the database for a throwaway one, so a
reading taken there is the real person's, shown beside seeded fiction, in a
database about to be discarded. Nothing is seeded in `demoSeed.ts` for the
*reading* itself, and that is not an oversight: nothing here writes a row for
it, so there is nothing a seed could show, and the honest demo of a health
reading is its absence. (A demo task can still carry `logHealthMetric` — see
the next section for why that's a different case.)

## Writing what a task names: a logged nutrient

Everything above this section is still exactly true: every read stays
read-only, and this app never infers, diagnoses, or has an opinion about a
body from a number it read. What changed is that the app now *writes*
something of its own when a task the user set up to log it completes — a
sample of whatever `NutrientKey` the task names, in that nutrient's own
unit — and that capability earned enough new rules to need its own section
rather than a footnote on the reading ones.

**This shipped as dietary water only, and was generalized later.** The
feature's shape below — one place it fires from, opt-in per task, one-shot,
gated separately from reading — was all argued out for water alone; nothing
about it needed to change to widen from one nutrient to all of `NutrientKey`; what changed is
`Task.logWaterMl` (a bare millilitre count) became `Task.logHealthMetric` +
`Task.logHealthAmount` (which nutrient, and how much of it), and the native
write (`writeWaterSample`, one hardcoded share type) became
`writeNutrientSample`, which resolves the task's chosen key against the same
`nutrientWriteTable` the food-log write (see "The third write" below)
already had to build. **No new share type was added for this**: every
nutrient a task can now log is one `writeFoodSamples` already had a
`HKQuantityTypeIdentifier` for, so the write authorization sheet a task's
picker can trigger is unchanged from what logging a meal already asks for.

**Read and write are not the same kind of risk, and the asymmetry runs through
every design choice below.** A read that leaks (shown in the wrong place, or
to the wrong person) discloses a true number. A write that fires when it
shouldn't *creates* a false fact in somebody's permanent medical record — a
completion that wasn't real, or a demo session's fiction, would sit in their
actual Health app forever, survivable only by manual deletion nobody would
know to go looking for. Every rule below is really one rule, applied
everywhere it's relevant: writing costs more to get wrong than reading does,
so it is gated by its own switch and triggered only by a person's tap. It is
no longer *asked* for separately — see the next section for why the ask
merged while the switches didn't.

- **Read and write are gated by two independent switches, but asked for in
  one combined native request.** `healthReadEnabled` and `healthWriteEnabled`
  (`useSettingsStore`) stay two independent switches, and `HealthSettings.tsx`
  still renders them as two `SettingsSection`s with their own hints and rows —
  each still gates its own feature. But the native module's
  `requestAuthorization` and `requestWriteAuthorization` both now pass the
  full `toShare: writeTypes, read: readTypes`, whichever one is called, so
  whichever switch somebody turns on first raises one sheet covering
  everything this app can read *and* write. This used to be two asks with two
  empty-set halves, on the reasoning that turning on reading shouldn't put a
  water-sharing row in front of somebody who only wanted their step count —
  see "this app cannot prevent it" below for why that stopped being the whole
  story. `checkHealthTasks`'s own doc comment still states the same "two
  different permissions to give" rule for the read + generator switches one
  level up, unaffected by this — that pairing has no shared-type OS bug behind
  it, and generalizing this change to it would trade away a real UX win for no
  reason.
- **Write authorization is genuinely observable, unlike read — and the UI is
  allowed to say so.** The whole of "Read authorization is not observable"
  above is Apple's own deliberate design for *reads*; the same
  `authorizationStatus(for:)` call is documented to answer truthfully for
  share/write types. `healthWriteAuthorizationStatus()`
  (`modules/todo-health-bridge/index.ts`) is a plain synchronous read of that
  fact, and `HealthSettings`'s water-write access row renders a real
  "Allowed" / "Not allowed" / "Not asked yet" — the one place in this screen
  that gets to say what `CalendarSettings`' access row says, rather than the
  read row's necessarily vaguer "have you been asked" phrasing.
- **Granting read access could silently cost write access, for the types the
  two sides share, and this app still cannot reverse it once it has
  happened.** `readTypes` and `writeTypes` overlap on most of the types the app
  uses — water, body mass, and every nutrient that is also a health-rule
  metric; carbs, total fat and the three minerals are write-only and never
  read (compare the two tables in `TodoHealthBridgeModule.swift`). Apple's docs say
  read and write authorization for one type are independent, but in practice,
  granting the *read* sheet for a type that already had *write* access — as a
  **separate, later** request — could flip that write access to
  `sharingDenied`: observed for real, reported by a user whose Water/Weight
  write access (granted earlier, and working) disappeared after later
  granting read access, while Carbohydrates/Total Fat write access
  (write-only, no read overlap) survived untouched. This is a
  HealthKit/Health-app bug, not a mistake in how this file used to call
  `requestAuthorization` — those calls already followed Apple's documented
  pattern (separate `toShare`/`read` calls) — and there is still no supported
  API to programmatically win a permission back once it's denied. Once it
  happens, the affected types can also fail to appear at all in the Health
  app's own Settings → Sharing list, even as a denied (off) toggle — so the
  one usual recovery path ("go flip it back on in Health") can be unavailable
  too, and the only fixes that have worked are a device restart, revoking and
  re-granting from scratch ("Turn Off All" on that same Health screen), or a
  full iOS privacy-settings reset.
  **What changed is that this app can now prevent the trigger, not just
  detect it faster.** The bug's precondition, in every report of it, is a
  *sequence*: one half decided, the other half decided later, as two separate
  requests. Once `requestAuthorization` and `requestWriteAuthorization` both
  always ask for everything together (see the bullet above), the app never
  issues a solo request for either half again — so there is no later, separate
  grant left to trigger the flip, for any permission this app requests from
  this point on. This does not repair a permission already broken by the bug
  before this change shipped (that still needs a Health-app-side reset, as
  above), and it is not a guarantee against every possible OS-level glitch —
  Apple has not documented the bug or a fix for it, so nothing here can claim
  certainty about behavior it doesn't control. It closes the one trigger this
  app's own code was actually responsible for.
  The detection half still exists and is still worth keeping:
  `refreshWriteStatus()` in `HealthSettings.tsx` is called immediately after
  every authorization grant (`onToggle`, `askForAccess`, `onToggleWrite`,
  `askForWriteAccess`), not only on focus/foreground, so a write permission
  that is `sharingDenied` right after a grant — whether from a residual case
  this doesn't cover or from before this change shipped — shows up as "Not
  allowed" on this same screen immediately rather than being discovered
  confused, weeks later, through Health's own UI.
- **Adding a genuinely new share type is still not a small decision** —
  that part of the old rule holds. `writeTypes` in the Swift module is
  deliberately not generalized the way `readTypes` is (a `Record` keyed by an
  ever-growing metric union): a share type is a real consequence landing in
  somebody's actual Health record, so each one earned its own review rather
  than riding in with whatever the read side happened to be reading that
  month. What *did* turn out to be small was widening which of the
  already-reviewed nutrients a task may target, because none of them needed a
  new type — the review for all of them happened together, for the food-log
  write (see "The third write" below), before a task could reach any of them.
- **The write fires only on a person's tap, opt-in per task.**
  `Task.logHealthMetric` and `Task.logHealthAmount` (two fields rather than a
  boolean-plus-amount pair, so "off" and "log 0" can't become two different
  ways to say nothing happens) are read by `logTaskHealthValue`
  (`src/utils/healthCompletionSync.ts`), which runs when a task is completed
  (`completeTask`, unless a caller passes `skipHealthLog`) and when a quota or
  rotation unit is logged (`logQuotaUnit`, `logRotationUnit`). **Never from a
  save, an edit, a sweep or sync**, because a caller that looped it into one of
  those would write an amount nobody actually logged. Water is the exception
  that can be taken back: it is written as a food log entry, so un-logging a
  quota unit removes it (`unlogTaskWaterFromFoodLog`) and `syncWaterQuotaTasks`
  keeps the two in step. Every other nutrient write is a historical record with
  no delete-on-uncomplete, the shape `logTaskCompletionToCalendar` has.
- **`healthBridge()`'s demo-mode gate is sharper for this write than for any
  read it already covered.** The gate's own module comment used to describe
  the worst case a leak could cause as "a true number in a fictional
  context" — survivable, because nothing was created. A write leak is worse
  in kind, not just in degree: a demo-seeded task completing during a demo
  session would put a *real* sample, sourced from a completion that never
  happened, into the person's *actual* Health record, outliving the demo
  session by however long until they happen to notice and delete it by hand.
  `logTaskHealthValue` checks `isDemoModeActive()` first, before anything
  else, for exactly this reason — see its own doc comment.
- **A demo task may still carry `logHealthMetric`/`logHealthAmount`, and
  that's not a contradiction of the demo-mode gate above.** The gate stops
  the *write*; it says nothing about whether a seeded task's fields may show
  the feature exists. Since the write path refuses unconditionally in demo
  mode regardless of what those fields hold, seeding a demo "Drink water"
  task with them set would demonstrate the setting exists (opening its
  editor shows "Log to Health" already on) without ever being able to
  trigger the write it describes — the same reasoning that lets
  `demoSeed.ts` seed `logCompletionToCalendar` on a task despite the
  calendar write it names being equally gated.
- **The Info.plist strings say what is actually read and actually written.**
  `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`
  (`app.json`'s `ios.infoPlist`) have to be updated whenever a new kind of
  write or read ships, the way the update string was when tasks could log
  nutrients other than water. See `plugins/withHealthKit.js`'s
  own comment for why the update string was already required (App Store
  Connect's Info.plist validator scans for the `requestAuthorization
  (toShare:read:)` selector being linked at all, whether or not anything is
  ever passed in `toShare`) even back when it was never truly exercised.

## The second write: body mass

Everything the water section says about writing being a different kind of risk
from reading holds here unchanged, and more so: a weight is the most personal
number this app touches. What follows is only where body mass *differs* from
water, because everywhere it doesn't, the rules above are the rules.

- **It is licensed by the read argument, not by the water one.** Water earned
  its write by being the one thing a task has an unambiguous amount to record.
  A weight is not written by a task at all; it is written because somebody
  typed a number that is already true. That is the nutrients' argument applied
  to a write, and it is why "there's no equivalent obvious number for, say, a
  stretching task" is still correct and still not an objection to this one.
- **The write carries its own date; the water write stamps `Date()`.** Water is
  logged by completing a task, so the logging and the drinking are one event.
  A weight is typed, and this morning's weigh-in is quite often entered in the
  evening. `writeBodyMassSample` therefore takes an instant, and the sheet
  sends the actual moment for today and noon of the chosen day for a backdated
  one. Backwards is allowed, forwards is not — the same asymmetry `MoodLogSheet`
  applies, for the same reason.
- **Authorization is per type, and that changed an existing signature.**
  `writeAuthorizationStatus` takes a kind (`'water' | 'weight' | 'nutrition'`),
  because Health lets somebody allow one and refuse another in the same sheet
  and a single "write access" answer would be false for whichever they
  declined. There is an access row per kind in Settings and still **one**
  app-level switch: "may this app
  put samples in my Health record" is asked once, and which types is Health's
  question rather than this app's.
- **Failures are surfaced rather than swallowed.** `logTaskHealthValue`
  returns a bare boolean because nobody is watching a completion and no failure
  is worth interrupting them over. `logWeightToHealth` returns which failure it
  was, because a person is standing there having just typed a number, and the
  most likely failure by far is that Health's sharing permission was never
  granted — which they can fix, if they are told.
- **Still no local copy, and still no edit or delete.** Health is the record.
  Correcting or removing a weight happens in the Health app, with the person's
  other sources in view; a mirror here would be a second, worse editor for data
  this app does not own. The screen says so in as many words rather than
  leaving somebody hunting for an edit button.

### Reading it back is a separate call, and had to be

`readWeightSeries` is its own native function rather than one more column on
`readDailyHealth`, and the three reasons are all disqualifying on their own:

- **The statistics are the wrong kind.** Every metric the daily read collects is
  cumulative, and `runDietQuery` hardcodes `.cumulativeSum`. On body mass that
  *adds up* the day's weigh-ins: step on the scale twice and you weigh 145kg.
  The weight query uses `.discreteAverage` instead.
- **The wire format rounds.** `readDailyHealth` puts every value through
  `Int($0.rounded())`, which lands 72.4kg as 72. The weight read carries whole
  **grams as an integer** and divides back on the JS side — 0.001kg of
  precision, three digits finer than any bathroom scale, and no `Double` in
  hand-built JSON for a comma-decimal locale to break.
- **The daily read runs on every foreground.** It refreshes today's snapshot at
  each foreground and again over 90 days for the mood correlations, so a column
  there would cost a query on every foreground for a number one screen reads.

It also drops `.separateBySource`, which every cumulative read above uses.
That option exists there because a phone and a watch counting one walk get
*summed* into double the steps, so the reading must be pinned to a single
source. An average has no such failure: two apps reporting the same morning's
weight average to that weight, and a scale and a manual entry that genuinely
disagree average to something between them, which beats a coin flip on which
source is "best". `bestSum`'s reasoning does not transfer, and copying it here
would have been cargo cult.

The window is a year (`WEIGHT_HISTORY_DAYS`) rather than the readings window's 90 days. That one is sized
to gather enough *paired* days for the mood correlations; weight is drawn
rather than correlated, and a body moves slowly enough that three months has
barely any shape in it.

### What the chart may draw

`WeightChart` is the app's first line chart, and the three rules that make it
honest are each a choice against an easier drawing:

- **The y-domain never starts at zero** (`weightDomain`). The four bar charts
  elsewhere plot counts, where zero is real and a bar's length is the quantity.
  A body sits in a narrow band a long way from zero, so a zero-based drawing is
  180 identical columns. The domain is windowed to the data and floored at a
  2kg span, so 200g of ordinary variation is drawn as a nearly flat line rather
  than as a mountain range.
- **The line breaks across gaps over a fortnight** (`weightSegments`). Somebody
  who stopped weighing in over the summer did not glide between the two figures
  either side, and a straight line across the gap asserts every day nobody
  measured. Weekly weigh-ins still join, because joining two readings a week
  apart is a fair drawing of them.
- **Every reading is a dot**, so the chart shows how much of itself is data and
  how much is interpolation — the duty `MoodScreen`'s "a flat line is a day with
  nothing logged" caption discharges for its own gaps.

It is one accessibility element with a spoken summary, not one per reading:
365 of those is a wall to swipe through rather than a chart to read.

**A second, fainter line is a 7-day trailing average** (`weightTrendPoints`),
drawn dotless underneath the raw one so it reads as background shape rather
than a second set of measurements. It breaks at the same gaps the raw line
does (`weightTrendSegments`, sharing `groupByGap` with `weightSegments` so the
two cannot silently disagree), and it is one point per actual reading rather
than one per calendar day — a day with no weigh-in has nothing to average and
does not get one invented for it. This does not reopen the "nothing here
interprets a body" line: it is arithmetic over the same dots already on
screen, no slope is fitted, and nothing is said about direction.

**The screen reads once and lets the chart re-zoom for free.** `useHealthStore`
fetches `WEIGHT_HISTORY_DAYS` (365, under the native 400-day ceiling) in one
query; `WeightScreen`'s four-way range picker (1M/3M/6M/1Y, a closed set and so
`SegmentedControl` rather than a `PillGroup`) just slices the array already in
memory, so switching ranges costs nothing further from Health. "Latest" always
reads the true most-recent weigh-in regardless of which range is selected —
that is what "latest" means — while the chart, the change figure and the
weigh-in count all scope to whichever range is currently zoomed to.

### The task that asks for one

`weighIn` (`src/utils/weightTasks.ts`) is the generator that writes "Record
your weight" when Health has had nothing for a while. It is written up in
`docs/arch/generated-tasks.md`; two things about it belong here rather than
there.

**It reads whether a weight exists, never what it was.** That is the same
fence this file draws everywhere else, applied to the one part of the feature
that could most easily cross it. The app may notice you have not recorded a
number, which is a fact about your logging and one you can check. It may not
notice that the number went up, which is a fact about your body and is exactly
the kind of claim that kept weight off the read list for years.

**It is deliberately not a `health` rule.** Everything in the rules half of
this file is about a reading crossing a threshold somebody wrote down.
`weighIn` fires on the absence of a reading, so it needs no threshold, has
nothing to compare, and cannot be wrong about a body. Adding it as one more
`HealthRuleMetric` would have been the obvious shape and would have
put it back on the wrong side of the line: a rule metric is a thing the app
judges, and there is no judgement here.

## Blood pressure: written as one reading, read back as readings

The weight section's rules hold unchanged (Health is the record, no local copy,
no edit or delete, a typed number that is already true). Where blood pressure
differs:

- **One reading is two samples in a correlation.** HealthKit has a systolic type
  and a diastolic type, and the Health app files a reading as an `HKCorrelation`
  of type `.bloodPressure` holding both. `writeBloodPressureSample` does the
  same, so it shows up there as one reading rather than two loose numbers. Share
  authorization is per component type, so the write kind `'bloodPressure'` is
  the weaker of the two, like `'nutrition'`.
- **The bounds are an absurdity check, and a pair is refused if the bottom
  number is not lower than the top** (`isPlausibleReading`). The native write
  applies the same rule, so a caller that skipped the JS check cannot get past
  the bridge.
- **The read returns readings, not days.** Several a day is the normal way to
  take them, and averaging a morning against an evening would hide what the
  person is measuring. `readBloodPressureSeries` is an `HKSampleQuery` over the
  correlation type, with whole mmHg as integers on the wire, parsed by
  `parseBloodPressureReadings` (which drops a malformed or implausible entry
  rather than showing it).
- **Nothing here interprets a body, and this is the number most tempting to
  interpret.** There is no "normal", "elevated" or "high", no colour on a
  figure, no category, no goal, no rule metric and no generated task. Public
  guidelines would make a band easy to draw, and drawing one is the app forming
  an opinion about somebody's body, which is the line weight was allowed across
  only by not crossing. The screen shows the latest reading, the count and
  mean over a range, and the readings. If one of those ever grows a verdict,
  this note is the thing to read first.
- **Pulse is optional, a separate sample, and attached by instant only.** It is
  a `heartRate` sample at the reading's instant, saved *after* the correlation
  so refusing heart rate never costs the reading. The write answers
  `saved`, `pulseRefused` or `failed`, and the sheet says when only the pulse
  was refused. Heart rate is in the share set but not in the `'bloodPressure'`
  status kind, so a refused pulse never makes the blood pressure row read as
  refused. On the read side a pulse is attached to a reading only when a heart
  rate was recorded at exactly the same start instant; a Watch heart rate a
  minute earlier is a different measurement and is never shown as the reading's
  pulse. The workout card's heart rate rules (read for a workout, never
  interpreted) are unchanged.
- **The chart draws what the weight chart draws, and no more.** Two lines (top
  and bottom number) and a dot per reading on a time axis, an axis that never
  starts at zero, and a break across a gap over two weeks (`readingSegments`).
  There are no bands, zones or colours that rate a value, and no scrub: the
  list under it carries each exact reading.

## The third write: a logged meal

The one that closes the loop. The app read nutrients for the `health`
generator long before it wrote any, so the figures its own
rules judge could only ever have come from another app. A food log makes this
app the one entering them.

**It is licensed by the read argument, the same one body mass used.** The
section below on what is deliberately not built spells it out for the
nutrients: a dietary figure "exists at all only because a person (or their own
food-logging app) entered it, and the threshold it is judged against is a
number *they* typed". Writing is the other half of that sentence. The person is
entering the figure either way; today they enter it in another app, which
writes it to Health, which this app reads back. Nothing about the nature of the
fact changes when the app recording it changes. What changes is the failure
mode, and everything below is about that.

### Every nutrient is a write type, and five are written and never read

`writeTypes` is `nutrientWriteTable` (one entry per `NutrientKey`) plus body
mass. The nutrients are one capability rather than one decision each, and were
argued for together; calcium, iron and potassium (#2430) were their own review,
below.

**Five of them are written and never read.** Carbohydrate, total fat
and the three minerals are not in `readTypes`, no `HealthRuleMetric` watches
them, and no screen shows them. They are written anyway, and that is a decision made out loud rather than
by whatever the write loop happened to iterate over: the consumer is not this
app. A meal that reaches the Health app with no carbohydrate line reads as
incomplete rather than as deliberate, and every other app reading that record
expects the macros together. "Write only what you read" would be a tidier rule
and a worse one, because it would make this app's own gaps into gaps in
somebody's health record.

The mapping lives in one place, `nutrientWriteTable` in the Swift module, keyed
by `NutrientKey` so a figure crosses the bridge under the same name it has on
both sides. **No conversion happens on either side of that bridge.**
`nutritionParse.ts` already did the unit arithmetic once, and a second opinion
about units in a second language is how a sodium figure lands a thousand times
too high.

### The three minerals, and the twenty-odd that aren't here

#2430 asked whether the rest of a micronutrient panel could join them, and the
answer is a measurement rather than a preference. 200 US products from Open
Food Facts, counted per nutrient: coverage tracks US label law, not nutrition.
The four minerals and vitamins the FDA has mandated on a panel since 2016 carry
a figure on most products; everything outside that list falls off a cliff.
Vitamin B12 is stated on 8% of products, folate on 4%, magnesium on 10% — and
those are precisely the nutrients somebody tracking for a medical reason came
for. A full panel over this data would be a screen of blanks, occasionally
populated with a wrong zero: vitamin K and choline were *present* on 27% and
66% of the sample with **no non-zero value on any product at all**, choline
included on mayonnaise. So the panel is three minerals rather than twenty-odd,
and that is the source's limit rather than a staged rollout.

**Vitamin D is the fourth mandatory one and is deliberately not here.** It is
present on 57% and above zero on 16%, so most of its zeros are bulk defaults
and a few are readings, with nothing in the field to tell them apart. It cannot
take `OFF_UNINFORMATIVE_ZERO`'s treatment either: that rule earns its refusal
by a field having never once carried a real value, which is what makes dropping
every zero safe, and vitamin D's 16% breaks exactly that. Writing a figure that
is wrong-zero five times in six into a medical record is the failure this
document exists about, so the nutrient waits for a source that states it.

**They cost three write types and no read types.** A read type is the expensive
one: it widens the permission sheet for a feature nobody asked for, and this
app never re-prompts, so a sheet is a thing you get one shot at. Nothing here
watches calcium, so nothing reads it.

**An existing install has to be asked again, and the design already handles
it.** Three types nobody was ever asked about drop
`writeAuthorizationStatus("nutrition")` to `notDetermined`, because it reports
the weakest answer across the set — so the Health settings row goes from
"Allowed" back to un-asked and offers the ask, which is the only way a re-ask
can happen given that nothing raises the sheet by itself.

**One refusal was added with them.** `writeFoodSamples` now skips any type the
app is not authorized to share, rather than putting it in the correlation. A
meal is saved as one `HKCorrelation`, so if an unauthorized member fails the
save it plausibly fails all of it — meaning three newly-added types could have
stopped an existing install recording meals at all, silently. Whether HealthKit
rejects such a correlation outright or drops the member is not documented and
could not be verified, and the filter is correct either way: under the first
reading it is the difference between a partial meal and no meal, and under the
second it changes nothing.

### The vitamins and minerals that did get in, and why the data limit stopped mattering

Twenty-three more keys joined later (`MicronutrientKey`: vitamins A, C, D, E, K,
the B vitamins, biotin, magnesium, zinc, phosphorus, selenium, copper,
manganese, chromium, molybdenum, iodine and chloride), each with an Apple Health
dietary type (checked against Apple's `HKQuantityTypeIdentifier` page, not
assumed). Nothing above is reversed. What changed is who supplies the figure.
The measurement was about what a *barcode source* states, and the answer
stands: `nutritionParse.ts` maps none of them, so a scanned or searched food
never claims a magnesium figure and vitamin D's bulk-default zeros still never
reach a record. A supplement's panel is typed once by someone holding the
bottle, and that is a different claim from a source's default.

**Only a typed or photographed panel states them.** `EXTERNAL_NUTRIENT_KEYS`
(every key except these) is what a barcode source and a model's estimate are
asked for. A model asked to estimate a restaurant meal's selenium would give a
confident number with nothing behind it, and that number would be written to
somebody's medical record, so the request never names them and a reply that
does is read past (`log_food` over MCP reports one as ignored).

**A photographed label is the exception, and reads `PRINTED_NUTRIENT_KEYS`.** A
photo is a transcription of print, not an estimate and not a source's default,
and the figures land in the form for the person to check against the bottle
before saving. Two rules keep it honest (`labelOcr.ts`): a figure printed in IU
is never a figure (the factor differs per vitamin, and read without its unit it
would land 40 times too high), and "Vitamin B-6" is glued to its digit before
the value reader runs, or the 6 is read as the row's amount.

**Where the figures come from is `MedicationPrefs.nutrition`**, a
`SupplementPanel` kept with a medication's other settings and entered on its
page (`SupplementPanelSheet`). Each dose of that medication writes one food log
entry (`supplementDose.ts`), which is why they reach the day's totals, targets
and this write with no second mechanism. The entry is linked to its dose by
`FoodNutrition.sourceId` (`dose:<id>`), counts as `isNutrientOnlyEntry` (not a
meal, never a reason another nutrient's figure is judged incomplete), and is a
snapshot: changing the panel later does not rewrite what past doses added.
`useMedicationStore` reaches the food log only through `DoseEffects`, because
the MCP server loads that store and cannot load the food log store; the app
installs its version at launch and the replica installs one that writes the row
flagged `healthWritePending`.

**An existing install is asked again, as for cholesterol and the minerals.** The
23 new share types are undetermined, so `writeAuthorizationStatus("nutrition")`
drops to `notDetermined` and the row offers the ask. Until it is answered,
`writeFoodSamples` skips the types that are not authorized and a dose's other
figures are still written. **An install that has explicitly chosen its
"Nutrients written per meal" list does not get the new ones added to it**: the
default is every writable nutrient, but a stored list is a choice and stays one.

### Absent stays absent, and here it matters most

A nutrient the entry does not state is not written. This is the same rule
`FoodNutrition.amounts` states and the whole nutrition tree is built on, at the
point where it costs the most to break: writing a zero would put into somebody's
medical record a claim that a meal contained none of something nobody measured.
Health has no way to record "unknown" other than by the sample's absence, so
absence is the recording.

A figure that is *present* and zero is written, because a label stating no fat
is a real statement. The filter is `writableFoodAmounts`
(`healthFoodSync.ts`), which is pure and tested for exactly this reason — the
rest of that file is a native call nothing can test.

### Alcohol is grams in the log, a drink count in Health, and not in the correlation

`NutrientKey` holds `alcoholG`, grams of pure ethanol, because it is the one figure every source can state
(a database row, a model's estimate, a label's ABV and volume turned into grams by `nutritionParse.ts`).
Everything a person reads is drinks (`src/utils/alcohol.ts`), at the size they chose in Settings.

Health has no mass of alcohol. Its type is `numberOfAlcoholicBeverages`, a cumulative count of standard
drinks (iOS 15+, `HKUnit.count()`, read off Apple's page for it), so the write converts:

- **The count is always in US drinks (14 g), whatever size the app displays.** The Health type is "standard
  drinks" as Apple defines one and has no way to carry a size, so `healthDrinkCount` ignores the setting.
- **It is saved as a sample of its own, not as a member of the meal's correlation.** Apple's pages for the food
  correlation do not say whether it accepts a non-dietary type, and a rejected member would cost the whole meal.
  This was written without a device to run it on, so it is the first thing to check if a logged drink never
  shows up in Health. A refusal here costs the drink count and never the meal. Its id rides in the same
  `healthSampleIds` list, which is what lets the retract and the correct-and-rewrite paths remove it.
- **Zero is never written.** A model answers zero for every non-alcoholic food, and a zero-drink sample on a
  sandwich is a false statement in a health record. `stripZeroAlcohol` drops it from an estimate and
  `writableFoodAmounts` refuses it again at the write.
- **It is not offered to a task.** A task's "log to Health" picker writes through `writeNutrientSample`, whose
  table has no alcohol row, so the picker leaves it out rather than offer a write that would be dropped.

### Which nutrients may be written is a second, separate choice

Whether a meal may write *anything* is `healthWriteEnabled`. Which nutrients
it may carry along is `healthWriteNutrients` (`useSettingsStore`,
parsed by `parseHealthWriteNutrients` in `nutritionTargets.ts`, alongside the
Food log's own pinned-nutrient selection it's modelled on) — a person managing
sodium for blood pressure may want that written and calcium left out, or the
reverse, and the two switches this file already has answer neither question.

**Defaults to every nutrient, so an install that predates the choice keeps
writing exactly what it always did.** A stored empty array is a real, distinct
choice — "write nothing a meal states" — the same distinction
`parseFoodLogPinnedNutrients` draws for the card above the fold, and
`parseHealthWriteNutrients` only falls back to the default when the setting
was never written at all.

**The filter runs in `logFoodEntryToHealth`, not in `writableFoodAmounts`.**
That keeps the pure, tested absent-is-not-zero rule about the entry alone, and
lets a person's own choice sit beside it rather than inside it — the same
separation of concerns the rest of this file draws between what a reading may
claim and what a write may do. An entry whose every stated figure is excluded
reports `nothingToWrite`, the same outcome as an entry with nothing to write
in the first place; either way, nothing reached Health.

**It has no bearing on the other two writes.** A task naming
`Task.logHealthMetric` already picks one nutrient explicitly when it's set up,
so there is nothing left to opt out of; a recorded weight isn't a nutrient at
all.

### Sample identity, which is the actual work

This is the first thing in the app that can un-write, and the reason this was
not a small change.

`writeNutrientSample` and `writeBodyMassSample` each build one sample, save it,
return a bool and keep nothing. That is right for both: Health is the record,
and neither a task's logged amount nor a recorded weight has an edit path here. A food
log cannot work that way. An entry is logged in a hurry against a picker, and a
mistyped one that could not be retracted would be a permanent false fact in a
medical record, survivable only by manual deletion nobody would know to go
looking for. So:

- **`writeFoodSamples` returns the UUIDs of what it saved**, as JSON, and they
  are stored on `FoodLogEntry.healthSampleIds`. That column has been on the
  schema since the food log shipped, empty on every row, waiting for this.
- **`deleteHealthSamples` takes them back.** HealthKit only lets an app delete
  what it itself saved, which is what makes exposing a delete safe at all: no
  argument to it can reach a sample somebody's scale or another food app wrote.
- **The correlation's own UUID is stored alongside its members'.** Deleting the
  correlation is what retracts the meal; the members are carried so a partial
  save still leaves something to clean up.
- **A nutrient type still `notDetermined` is skipped, and the correlation type
  never is.** Deleting from a type the app was never asked to share fails, so an
  install that allowed nutrition before a type joined the table would report
  every retraction as failed. The food correlation is never a share type (an
  app shares a correlation's members), so it reads `notDetermined` everywhere;
  filtered with the rest, no meal's correlation would ever be deleted and Health
  would keep empty meals. It is added after the filter, unconditionally.
- **The delete tallies its results on a serial queue.** One delete per type
  reports back on arbitrary background queues, and getting the count wrong means
  telling the app a retraction succeeded when it did not, leaving a sample in a
  medical record.

  `readDailyHealth`'s own fan-out (a query per metric) counts down on the
  same kind of queue. Nothing documents that HealthKit delivers those callbacks
  serially, and the failure a bare counter invites is silent in both
  directions: a lost decrement leaves the promise unresolved for ever, which
  reads as Health simply never answering, and a doubled one resolves it twice.
  The queue also supplies the memory ordering the final block needs to see
  arrays written on other threads.

### A correlation, not loose samples

A meal is one thing. `HKCorrelation` of type `.food` is the API for that, and
it is what makes an entry appear in the Health app as "Chicken burrito" (via
`HKMetadataKeyFoodType`) rather than as a dozen unrelated numbers at 12:47.

**Every symbol here was checked against Apple's SDK headers and real compiling
Swift**, not a recollection (`HKCorrelation(type:start:end:objects:)`,
`correlationType(forIdentifier:)` being nullable, `deleteObjects(of:predicate:withCompletion:)`).
A change here follows CLAUDE.md's "Verify an unfamiliar API" rule: Apple's
documentation JSON first, then the headers.

### The rules it inherits unchanged

- **`healthWriteEnabled` gates it**, the existing switch, separate from
  `healthReadEnabled`. Somebody who turned on step reading must not find a
  nutrition sharing sheet in front of them.
- **Demo mode refuses twice**, in `healthBridge()` and again at the top of
  `logFoodEntryToHealth`. Same reasoning as the nutrient write's, and a
  seeded food log entry may exist for the same reason a demo task may carry
  `logHealthMetric`: the gate stops the write, not the demonstration that the
  feature exists.
- **Two triggers, both a person editing one entry.** `addEntry` in
  `useFoodLogStore` writes a new entry, and `reviseEntry` (see "Correcting an
  entry" below) rewrites one whose label or figures a person just corrected.
  Those are the only callers of `logFoodEntryToHealth`, and nothing else may
  become one, with one more caller for a meal an agent logged (below). No
  reconciler, no sweep, and **no backfill pass over history**: entries logged
  before this shipped keep their empty `healthSampleIds` unless somebody corrects
  one of them.

  **The exception is a meal logged over MCP** (`FoodLogEntry.healthWritePending`).
  The MCP server has no HealthKit, so a meal the person asked an agent to log
  would otherwise never reach Health. The server flags the row and the phone
  writes it (`writePendingHealthEntries`, run at launch, on foreground and after
  a sync that applied rows, never while backgrounded). It is the same trigger as
  a typed meal, a person asking for it to be logged, with the write delayed, and
  the flag is what keeps it from being the history pass: only flagged rows are
  read, a flag older than `PENDING_WRITE_MAX_AGE_DAYS` is cleared without a
  write, and the flag is cleared on a write (`recordHealthWrite`). With the
  switch off the entry stays flagged until the age limit, so turning writing on
  the same week sends it and turning it on next month does not.

  That exception is what `reviseEntry` does today, and it is worth stating
  rather than leaving to be rediscovered. When a correction changes the label
  or a figure, it retracts whatever samples the entry had (ungated, like every
  retraction) and then calls `logFoodEntryToHealth` for the corrected entry,
  which applies the same gates a new entry gets. So with `healthWriteEnabled`
  on, correcting an entry that never had samples (logged while the switch was
  off, or before this shipped) writes that one entry for the first time. With
  the switch off, the correction retracts the entry's old samples and the
  write returns `off`, so the meal leaves Health until it is logged again. The
  water stepper goes through `reviseEntry` too, so the same holds for a day's
  water entry. It is one entry at a time, on a person's own edit, which is why
  it is not the history pass the rule above refuses: that pass would put
  samples in a medical record for meals nobody asked to share, and would
  duplicate whatever the person had already logged elsewhere.
- **The sample is dated `atISO`, not `dayKey`.** HealthKit buckets by wall
  clock; the logical day is this app's own idea. The two are allowed to
  disagree and `FoodLogEntry.atISO` says so at length.

### Two asymmetries worth not smoothing out

**The retraction is not gated on `healthWriteEnabled`.** Every other guard
refuses to create something; this one removes something already created.
Somebody who has since turned the switch off has, if anything, asked more
clearly for their samples to go, and refusing to retract on those grounds would
strand exactly the record the switch was turned off over.

**The write is fired and forgotten; the delete reads from the database.**
`addEntry` is synchronous because every caller uses the entry it returns to
close a sheet, so the write runs after and patches the row when it lands. Both
halves deliberately bypass the loaded range: `updateEntry` only finds rows
inside the window on screen, and a meal backdated outside it is an ordinary
case, so the write patches through `dbUpdateFoodLogEntry` directly and the
delete reads the row back with `dbGetFoodLogEntry`. Finding a row only when it
happens to be loaded would strand its samples.

### A refused write is the one outcome worth saying out loud

`FoodWriteResult` has five arms and `addEntry` acted on one of them for a while,
which made the most important failure completely silent (#2516). The entry saves
either way, which is right, so a refusal leaves no trace at all: the only
evidence is a meal that never turns up in Health. Somebody who switched
`healthWriteEnabled` on and never granted sharing in Health's own sheet loses
every meal and is told nothing.

`refused` now raises a notice (`HealthWriteRefusedNotice`, mounted in
AppNavigator beside `LogMealPrompt` because a meal is logged from four different
places). Three rules hold it in place:

- **Once, not per meal.** The failure is ongoing and identical every time, so a
  notice per meal is a nag about something already said. `healthFoodWriteRefusalSeen`
  is what records it, and it is bookkeeping rather than a preference, which is
  why no screen offers it.
- **A write that lands clears it.** That is what stops "once" from meaning
  "never again": a breakage starting six months later gets its own notice
  instead of being swallowed by having complained then.
- **The other three arms stay silent, deliberately.** `off` is the switch doing
  what it says, `unavailable` is a device with no Health at all (or demo mode),
  and `nothingToWrite` is an entry stating no figure, which is an ordinary thing
  to log. None of them is a fault, and reporting them would train the notice to
  be ignored before it ever carried the one that matters.

**Settings was already telling the truth and it was not enough.** The
nutrition-write access row reports the real authorization status, because write
authorization *is* observable where read authorization is not. But it only helps
somebody who already suspects something, and the person this fails is precisely
the one with no reason to look.

### Correcting an entry, and the obligation that came with it

The food log used to add and delete only, so a mistyped portion meant forgetting
the entry and walking back through the picker. It edits now (#2514), and the
rule this section carried for a year is what the edit is built around:
`updateEntry` stays deliberately dumb — it is what the write above calls back
into to store the ids, so a retract-and-rewrite there would chase its own tail —
and **a correction reaching `nutrition` or `label` goes through `reviseEntry`,
which retracts the old samples and writes new ones**, in that order, rather than
patching the row and leaving Health stating the meal as first typed.

Four things hold it in place, and each is a way the edit could have written
something nobody measured:

- **The amount is re-measured, never multiplied.** What an entry stores is one
  helping: `basis` is always `perServing`, the amounts are what was eaten, and
  `portions` was emptied when the helping was built. So "make it 2 cups instead
  of 1" has no arithmetic available to it, and correcting an amount means
  running `scalePanelToAmount` over the food's own panel again. That panel is
  reachable through the entry's links, or through the one panel an entry keeps
  for itself (below), which is what `foodLogEntryEdit` decides on.

  **One exception: more or less of an estimate** (`estimateAmountPatch`,
  #2914). A described meal has no panel, and "I actually ate 3 slices" needs
  none: every figure is one the model already stated, times a number the
  person chose, so nothing is measured and no nutrient appears that the
  estimate did not state. That is the test the rule exists for, and it allows
  **any multiple of the whole as estimated, chosen by the person**, up as well
  as down.

  Scaling up is acceptable here and still not for a measured panel because of
  what the figures are. A measured helping's figures are one amount's worth of
  a food whose real panel is right there to measure a new amount against;
  multiplying them instead claims a measurement of the new amount that nobody
  made, and compounds the old helping's rounding, when a true answer was
  available. An estimate has no panel behind it and was never a measurement.
  It is the model's guess at a meal of a stated size, so 3 slices of a meal
  estimated as 2 is that same guess at a meal half as big again, and it claims
  no more precision than the whole did. Going up claims nothing more than going
  down, so the cap (`MAX_ESTIMATE_MULTIPLE`, ten times the whole) is there for
  a mistyped count, not for honesty.

  **It is asked in the estimate's own unit when its words give one.**
  `estimateCount` reads "2 slices" as two of one thing, so the question is
  "How many slices" and the answer scales the whole by new over old, logged as
  "3 slices". A number that counts only part of the meal ("1 burger and a
  regular fries") is not a count of it, since doubling it would double the
  fries unsaid, so words like those get a closed set instead: the shares (a
  quarter up to three-quarters), all of it, and one and a half, two and three
  times it. An estimate is not made more exact by a finer number, and the
  source stays `estimated`. **Every change is of the whole meal as estimated,
  never of the last one**: the first keeps the whole in `sourcePanel` (as a
  panel whose own source is `estimated`, which is what keeps it out of the
  editor) and every later choice is taken from that. Taking it of the stored
  helping each time was the literal reading, and it would have thrown the
  model's own figures away on the first mistaken tap, with only a division by
  rounded numbers to get them back. With the whole kept, the original count
  (or All) puts the entry back exactly as it was logged. It goes through
  `reviseEntry` like any other correction of the figures.
- **An entry with no link is not offered the editor, only a rename (and, for
  an estimate, the change of amount above), unless it kept its panel.** A described meal
  the model estimated has no panel to measure against. Offering its figures as fields to retype was the obvious
  alternative and is the one thing this must not do: a hand-typed panel going
  into a medical record is exactly the unmeasured claim the rest of this
  document refuses. Renaming is carved out because it claims nothing about how
  much was eaten — it changes the row's own words and the name its sample
  carries, which is why it still goes through `reviseEntry` rather than
  `updateEntry`.

  **The exception is a database food nobody filed, which keeps the panel it
  was measured against** (`FoodLogEntry.sourcePanel`, #2914). Search a whole
  food, weigh it, log it and skip filing is the ordinary macro-tracker path,
  and it used to end on an entry whose only correction was a delete and a
  fresh search (which needs a key and signal). The panel it keeps is the
  database's own per-100 g record with its portions, snapshotted at log time
  on the same rule as `nutrition`, so the sheet rebuilds the candidate it was
  logged from and re-measures a corrected amount exactly as it would for a
  catalog row. Nothing is typed and nothing is guessed, which is the whole
  test the refusal above applies. It is written only for an unfiled database
  food, since a linked entry's row already holds its panel, and a correction
  that re-measures against a row or picks another food clears it. Entries
  logged before the column existed kept nothing and stay rename-only.

  **Every route that logs the same food again carries the panel with it**, or
  the copy is back to rename-only: Duplicate, Re-date, "Log the same again",
  the Describe sheet's "had this before" recall, and a saved meal, whose
  items keep the panel their entries kept (`SavedMealItem.sourcePanel`,
  inside the `items` blob, so sync and backups carry it as they are). At the
  same amount the copy takes it verbatim, an estimate's whole included, so
  the copy is the same amount of the same meal. A recall logged at a new weight is re-measured
  against it rather than multiplied out of the stored helping
  (`recalledHelping` in `foodRecall.ts`), and keeps it, since that is what the
  new helping was measured against. An estimate's whole is never measured
  against: `keptDatabasePanel` is the one test every measuring path uses to
  tell the two kinds of kept panel apart.

  **A recalled estimate is asked the way "Change amount" asks, never for a
  weight** (`recallAmountAsk`). Its words' own count ("Amount to log 3
  slices", opened on the count last logged) or, with no count, the same
  closed set of shares and multiples, scaled off the whole it kept (or its
  helping, when it kept none) by `estimateAmountPatch`, and the new entry
  keeps that whole so it can be changed again. It used to show a grams field
  that an estimate of "2 slices" had nothing to measure against, so 110 typed
  there logged the whole previous helping with the field still reading 110.
  The same rule holds for every other food on the card: **no field whose
  value would be ignored.** A weight field appears only where the panel can
  be weighed (`measuresByWeight`), a food that can't be shows what it will
  log and why, and a weight that still can't be used is said in the card
  rather than swapped for the recorded helping.
- **A linked entry can also correct the food's own facts** (`handleSaveFacts` in
  `FoodLogEntrySheet`). A mistyped label (16,000 mg of sodium for 160) lives on
  the row or box the scan wrote and was copied into the entry, so fixing only
  the entry leaves the next scan wrong. "Edit nutrition facts" opens the label
  panel on that row (`panelItemId`/`productId`, never a database food nobody
  filed), and the amount is then re-measured against the corrected panel and
  saved through `reviseEntry`. Other entries already logged from the row keep
  the figures they were written with.
- **The rewrite is skipped when nothing Health holds changed.** Moving the meal
  or re-filing the item touches no figure Health ever saw, and rewriting anyway
  would churn somebody's medical record for a field it never got.
- **A failed retract does not cancel the write.** The stale sample stays in
  Health, exactly as it does when a delete's retract fails, and is something the
  person can remove there. Skipping the write over it would leave Health holding
  only the figures that were just corrected, which is the worse of the two.

`atISO` and `dayKey` stay unpatchable on both paths. They were stamped together
from one instant under one reset time, and re-dating means a new entry.

**Picking a food logged before opens on the amount it was last logged in, and
that amount is read and measured exactly as a correction's is** (#2915).
`foodLastAmounts` (`foodLogRecents.ts`) reads each row's latest entry through
`foodLogEntryEdit`, and `recallAmount` (`foodLog.ts`) runs it through
`scalePanelToAmount` against the panel the food has *now*. An amount the food
can no longer measure (a portion row that has gone, a dish nobody has weighed
since) opens on the sheet's ordinary default rather than on a refusal, and
Save measures a recalled amount like anything typed. It is the entry's own row
that remembers, never the item behind a box: "1 container" is a portion of one
pot's panel and may mean nothing to the generic row's.

A scanned card (`ScanPortionSheet`) opens on its last amount by the same two
functions, keyed on the product the scan resolved to, else its item. "Same as
yesterday" in the add sheet logs yesterday's helpings at that meal as they were
(`sameMealYesterday`, `helpingAgain`), each through the sheet's own `logNew` so
each finds its planned meal and writes to Health like a single log.

### Water is the food log's, not a third write

Water had a target and no way to fill it (#2515): a full `NutrientKey` with a
unit, a range, a targets-sheet row, a parser arm and a rule here, and nothing in
the app that could log a glass. The day view has a stepper for it now, and what
it writes is an **ordinary food log entry** — `waterHelping` builds the helping,
`addEntry` stores it, and `logFoodEntryToHealth` is what puts it in Health,
under every guard a meal gets and with the same sample ids to retract by. The
bridge already mapped `waterMl` onto `.dietaryWater` in the same
`writeFoodSamples` call, so none of this is new native ground.

Three things about it are worth not re-deriving:

- **A task that logs a nutrient rides this same write rather than getting a
  second one of its own.** This shipped as two mechanisms for one fact (a task
  recording a nutrient when it is ticked, and somebody saying what they
  drank), kept apart on the reasoning that folding the task side in would make
  a caffeine task a meal. That broke on a real report: a "Drink water" task
  logged to Health on every completion and never showed up in the food log a
  person looks at. The same applies to sodium: a task logging it to Health but
  not to the food log left the day's sodium total, its target and the mood
  insights blind to it. So `logTaskHealthValue`
  (`src/utils/healthCompletionSync.ts`) now sends **every** nutrient through
  the food log, and the "a caffeine task becomes a meal" worry is answered by
  `nutrientLog.ts`: the entry is unslotted, states one nutrient, wears that
  nutrient's own name ("Sodium"), and every reader that cares what a meal is
  (`nutritionCounts`, the averages' completeness bar, the most-logged board,
  `foodDayInputs`, `countsAsMealLog`, the recents) skips it through
  `isNutrientOnlyEntry`. Its figure still counts toward that nutrient's day
  total. It accumulates onto one entry per nutrient per day, like water, so
  four caffeine completions are one row, and undoing a quota tap takes the unit
  back. **The name is part of the test on purpose**: a restaurant estimate of
  "600 calories" also states exactly one nutrient and is a food. Water is
  still recognized by what it states alone. Health is still written in one
  place (`logFoodEntryToHealth`), which means a nutrient excluded in
  `healthWriteNutrients` lands in the food log but not in Health, and
  `writeNutrientSample` is no longer called by anything a task does. Only
  water has the log-to-task direction (`syncWaterQuotaTasks`); other nutrients
  aren't a count of identical units a day's log could finish.
- **One entry a day, stepped, rather than one per glass.** Eight glasses is
  eight rows in the meal sections the day view exists to show. What that costs
  is that the Health sample is dated at the first glass and carries the day's
  volume, where Apple's own Health app records each one at its own moment: a
  fact about *when*, not about how much.
- **Every step goes through `reviseEntry`, so the running total is settled
  before it is written.** A held stepper key walks a step every 40ms, and
  committing each one would fire a retract and a write per step, each retracting
  ids the previous write had not finished stamping back. The day view holds the
  pending figure for 600ms and lands it once.

- **A task can follow the target this card shows.** `Task.followWaterTarget` makes
  a daily water task's count the effective target (`effectiveWaterTargetMl`, so
  the exercise boost included) over its per-unit amount, written by
  `syncWaterQuotaTasks`. Display-time stays display-time: nothing here writes
  `nutritionTargets.waterMl`, and an exercise reading that has not arrived leaves
  the count alone rather than reading as "no exercise". What is owed after the
  task was already finished is the `waterShortfall` generator, in
  `docs/arch/generated-tasks.md`.
- **The water row names no source.** Its `manual` source only records that no
  label or database was asked, and "typed in" read as a claim about how the row
  got there when a task, the stepper or a bottle all write into it
  (`describeFoodLogEntry`).

`waterUnit` in settings decides whether the two water steppers — the card and a
task's "log to Health" amount — show millilitres or fluid ounces. It is display
only, exactly as `weightUnit` is against what HealthKit hands back: `waterMl` is
stored in millilitres whichever is picked, and the conversion happens at the one
call site rather than anywhere downstream. It is a setting rather than the local
state `TaskEditor` used to hold, because two local copies of one preference are
two answers to the same question and the card is pressed several times a day.
Ounces step by 8, which is the glass the unit is counted in: the millilitre step
converted would be 8.45 and would put a decimal on every figure on the card.

### One thing about the read side worth writing down here

`bestSum` takes **the largest single source, not the sum** of them. Two apps
can both record the same real meal, and HealthKit does not de-duplicate for a
statistics query, so summing double-counts whoever is running two food loggers.
Taking the largest under-counts instead, which is the error to prefer: it never
claims more than some one source actually recorded.

The consequence is worth knowing before it is rediscovered: **somebody
migrating onto this app from another one under-reports for as long as the
migration is partial.** Log half of Tuesday here and half in Cronometer and
Tuesday reads as whichever half was larger, not as the day. That is the safe
direction and it is not an obvious one.

### A task that names its food writes the entry, and takes it back

`Task.logSavedMealId` points a task's "Log to food log" row at one of the person's saved meals, and
completing the task then logs that meal straight away (`completeTask` in `useTaskStore.ts`, through
`useSavedMealsStore.logMeal`), with no sheet. That is the one place a task writes the food log
unattended by a prompt, and it is allowed because the saved meal already is the food and the amount:
nothing is guessed, which is the reason the plain `logMealSlot` row only ever offers.

Two rules keep it honest. **Each entry carries `FoodLogEntry.taskId`**, and un-completing the task
removes them (`removeEntriesForTask`, which retracts any Health samples the way a delete does), the
same shape as `MedicationLog.taskId`. A task ticked by mistake means the food was not eaten, and a
phantom entry would corrupt the day's totals. And **a missed completion logs nothing**, nor does a
saved meal that has since been deleted: that case falls back to the manual offer, so the tick is
never a silent no-op. Deleting the task leaves its entries, since the food was eaten.

### A photo of the plate is a description in another form

"Photograph your meal" on the add sheet sends a photo to the same
`estimateMealNutrition` call as a typed description, on the same switch
(`nutritionEstimate`), into the same panel. Everything above holds unchanged:
the model proposes, the panel's Log is the confirmation, and the result is
`source: 'estimated'` for good. Three things are particular to it:

- **The photo rides every ask.** An answer or a typed amount re-asks with the
  photo attached, so a refinement is about the meal in the photo and not a
  description of it. Words typed beside it outrank it about what the food is.
- **The portion is the weakest claim, so it is said.** `describeEstimate` adds
  "The portion is judged from your photo." after the basis and confidence, and
  `grams` stays null like any estimate.
- **It can't be saved for later.** The queue below holds a description, and
  keeping the words without the photo would quietly be a different meal, so the
  offer isn't made for a photo (`EstimatePanel`'s `photo`).

### A meal described with no signal waits as a description, never as an entry

`utils/estimateQueue.ts`, `usePendingEstimateStore`, `PendingEstimatesCard`. When
the estimate request fails for a reason waiting can fix (no connection, a
timeout, a rate limit, a 5xx), the panel offers **Save for later**. The meal is
kept, and asked about again each time the app comes to the front.

- **The queue holds descriptions and the estimates that come back for them,
  never a food log entry.** The estimate rule above (a figure exists because a
  person confirmed it) is why: a queued meal that logged itself when the signal
  returned would be an estimate stored unconfirmed. So a drain only moves a meal
  from *waiting* to *ready*, and Log on the Food log screen's card is the
  confirmation. Until then it is in no day's totals and nothing reaches Health.
- **It keeps when the meal was eaten.** `atISO` is the moment being logged for,
  so confirming at bedtime still files it under lunch, and `log` passes it to
  `addEntry` as `at`.
- **Only a failure waiting can fix is queued** (`isQueueableFailure`, which
  mirrors `describeAIError`'s order). A rejected key (401), a missing key, a
  switched-off feature, demo mode, any other 4xx and an unreadable description
  would fail identically on every retry, so they show inline as before. A meal
  that reaches the API and is refused for one of those during a drain is marked
  *failed* with the reason and left for Try again or Remove.
- **Nothing is deleted on the app's behalf.** What somebody typed is their
  input, so there is no expiry; the queue is capped at 20 and refuses past it.
- **A drain stops at the first failure waiting can fix**, since the rest would
  fail the same way, so an offline phone costs one request per return to the app.
  It runs at launch and on foreground only, and is a no-op in demo mode.
- **A ready meal can be refined before it is logged.** Log on the card writes
  the figures as returned. Refine opens the same `EstimatePanel` inside the add
  sheet, already on the saved estimate with its questions, using the meal's own
  slot and moment rather than the day being viewed (`reviewing` on
  `FoodLogEntrySheet` and `EstimatePanel`). An answer or a typed amount re-asks
  the model as it does for a fresh estimate, so it needs the connection the
  queue was waiting for; a refinement that fails keeps the estimate and its Log
  button. Logging from the panel removes the queued row, and dismissing the
  panel leaves it. Save for later is offered only for a first ask, never for a
  refinement, so answers are never folded into a saved description twice.
- **Device-local.** `pending_estimates` is in both `BACKUP_EXCLUDED_TABLES` and
  `SYNC_EXCLUDED_TABLES`: a request belongs to the phone that lost its signal,
  and syncing one would have a second phone estimate and offer to log the same
  meal. It is not exposed over MCP for the same reason.

The recipe nutrition estimate has the same offline failure and a **fingerprinted
counterpart** (`utils/recipeEstimateQueue.ts`, `usePendingRecipeEstimateStore`,
shown only in `RecipeNutritionSheet`). It differs because that estimate is
display-only and documented as never stored: there is nothing to confirm into,
so there is no card and no Log, only a row per recipe that the sheet believes
while its `estimateKey` (name, servings and every ingredient line) still matches
what is on screen. `liveFor` is the one place that comparison is made. A recipe
edit or a different scale hides the row rather than deleting it, so scaling back
shows it again; a newer ask for the recipe replaces it. It is still never written
to the recipe or the catalog, and it is not seeded in demo mode because the
sheet builds the key from live catalog data.

## The fourth write, and a read beside it: workouts

A strength session logged in the Workouts screen can be saved to Health as a
workout, and workouts other apps recorded (a run, a ride, a class) can be read
back for the Workouts history. The bridge half is `writeWorkout`,
`deleteWorkout` and `readWorkouts`; the app half is
`src/utils/healthWorkoutSync.ts` (the write and its rules),
`src/utils/healthWorkouts.ts` (the read), `src/utils/workoutHistory.ts` (the
rows in the history) and the calls in `useWorkoutStore` (`docs/arch/workouts.md`,
"Phase 5, as built"). Everything
the meal write says about writing being a different kind of risk from reading
holds here. What follows is where a workout differs.

### What is written, and when

**One `HKWorkout` per finished session, on the person's tap of "Save workout"**
on workout mode's summary (`finishSession`), and only while three switches are
on: Log to Health (`healthWriteEnabled`), its Workouts row (`workoutHealthWrite`,
off by default) and the Workouts area the row sits in. The second is its own
switch rather than riding the first because somebody who already logs meals to
Health must not start writing workouts by turning the Workouts area on. The
summary says it will happen ("Saving also writes it to Apple Health as a
strength workout.") so the tap is an informed one. It is
licensed by the meal write's argument: a session exists because a person
logged the sets, so recording that it happened is writing down their
statement, not the app forming an opinion about a body. The trigger rule is
the food log's unchanged: a person acting on one session, no sweep, and no pass
over the history of sessions logged before this shipped.

- **An import is never written.** A workout read from a Strong or Hevy file
  came from an app that most likely wrote it to Health already, and writing it
  again would double it there. The import sheet says so while writing is on.
- **It is a strength workout and nothing else.** The bridge refuses any
  activity but `.traditionalStrengthTraining` and `.functionalStrengthTraining`,
  indoor. Sets of weight and reps are all this app can truthfully say happened.
- **Built with `HKWorkoutBuilder`, not the `HKWorkout(activityType:start:end:)`
  initializer**, which is deprecated as of iOS 17 with the builder named as its
  replacement. Begin collection at the start, end it at the end, finish. A step
  that fails before the finish discards the builder, so a half-built workout is
  never left behind.
- **It is skipped, not attempted, when workout sharing isn't allowed**, read off
  `authorizationStatus(for:)` exactly as `writeFoodSamples` reads its own types.
  `writeAuthorizationStatus('workout')` gives Settings its own access row.
- **Absurdity checks, not judgments.** An end that isn't after the start, a
  session over a day long, or one ending in the future is refused, for the
  body-mass ceiling's reason: a mistyped clock should not put a permanent
  outlier in somebody's record. `workoutSpanWritable` makes the same checks on
  the JS side first, because the bridge answers all of them and a real
  refusal with the same null, and only the refusal may raise the notice below.
- **A refused write raises the meal write's notice, with its own words and its
  own "already said" flag** (`healthWorkoutWriteRefusalSeen`).
  `HealthWriteRefusedNotice` watches both stores. Workout sharing is allowed or
  refused apart from nutrition, so one flag for both would let a meal's notice
  swallow the workout's.
- **A workout an agent logged waits for the phone**, the meal write's
  exception (`WorkoutSession.healthWritePending`, `writePendingHealthSessions`,
  run wherever the food log's runs: at launch, on foreground and after a sync
  that applied rows, in front only). A session has no creation stamp, so the
  seven-day limit counts from when it ended. One logged with no length has no
  span to write yet and keeps its flag, so a length added later is written by
  the next pass; the limit ages it out otherwise.

### What is retracted

`writeWorkout` returns the workout's UUID (for `workout_sessions.healthWorkoutId`)
and the ids of any samples saved with it. `deleteWorkout` takes them back, under
`deleteHealthSamples`' rules: the same serial-queue tally, "no objects matched"
counted as success, and **not gated on the switch**, because removing what was
written is what somebody who turned writing off is asking for. Deleting a
session retracts it (`deleteSession`, which reads the id off the row before it
goes).

**An edit rewrites less than `reviseEntry` does, on purpose.** Health holds the
span and the activity and nothing else (no title, no sets, and no metadata
beyond the sync pair below), so
only a change to a written workout's start or end retracts and rewrites it,
and only while writing is on. With the switches off, an edit leaves Health as
it is rather than retracting: the meal's correction is about a false figure in
a medical record, and a workout moved by ten minutes is not that. An edit never
writes a workout that was never written (one saved with the switch off, or
imported), because an edit is not the person asking for it to be shared. On
the phone the edit is the workout page's Started and Finished rows
(`WorkoutDetailSheet`), which refuse a span Health would not take back
(longer than a day) rather than let the rewrite quietly drop it; an agent's
edit of a workout in Health is refused by the MCP server (below).

**`healthWorkoutId` syncs, the way `FoodLogEntry.healthSampleIds` does**, so it
is not in `SYNC_DEVICE_LOCAL_COLUMNS` and stamping it restamps the row as a real
change. Any of the person's own devices may retract it: HealthKit lets an app
delete only what that app saved, and the same app on another device is the same
source. The MCP server has no HealthKit, so `update_workout` refuses a new time
for a workout marked `inAppleHealth` and `delete_workout` refuses to delete one,
exactly as the food tools refuse for a meal with sample ids. The write switches
are device-local, like `healthWriteEnabled`: they say what this phone may put in
Health.

**One session is one workout in Health, however many times it is written.**
Each write carries the session's id as `HKMetadataKeySyncIdentifier` and the
milliseconds at the write as `HKMetadataKeySyncVersion`, set natively from
their own argument (JS metadata may not name `HK` keys). Apple documents the
pair on any `HKObject` saved with them: a save matching an existing object's
identifier with a greater version replaces it
(`healthkit/hkmetadatakeysyncidentifier.json`, `…/hkmetadatakeysyncversion.json`,
both iOS 11). That is the guard against a sync handing the phone back a stale,
unwritten copy of a session already in Health, which would otherwise be written
twice. The version is a clock, not a fingerprint of the span, because a workout
moved earlier would carry a smaller fingerprint and lose to the copy it was
replacing. It changes one store rule: a write that lands on a row already
stamped by another write of the same times has replaced that workout, so the
row takes the new id and the older id is retracted (a no-op once replaced),
where before the new write retracted itself. The builder's own pages don't say
the pair applies to a workout it saves, only that it applies to any object;
the first device build is where that is seen. An edit that changes nothing
saves nothing, and an agent's sets-only edit leaves the session row alone, so
neither restamps a row a sync could then send over the phone's.

**There is no column for sample ids, and the watch phase didn't need one.** The
bridge can hand back ids of samples saved beside the workout, but only for
measured energy, which nothing on the phone passes, so they are always empty.
The plan was a `health_sample_ids` column once the watch passed energy. It
doesn't pass it: the watch's own session saves the workout with the energy and
heart rate it measured attached (see "Heart rate during a workout" below), and
the watch is what retracts them, by the workout's id.

**It is a separate delete rather than two more types in `deleteHealthSamples`.**
Apple documents `deleteObjects(of:predicate:)` as failing for a type the app
never asked to share, so folding the workout type in would have turned every
meal's retraction into a reported failure on an install that never allowed
workouts. For the same reason `deleteWorkout` skips a type still
`notDetermined`: this app cannot have saved anything of a type it was never
allowed to share.

**A write can succeed with no id.** `finishWorkout` hands back a nil workout
with no error when it saved one the locked phone can't read back. The bridge
reports that as written with a null `workoutId`, distinct from nothing written,
so a caller doesn't retry and put the session in Health twice. It cannot be
retracted from here; that is the one case the person deletes in the Health app.

### Energy: absent stays absent

**A session with no measured energy writes none, and nothing estimates one from
sets.** The bridge attaches energy only when a measured figure is passed *and*
active-energy sharing is already allowed. On the phone the second never holds:
active energy is not in the phone's `writeTypes`, because nothing on the phone
measures it for a session, and a share row for a figure the app never writes is
a question asked for nothing. The measured energy comes from the watch instead,
whose session saves it with the workout; the watch asks for active-energy
sharing itself, and "Heart rate during a workout" below is that share type's
review. A zero is treated as no measurement (no session burns nothing), the
body-mass reasoning. Whether deleting a workout also deletes the samples added
to it is not documented, which is why any such sample's id comes back for the
retraction to name, and why the watch's retraction deletes the energy saved
with a workout by name rather than trusting the workout's delete to take it.

### What the read may claim

Other apps' workouts are **readings**, and the reading rules apply in full:

- **"From Health" attributes the source and never asserts.** Each row carries
  the recording app's name (`sourceName`), and copy says a run was recorded by
  that app, not that the person ran. A workout logged by a watch left on a bike
  is as possible as a nap counted as a night.
- **Absent energy stays absent.** `energyKcal` is null when a workout carries
  none, never 0, read through `statistics(for:)` (iOS 16+) because
  `totalEnergyBurned` is deprecated as of iOS 18. A missing duration is null
  too, not worked out from the two ends, since a paused workout's duration is
  shorter than its span.
- **This app's own workouts are left out**, by the saving app's bundle
  identifier (and any identifier under it, which is how a watch app's is
  formed), so a session written from the Workouts screen isn't listed again
  beside itself. A workout from another app that overlaps a session logged
  here is left out of the history too (`overlapsSession`), which is an
  imported Strong or Hevy session that app also saved to Health.
- **An empty answer can't say why.** A refused read, no workouts, and an install
  that hasn't asked since the type was added all read `[]`, so nothing may say
  "no workouts this week" from it. Mood on training days already counts only
  the app's own sessions for this reason (`docs/arch/workouts.md`).

**They are never stored**, for the reasons this file opens with: Health already
syncs them, a copy would be someone else's record in this app's backup file,
and a reading never becomes user data. The history queries the window it shows,
each time it shows it (`useHealthWorkoutHistory`: on focus, on foreground and
when the window moves, with "today" taken again at each focus and foreground), from the day of the oldest session listed and no more
than `HEALTH_HISTORY_MAX_DAYS` (90) back, and only while Read Apple Health is
on. They are not counted in the header, records, Stats or the mood contrast,
and an empty read adds nothing to the list: no "connect Health" row, since a
refusal looks the same as a person who only lifts.

### The re-ask, and the strings

`HKObjectType.workoutType()` joins both `readTypes` and `writeTypes`, so the
one combined sheet (share and read together, for the revocation note in the
bridge) now lists workouts on both sides. **An install that already answered
the sheet gets no workouts until somebody taps the access row in Health
settings again**, and nothing can tell them that is why: the read is
unobservable, and the app never raises the sheet by itself. The write side at
least shows it: `writeAuthorizationStatus('workout')` reads `notDetermined`
until then, which is the state the row renders an ask for.
`NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` both name
workouts now.

## Heart rate during a workout

The Apple Watch measures heart rate while it runs a workout session
(`HKWorkoutSession`, phase 9 in `docs/arch/workouts.md`), and the workout page
on the phone reads it back. It is the first heart-rate figure this app shows.
Resting heart rate and HRV stay on the ruled-out list at the end of this file,
and the difference between them and this is the whole of why this is allowed,
so it comes first.

### Why this one and not resting heart rate or HRV

- **It is about the workout, not about the body.** A resting rate or an HRV
  reading is a figure about a body that is very nearly the same every day, so
  anything read from it is a reading of the person, and the only thing an app
  can do with one is judge it ("low", "recovering"): a diagnosis built on a
  number nobody chose. Heart rate during a workout is the case active energy
  already is (see `basalEnergyBurned` in "What is deliberately not built yet"):
  it is what happened during an hour the person can name, it moves with what
  they did in it (a set, a rest), and the one claim on screen is about that
  hour (how many minutes it spent in each share of a maximum), not about them.
- **The person started the measurement.** A watch records resting heart rate
  and HRV in the background, on its own initiative, every day. Nothing here is
  measured unless somebody started a workout on the watch, or opened the
  phone's workout's own screen there, with workout writing on. Opening the
  watch app, or seeing the phone's workout on its Today list, starts nothing.
  That is the line the nutrients cross: the figure exists because a person did
  something to make it.
- **It costs any other workout app's session.** The watch runs one workout
  session at a time, across every app, and starting this one ends another
  app's (the other gets `errorAnotherWorkoutSessionStarted` and ends). That is
  a second reason the phone's workout waits for its screen to be opened: a
  person running Apple's Workout app while the phone logs their sets must not
  have it ended by glancing at the set on the wrist. And when another app's
  session ends this one, it is not started again for that workout, so the two
  can't end each other in turn; the phone writes its own copy, without heart
  rate, as it does when the watch never measured.
- **It is that workout's own record, shown back.** The heart rate lives in
  Health with the workout the watch saved (the session's builder associates its
  samples with the workout). The app keeps no copy and reads it for one workout
  at a time, when its page opens, which is "It is a reading, not the app's
  data" unchanged.

### The rule: shown, never interpreted

- **Shown.** Live on the watch while a workout runs: the number and a heart,
  in one color, and nothing else. On the phone's workout page, the average, the
  maximum and the minutes in each of five zones, read back from Apple Health
  each time the page opens (`readWorkoutHeartRate`) and never stored.
- **Never judged.** No "high", "low", "good", "fat burn", "cardio", "peak" or
  "recovery", and no color that ranks one zone over another: every zone's bar
  is the same accent, the way `ContrastBars` refuses to rank its two groups.
  Nothing compares a figure to a norm, to an age's typical range, or to the
  person's own past workouts.
- **Never a rule and never a task.** Heart rate is not a `HealthRuleMetric`
  (the `WithNutrientKeyHome` fence keeps that structural), nothing generated
  fires off it, and nothing reads it outside the workout page: not Stats, not
  the mood axis, not records, not the MCP server (which reads no Health).
- **Absent stays absent, and a refusal is invisible.** The card shows only when
  Health returns heart rate for that workout. A refused read, Read Apple Health
  off, a workout the phone wrote without the watch, and a watch that recorded
  nothing all show no card, because they are one answer ("Read authorization is
  not observable"). Nothing says "no heart rate recorded".

### The zones, and the one estimate the app makes about a body

Time in zones needs a maximum heart rate. That is a figure about a body, and
this file's rule is that nothing derives one. The zones are a deliberate
carve-out from that rule, written down the way the weight goal's is, and
allowed only for these four reasons together:

- **The person chose it.** Zones appear only for somebody who typed a maximum
  (Settings › Workouts › Maximum heart rate, `maxHeartRate`) or
  typed a year of birth (Settings › Apple Health › About you,
  `bodyProfile.birthYear`). The weight goal sheet edits the same value, so
  the zones don't need the calorie budget set up.
  Without either, the card's one line names where they are typed, and that is
  all: no prompt, no sheet opened for it, no reminder, and nothing elsewhere
  that asks for an age or a maximum for the zones' sake. Both sync with the
  health record (`SYNCED_SETTING_KEYS` and `HEALTH_SYNC_SETTING_KEYS`), so the
  same workout's zones come out the same on every device that shares the
  health logs. With iCloud alone neither travels (the health record never goes
  to iCloud), so each device has what was typed on it. The year of birth was
  device-local at first only because the
  calorie budget's setting was never listed; it syncs because the person chose
  that.
- **It is labeled as an estimate everywhere it shows.** Without a typed
  maximum it is 220 minus the age from that year of birth (`ageFromBirthYear`),
  and the line under the card says so in those words ("Zones are shares of a
  maximum of 186 bpm, estimated from your age (220 minus age)…"), and the
  setting's value reads "186, from age". That line is a plain `Text`, not
  `HelpText`: Hide help text must not take the label off an estimate.
- **A typed number replaces it.** 220 minus age is a population formula and is
  wrong for plenty of people in either direction. The setting is where the
  person overrules it, and clearing the setting goes back to the estimate.
- **It only partitions what Health recorded.** Five zones at 50, 60, 70, 80 and
  90 percent of the maximum divide the workout's own readings into minutes
  (`heartRateZones.ts`). The maximum decides which bar a minute lands in and
  nothing else: it is never shown as a verdict, never feeds a target, a rule,
  a task or another screen. Zone 5 has no top ("Zone 5 · 168+"), since a
  reading above the maximum is still zone 5 and a range ending at the maximum
  would say otherwise. A sample that holds a series of readings
  (`HKQuantitySample.count` above 1) carries only their average, so its
  minutes go to the average's zone, spread over the series' own span under
  the same one-minute gap rule a single reading gets; the readings inside are
  not walked (`HKQuantitySeriesSampleQuery`) until a device shows what the
  watch's session actually stores.

**What is still not allowed:** a zone colored as good or bad, a named zone, a
training load, a recovery or readiness score, VO₂ max, calories estimated from
heart rate, a resting heart rate or HRV read to "personalize" the zones, an
age guessed from anything but the year the person typed, and the estimate
shown anywhere without its label. Without a typed maximum or a year of birth
there are no zones: the card shows the average and the maximum, and one line
names the two settings either is typed in (the line above about asking). The
line naming where the maximum came from shows only when zones are drawn.

### The new types, and what they cost

- **Read, on the phone: `heartRate`.** One more type in `readTypes`, for the
  workout page. Like every addition there, an install that already answered
  the sheet gets no card until somebody taps Health access in Settings again,
  and nothing can tell them that is why; a refused read is simply no card.
- **On the watch, a request of its own:** share the workout and active energy,
  read heart rate and active energy. On watchOS 6 and later a watch app asks on
  the wrist (Apple's `requestAuthorization(toShare:read:completion:)` page: "In
  watchOS 6 and later, this method displays the permission form on Apple
  Watch"), so the watch asks the first time it starts measuring, which is
  always a person starting a workout there or opening the phone's workout
  screen there. Nothing is
  measured when workout sharing isn't allowed on the watch: the workout runs as
  it did before this phase.
- **Active energy is a share type, on the watch only.** The phone's note above
  ("a share row for a figure the app never writes is a question asked for
  nothing") still holds for the phone, which never writes energy. The watch's
  session measures it and saves it with the workout, so the watch asks for it.
  Nothing estimates energy from sets, still.
- **The strings.** The watch app has its own `NSHealthShareUsageDescription`
  and `NSHealthUpdateUsageDescription` (`plugins/withWatchApp.js`), saying what
  it reads and saves; the phone's share string says it reads heart rate during
  a workout the watch measured in the app, to show on that workout's page.

### One workout in Health, saved by the device that measured it

The full mechanism is in `docs/arch/workouts.md`, "Phase 9, as built". What
this file holds it to:

- **The phone never writes a second copy of a workout the watch saved.** A
  workout run on the watch arrives with the id of what the watch saved. For the
  phone's own workout, the watch says it is measuring as it starts, so the
  phone's Save holds its write back (`healthWritePending`) and writes only if
  no watch workout has arrived 30 minutes after the workout ended. A watch
  workout that turns up after that replaces the phone's copy, which the phone
  retracts: the copy with the measurement is the one kept.
- **Retracting it is the watch's job.** HealthKit lets an app delete only
  "objects that it has previously saved", and whether an iPhone app counts as
  the saver of what its watch app saved is not documented anywhere Apple
  publishes (the delete pages, `HKSource` and the HealthKit guides say nothing
  about a companion app either way). So the phone doesn't try. Deleting the
  session, here or on another device (the delete reaches the phone by sync,
  which asks its watch the same way), or changing its times, asks the watch
  through the snapshot, and the watch deletes the workout and the active
  energy saved with it, then says so. A delete the watch couldn't make (it was
  locked) is not answered, and is tried again. The heart-rate readings taken
  during it stay in Health as readings: they were real, and this app was never
  allowed to share heart rate, so it can't delete them. A watch that never
  runs the app again never answers, and that workout is the person's to delete
  in Health.
- **Changing the times rewrites it without its heart rate and energy.** Health
  can't move a workout, so a retime writes the phone's own at the new times,
  which has neither, and once that is in Health the watch retracts its copy.
  Never the other way round: the watch's carries no sync identifier for the
  phone's write to replace, so retracting it first would leave Health with
  neither whenever Health refused the rewrite; refused, the watch's stays. A
  retime made while the phone was still waiting for the watch's copy ends the
  same way: the copy arrives with the times it was saved at, and when they are
  no longer the row's, the phone writes its own and the watch retracts its
  copy. Whether the times were edited is recorded on the row
  (`WorkoutSession.timesEdited`), since an end a few minutes off with no edit
  is a Finish tapped on both devices, not a retime: the watch's copy is kept
  then, heart rate and all, and the row keeps its own end. The workout page says so under the times before the change, and only
  for a workout the watch measured: "Changing the times also changes the
  workout in Apple Health, and it loses its heart rate and energy." A plain
  `Text`, for the import note's reason: it is a consequence to see before
  confirming.

## The Activity rings

Move, Exercise and Stand are a reading like steps is, and every rule above
holds for them. What follows is only where they differ.

- **Their own native call, because the goals live nowhere else.** The three
  totals are on `HKActivitySummary` along with the goals the person set in
  Fitness, and a summary is read with an `HKActivitySummaryQuery`, not a
  statistics collection. `readActivitySummary` hands back raw JSON and
  `parseActivitySummary` (`src/utils/activityRings.ts`) holds the rules, so they
  are testable from `src/`. It rides `refresh` beside the daily read, and
  nothing is stored.
- **Stand hours exist only here.** Exercise minutes and active energy were
  already read as quantity totals. A task or row asking for them prefers the
  summary (Apple's own de-duplicated figure, so the row agrees with the rings)
  and falls back to the quantity total when no summary arrived. That fallback is
  the point for an install that allowed Health before the rings were added: the
  summary is a new read type, so it is served as an empty store until somebody
  taps the access row again, and nothing can say that is why. Stand has no
  fallback and reads null until then.
- **A goal of zero is no goal, and a ring with no goal has no fill.** The bridge
  sends it as null. Fitness always has goals, but a fraction of nothing is not a
  number to draw.
- **A Move ring counting Move Time carries no Move figure.** Fitness offers
  people under 18 a Move ring measured in minutes of movement rather than
  calories. Sending that number under a kilocalories name would be a wrong
  figure rather than a missing one, so both ends drop it (`moveByTime`) and the
  card says so.
- **A missing ring is not drawn; a real zero is.** `ActivityRingsCard` skips a
  ring with no figure or no goal rather than drawing an empty track, because an
  empty track says "none of this done", and nothing was read. Today's row leaves
  out a ring at zero for the reason the steps row does: every day starts there.
- **The rings are the calendar day's, not the logical day's.** The summary is
  keyed by calendar date because that is when Fitness closes them. With a late
  `dayResetTime` the rings can differ from the figures the quantity reads sum
  over the logical day. This is the one reading that does not follow the reset
  time, and it follows Apple's definition on purpose.
- **A task can wait on a ring and still never completes itself.** `exerciseMinutes`,
  `activeEnergyKcal` and `standHours` are health-target metrics
  (`HealthTargetMetric`, `HEALTH_TARGET_METRICS`). Reaching the number derives
  *ready* and nothing more, the rule `healthTarget.ts` opens with. A target is a
  number typed into the task unless the task opts in to `healthFollowGoal`, which
  reads the goal from the ring summary (`effectiveHealthTarget`). The typed number
  stays as the fallback and is used until a goal has been read, and a goal read on
  another day is not used, for the reason the fallback above gives.
- **An older build narrows an unknown metric to "not a health-target task".**
  `rowToTask` accepts only metrics in `HEALTH_TARGET_METRICS`, so a task synced
  from a newer device reads as an ordinary task on a build that predates its
  metric, and saving it there clears the target.

## The row on Today, and where it files

The reading is a fourth `ContextRow` kind, beside `event`, `meal` and
`kitchen`. It is a reading with no tick box, which `DayContextRow` already
argues for at length, and the strictest case of it: this app cannot write a step,
so there is nothing a tick could mean, and it is the one kind with no `onPress`
either. Health holds the detail and sending somebody out to another app for a
line they have already read is not worth a tap target.

**It has its own category setting (`healthCategory`), and that is what took the
deciding.** The other three sources either had a category already or could
borrow one on a subject argument — the kitchen files with the meals because
`mealCookTaskCategory` is already "where food goes on Today". A step count
shares a subject with nothing here, and the alternative to a setting is
`category: null`, which `insertContextRows` puts at the very top of the list
above every section: the pinned strip this whole mechanism was built to remove.
So it follows `calendarEventCategory` exactly, `ensureHealthCategory` and all.

That also answers the switch question, which is why there is **no
`healthOnToday` beside it**. A cleared category is a real answer rather than a
missing one, so clearing it is how somebody says "read Health, but not onto my
list", and the reading stays visible in Settings. Two switches would only give
them a way to contradict each other. `mealsOnToday` exists because its area is
on by default and has many surfaces; this one is an explicit opt-in with
exactly one.

**Three inputs draw no row**, and only one of them is a choice:

- No reading, or one from a day that has already turned over. The check every
  reader of a day-keyed snapshot makes.
- A null count. Null covers a refusal and an empty day alike, so there is no
  honest row for it, and "No steps" would be shown to precisely the people who
  said no.
- A count of zero. This one is the choice: the bridge keeps a real 0, because a
  bridge that rounded would be lying, and the row declines to exist for it,
  because zero steps is not context about a day. Every logical day starts there
  and stays there until the first samples land, so the alternative is a "0
  steps" line every morning — a scold to somebody who cannot walk, a bug to
  everybody else, and in practice indistinguishable from not-synced-yet.

Demo mode needs no gate of its own for the row, and gets one anyway from the
category: `healthCategory` lives in the database, the demo's copy has never had
one, so a demo session cannot surface a real reading left in the store by the
session before it.

**A run of readings draws as one joined card, and only a row with no action may
join one.** Health readings and calendar events share this: a consecutive run of
either is a single card with hairlines between rows (`contextCardPositions`,
drawn by `DayContextRow`'s `cardPosition`), and a folded section says what is in
it on its own header (`contextSectionSummaries`). The line that keeps this safe
is `isCardRow` in `src/utils/contextCards.ts`: a meal row has a tick and a
moved-off-today event carries the "move tasks" offer, so both stay on their own
cards. Folding a section hides its rows, so anything that asks for an answer
must never be inside one. A new context kind joins a card only if it is as
inert as a health reading; tapping through to a read-only sheet (an event) is
fine, anything that changes data is not. Health's section starts folded the
first time the app assigns it (`ensureHealthCategory`), because its header
already states the figures.

## The Mood screen's health axis

`MoodDay` carries `steps` and `sleepHours`, so every reader already in
`moodInsights.ts` gains a health dimension without learning anything new. The
argument for putting it here rather than anywhere else is the file's own: every
number in it is a join between two datasets, and **a join between Health and the
task history is the one thing a standalone health app can never make.** It knows
how far somebody walked; only this app knows what they got done.

- **A reading decorates a day; it never creates one.** The single most important
  line in `buildMoodDays`, because the obvious implementation gets it wrong.
  HealthKit will answer for ninety days running, and folding those in through
  `dayFor` would conjure ninety days into the set, each carrying `completed: 0`
  and `mood: null` — a fortnight of invented zero-completion days for somebody
  who simply did not open the app. That is rule 3's exact failure mode arriving
  through the one dataset the user never entered.
- **One function for all four pairings** (`healthInsight`), not four near-copies.
  Every rule that makes them honest is the same in each, and written out four
  times two of them would drift. `moodCompletionInsight` stays separate because
  it reports the two group averages the screen leads with, which is a claim
  about mood specifically.
- **The copy is a tested pure function** (`describeHealthInsight`), for the
  reason `moodTasks.test.ts` asserts directly that the nudge never names a
  feeling: copy that must not overclaim should be checkable. A test walks every
  metric/axis/direction/strength combination and asserts none of it contains
  advice or a coefficient.
- **"No clear pattern" gets said.** Hiding it would leave only the findings that
  happened to land, which is how a screen of associations starts reading as a
  screen of results.
- **The window is read on demand, not on the foreground triggers.**
  `refreshHistory` is a wider query than the Today reading and only this screen
  wants it, so running it on every foreground would be paying for a chart nobody
  has open — the split `useMealPlanStore` already draws by letting the screen own
  which week is loaded. `HEALTH_HISTORY_DAYS` is 90: long enough to clear
  `MIN_PAIRED_DAYS` for somebody who logs a couple of times a week, short enough
  to stay one query, and not a setting because nobody has an opinion about it.
- **Sleep is filed under the day it ends in**, and nothing calls it "last night".
  A nap counts toward its own day, so the honest name for the number is time
  asleep recorded against a day. Overlapping sources are handled the way steps
  are: per source, then the largest, because a phone recording "in bed" and a
  watch recording stages would otherwise put somebody to sleep twice.

**Adding a read type is not free for people already using the feature.** Sleep
went into `readTypes` after steps shipped, and the app never re-prompts on its
own — a sweep must not raise that sheet. So an install that allowed steps before
this gets no sleep until somebody taps the access row in Settings, and because a
refused read and an unasked one look identical, nothing can tell them that is
why. Weigh that against what the type buys before extending the list again.

**The nutrients a health rule reads from Health don't join this axis.**
`healthInsight` pairs mood only with steps and sleep: a nutrient rule is a
person's own target checked against a number they picked, not a candidate for
"no clear pattern". What the person *ate* does join mood, but from the food log
rather than from Health (`MoodDay.nutrients`/`foodKeys`, `nutrientInsight`),
under the thin-day rules in `docs/arch/mood-log.md`.

## The Sleep screen

When somebody fell asleep and woke up, how long each day's sleep added up to,
and a goal they typed in. The Weight screen's shape throughout: a window read
on focus (`refreshSleep`, `SLEEP_HISTORY_DAYS`), nothing stored, a range picker
that only re-slices what was read, and a door to the Health app in place of an
edit button.

- **The native side hands back episodes, not a pair of times per day.**
  `readSleepSeries` returns every stretch of sleep that ended in the window,
  with its start, its end, its minutes asleep and an index for the app that
  recorded it. Which source wins a day, which episode is the main sleep and
  which day an episode belongs to are decided in `sleepNights`
  (`src/utils/sleepLog.ts`), because Swift can't be tested from where the
  app's logic is. The wire carries an index rather than the bundle identifier,
  so nothing another developer named is spliced into hand-built JSON.
- **One grouping rule for both sleep reads.** `readDailyHealth`'s total and
  `readSleepSeries`' episodes both go through the Swift `sleepEpisodes`
  helper (an hour awake ends an episode), and `sleepNights` repeats the daily
  read's per-source-then-largest rule, so the hours on this screen and the
  hours a health rule fired on are the same number. Change one, change both.
- **A day's main sleep is the winning source's longest episode.** That is the
  night for nearly everybody and the nap only on a day with nothing else. A
  night broken by more than an hour awake is two episodes, so its main stretch
  is the longer half; the card says what the rest added up to rather than
  hiding it.
- **Average clock times are circular means** (`averageClockMinutes`), because
  the plain average of 11 PM and 1 AM is noon. Times scattered too widely to
  share an average answer null, shown as a dash, rather than a time no night
  was near.
- **The goal is typed in and feeds nothing else** (`sleepGoalMinutes` in the
  settings store, a row in Settings and a sheet on the screen). It is the
  carve-out the weight goal makes: a line on the hours chart, "N of M days
  reached it", and a distance on the most recent card, with no colour, no
  verdict and no suggested figure. It is not a `HealthRuleMetric`, and
  reaching it completes nothing.
- **Still no "last night".** Every label names the day the sleep ended in, for
  the reason the Mood axis section gives.
- **Stages are drawn as recorded, and absent stays absent.** A Watch stages
  sleep (Core, Deep, REM, plus awake time); a phone's sleep schedule and most
  other apps record only "asleep". An unstaged episode has `stages: null`, not
  zeros, and `averageSleepStages` averages only staged nights, so a phone
  night can't read as a night of no deep sleep. Awake time counts only
  *between* two asleep samples (Swift's `pendingAwake`), and awake samples
  never start, extend or split an episode, so the totals above are unchanged
  by them. No stage is coloured as good or bad and nothing says how much of
  one is enough.
- **The timeline is the same record with the *when* kept.** Each episode also
  carries its staged stretches (`seg`, `[stage, seconds from the start, seconds
  long]` per stretch), which `parseSleepEpisodes` reads into `SleepSegment`s and
  `sleepNights` puts on the night. The totals above are these added up, so the
  two can't disagree. Only the four stages are sent (an unspecified "asleep"
  stretch counts toward minutes but isn't drawn), nothing is interpolated across
  a gap, and `stagedNights` leaves out a night with totals but no stretches
  rather than drawing an empty chart. The stepper on the Sleep screen walks
  every night read, not the zoomed range.
- **"With your days" is the Mood axis, not a second one.** It runs
  `healthInsight` for sleep against finished tasks and mood, with the same
  copy and the same `MIN_PAIRED_DAYS` floor, fed this screen's own nights
  through `sleepReadings` so Health isn't read twice. It covers the whole read
  window rather than the zoomed range, because a week can't hold enough paired
  days.

Bed and wake times needed nothing added to `readTypes`: they come from the same
`sleepAnalysis` samples the total was already read from.

## The generator, and the line under "Lighten today"

`health` is one of the generators, and its own rules live in
`docs/arch/generated-tasks.md`, which is where a new generator's author will
look. Only the parts that are about *health* rather than about the
mechanism are here:

- **A missing reading never matches a rule.** The same sentence as everywhere
  else in this file, and this is where getting it wrong would be worst: reading
  null as zero would fire "Go for a walk" at everybody who declined to share
  their steps, every single evening, and they would have no way to find out why.
- **A shortfall needs the day to have happened.** "Under 3,000 steps" is true at
  7am for everybody not out running. `HEALTH_METRIC_EARLIEST_HOUR` holds a steps
  rule until evening, and — the part that is easy to get wrong — the idempotency
  mark is *not* spent before then, or the rule could never fire that day.
- **The generator needs the read as well as itself.** Two switches, because they
  are two different permissions to give. The rules sheet says so and turns the
  read on from there.

`shortSleepDeloadNote` is the health twin of `lowMoodDeloadNote` and lives by
that one's three rules: not a banner, not a second task, and **not a change to
what `buildDeloadPlan` pre-checks**. Offering the sheet is help; deciding what
comes off the day is not the app's call, and a bad night must not break a
twelve-day streak.

Where it departs from its twin is the wording, and that is this file's own rule
being cashed. The mood note can say "You've logged a low mood three days
running" because the person logged it. Nobody logged this: it is a watch's
guess, and it may be a nap, or a phone left on the nightstand. So the sentence
attributes the source ("Apple Health recorded…") rather than asserting the fact,
and says "for today" rather than "last night", since a nap counts toward its own
day. It is gated on the read alone rather than on the generator, because it is a
line in a menu somebody opened rather than a task — the same argument
`lowMoodDeloadNote` makes for needing no switch of its own.

**Every sleep and nutrient shortfall task carries the same note, and only sleep
carries a link too.** `checkHealthTasks` writes the metric's own note
(`healthTaskNote` in `healthRules.ts`, dispatching to `shortSleepDeloadNote`
for sleep and `nutrientReadingNote` for every nutrient)
straight onto the row's own `notes`, so a sleep or nutrient task never reads
as coming from nowhere the way a bare title would. Only sleep also gets
`healthTaskLinkUrl`'s `dundundun://deload`, wired to `resetToDeload` in
`navigationRef.ts`, so tapping "Keep today light" opens the same `DeloadSheet`
the menu line points at. Steps and exercise carry neither field ("Go for a
walk" already names its own action), and none of the nutrients has a comparable sheet
to open, so they get the note and stop there.

**`nutrientReadingNote` is one function for all eight nutrients, not eight
near-copies.** An earlier version of this file had three separate functions
(`sodiumShortfallNote`, `proteinShortfallNote`, `satFatOverageNote`) — the
right shape at three, already the wrong one to keep growing by one function
per metric. `HEALTH_METRIC_INFO` (a private table in `healthRules.ts`, one row
per nutrient: its label, its default direction, its default checkpoint hour,
its threshold range, and how its amount renders) is what let this collapse to
one function instead of eight: `nutrientReadingNote(metric, value)` looks up
the metric's own unit and noun and composes the sentence, with calories the
one irregular case (see below). The same table backs `healthMetricLabel`,
`describeHealthRule`'s amount phrase, and the rule editor's own stepper
rendering in `HealthRulesSheet`, so a ninth nutrient is one row in the table
plus a native read, not four functions to remember to update in step.

**Every nutrient is a shortfall rule with more than one checkpoint a day, and
that is what `HealthRule.checkpointHour` exists for.** Steps, sleep and
exercise judge from one fixed hour per metric (`usesCheckpoint` says which) (`HEALTH_METRIC_EARLIEST_HOUR`), because one
evening floor is what a step count or a night's sleep needs. A nutrient target
set by a doctor is routinely phrased as more than one number over a day — "at
least 2,000mg of sodium by lunch, 4,000mg by dinner" — which is two *rules*,
not one, and they need two different hours. Rather than growing a second
fixed map entry per checkpoint (and a third, and a fourth, the moment somebody
wants a mid-afternoon one too), every nutrient rule carries its own
`checkpointHour`, editable in `HealthRulesSheet` for any metric but steps and
sleep (`usesCheckpoint`, the one gate both the checkpoint stepper and the
direction control below share, for the identical reason).
`HEALTH_METRIC_EARLIEST_HOUR`'s entries for the nutrients still exist, but
only as the value a freshly-created rule starts from — steps, sleep and
exercise have no reason to follow, and don't.

**A nutrient rule can read its checkpoint the opposite way round, and that is
the one place this generator stopped being purely a floor.** The file's own
argument used to be "Only 'under' is expressible, and that is deliberate": a
comparator would put a control on every row to serve a case nobody had, and
the mirror of a shortfall ("at least 10,000 steps") describes something
already true and needing no task. A nutrient *ceiling* — "don't go over 20g of
saturated fat" — is a different request the mirror argument never covered: it
is still a number the user picked and a shortfall against it, just measured
the other way. `HealthRule.direction` carries the choice, and
`HEALTH_METRIC_DIRECTION` supplies only the default a freshly-created rule of
a given metric starts from (a floor for most, a ceiling for saturated fat,
sugar and caffeine) — `healthRuleDirection(rule)` always resolves the two together, and
nothing else reads `rule.direction` raw.

**It's a per-rule choice rather than a per-metric one because a diet goal
genuinely points either way**, which is a stronger reason than "why not, it's
cheap": a sodium ceiling for someone managing blood pressure is exactly as
real a want as this feature's original sodium *floor* for POTS, and a calorie
floor for bulking is exactly as real as a calorie ceiling for cutting. Picking
one fixed meaning for a nutrient in code would have been choosing a side in a
real dietary disagreement the app has no business having an opinion on.
`HEALTH_METRIC_DIRECTION` still supplies a default per metric — a floor for
most, a ceiling for the three where "don't go above X" is the far more common
ask (saturated fat, sugar, caffeine) — but it's only the value a freshly
created rule starts from before the user can change it. Steps, sleep and
exercise still don't get the toggle — "over 3,000 steps" or "over 6 hours asleep" has no case
answering to it, which is the same mirror-argument line `usesCheckpoint`'s
comment draws for the checkpoint-hour control right next to it in
`HealthRulesSheet`.

**A ceiling needs its idempotency mark spent the other way round too, and
missing this would make the feature silently useless.** Every rule read as
`'under'` only gets easier to satisfy as the day goes on — more steps, more
sodium, more protein all move toward the target, never away from it — so
`checkHealthTasks` spending the mark the moment `ruleCanBeJudgedYet` says yes,
matched or not, is correct for it: whatever the reading says once the
checkpoint has passed is final. A rule read as `'over'` is the mirror of that:
more of whatever it's watching only moves *toward* crossing it, so an early
"still under 20g" checked at 9am says nothing about 6pm. Spend the mark on
that early "safe" reading the way an under-rule does, and the rule is retired
for the day the first time it happens to be checked while still under — which
for most people, most days, is the very first foreground sweep. So
`checkHealthTasks` withholds the mark for whichever rules resolve to `'over'`
— which is a run-time question, `healthRuleDirection(rule)`, not "is this
`satFatG`" — until each actually matches, and only then treats it like every
other generator. See that function's own comment for the exact branch.

Two things keep the direction choice narrow rather than reopening the
comparator question generally: the reading itself is unchanged in kind — all
eight nutrients are read, `null`-checked and shortfall-compared through the
same `ruleCanBeJudgedYet`/`ruleShortfallToday` pair every other metric uses —
and the choice is offered only on the eight nutrient rows, never on steps or
sleep, which still have no case answering to a ceiling. What changed is
*which way* a given rule's shortfall points and *when its mark may be spent*,
not a new relationship between a reading and a task, and not a general
greater/less toggle available everywhere.

## Vegetables and fruit, and the one bar

`produceServings.ts` counts 80 g servings of vegetables and fruit from the
food log, on the Food log's day card and as an average on Stats. The nutrition
stats rule is counts, never a score: no percentages of a goal, no status
colors, no streaks. The one exception is a single neutral accent bar toward the
fixed "5 a day" figure (`dailyProduceProgress`), added on request. Keep it
that narrow: the target is a constant rather than a typed number, the bar
stops at full, and nothing (color, copy, a streak) changes when it fills. The
Stats row draws the average day against the same figure.

## Processing group (NOVA), and the share on Stats

`FoodNutrition.novaGroup` (1 to 4) is a classification of the food, kept on its
panel and carried onto a logged helping by `scalePanelToAmount` (unscaled, like
`source`). The rules are in `src/utils/processingStats.ts`.

- **A group is stated, never worked out.** The only automatic source is Open Food
  Facts' own `nova_group` (`readOffNutrition`); the only other is a person
  setting it on the panel sheet or over MCP. Nothing infers one from a name or an
  ingredient list. A food nobody classified has no key and is **unclassified, not
  group 1**, which is why every reader counts it apart.
- **The share is of the classified calories, and coverage always travels with
  it.** `processingMix` returns group 4's share of the calories of entries that
  carry a group, and the classified share of all logged calories. A share over a
  small coverage says little, so Stats and `list_food_log` print the two
  together. An entry stating no calories is left out of both sides. No verdict:
  it is a count against the person's own log, `produceServings.ts`'s posture.
- **A snapshot, like every figure on an entry.** The group is read off the helping
  as logged, so classifying a food later does not rewrite past entries. A recipe
  or an estimated meal carries none.
- **A product with a group but no label panel loses it**, because the group rides
  on `FoodNutrition` and `readOffNutrition` returns null without figures.

## A panel that looks wrong, and who decides

A panel can pass every check and still be a misprint: a label that says 16 g of
sodium where it meant 16 mg is possible, just not plausible. Two gates exist
and they are deliberately different kinds.

- **`PER_100_CEILING` (`nutritionParse.ts`) drops the impossible.** It runs on a
  barcode record that nobody is looking at, so it may only refuse what cannot
  be true (more than 100 g of anything in 100 g of food). Tightening it would
  make a module with no person in front of it decide which real foods are too
  unusual to keep.
- **`panelWarnings` (`nutritionSanity.ts`) flags the implausible, and a person
  answers.** It runs when `NutritionPanelSheet` saves, offering Edit or Save
  anyway. It never drops a figure and never edits one, because the packet in
  the person's hand is the only authority on whether the label itself is
  wrong. Its rules use the panel's own figures and serving weight and nothing
  else: a bound is set so salt, bouillon and pure oil still pass.

A new check goes in `panelWarnings` if it needs a person to judge it, and in
`PER_100_CEILING` only if it is arithmetically impossible. Barcode lookups and
AI estimates are not run through `panelWarnings` on their own; they reach it
only when a person saves the result in that sheet.

## What is deliberately not built yet

Steps, sleep, exercise minutes, active energy, eight nutrients (sodium,
protein, saturated fat, fiber, sugar, caffeine, water, calories) and body mass
— nothing past those thirteen, plus time in daylight, the Activity rings,
other apps' workouts (read for the Workouts history only, which no rule or
generator consults; see the workouts section above), and heart rate during a
workout the watch measured (read for that workout's page only, and never
judged; see "Heart rate during a workout"). The
read-type list is one place (`readTypes`) and the note beside it says what
adding to it costs; every metric this file still rules out — resting heart
rate, HRV, heart rate outside a workout the person started, glucose, cycle
tracking — stays ruled out for the reason given there, which is that a
generator firing on one of them can be wrong about a body rather than about a
day. Reading heart rate for a workout did not open the door to the other
two: it is allowed because the person started the measurement and the claim
is about that hour, and neither is true of a resting rate or an HRV reading.

**Active energy is the most recent addition and `basalEnergyBurned` beside it
is not.** The two arrive together in HealthKit and it would have cost one more
line to read both, which is exactly why the refusal is worth writing down: a
resting rate is a figure about a body that is very nearly the same every day,
so nothing that reads it is reading *a day*. Active energy is the opposite —
it is what somebody did between this morning and now, it is zero-ish before
they do anything, and every claim made from it is about the walk rather than
about them. That line is the same one the weight section above draws, and it
is what lets the calorie boost below exist without reopening the question the
rest of this section closes. The set of read types is one list in the Swift
module (`readTypes`) because the permission sheet is shown once for whatever
is asked for, and a type added there is a type the sheet will list — so
nothing goes in until something reads it.

**Weight was on that ruled-out list for a long time and has moved, which is
worth explaining rather than quietly editing.** It was grouped with HRV and
glucose on the reasoning that a reading a device produces is one the app would
have to interpret. That grouping was wrong, and the nutrients section below
already contains the argument that shows why: what makes HRV unusable is not
that a device recorded it but that *nobody chose the number*, so an app cannot
say whether a given value is meaningfully low for a given person without
inventing a diagnosis. A weight is the opposite case and the same case as the
nutrients — it exists only because somebody stepped on a scale or typed it in,
and it means exactly what they already know it means. Reading it back and
drawing it claims nothing they did not already record.

What replaced the ban is a narrower rule that does the same work: **nothing
derives anything from a weight.** It is not a `HealthRuleMetric`, so no
generator fires on it and no task is written from it; there is no BMI, no
healthy range, and no "trending up". `weightLog.ts` reports the first and last
readings in a window and the gap between them, with the number of weigh-ins
printed beside it, and stops. The moment something here wants to *judge* a
weight rather than draw one, it is back on the ruled-out list.

**A goal weight was on that list too, and has moved for a different reason
than weight itself did — read this before adding anything that reads
`weightGoal`.** The argument above is about what the *app* may conclude, and
that has not changed at all. What a goal changes is whose conclusion is on
screen. A target the app proposes is the app judging a body. A target somebody
typed in is the same kind of object as a sodium ceiling their doctor set or a
figure they picked in `NutritionTargetsSheet`: their number, which the app does
arithmetic against. `weightGoal.ts` does that arithmetic and its header states
the four posts the fence now sits on. Restated here because this file is where
a future reader will look for them:

- **Nothing proposes a target weight or a rate.** `RATE_RANGE` bounds what a
  stepper can produce, in the shape `MAX_WEIGHT_KG` already uses. It is an
  absurdity check and not a recommendation, and there is deliberately no
  warning band inside it.
- **Nothing judges the target somebody picked.** No "that is too low", no
  encouragement that it is realistic.
- **Nothing generated fires off a goal.** Still not a `HealthRuleMetric`, still
  no task written, and reaching the target completes nothing — the call
  `nutritionTargets.ts` makes about a daily figure, for its reason: a goal is a
  record to read against, not a task to finish.
- **Ahead and behind are said about the user's own pace, never about them.**
  `goalPace` reports the kilograms between where the weight is and where the
  rate *they set* would have put it **on the day that weight was recorded**,
  not today: measured against today, a reading three weeks old read as three
  weeks behind however exactly it had sat on the line (`weightSinceGoalStart`
  returns the reading's day for this, the forecast counts from it too, and the
  card says "on Aug 22" rather than "now" once the reading isn't today's).
  That is a fact they could read off the chart, which is the standard
  `weightChange` already holds itself to. It
  carries no colour, no arrow and no advice, and `WeightScreen` must not add
  one.

The goal lives in the settings table rather than in Health, because it is not a
measurement: HealthKit has nowhere to put one, and nothing should read it back
as though somebody had recorded it. The weights it is measured against are
still Health's, and nothing about this stores one.

**The calorie estimate (`energyBudget.ts`) is the one thing here that takes a
figure about a body and hands back a number to act on**, so it is fenced twice
over. Height, year of birth, sex and rate are typed in by the person, and
nothing fills a field in: a profile missing any part of itself produces null
rather than a guess, which is that module's whole discipline about defaults.

**How the activity half is arrived at is now a choice, and that is the one
place a reading reaches this.** `maintenanceKcal` multiplies the resting rate
by the activity level somebody picked; `measuredMaintenanceKcal` instead adds
the active energy a typical recent day of theirs recorded. `WeightGoalSheet`
offers both and **opens on the multiplier**, which is the whole of the fence
around it: the measured option appears only once there is a real figure behind
it, picking it is an act, and nothing about it is stored. Neither is ranked as
the better one, and that module argues why at length (the multiplier is a
population average over a self-description; the measurement is exact about
whatever the person's devices actually saw, which for a phone on a desk is not
much). The measured figure adds digestion as a tenth of the total
(`DIGESTION_SHARE`), because HealthKit's active energy is movement only where the
Harris-Benedict factors also fold digestion in. It used to leave it out and
say so, on the grounds that a second population constant would spoil a
measurement. That didn't hold: the resting half is Mifflin-St Jeor, so the
figure was never a pure measurement, and leaving digestion out only made the
two options answer different questions a couple of hundred calories apart.
The sheet prints the digestion figure in its working rather than folding it in
unannounced.

**The plain calorie figure follows the goal automatically, and that is an
asked-for exception rather than an oversight.** This section used to say the
figure only reached `nutritionTargets.calorieKcal` when somebody pressed the
button under it and that nothing re-applied it as a weight changed. That is no
longer true. `WeightGoalSheet` still prints the arithmetic with its own working
shown beside it, but **saving the goal writes the figure** to
`nutritionTargets.calorieKcal`, on whichever basis is on screen, and
`useSettingsStore.syncWeightGoalCalorieTarget` re-applies it afterwards through
`autoCalorieTargetKcal` (`weightGoal.ts`). That sync runs at the end of every
`refreshWeight`, which is every time the Weight screen comes into focus with
reading on and after `LogWeightSheet` records a weight, so the target moves with
the weight, the profile and the date rather than going stale the moment the
sheet is closed. (`syncWeightTargets` re-applies it on each foreground too.) The button under the figure ("Use as my calorie target") still
writes it immediately, without saving the goal.

It stays narrow in four ways, and each is load-bearing:

- **Only while there is a goal and a complete profile.** `autoCalorieTargetKcal`
  returns null otherwise, and a null leaves whatever is stored alone rather than
  clearing a target somebody set some other way.
- **The calorie figure only, never the macros.** A split is something the person
  picked from a list that preselects nothing (see below), so re-dividing a day
  they did not ask to have re-divided stays off the table.
- **The re-sync always uses the multiplier basis.** The measured basis needs a
  live read with nobody necessarily there to ask for it, so somebody who saved on
  the Apple Health basis is moved back to the multiplier figure at the next
  refresh.
- **It says so where it happens.** A target typed in `NutritionTargetsSheet`
  while a goal is set is replaced at the next refresh, which is the cost of the
  exception, so that sheet says the calorie target follows the weight goal under
  its calorie stepper, and the goal sheet says the same under its own figure.

The rule it bends is `nutritionTargets`' own note that a figure nobody chose
must not drive the food log. Setting a goal is taken as choosing to have this
one figure tracked, which is why the exception stops at that figure and why it
has to be visible on both sheets rather than only in the code.

**The protein target can follow the weight too, as a second asked-for
exception, and it is built to the same four limits.** `proteinPerWeight`
(`src/utils/proteinPerWeight.ts`) is a ratio typed in on `NutritionTargetsSheet`
(grams per pound or per kilogram; off by default, nothing suggested beyond the
round number its stepper opens on). `useSettingsStore.syncProteinToWeight` writes
`nutritionTargets.proteinG` from it, called at the end of `refreshWeight` beside
the goal's calorie sync and again when the ratio changes. It writes the stored
target rather than computing at display time, unlike the two boosts, because
this figure has far more readers (food log, Today, widget, tasks, meal plan,
Stats, the MCP replica) and the replica cannot see a weight at all.

- **Only while the ratio is on and a weight is known.** A missing, refused or
  implausible reading answers null and leaves the stored number alone; it never
  moves the target toward zero.
- **Protein only.** It does not touch calories or the other macros, and it is
  independent of the weight goal's macro split.
- **Turning it off keeps the number.** The last figure it wrote stays as an
  ordinary target.
- **It says so where it happens.** A protein number typed on the sheet while the
  ratio is on is replaced at the next weight read, and the row says that.

Both syncs run from `refreshWeight` (the Weight screen, a weight logged in the
app, the targets sheet opening with the ratio on) and also from
`syncWeightTargets` in `useHealthStore`, which `useHealthSync` calls at launch,
on every return to the app and when reading is turned on. That one reads a
30-day window through `readRecentWeights` and stores nothing, so it is cheap
enough for every foreground and a weigh-in made in another app is picked up the
next time the app opens. With no weigh-in in the window it changes nothing: the
goal's calorie sync would otherwise fall back to the weight the goal started
from, which can be older than what the longer `refreshWeight` read found.

**The macro split follows the same rule and is where it was most tempting to
break.** `MACRO_PRESETS` names four common ways to divide a day's calories and
**preselects none of them**, because how somebody splits protein, carbs and fat
is a real dietary disagreement of exactly the kind `HEALTH_METRIC_DIRECTION`'s
note above refuses to take a side in. What the app can honestly do is what a
reference table does: name the splits, show what each works out to in grams
(`macroGrams`, by the Atwater factors, which are label arithmetic and not an
opinion), and let the person pick, or type their own split (`customSplit`, with fat as the
remainder so the three always divide a whole day). Applying one writes the calorie target
alongside the three macros, since a macro target that doesn't add up to the
calorie figure it was split out of is three numbers with nothing holding them
together. The split itself is not stored: it is a one-off choice made when
applying targets, not a setting, and what persists is the four ordinary
`nutritionTargets` entries anybody can then edit or clear.

**A calorie target may be raised by a day's own movement, and the baseline is
the whole of why that is allowed.** `activeEnergyBoost.ts` adds to today's
calorie target whatever active energy Apple Health has recorded past a figure
the person typed in for an ordinary day of theirs. It is the fourth thing in
this file to take a reading and hand back a number to act on, and it stays
inside the fence for the same three reasons the estimate above does: the one
input that is not a reading is typed in, the target it raises is one somebody
already chose, and **nothing is written** — the boost is applied where the
Food log draws the day and `nutritionTargets.calorieKcal` is never touched, so
what a person set stays what they set.

Four decisions in it are not obvious and are all load-bearing:

- **The baseline is what stops it double-counting, and it is the feature.**
  Adding a day's active energy to a target outright is what every tracker that
  does this is asked for, and it pays for the same walk twice: a target built
  through `energyBudget.ts` has already been through an activity multiplier,
  and one arrived at any other way was still chosen by somebody who knew how
  much they move. Only the *excess* is added, so an ordinary day changes
  nothing at all. Somebody whose target really did come from a resting rate
  sets the baseline to zero and gets the naive behaviour deliberately.
- **It raises and never lowers.** Active energy accrues through the day, so a
  signed adjustment would open every morning several hundred calories below
  the target and climb back to it. That is a wrong number for half the day,
  and it reads as a scold besides, which is the same thing
  `describeAgainstTarget` refuses when it withholds "0 of 2,000" from a day
  nobody has eaten in yet. Flooring at zero makes a part-day understate the
  boost rather than overstate it, so the figure on screen is never one the
  evening takes back.
- **The app may work out a typical day, and may not set one.**
  `typicalActiveEnergyKcal` takes the median of a fortnight of the person's
  own days and the sheet offers it behind a button. That is the
  `WeightGoalSheet` arrangement exactly — the app is allowed the arithmetic as
  long as a person performs the acceptance — and it is there because a single
  knob nobody can answer is a knob nobody uses. The median rather than the
  mean, because one marathon or one day the watch spent on a charger should
  not move a baseline for a fortnight; and it withholds below seven known days
  rather than answering from two.
- **Calories only, never the macros.** How a day is split is something the
  person picked from a list that preselects nothing (see `MACRO_PRESETS`
  above), so re-dividing a day they did not ask to have re-divided would be
  this feature acquiring the opinion the rest of this section spends its length
  refusing.

It is off until somebody turns it on, it appears only once a calorie target
exists, and the Food log says what it added and which reading it came from
rather than folding the change silently into the figure. `waterExerciseBoost.ts`
is its older sibling in every respect and was the shape this was built to.

**The chart draws the goal, and the colour is the rule.** `WeightChart` takes
an optional target and pace line. Everything in the accent colour on that chart
is something that happened (the readings, and an average of the readings); the
target and the pace are neither, so they are drawn grey and dashed. A solid
accent line for a plan would put a plan and a measurement in the same visual
language on a chart whose three stated rules are all about not doing that.
`weightDomain` takes an optional weight to make room for so the target lands
inside the plot, which deliberately flattens the readings when the target is
far away: drawing the line at the edge of a domain it isn't in would be worse,
and the trend line still carries the shape.

The single judgement in that module is `MIN_PROPOSED_KCAL`, and it is worth
naming as one rather than leaving it to be discovered. The arithmetic will
cheerfully produce 700 calories for a small person aiming at two pounds a week,
and the app must not put that number in front of somebody with its own name on
it. So the *proposal* is floored (1,200 / 1,500, the long-standing unsupervised
floors), the sheet says plainly that it was and shows the unfloored figure
next to it, and nothing is prevented: `NutritionTargetsSheet`'s own stepper
goes to 500 and is nobody's business but the user's. Suggesting and permitting
are different acts and the app is only answerable for the first. A profile with
no sex given gets the lower floor, so the clamp is the weakest one the known
facts support.

The type-level constraint helps hold this. `HealthRuleMetric`'s nutrient arm is
checked against `NutrientKey` (`WithNutrientKeyHome`), so adding weight as a
rule metric would not typecheck without deliberately carving an exception —
the fence is structural rather than a comment asking nicely.

**The eight nutrients are not an exception to that reasoning; they sit on the
other side of the line it draws.** The ruled-out metrics are all a device's
own guess about a body a person never entered a number for — an app cannot ask
"is this HRV reading meaningfully low for *you*" without inventing a
diagnosis. A dietary figure is different in kind: it exists at all only
because a person (or their own food-logging app) entered it, and the
threshold it is judged against is a number *they* typed into
`HealthRulesSheet`, the same as "under 3,000 steps" or "under 6 hours asleep"
already is. The generator still never says "your sodium is low" or "you ate
too much saturated fat" — `nutrientReadingNote` attributes every figure to
Apple Health exactly as `shortSleepDeloadNote` does, ceiling included — it
only reports the reading against the target the user set. Nothing here
licenses adding a metric the app would be interpreting on the user's behalf;
it licenses adding one whose bar, and whose direction, is entirely theirs.

**Calories are the one nutrient whose note and description drop the "of".**
Every other nutrient reads as "50g of protein" / "1,850mg of sodium" because
its `HEALTH_METRIC_INFO.amount` is a bare number-plus-unit that needs a noun
after it. `calorieKcal`'s label ("Calories") already *is* a complete noun, so
`nutrientReadingNote` and `healthMetricAmount` special-case it to
"2,000 calories" rather than produce "2,000 calories of calories" or
"2,000kcal calories" — the one place the table-driven approach still needed a
metric-specific branch rather than a uniform composition.

Sleep is read, with the cost of adding a type written down beside
`readTypes`. A task *may* show its live figure and mark itself ready — as its
own `TaskKind`, in `isTimerReady`'s shape, never as a completion; see the
section above for why that shape and no other.

The nutrient rule metrics were added for a specific, medically-motivated
request rather than as a general widening of what this generator may watch —
see the sections above for the two lines it does and doesn't cross (which
metrics are eligible at all, and which way a shortfall may point).
`HEALTH_METRIC_INFO` is a table rather than a switch per metric for that reason.

**Adding a read metric costs a bigger permission sheet, and a write type costs a
real sample in somebody's Health record if anything about it is wrong**, so
`writeTypes` follows a stricter version of the same "don't add until earned"
rule. "Writing what a task names: a logged nutrient", "The second write: body
mass" and "The third write: a logged meal" above carry the arguments in full;
read them rather than a summary before adding one.

## Maintenance measured from the log (`adaptiveExpenditure.ts`)

**The second carve-out from "nothing derives anything from a weight", asked
for, and fenced the way the weight goal's is.** "Your log" on the weight goal's
basis works out what a body burns from what was eaten against how the weight
moved: the average calories over fully logged days in the last four weeks,
minus the slope of a least-squares line through the weigh-ins, converted at the
same energy per kilogram the goal's rate uses. Four posts hold it:

- **Picking it is the opt-in, and it is stored on the goal**
  (`WeightGoal.maintenanceBasis`). Nothing computes it otherwise, and unlike the
  Apple Health basis (chosen per sitting, never remembered) it is saved,
  because the automatic target has to follow it.
- **It proposes a maintenance figure and nothing else.** The target is
  `budgetFromMaintenance` with the goal's own rate and `MIN_PROPOSED_KCAL`, so
  this basis can't produce a number the profile basis couldn't.
- **It shows its working and refuses rather than guesses.** The sheet says the
  days and weigh-ins counted, the average eaten and where the trend line
  started and ended. Under 14 fully logged days, 3 weigh-ins or a two-week span
  there is no figure, only what is missing, and a figure outside what a body
  produces is refused. Until there is a figure the activity level stands, in
  the sheet and in the automatic target alike.
- **It reads only what is already on the device**: the food log, and the weight
  series the health store already holds in memory. The thin-day rules are
  `foodDayInputs`', today is left out, and nothing is stored.

It already counts activity, so the sheet says to leave Add active calories off
with it, or a busy day counts twice.

## Fasting (`Fast`, `src/utils/fasting.ts`)

A fast is started and ended by hand on the Food log and read against a goal in
hours. Health has no type for it, so it is the app's own record (`fasts`), and
it travels with the health record (`HEALTH_SYNC_TABLES`) beside the food log it
is read with. Four decisions in it are load-bearing:

- **The start is never inferred.** The food log's times are when an entry was
  logged, not when it was eaten, so the last meal logged is offered as a start
  ("From last meal, 7:45 PM") and taken only on a tap.
- **Nothing grades a fast.** One bar colour under and past the goal, no
  streak, no "broken". Reaching the goal changes the line under the clock and
  sends one notification (`scheduleFastGoal`) that rings through quiet hours,
  like the medication notice, because it answers a question about a clock the
  person set.
- **The card costs nothing for somebody who never fasts.** It shows while a
  fast runs and through the day one ended on (`showsFastingCard`); starting one
  is in the Food log's options menu, not a setting to turn on.
- **The MCP reads fasts and never starts one** (`list_fasts`): the timer and its
  notification live on the phone, and a fast an agent started could ring.
- **The Lock Screen shows it on the running-timer activity** (`fastRun` in
  `liveActivity.ts`, behind the same switch as every other timer): a countdown
  to the goal, then a count up from the start under "Goal reached", since the
  fast goes on until it is ended. The swap at the goal changes the run, so the
  sync hook sets a timeout for it; nothing in a store changes at that moment.
  Done ends the fast (`fast:` in `deepLinks.ts`), and no Swift knows it is one.
- **Past fasts is a list, not a chart** (`FastHistorySheet`, `pastFasts`): each
  ended fast with its start, goal and length, newest first, and a tap to edit.
  No average or trend, for the reason nothing grades a single fast.

## One thing worth knowing before scoping the background half

`backgroundRefresh.ts` deliberately takes no weather read, because the location
permission sheet promises in as many words that the app reads location once a
day and never in the background. **A Health read makes no such promise, needs no
network and touches no location**, so it is the first outside reading in this app
that a background run could legitimately take. That is what would make "slept
five hours, so the day is already lighter before you wake up" actually happen
rather than appearing whenever the app is next opened. **The daily snapshot read
is not wired into the background:** it runs on the same three foreground
triggers as the others. (`checkWeighInTasks` is already in `catchUpPasses()` and
reads recent weights there, so a background run does reach Health once.)
Adding the snapshot is a change to make on purpose, with the permission string
re-read first.

## Time in Daylight

`daylightMinutes` on `readDailyHealth` is `HKQuantityTypeIdentifier.timeInDaylight`
(iOS 17+, an Apple Watch's light sensor), summed by the same collection query as
exercise time. It is named only behind `#available(iOS 17.0, *)`, since the pod's
floor is 15.1, and an older OS spends its slot in the countdown instead of
asking. Its one reader is the mood log's "Went outside" offer
(`moodDayContext.ts`), which only ever answers with a positive: a null is no
watch, an old OS, a refusal or a day not yet out, and is never "didn't go
outside". `runDietQuery` refuses a type whose `aggregationStyle` isn't
`.cumulative`, because a cumulative-sum query on a discrete type raises. An
install that allowed Health before this was added is not asked for it until
somebody taps the access row again, like every addition to `readTypes`.

The note has two settings of its own, in Settings › Health › Sleep:
`shortNightNoteEnabled` (on by default) and `shortNightMinutes` (6 hours by
default, 3 to 9 in half-hour steps), both in `src/utils/shortNight.ts`. The
defaults are what the note did before it was configurable, so nobody's menu
changes until they open the row. The threshold only moves where the line starts
appearing: it still never changes what the sheet pre-checks, and a null reading
is silent at every threshold. The switch is for the note and nothing else; the
`health` generator's sleep rule keeps its own threshold on its own sheet.

## Raw and cooked weights (`FoodNutrition.cooking`, `cookedState.ts`)

Rice triples in weight when it is cooked and chicken loses a quarter, so a panel written for one
state is wrong by that factor when a weight in the other state is typed against it. A food has one
panel, in whichever state its source stated, and `cooking` holds the two facts that relate the
states: `panelState` (which one the figures describe) and `cookedPerRaw` (cooked grams per raw gram).

- **The ratio is typed or measured by the person, never looked up.** There is no table of cooking
  yields, for the reason `FoodPortion` gives against a global density table: a yield differs by
  variety, method and how long it sat in the water. The panel editor offers a weighed batch (raw
  grams in, cooked grams out) that writes the ratio, the same shape as weighing a dish for
  `Recipe.cookedWeightG`. The MCP takes it as `cooking` on `set_nutrition_panel` and is told never
  to guess one.
- **A raw or cooked amount against a food with no ratio is refused, never read as plain grams.**
  "100 g cooked" parses as 100 g with a trailing word, so without `panelGramsFor`'s refusal the
  wrong state would be logged with nothing on screen to say so. `scalePanelToAmount` is the one
  caller and returns null.
- **The logged entry keeps the weight of the state the panel describes**, and its `servingText` keeps
  what was typed ("100 g raw"). A logged helping does not carry `cooking`, like it carries no
  portions: it is already scaled.
- **Weights only.** A `per100ml` panel takes no ratio (the editor hides the section), and a
  `perServing` panel needs `servingGrams`, the same refusal `takesStateAmount` makes for both. A cup
  of cooked rice is not converted: that is a portion's job (`FoodPortion`), in whichever state it was weighed.
- Recipes do not read it. A recipe line is measured against the food's panel by `panelMultiplier`
  as written, and a dish weighed after cooking is `cookedWeightG`'s job (`docs/arch/recipes.md`).
