# The journal and the dream log

Read this before changing `src/utils/journal.ts`, `src/utils/journalTasks.ts`,
`src/store/useJournalStore.ts`, `src/screens/JournalScreen.tsx`,
`src/components/JournalEntrySheet.tsx` or `mcp/src/journalTools.ts`. Where this
note and the code disagree, the code is what ships, so fix the note.

---

## Why they left the mood entry

Both started as fields on `MoodLog`: a large note the mood sheet opened on, then
a dream field beside it. Together they took up most of a sheet whose job is a
mood, and a dream was never about the mood next to it at all (it is written on
waking, nothing read it, and it filed under the entry's day only by accident of
living there).

So writing is its own log now, and the mood entry keeps a **short note**: one
line on why, folded behind "Add a note" at the bottom of the sheet, which is
still the thing the Looking back card and the day page read. Longer writing
goes in the Journal.

## One table, two kinds

`JournalEntry` is `{ kind, loggedAt, dayKey, text }` with `kind` `'journal'` or
`'dream'`, in one table (`journal_entries`) and one store. They are one shape,
so two tables would be two copies of every db function, sync entry, backup row
and MCP tool for no difference a person can see. The screens split them:
`Journal` and `Dreams` are two routes onto one component, two members of the
Health hub, and two content screens in simplified mode (each hidden only while
it holds nothing, for the reason Mood is).

- **`dayKey` is stamped, never derived**, and the day is fixed once written:
  `updateEntry` changes only the words. Same reasoning as `MoodLog.dayKey`. A
  dream files under the day you woke.
- **Nothing is derived from either kind.** `moodInsights.ts` never reads them,
  there is no theme detection and no reading of what a dream "means". The only
  numbers are `journalStats` (days written, this month, last day), which count
  one thing and so have no minimum. A day with nothing written is absent, never
  "a day without a dream".
- **Search is `textMatchesQuery`**, the mood note search's own rule: every
  word, plain substring.
- **They are health data for sync** (`HEALTH_SYNC_TABLES`): never sent to
  iCloud, and sent to a sync server only with Include health logs on. A diary is
  at least as personal as the mood note it grew out of.

## The move off the mood entry

`migrateMoodDreams` in `initDatabase` copies every non-blank `mood_logs.dream`
into `journal_entries` once (flag `journal_dream_migration_done`):

- **The new id is derived (`dream-<mood id>`)** so two devices that each migrate
  before their next sync write the same row rather than one each.
- **A mood entry that held nothing but the dream is deleted**, since it would
  otherwise record nothing. Its tombstone syncs like any delete.
- **The old column is left in place and unread.** Clearing it would restamp
  every one of those rows as edited now, the stale-copy hazard
  `fillCalendarExternalIds` describes.

## The two reminders

`journalLog` and `dreamLog` (`journalTasks.ts`, fired by `checkJournalTasks`)
are the mood check-in's shape (`docs/arch/mood-log.md`, "The two generators"):
day-keyed with no source row, a settings mark each so a swiped-away one stays
away, off by default, and each opens its sheet through
`dundundun://journal?log=1` / `dundundun://dreams?log=1`.

- **The journal reminder takes `journalLogTimeSegments`**: empty is one task a
  day, any time; one or more parts of the day hold back a task per part, with
  only the current one live and "answered" meaning an entry since that part
  began.
- **The dream reminder is once a day, with no part of the day.** A dream is
  written once, on waking, and whenever the list is first looked at is close
  enough to that.
- **Saving a new entry for today completes that kind's reminder**
  (`completeJournalTaskForToday`); a backdated or edited one does not, for the
  mood sheet's reason.

## Read back beside the mood log

The mood day page shows that day's journal entries and dreams under its mood
entries, and pages through every day that has either (`adjacentLogDays` takes
anything with a day key). The Looking back card counts a day with only writing
on it, since a journal page from a year ago is exactly what that card is for
(`lookBacks`' `journal` argument). Both read and never interpret, as before.

## Getting it off the device

Each screen's Share action writes that kind as CSV (`journalExport.ts`), the
medication export's flow: the summary is confirmed first, every entry is a row
oldest first with its day and instant, nothing is derived, and the file is
deleted the moment the share sheet closes.

## Light formatting, drawn on read

An entry is stored as the plain text typed, and `JournalText` draws a small
slice of Markdown over it (`journalMarkdown.ts`): headings, bullets, numbered
items, quotes, bold and italics. Stored plain on purpose, so search, sync,
export and the MCP tools are untouched, and an entry written before the
formatting existed reads exactly as it did. A marker with no partner stays as
typed rather than vanishing into a style. Where styles are wrong (a screen
reader's label, a clipped preview like Looking back) `journalPlainText` strips
the markers. A formatting toolbar or styles shown while typing was the other
option and was left out: it needs a native editor and a stored document format.
