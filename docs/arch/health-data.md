# Reading (mostly) and writing (three times) Apple Health

The whole of it: the bridge, the store, the Settings section, the row on Today,
the Mood screen's health axis, the `health` generator, the short-night line
under "Lighten today", the Weight screen and its chart, and the three things
this app writes back — a nutrient sample, on completion of a task that opted
into logging one; a body-mass sample, when somebody records a weight; and a
meal's nutrition, when somebody adds it to the food log — plus the rules any
further reader or writer has to be built against.

Read this before touching `modules/todo-health-bridge/`,
`src/utils/healthBridge.ts`, `src/utils/healthCompletionSync.ts`,
`src/utils/healthWeightSync.ts`, `src/utils/healthFoodSync.ts`,
`src/utils/weightLog.ts`, `src/store/useFoodLogStore.ts`,
`src/store/useHealthStore.ts`, `src/screens/settings/HealthSettings.tsx`,
`src/screens/WeightScreen.tsx`, `healthContextRows` in
`src/utils/dayContextRows.ts` or the health half of
`src/utils/moodInsights.ts` — and before adding any reader *or writer* of a
health figure anywhere else. Most of what follows is about what a reader is
allowed to claim rather than about how to get the number; the "Writing exactly
one thing", "The second write" and "The third write" sections are where the
concerns are about a writer instead.

The rules here are settled decisions with the reasoning attached. Don't
re-derive them from the code, and don't re-open one without a reason this note
doesn't already cover.

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
about it needed to change to widen from one nutrient to ten; what changed is
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
so it is asked for separately, gated separately, and triggered from exactly
one place.

- **Read and write authorization are asked for, and gated, completely
  separately.** `healthReadEnabled` and `healthWriteEnabled`
  (`useSettingsStore`) are two independent switches; `HealthSettings.tsx`
  renders them as two `SettingsSection`s; the native module's
  `requestAuthorization` (read) and `requestWriteAuthorization` (write) each
  pass an empty set for the half they aren't asking about, so turning on
  reading never puts a water-sharing row in front of somebody who only wanted
  their step count on Today, and vice versa. This is the same "two different
  permissions to give" rule `checkHealthTasks`'s own doc comment states for
  the read + generator switches, generalized one level up.
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
- **Granting read access can silently cost write access, for the types the
  two sides share, and this app cannot prevent it.** `readTypes` and
  `writeTypes` overlap on nine of the app's twelve HealthKit types — water,
  body mass, and the eight nutrients `writeNutrientSample` shares with the
  food-log write (everything except carbs and total fat, which are write-only
  and never read). Apple's docs say read and write authorization for one type
  are independent, but in practice, granting the *read* sheet for a type that
  already had *write* access can flip that write access to `sharingDenied` —
  observed for real, reported by a user whose Water/Weight write access
  (granted earlier, and working) disappeared after later granting read
  access, while Carbohydrates/Total Fat write access (write-only, no read
  overlap) survived untouched. This is a HealthKit/Health-app bug, not a
  mistake in this file's `requestAuthorization` calls — they already follow
  Apple's documented pattern (separate `toShare`/`read` calls, per the rule
  above), and there is no supported API to prevent the OS from doing this or
  to programmatically win the permission back once it's denied. Once
  it happens, the affected types can also fail to appear at all in the
  Health app's own Settings → Sharing list, even as a denied (off) toggle —
  so the one usual recovery path ("go flip it back on in Health") can be
  unavailable too, and the only fixes that have worked are a device restart,
  revoking and re-granting from scratch ("Turn Off All" on that same Health
  screen), or a full iOS privacy-settings reset.
  What this app *can* do, and does: `refreshWriteStatus()` in
  `HealthSettings.tsx` is called immediately after every read-authorization
  grant (`onToggle`, `askForAccess`), not only on focus/foreground, so a
  silently-revoked write permission shows up as "Not allowed" on this same
  screen right away instead of being discovered confused, weeks later,
  through Health's own UI. The read-access row also warns about this before
  it happens, when `healthWriteEnabled` is already on. Neither is a fix for
  the underlying OS behavior — there isn't one available here — only for how
  fast and how clearly the fallout is surfaced.
- **Adding a genuinely new share type is still not a small decision** —
  that part of the old rule holds. `writeTypes` in the Swift module is
  deliberately not generalized the way `readTypes` is (a `Record` keyed by an
  ever-growing metric union): a share type is a real consequence landing in
  somebody's actual Health record, so each one earned its own review rather
  than riding in with whatever the read side happened to be reading that
  month. What *did* turn out to be small was widening which of the
  already-reviewed ten a task may target, because none of them needed a new
  type — the review for all ten happened together, for the food-log write
  (see "The third write" below), before a task could reach any of them.
- **The write is triggered from exactly one place, opt-in per task, and
  one-shot.** `Task.logHealthMetric` and `Task.logHealthAmount` (two fields
  rather than a boolean-plus-amount pair, so "off" and "log 0" can't become
  two different ways to say nothing happens) are read only by `completeTask`
  in `useTaskStore.ts`, which calls `logTaskHealthValue`
  (`src/utils/healthCompletionSync.ts`) the moment a task is marked
  completed — the exact shape `logTaskCompletionToCalendar` already
  established for the completion-calendar event beside it, copied
  deliberately rather than reinvented. Like that one, it is a historical
  record with no delete-on-uncomplete and no reconciler: nothing calls it
  from anywhere else, because a caller that looped it into a save or an edit
  path would write an amount nobody actually logged.
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
- **App Store's Info.plist strings had to change, not just get a second
  key.** `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`
  (`app.json`'s `ios.infoPlist`) both used to say, truthfully at the time,
  that nothing was ever written. Now that something is, both strings say what
  is actually read and actually written — see `plugins/withHealthKit.js`'s
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
  `writeAuthorizationStatus` now takes `"water" | "weight"`, because Health lets
  somebody allow one and refuse the other in the same sheet and a single
  "write access" answer would be false for whichever they declined. There are
  two access rows in Settings and still **one** app-level switch: "may this app
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

`readWeightSeries` is its own native function rather than an eleventh column on
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

The window is 180 days rather than the readings window's 90. That one is sized
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
nothing to compare, and cannot be wrong about a body. Adding it as an
eleventh `HealthRuleMetric` would have been the obvious shape and would have
put it back on the wrong side of the line: a rule metric is a thing the app
judges, and there is no judgement here.

## The third write: a logged meal

The one that closes the loop. The app has read eight nutrients since the
`health` generator shipped and written none of them, so the figures its own
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

### Ten write types, and carbs and total fat are two of them

`writeTypes` went from two to twelve in one review. The ten nutrients are one
capability rather than ten decisions, and they were argued for together.

**Two of the ten are written and never read.** Carbohydrate and total fat are
not in `readTypes`, no `HealthRuleMetric` watches them, and no screen shows
them. They are written anyway, and that is a decision made out loud rather than
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
- **The delete tallies its results on a serial queue.** Eleven deletes report
  back on arbitrary background queues, and getting the count wrong means
  telling the app a retraction succeeded when it did not, leaving a sample in a
  medical record.

  `readDailyHealth`'s own ten-way fan-out was counting down on a bare variable
  and got the same treatment in the same change. It had shipped that way and
  never been seen to fail, most likely because HealthKit happens to deliver
  those callbacks serially — but nothing documents that, and the failure it
  invites is silent in both directions: a lost decrement leaves the promise
  unresolved for ever, which reads as Health simply never answering, and a
  doubled one resolves it twice. The queue also supplies the memory ordering
  the final block needs to see ten arrays written on ten other threads.

### A correlation, not ten loose samples

A meal is one thing. `HKCorrelation` of type `.food` is the API for that, and
it is what makes an entry appear in the Health app as "Chicken burrito" (via
`HKMetadataKeyFoodType`) rather than as ten unrelated numbers at 12:47.

**Every symbol here was checked against Apple's own SDK headers, not against a
recollection or a search result.** `developer.apple.com` is unreachable from
the build sandbox, and the first search result for the initializer was an
iOS 8.3 API-diff page still describing `NSDate` and `Set<NSObject>` — exactly
the stale paraphrase CLAUDE.md's note about `GeneratedContent.elements()` warns
about. The headers in the iOS SDK are the authority, and they are reachable:
`HKCorrelation.h`, `HKObjectType.h`, `HKObject.h`, `HKHealthStore.h`,
`HKQuery.h` and `HKMetadata.h` between them settle the initializer, the
nullable `correlationType(forIdentifier:)`, `UUID`,
`deleteObjects(of:predicate:withCompletion:)` and
`predicateForObjects(with:)`. `HealthKit.apinotes` was read too, because it is
what would rename an argument label out from under a header, and it turns out
to remap nothing but an error enum.

That left one thing a header cannot settle on its own: whether Swift imports
`correlationWithType:startDate:endDate:objects:` as `start:`/`end:` or keeps
the Objective-C spelling. The importer's rule says it prunes them, and
`HKQuantitySample(type:quantity:start:end:)` in this same file is that rule
already compiling against an identically shaped factory — but a rule plus a
precedent is still an inference, and this is a file that cannot be compiled
from the sandbox. So it was checked against real Swift that does compile
(`HKCorrelationTests.swift` in Stanford's HealthKitOnFHIR), which constructs
`HKCorrelation(type:start:end:objects:)` verbatim. Nothing here ships on a
guess.

### The rules it inherits unchanged

- **`healthWriteEnabled` gates it**, the existing switch, separate from
  `healthReadEnabled`. Somebody who turned on step reading must not find a
  nutrition sharing sheet in front of them.
- **Demo mode refuses twice**, in `healthBridge()` and again at the top of
  `logFoodEntryToHealth`. Same reasoning as the nutrient write's, and a
  seeded food log entry may exist for the same reason a demo task may carry
  `logHealthMetric`: the gate stops the write, not the demonstration that the
  feature exists.
- **One trigger.** `addEntry` in `useFoodLogStore` is the only caller of
  `logFoodEntryToHealth`, and nothing else may become one. No reconciler, no
  sweep, no sync pass, and **no backfill**: entries logged before this shipped
  keep their empty `healthSampleIds` for good. A pass that wrote history would
  put samples in a medical record for meals nobody asked to share, and would
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
  reachable only through the entry's links, which is what `foodLogEntryEdit`
  decides on.
- **An entry with no link is not offered the editor, only a rename.** A
  described meal the model estimated, or a database food nobody filed, has no
  panel left to measure against. Offering its figures as fields to retype was
  the obvious alternative and is the one thing this must not do: a hand-typed
  panel going into a medical record is exactly the unmeasured claim the rest of
  this document refuses. Renaming is carved out because it claims nothing about
  how much was eaten — it changes the row's own words and the name its sample
  carries, which is why it still goes through `reviseEntry` rather than
  `updateEntry`.
- **The rewrite is skipped when nothing Health holds changed.** Moving the meal
  or re-filing the item touches no figure Health ever saw, and rewriting anyway
  would churn somebody's medical record for a field it never got.
- **A failed retract does not cancel the write.** The stale sample stays in
  Health, exactly as it does when a delete's retract fails, and is something the
  person can remove there. Skipping the write over it would leave Health holding
  only the figures that were just corrected, which is the worse of the two.

`atISO` and `dayKey` stay unpatchable on both paths. They were stamped together
from one instant under one reset time, and re-dating means a new entry.

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

- **It is deliberately not a second water write beside `logHealthMetric`.** That
  one is a task recording a nutrient when it is ticked, and this is somebody
  saying what they drank. Two mechanisms for one fact is what the issue was
  partly about; the answer was to give the log the one it was missing, not to
  fold the task side into it and make a caffeine task a meal.
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
them a way to contradict each other. `kitchenOnToday` and `mealsOnToday` exist
because their areas are on by default and have many surfaces; this one is an
explicit opt-in with exactly one.

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

**None of the eight nutrients (see below) join this axis.** `MoodDay` carries
no nutrient fields, and `healthInsight` gains no extra metric for any of them.
A join against mood asks whether a *pattern* correlates with how somebody
feels; a nutrient rule here is a person's own medically-set target, checked
against a number they picked, not a candidate for "no clear pattern" alongside
steps and sleep. Nothing about adding one is technically hard — it would be
one more pairing in `healthInsight` — the decision was that none of them
answers the same question steps and sleep do.

## The generator, and the line under "Lighten today"

`health` is generator #19 and its own rules live in
`docs/arch/generated-tasks.md`, which is where a twentieth generator's author
will look. Only the parts that are about *health* rather than about the
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

**Every shortfall task past steps carries the same note, and only sleep
carries a link too.** `checkHealthTasks` writes the metric's own note
(`healthTaskNote` in `healthRules.ts`, dispatching to `shortSleepDeloadNote`
for sleep and `nutrientReadingNote` for every one of the eight nutrients)
straight onto the row's own `notes`, so a sleep or nutrient task never reads
as coming from nowhere the way a bare title would. Only sleep also gets
`healthTaskLinkUrl`'s `dundundun://deload`, wired to `resetToDeload` in
`navigationRef.ts`, so tapping "Keep today light" opens the same `DeloadSheet`
the menu line points at. Steps carries neither field ("Go for a walk" already
names its own action), and none of the eight nutrients has a comparable sheet
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
that is what `HealthRule.checkpointHour` exists for.** Steps and sleep judge
from one fixed hour per metric (`HEALTH_METRIC_EARLIEST_HOUR`), because one
evening floor is what a step count or a night's sleep needs. A nutrient target
set by a doctor is routinely phrased as more than one number over a day — "at
least 2,000mg of sodium by lunch, 4,000mg by dinner" — which is two *rules*,
not one, and they need two different hours. Rather than growing a second
fixed map entry per checkpoint (and a third, and a fourth, the moment somebody
wants a mid-afternoon one too), every nutrient rule carries its own
`checkpointHour`, editable in `HealthRulesSheet` for any metric but steps and
sleep (`usesCheckpoint`, the one gate both the checkpoint stepper and the
direction control below share, for the identical reason).
`HEALTH_METRIC_EARLIEST_HOUR`'s entries for the eight nutrients still exist,
but only as the value a freshly-created rule starts from — steps and sleep
have no reason to follow, and don't.

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
a given metric starts from (a floor for everything, a ceiling for saturated
fat) — `healthRuleDirection(rule)` always resolves the two together, and
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
created rule starts from before the user can change it. Steps and sleep still
don't get the toggle — "over 3,000 steps" or "over 6 hours asleep" has no case
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

## What is deliberately not built yet

Steps, sleep, eight nutrients (sodium, protein, saturated fat, fiber, sugar,
caffeine, water, calories) and body mass — nothing past those eleven. The
read-type list is one place (`readTypes`) and the note beside it says what
adding to it costs; every metric this file still rules out — resting heart
rate, HRV, glucose, cycle tracking — stays ruled out for the reason given
there, which is that a generator firing on one of them can be wrong about a
body rather than about a day. The set of read types is one list in the Swift
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
  rate *they set* would have put it. That is a fact they could read off the
  chart, which is the standard `weightChange` already holds itself to. It
  carries no colour, no arrow and no advice, and `WeightScreen` must not add
  one.

The goal lives in the settings table rather than in Health, because it is not a
measurement: HealthKit has nowhere to put one, and nothing should read it back
as though somebody had recorded it. The weights it is measured against are
still Health's, and nothing about this stores one.

**The calorie estimate (`energyBudget.ts`) is the one thing here that takes a
figure about a body and hands back a number to act on**, so it is fenced twice
over. Every input is typed in by the person — height, year of birth, sex,
activity level, rate — and none is read from Health, which keeps `readTypes`
where it was and raises no new permission sheet. Nothing fills a field in:
a profile missing any part of itself produces null rather than a guess, which
is that module's whole discipline about defaults. And it **proposes rather than
writes**: `WeightGoalSheet` prints the arithmetic with its own working shown
beside it, and the figure only reaches `nutritionTargets.calorieKcal` when
somebody presses the button under it. Nothing re-applies it as a weight
changes. A target that silently tracked a formula would be a figure nobody
chose driving the food log, which is exactly what `nutritionTargets`' own note
rules out.

**The macro split follows the same rule and is where it was most tempting to
break.** `MACRO_PRESETS` names four common ways to divide a day's calories and
**preselects none of them**, because how somebody splits protein, carbs and fat
is a real dietary disagreement of exactly the kind `HEALTH_METRIC_DIRECTION`'s
note above refuses to take a side in. What the app can honestly do is what a
reference table does: name the splits, show what each works out to in grams
(`macroGrams`, by the Atwater factors, which are label arithmetic and not an
opinion), and let the person pick. Applying one writes the calorie target
alongside the three macros, since a macro target that doesn't add up to the
calorie figure it was split out of is three numbers with nothing holding them
together. The split itself is not stored: it is a one-off choice made when
applying targets, not a setting, and what persists is the four ordinary
`nutritionTargets` entries anybody can then edit or clear.

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

The four things this was built to make possible, in the order they are worth
doing, none of them started:

1. ~~A fourth `ContextRow` kind on Today.~~ Built, see above.
2. ~~`sleepHours` and `steps` on `MoodDay`.~~ Built, see above.
3. ~~A `health` generator (kind #18).~~ Built, see above.
4. ~~One line under "Lighten today" for a short night.~~ Built, see above.

Both of the product calls this note used to leave open have been made. Sleep is
read, with the cost of adding a type written down beside `readTypes`. And a task
*may* show its live figure and mark itself ready — as its own `TaskKind`, in
`isTimerReady`'s shape, never as a completion. See the section above for why
that shape and no other.

The eight nutrients (kind #19's non-steps, non-sleep metrics) are a fifth
thing this file's earlier "deliberately not built" list didn't anticipate,
added for a specific, medically-motivated request rather than as a general
widening of what this generator may watch — see the sections above for the
reasoning and the two lines (which metrics are eligible at all, and which way
a shortfall may point) it does and doesn't cross. Sodium and protein and
saturated fat came first; fiber, sugar, caffeine, water and calories followed
once the checkpoint-hour and direction mechanisms both already generalized
past three, which is why `HEALTH_METRIC_INFO` exists as a table rather than
five more hand-written switch branches.

**None of this bears on `writeTypes`, which is at twelve and follows a
stricter version of the same "don't add until earned" rule.** A twelfth read
metric costs a bigger permission sheet; a further write type costs a real
sample landing in somebody's actual Health record if anything about it is
wrong. The jump from two types to twelve was one review, not ten: the ten
nutrients are one capability (a logged meal) and were argued for together. See
"Writing what a task names: a logged nutrient", "The second write: body mass"
and "The third write: a logged meal" above for the arguments in full — they are
deliberately not summarized here, because collapsing them to a sentence is
exactly the kind of thing that invites re-deriving them wrong later.

## One thing worth knowing before scoping the background half

`backgroundRefresh.ts` deliberately takes no weather read, because the location
permission sheet promises in as many words that the app reads location once a
day and never in the background. **A Health read makes no such promise, needs no
network and touches no location**, so it is the first outside reading in this app
that a background run could legitimately take. That is what would make "slept
five hours, so the day is already lighter before you wake up" actually happen
rather than appearing whenever the app is next opened. It is not wired up: the
read runs on the same three foreground triggers as the others, and adding it to
`catchUpPasses()` is a change to make on purpose, with the permission string
re-read first.
