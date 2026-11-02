---
paths:
  - "modules/**"
  - "targets/**"
  - "plugins/**"
  - "patches/**"
  - "app.json"
  - "eas.json"
  - "App.tsx"
  - "package.json"
---

# iOS native targets, patches, and APIs you can't compile here

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).
Read `docs/native-targets.md` before adding or changing a native target.

## iOS native extension targets

The Today widget (`targets/todo-widget/`) is injected at prebuild time by custom config plugins rather than a checked-in `ios/` folder — `plugins/withAppGroup.js` (App Group entitlement on the main app) and `plugins/withWidgetExtension.js` (the WidgetKit extension as a whole new Xcode target, built via the raw `xcode` npm package).

**Before adding or changing a native target — Watch app, Live Activity, share extension — read `docs/native-targets.md`.** It lists the non-obvious requirements that each cost a build cycle to discover (the EAS `appExtensions` declaration, `TargetAttributes` signing, two outright bugs in the `xcode` package, Info.plist placeholder keys, the bridge module's podspec, intent target membership, and more). Nothing else in the repo will tell you about them, and each one fails late — at archive or at submission, not at build.

Three things that look unrelated to the widget but are load-bearing for *any* second native target existing at all — don't revert them as dead code:
- `enableScreens(false)` near the top of `App.tsx` — works around a `react-native-screens` crash (`RNSTabBarController`) that only reproduces in production builds once the app has more than one native target to build/sign.
- `ios.buildReactNativeFromSource: true` in the `expo-build-properties` plugin config (`app.json`), plus `patches/react-native+0.86.2.patch` (applied via `patch-package` on `postinstall`) — RN downloads a prebuilt Core binary by default, which bypasses the patch entirely; the patch itself fixes an RN bug where an `NSException` thrown inside a native module call escapes across a dispatch-queue boundary instead of being converted to a JS error, crashing the app. It also fixes `RCTTextInputComponentView.mm` restoring `inputAccessoryViewID` on a recycled text input: Fabric reuses a closed sheet's field without resetting its stored props, so a field with the same ID as the one it replaced compared unchanged and lost its keyboard accessory bar. Both were required together — the patch alone has zero effect without also forcing a from-source build. **The patch is named for the exact RN version and has to be re-cut on every RN bump**, because `patch-package` matches on that filename and the diff context moves between versions even when the bug and the fix don't. Re-cut it by editing both files (`ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModule.mm` and `React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm` under `node_modules/react-native/`) and running `npx patch-package react-native`, then delete the old patch file.
- `patches/react-native-gesture-handler+2.32.0.patch` is the other patch in that folder, and it's JS rather than native, so it needs no build setting to take effect. RNGH's legacy `Swipeable` (what `SwipeableRow` wraps) calls `setState` from its row's `onLayout` and its `shouldComponentUpdate` returns `true` unconditionally, so any row whose *height* animates inside one — a stack header folding its summary line — re-rendered the whole swipeable on every frame of the animation. The patch makes `onRowLayout` bail when the width hasn't changed, which is the only thing that handler reads. It touches the TS source (what Metro compiles, via the package's `react-native` field) and both compiled copies under `lib/`, so the diff has three hunks saying the same thing. Same rule as the RN patch: named for the exact version, re-cut on every RNGH bump.

## Verify an unfamiliar API

**Verify an unfamiliar API instead of guessing it, when verification is possible.** Native code
under `modules/` can't be compiled or type-checked from this sandbox, so a wrong signature against
a framework like FoundationModels or AlarmKit doesn't fail fast — it ships and only surfaces days
later as a red EAS build, with a log that names the broken member but not the fix, and a
re-guessed fix to a guessed call costs another build. There usually **is** a way to check before
writing the call: Apple's developer docs serve a JSON form of any framework page at
`https://developer.apple.com/tutorials/data/documentation/<framework>/<symbol>.json` (fetch it
with WebFetch) with real declaration fragments, argument labels and default values. Reach for that
before trusting WWDC session notes, a blog post's paraphrase, or memory of an older SDK version.
If a symbol genuinely isn't documented yet (a fresh beta, an internal API), say so at the call site
and again in the PR description as an open risk, rather than presenting an unverified signature as
a confirmed fix.

**A fetched doc page can still be misread, so don't stop checking once you have one.** The tool
that fetches and paraphrases a page can blur "throws, returns `T`" into "doesn't throw, returns
`T?`" (that cost a build in `TodoFoundationModelsModule.swift`). Two things help: ask for the raw
`declarationFragments`/`fragments` array rather than a plain-English restatement when a call's
exact throws/optional shape matters; and where a value is genuinely best-effort (a field that's
fine to skip if absent), write the read as `try?
expr` rather than `if let expr` — `try? T` and `try? T?` both flatten to the same `T?`, so that
form tolerates a throws/optional guess being wrong in either direction, where a bare `if let`
only compiles for one specific combination.
