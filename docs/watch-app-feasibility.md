# Apple Watch app + complication — feasibility

Scoped to a *basic* Watch app over the tasks and groceries features: Today's tasks and the
shopping list, both readable and tickable from the wrist, plus complications. Nothing is built.
This is the "what would it actually cost" answer, written down because the expensive parts are
not the ones you'd guess from looking at `targets/todo-widget/`.

Companion to `docs/native-targets.md`, which already claims scope over "widget, Watch app, Live
Activity, share extension" and covers only the first. The six failure modes listed there all
apply here too and are not repeated.

**Verdict: the app is easy, the build is hard.** The Swift is modest and has a working template
in the widget. The Xcode target injection and EAS provisioning are the majority of the work and
the only unbounded part of it.

## The transport does not carry over

The Today widget is cheap because it and the app are two processes on one device sharing an App
Group container: the app writes `Library/Application Support/widget_data.json`, the extension
reads it (`loadWidgetSnapshot()` in `TodoWidgetData.swift`). It is one file write and one file
read.

**App Group containers are per-device.** `group.com.fdsimms.dundundun` on the phone is invisible
to the Watch — `containerURL(forSecurityApplicationGroupIdentifier:)` on watchOS resolves to a
*different* container on the watch's own storage. So none of that plumbing extends to the wrist.
Everything crosses over WatchConnectivity instead, which is new native code in both directions:

- **Phone → Watch.** A `src/utils/watchSync.ts` modelled on `widgetSync.ts` — subscribe once to
  the task store's `tasks` array identity rather than threading a call through ~30 mutating
  actions, debounce 300ms — builds a payload and hands it to a native module, which calls
  `WCSession.updateApplicationContext`. That's the right API here: latest-value-wins, delivered
  in the background, and it holds the payload until the watch is reachable instead of failing.
  The watch's session delegate writes what arrives into the *watch's own* App Group — shared
  between the Watch app and its complication extension, which is a legitimate same-device group —
  then calls `WidgetCenter.shared.reloadAllTimelines()` on the watch.
- **Watch → Phone.** A tick updates optimistic local state, appends to a local pending-actions
  file, and ships via `transferUserInfo` (queued, guaranteed delivery, survives reachability
  gaps). The phone's delegate appends to a `watch_pending_actions.json` in the iOS App Group; JS
  drains it on foreground through the `AppState` `'active'` listener `widgetSync.ts` already
  registers.

## Writes are queued, never applied on the watch

This is the same call the widget already made, for the same reason, documented at the top of
`CompleteTaskIntent.swift`: an extension can't reach the SQLite database or the JS logic, so it
queues an id and lets the app finish the job.

It transfers unchanged, and the numbers say why. `completeTask` (`src/store/useTaskStore.ts`) is
roughly 470 lines covering recurrence, chain advance, series rollover, streaks, quota clamps, the
extra-task tally, subtask cloning, notification scheduling, project auto-archive, meal-plan sync,
and a full undo. `toggleChecked` (`src/store/useGroceryStore.ts`) looks like twenty lines but
branches into `resolveChoice`, which deletes provisional losers of an either/or, unlists the
catalog ones, and registers a snapshot undo. Neither is portable to Swift, and a second
implementation of either is a second thing to keep true.

So the watch is a thin client: a precomputed payload in, queued intents out. Drained task ids
reuse `useWidgetCompletionStore.enqueue` verbatim — the widget's drain path already ends there —
and grocery ticks call `toggleChecked`.

The limitation to be plain about: iOS *does* launch the app in the background to deliver
`transferUserInfo`, but an RN app woken that way won't reliably run JS, so the write lands
natively and JS applies it on the next foreground. Tick something on the watch and the phone's
list is stale until you open it. The watch shows its optimistic state meanwhile, exactly as the
widget's checkbox does.

## Staleness is the one thing the widget got away with and the watch won't

`isTaskVisible` reads the clock, eight settings keys, the category store, and — via
`blockerRegistry` — the whole task array. The app re-evaluates it every 30 seconds
(`src/utils/nowTick.ts`). A snapshot written at 5pm is wrong by 6pm for anything carrying
`timeSegments`, a `windowStart`/`windowEnd`, a category schedule, or a quota pace ramp.

The widget survives this because the phone is running and pushes a reload after every mutation.
A complication can go hours between pushes, and watchOS caps background refreshes — so a wrong
snapshot stays on screen.

The fix is cheap and already written: ship a per-row transition timestamp in the payload so the
watch re-filters locally with a date comparison instead of needing a fresh push.
`getVisibleAt()` in `src/utils/visibilityUtils.ts` computes exactly this today (it's what sorts
the Later screen), and `quotaNextDueAt` gives the quota equivalent. Design the payload with that
field from the start rather than discovering it after the first complication ships wrong.

## What is reusable

Copied into the watch target, not linked — see the podspec note below:

- `WidgetTask` / `WidgetSnapshot` from `TodoWidgetData.swift`. The task payload is already an
  8-field projection and already routes titles through `displayTitleFor` (mid-chain, the shown
  title isn't `task.title`).
- The four-case `WidgetLoadResult` enum, which exists so an entitlement problem and a fresh
  install don't both read as a bare `nil`. That distinction matters more on the watch, where
  "never received a payload" is a routine state.
- `WidgetPalette` and `Color(hex:)`, verbatim.

The grocery half is markedly cheaper than the task half: `buildGrocerySections`
(`src/utils/grocerySuggest.ts`) is pure over three plain inputs, and `GroceryItem` is 21 flat
fields against `Task`'s ~76.

## Two new Xcode targets, not one

1. **The Watch app.** `SDKROOT = watchos`, `WATCHOS_DEPLOYMENT_TARGET`,
   `TARGETED_DEVICE_FAMILY = 4` (not `"1,2"`), `SUPPORTED_PLATFORMS = "watchos watchsimulator"` —
   none of which `withWidgetExtension.js` sets, and it sets `IPHONEOS_DEPLOYMENT_TARGET`
   unconditionally. Its Info.plist needs `WKApplication` where the widget's needs an `NSExtension`
   dict. And it needs an **Embed Watch Content** `PBXCopyFilesBuildPhase` on the *main app*
   target — `dstSubfolderSpec = 16`, `dstPath = "$(CONTENTS_FOLDER_PATH)/Watch"`. There is no
   precedent for that embed in this repo: `addTarget`'s `app_extension` branch hands the widget
   its embed phase for free, and a watch app gets nothing.
2. **The complication**, a watchOS widget extension embedded in the *Watch app's* PlugIns — a
   nested embed, inside a target that is itself embedded.

The `xcode` package does have `watch2_app` / `watch2_extension` branches that would supply the
embed phase, but they emit `com.apple.product-type.application.watchapp2` — the legacy
WatchKit-extension shape, which Apple no longer accepts for new watchOS apps. The likely move is
to call `addTarget(..., 'watch2_app', ...)` for the free copy-files phase and then overwrite
`productType` to `com.apple.product-type.application`, which would be a fourth `xcode`-package
workaround stacked on the three `withWidgetExtension.js` already documents.

Two further constraints:

- **The watch target cannot link `TodoWidgetBridge.podspec`** — it declares
  `s.platforms = { :ios => '15.1' }`, and the generated Podfile has no watchOS target at all. Any
  Swift the watch shares with the app has to be *copied* the way `TimerActivityAttributes.swift`
  already is, with the same drift hazard.
- **`ActivityKit` does not exist on watchOS**, so `withWidgetExtension.js`'s framework list can't
  be copied wholesale. `WidgetKit`, `SwiftUI` and `AppIntents` are all fine.

`withWidgetExtension.js` is a single closure over hardcoded module-level constants, so supporting
a second target means turning it into a parameterized factory before adding anything watch-
specific — the target name, bundle suffix, source list, deployment target, plist body and
framework list all have to become arguments.

## The two things that could blow this up

**EAS provisioning is unverified.** `extra.eas.build.experimental.ios.appExtensions` in
`app.json` is for app *extensions*. A Watch app is an embedded application with its own bundle
identifier needing its own provisioning profile, and the complication needs a third.
`withWidgetExtension.js` already hardcodes `DEVELOPMENT_TEAM` precisely because EAS's
non-interactive credential resolution "never discovers this extension target" — so there is
already evidence that this machinery only half-understands targets it didn't create. If it can't
provision a Watch app at all, the fallback is a checked-in `ios/` folder or local Xcode archives,
which is a real change to how this project ships and a decision that should be made *before* any
Swift is written.

**Everything fails late.** Per `docs/native-targets.md`, every known failure mode here surfaces
at archive or at App Store submission, not at build. Each iteration is a full EAS build cycle.
That, not the amount of code, is what makes this expensive.

## Effort

| Piece | Size | Risk |
|---|---|---|
| Config plugin, two targets, provisioning | the majority | the only unbounded part |
| WCSession both sides + `watchSync.ts` + drain | ~500 lines Swift/TS | bounded |
| Watch SwiftUI — task list, grocery list by aisle | ~500–700 lines | low |
| Complication (`.accessory*` families) | ~150 lines | lowest; the widget proves the shape |

A week-plus of focused work for a shippable v1, with a genuine chance the EAS question forces an
ejection decision first.

## Recommended first step

A one-day spike that does nothing but get an **empty** Watch app target to archive and install
through EAS. No WatchConnectivity, no SwiftUI beyond a "Hello" label, no complication. That
answers the only question here that cannot be answered by reading, and it answers it before any
of the work that depends on the answer.
