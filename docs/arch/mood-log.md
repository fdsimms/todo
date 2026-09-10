# The mood and symptom log

What #1223 asked for, and the decisions it deliberately left open, resolved.
Read this before changing anything under `src/utils/moodLog.ts`,
`src/utils/moodInsights.ts`, `src/utils/moodHistory.ts`, `src/utils/moodExport.ts`,
`src/utils/moodTasks.ts`, `src/store/useMoodStore.ts`, `src/screens/MoodScreen.tsx`,
`src/screens/MoodHistoryScreen.tsx`, `src/screens/SymptomDetailScreen.tsx` or
`src/components/MoodLogSheet.tsx`.

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

## The vocabulary is derived, not a registry

`symptomVocabulary` reads the entries. This is the one place the feature
deliberately departs from `tag_registry`, which exists so a tag on no task
doesn't disappear — the user *named* it as a thing that exists. A symptom is
named by having happened, so the honest vocabulary is exactly the set of things
that have happened: nothing to migrate, nothing to prune, and a symptom logged
once three years ago drops off the suggestions by itself.

## Context tags — the non-symptom half of "why might today be like this"

`LoggedSymptom` answers "what hurt". `MoodLog.contextTags` answers a
different question: things going on that day that aren't symptoms but
plausibly explain the mood anyway — "vacation", "travel day", "big deadline
at work". Same freeform, `symptomKey`-style match as symptoms (`contextTagKey`
is a plain alias of it), same derived vocabulary (`contextTagVocabulary`),
same day collapse (`dayContextTags`), same contrast shape on the Mood screen
(`contextTagMoodContrasts`, built off the same `contrastsFor` symptoms use).
It is a second freeform field next to symptoms rather than a fold into
`symptoms` itself, because a tag carries no severity — "vacation" is not mild
or severe, it either applies to the day or it doesn't — and folding the two
together would mean every reader of symptoms has to branch on whether a
`severity` is meaningful for the row it is holding.

**One deliberate departure from the symptom vocabulary's zero-registry
rule:** `DEFAULT_CONTEXT_TAGS` is a small fixed list ('Vacation', 'Travel',
'Sick', 'Poor sleep', 'Big deadline', 'Social event') merged into the pill
grid alongside whatever has actually been logged. Symptoms start every
account with an empty grid on purpose — no fixed list could guess "brain
fog", so there was nothing worth seeding. Context is different: the useful
half of this feature is realizing a mundane thing might be worth naming at
all, and a blank grid on day one teaches nobody that. The list is not
storage, not a registry to prune, and not read anywhere but the sheet's pill
grid — it is a constant, the same kind `MOOD_LEVELS` is, and it never
overrides what the log itself has accumulated (real usage sorts ahead of it
in `MoodLogSheet`'s pill ordering).

**The one auto-suggestion, and why it stops at one.** `MoodLogSheet`
pre-selects "Vacation" when opening a *new* entry while `vacationMode` is on
— visibly, as an already-picked pill the person can untap before Save, never
written silently. That is the same "offer, don't decide" posture
`lowMoodDeloadNote` takes below: the app can notice a fact it already tracks,
but the log stays the user's own record of what they think was going on, not
an automated inference dressed up as one. It is scoped to exactly one signal
on purpose. Vacation mode is a clean boolean the app already owns and gets
right on its own terms (see the vacation-mode note in the tasks
architecture); most other "obvious" candidates are not nearly as clean —
a missed-task-heavy day, a bad-sleep night from Health — and guessing wrong
on those reads as the app telling somebody why they feel a certain way, which
is exactly what `moodInsights.ts`'s association-not-cause rule exists to
forbid. Widening the source list is a real feature decision each time, not a
default to reach for.

The suggestion only fires for a *new* entry on **today**. Editing an existing
row must never retroactively add a tag it didn't say (same reason the Day
row itself only shows for a new entry), and a backdated entry records how a
past day went — the app's *current* vacation state says nothing about
whether last Tuesday was one.

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

`moodLogTimeSegments` holds the check-in back until a part of the day, the
same shape `calendarReviewTimeSegment` has for its one segment, read once at
creation so changing it shapes the next check-in rather than moving the one
already on today's list. "How are you doing?" answered at 7am is a different
record from the same question in the evening, and the evening is the one most
people want — but it **defaults to any time (empty)**, because the generator
shipped before the setting did and a default that moved the task would change
the day for everyone already using it. Choosing the evening is one tap in
Settings.

Unlike `calendarReviewTimeSegment`, this one is a list rather than one value:
picking several segments holds back a task per segment instead of one for the
whole day, "several entries a day is the normal case" (above) applied to the
question that asks for one. Only the *current* segment's task is ever live —
`checkMoodTasks` computes it fresh each pass (`currentTimeSegment`, the latest
configured segment whose threshold has arrived) and clears any other today
before deciding whether to write the current one, the same clear-first rule
that already dropped yesterday's leftover. An earlier segment's unanswered
check-in is a question about a part of the day that's passed, not a task
still owed — the day-to-day rule, one level down.

The sourceId carries the segment (`${dayKey}:${segment}`, `moodLogSourceId`)
rather than the day alone, so `moodLogLastDayKey` — despite the name, holding
the whole sourceId, not just the day — still works as "the slot already
decided" once a day can hold more than one, and two segments' generated rows
never collide. "Already answered" is scoped to the segment for the same
reason a symptom's severity is scoped to the day it happened on: an entry
made during the morning must not silence the evening's check-in, so the test
is "logged since this segment's threshold" (`hasLoggedSince`), not "logged
today at all" (`hasLogOnDay`, which the any-time case still uses, since it
has no narrower slot to ask about).

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

## The log has to be readable back, and for a while it wasn't

The Mood screen shows the newest twenty entries and used to show *only* those.
An entry past that was unreachable — not viewable, not editable, not deletable
— and for anybody logging morning and evening that is ten days, in a feature
whose entire value is the months behind it. `MoodHistoryScreen` is the whole of
it, grouped by day, and it is a `SectionList` rather than the Mood screen's
`ScrollView` because it is the one mood surface with no ceiling on its length.

**The filter is a sheet of wrapping chips**, per CLAUDE.md's rule, and the
symptom vocabulary is the clearest case that rule has: it is whatever the user
has ever typed, so no phone-width scroll row can assume a ceiling for it. The
chips are multi-select and `ChipFilterSheet` is the shared shell they live in —
`LogbookFilterSheet` and `RecipeTagFilterSheet` predate it and still carry their
own copies of the same 150 lines of sheet chrome.

Two rules on the filtering itself, both in `moodHistory.ts`:

- **It filters entries, not days.** Several entries a day is the normal case, so
  a day holding a cheerful morning and a rough evening is a day you want shown
  as its rough evening when you have asked for the low ones. Collapsing to the
  day first would answer with `dayMoodAverage`, which is a number nobody logged.
- **An entry with no mood never matches a mood filter.** It is not a 3, the same
  rule `dayMoodAverage` already holds one file over.

## The symptom page, and why it has no threshold

A symptom had no page. It appeared in the log sheet's pill grid, and — only past
`MIN_PAIRED_DAYS`, and only if it made the top four by gap size — as one row of
`symptomMoodContrasts`. So the ordinary question a person tracking a symptom has
("how often is this happening, and is it getting worse?") had no answer anywhere,
while the far stronger claim about its relationship to their mood did.

`SymptomDetailScreen` answers it: days, last logged, worst it reached, a
fortnight strip at the day's worst severity, the severity breakdown, and every
entry carrying it. The Mood screen reaches it two ways, and it needs both — the
contrast rows (top four, gated), and a plain `SYMPTOMS` directory built from
`symptomStats`, without which a symptom logged three times is on no screen at
all.

**Everything on that page above the contrast card is a tally, and a tally has no
minimum.** `moodInsights.ts`'s three rules govern *comparisons between two
variables*; counting one variable is not a comparison, so `MIN_PAIRED_DAYS` has
no business gating it and does not. A person who has logged a headache twice is
entitled to see both of those days. The one card that is a comparison comes
straight out of `symptomMoodContrasts` with its own gates intact, rather than
being recomputed loosely because the page is about one symptom.

## A purged task record is absent, not zero

`completedRetentionDays` deletes completed rows on a schedule. The mood log is
never purged. So an install with a retention window accumulates days that carry
a real mood and no rows to say what was done on them — and counted as zeros,
those days drag every completion read toward "you finish nothing when you feel
like that". It is rule 3 of `moodInsights.ts` breached by the app's own
housekeeping rather than by a gap in the data, and nothing else in the app would
have noticed: the numbers stay plausible, they just quietly stop being true.

`buildMoodDays` takes `completionsKnownFrom` (the retention cutoff as a day key,
null when retention is off) and nulls `completed`, `categories` and `taskKeys`
for every day before it. Three consequences worth not re-deriving:

- **`MoodDay.completed` is `number | null`**, and the null is only ever this.
  Zero stays a real zero: a day is in the set at all because something was
  logged or finished on it, so "none finished" is something that happened.
- **`taskPairedDays` is separate from `pairedDays`**, and only the reads about
  what got done use it. Narrowing the symptom and context contrasts to the
  retention window would throw away years of good symptom history to fix a
  problem they do not have — they only ever touch the mood side.
- **The clearing happens after the count**, so a row that outlived the window
  (an archived one, or a decision task holding an answer) cannot make a purged
  day look like a fully recorded one with a single completion on it.

The Mood screen says how many logged days this drops, under the card it affects.
A correlation drawn over half a record is a different claim from one drawn over
all of it, and the person who set the window is the only one who can decide
whether that matters.

## Mood against one repeating task — the medication question, answered without a medication feature

`taskMoodContrasts` is `categoryMoodContrasts` one level down: your mood on the
days you finished a particular repeating task, against the days you didn't. It
is the app's answer to the thing every symptom tracker builds a separate feature
for. **A tablet, a supplement, a stretch or a walk is already a repeating task
here**, so "how do the days I take it compare" needs no schema, no second
vocabulary and no pill-shaped UI — and a tracker that asks you to log the
tablets again, in its own list, next to the task reminding you to take them, is
asking for the same fact twice.

- **Membership is a task *series*, not a row.** Completing a recurring task
  spawns a new row, so a fortnight of "Take the tablets" is fourteen ids unless
  something walks them back to one. `taskIdentityKey` does that — series first,
  then the root of the `previousOccurrenceId` chain — the same collapse
  `projectProgress` makes, resolve-or-shrug at every step like every other chain
  walk in the app.
- **One-offs are excluded by the existing gate rather than by hand.** A task
  completed once has one "with" day and `contrastsFor` needs
  `MIN_CONTRAST_DAYS` on both sides. Filtering on `recurrenceType` instead would
  be wrong twice: a task repeated by hand every morning is exactly as real as
  one carrying a rule, and a rule added yesterday says nothing about the
  fortnight behind it.
- **It is labelled by the most recent occurrence's title**, so a task since
  renamed reads under the name in use now. The identity is the chain, not the
  wording.

## Mood against what you ate

The food log is the third dataset the insights read, after the task history and
Apple Health, and it arrives on the same terms as Health: `foodDayInputs`
(`nutritionStats.ts`) hands `buildMoodDays` a row per day, and those rows
**decorate days that already exist and never create one**.

The reason differs from Health's and is worth having written down, because the
obvious objection is a good one. A step count is ambient — recorded whether or
not anybody was paying attention — which is exactly why folding ninety of them
in must not conjure ninety days into the set. A food entry is nothing of the
sort: somebody typed it. It still stays out of the union, because the union is
what `completed: 0` is charged against, and a day somebody logged lunch on and
finished nothing is not evidence about their task load. Nothing is lost by it:
every read needs a mood or a completion beside it anyway, so a food-only day has
nothing to be paired with.

**Two rules decide whether a day gets a row at all**, both enforced in
`foodDayInputs` and both about the same thing — a figure that looks like a
measurement and isn't.

- **A day logged past one meal, or no row.** This is the one that matters.
  `nutritionStats.ts` already refuses a one-meal day from its own averages
  ("a smaller number that is not a smaller day"); paired against a mood, that
  same wrong number does considerably more damage, because it is how "your mood
  is lower on the days you eat less" gets manufactured out of the days somebody
  stopped logging at 11am. It is rule 3 above with a second face: an unlogged day
  is an obvious hole, where a half-logged day arrives looking like a small
  number. One constant (`COMPLETE_DAY_SLOTS`) answers for both readers, because
  a day either stands for a day's eating or it doesn't.
- **A nutrient only counts for a day every entry stated.** A total covering five
  of seven entries is fine on the day's own card, where `describeFoodLogTotals`
  prints the clause saying so. Across days there is nowhere to print one and the
  coverage varies day to day, so the variation reads as variation in the food.

Unlike the averages on Stats, **today is kept**: that window stops at yesterday
because a partial day drags a mean down, and this one is paired rather than
averaged with the two-meal bar already asking that question.

**The vocabulary is four nutrients and that is a cap, not a starting point.**
`NUTRIENT_INSIGHT_KEYS` is calories, caffeine, sugar and protein. Ten nutrients
against two outcomes would be twenty comparisons over the same thirty-odd days,
and at that width a couple land at something eye-catching by arithmetic alone —
`MIN_PAIRED_DAYS` guards each comparison from being built on too little, and
nothing guards a screenful of them from the one that happened to hit. Widening
it is a real feature decision each time, on the same terms this note sets for
the log sheet's one auto-suggestion.

`nutrientInsight` and `healthInsight` are two typed doors onto one body
(`insightFor`), which is what stops the rules drifting apart between an activity
reading and a nutrient. Two cautions are particular to this axis, neither
fixable and both reasons the copy stays descriptive: the day is one bucket, so
an evening mood entry sits inside a total that includes the dinner eaten after
it; and what somebody logs is not what somebody ate, so a person who logs more
carefully when they feel better has a correlation here that is about their
logging.

**`foodMoodContrasts` is the medication argument pointed at the plate.** That
section above exists because a tablet or a walk is already a repeating task
here, so "how do the days I take it compare" needs no second vocabulary. A food
you ate is already a food log entry here, for the same reason and with the same
payoff: this is the elimination-diet question, and every symptom tracker that
asks it makes you keep a whole separate food diary next to the log you were
already keeping. Grouped by the entry's own label, which is `mostLoggedFoods`'
choice and made for its reason — `itemId` and `recipeId` are null for anything
typed in.

Its second gate is the one that makes the answer mean anything: it runs over
`foodPairedDays`, not `pairedDays`, so "the days you didn't eat it" is days the
log would have said so. Against every mood day, this read would really be "the
days I logged my food against the days I didn't", with a food's name on it.

**It is behind `kitchenEnabled`**, which the Mood screen checks exactly as it
checks `healthReadEnabled` for the readings: the whole food half of the app is
behind that switch, and reading a log somebody has switched away from to tell
them about their eating is the same mistake as reading Health without
permission.

**Symptoms are deliberately not contrasted against food.** `foodMoodContrasts`
compares *mood*, and the same machinery pointed at `symptomKeys` would say "you
had a headache on most of the days you ate bread" — which is the one claim on
this screen that a person would reasonably act on medically, off a self-reported
food diary. It is a real feature decision rather than a gap, and it is the one
this note would want re-opened deliberately if at all.

## Getting it off the device

`moodExport.ts` writes the log as CSV and hands it to the share sheet. This note
says elsewhere that the app must not fold two spellings of a symptom together
because the chart is one somebody may be about to show a doctor — and until this
existed there was no way to show anybody anything. A backup is the wrong shape
twice over: it is JSON for `parseBackup` to restore from, and it is the whole
database, so handing one to a clinician means handing over the shopping list and
everybody's birthday too.

- **One row per entry, and no day is collapsed.** A screen averages a day
  because a screen has to show one number. A record has no such excuse, and the
  morning that was fine is part of what happened.
- **Oldest first**, unlike every list in the app. A record is read forwards.
- **Nothing derived, and above all nothing from `moodInsights.ts`.** Those are
  associations that carry their sample size and their hedging in the UI around
  them; a spreadsheet cell holding "moderate" with none of that is exactly the
  overclaim the association-not-cause rule exists to prevent. What leaves the
  device is what the user typed.
- **The scale is spelled out** — the number and its label, severity as its word
  — because "2" means nothing on a page on its own.
- The file goes to the cache and is deleted the moment the share sheet closes,
  exactly as the backup export does. A health record accumulating silently in
  the app's own storage would be a second copy of the most sensitive thing here.

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
`StuckScreen` parks its dates there: a date on a day boundary can be dragged
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
