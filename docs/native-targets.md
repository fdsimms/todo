# iOS native extension targets

Reference for adding or changing a native target (widget, Watch app, Live Activity, share
extension). Referenced from `CLAUDE.md` — read this *before* touching `plugins/` or
`targets/`, not after the first failed build.

The Today widget (`targets/todo-widget/`) is injected at prebuild time by custom config
plugins rather than a checked-in `ios/` folder — see `plugins/withAppGroup.js` (adds the App
Group entitlement to the main app) and `plugins/withWidgetExtension.js` (adds the WidgetKit
extension as a whole new Xcode target via the raw `xcode` npm package). Any future target that
needs to share data with the app will hit the same sharp edges this one did.

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
- **A Live Activity needs `NSSupportsLiveActivities: true` in the *main app's* Info.plist**
  (`expo.ios.infoPlist` in `app.json`) — not the widget extension's. Without it,
  `Activity.request` throws at runtime on the very device it's meant to work on; nothing at
  build time catches the omission, because the extension itself doesn't request activities, it
  only renders the ones the app process starts.
