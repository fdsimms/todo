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
- Bulk address book import, or any picker that shows the whole address book at
  once. Filling one person in from Contacts is fine, and is the intended way
  their birthday gets entered; see "Where the two lines actually fall" below.
- A day count anywhere but the person's own detail screen.
- Red, or any colour meaning late, on anything to do with a person.
- A banner, tab badge, or header count about people.
- Any reading of messages, call logs, or calendar **attendees**. Event *titles*
  are a different read and are in scope; again see below.
- Anything leaving the device.

## Where the two lines actually fall

Two of the nevers above are narrower than they sound, and both have been read
as broader than intended, so they are worth stating positively.

**Contacts.** The objection is not to the system contact book, it is to a list
you did not write. Pulling in 400 people produces one, and it then has to be
sorted somehow, which is the whole disease. **Filling in one person from
Contacts is the opposite of that** — it is the same deliberate act as typing
their name, minus the typing, and it is how a birthday is meant to get entered
in the first place (iOS stores one as `{day, month, year?}`, which is exactly
the split `Person` uses, optional year included).

So the rule is about the picker's *default view*, not about a count: for a
full grant it opens on a search field with nothing under it, and there is no
"select all". You cannot bulk-select an address book you are never shown.
That is also simply the better control — a contact book is mostly dentists,
plumbers and someone from a wedding in 2019, so browsing it for the people
you love means wading through noise.

**A `'limited'` grant (iOS 18+'s own "Selected Contacts" access) is the one
case where that noise is already gone**, and the picker's default view flips
for it: iOS's own chooser is how the user picked that set, in the same
deliberate, one-at-a-time spirit rule 3 asks for — so it is a list they wrote,
not the address book this feature otherwise refuses to show. The sheet reads
it once on open and browses it directly, no query required; a full grant is
unaffected and still never reads without one. See "Filling one person in from
Contacts" below for exactly where that read is gated. See "Filling one person in from Contacts" below for how that lands.

**Calendar.** "Attendees" and "event titles" are different reads and only the
first is out. Attendees is a broad structured sweep of everyone you sit in a
room with, twelve-person work meetings included. A title is *what you typed
about your own plans*, and it is where the social ones actually live: most
dinners with a friend are "Dinner w/ Dustin" in your own calendar, not an
invite with an attendee list. The app already reads titles — `BusyEvent.title`
renders on Today as a context row — so this is a new read of data already in
memory rather than a new capability or a new permission.

What stays absolutely fixed is that **a guess is never written down**. The app
may notice that a past event's title contains the name of somebody already in
your list, and it may *offer* that as history on that person's own screen. It
may not decide it happened, and it may not extract a person it does not already
know about. That is `probablyHaveReason` and `pantryCheck` again: guess what you
cannot verify, carry the reason, and ask. It is a pull surface on a screen you
navigated to on purpose, never a prompt on Today, for the same reason the day
count is allowed in exactly one place.

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

## The reach-out nudge

`reachOutTasks.ts`, and structurally `projectReviewTasks.ts` one shelf over.
The differences are where the care is, because a project can be behind and a
person cannot.

- **Nothing about anybody until they are opted in.** `nudgeOptIn` and
  `cadenceDays` are both off on every new person, and the editor ties them
  together: setting a cadence *is* the opt-in, and clearing it is how somebody
  stops being nudged. The global setting only decides whether the pass runs.
- **The cap forces the one choice the app has to make between people, and it
  makes it on the user's own order.** Sorting the due set by longest-since is
  the obvious answer and is exactly what the "never" list rules out, even done
  invisibly where nobody sees it. So the tie breaks on `sortOrder`, the hand
  drag on the People screen, which is the only ranking the feature may contain
  because it is the one somebody made on purpose. The cost, stated plainly:
  somebody low in a long list whose neighbours above are perpetually due could
  wait. In practice the set rotates, since acting on a nudge resets that
  person's clock. The alternative is the app quietly deciding which friend it
  thinks you have let down most.
- **A swipe-away holds for a week, not for a day.** `projectReview` scopes its
  decline to the day, which is right there and nagging here: a nudge about
  Sarah returning tomorrow morning reads as the app disagreeing with you about
  a friendship. Floored at the cadence so a four-day cadence is not silenced
  for seven, which is the objection to cadence-scoped declines pointed the only
  way it actually bites.
- **The note beats the clock.** `Person.askAbout` turns the title into "Ask
  Ansley about the new job" instead of "Catch up with Ansley" — a reason to get
  in touch rather than a prompt to. Rule 7, in one field.
- **It carries no `personIds`**, for the reason the birthday task carries none:
  ticking it off would otherwise reset the very clock that wrote it, without
  you having actually reached out.

**The cadence can be offered rather than declared**, which is rule 5 and the
coldest interaction in the feature avoided. `observedCadenceDays` reads the
history and `describeObservedCadence` says it in words that carry where the
number came from. It is `rhythms.ts`'s discipline exactly: a sample floor
(`MIN_CADENCE_SAMPLES`), silence below it, and the **median** gap rather than
the mean, so one six-month stretch between otherwise-monthly visits does not
double the answer. The offer never phrases itself as a shortfall, and a test
asserts that — nothing here may read as the app's opinion about how often
somebody ought to see their friends.

## Batching the reach-outs into a focus session

`FocusSetupSheet`'s `reachOutSeed` prop, and the "Reach out to people" row in
the "…" menu. Fifteen minutes, four texts, done — rather than four separate
small guilts spread across a week.

- **No new plumbing, because the live reach-out set is already the whole
  answer.** A reach-out nudge is an ordinary generated `Task`, so it needs
  nothing `focusPlan.ts`/`useFocusStore.ts` don't already handle for any task:
  no `estimatedMinutes` falls back to the same "assumed" default an
  unestimated task always gets, and the row's call/text buttons already read
  `phoneNumber` generically. The only genuinely new code is the entry point.
- **`focusQueueFromPinned` is reused unchanged, not forked.** "Take this short
  hand-picked list as-is, filtered by eligibility and window-fit" is exactly
  what a ≤2-item reach-out list needs, and it's exactly what pinning already
  needed — `MAX_REACH_OUT_TASKS` is the ranking here the way `pinnedOrder` is
  there. A second, reach-out-flavoured copy of that function would be the
  drift the shared-primitives notes elsewhere in this file exist to prevent.
- **The menu row is omitted, not shown-and-explained, when there's nothing to
  batch.** Unlike "Pull from projects" (always there, self-explains when
  empty) — a quiet project is always eventually true, most of the time nobody
  is due for a reach-out, and a row that only sometimes does anything is worse
  than no row.
- **Still no ranking by neglect.** The queue runs in the capped set's own
  order, which is `sortOrder`-broken (see the reach-out nudge section above) —
  batching doesn't get its own opinion about which person goes first.

## Calendar events offered as history

`calendarHistory.ts`, and the rule it exists to hold: **the app may notice, and
it may ask. It may not decide.** Every claim in the section above about titles
and attendees is settled; what follows is how the offer is kept from becoming an
assertion.

- **A pull surface, on the person's own screen and nowhere else.** No prompt on
  Today, no banner, no badge, no count. Same argument that lets the day count
  live in exactly one place: you went there to look, so nothing arrived
  uninvited. It is also why there is no cap on how many may be offered, only a
  "Show N more" once past five, which is display rather than suppression.
- **The fetch is its own window, and it is paid for where it is read.**
  `useCalendarStore`'s existing window is forward-looking, two weeks wide, and
  refreshed on every foreground because Today asks about it. Nothing on Today
  asks about last month, so `refreshPast` is called from the person's screen and
  from nowhere else. Widening the foreground window instead would charge every
  launch for a quarter of events to serve a screen most launches never open.
- **Its own switch** (`calendarPeopleHistory`), on by default once calendar
  reading is. This is a genuinely new *read* rather than a new use of data
  already in memory, and somebody who turned calendar reading on to be told
  whether today has room did not thereby ask for their past to be matched
  against their friends' names. It shows nothing at all until a name matches, so
  defaulting on costs a user who does not want it nothing they can see.
- **Whole-word, exact, and ambiguity resolves to nobody.** `parsePeopleInput`'s
  refusal, one shelf over: "Dinner w/ Sam" with two Sams on file names neither,
  while "Dinner w/ Sam Ortiz" still names one. The extra rule here is
  `MIN_CALENDAR_NAME_LENGTH`, and the asymmetry with the `@` parser is the point
  — typing "@al" is a deliberate act with a sigil in front of it, where a
  calendar title is a guess about text written for another purpose, so the guess
  gets the higher bar.
- **All-day events are never offered.** `occupiesTime`'s own note already lists
  what they are: a birthday, a public holiday, a "Sarah out of office" marker.
  Every one would offer a date somebody's name is *on* as an afternoon you spent
  together, which is the app inventing the one thing it must never invent.
  Availability is deliberately not filtered on the same line — marking a dinner
  Free says it does not block your calendar, which is a different claim from
  whether it happened.
- **Accepting produces the same record everything else does**: an ordinary
  completed task carrying `personIds`, through the same helper the manual "Add
  to history" row uses, backdated to the event. No second kind of record, and
  once you have confirmed it, it is not a guess any more.
- **An accepted offer carries everybody the title named.** "Beach with Dustin and
  Ansley" is one afternoon, and recording it once from each of their screens
  would put one afternoon in the Logbook twice.
- **The answered record is keyed by event, not by pair, and both answers share
  it.** Accepted and dismissed both mean "don't ask again", so there is one
  record and nothing to keep in step. Keying by event rather than by
  (event, person) means an evening turned down on one screen does not come back
  on another's, which is the app taking an answer rather than asking twice about
  one thing.
- **The key carries the occurrence's day, because an event id is not one
  occurrence.** EventKit hands back every instance of a recurring event under
  the same identifier, so a standing "Lunch w/ Mom" is one id and thirteen
  lunches. `birthdaySourceId`'s `personId#year` and `mealSlot`'s
  `2026-08-22#lunch` answer the same problem the same way. The day is the
  event's own calendar day and deliberately **not** the logical one: it is an
  identity, not a scheduling decision, and reading it through `dayResetTime`
  would mean moving that setting silently re-keys the record and hands back
  every dismissal at once.
- **It is bounded by the window, which is what makes it allowed to exist.**
  `docs/arch/generated-tasks.md` rules out a generic `(kind, sourceId)`
  suppression record precisely because nothing prunes it. Here the pruning is
  arithmetic rather than a pass over anything: an event older than
  `PAST_CALENDAR_WINDOW_DAYS` can never be offered again, so its answer is
  dropped. The one thing that has to hold for that to be safe is that no offer
  is ever made for an event starting before the floor — EventKit returns events
  *overlapping* a range, so a long event that began earlier comes back with the
  rest, and offering one would write an answer already past the pruning line.
  `suggestedHistoryEvents` refuses those, and a test pins it.
- **It does not sync**, for `groceryImportLinks`' reason: an EventKit id names a
  record on one device, so the other phone would read the record as answers
  about events it has never seen.
- **It is the one calendar reader gated on demo mode**, and the asymmetry is
  deliberate. The other four show calendar events as calendar events, which is
  honest whichever database is mounted; this one's output is a claim *about a
  demo row*, and the seed invents a Dustin. Without the gate a real event
  mentioning a real Dustin would be offered as history for the invented one, on
  a screen handed to somebody else. `enterDemoMode` deliberately does not
  re-initialize the settings store, so the real calendar settings are live
  inside a demo and the gate has to be explicit. The second half is a plain bug
  it also avoids: the answer would be written into the scratch settings table,
  so a dismissal made in a demo is lost and the real install is asked again.

## Filling one person in from Contacts

`contactsImport.ts` (the rules) and `contactsAccess.ts` (permission and the one
native read), the same split `calendarBusy.ts` and `calendarSync.ts` keep.
Entering a birthday by hand is the tedious half of adding somebody and the
system contact book already has it.

- **The default view is the rule, and it is enforced in the read rather than in
  the UI — for a full grant.** `searchContacts` refuses a query shorter than
  `MIN_CONTACT_QUERY_LENGTH` outright instead of falling back to "everyone", and
  the name filter is passed *to* the native query rather than applied after it.
  So an unqueried picker doesn't merely hide the address book, it never reads
  it — which is the "you cannot bulk-select a book you are never shown" rule
  made structural rather than a layout decision one refactor could undo. There
  is no "select all" at any point, and no browse.
- **A `'limited'` grant gets `fetchLimitedContacts` instead, and the same
  discipline applies the other way.** `getContactsAccessScope` reads
  `accessPrivileges` off the permission response (`'all' | 'limited'`, iOS 18+
  only — anything older reads as `'all'`, since there is no narrower grant on
  offer to have made) and `fetchLimitedContacts` re-checks it itself before
  reading rather than trusting whichever screen called it, so a full grant
  can't reach the browsable path by a UI mistake any more than a short query
  can reach the address book on the other side. What it returns is not "the
  address book minus noise" as a design choice — it is structurally incapable
  of being more than the set iOS's own chooser bounded it to, because that
  bound is enforced by the OS on every query the app makes, filtered or not.
  `contactsImport.ts`'s `browsableContacts`/`filterBrowsableContacts` sort and
  narrow that set locally, with no `MIN_CONTACT_QUERY_LENGTH` floor: it is
  already small and already curated, so narrowing it to one letter is filtering
  a list the user wrote, not opening one they didn't.
- **One tap adds one person and the sheet stays open**, so a run of three is
  three taps without the picker ever becoming a checklist of everybody.
- **The month arrives 0-indexed.** The native module follows the JS `Date`
  convention and `Person.birthdayMonth` is 1-12, so a straight copy puts every
  birthday a month early — silently, since every value is still in range. That
  conversion is the one piece of arithmetic in the feature and it has its own
  test. The year is dropped because there is nowhere to put it any more (#2083),
  which is fine: a year-less birthday was always the common case here.
- **A copy, never a link.** Nothing on a `Person` points back at a contact. A
  linked person would mean holding the permission indefinitely, a background
  reconcile, and rows changing under the user; a stale number is a smaller
  problem than any of those. It also means the duplicate check has no id to work
  from, so `alreadyAdded` matches on name (against both name and nickname) or on
  the last seven digits of the phone — the digits so a country code on one side
  doesn't defeat it, seven so short numbers don't collide.
- **Refused or unavailable is the ordinary "type a name" path**, with one line
  saying so and no nagging. The name field is literally the sheet behind this
  one, so there is nothing here worth pushing.
- **Demo mode reads nothing** (`isDemoModeActive`, with a test). It is the same
  direction the past-calendar gate runs in: the read consumes nothing, but a
  picker offering the real address book inside a demo puts real names on a
  screen handed to somebody else. Nothing is seeded either, for the same reason
  — there is no fake contact book to seed one from.
- **It needs a fresh native build**, not a JS reload: `expo-contacts` is a native
  module and its permission string is a config-plugin entry in `app.json`.

## The memory layer

`PersonNote` and `personNotes.ts`. **Rule 7 in full, and the part that makes the
feature a thing you like rather than a thing you tolerate.** The valuable thing
is not "maintain relationship #4", it is "Ansley starts the new job in September,
ask her about it". `Person.askAbout` shipped a one-field slice of this early, so
the first nudge anybody sees is warm rather than clock-driven; this is the rest.

**Three kinds, each with exactly one place it shows up**, which is what keeps
them from blurring into one another and is what each kind's hint in the sheet
actually says:

| Kind | Where it lands |
|---|---|
| `note` | The person's own screen |
| `gift` | The birthday task, as its notes |
| `food` | A meal they're a guest at |

- **Rows rather than fields on `Person`**, unlike `askAbout` beside them. The
  argument this doc makes for `Task.personIds` being a JSON array does not
  transfer: task rows get copied constantly (a recurrence successor, a series
  member, a chain step) and a JSON column rides every copy for free, where a
  person row is never copied at all. What these need instead is to be added and
  removed one at a time and to carry their own date, which is a row.
- **`relevantOn` is what separates a note from `Person.notes`.** That field is a
  static description; a dated note can go stale, which is the entire point of
  the distinction. Null is the common case and is not missing data — "no
  shellfish" is not about a day, and treating an undated note as expiring would
  quietly grey out the ones that are always true.
- **Stale is a display state, never a delete.** A note whose day has passed is
  shown quieter and sunk below the live ones. Nothing in the app deletes a note
  on its own, and nothing is ever struck through or coloured: a note you meant
  to act on is not a debt.
- **Nothing ever says how long a note has been stale.** `describeNoteDay` counts
  *forward* ("Today", "In 3 days") because anticipation is not a tally, and says
  only "Passed" in the other direction. "94 days ago" about a thing you meant to
  ask is precisely the scoreboard the top of this doc is about.
- **A person with no notes shows no section at all.** Not an empty heading, not
  a prompt to start filing facts about your friends. The one way in is an "Add a
  note" row that says what it will do.
- **Gift ideas are written onto the birthday task at creation only**, never on a
  reconcile. `category` takes the same line and `mealSlotTaskDraft` states the
  rule: a field the generator does not *own* is applied once and then belongs to
  the user. `notes` is emphatically theirs to edit, and a drift pass rewriting it
  would eat what they added on the day. In practice ideas are written months
  ahead and the row days ahead, so it arrives carrying them.
- **Stale gift and food notes are dropped rather than sunk.** A gift idea whose
  day has passed is one you either bought or missed and a birthday task is not
  the place to be shown either; a food note that has passed ("dairy-free until
  March") is simply no longer true.
- **Deleting a person deletes their notes**, and it is the one place this layer
  does not shrug at a dangling pointer. A note is *about* somebody and has no
  meaning without them, unlike a task naming them, which is still a thing you
  did — leaving the rows would be keeping a private file on somebody the user
  asked to be rid of. Done inside `removePersonRow` so a second call site can't
  forget it, and the confirm says so.
- **Nothing counts them.** There is no "3 notes" anywhere, because a count about
  a person is a number about a person, and this feature has nowhere one may
  appear.

## A warm year in review, in Stats

`peopleStats.ts`. "Aggregates about you are fine; aggregates about individual
people are the thing to refuse" — the non-goals in the original plan, and the
one line this whole section exists to obey.

- **No per-person breakdown, anywhere, including as intermediate state.** The
  reach-out section above rules out sorting by neglect "even done invisibly
  where nobody sees it" — this file holds the same line one step earlier: it
  never builds a `Map<personId, count>` on the way to a total, because a
  structure that *could* answer "who did I see most" is the disease this doc
  exists to prevent whether or not a line of it ever reaches the screen. Two
  plain integers, nothing keyed by a person id.
- **Two independent facts, not one.** Time spent with somebody (a completed
  top-level task naming them — the same two filters `personHistory()` uses:
  `isRealCompletion`, so a miss stored as completed doesn't count, and
  top-level only, so a subtask doesn't multiply one occasion) and meals cooked
  with a guest (a `MealPlanEntry` gated on `cookedAt`, since a planned dinner
  that never happened is not a time you had people over). Each renders only
  when it has something to say, so a year with hosting but no tagged tasks (or
  the reverse) still says the half that's true.
- **Never a zero.** "You spent time with people 0 times this year" is the same
  debt "94 days ago" is (rule 2) — the sentence is either a cheerful fact or it
  says nothing.
- **The meal count is its own SQLite read, not `useMealPlanStore.entries`.**
  That store holds whatever window the meal plan screen last loaded, and a
  calendar year is wider than the app ever loads on its own. Same shape
  `cookingCounts`/`refreshCookingCounts` already use for the identical reason,
  one integer stored rather than a year of rows kept around to produce it.

## Waiting on a person

`Task.waitingOnPersonId`, and `canWaitOn` / `personBlockerOf` in `blocking.ts`.
The same pointer as `blockedById` with a person on the other end, so it inherits
the Waiting screen whole.

- **It hides the task exactly as a task blocker does**, and it earns that
  because the Waiting screen can *name* what it is waiting on. That is the test
  the sequential-project gate fails, which is why that one is a separate
  predicate rather than a clause inside `isTaskBlocked` and this one is a clause.
- **Nothing ends it on its own, and that is the whole risk.** A blocker task
  completes and frees its waiters; nobody completes a person. So the clearing
  action is on the row itself (the chip is a button, unlike the blocker chip
  beside it) and on the Waiting screen, not only in the editor. Hiding a task
  behind a wait with no obvious way back is how this becomes a way to lose one.
- **A deleted or archived person frees their waiters**, which is `canBlock`'s
  shape exactly and for its reason: a stranded waiter is invisible with no user
  action able to recover it. It is also what makes a cascade unnecessary when
  somebody is deleted.
- **No count under a person's name.** The blocker-task header carries a
  "N waiting" badge and the person header deliberately does not: a number under
  somebody's name reads as a tally against them rather than as a fact about your
  own list. The name alone.
- **Independent of `personIds`.** Waiting on Dustin for the photos is not time
  spent with Dustin, and it must never land in his history. A task carrying both
  is filed under its blocker task, so one row never appears twice.

## Deload leaves people alone

`deloadBlockerFor` reports a **soft** blocker for a task carrying `personIds`,
joining `streak`, `started` and `high-priority`. Other people are involved, so
moving it has a social cost the day-load math cannot see: "beach with Dustin and
Ansley" is not the same thing to push to Saturday as "clean the bathroom", even
when the minutes agree.

Soft rather than hard, because the day might genuinely need to get lighter and
refusing outright would be the app deciding you cannot reschedule seeing a
friend. It sits last, so a pinned or urgent task still reports the harder reason
it cannot move at all. The label names the fact and judges nothing, and
`lookAhead` inherits it for free by asking the same helper.

## Guests on a planned meal

`MealPlanEntry.personIds` and `mealGuests.ts`. The tie-in no other app can have,
because no other app holds both halves: once a meal knows who is coming, a
dietary note has somewhere to be useful (#2047) and somebody's own screen can
say "dinner here on Thursday" without anything having been ticked off.

- **The same JSON array `Task.personIds` uses**, and partly for the same reason:
  `planMeal` copies an entry's shape around and a JSON column rides every copy
  for free. Resolve-or-shrug at every reader, like `recipeId` and `leftoverId`
  on the same row.
- **The picker never creates a person.** Rule 3: adding somebody is a deliberate
  act performed on the People screen, and a picker that could invent one from a
  meal sheet is the thin end of a list you did not write. It is `PillGroup` with
  no `onCreate`, so the affordance does not exist rather than being refused.
- **Nothing shows when nobody has been added yet.** An empty guest picker is a
  prompt to start filing your friends, which is the failure mode the whole doc
  is about. The block renders only once the People screen has somebody in it.
- **Copying a week forward drops the guests.** They sit on `cookedAt`'s side of
  the line rather than `recipeScale`'s: who came on Tuesday is a fact about that
  night, not about the dish, and a copied week claiming the same four people are
  coming again is the app asserting something about other people's plans.
  Re-inviting is a thing you do, and it is two taps on the copied meal.
- **The meal's generated task does not carry them**, and this is the trap worth
  naming. A `mealSlot` task is a chain, and completing a step spawns the next
  row with `personIds` riding the `...effective` spread — one dinner would land
  in a guest's history three times, which is exactly the "four times the
  evidence for one afternoon" `personHistory` excludes subtasks to avoid. What a
  *cooked* meal should write instead is #2078.
- **A guest's own screen reads the meals straight from SQLite**, not off
  `useMealPlanStore.entries`, which holds whatever week the meal plan screen last
  showed. Same call `dbGetMealPlanEntry` makes for the same reason: loading a
  different range into `entries` would move that screen's week out from under it.
- **Nothing counts how often somebody comes over.** `mealGuests.ts` resolves ids
  to names and answers "which meals name this person"; there is no derivation of
  frequency, and adding one is the disease this doc exists to prevent.

## The birthday picker keeps only the month and the day

`PersonEditor` opens `WhenPicker` on the current year and throws the year away.
That is what makes paging sane: a birth *date* would mean paging back thirty
years a month at a time, where a birth *day* is at most eleven taps from
wherever the grid opens. The year is a separate optional field with an "e.g."
placeholder, because the year is the half people genuinely don't know, and a
birthday with no year is the common case rather than missing data.

## Templates that ask who

A template question can be kind `'people'` (#2090) — "Who's coming?" on a
Camping Trip template, answered once per apply, written onto `personIds` for
every task the run creates. `TemplateQuestionKind` gained it as a fourth kind
rather than a variant of `'choice'`, because a choice's answer set is a fixed
list the author typed in the editor and its answer is one of them; a people
question's set is whoever exists on the People screen at apply time, and its
answer is a set of them, not one.

- **The answer is the same JSON-array-in-a-string encoding `Task.personIds`
  itself uses on its SQLite column**, because the rest of this module treats a
  question's answer as one string (`Record<string, string>`, see
  `resolveAnswers`), and a person picker's answer is a set. `personIdsFromAnswer`
  / `personIdsToAnswer` in `templateQuestions.ts` are the two directions, and
  `personIdsToAnswer([])` is deliberately `''` rather than `'[]'` — `resolveAnswers`
  falls back to the default on a falsy typed answer, so unpicking the last
  person by hand has to produce the same falsy string an untouched question
  would, or the field gets stuck instead of handing itself back to the default.
  Both shrug rather than throw on a hand-edited or corrupted answer, same as
  every other cross-row pointer in this doc.
- **`personIdsForAnswers(questions, answers)` unions every `'people'` question's
  answer** into one list — a template can ask "who's on the flight" and "who's
  at the hotel" separately, and a task naming either of them is a task naming
  somebody.
- **An unattended run never names anyone, and the guarantee lives in
  `defaultAnswer`, not in `personIdsForAnswers`.** `checkScheduledTemplates`
  calls `resolveAnswers(questions, {}, anchors)` — nothing typed — so every
  `'people'` question resolves through `defaultAnswer`, which for this kind is
  never anything but `''` (not the `'choice'` rule of defaulting to the first
  option — nobody is the only honest default when nobody is present to pick).
  That in turn depends on `normalizeTemplateQuestion` forcing `defaultValue`
  (and `name`, so a stray value can't leak into a title substitution either)
  to `''` for this kind regardless of what a hand-edited or restored row
  claims — `personIdsForAnswers` itself stays generic and doesn't need to know
  whether a person present is answering or an unattended run is, the same way
  `placeholderValuesFor` beside it doesn't. A test pins the whole chain down:
  `checkScheduledTemplates` never produces a task with a `personIds` override,
  even on a template carrying a `'people'` question.
- **`ApplyTemplateOptions.personIds` lands on every task built from a template
  item, not on the run's container.** A run stack or run project has no
  `personIds` field to set; a `'task'` container's own parent row and its
  items' own subtask stubs (`addSubtask` takes no field overrides) don't get it
  either. "Every task the run creates" means every leaf the apply actually
  builds from an item, the same scope every other per-run override in
  `applyTemplate` — `groupId`, `parentId`, `projectId` — already has.
- **The picker is `PillGroup` with no `onCreate`, and it disappears entirely
  when nobody has been added on the People screen yet** — the same two rules
  "Guests on a planned meal" above states for the identical reason: rule 3
  again. Here that means the one question row goes missing rather than a whole
  block, since a template can ask a `'people'` question alongside an ordinary
  one and the other question still has to render. `ApplyTemplateSheet` filters
  it out of `visibleQuestions` before render, not just visually hides it, so a
  lone `'people'` question on a template nobody has anyone for shows no
  "Questions" section at all rather than an empty one.
- **`PillGroup` gained an optional `pluralNoun` prop** for this caller.
  Every existing `noun` pluralizes by appending "s" ("aisle" → "aisles"), which
  the component's own "N more…" label already assumed; "person" doesn't
  ("people", not "persons"). `pluralNoun="people"` overrides just that label;
  every other caller is unaffected since the prop defaults to `` `${noun}s` ``.
