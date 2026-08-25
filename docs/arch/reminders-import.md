# Apple Reminders import

Voice capture by way of the Reminders app, and the only feature in this app
that destroys data the user owns somewhere else. The safety rules here are
load-bearing, not ceremony.

Moved out of `CLAUDE.md` so it is read when it applies rather than on every
task. The rules here are settled decisions with the reasoning attached: don't
re-derive them from the code, and don't re-open one without a reason the note
doesn't already cover.

---

## Apple Reminders import — voice capture, and the only thing that deletes data elsewhere

"Hey Siri, remind me to buy milk" lands in the Reminders app; `src/utils/remindersImportSync.ts`
pulls it into the Inbox and deletes the reminder. Going through Reminders rather than owning a
Siri phrase is deliberate — a phrase has to be anchored on `\(.applicationName)`, and Siri
cannot reliably hear "dundundun". A custom App Intent was built and reverted for exactly that
(plus an iOS 16 floor it forced); don't reach for one again without solving the name.

Three things about `expo-calendar` that nothing in this repo will tell you, each of which cost a
read of the published tarball:

- **`getRemindersAsync` must be called with a null status.** Passing `ReminderStatus.INCOMPLETE`
  makes the JS wrapper throw unless you also give it a date window, and natively that window is
  matched against the **due date** — which a dictated reminder hasn't got. A status query drops
  exactly the reminders this feature exists for. So the fetch is unfiltered, completed reminders
  come back with everything else, and every "may we touch this" rule lives in
  `importableReminders()` instead. That's why the pure module is mostly filters.
- **`getDefaultCalendarAsync()` is not the default *reminders* list.** It asks for **calendar**
  permission (which this app never wants) and returns `defaultCalendarForNewEvents`. There is no
  API for the reminders default, which is why picking a list is the first step of enabling
  rather than a correction to a guess.
- **Never pass an unvalidated list id.** A stale one reaches `predicateForReminders(in: [])` —
  undocumented, and if an empty array ever behaved like `nil` it would mean every reminder on the
  device. The drain re-checks the id against a live `getCalendarsAsync(EntityTypes.REMINDER)`
  every time.

And one about config plugins generally, learned here: **leaving a package out of `app.json`'s
`plugins` does not stop its config plugin running.** Expo autolinks the plugin of any dependency
shipping an `app.plugin.js`, so `expo-calendar`'s ran unasked and wrote two `NSCalendars*` usage
strings this app has no business declaring, plus Android `READ_CALENDAR`/`WRITE_CALENDAR`. The
way to *narrow* a plugin is to list it with options, and the Android half needs
`android.blockedPermissions`, which the plugin adds unconditionally regardless of its options.

**But `calendarPermission` must stay a real string, and this is the one that bricked the app.**
`createPermissionsPlugin` treats `false` as a removal, so setting it deleted
`NSCalendarsUsageDescription`/`NSCalendarsFullAccessUsageDescription` — which reads as exactly
right, since nothing here ever touches a calendar. It isn't. `CalendarModule`'s `OnCreate`
registers a `CalendarPermissionsRequester` and initialises a static `EKEventStore` **whether or
not the app ever calls a calendar API**, and touching EventKit's calendar entity with no usage
description raises an `NSException` inside module registration.

What that costs is the whole app, not the feature. Expo registers modules in one pass in
autolinking order, so the throw took out `expo-calendar` *and every module alphabetically after
it* — font, constants, sqlite, notifications, all of them. Fifteen of twenty modules never
registered. The app then died on the first `requireNativeModule` the bundle happened to reach,
which was `ExpoFontLoader` (via `@expo/vector-icons`, which imports `expo-font` on line 1), and
the black screen that produced is why `index.js` prints the registered-module list on failure —
**that list is the diagnostic**: a short one means registration aborted, and the first missing
package alphabetically is the culprit, not the module named in the error.

The safety rules are load-bearing, not ceremony — this is the one feature that destroys data the
user owns in another app. **Create the task, then delete the reminder**, never the reverse: a
failed delete leaves a visible duplicate, a failed create after a delete loses the capture
silently. The handled record (`remindersImportHandled`) names a reminder the moment its task
exists, before the delete is attempted, because both a *failed* delete and a *slow* one hand the
same reminder back to the next fetch. A list is only offered if `allowsModifications` — a read-only shared list imports
fine and fails every delete, re-importing itself for ever. And nothing runs until the user has
confirmed an alert naming the list and the exact count, keyed on the list id so switching lists
asks again.

**"Already handled" is keyed on the reminder's id and persisted, never inferred from the task.**
With "Delete after importing" off — and after any failed delete — the reminder stays in the list
and is re-read on every foreground, so something has to say "we've seen this one". That used to
be a title match against the store, which is evidence *the user can destroy*: renaming or
deleting the task freed the reminder to import again, and again, with nothing they could do
about it. The record is now a settings row keyed by list (`remindersImportHandled`), holding
every id imported **or deliberately skipped** — a skip has to count, because on the first launch
after this shipped the name index is the only thing that recognises the pre-existing imports, and
recording what it recognises is the entire backfill. It stays bounded by pruning to what the list
still holds on every drain (`reconcileHandledReminders`), so with deletion on it empties itself.
The name index survives as the *first* answer about a reminder the record has never seen, not as
the record.

## Two-way sync for the grocery list

`groceryImportTwoWay` turns the grocery leg from a drain into a mirror: rows added here are
written back as reminders, checking off either side completes the other, and removing an item
deletes its reminder. `src/utils/groceryReminderMirror.ts` holds every rule, `mirrorOnce` in
`remindersImportSync.ts` executes them. The task leg is untouched and has no such mode.

**It replaces the one-way drain for that list rather than running beside it** (`drainTargets`
skips the grocery target while it's on), and it is mutually exclusive with
`groceryImportDelete`, which the setter enforces rather than the UI. Both would read the same
list; deleting a reminder the moment it's read leaves nothing to mirror, and every row would be
written straight back out on the next pass.

**A link, not a name, is what stops a duplicate.** The import's name index is deliberately wide
(above) because there a false match costs one skip and a false miss costs an unbounded
re-import. That trade doesn't survive here: a name can't tell "the user deleted this reminder"
from "we never pushed it", and getting it wrong either resurrects a row they just deleted or
deletes one they just added. So each mirrored pair is a `GroceryReminderLink` — the two ids plus
a **shadow** of the title and completion the pair last agreed on. Every pass is then a three-way
diff: a side that differs from the shadow is the side that changed and wins, both changed is the
only real conflict, and the app wins that because the rest of the row (its aisle, its price, its
stores) lives here. Names still matter in exactly one place, and it's load-bearing: an unlinked
reminder whose name key matches a row already on the list is **adopted** rather than added. That
is what makes a second device, a re-picked list, and a name typed into both apps converge instead
of duplicating.

**It's a reconcile, not a set of hooks, and that isn't a shortcut.** `onList` is written by a
dozen store actions, and anything done in the Reminders app while this one is closed is invisible
until the next foreground — so a per-mutation push is permanently behind. A diff converges from
whatever state it finds. It runs on the drain's own triggers plus a grocery-store subscription
keyed on `groceryMirrorSignature` (the store notifies on every write, and a price or an aisle says
nothing a reminder can hold). The mirror's own writes re-enter through that subscription and land
on `rerunRequested`, which is safe only because a second pass over a settled pair is silent —
`groceryReminderMirror.test.ts` pins that with the convergence cases, and a plan that kept finding
work would be a loop writing to both apps for ever.

Five things that are the way they are for a reason:

- **The link record is device-local**, in the settings table under `groceryImportLinks`, not a
  column on `grocery_items`. That table syncs (`SYNC_TRACKED_TABLES`) and an EventKit id names a
  record on one device; a link that travelled would point at nothing on the other phone, or at
  something else. Two devices on one iCloud list keep their own links and meet by adoption.
- **`GroceryReminderLink.seen` is false for exactly one gap** — the pass that created the
  reminder, which knows its id only because `createReminderAsync` returned it. A missing reminder
  is how a deletion is recognised, and that read is only safe once a fetch has been seen to hold
  it. Unconfirmed and missing means the link is dropped and the row gets a fresh reminder, never
  that the row comes off the list. Same asymmetry the name index is built on: a duplicate reminder
  is visible and recoverable, groceries quietly vanishing before a shop is neither.
- **A failed delete keeps its link.** Dropping it would leave a reminder the next pass reads as
  new and adds the row straight back for, which is the one thing this design exists to prevent.
- **Every `updateReminderAsync` carries the whole title**, even when only the tick changed.
  `saveReminderAsync` assigns `reminder.title = details.title` unconditionally
  (`CalendarModule.swift`), so a partial update blanks the title of the row it meant to leave
  alone. Same for `location`.
- **A mirrored pass marks the whole list handled** (`rememberHandled(listId, present, present)`),
  so switching two-way back off hands the one-way drain a clean slate rather than a list it reads
  as one big backlog — including the reminders the mirror itself wrote.

Ordering is the drain's own rule, applied on both sides: everything that creates runs before
anything that destroys. The app-side writes go first (none of them destroy anything —
`removeFromList` parks a row in the catalog with its aisle, stores and price intact), then the
reminders that need writing or updating, then the deletes. And `isDemoModeActive()` gates both
this and the drain, which it didn't before: demo mode swaps the whole database, so an ungated pass
pushes a seeded list into the user's real Reminders list, or drains real reminders into rows that
are about to be thrown away.
