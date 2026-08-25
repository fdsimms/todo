# People: keeping in touch, without keeping score

The rules behind `Person`, `Task.personIds` and the birthday generator. Read
this before changing anything in the people area: most of what follows is a
list of things the feature deliberately does **not** do, and each one is the
reason a similar feature elsewhere is unpleasant to use.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. Settled decisions with the arguments attached: don't re-derive them from
the code, and don't re-open one without a reason the note doesn't cover.

---

## The problem this is solving around

The feature is easy to build. The reason to be careful is that almost every
existing take on it is unpleasant, and each one is unpleasant for a specific,
nameable reason:

- **They score people.** A health bar, a percentage, a streak. Something that
  can go down. A friendship becomes a number you are failing.
- **They rank people.** Sorting by "most neglected" turns reaching out into
  triage, and turns the list into a table of who you have let down worst.
- **They ask you to file people into tiers.** Sorting the people you love into
  castes is an unpleasant afternoon, and then the tiers sit there looking at you.
- **They make you declare a cadence.** Choosing "every 14 days" for your mother
  is a small confession, and then the app turns out to be right about it.
- **They bill you in guilt.** "94 days since Sarah", in red. Overdue is a word
  about debts, and a friend is not a creditor.
- **They demand data entry about your friends.** Logging every coffee is
  tedious, and the record starts to feel like surveillance rather than memory.

The governing idea, and it is not a new one in this codebase: **the app can
never know the state of a friendship. It only ever knows what got written down.
So it must never assert a state, only surface an observation with its reason
attached.** That is exactly the discipline `grocerySuggest.ts` applies to a
cupboard it cannot see into, where `probablyHaveReason` is a guess, recomputed
at read time, carrying the reason it thinks so, and asking rather than
asserting. Most of what follows is that idea pointed at a new noun.

## The seven rules

Each is anchored to a decision already made elsewhere in the app, which is the
argument for it: none of these is a new opinion.

**1. Lead with the good part. The gap is a side effect, never the headline.**
The primary artifact is a record of things you actually did together, not a
countdown to your next obligation. Same data, opposite feeling. The last-seen
date falls out of the history as its top row and is never computed and stored
as its own field, because the moment it is a field it becomes something to sort
by. *(The Logbook already exists; a person's history is that record, filtered.)*

**2. A date is a fact. A duration is a judgment.** "Last together: March 14"
helps you remember; "94 days ago" grades you. Dates and soft relative phrases
everywhere the number would arrive uninvited: list rows, generated task titles,
the widget, Search. **One exception, decided deliberately: the person's own
detail screen may state a day count plainly**, because opening it is an act of
going to look, and being told is what grades you. No colour meaning late, on
that screen either. Note that `describeProjectQuiet` renders the same thing for
projects, correctly, and that copying it onto a list row is the likeliest way
this still goes wrong.

**3. Nobody is added in bulk.** No address book import, not for privacy but
because pulling in 400 contacts is precisely what makes the feature cold: a
list you did not write, full of people you do not think about, which then has
to be sorted somehow. People are added one at a time, and the act of adding
somebody is the act of saying they matter. **That list is the only ranking the
feature contains**, which is why `PeopleScreen` is hand-ordered by `sortOrder`
and never re-ranked, the same rule `aisleOrder` and the category list follow.

**4. Every person starts with no cadence and no nudges.** `nudgeOptIn` is false
and `cadenceDays` is 0 on a new row, and nothing about a person may appear in
any nudge surface until that is explicitly changed. This is what keeps "who am
I neglecting" a question the app never asks, since most people have no cadence
to compare. *(`Project.nudgeOptIn`, word for word.)*

**5. Better: let the app offer the cadence rather than asking for one.**
Declaring a frequency for a friend is the coldest interaction in the feature.
Once there is enough history to say so honestly, the app can offer it instead,
with the number coming from your own history rather than from an estimate of
how much you care. Needs a sample floor and the discipline to say nothing below
it. *(`rhythms.ts` exactly: `MIN_SAMPLES`, a plain-language reason on every
claim, abstaining rather than reporting a pattern two data points wide.)*

**6. A nudge is a row you can put off, never a surface that demands attention.**
Deferrable, deletable, and deleting one records "not now" rather than a verdict.
Nothing about people ever becomes a banner, a tab badge, or a count in a
header. *(The whole argument of `projectReviewTasks.ts`.)*

**7. Prefer remembering over measuring.** The valuable thing is not "maintain
relationship #4", it is "Ansley starts the new job in September, ask her about
it". Wherever a nudge can take its content from something you wrote rather than
from the clock, it should. The clock is only the trigger; the note is the
message.

## Never

Written down so a locally reasonable change has something to fail against.
Every one of these is a thing a similar app does.

- A score, streak, percentage, health bar, or any number that goes down.
- Sorting people by neglect, anywhere, including as a non-default option.
- Tiers, circles, or any grouping that ranks closeness.
- Bulk address book import.
- A day count anywhere but the person's own detail screen.
- Red, or any colour meaning late, on anything to do with a person.
- A banner, tab badge, or header count about people.
- Any reading of messages, call logs, or calendar attendees.
- Anything leaving the device.

## The link is an array on the task, not a join table

The app has both patterns in use: `grocery_item_shops` is a real composite-key
join table, and `tags` / `recurrenceDays` / `chainItems` / `timeSegments` are
JSON arrays on the row. For people the array wins on one decisive argument:
**rows get copied constantly here.** `completeTask` spreads `...effective` onto
a recurrence successor, `buildSeriesRow` materialises a date set, chains spawn
steps, templates instantiate. A JSON column rides every one of those for free.
A join table needs explicit copy logic at each, and the failure mode is silent:
a recurring "Sunday call with Mom" that quietly stops being about Mom at the
second occurrence.

The price is that "every task naming Dustin" has no index behind it, and that is
what `peopleRegistry.ts` is for — the `blockerRegistry.ts` shape, a memoized
index rebuilt only when the store replaces its array. Answered by scanning it
would be O(n) per row per render, the same O(n²) `waitingCountFor` exists to
avoid.

**Ids are never cleaned up when a person is deleted.** Every reader is
resolve-or-shrug (`resolvePerson` returns undefined, `peopleOn` skips), the same
way `canBlock(undefined)` is false and chain walks stop on a missed lookup.
Rewriting rows a delete isn't otherwise touching costs more than shrugging does,
and the retention note makes the same call about `previousOccurrenceId`.

## History is completed tasks, and there is no interactions table

A completed task carrying `personIds` **is** the record that something happened
with that person, so the history writes itself out of ordinary use.

An `interactions` table was designed and cut. The argument for it was that an
interaction wants an `occurredAt` distinct from `completedAt`, and a kind
(saw them / called / messaged). Both were sized for somebody who logs
constantly, and nobody does — which is the exact failure mode the sixth bullet
at the top is about. So: **one source.** The rare deliberate entry goes through
an "Add to history" row that creates a task already completed, backdatable
through the `datetime` mode `CalendarPicker` is kept alive for.

What that gives up, stated plainly: "saw them" and "texted them" are not
separable unless you say so in the title. A tag covers it later if it ever
matters, with no schema at all.

## The birthday generator

The seventh entry in the registry (`docs/arch/generated-tasks.md`), and the
only one whose trigger is known years in advance rather than derived from
something that just changed. That is what lets it put the task *before* the
thing it is about, and the lead is the whole point: a birthday you find out
about on the day is one you have already half missed.

- **The source id is `personId#year`.** The composite-key idea `mealSlot` uses
  for `2026-08-22#lunch`, and it makes "one task per person per year" true by
  construction. Without the year, the second year's task would be blocked by
  the first year's completed row and the feature would work exactly once.
- **`dueDate` is when to look; `deadline` is the birthday.** The lead-days
  setting moves only the first. A row is dated **today** when it enters the
  window, never computed backwards from the birthday: the app might not have
  been opened on the day the window opened, and a past date renders as overdue
  for a birthday that hasn't happened.
- **The month and the day are stored apart from the year, and that is what
  stops Feb 29 drifting.** `recurrenceAnchorDay` exists because a stored date
  clamped by `addMonths` feeds the next clamp (Jan 31, Feb 28, Mar 28, for ever,
  off a single February). Anchoring to the numbers the user typed makes that
  structurally impossible: 2027 is computed from (2, 29) again, not from what
  2026 resolved to. `birthdayTasks.test.ts` pins it across four years.
- **The task carries no `personIds`**, for the reason `projectReview` carries
  no `projectId`. A task naming somebody is the record that something happened
  *with* them, and the app writing that on its own behalf would put its own rows
  into a history meant to hold yours — and once the reach-out nudge reads that
  history, ticking off "Ansley's birthday" would reset a clock you never
  actually reached out on. It points at its person through `generatedSourceId`
  like every generator points at its source.
- **There is no cap, unlike every other generator.** A cap exists elsewhere
  because the qualifying set is open-ended and mostly arbitrary. Birthdays are
  spread across a year by nature, the window is a few days wide, and every row
  names a real date that is about to happen. Three friends born in one week
  should produce three tasks; dropping one would be the app deciding which
  friend matters least.
- **Its opt-out is a permanent `false`** (`Person.birthdayTaskOptOut`), unlike
  `Project.reviewDeclinedAt`'s lapsing stamp. "Don't remind me about this
  birthday" is a durable thing to have said, where "this project isn't worth
  reviewing today" is not.
- **It ships on**, like `projectReview` and unlike `pantryCheck`. The real gate
  is per person and is simply whether a birthday has been entered at all, so an
  install with nobody in it sees nothing either way. Entering somebody's
  birthday is itself the request to be reminded of it.
- **It only chases a date that actually moved** (`birthdayDrift`), compared
  against the task's own `deadline` — the field recording the birthday the day
  was last derived from, exactly how `groceryUseUp` reads `expiresAt` off the
  deadline it wrote. A corrected birthday moves the row; a lead-time change does
  not, because by then the user may have deferred it.

**The lead-days setting is read through `parseBirthdayLeadDays`, not through a
clamp.** `Number(null)` and `Number('')` are `0`, not `NaN`, so a clamp alone
reads "nothing stored" as a deliberate zero, and every install that had never
touched the setting would get its birthday tasks on the morning of the birthday.
Zero is a real answer somebody can choose, so the two cases have to be told
apart before the string becomes a number.

## The birthday picker keeps only the month and the day

`PersonEditor` opens `WhenPicker` on the current year and throws the year away.
That is what makes paging sane: a birth *date* would mean paging back thirty
years a month at a time, where a birth *day* is at most eleven taps from
wherever the grid opens. The year is a separate optional field with an "e.g."
placeholder, because the year is the half people genuinely don't know, and a
birthday with no year is the common case rather than missing data.
