# Reading Apple Health

What is built so far (the bridge, the store and the Settings row), and the four
rules the rest of it has to be built against.

Read this before touching `modules/todo-health-bridge/`,
`src/utils/healthBridge.ts`, `src/store/useHealthStore.ts` or
`src/screens/settings/HealthSettings.tsx` — and before adding any reader of a
health figure anywhere else, because three of the four rules below are about
what a reader is allowed to claim rather than about how to get the number.

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

## What is deliberately not built yet

Step count alone, read for today, rendered in one Settings row. The set of read
types is one list in the Swift module (`readTypes`) because the permission sheet
is shown once for whatever is asked for, and a type added there is a type the
sheet will list — so nothing goes in until something reads it.

The four things this was built to make possible, in the order they are worth
doing, none of them started:

1. A fourth `ContextRow` kind on Today, beside `event`, `meal` and `kitchen`.
   `DayContextRow` already argues that a reading gets no tick box.
2. `sleepHours` and `steps` on `MoodDay`, so the existing correlation and
   contrast readers in `moodInsights.ts` gain a health axis for free.
3. A `health` generator (kind #18), structurally `screenTime` with the crossing
   replaced by a number the app reads for itself. The threshold is per rule, for
   `screenTime`'s reason and not `weather`'s: the number *is* the rule.
4. One line under "Lighten today" for a short night, under the three refusals
   `lowMoodDeloadNote` already lives by, including that it must **not** change
   what `buildDeloadPlan` pre-checks.

Two open questions this note does not answer, because they are product calls
rather than architectural ones: whether a quota task ("Walk 8,000 steps") may
show the live figure and mark itself ready (`isTimerReady`'s shape, never a
completion — nothing in this app ticks a task off by itself), and whether sleep
is worth reading at all given it needs a Watch.

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
