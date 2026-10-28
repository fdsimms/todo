# iOS native extension targets

Reference for adding or changing a native target (widget, Watch app, Live Activity, share
extension). Referenced from `CLAUDE.md` — read this *before* touching `plugins/` or
`targets/`, not after the first failed build.

Targets are injected at prebuild time by custom config plugins rather than a checked-in
`ios/` folder:

- **`targets/todo-widget/`** — the Home Screen widgets (Today, Groceries, Kitchen, Medications,
  Limits, Calendar) and the Live Activities, added by `plugins/withWidgetExtension.js`.
- **`targets/todo-share/`** — the share extension ("dundundun" in another app's share sheet,
  for a recipe page or a screenshot to read tasks from), added by `plugins/withShareExtension.js`.
  A link goes to `SharedRecipeQueue` (one JSON file the app drains and deletes). An image goes to
  `SharedTaskImageQueue`: a downscaled JPEG in `shared_task_images/` in the App Group, which the
  app lists, reads and deletes one at a time (`listSharedImages`, `readSharedImage`,
  `deleteSharedImage` in `todo-widget-bridge`). Not drained, because the file is the only copy until
  a person acts on it. A share with a URL always takes the link path, so a page shared with a
  preview image still goes to Recipes. Reading it is an Anthropic call, so it waits for a tap on
  `SharedImageBanner` (Today) and ends in `TaskImportSheet`'s review step.
- **`targets/todo-activity-monitor/`** — the DeviceActivity monitor, added by
  `plugins/withActivityMonitor.js`. Woken when a usage threshold is crossed, when a scheduled
  gate window starts (`intervalDidStart`), and at the end of a penalty block (`intervalDidEnd`).
- **`targets/todo-shield-config/`** and **`targets/todo-shield-action/`** — the screen shown
  when a blocked app is opened, and the button on it, both added by
  `plugins/withShieldExtensions.js`.
- **`targets/todo-watch/`** and **`targets/todo-watch-complication/`** — the Apple Watch app
  (Today and the grocery list, ticked off from the wrist, and a workout logged set by set and
  measured with a HealthKit session) and
  its watch face complication, both
  added by `plugins/withWatchApp.js`. See "The watch app" below.

`plugins/withAppGroup.js` puts the App Group on the main app and exports `APP_GROUP_ID`; each
extension's plugin writes its own `.entitlements` with that id (`todo-shield-action` deliberately
has none). Every target builds through **`plugins/lib/nativeTarget.js`**, which is where the sharp
edges below actually live. **Add a new target by calling `addAppExtensionTarget` too, not by
copying a plugin.** Every workaround in that file was a failed build cycle to find and every one
of them fails *late* — at archive or at submission, not at build — so a second copy is a second
place the next one would have to be found again. What belongs in the plugin is only what genuinely
differs per extension point: the Info.plist, the entitlements, the frameworks, the deployment
target, and which sources compile in.

`npx expo prebuild --platform ios --no-install` runs offline and is the cheap way to check a
plugin change: it writes `ios/` (gitignored) and you can read the generated `project.pbxproj`
and Info.plist directly. The `xcode` package mints random UUIDs, so two runs are never
byte-equal — rewrite each distinct 24-hex-char id to a counter in order of first appearance and
the two runs compare exactly, which is how to prove a refactor left a target unchanged.

- **A new target must be declared in `app.json`'s
  `extra.eas.build.experimental.ios.appExtensions`** (name, bundle id, entitlements, matching the
  plugin's own `.entitlements`; nothing checks that the two agree), or EAS
  Build's non-interactive credential resolution never discovers it and can't provision it —
  the archive step fails with an opaque signing error.
- **Signing needs `PBXProject.attributes.TargetAttributes`, not just `buildSettings`.**
  `project.addTargetAttribute('DevelopmentTeam', ...)` / `('ProvisioningStyle', 'Automatic',
  ...)` — Xcode's own "requires a development team" validation reads the former; setting
  `DEVELOPMENT_TEAM` in buildSettings alone isn't enough.
- **The `xcode` package's `addTarget()` and `addPbxGroup()` have real bugs**, not just missing
  convenience: `addTarget()` pre-wraps `name`/`productName` in literal quote characters
  (breaks any later string match, including EAS's own target lookup) — overwrite
  `target.pbxNativeTarget.name`/`.productName` right after calling it. `addPbxGroup()` with no
  `path` argument writes a literal `path = undefined;` into the pbxproj — `delete
  group.pbxGroup.path` immediately after.
- **Every `$(BUILD_SETTING)` placeholder used in the target's Info.plist must have a real key
  in the source plist**, even ones Xcode's "New Target" template fills in for you normally
  (e.g. `CFBundleIdentifier`). A key that's just absent doesn't get a value substituted in —
  it silently compiles to `(null)`, which then fails Apple's "embedded binary must be prefixed
  with the parent bundle id" validation at submission, not at build time.
- **A local `expo-modules-core` bridge module needs an actual podspec** to get linked into a
  second target's Pod install, even though autolinking usually infers one from
  `expo-module.config.json` alone for the main app target.
- **The App Group container path convention already in use**: `<container>/Library/Application
  Support/<name>.json`, single-writer (app) / many-reader (extensions), no locking needed.
  Reuse this path shape for anything new sharing the group rather than inventing another
  location. **`widget_quiet_taps.json` is the exception with two writers**, the widget's
  checkboxes (`QuietTapQueue`) and the phone's `WatchSession` for the watch's taps, so both read
  and rewrite it through `JSONSerialization` and leave entries they don't recognise untouched.
  Decoding it as a Codable array and writing that back is what used to strip the watch's fields.
  **And every read-and-rewrite of it, and the app's read-and-delete (`drainQuietTaps`), is one
  coordinated write** (`NSFileCoordinator`, `coordinatedQueueWrite` in `WatchSession.swift` and its
  copy in `WidgetQuietIntents.swift`): the widget appends from another process, so without it an
  append could be written over by another, or land between the drain's read and its delete and be
  deleted unread. A new writer of the file goes through the same helper. If coordination itself
  fails the accessor never runs, so the helper then runs the body uncoordinated rather than drop a
  tap; never call it inside another coordinated block, which Foundation refuses.
  **`widget_pending_add_tasks.json` is the other queue with more than one writer** (`AddTaskIntent`
  and the watch's "add" taps through `WatchSession`, drained by `drainPendingAddTasks`), and every
  append and the drain go through the same helper for the same reason. A file that gains a second
  writer joins this list.
- **The Calendar widget reads EventKit in the extension, and whether iOS lets it is not verified
  on a device.** An extension is its own process and its own bundle, so it carries a usage
  description (`NSCalendarsFullAccessUsageDescription`, in `withWidgetExtension.js`'s Info.plist)
  and links `EventKit.framework`, and it never asks: it reads only when
  `EKEventStore.authorizationStatus(for: .event)` already says `.fullAccess`. A 2022 forum thread
  reports widget extensions getting `.denied` while their app had access, so the widget is built
  not to depend on it: every snapshot carries the app's own read of today and tomorrow
  (`buildWidgetCalendar`, bucketed by day in JS so the extension never has to place an all-day
  event), and the widget draws that when EventKit refuses. If a device shows the widget lagging
  behind the calendar until the app opens, this is why. The calendars, colors, hidden occurrences
  and timed tasks always come from the snapshot. It has Lock Screen sizes too (rectangular,
  inline, circular), drawn in `.primary`/`.secondary` only, since the Lock Screen renders an
  accessory as one vibrant tone.
- **The widget bundle is two nested bundles** (`TodoWidgetBundle.swift`), because there are more
  than ten widgets and a builder block past ten needs the parameter-pack `buildBlock` an older SDK
  may lack. A new widget goes in `TodoHomeScreenWidgets` or `TodoLiveActivities`, not the outer one.
- **A share extension's `NSExtensionPrincipalClass` failing to resolve is a silent no-op**, not
  a build error: iOS instantiates the named class when the row is tapped, and if the name is
  wrong nothing at all happens. A Swift class's Objective-C name is module-qualified, so the
  value is `$(PRODUCT_MODULE_NAME).ShareViewController` — and `PRODUCT_MODULE_NAME` is pinned
  explicitly in `withShareExtension.js` rather than left to derive from `PRODUCT_NAME` through
  `:c99extidentifier`, since the share sheet's whole behaviour otherwise rides on a string
  substitution nothing checks.
- **`NSExtensionActivationRule` decides which apps show the extension at all.** Matching only
  `NSExtensionActivationSupportsWebURLWithMaxCount` misses every app that shares a page as a
  *string* with the link inside it, which is common; matching text as well means the extension
  has to run a link detector over what it's handed and be prepared to find nothing.
- **A share extension cannot open its containing app.** `NSExtensionContext.open(_:)` is not
  available to this extension point, so anything the app has to do — here, fetching the page and
  running the extraction — has to wait for the app to be opened some other way. The extension
  writes to the App Group and the app drains it on launch and on foreground; the queue is
  *persisted on the app side* immediately, because the drain deletes the file it read and would
  otherwise be the only copy (see `src/store/useSharedLinkStore.ts`).
- **The workout activity is the one kind updated in place, and the model for any activity whose
  content moves while it is alive.** The other kinds hold everything in their attributes and are
  ended and requested again on a change. `WorkoutActivityAttributes` holds only what is fixed for
  the activity's life (the session and its start), everything drawn is the `ContentState`, and
  `syncWorkoutLiveActivity` compares the payload's `key` against `activity.content.state` and calls
  `activity.update(ActivityContent(state:staleDate:))` only on a change. Checked against Apple's
  JSON docs: `func update(_ content: ActivityContent<Activity<Attributes>.ContentState>) async`
  and `var content: ActivityContent<Activity<Attributes>.ContentState> { get }`, both iOS 16.2,
  async and non-throwing ("The system ignores attempts to update a Live Activity that ended").
  Two things follow. An activity whose `activityState` is `.ended` is never the one kept. That
  guard does not cover the app's own ends: `end(_:dismissalPolicy: .immediate)` moves an activity
  to `.dismissed`, not `.ended`, and `.dismissed` is deliberately still matched, because it is also
  what a card the person swiped away reads as, and treating it as gone would put that card straight
  back on the next sync. The cost is narrow: an activity ended moments ago and still listed can be
  matched by a run that returns to exactly its attributes (the workout switch turned off and on
  again quickly), which then shows nothing until the next change. And an update replaces the stale date,
  so a state sent after the stale moment has passed has to carry that fact itself (`restOver`), or
  the update turns the card back to the state before it.
- **A bridge function added after the first release is exported as `undefined` when the binary
  lacks it** (`hasNative` in `modules/todo-widget-bridge/index.ts`), not as a wrapper that throws.
  That is what `WidgetBridge` typing it optional means, and what lets a caller's `bridge?.fn?.()`
  skip it on a dev client built before it. A new function goes in that list and in the type as
  optional together.
- **A restarted kind keeps an activity only while every attribute still matches its run, never on
  its key alone.** `syncTimerLiveActivities` used to, so "+1 min", a restart or a rest's nudge,
  which keep the key, left the Lock Screen counting to the old end (`timerActivityMatches`). And
  never build `Dictionary(uniqueKeysWithValues:)` over `Activity.activities`: an ending activity can
  be listed beside its replacement under the same key, a duplicate key is a Swift trap, and
  `TodoWidgetExceptionCatcher` catches only Objective-C exceptions.
- **A Live Activity needs `NSSupportsLiveActivities: true` in the *main app's* Info.plist**
  (`expo.ios.infoPlist` in `app.json`) — not the widget extension's. Without it,
  `Activity.request` throws at runtime on the very device it's meant to work on; nothing at
  build time catches the omission, because the extension itself doesn't request activities, it
  only renders the ones the app process starts.
- **An `AppShortcutsProvider` (the Action Button / Siri / Shortcuts entry point) must live in
  the *main app* target, not an extension.** An `AppShortcutsProvider` declared in an extension
  only donates shortcuts for *that extension's* own intents, not to the app as a whole, so it
  never shows up in the system-wide Shortcuts/Action Button picker. `AddTaskIntent` and its
  `AppShortcutsProvider` (`modules/todo-widget-bridge/ios/AddTaskIntent.swift`) live in the
  widget-bridge module for this reason: that module's podspec already globs every `.swift` file
  there into the main app target (see `TodoWidgetBridge.podspec`'s `s.source_files`) — no
  target-injection plugin work needed, unlike a widget/share-extension addition. The intent
  still can't reach the app's SQLite or JS logic, so it follows the
  App-Group-queue-then-open-the-app shape.
- **An `AppIntent` that brings the app to the foreground must compile into the main app target
  too — an intent hosted *only* by a widget extension can never open the app.** Apple's
  "Configuring the runtime behavior of your app intents" states it outright: code in a widget
  extension (or an App Intents extension) runs only in the background. The foreground half is
  not refused loudly — `perform()` still runs and still writes whatever it queued, so the tap
  looks like it half-worked and the app simply never comes forward. Neither `openAppWhenRun` nor
  iOS 26's `supportedModes { .foreground(.immediate) }` fixes it on its own: they declare the
  requirement, and an extension-only intent has no process that can satisfy it. **The fix is
  target membership:** `CompleteTaskIntent.swift` lives in `modules/todo-widget-bridge/ios/`
  (globbed into the app by the podspec) *and* is listed in `withWidgetExtension.js`'s
  `SHARED_SWIFT_FILES` so the extension, whose `Button(intent:)` names the type, still compiles
  it. Both properties are kept: `supportedModes` for iOS 26+, `openAppWhenRun` for older. A file
  compiled into two targets can't share the widget target's App Group helpers, so it carries its
  own file-private copy, as `AddTaskIntent.swift` does. `allowedExecutionTargets` (iOS 27+) would
  pin execution to `.main` explicitly, but referencing it at all needs the EAS build image to carry
  the iOS 27 SDK, even behind `@available` (that guard controls when code *runs*, not whether the
  compiler's SDK has the symbol). Check the image's Xcode version before adding it.
  The converse holds too: an intent that only queues work and never opens the app belongs in the
  widget target alone. `CompleteTaskQuietlyIntent` and `CheckGroceryItemIntent`
  (`targets/todo-widget/WidgetQuietIntents.swift`) are that case, and are listed in `SWIFT_FILES`,
  not `SHARED_SWIFT_FILES`.
- **The custom shield screen is two targets, not one, and the layout is not yours.** A
  `ShieldConfigurationDataSource` (`ManagedSettingsUI`) draws the screen and is *never told
  about a tap*; `ShieldAction` only ever reaches a `ShieldActionDelegate` (`ManagedSettings`),
  at a different extension point — so a button drawn by the configuration extension does
  nothing at all until the second target exists. The two point identifiers differ by exactly
  the `UI` suffix (`com.apple.ManagedSettingsUI.shield-configuration-service` vs
  `com.apple.ManagedSettings.shield-action-service`), which is the easiest typo here to make
  and, like every wrong principal class, silently yields no extension rather than a build
  error. And there is no custom UI to write: the whole `ManagedSettingsUI` framework is two
  types, so what a caller supplies is a blur style, a background colour, one `UIImage`, three
  `Label`s and a button colour, which iOS arranges for you. Every app's shield screen has the
  same shape for this reason. The one image is drawn in code (`mark` in
  `ShieldConfigurationExtension.swift`) rather than loaded: nothing in `plugins/` copies an asset
  into an extension's bundle, and a missing one renders as nothing, not as a build error.
- **`Application.localizedDisplayName` works inside a shield extension**, which is the one
  place a blocked app's name is readable at all — everywhere else in the app a picked app is
  an opaque token that only SwiftUI can render (see `modules/todo-screentime-bridge`). It is
  `String?`, so handle nil. In the *action* extension you get an `ApplicationToken` rather than
  an `Application`, and the name has to be reconstructed with `Application(token:)`.
- **`LogDreamIntent` (`modules/todo-widget-bridge/ios/LogDreamIntent.swift`) is the free-text shape
  with a timestamp.** `AddTaskIntent`'s phrase (nothing interpolated, Siri asks "What did you
  dream?") plus `LogMedicationIntent`'s queued record (`{ text, at }`, so a dream said on waking files
  under that day however late the app drains it). It only appends to `pending_dreams.json`; the app
  writes it through `useJournalStore.addEntry` on the next foreground (`processPendingDreams`,
  `src/utils/dreamQueue.ts`) and navigates nowhere, so the journal's Face ID lock stays closed.
  Written without a compiler: it copies the two intents above line for line, and a build is
  the first check on it.
- **`LogFoodIntent` (`modules/todo-widget-bridge/ios/LogFoodIntent.swift`) is `LogDreamIntent`'s shape
  pointed at the offline meal queue.** Siri asks "What did you eat?"; `perform()` appends `{ text, at }`
  to `pending_foods.json`, and the app hands each to `usePendingEstimateStore.enqueue`
  (`processPendingFoods`, `src/utils/foodQueue.ts`), then drains it. **It never logs anything**: the
  meal is estimated and waits on the Food log screen for a tap, the rule `src/utils/estimateQueue.ts`
  holds. With no API key, or the estimate feature off, the meal sits there marked as not estimated
  rather than vanishing. Written without a compiler, as the intents above were.
- **`ToggleKeyLockIntent` (`modules/todo-widget-bridge/ios/ToggleKeyLockIntent.swift`) is `LogDreamIntent`'s shape with a code in place of the text.** One `String` parameter, the key's token; `perform()` appends `{ code, at }` to `pending_key_scans.json` and the app checks it against the key list on the next foreground (`processPendingKeyScans`, `src/utils/keyScanQueue.ts`). **It is deliberately not in `DundundunShortcuts`**: an intent in no provider still shows as an action in the Shortcuts app, which is the one place it should be, and has no Siri phrase. Why a code rather than the tag is in `docs/arch/nfc-key.md`. Written without a compiler, as the one above was.
- **`LogJournalIntent` (`modules/todo-widget-bridge/ios/LogJournalIntent.swift`) is `LogDreamIntent`
  for the journal, and shares its queue.** Siri asks "What do you want to write down?" and the record
  is `{ text, at, kind: "journal" }` in `pending_dreams.json`; a record with no `kind` is a dream, so
  the older intent's records read as before. **Both intents' structs and the drain's payload carry
  `kind`**, because each re-encodes the whole file: one that dropped it would file a journal entry
  waiting in the queue as a dream. Written without a compiler, as the dream intent was.
- **`StartWorkoutIntent.swift` holds two intents and one queue.** `StartWorkoutIntent` takes
  nothing ("Start my workout in dundundun") and `StartRoutineIntent` names a routine, so its routine
  is an `AppEntity` with `MarkDisposedIntent`'s query over an index
  (`siri_workout_routines.json`, `src/utils/workoutSiri.ts`). Both append `{ routineId, name, at }`
  to `pending_workout_starts.json` and open the app, which starts the newest one
  (`processPendingWorkoutStarts`). Main app only: no widget names them. **`StartRoutineIntent` is not
  in `DundundunShortcuts`**: the provider is at iOS's limit of ten App Shortcuts, so the journal took
  that phrase and the routine start is a Shortcuts action only (`Log Mood` and `Open Screen` are the
  others). A new phrase has to replace one of the ten. Written without a
  compiler, copying `LogMedicationIntent.swift` line for line.
- **`ShortcutActionIntents.swift` holds four intents and one queue**: Log Water (optional glass
  count), Log Mood (an optional `AppEnum` level; none opens the mood log), Add to Grocery List
  (free text, `AddTaskIntent`'s follow-up question) and Open Screen (an `AppEnum` of routes). Each
  appends `{ kind, value, count, at }` to `pending_shortcut_actions.json` and opens the app, which
  applies them in order (`processPendingShortcutActions`, `src/utils/shortcutQueue.ts`); Open Screen
  goes through `openScreenByName`, so a switched-off screen stays shut. Main app only. Written
  without a compiler, copying `LogFoodIntent.swift` and `MarkDisposedIntent.swift`'s `AppEnum`.
- **An app may have at most 10 App Shortcuts, and the build fails past it** ("each app may have at
  most 10 App Shortcuts"; Apple's DTS confirms there is no way round it). `DundundunShortcuts` is at
  ten, so a new Siri phrase has to replace one. An intent left out of the provider still shows as an
  action in the Shortcuts app, which is where Log Mood and Open Screen live.
- **A phrase with an entity in it learns the names it can say from the query's
  `suggestedEntities()`, and `updateAppShortcutParameters()` is how the app asks for them to be read
  again.** `writeWorkoutRoutineIndex` calls `DundundunShortcuts.updateAppShortcutParameters()`
  after each write (declared `static func updateAppShortcutParameters()`, iOS 16.0, on
  `AppShortcutsProvider`), and the JS side writes only when the list changed. Apple's page has no
  discussion text; the "call it when the values change" rule is from the WWDC22 App Shortcuts
  session, so treat Siri hearing a routine added after install as unverified until a device says so.
  The call is provider-wide, so it refreshes the pantry and medication phrases too, whose own index
  writers don't make it.
- **A spoken Siri phrase for an `AppShortcut` needs the `com.apple.developer.siri` entitlement
  *and* `NSSiriUsageDescription`, even though App Intents otherwise needs neither.** Without the
  entitlement (`plugins/withSiriShortcuts.js`, added via `withEntitlementsPlist`), the same
  shortcut still runs fine from the Shortcuts app, Spotlight, and the Action Button's "Shortcut"
  picker — voice specifically is the only path that's silently unrouted, which makes this easy
  to ship half-working and only notice when someone actually says the phrase.
- **An `AppShortcut` phrase can only interpolate an `AppEntity` or `AppEnum` parameter, never a
  `String` — and that decides the whole shape of the feature, not just its wording.** A phrase
  naming a `String` parameter is rejected at the `ExtractAppIntentsMetadata` archive step
  ("AppEntity and AppEnum are the only allowed types for title"), which is an *archive*
  failure: it survives every local check and surfaces on EAS. So a spoken value has two
  possible homes and they cost very differently. Leave it out of the phrase and the intent
  takes it as free text with a `requestValueDialog`, which is why "Add a task in dundundun"
  asks a follow-up question (`AddTaskIntent.swift`) and needs nothing else. Put it *in* the
  phrase — "Mark `<item>` as used up in dundundun" — and it has to be an entity, which drags in
  an `EntityStringQuery` to resolve the spoken name against. That query runs in the same
  process `perform()` does, with no SQLite and no JS, so it can only read the App Group: the
  app writes a small `{id, name}` index on every catalog change and the query matches against
  that file (`src/utils/pantryIndex.ts`, `MarkDisposedIntent.swift`). Budget an index, a write
  path and a staleness story before choosing the inline phrasing.
- **Match loosely in the query and resolve again in JS, rather than trying to be right once.**
  The entity query returns *every* match in its best tier so Siri asks which was meant instead
  of choosing silently, and the intent queues the resolved id **and** the spoken name. The id
  is a pointer into a file written earlier, so it can name a row deleted or merged since, and
  every store action here resolve-or-shrugs on an unknown id — which means the failure is a
  no-op the user cannot tell apart from success. The JS drain re-resolves by name through the
  app's own lookup when the id misses (`resolveQueuedPantryItem`), which is also where the
  plural handling lives: nothing in Swift should reimplement `groceryNameKey`.

## The watch app

Two watchOS targets: the app (`TodoWatch`, embedded in the iPhone app) and its complication
(`TodoWatchComplication`, a WidgetKit extension embedded in the *watch app*). Neither is an
iPhone extension, and most of what that changes lives in `addWatchAppTarget`,
`addWatchExtensionTarget` and `withExplicitTargetDependency` (`plugins/lib/nativeTarget.js`),
whose comments carry the reasons. The rules worth knowing before touching them:

- **Both are in every build, and so is the iPhone half.** Their `appExtensions` entries are in
  `app.json` like every other target's (a watch app's bundle id has to start with the iPhone
  app's, and the complication's with the watch app's). `WatchSession.swift` and the watch's
  snapshot write run in every build too, and do nothing without a paired watch that has the app.
- **The watch can't read the App Group, so the data path is WatchConnectivity, both ways.** The
  watch is another device with its own containers. Out: the app builds a second copy of the
  widget snapshot with `WATCH_CAPS` (room for a whole shopping list), and
  `WatchSession.swift` sends it as the session's application context, compressed. Back: a tap
  is a user-info transfer, which `WatchSession` appends to the widget's own quiet-tap queue (or
  AddTaskIntent's queue, for a dictated task) in the widget's shape, so
  `processQuietWidgetTaps` applies it with the widget's rules. Four tap kinds exist only for the
  watch: `choose` (settle an either/or on the list the tap names, through `resolveChoice`'s
  explicit `listId`), `groceryAdd` (a dictated item, which rides the quiet-tap queue rather
  than AddTaskIntent's task-title queue so it applies in order with the ticks around it) and
  `defer` (a row's swipe to tomorrow, which writes `quietDeferUpdates`: the move the app's own
  Tomorrow makes, dropped rather than applied a day late if the day ended before the drain).
  `answer` completes a task with the answer to its question, which the watch asks itself when
  the snapshot's row carries a `question` (`watchQuestionFor`: yes/no, pick one, text, a
  number, never a date). The drain checks the question again, and an answer that no longer
  fits is handed to the app to ask again rather than dropped.
- **The watch pager has no visible way to its second page on its own.** Today is a scrolling
  list, so the Digital Crown scrolls it instead of paging past it, and Groceries was only
  reachable by a vertical swipe nobody is told about. Today's top-leading toolbar button (a cart)
  sets the pager's selection (`TodoWatchApp`'s `page`), and Groceries has the matching one back.
  A new watch page needs an entry like that, in the top bar rather than a row at the end of a
  list, which is where Add sits too: a long list put both out of reach.
- **Double tap (`handGestureShortcut(.primaryAction)`, watchOS 11) belongs to one control per
  screen.** Apple resolves it by a leading-to-trailing walk of the scene and says nothing about
  two claimants, so a screen gives it to exactly one. The workout's Done set, Skip and Go to the
  set are never on screen together, which is why all three can have it.
- **A tap can wake the iPhone app to be applied, and that path has no React tree.** With the
  phone in reach the watch also sends each tap as a message, which (unlike the transfer) wakes
  the app in the background; the phone drops the second copy by `watchTapId`. `WatchSession`
  cancels a completed task's reminder, asks iOS for background time (the next snapshot write
  hands it back) and posts `onWatchQueuedWork`, replaying it to the first JS listener so a cold
  launch, where the tap lands while the bundle loads, still hears it. `runWatchWork` in
  `backgroundRefresh.ts` answers, registered at module scope like the background task: open the
  stores if nothing has, drain, write the snapshot. **With the app not in front, a tap that needs
  the app goes back on the queue (`tapsToRequeue`)** rather than to `useWidgetCompletionStore`,
  which is memory a suspended process loses.
- **The watch draws its own taps until the phone has applied them, settled by id, not by
  clock.** Every tap carries a `watchTapId`. Each context lists the ids the phone has received
  and the ones still waiting (queued, or drained but not yet in a written snapshot); the watch
  drops a tap once it is received and no longer waiting, which is exactly when the snapshot in
  that context includes it (`WatchStore.apply`). Before any of that, a tap is held on the watch
  for `WatchStore.undoWindow` behind an Undo button, and sent early if the app leaves the
  screen: once WatchConnectivity has it, the phone will apply it and the watch can't take it back.
- **The complication extension holds two widgets** (Today and Groceries, one `WidgetBundle`), and
  each opens the watch app on its own page through `widgetURL` (`WatchLink`, read by
  `TodoWatchApp`'s `onOpenURL`). The watch app registers the `dundundun` scheme in its own
  Info.plist for this; the iPhone app's registration doesn't reach another device. Keep the
  Today widget's `kind` (`TodoWatchToday`) as it is, or every placed complication drops off its
  watch face.
- **`TodoWidgetData.swift` is compiled into both watch targets unchanged.** The watch keeps the
  snapshot in its own App Group under the widget's file name, so `loadWidgetSnapshot()` and the
  time-passing helpers (`visibleTasks(at:)`, `isStale`, `changeDates`) work there as they do in
  the widget. It must stay Foundation and SwiftUI only.
- **Every new tap kind needs its own case in `WatchSession.receive`.** Its `default` drops an
  unknown kind *without* recording its receipt, which is deliberate (a watch newer than the app
  keeps drawing the tap rather than settling it) and means a kind added on the watch alone is
  silently never applied. The workout's kinds (`set`, `restAdd`, `restSkip`, `finish`,
  `watchSession`, the four that change the list, and the HealthKit session's `measuring`,
  `healthWorkout` and `healthRetracted`) each validate there and again in `parseQuietTaps`.
- **A user-info transfer takes property-list types only**, so `NSNull` can't cross it. A payload
  shaped by data that may have gaps (a whole workout, `watchSession`) goes as JSON text under one
  key and is parsed on the phone (`JSONSerialization`), rather than as a nested dictionary whose
  optional fields would have to be left out by hand at every level.
- **What only the watch app reads is decoded apart from `TodoWidgetData.swift`.** The workout
  section rides the watch's copy of the snapshot, and `WatchWorkoutEnvelope` (in
  `WatchWorkout.swift`) decodes it from the same bytes, so the shared model, which the iPhone
  widget and the complication compile too, never carries it. A watch-only Swift file goes in
  `WATCH_SOURCES` (`plugins/withWatchApp.js`), not `COMPLICATION_SOURCES`.
- **State the watch keeps for itself goes in its App Group, under the usual path shape**
  (`Library/Application Support/<name>.json`): the tap log, the snapshot, and a workout run on the
  watch alone (`watch_workout.json`), so the app being closed loses none of it.
- **A number turned by the Digital Crown is a focused view.** Each box is `.focusable()` with
  `.digitalCrownRotation(_:from:through:by:sensitivity:isContinuous:isHapticFeedbackEnabled:)`
  (watchOS 6) and `.focused(_:equals:)` on one `@FocusState`; a tap moves the focus, and so the
  Crown, to the other box. A screen that turns numbers is pushed from a row, never added as a
  pager page, since the pager and Today's list already use the Crown.
- **The watch app asks for its own notification permission.** `UNUserNotificationCenter` is the
  same API as on the iPhone (watchOS 3), but the watch app is its own app to the system: it calls
  `requestAuthorization(options:completionHandler:)` itself (at the first workout started on the
  watch) and copes with a refusal (the rest's end is then a haptic, in front only). A
  `UNTimeIntervalNotificationTrigger` refuses an interval that isn't above zero, so a rest ending
  within the second schedules nothing.
- **The watch app is a HealthKit app of its own, and needs four things the iPhone app's
  HealthKit setup doesn't give it** (phase 9, `WatchHealthSession.swift`):
  - **The entitlement**, `com.apple.developer.healthkit`, in the watch app's own entitlements
    (`watchAppEntitlements` in `plugins/withWatchApp.js`) *and* in its `appExtensions` entry in
    `app.json`, or EAS provisions it without HealthKit. The entitlement's page lists no watchOS,
    but Apple's workout-session guide has the capability on the watch target, which is what Xcode
    writes. The complication reads no Health and keeps the App Group alone.
  - **Its own `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`**, in the watch
    app's Info.plist: on watchOS 6 and later the watch app asks on the wrist ("this method displays
    the permission form on Apple Watch", `requestAuthorization(toShare:read:completion:)`), and a
    missing string ends the app at the ask. They say what the watch reads and saves, which is not
    what the phone's say.
  - **`WKBackgroundModes` with `workout-processing`**, which a workout session needs to keep the
    app running with the wrist down. Without it the session starts and the app is suspended anyway.
  - **`UIBackgroundModes` with `audio`**, for the tap on the wrist at a rest's end with the wrist
    down. Apple's workout-session guide: "If your app plays audio or provides haptic feedback
    during the workout session, you must also add the Audio background mode". On watchOS that
    mode is `audio` under `UIBackgroundModes` (the key's page lists watchOS, and Xcode's
    background-modes page lists Audio for watchOS); it is not a `WKBackgroundModes` value. The
    app plays no sound. Whether App Review asks about an audio mode on an app with no audio is
    not known until a submission.
  `import HealthKit` links the framework by itself (module autolinking), so nothing is added to
  the target's frameworks. The watch's floor (watchOS 11) is past every API it uses, so none needs
  an availability check; the iPhone half can't use them at all below iOS 26
  (`HKWorkoutSession(healthStore:configuration:)`, `HKLiveWorkoutBuilder`), which is why the
  iPhone writes with `HKWorkoutBuilder`.
- **A workout session starts only with the app in front, and recovers through the app
  delegate.** `syncHealthSession` checks `WKApplication.shared().applicationState` as well as
  the scene, because a launch in the background to take a snapshot starts with the store's own
  flag at its default. **The watch runs one workout session at a time, across every app**:
  starting one ends whatever other app's session is running, which gets
  `errorAnotherWorkoutSessionStarted` and ends ("the original session receives this error
  message and then ends"). So nothing starts a session unless the person chose this app's
  workout (Start on the watch, or opening the phone's workout screen there), and a session that
  failed is not started again for that workout, or two apps would end each other in turn. After a crash mid-workout the system calls `handleActiveWorkoutRecovery()`
  on the app's `WKApplicationDelegate`, which the SwiftUI app gets through
  `@WKApplicationDelegateAdaptor` (`WatchAppDelegate`); the session is taken back with
  `recoverActiveWorkoutSession` and its data source and delegates set up again, as Apple
  documents. What it was measuring is kept in the watch's App Group (`watch_health_session.json`).
  The session counts as busy until the system answers, so nothing starts a second one over the
  session being taken back, and every save and recovery callback checks it is still about the
  session it began with before tearing anything down.
- **What the watch saves to Health, the watch retracts.** HealthKit lets an app delete only
  objects "that it has previously saved", and nothing Apple publishes says whether an iPhone app
  counts as the saver of what its watch app saved. So the phone never tries: it lists the ids in
  the watch's snapshot section (`retractWorkouts`) and the watch deletes them and says so
  (`healthRetracted`). Any new kind of thing the watch saves has to be retracted the same way.
  **A delete counts as done only when it worked or the object is already gone** (nothing
  matched, or `errorNoData`). A watch on its charger is locked, and a query or delete then fails
  with `errorDatabaseInaccessible` ("occurs when your app queries for HealthKit data while the
  device is locked"), so anything else leaves the id unanswered for the next snapshot or the
  next time the app comes to the front.
- **The session is activated from an app delegate subscriber** (`WatchSessionAppDelegate`, in
  the bridge's `expo-module.config.json`), so a transfer delivered while the app is in the
  background lands in the queue before any JS has run. On the watch, `.backgroundTask(.watchConnectivity)`
  lets a new context wake the app and reload the complication while the app is closed.
- **A watch app is an `application` target with `SDKROOT = watchos`, embedded by an "Embed
  Watch Content" phase into `$(CONTENTS_FOLDER_PATH)/Watch`; its extension goes in an "Embed
  Foundation Extensions" phase on the watch app.** The `xcode` package only knows the legacy
  two-target watch app, and `addTarget()` files every `app_extension` under the iPhone app, so
  the helper moves the complication's product out again.
- **The extensions have no explicit target dependency, and the watch targets do.** `addTarget()`'s
  own dependency call is a no-op on Expo's template (the sections it writes into don't exist), so
  the extensions build on the scheme's implicit dependencies. The watch targets get real ones,
  from a finalized mod, so that creating those sections can't switch the extensions'
  dependencies on too: plugin mods run last-registered first, so doing it in `withXcodeProject`
  did exactly that.
- **A watch app needs an icon in an asset catalog**, or App Store validation refuses the upload.
  The catalog's `Contents.json` is checked in and the image is the app's own icon, copied in at
  prebuild. `addResourceFile()` can't add it (it throws on the "Resources" group Expo's
  template doesn't have).
- **The watchOS platform is a separate download since Xcode 15**, and archiving an app that
  embeds a watch app fails without it. `scripts/eas-build-pre-install.js` fetches it on the
  builder for every iOS build where no matching runtime is installed.
- **React Native's `pod install` adds the app's `PrivacyInfo.xcprivacy` to the watch app too.**
  Its privacy manifest aggregation attaches the file to every target of type `:application`. Not
  a bug, but it's why the watch target in Xcode shows a file nothing here added.
- **Expect App Store Connect to ask for Apple Watch screenshots** the first time a version whose
  build contains the watch app is submitted for review. TestFlight doesn't need them.
