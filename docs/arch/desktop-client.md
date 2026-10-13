# A desktop client for the Mac

**Status: phase 1, design only.** Nothing here is built. This file records the decision, the
measurements behind it, and the rules phase 2 should start from. When phase 2 lands, rewrite the
status line and keep the reasoning.

The cheap way onto a Mac is the iOS app itself, offered to Apple silicon Macs from App Store
Connect with no code change. It is phone-shaped and loses the iOS-only frameworks, but it costs
almost nothing. This document is about the other route: a client built for the desktop, with a
desktop layout, that is a sync peer of the phone. The two are not exclusive, and the first is
worth doing regardless.

## What the repo already decides

Four facts narrow the field before any taste comes into it.

**1. Any client has to run the TypeScript merge rules, so it has to run TypeScript.** Sync is a
dumb payload pipe (`syncEngine.ts`, `httpSyncTransport.ts`, the CloudKit bridge): a payload is
row-level JSON in the SQLite column shape (`syncMerge.ts`, `SYNC_FORMAT = 1`), and every decision
about what it means happens on the device that applies it. A client that does not run
`syncMerge`, `naturalKeyFold`, `rowToTask` and the rest would need a second copy of every one of
those rules in another language, and that copy would drift silently the first time a column is
added. `docs/arch/mcp-server.md` reached the same conclusion for the replica ("a second host for
the one that is here"), for the same reason.

**2. Almost all of the logic layer already loads outside React Native.** A static import walk of
`src/` (excluding `import type`, following relative and `@/` imports) found:

| Directory | Modules whose import closure reaches a native package |
|---|---|
| `src/db` | 0 of 2 |
| `src/services` | 0 of 10 |
| `src/utils` | 57 of 491 |
| `src/store` | 19 of 51 |
| `src/hooks` | 68 of 68 (they are React Native hooks; expected) |

The 76 utils and stores that do reach native code get there through a handful of choke points:
`notifications.ts` (`expo-notifications`), and `Platform`, `AppState`, `Linking` and `Alert` from
`react-native` in `calendarSync.ts`, `healthBridge.ts`, `screenTimeBridge.ts` and a few stores.
Across the whole logic layer, the static third-party imports are `zustand`, `date-fns`, `react`
(for a `useEffect` in four stores) and eight native packages: `react-native`, `expo-sqlite`,
`expo-notifications`, `expo-haptics`, `expo-task-manager`, `expo-background-task`,
`expo-quick-actions` and `todo-alarmkit-bridge`. Every other native module is reached through a
lazy `require` inside a try/catch that already answers "not available" (40 lazy requires, 32 of
them packages).

The iOS-only paths are already guarded the way a desktop build needs: 52
`Platform.OS !== 'ios'` checks in the logic layer, so a desktop `Platform.OS` that is not `'ios'`
takes the path that skips HealthKit, EventKit, Screen Time and the widget.

**3. The spike: every store loads and runs, unmocked, over a real database.** A throwaway jest
test replaced only those eight packages: `expo-sqlite` with `mcp/src/expoSqliteShim.ts` over a
temp file, and the rest with no-op stand-ins. It then required every file in `src/store`.

- **51 of 51 stores load**, `useTaskStore` (10k lines) included. This is the important difference
  from the MCP replica, which cannot load `useTaskStore` and had to lift pure cores out of it
  (`taskDraft.ts`, `taskCompletion.ts`, `taskUpdate.ts`). A desktop client gets every store
  action as it is, undo included, with no extraction.
- **35 stores initialize** with no error.
- **`addTask` then `completeTask` on a daily task** wrote the completed row and its successor (due
  the next day) to SQLite through the real store, and `dbSyncChangesSince` produced a change set.
- **The one failure was stub fidelity**, and it is the lesson for phase 2:
  `getAllScheduledNotificationsAsync` returned `null` where `notifications.ts` maps over a list.
  A stand-in has to return what the real API's types promise (an empty list, not `null`), not
  just exist.

**4. The UI does not carry over, and it is half the codebase.** `src/screens` and
`src/components` are about 181,000 lines over 47 screens and 313 components, against about
180,000 lines of logic. Rendering the React Native UI on a desktop is the iOS-on-Mac option done
the hard way, so the desktop UI is new code. That is why v1 is a deliberate slice (below), not a
port.

A fifth fact is about how this repo is built rather than what it contains: **the work happens in
cloud sessions that can run Node, jest and headless Chromium but cannot compile Swift.**
CLAUDE.md already describes native code here as something that "doesn't fail fast" and surfaces
days later as a red EAS build. A stack whose UI is Swift puts every screen behind that delay.

## Options considered

| Option | Verdict |
|---|---|
| **Electron, React DOM UI, the existing logic layer in the renderer** | **Chosen.** Reuses all 180k lines of logic, every store action and the sync engine unchanged. Its UI is TypeScript and React, typecheckable and testable here, and the renderer can be screenshotted in the sandbox's Chromium. Costs: a ~200 MB app, Chromium's memory use, and a UI that has to be made to feel native rather than being native for free. |
| SwiftUI shell, logic layer in JavaScriptCore | The best Mac feel, with CloudKit, EventKit, notifications and WidgetKit native. Rejected for now: every screen would be Swift that cannot be built or checked here, and it needs a hand-built bridge (Swift mirrors of `Task`'s 150-odd fields, zustand subscriptions pushed across as JSON, every action a JS call). Worth revisiting if native feel becomes the priority. The logic bundle and shim set designed below would carry over to it unchanged. |
| Tauri | Rejected. The webview has no Node, and Tauri commands are async. `database.ts` and every store are built on synchronous SQLite (`getAllSync`, `runSync`, `withTransactionSync`), so the only fit is an in-memory WASM SQLite persisted on a timer, which is a durability bug waiting to happen. Its main advantage, binary size, doesn't outweigh that. |
| React Native for Web in a desktop shell | Rejected. It renders the phone UI in a window, which the iOS-on-Mac route already does better and for free. |
| `react-native-macos`, Mac Catalyst | Rejected earlier: a fork that lags React Native and Expo, and every custom config plugin and extension target would need a Mac variant. |
| A thin client over the MCP server's tools | Rejected. No offline use, a round trip per read, and the tools are shaped for an agent rather than a screen. |

## The design

### Layout in the repo

`desktop/` is its own npm package, the way `mcp/` is: its own `package.json` (Electron, React DOM,
esbuild, electron-builder), reaching into `../src` by relative import and by nothing else. The
app's dependency tree and `npx expo export` never see it. Neither do the generated docs, which scan
`src/` only, but phase 2 should confirm that with a run of `npm run docs`.

```
desktop/
  main/          Electron main process: window, menus, SQLite, keychain, fetch proxy
  preload/       the five-method SQLite bridge and the IPC surface, nothing else
  renderer/      React DOM UI, plus the boot sequence
  shims/         one file per substituted package (table below)
  esbuild.config.ts
```

### Processes, and where the database lives

**The logic layer runs in the renderer.** Zustand stores are what the UI subscribes to, through
the same `useTaskStore(selector)` hooks the phone's screens use, so they belong in the same JS
context as React. Running them in the main process would turn every selector into async IPC and
break the synchronous model the stores are written in.

**SQLite lives in the main process, behind a synchronous five-method bridge.** The `expo-sqlite`
shim in the renderer exposes exactly the surface `database.ts` uses (`execSync`, `runSync`,
`getAllSync`, `getFirstSync`, `withTransactionSync`) and forwards each call with
`ipcRenderer.sendSync` to main, which runs `mcp/src/expoSqliteShim.ts`'s `openShimDatabase` over
better-sqlite3, statement cache and all. The renderer keeps Electron's defaults: context
isolation on, sandbox on, no Node. The IPC surface is five channels, small enough to audit.

- **`withTransactionSync` can't send a function across IPC**, so the renderer side runs it as
  `BEGIN` / `COMMIT` / `ROLLBACK` statements, with `SAVEPOINT` for a nested call, the same
  semantics better-sqlite3's `transaction()` gives the replica.
- **The cost is a round trip per query.** Launch reads whole tables in a few big calls, and a
  write is a handful of small ones, so this should be fine, but it is unmeasured. Phase 2
  measures cold start and a `completeTask` on a copy of a real database. **The fallback, if it is
  too slow,** is better-sqlite3 directly in a renderer with Node integration. That is tolerable
  only because the renderer loads nothing but the app's own bundle. Decide on numbers, not taste.

### Substituted packages

The renderer bundle aliases each native package to a desktop implementation, a no-op, or an
explicit "absent" module that throws when loaded. The throw is what makes a lazy `require` inside
a try/catch answer "not available" the way it does on a build without the native half. **esbuild,
not an ESM dev server,** because 40 lazy `require()` calls need bundling statically. Vite's dev
server leaves `require` undefined in the browser, which would make *every* lazy require read as
absent, including the ones that should resolve.

| Package | Desktop v1 |
|---|---|
| `expo-sqlite` | the sync IPC bridge above |
| `react-native` | `Platform.OS = 'macos'`, `AppState` from window focus and visibility, `Linking.openURL` through `shell.openExternal`, `Alert.alert` as an in-app dialog calling the chosen button's `onPress`, no-op `LayoutAnimation`/`UIManager`, `AccessibilityInfo` from `prefers-reduced-motion` |
| `expo-secure-store` | Electron `safeStorage` (the Anthropic key, the sync token) |
| `expo-clipboard` | Electron `clipboard` |
| `expo-notifications` | type-faithful no-ops: empty lists, `'undetermined'` permissions. See "What the desktop does not do" |
| `expo-haptics`, `expo-task-manager`, `expo-background-task`, `expo-quick-actions` | no-ops |
| `expo-file-system`, `expo-document-picker`, `expo-sharing`, `expo-print` | absent in v1; backup export/import is the first to fill in (save/open dialogs) |
| every `todo-*-bridge`, `expo-calendar`, `expo-contacts`, `expo-location`, `expo-local-authentication`, `expo-speech`, `expo-audio`, `expo-image-*` | absent |

**The table is a coverage list, so make it a test.** Phase 2 adds a jest test, beside the
`noRawModal.test.ts` family, that walks the logic layer's static imports and lazy requires and
fails on a package with no entry. A new native import in a store then fails the build where it
happens, rather than as a blank window on a Mac weeks later. It is also the spike's "every store
loads" check made permanent.

### The network

`src/services/` plus the two sync transports are every network call the app makes (CLAUDE.md,
"Data flow"). From a renderer they run into CORS, which a phone never sees. **The renderer's
`fetch` is replaced with one that forwards to `net.fetch` in main**, including the abort signal,
so `services/` and `httpSyncTransport.ts` run unchanged. The per-feature switches and "no key, no
traffic" carry over as they are, since they live in the code being reused.

### Sync

**v1 syncs over the HTTP payload store** (`httpSyncTransport.ts`, served by `mcp/src/syncStore.ts`
at `/sync/*`). It is already deployed for the MCP server, needs no native code, and is pure
TypeScript, so the desktop is one more peer with its own `deviceId` and its own cursors.
`runSyncAll`'s rules (transports run sequentially; what arrives over one is relayed to the other by
arrival, through `sync_received`) already handle a phone bridging CloudKit and the store. Run it on
launch, on window focus, and on an interval while focused.

**CloudKit comes later, and it is what opens the desktop to anyone but the owner.** Self-hosting a
payload store is not something to ask of an App Store customer. Apple supports CloudKit in
Developer ID apps outside the Mac App Store, with a Developer ID provisioning profile and
notarization ([Developer ID](https://developer.apple.com/support/developer-id/)), so the path is a
native Node addon in the main process wrapping the same calls
`modules/todo-cloudkit-bridge/ios/TodoCloudKitModule.swift` makes (push, pull, the image zone),
against the same `iCloud.com.fdsimms.dundundun` container. That Swift is about 450 lines and
imports only CloudKit and the Expo module glue around it. It cannot be built or tested from a
cloud session, which is why it is not v1.

**What each transport carries decides what the desktop can show**, and the two differ
(`useSyncStore`, where the transports are built):

- **Recipe photos don't travel to the store.** The server transport is built with
  `sendsImages: false`, so over HTTP the desktop gets each recipe's photo path and never the
  photo. v1 recipe screens show no photos; CloudKit's image zone is what fixes it.
- **The health logs and the journal never go to iCloud** (`withholdingFor` with both off for
  CloudKit), and go to the store only if the phone's own switches send them
  (`serverHealthLogs`, `serverJournal`). So a desktop on HTTP sees them only when the person has
  opted in, and a desktop on CloudKit alone would never see them at all. That is the existing
  privacy rule working (`docs/arch/mcp-server.md`, "The health logs have their own switch, and
  iCloud never gets them"), not a gap to engineer around.

### What the desktop does not do

The phone stays the device that does things *unattended*, and v1 runs none of it. That is the
rule the MCP replica already follows, and it holds for the same reasons:

- **No maintenance passes** (`maintenancePasses.ts`, `TodayScreen`'s foreground list). Visibility
  is computed at read time (`visibilityUtils.ts`), so Today on the desktop is correct without
  them. The generators need a forecast, a calendar, Health or Screen Time the desktop doesn't
  have, and two devices running date passes against one dataset is how duplicates and early
  deletions happen. Expiry sweeps and the retention purge stay launch-time jobs on the phone.
  Revisit pass by pass, only for passes that need nothing device-bound.
- **No reminders or notifications.** The phone fires them already, and a second device firing the
  same reminder is noise. A Mac notification is a candidate feature for later with its own
  "on this Mac" switch, and it would need an answer for the app being closed (a login item, or
  nothing).
- **No Apple Health writes.** `healthWritePending` entries are written by the phone, exactly as
  for an MCP-logged meal.
- **No demo mode.** Demo mode's whole safety argument is the gates around things outside SQLite
  (CLAUDE.md, "Nothing in demo mode may write outside the demo database"). A desktop v1 has none of
  those outlets, but it has a sync transport, and the cheapest correct answer is not to offer the
  switch at all.

### What exists on a Mac

| Area | Desktop v1 |
|---|---|
| Tasks, projects, stacks, templates, categories, tags, search | yes, through the real stores |
| Groceries, pantry, recipes, meal plan | yes, data and logic. UI scope is a phase 3 decision |
| Food, mood, medication, journal logs | only over the HTTP store, and only when the phone's switches send them (see Sync). Health-backed figures (weight, sleep, active energy) never, by the health rule |
| Recipe photos | not over the HTTP store; with CloudKit |
| AI features with the user's own Anthropic key | yes (`aiSuggestions.ts` over the fetch proxy) |
| On-device model, barcode scan, receipt and label OCR | no (iOS frameworks, camera) |
| System calendar, contacts, location, weather-by-location | no in v1. EventKit exists on macOS and is a later native-addon candidate |
| App lock, Screen Time shields, alarms, widgets, Watch, Live Activities | no |

Simplified mode's gates (`simpleMode.ts`) still apply on top. A feature the Mac can't do is
**hidden, not shown disabled**. The capability list that decides it is a new, small module
alongside the shims, not a reuse of `simpleMode.ts`, which is a user's choice rather than a
platform fact.

### The UI: what v1 is

A desktop layout, not the phone's: a sidebar of lenses and areas, a list, and a detail pane. It is
keyboard-first: quick add on a global shortcut through `parseTaskInput`, arrow keys through the
list, a shortcut per common action. Native window chrome (`titleBarStyle: 'hiddenInset'`,
vibrancy on the sidebar), the system font, and light and dark from `nativeTheme`, with the hex
values taken from `src/theme/index.ts`.

**v1 scope:** Today with its four lenses (Today, Later, Unscheduled, Inbox), the task editor's
common fields, quick add, Projects (list and detail), the grocery list, and search through
`fuzzySearch`/`quickSearch`. **Out of v1:** drag and drop, Stats, the kitchen beyond the list,
logs, settings beyond sync and the API key. Each is its own later PR.

The CLAUDE.md design rules that are about *meaning* carry over: the copy rules, selection that
never looks like completion, the gold of "done", status colors as text versus fill, and the
contrast floors in `themeContrast.test.ts`. The rules about React Native mechanics (`SheetModal`,
`useKeyboardInsetScroll`, `SwipeableRow`, Yoga, worklets) don't.

## Phases

| Phase | What | Suggested model, effort |
|---|---|---|
| 1 | This document | Opus, high (done) |
| 2 | Skeleton: `desktop/` package, the shims and their coverage test, the SQLite bridge, the boot sequence, the fetch proxy, HTTP sync, and a window that lists Today from a real synced database. Measure the IPC cost and decide the fallback. Make the renderer runnable in headless Chromium against a fixture database, so later phases can screenshot their work | Opus, high. The boot order and the shims decide everything after |
| 3 | v1 screens, one PR each: Today and its lenses, the editor, quick add, Projects, groceries, search | Sonnet, medium. Opus for anything that writes through scheduling, recurrence or completion |
| 4 | Packaging and distribution: Developer ID signing, notarization, updates. Runs on a Mac or a macOS CI runner, which costs about ten times a Linux minute against this repo's Actions allowance, so build on a tag rather than on every push | Sonnet, medium |
| 5 | CloudKit addon, then EventKit and Mac notifications if wanted | Opus, high. Can't be built in a cloud session |

## Risks and open questions

- **Boot order.** `App.tsx`'s startup is a sequence of named steps, some of them native. The
  desktop needs its own boot list derived from it, keeping store initialization and dropping
  device work. It must not become a third list of "what runs at launch" that drifts from the
  first two. Phase 2 should share one table with `App.tsx` where it can.
- **Stand-in fidelity.** The spike's only failure was a stub returning the wrong shape. Every
  no-op has to honor its real signature, and the coverage test only proves a stand-in exists,
  not that it is faithful.
- **Store behavior that assumes a phone.** A store action that asks the user something through
  `Alert` now shows a desktop dialog, and one that schedules a reminder now does nothing. Phase 3
  should check each action a screen calls for side effects that read differently on a Mac.
- **Two writers, one dataset.** The phone and the Mac editing the same task is ordinary
  last-writer-wins, the same as two phones, and what `syncMerge` already handles. What is new is a
  second device editing while the phone is idle for days. With the HTTP store in the path, the
  phone sees those edits only when it next syncs.
- **The sync IPC cost**, measured in phase 2, with the fallback named above.
- **Whether a Mac App Store build is wanted** in addition to Developer ID. Electron supports it,
  with its own sandbox entitlements. Decide in phase 4.
