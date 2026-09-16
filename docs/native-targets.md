# iOS native extension targets

Reference for adding or changing a native target (widget, Watch app, Live Activity, share
extension). Referenced from `CLAUDE.md` — read this *before* touching `plugins/` or
`targets/`, not after the first failed build.

Targets are injected at prebuild time by custom config plugins rather than a checked-in
`ios/` folder:

- **`targets/todo-widget/`** — the Today widget, added by `plugins/withWidgetExtension.js`.
- **`targets/todo-share/`** — the share extension ("dundundun" in another app's share sheet,
  for a recipe page), added by `plugins/withShareExtension.js`.
- **`targets/todo-activity-monitor/`** — the DeviceActivity monitor, added by
  `plugins/withActivityMonitor.js`. Woken when a usage threshold is crossed, and at the end of
  a penalty block.
- **`targets/todo-shield-config/`** and **`targets/todo-shield-action/`** — the screen shown
  when a blocked app is opened, and the button on it, both added by
  `plugins/withShieldExtensions.js`.

Both get the App Group entitlement from `plugins/withAppGroup.js`, and both build their Xcode
target through **`plugins/lib/nativeTarget.js`**, which is where the sharp edges below actually
live. **Add a third target by calling `addAppExtensionTarget` too, not by copying a plugin.**
Every workaround in that file was a failed build cycle to find and every one of them fails
*late* — at archive or at submission, not at build — so a second copy is a second place the
seventh one would have to be found again. What belongs in the plugin is only what genuinely
differs per extension point: the Info.plist, the entitlements, the frameworks, the deployment
target, and which sources compile in.

`npx expo prebuild --platform ios --no-install` runs offline and is the cheap way to check a
plugin change: it writes `ios/` (gitignored) and you can read the generated `project.pbxproj`
and Info.plist directly. The `xcode` package mints random UUIDs, so two runs are never
byte-equal — rewrite each distinct 24-hex-char id to a counter in order of first appearance and
the two runs compare exactly, which is how the widget target was proved unchanged when its
plumbing moved into `lib/nativeTarget.js`.

- **A new target must be declared in `app.json`'s
  `extra.eas.build.experimental.ios.appExtensions`** (name, bundle id, entitlements), or EAS
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
  location.
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
  looks like it half-worked and the app simply never comes forward. `CompleteTaskIntent` (the
  Today widget's checkbox) shipped extension-only and hit exactly this, and the first fix for it
  was the wrong one: `openAppWhenRun` is deprecated in iOS 26 and its doc says setting it true
  "generates an error if the app intent runs in an app extension", so the obvious reading is
  that the deprecation broke it and the `@available(iOS 26.0, *) static var supportedModes:
  IntentModes { .foreground(.immediate) }` replacement is the whole repair. It isn't — it
  declares the *requirement* to be in the foreground, but if the only target hosting the intent
  is the extension there is no process that can satisfy it, so nothing changes. Note the second
  half of that same deprecation note, which is the actual rule: `openAppWhenRun` is still fine
  "for app intents you run inside your app". The fix is target membership, not the property —
  `CompleteTaskIntent.swift` now lives in `modules/todo-widget-bridge/ios/` (globbed into the
  app by the podspec) *and* is listed in `withWidgetExtension.js`'s `SHARED_SWIFT_FILES` so the
  extension, whose `Button(intent:)` names the type, still compiles it. Both properties are kept:
  `supportedModes` for iOS 26+, `openAppWhenRun` for older. A file compiled into two targets
  can't share the widget target's App Group helpers, so it carries its own file-private copy —
  the convention `AddTaskIntent.swift` already follows. `allowedExecutionTargets` would let you
  pin execution to `.main` explicitly, but it is **iOS 27+** and so no help for 26 — and EAS's
  build image doesn't carry the iOS 27 SDK yet, so referencing the type at all fails the build
  even behind `@available`: that guard controls when code *runs*, not whether the SDK the
  compiler is targeting has ever heard of the symbol. Wait for the SDK before adding it back.
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
  same shape for this reason.
- **`Application.localizedDisplayName` works inside a shield extension**, which is the one
  place a blocked app's name is readable at all — everywhere else in the app a picked app is
  an opaque token that only SwiftUI can render (see `modules/todo-screentime-bridge`). It is
  `String?`, so handle nil. In the *action* extension you get an `ApplicationToken` rather than
  an `Application`, and the name has to be reconstructed with `Application(token:)`.
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
