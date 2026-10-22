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
- **They have their own sync switch** (`JOURNAL_SYNC_TABLES`): never sent to
  iCloud, and sent to a sync server only with "Include journal and dreams" on,
  separate from "Include health logs". The server is what the MCP server reads,
  so that switch is also the decision to let Claude read and write the journal
  (`docs/arch/mcp-server.md`).

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
- **Several parts of the day make it a day written in snippets.** The task
  then reads "Add to today's journal" (`journalLogTitle`), and each answer is
  its own row, stitched together only when read: the screen draws a day as one
  page (no rule between entries, just their times) and the sheet shows the
  day's earlier entries above the field (`entriesOnDay`). Appending to one row
  per day was the other option and was turned down: two devices adding a
  snippet before they sync would each rewrite that row, and one snippet would
  lose. Rewriting the snippets into prose with a model was turned down too, by
  the "nothing is derived" rule above.
- **The dream reminder is once a day, with no part of the day.** A dream is
  written once, on waking, and whenever the list is first looked at is close
  enough to that.
- **Saving an entry in the sheet completes the reminder**, through the row's own
  completion animation (`autoCompleteRecordTasks`). An entry that arrives another
  way (the widget's dream capture, sync) makes the row read ready and the person
  ticks it; a ready row from an earlier day or part of the day is kept
  (`isReadyRecordTask`).
  Until an entry exists the reminder's checkbox opens the sheet and
  `completeTask` refuses a tick; afterwards the row reads ready (`recordTasks.ts`;
  see the mood log's "The two generators").

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

## Spoilers

`||words||` (Discord's marker) is the one inline style that hides rather than styles. `JournalText`
draws it as a block the same colour as its words until tapped, and a second tap hides it again. What
is open is component state, so leaving the screen hides everything. The text is stored as typed like
the rest, so search, sync, export and Claude's journal tools all see the words.

- **Anywhere an entry is shown without the tap, the words are replaced** (`journalPlainText` returns
  `[hidden]`): the screen reader's row label, `journalSnippet` previews and the Looking back card. A
  spoiler that leaked into a preview would be no spoiler. The edit sheet's field shows the markers
  and the words, as it does for every other style.
- **Its words are read for bold and italics too**, and every span of one spoiler shares a `spoiler`
  number so they open together.
- **Not a lock.** Search, the word count and exports include the words, and the MCP server returns them (its instructions tell Claude not to quote one back unprompted).
  It stops a glance at the screen, not a reader.

## The formatting bar

`JournalFormatBar` floats above the keyboard while the field has focus (a
real `InputAccessoryView` never attaches to a multiline field, the reason
`TitleTokenAccessory` has a floating mode; both read `useKeyboardHeight`).
Its buttons only type the markers: `toggleWrap` wraps or unwraps the selection
in `**`/`*`, and `toggleLinePrefix` puts a heading, bullet, numbered item or
quote on every line the selection touches, or takes it off when they all have
it. Both are pure and return the new text with the selection to place, which
the sheet hands to `useTitleSelection.selectRange`, the same one-shot the title
fields use so ordinary typing never has a selection pushed back at it.

The bar covers the bottom of the sheet above the keyboard, so the sheet passes
its height to `EditorSheet` (`keyboardAccessoryHeight`, then `accessoryHeight`
on `useKeyboardInsetScroll`). That takes the hook's JS-owned inset path and
adds the bar to the keyboard's inset, which keeps a caret typing near the
bottom of a long entry above the bar rather than behind it.

## Notes to your future self

A new journal entry written for today can be sealed until a later day ("Hide until" in the sheet, reading "Not hidden" until a day is picked,
`JournalEntry.openOn`). Until then it is kept, synced and counts as a day written, but nobody reads
its words: the Journal shows only "2 notes for later" and the next date, and the other readers
leave it out.

- **One rule, read everywhere: `openEntries`.** The Journal list, search, stats and export, the
  sheet's "so far", the mood day page, Looking back and Claude's journal tools all filter through
  it. A new reader of journal entries does the same. Over MCP a sealed note is a count
  (`sealedNotes`), and updating or deleting one by id is refused.
- **It opens by day, with a task to say so.** Saving a sealed note adds a plain task due on its
  day whose link is `dundundun://journal?entry=<id>` (`sealedNoteTaskDraft`), which opens that
  note. It's a task the person asked for, so it isn't a generated one. Deleting the note or opening
  it early (the sealed card's "Open it now", `openNow`) deletes the task with it
  (`dropSealedNoteReminder`).
- **It still files under the day it was written**, which can be a year down the page, so a note
  shows under "Just opened" at the top for a week from its day (`justOpened`).
- **Only a page written now can be sealed.** A backdated entry is filling in a day that has gone,
  and a dream is about last night, so the row shows for neither. Opening early is the only change
  to `openOn` after it's written, and it only ever clears it.

## Tags and people

An entry can carry `tags` (labels the person typed) and `personIds` (people it is about), both
JSON-array columns (`tags`, `person_ids`) that sync like the rest of the row. Both are chosen,
never detected, which is what keeps them inside the "nothing is derived" rule.

- **Tags are listed A to Z, not by use** (`journalTagsIn`): ordering them by how often they appear
  would rank the person's own labels against each other. Case is kept as typed, and two tags that
  differ only by case are one (`journalTagKey`). The vocabulary the sheet offers is built from
  open entries only, so a sealed note's labels aren't shown before its day.
- **A tap on a tag on an entry narrows the list to it**, with the active tag as a removable pill
  under the search field, rather than a row of chips to scroll.
- **A person's page lists the entries about them** (`entriesAboutPerson`), newest first and with
  no count, behind the journal lock (`useJournalAccess`) and through `openEntries`. A deleted
  person's id stays on the entry and reads as nobody; the export skips it.
- **Editing is `setEntryMeta`**, separate from `updateEntry` (which refuses an unchanged text).

## Counting an entry as time together

Typing `@` at the end of a page offers the people it could mean (`getEditorMentionSuggestions`,
the task editor's rule): a tap links them and completes the name in the text, and the text alone
never links anybody. Linked people show in About as before. A mention edited into the middle of a
page is not suggested, since only the token at the end is read; the About row covers that case.

Once a new journal entry names somebody, the sheet asks whether to count it as time with them
(`journalHistory.ts`): **Don't add** (the default), **Hung out** or **Caught up**. Picking one writes an
ordinary completed task ("Hung out with Gideon and Tessa") through `addCompletedTask` on Save, the
record every other way into a person's history writes (`docs/arch/people.md`).

- **Offered, never decided.** Nothing is written unless a choice is picked, and the words are never
  read to guess whether a hangout happened. Same rule as the calendar offer and the Call button.
- **One entry for everybody named**, so one afternoon is not recorded twice.
- **Only a new, open journal entry.** An edit would offer the same page again on every save, a
  dream is not time spent with anybody, and a note sealed for later is not something that happened
  today. The entry is dated now for today's page and noon for a backdated one.
- **The history entry links back to the page** (`linkUrl` is `journalEntryLink(entry.id)`, the
  link a sealed note's reminder uses), so its link button opens the entry. The title still says
  nothing about what was written, and the Journal sits behind its lock, so opening the page asks
  for it. Deleting the page leaves the history entry in place and its link opens nothing, the
  resolve-or-shrug every id here gets.

## Reading it back: on this day, the month, a random page

`onThisDay` finds the same month and day in earlier years (a Feb 29 page appears only on a Feb 29)
and the Journal shows it as a card at the top of the list. `daysWrittenInMonth` fills the month
grid (`JournalMonthSheet`), where a day with nothing on it is plain and untappable, never "missed".
`randomJournalDay` draws from the days written and leaves today out while anything older exists.
A tapped day or a random one opens `JournalDaySheet`. All three go through `openEntries`.

## Drafts

A new entry's unsaved words are kept per kind in the settings table (`journalDraft_<kind>`,
`src/utils/journalDraft.ts`), written 600ms after typing pauses and cleared on save and on Discard.
It is not synced, and the sheet that shows it sits behind the journal lock, so it is as exposed
as the entries themselves. An edit has no draft. A Cancel that discards still asks first; the draft
is for an interruption (a crash, a call, the system reclaiming the app), not a way round that.

## Your own prompts

`journalCustomPrompts` (Settings › Health › Journal) are offered before the built-in
`JOURNAL_PROMPTS` when "Suggest a prompt" is tapped, up to 20. Device-local, like the draft:
a prompt can be personal ("what am I not telling Sam?") and is not on the synced-settings allowlist.

## Hide until: shortcuts

`sealShortcuts` offers a month, six months, a year and New Year's Day beside the date picker. There
is no "on my birthday": the app doesn't hold the person's own birthday, only other people's.

## Saying a dream or a journal entry to Siri

`LogDreamIntent` ("Log a dream in dundundun") and `LogJournalIntent` ("Write in my journal in
dundundun") queue `{ text, at, kind }` in one App Group file and the app writes each into its own log
on the next foreground (`docs/native-targets.md`). A record with no `kind` is a dream. It can only add: nothing reads the journal, and the app
navigates nowhere, so the Face ID lock is untouched. The queue file holds the words in plain
text until the app drains it, the same as a task title queued by `AddTaskIntent`. Saying one for
today answers that day's reminder for that log.

## Dictating an entry

The journal and dream reminder rows carry a microphone (`recordMicUrl` in `recordTasks.ts`) that
opens the entry sheet already listening: the row's link with `mic=1`, which `resetToJournal` turns
into a `dictate` stamp on the route and `JournalScreen` hands to the sheet as `dictateOnOpen`.
`useDictation` runs the recording over `modules/todo-speech-bridge` (Apple's `SFSpeechRecognizer`).
The words go into the same field as typed ones, so the word count, the draft and Save are
unchanged, and **nothing is saved until Save is tapped**: the transcript is there to be read and
fixed first. "Keep talking" adds to what is on the page.

- **Audio never leaves the phone.** Every request sets `requiresOnDeviceRecognition`, and `start`
  refuses when `supportsOnDeviceRecognition` is false for the person's language, because Apple honors
  the flag only when the recognizer supports it and otherwise sends the audio to a server. A refusal,
  not a fallback (`dictationRefusal('unavailable')`), and `isSpeechAvailable` is false in that case so
  the row shows no microphone at all. The audio is never written to disk, which also answers where the
  recordings go: nowhere.
- **The row's tap is unchanged.** Only the microphone starts a recording. A bare `log=1` link, the row
  body and a note-to-self `entry=` link open the sheet silent.
- **Every recording is numbered, and every event carries it** (`startSpeech`), so a result from a
  recording already stopped can't land on the one that replaced it. Closing the sheet cancels any
  recording (`useDictation`'s token), including one still waiting on the permission prompt.
- **Not dictated:** mood and weight tasks (answered with a tap, not words), and an edit of a saved
  entry. A microphone on every task was considered and left out: it needs an answer to where audio
  would live and which tasks would use it, and a transcript that becomes a task's notes is a
  different feature from a journal page.

## Markdown export

The share action offers Markdown beside CSV (`journalExportMarkdown`): a heading per day, each
entry under its time, oldest first. The entry's own text goes out as typed, with its `#` headings
pushed down two levels to stay under the day's. Tags and people are a line under the entry.

## Word counts and a word goal

`countWords` (`journal.ts`) counts the words as `JournalText` draws them, so a
bullet, a `#` or the `**` round bold is never a word. The entry sheet shows the
count under the field as it is typed, the screen shows each day's total in its
heading, and `journalWordGoal` (a setting, journal only) turns both into "312 of
500 words" with the days that reached it in the subtitle.

- **The goal is a day's, so the day's other snippets count toward it**, in the
  sheet and on the screen alike. A search filters entries, never the total.
- **A sealed note adds nothing before its day**, like every other reader
  (`openEntries`).
- **It is a goal the person typed in, and nothing is said about a day that
  fell short.** A day under the goal is not counted, never "missed", and
  `JOURNAL_WORD_GOAL_RANGE` is an absurdity check, not advice. Dreams have no
  goal: a dream is written down as it is remembered.
- **It is set from the Journal's target icon** (`JournalWordGoalSheet`) and
  from Settings › Health.
- **The goal syncs** (`journalWordGoal` is on the synced-settings allowlist, with
  `stepGoal`), so Claude sees it as `wordGoal` beside each entry's `words` in
  `list_journal_entries`.
- **`GoalStepperSheet` is the one goal sheet.** `JournalWordGoalSheet` and
  `SleepGoalSheet` only supply their setting, range and wording.
