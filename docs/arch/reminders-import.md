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
