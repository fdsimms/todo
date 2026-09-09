# Reading (mostly) and writing (once) Apple Health

The whole of it: the bridge, the store, the Settings section, the row on Today,
the Mood screen's health axis, the `health` generator, the short-night line
under "Lighten today", and the one thing this app writes back — a
dietary-water sample, on completion of a task that opted into it — plus the
rules any further reader or writer has to be built against.

Read this before touching `modules/todo-health-bridge/`,
`src/utils/healthBridge.ts`, `src/utils/healthCompletionSync.ts`,
`src/store/useHealthStore.ts`, `src/screens/settings/HealthSettings.tsx`,
`healthContextRows` in `src/utils/dayContextRows.ts` or the health half of
`src/utils/moodInsights.ts` — and before adding any reader *or writer* of a
health figure anywhere else. Most of what follows is about what a reader is
allowed to claim rather than about how to get the number; the "Writing
exactly one thing" section is the one place the concerns are about a writer
instead.

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
reading is its absence. (A demo task can still carry `logWaterMl` — see the
next section for why that's a different case.)

## Writing exactly one thing: dietary water

Everything above this section is still exactly true: every read stays
read-only, and this app never infers, diagnoses, or has an opinion about a
body from a number it read. What changed is that the app now *writes* one
thing of its own — a dietary-water sample, when a task the user set up to log
it completes — and that capability earned enough new rules to need its own
section rather than a footnote on the reading ones.

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
- **There is one write type, and adding a second is not a small decision.**
  `writeTypes` in the Swift module is deliberately not generalized the way
  `readTypes` is (a `Record` keyed by an ever-growing metric union) — a share
  type is a real consequence landing in somebody's actual Health record, so
  each one earns its own review rather than riding in with whatever the read
  side happens to be reading that month. `dietaryWater` is the one type
  today, chosen because it's the one thing a "drink water" task has an
  unambiguous, undisputed amount to write — there's no equivalent obvious
  number for, say, a stretching task.
- **The write is triggered from exactly one place, opt-in per task, and
  one-shot.** `Task.logWaterMl` (a number, not a boolean-plus-amount pair,
  so "off" and "log 0mL" can't become two different ways to say nothing
  happens) is read only by `completeTask` in `useTaskStore.ts`, which calls
  `logTaskWaterToHealth` (`src/utils/healthCompletionSync.ts`) the moment a
  task is marked completed — the exact shape `logTaskCompletionToCalendar`
  already established for the completion-calendar event beside it, copied
  deliberately rather than reinvented. Like that one, it is a historical
  record with no delete-on-uncomplete and no reconciler: nothing calls it
  from anywhere else, because a caller that looped it into a save or an edit
  path would write water nobody drank.
- **`healthBridge()`'s demo-mode gate is sharper for this write than for any
  read it already covered.** The gate's own module comment used to describe
  the worst case a leak could cause as "a true number in a fictional
  context" — survivable, because nothing was created. A write leak is worse
  in kind, not just in degree: a demo-seeded task completing during a demo
  session would put a *real* sample, sourced from a completion that never
  happened, into the person's *actual* Health record, outliving the demo
  session by however long until they happen to notice and delete it by hand.
  `logTaskWaterToHealth` checks `isDemoModeActive()` first, before anything
  else, for exactly this reason — see its own doc comment.
- **A demo task may still carry `logWaterMl`, and that's not a contradiction
  of the demo-mode gate above.** The gate stops the *write*; it says nothing
  about whether a seeded task's fields may show the feature exists. Since the
  write path refuses unconditionally in demo mode regardless of what
  `logWaterMl` holds, seeding a demo "Drink water" task with it set
  demonstrates the setting exists (opening its editor shows "Log water to
  Health" already on) without ever being able to trigger the write it
  describes — the same reasoning that lets `demoSeed.ts` seed
  `logCompletionToCalendar` on a task despite the calendar write it names
  being equally gated.
- **App Store's Info.plist strings had to change, not just get a second
  key.** `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`
  (`app.json`'s `ios.infoPlist`) both used to say, truthfully at the time,
  that nothing was ever written. Now that something is, both strings say what
  is actually read and actually written — see `plugins/withHealthKit.js`'s
  own comment for why the update string was already required (App Store
  Connect's Info.plist validator scans for the `requestAuthorization
  (toShare:read:)` selector being linked at all, whether or not anything is
  ever passed in `toShare`) even back when it was never truly exercised.

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

Steps, sleep, and eight nutrients (sodium, protein, saturated fat, fiber,
sugar, caffeine, water, calories) — nothing past those ten. The read-type list
is one place (`readTypes`) and the note beside it says what adding to it
costs; every metric this file still rules out — resting heart rate, HRV,
weight, glucose, cycle tracking — stays ruled out for the reason given there,
which is that a generator firing on one of them can be wrong about a body
rather than about a day. The set of read types is one list in the Swift
module (`readTypes`) because the permission sheet is shown once for whatever
is asked for, and a type added there is a type the sheet will list — so
nothing goes in until something reads it.

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

**None of this bears on `writeTypes`, which stays at exactly one and follows a
stricter version of the same "don't add until earned" rule.** A sixth read
metric costs a bigger permission sheet; a second write type costs a real
sample landing in somebody's actual Health record if anything about it is
wrong. See "Writing exactly one thing: dietary water" above for the argument
in full — it is deliberately not summarized here, because collapsing it to a
sentence is exactly the kind of thing that invites re-deriving it wrong later.

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
