# iOS native extension targets

Reference for adding or changing a native target (widget, Watch app, Live Activity, share
extension). Referenced from `CLAUDE.md` — read this *before* touching `plugins/` or
`targets/`, not after the first failed build.

Targets are injected at prebuild time by custom config plugins rather than a checked-in
`ios/` folder. There are two:

- **`targets/todo-widget/`** — the Today widget, added by `plugins/withWidgetExtension.js`.
- **`targets/todo-share/`** — the share extension ("dundundun" in another app's share sheet,
  for a recipe page), added by `plugins/withShareExtension.js`.

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
  the *main app* target, not an extension.** `targets/todo-widget/CompleteTaskIntent.swift` is
  the pattern every other `AppIntent` here has followed — an intent living in the widget
  extension, invoked by a `Button(intent:)` inside that extension's own SwiftUI. That's the
  wrong home for one meant to show up in the system-wide Shortcuts/Action Button picker: an
  `AppShortcutsProvider` declared in an extension only donates shortcuts for *that extension's*
  own intents, not to the app as a whole. `AddTaskIntent` and its `AppShortcutsProvider`
  (`modules/todo-widget-bridge/ios/AddTaskIntent.swift`) live in the widget-bridge module
  instead, purely because that module's podspec already globs every `.swift` file there into
  the main app target (see `TodoWidgetBridge.podspec`'s `s.source_files`) — no target-injection
  plugin work needed, unlike a widget/share-extension addition. The intent still can't reach
  the app's SQLite or JS logic any more than `CompleteTaskIntent` can, so it follows the same
  App-Group-queue-then-`openAppWhenRun`-open-the-app shape.
- **A spoken Siri phrase for an `AppShortcut` needs the `com.apple.developer.siri` entitlement
  *and* `NSSiriUsageDescription`, even though App Intents otherwise needs neither.** Without the
  entitlement (`plugins/withSiriShortcuts.js`, added via `withEntitlementsPlist`), the same
  shortcut still runs fine from the Shortcuts app, Spotlight, and the Action Button's "Shortcut"
  picker — voice specifically is the only path that's silently unrouted, which makes this easy
  to ship half-working and only notice when someone actually says the phrase.
