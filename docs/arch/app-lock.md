# App lock and the API key

The Face ID gate in front of the UI, and the keychain the Anthropic API key
lives in.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are strong defaults with the reasoning
attached: read the reason before deviating from one. Where this note and the
code disagree, the code is what ships, so fix the note.

---

## App lock, and the one secret this app holds

Everything the app knows is unencrypted on the device, so two things guard it: a
Face ID gate in front of the UI, and the keychain for the API key.

**`locked` is derived, never stored** — `appLockEnabled && !unlocked`, computed in
`useAppLockStore`/`AppLockGate` from a session flag that no launch persists. An
`isLocked` boolean set from an effect has a committed frame where the setting and
the flag disagree, and it goes wrong in both directions: a frame of the task list
at cold start, and a frame of the lock screen the instant you enable the feature.
For the same reason the Settings toggle calls `unlock()` *before*
`setAppLockEnabled(true)`.

- **The grace period is the feature.** A lock that re-prompts on every app switch
  is the one people turn off, and a lock that's off protects nothing. Leaving
  starts a clock (`shouldLockOnResume`); only an expired one re-locks.
- **`prompting` is load-bearing.** iOS reports `inactive` while the unlock sheet
  is up. Counting that as leaving restarts the clock mid-prompt — and at a grace
  of 0, re-locks the moment you pass it, forever.
- **The gate is a `Modal`, not an overlay `View`.** Half the point of the shield
  over a backgrounded app is the app-switcher snapshot, and the user may have left
  with the task editor (itself a `Modal`) open — a sibling of the navigator renders
  *under* that.
- **It `preempts`, because a later modal does not stack above an earlier one.**
  This section used to say it did. Every screen-level sheet presents from the root
  view controller (`enableScreens(false)` leaves no screen that is one), and a view
  controller presents one thing at a time, so leaving the app with any sheet open
  meant the gate was refused with nothing shown: no shield over the snapshot, and a
  resume past the grace period that did not lock the app at all. Only a modal
  presented *by* the open sheet stacks, and the gate cannot be that — it has to
  cover whatever happens to be up. So the sheet that is up stands down instead and
  the gate presents into the space (`claimPresentation` in `sheetModal.ts`), with
  its own `visible` left alone so it comes back after the unlock.
- **The snapshot is covered natively, because standing a sheet down is too slow
  for it.** Yielding costs a React commit or two and the app-switcher snapshot is
  taken on the way out, so the JS path is late for exactly the half that cannot
  afford to be. `modules/todo-privacy-shield` adds a `UIVisualEffectView`
  straight to the app's own window on `willResignActive`: above every presented
  view controller (their containers are subviews of that same window), no
  permission, no entitlement, and up before the notification handler returns.
  `AppLockGate` drives it with `appLockEnabled && !prompting` — the same
  `prompting` nuance as everything else here, since iOS reports the app inactive
  for the Face ID sheet itself and covering the app behind the prompt that
  answers it is the one case it must not fire on.
- **The two halves are complementary, not redundant.** The native cover is a
  blur over the moment nobody is looking; the gate is the themed screen that is
  still there when they are, and the only one of the two that can ask for Face
  ID. An unlinked module (Android, a build without it) costs the cover and
  leaves the lock working.
- **No biometrics and no passcode enrolled fails open, out loud.** There is no
  second way in — no password, no account, no server — so the alternative is a
  task list nobody can ever open. It alerts rather than opening quietly, and
  leaves the setting on so it resumes when they re-enrol. The same reasoning is
  why turning the lock *on* authenticates first.
- **The journal has its own, second lock** (`journalLockEnabled`, `useJournalLockStore`,
  `useJournalAccess`). Same derived `locked = enabled && !unlocked`, but no grace
  period: `AppLockGate` closes it whenever the app stops being active. Every
  reader of journal text checks `useJournalAccess().locked`: the Journal and
  Dreams screens (which mount no content while locked), the mood day page, a person's page (its "In your writing" list) and
  Looking back, which drop the entries so paging doesn't stop on a day that only
  has writing on it. A new reader of journal entries does the same. It is
  device-local like the app lock, and it does not cover Claude's journal tools,
  which are governed by the sync switch in `journal.md`.
- **Individual projects can be locked, and the lock is a display rule.**
  `useProjectLockStore` holds the locked ids (`lockedProjectIds` in settings,
  device-local like the other locks) and a session `unlocked` flag that
  `AppLockGate` closes whenever the app stops being active, with no grace
  period. One Face ID opens every locked project for the session. A locked
  project's tasks are filtered out of the list selectors in `useTaskStore`
  (`isLockedAway`), Search, quick search and the Logbook, and its page renders
  `ProjectDetailScreen`'s lock notice instead of mounting. **It is not
  `isWithheld`:** the tasks stay due, repeat, keep their streaks and are
  charged as usual, so a locked project never stands anything down.
  - **There is always a sign the tasks exist.** The Projects list keeps the
    row, with a lock and no counts, next step or dates, and Today shows one
    "N tasks in locked projects" row that asks for Face ID when tapped.
  - **Anything outside the app ignores the session flag.** The widget and a
    reminder can't ask for Face ID, so `isProjectLocked` (locked at all) keeps
    a locked project's tasks off the widget and a reminder reads "Task
    reminder" with no title or notes, even while the app is unlocked.
    Toggling the lock reschedules that project's reminders.
  - **List selectors only re-run when the task store changes**, so
    `useProjectLockStore.revision` is mirrored into `useTaskStore.lockRevision`
    on every lock or unlock.
  - **Not covered:** Claude's MCP tools (a lock is a screen guard on this
    device, as the journal lock is), the month grid, Stats and any screen that
    reads `tasks` directly. A new screen that lists tasks filters with
    `isProjectLockedAway`.
- **`resetToDefaults` doesn't touch it**, like vacation mode: "reset appearance and
  formatting" is not a request to take the lock off the app.

The **API key** is in the keychain (`expo-secure-store`), not the settings table.
It migrates itself on the first launch after the update, and the ordering is the
part to leave alone: the keychain copy is written *first*, and the plaintext row
deleted only once that write returns. A failure between the two leaves both, which
the next launch resolves; deleting first would destroy a credential the user
pasted in months ago. **There is no plaintext fallback** — a keychain that won't
take the key means it isn't persisted, not that it goes back in the database.
`secureApiKey.ts` `require`s the native module lazily rather than importing it,
because `useSettingsStore` reaches it and most of the suite reaches that store,
in a `node` environment where loading `expo-modules-core` throws on sight.
