# The mood and symptom log

What #1223 asked for, and the decisions it deliberately left open, resolved.
Read this before changing anything under `src/utils/moodLog.ts`,
`src/utils/moodInsights.ts`, `src/utils/moodTasks.ts`, `src/store/useMoodStore.ts`
or `src/screens/MoodScreen.tsx`.

The rules here are settled decisions with the reasoning attached. Don't
re-derive them from the code, and don't re-open one without a reason this note
doesn't already cover.

---

## Why it isn't a task

The issue got this right and it's worth not re-litigating. A mood entry has
nothing to complete, nothing to schedule and nothing to defer. It isn't a quota
either: `targetCount`/`progressCount` count *toward* a target within a day,
where this records an arbitrary value with no target to reach. What it is
closest to is a Logbook row, a record of something that happened, read in
aggregate rather than worked through.

So it's its own entity (`MoodLog`, `mood_logs`) and its own store, on the same
argument `usePersonNoteStore` is separate from `usePersonStore`: rows with their
own lifecycle that nothing else points at.

## The scope question, answered in two halves

The issue's one blocking question was freeform (user defines their own
trackables) against a fixed small set. Neither, exactly, and the split is the
design rather than a compromise:

- **The scale is fixed.** Mood is 1..5, the app's, not configurable. Its entire
  value is *comparability* — against your own other days, and against what you
  got done on them. A per-user scale ("1-10", "terrible..great", three faces)
  makes every number in `moodInsights.ts` incomparable along the one axis the
  feature exists to read, and the define-your-own-scale UI is most of what made
  the issue `effort:high`.
- **The vocabulary is yours.** A symptom is whatever you call it. No fixed list
  was ever going to guess "brain fog", and the freeform half costs a `trim()`
  and a case-insensitive match (`symptomKey`) rather than a tracker-builder.
  Severity is fixed 1..3 for the same reason mood is.

The corollary: **don't add fuzzy matching to `symptomKey`.** `groceryPlural.ts`
does that for a catalog the app is trying to *merge*, where being wrong costs a
duplicate row on a shopping list. Being wrong here silently folds two complaints
into one series in a chart somebody may be about to show a doctor.

## Reading the history back

The insights are computed over everything while the list under them showed the
last 20 entries and nothing else, so the screen could tell you your mood is
worse on days you log a headache while giving you no way to look at those days.
Three controls fix that, all local to the Mood screen rather than wired into
app-wide search — the symptom case is the strongest of the three wants and the
cheapest to answer where the contrast rows already are.

- **A symptom contrast row is a filter.** Tapping "headache" in MOOD WITH
  SYMPTOMS narrows the list to the entries carrying it. The row is the obvious
  entry point because it is the thing that raised the question.
- **`moodLogMatches` is a substring match, not `fuzzySearch`.** Fuzzy ranks a
  result list; this decides membership of a filtered one, where a near miss
  silently dropping a day is the failure that matters. Same reason `symptomKey`
  refuses to guess: a history is read to check something, so it must not quietly
  answer about a different set of days than the one asked for.
- **The date is how "jump to a month" is answered.** `moodLogMatches` searches
  the entry's date written out in both a long and a short form, so "august"
  narrows to August and "aug" works too. A date picker over a list that already
  has a search field would be a second control for one want.
- **The list pages rather than uncapping.** The screen is a `ScrollView`, not a
  `FlatList`, so rendering a year of entries at once is a real cost for a
  surface nobody scrolls to the end of. `MOOD_PAGE` more at a time, and the
  filter is applied before the page rather than after — paging a filtered list
  is the whole point, and filtering a page would search the last 20 entries.

## Renaming a symptom

The vocabulary is derived from the entries (below), so there is no registry row
to correct and a typo would otherwise be permanent: log "headche" once and it is
in your suggestions forever and is its own series in every contrast.

`renameSymptomInLogs` decides the whole rewrite before anything is written, and
`useMoodStore.renameSymptom` applies it. Three things hold it:

- **It is the one action that edits what a past entry says**, which is allowed
  where moving `dayKey` or `loggedAt` is not. The line: a rename changes what
  you called something, not which day it happened on, so every correlation
  re-reads the same days afterwards. It still confirms first, with a count —
  somebody agreeing to rewrite their own history should be told how much of it.
- **The merge case is the feature, not a side effect.** `symptomKey` must keep
  refusing to guess that "head ache" and "headache" are one complaint. The
  honest consequence of refusing to guess is that the user needs a way to say
  so, and this is it: they are the same when you say they are.
- **Two names collapsing on one entry keep the worse severity**, the rule
  `daySymptoms` already applies to a day. One complaint you named twice, at the
  worst it got, not two.

## The vocabulary is derived, not a registry

`symptomVocabulary` reads the entries. This is the one place the feature
deliberately departs from `tag_registry`, which exists so a tag on no task
doesn't disappear — the user *named* it as a thing that exists. A symptom is
named by having happened, so the honest vocabulary is exactly the set of things
that have happened: nothing to migrate, nothing to prune, and a symptom logged
once three years ago drops off the suggestions by itself.

## Several entries a day is the normal case

Mood moves through a day. An app allowing one entry per day would be asking you
to average your own morning and evening before typing anything. So the entity is
stamped with an instant and every daily read collapses the day itself
(`dayMoodAverage`, `daySymptoms`) rather than the schema pretending there is one.

`daySymptoms` reports a symptom at **the worst it got** that day. A headache
that started mild and ended severe was a severe-headache day; averaging the two
reports a day nobody had.

## `dayKey` is stamped, never derived on read

`MoodLog.dayKey` is written at insert time from `dayResetTime`, and
`updateLog` deliberately cannot change it or `loggedAt`.

Deriving it on read would mean moving your day boundary to 02:00 silently
rewrites which day last month's late-night entries belong to, shifting every
correlation under a feature whose only job is to be a truthful record. Same
reasoning `completedAt` follows.

The read side has the matching rule: `completionDayKey` puts a *completion*
on its logical day too. Without it, every night's completions file against the
wrong day's mood for anyone whose day doesn't start at midnight — and unlike a
misplaced task that never looks like a bug, just like a weak correlation.

## What the insights are allowed to claim

`moodInsights.ts` is the half that justifies this living in a to-do app: every
number in it is a join between the mood log and the task history, which is the
one thing a standalone mood tracker can never do.

**Everything there is an association and none of it is a cause**, and that's a
correctness constraint rather than a disclaimer to print under a chart. Three
rules hold it, and none should be relaxed to make the screen look fuller:

1. **Nothing below `MIN_PAIRED_DAYS` (10) paired days.** With four days every
   pair of variables correlates at something eye-catching.
2. **A direction and a strength, never a coefficient.** `r = 0.42` reads as a
   finding to somebody who last met the word at school.
3. **A day you didn't log is not a zero.** It's absent, in every read. This is
   a property of the data (`pairedDays`) rather than a thing each caller has to
   remember, because treating a gap as a zero is the easiest way to invent a
   trend out of a fortnight of not opening the app.

`correlation` returns null on zero variance rather than 0 — "no relationship"
is a claim, and there's nothing there to have one. Contrasts need
`MIN_CONTRAST_DAYS` on *both* sides: a symptom logged twice says nothing about
its days, and a category completed every single day has no "without" to compare
against. They sort by the size of the gap in either direction, since "the days
I do chores are noticeably worse" is exactly as interesting as the reverse and
a one-sided sort would only ever show good news.

## The two generators

Both in `src/utils/moodTasks.ts`, both day-keyed with no source row (the
position `calendarReview` is in), both firing from one pass
(`checkMoodTasks`) because they read the same data. Both ship **off**.

`moodLog` is ordinary: once a day, a task to write it down, cleared when the
day is already logged and completed by logging (`completeMoodLogTaskForToday`).

The pass lives in `catchUpPasses()` (`src/utils/maintenancePasses.ts`), so it
runs at launch, on foreground, **and in a background refresh** — which is the
right group for it and worth stating: a daily check-in whose whole value is
being on the list when you first look at your phone should not wait for you to
open the app. It reads a store rather than a snapshot some foreground effect
fills in, so unlike the calendar, weather and screen-time passes beside it, it
does real work in a background run. `useTaskStore.initialize()`'s fan-out loads
the mood log, which is what makes that true.
It carries `dundundun://mood?log=1` so the row opens the sheet that answers it —
without that the only thing to do with a check-in is tick it, which marks the
question answered while recording no answer.

`moodLogTimeSegment` holds the check-in back until a part of the day, the same
setting and the same shape `calendarReviewTimeSegment` has, read once at
creation so changing it shapes the next check-in rather than moving the one
already on today's list. "How are you doing?" answered at 7am is a different
record from the same question in the evening, and the evening is the one most
people want — but it **defaults to any time**, because the generator shipped
before the setting did and a default that moved the task would change the day
for everyone already using it. Choosing the evening is one tap in Settings.

**`moodNudge` deliberately has no counterpart.** It asks about the week rather
than the day and fires at most once a week, so holding it until an hour of the
day buys nothing.

**`moodNudge` is the one to read before changing.** It's the only generator in
the app whose trigger is a *trend in the user's own answers* rather than a date,
a row, or a threshold crossed once, which makes it the only one that can be
wrong about a person rather than about their data. Three rules:

1. **It never names a feeling back at you and never diagnoses.** The task is
   "Plan something you enjoy this week". Not "You've been down for 4 days", not
   a suggestion to see anybody, and it does not carry the word depressed,
   anxious or unwell. The app knows you tapped a 2 four times; that is all it
   knows. `moodTasks.test.ts` asserts this directly.
2. **One task, once a week at the very most** (`MOOD_NUDGE_COOLDOWN_DAYS`), and
   the day is stamped *before* the write. A generator firing on a low patch is
   the last thing in the app that should pile up, because the person it lands on
   is by construction having a bad week — and handing back a nudge they swiped
   away is the one place in the app where that would be actively unkind.
3. **The run counts logged days only** (`lowMoodRun`), and requires today itself
   to be logged and low. Closing the app for a fortnight neither builds a run
   nor breaks one, and a run that ended on Tuesday is a statement about the past.

`LOW_MOOD_AT_OR_BELOW` is 2, not 3: "OK" is not a bad day, and a threshold
catching it would have the app offering to cheer up somebody who said they were
fine.

## Backdating, and the picker's new ceiling

`addLog` takes an optional instant; the sheet's Day row is how a person reaches
it. The day you forgot to log is the obvious thing to want, and without the row
a missed day was unloggable for good.

Two rules hold it:

- **The Day row shows only for a *new* entry.** `updateLog` deliberately cannot
  move `dayKey` or `loggedAt` (see above), so offering to change the day while
  editing would be a control that silently does nothing.
- **`WhenPicker` gained `allowFuture`, the exact mirror of `allowPast`.** An
  entry records how a day went and Thursday has not gone yet, so the mood sheet
  is the first caller to pass `allowFuture={false}`: the grid dims future cells,
  the forward chevron stops at this month, the natural-language field refuses a
  future date, and the Tomorrow quick button is hidden rather than left offering
  a day the grid won't take. The ceiling helpers (`isDayAfter`,
  `clampMonthToLatest`, `canPageToNextMonth`) sit beside the floor ones in
  `calendarGrid.ts`, written as their own trio rather than generalising both
  into a range — the two are always used independently.

A backdated entry records **noon** on the picked day, for the reason
`DriftScreen` parks its dates there: a date on a day boundary can be dragged
across it by a timezone or a DST hour, and which day it belongs to is the one
thing this entry must get right. And only a *today* entry completes the daily
check-in task — filling in the day you missed is not today's check-in.

## The one place it reaches back into Today

`lowMoodDeloadNote` puts one line under "Lighten today" in the Today options
menu, and the same line at the top of `DeloadSheet`, while a low run is going.
That is the whole of the feedback loop, and the shape is the argument. Three
things it deliberately is not:

- **Not a banner.** `ProjectNudgeBanner` was removed for good reasons: a strip
  above the list can't be deferred or dismissed per-thing and holds the header
  slot whether or not now is the moment. This is a line inside a menu the user
  opened, next to an action they were already considering, so it cannot nag.
- **Not a second nudge task.** `moodNudge` is the generator, and its rule is one
  task a week at the very most.
- **Not a change to what the deload plan pre-checks.** This was the tempting
  version: let a low run auto-check the soft-blocked rows too. Those blockers
  are `streak`, `started`, `high-priority` and `people` — so that version breaks
  a twelve-day streak, or moves something somebody else is waiting on, because
  you tapped a 2 three times. **Offering the sheet is help; deciding what comes
  off the day is not the app's call.** Don't wire the run into
  `buildDeloadPlan`'s defaults.

It needs no settings switch of its own: it appears only if you have been logging,
only inside a menu you opened, and it adds no row anywhere.

## It syncs, and it hides

`mood_logs` is in `SYNC_TRACKED_TABLES`. Half a person's health record on each
phone, with every correlation computed off whichever half, is worse than the
Stats-history split `focus_session_log` is tracked to avoid.

The Mood screen is a `contentScreen` in `simpleMode` — like People and Stacks,
it holds rows that live nowhere else, so hiding it while it holds any would
strand them.

And `checkMoodTasks` refuses to run in demo mode, like every other
time-triggered generator: demo mode swaps the database, so a demo session's
entries are fiction and a task written off them would persist there as a claim
about the real person.
