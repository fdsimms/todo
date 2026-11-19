# On call

Today's "On call" strip, and the warning when an event, a dated task or a trip is
scheduled over an on-call stretch. The code is `src/utils/onCall.ts` (what counts and
what to say, pure and tested), `src/store/useOnCallStore.ts` (the read) and
`useOnCallSync` beside it, `src/components/OnCallStrip.tsx`, `OnCallWarning.tsx` and
`src/screens/settings/OnCallRows.tsx`.

## Rules

- **It reads events the phone already reads, and never writes.** Nothing creates a
  task, and nothing here touches a rating, a streak or coins. The strip is not a task
  on purpose: there is nothing to check off or defer, and it must vanish when the
  shift ends.
- **An event is on call when its calendar is marked, or its title holds one of the
  words.** Either alone is enough. The word test is `ruleMatchesTitle`'s, so it means
  what a word means in an event rule (whole word, three letters at least). Both lists
  are empty until set, which is what leaves the feature off. `onCallCalendarIds` holds
  EventKit ids, so like `calendarIds` it is device-only: not synced, and in
  `DEVICE_ID_SETTING_KEYS` in `backup.ts`.
- **It is not `occupiesTime` and `overlappingEvents`.** Those leave out all-day events
  and events marked Free, which is how a weekend or a holiday shift is usually written.
  An on-call span counts whatever its all-day flag or availability says; only a canceled
  event is left out.
- **All-day spans are whole local days; timed spans are moments.** An app day runs from
  `dayResetTime`, so an all-day Saturday is compared against the date the app day
  starts on (`onCallOnDay`), never against both dates a 4 AM to 4 AM day reaches into.
  A calendar date a picker returns is anchored at noon (`appDayOfDate`) for the same
  reason a bare midnight reads as the day before.
- **Its read is its own, 90 days, and not the calendar store's fortnight.** A trip or a
  dated task is planned further out than 14 days, and a warning that is silent past
  the window is silent when it matters. Only the spans are held, not the events. It
  follows the calendar read's gates: off with the read, off in demo mode, and a calendar
  vacation mode hides hides its shifts too. A failed read keeps what is held.
- **A warning only warns.** Saving still works, as it does for the overlap warning.
  The shown text says when ("You're on call 9:00 AM to 5:00 PM"), since a day that is
  only partly on call reads as a false alarm otherwise.
- **Never drop a typed word without saying so.** `onCallWordsProblem` is what the
  Settings field shows under itself, from the same `cleanWords` the match uses.
- **Not in the demo seed.** Demo mode never reads the device calendar, and this is
  derived entirely from it, so there is no row to seed.
- **An event that runs into a shift gets a swap task** (`onCallSwap`, `docs/arch/generated-tasks.md`).
  The conflicting events are held beside the spans in `useOnCallStore`, read only while that switch
  is on.
