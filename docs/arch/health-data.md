# Reading Apple Health

The whole of it: the bridge, the store, the Settings section, the row on Today,
the Mood screen's health axis, the `health` generator and the short-night line
under "Lighten today" — and the four rules any further reader has to be built
against.

Read this before touching `modules/todo-health-bridge/`,
`src/utils/healthBridge.ts`, `src/store/useHealthStore.ts`,
`src/screens/settings/HealthSettings.tsx`, `healthContextRows` in
`src/utils/dayContextRows.ts` or the health half of `src/utils/moodInsights.ts`
— and before adding any reader of a health figure
anywhere else, because three of the four rules below are about what a reader is
allowed to claim rather than about how to get the number.

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
database about to be discarded. Nothing is seeded in `demoSeed.ts` for it, and
that is not an oversight: the feature writes no rows, so there is nothing a seed
could show, and the honest demo of a health reading is its absence.

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

## The generator, and the line under "Lighten today"

`health` is generator #18 and its own rules live in
`docs/arch/generated-tasks.md`, which is where a nineteenth generator's author
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

## What is deliberately not built yet

Steps and sleep, and nothing else. The read-type list is one place
(`readTypes`) and the note beside it says what adding to it costs; every metric
this file rules out — resting heart rate, HRV, weight, glucose, cycle tracking —
stays ruled out for the reason given there, which is that a generator firing on
one of them can be wrong about a body rather than about a day. The set of read
types is one list in the Swift module (`readTypes`) because the permission sheet
is shown once for whatever is asked for, and a type added there is a type the
sheet will list — so nothing goes in until something reads it.

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
