# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npx expo start       # start dev server (scan QR with Expo Go)
npm test             # run all tests
npm run test:watch   # watch mode
npx jest src/__tests__/dateUtils.test.ts  # run a single test file
```

CI also runs `npx expo export --platform ios` to verify the build compiles.

## Architecture

### Data flow

```
SQLite (expo-sqlite, WAL mode)
  └── src/db/database.ts       — raw db functions (dbGetAllTasks, dbInsertTask, etc.)
        └── Zustand stores
              ├── src/store/useTaskStore.ts      — all task operations
              ├── src/store/useSettingsStore.ts  — user preferences, persisted to settings table
              └── src/store/useProjectStore.ts   — project CRUD
                    └── React screens / components
```

All database calls are synchronous (expo-sqlite `runSync`/`getAllSync`). There is no backend or network layer — everything lives in a local SQLite file on device.

Stores are initialized once at app startup (`initialize()` on each store). Mutations always write to SQLite first, then update Zustand state.

### Visibility model

The core differentiator: tasks have multiple reasons to be hidden, checked in `src/utils/visibilityUtils.ts`:

1. `deferUntil` — hidden until a specific day
2. `timeSegments` — hidden until a time-of-day threshold (morning/afternoon/evening)
3. `dueDate` — hidden if due on a future day
4. `vacationPause` + vacation mode — temporarily hidden

`isTaskVisible()` drives the Today screen. `isTaskDeferred()` is just `!isTaskVisible()`. `getVisibleAt()` returns the earliest moment a deferred task surfaces (used to sort the Later screen).

All time comparisons use the configurable `dayResetTime` (default `"00:00"`) to define when the logical day starts — e.g. a 2 AM reset means tasks on a "day" don't surface until 2 AM.

### Recurrence

Completing a recurring task creates a new task row with a new `id` and the next computed `dueDate`. The original task is marked completed (not deleted). `getNextDueDate()` in `src/utils/dateUtils.ts` handles all recurrence types; it anchors to the previous `dueDate` for fixed schedules, or to today for `recurrenceFromCompletion`.

### Chains

Chain items (`chainItems[]` / `chainIndex`, shown in the editor collocated with Repeat since the two are easy to conflate) are a singly-linked list of steps, independent of recurrence: completing a chained task always advances `chainIndex` and immediately spawns the next task with no `dueDate`, ending after the last item. Repeat changes only what happens at that last item — instead of ending, `chainIndex` wraps to `0` and the whole chain repeats on the recurrence's schedule. See the `spawnsNext`/`atChainEnd` logic in `completeTask()` (`src/store/useTaskStore.ts`). `rowToTask()` maps the legacy `cycle_enabled`/`cycle_index`/`cycle_items` SQLite columns to the `chain*` fields on `Task`.

### Navigation

`src/navigation/AppNavigator.tsx` uses a bottom tab bar with only 3 visible tabs (Today, Search, More). The remaining screens (Later, Tags, Categories, Logbook, Stats) are registered as hidden tabs and reached via `SideMenuDrawer`, which overlays the full screen and is opened by tapping "More" or by edge-swipe from the left.

### Design system

`src/theme/index.ts` exports design tokens (`spacing`, `radius`, `font`, `fontWeight`, `border`, `iconSize`, `animation`, `interaction`) and two color palettes (`darkColors`, `lightColors`). Components consume colors via `useColors()` or `useTheme()` (which also exposes theme-aware `shadows`) from `src/theme/ThemeContext.tsx`. The top-level `colors` export is kept only for non-themed static uses.

**Never hardcode** hex/rgba colors, shadow styles, spring params, `activeOpacity`, or `delayLongPress`. The tokens to reach for:

- `colors.backdrop` — every modal/sheet dim layer
- `colors.blurFallback` — tint overlay behind `SafeBlurView` content
- `colors.onAccent` — text/icons on filled accent/green/red surfaces (always white, both themes)
- `colors.timeMorning/timeAfternoon/timeEvening` — time-of-day segment colors
- `interaction.activeOpacity` (0.7), `interaction.pressScale`, `interaction.delayLongPress` — press behavior
- `animation.spring.snappy/smooth/bouncy` and `animation.duration.*` — every Animated call
- `getShadows(isDark)` via `useTheme().shadows` (`card`, `fab`, `sheet`) — every shadow

**Never put `lineHeight` on a `TextInput` style.** RN maps it straight onto the iOS paragraph style's `minimumLineHeight`/`maximumLineHeight` with no compensating baseline offset (`RCTTextAttributes.mm`), so the glyphs are drawn a full line height below the top of the line box instead of one ascent below it — the text sits low in the field while the caret stays centered, and the placeholder inherits the same attributes so it looks wrong even when empty. `lineHeight` is fine (and wanted) on `Text`. When an input needs a specific box height to keep a row from resizing between display and edit mode, set `height`/`minHeight` instead.

**Shared primitives** (use these instead of hand-rolling):

- `ScreenHeader` (`src/components/ScreenHeader.tsx`) — every screen's large-title header: title, optional subtitle/overline, 34pt icon actions with badges/active tint/loading, or custom `right` content.
- `PressableScale` (`src/components/PressableScale.tsx`) — standard press feedback (spring scale + opacity dip) for buttons, chips, FABs, icon buttons. Full-width list rows keep `TouchableOpacity` with `interaction.activeOpacity` — scaling a full row looks wrong.
- `EmptyState` (`src/components/EmptyState.tsx`) — every empty list: tinted icon circle + title + subtitle + optional CTA, animates in on mount.
- `CollapsibleField` (`src/components/CollapsibleField.tsx`) — a picker section inside an editor card. Collapsed it is `LABEL … value ⌄`; expanded it shows a one-line `hint` explaining the field, then the pills. **Every editor picker (category, project, tags, priority, effort, …) uses this** — see the progressive disclosure note below.
- `EditorRow` (`src/components/EditorRow.tsx`) — the `icon — label — value ›` row every editor sheet is built from (Date, Deadline, Remind me, Link, …). Pass `expanded` for rows whose controls unfold in place rather than opening a picker, and the chevron becomes up/down.
- `src/utils/haptics.ts` — semantic haptics (`tap`, `success`, `warning`, `error`, `impactLight/Medium/Heavy`). Never import `expo-haptics` directly; pick by meaning so intensities stay consistent.
- `src/utils/layoutAnimation.ts` — `animateLayout()` immediately before a state change that inserts/removes list rows (complete, delete, add, selection-mode toggle). **Never call it on a drag-reorder commit path** (`ReorderableList.onReorder`, `DraggableFlatList.onDragEnd`) — those drive their own row animations.

**Editors are progressive disclosure.** `TaskEditor`, `TemplateItemEditor`, `TaskGroupEditor`, `ProjectEditor` and `TemplateEditor` all follow the same shape: title/notes, then cards under uppercase `groupLabel` headers (Schedule → Organize → Priority & effort → Subtasks → More), rarely-changed rows last. Nothing renders its picker expanded by default — every pill grid lives inside a `CollapsibleField` that shows only its current value until tapped, and picking a single-choice value collapses the section again (`closeField`). Inline controls hung off an `EditorRow` (time-of-day pills, time window, link picker) render only while that row is expanded. When adding a field, give it a `hint` that says what it does in one line: that hint is the only in-app documentation these options have.

**List rows** use the iOS inset-grouped card treatment app-wide — match the styling in `TaskItem.itemWrapper` (Search/Logbook/Tags/Categories/Projects rows follow the same pattern). Section headers are uppercase `font.xs` semibold `textTertiary` with `letterSpacing: 0.8`.

### Drag and drop — handle with care

`src/components/ReorderableList.tsx` (+ math in `src/utils/reorder.ts`, tests in `reorder.test.ts`) uses JS-driven row animations and a floating drag overlay by deliberate design — see the comments in that file before changing render order, the animation driver, or the PanResponder lifecycle. Safe to touch: overlay styling, autoscroll params, durations, and haptics via `onHoverChange`. FocusScreen (`react-native-draggable-flatlist`) and TaskEditor (`SortableList`) follow the same rule: styling only.

### Database schema / migrations

`initDatabase()` in `src/db/database.ts` creates tables and runs a list of `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch — they fail silently if the column already exists. When adding a new column, append it to the migrations array rather than modifying the `CREATE TABLE` statement.

Tags and categories are stored as JSON arrays in each task row (`tags TEXT`, `category TEXT`) AND in a registry (`tag_registry` / `category_registry` keys in the `settings` table). The registry tracks tags/categories that exist even if no task currently uses them.

### iOS native extension targets (widgets, and future Watch/Live Activity targets)

The Today widget (`targets/todo-widget/`) is injected at prebuild time by custom config plugins rather than a checked-in `ios/` folder — see `plugins/withAppGroup.js` (adds the App Group entitlement to the main app) and `plugins/withWidgetExtension.js` (adds the WidgetKit extension as a whole new Xcode target via the raw `xcode` npm package). Any future target that needs to share data with the app — a Watch app, a Live Activity, a share extension — will hit the same handful of sharp edges this one did. Before adding one:

- **A new target must be declared in `app.json`'s `extra.eas.build.experimental.ios.appExtensions`** (name, bundle id, entitlements), or EAS Build's non-interactive credential resolution never discovers it and can't provision it — the archive step fails with an opaque signing error.
- **Signing needs `PBXProject.attributes.TargetAttributes`, not just `buildSettings`.** `project.addTargetAttribute('DevelopmentTeam', ...)` / `('ProvisioningStyle', 'Automatic', ...)` — Xcode's own "requires a development team" validation reads the former; setting `DEVELOPMENT_TEAM` in buildSettings alone isn't enough.
- **The `xcode` package's `addTarget()` and `addPbxGroup()` have real bugs**, not just missing convenience: `addTarget()` pre-wraps `name`/`productName` in literal quote characters (breaks any later string match, including EAS's own target lookup) — overwrite `target.pbxNativeTarget.name`/`.productName` right after calling it. `addPbxGroup()` with no `path` argument writes a literal `path = undefined;` into the pbxproj — `delete group.pbxGroup.path` immediately after.
- **Every `$(BUILD_SETTING)` placeholder used in the target's Info.plist must have a real key in the source plist**, even ones Xcode's "New Target" template fills in for you normally (e.g. `CFBundleIdentifier`). A key that's just absent doesn't get a value substituted in — it silently compiles to `(null)`, which then fails Apple's "embedded binary must be prefixed with the parent bundle id" validation at submission, not at build time.
- **A local `expo-modules-core` bridge module needs an actual podspec** to get linked into a second target's Pod install, even though autolinking usually infers one from `expo-module.config.json` alone for the main app target.
- **The App Group container path convention already in use**: `<container>/Library/Application Support/<name>.json`, single-writer (app) / many-reader (extensions), no locking needed. Reuse this path shape for anything new sharing the group rather than inventing another location.

Two fixes that look unrelated to the widget but are load-bearing for *any* second native target existing at all — don't revert them as dead code:
- `enableScreens(false)` near the top of `App.tsx` — works around a `react-native-screens` crash (`RNSTabBarController`) that only reproduces in production builds once the app has more than one native target to build/sign.
- `ios.buildReactNativeFromSource: true` in the `expo-build-properties` plugin config (`app.json`), plus `patches/react-native+0.81.4.patch` (applied via `patch-package` on `postinstall`) — RN 0.81 downloads a prebuilt Core binary by default, which bypasses the patch entirely; the patch itself fixes an RN bug where an `NSException` thrown inside a native module call gets rethrown across a dispatch-queue boundary instead of converted to a JS error, crashing the app. Both were required together — the patch alone has zero effect without also forcing a from-source build.

## Key conventions

- **Path alias**: `@/` maps to `src/` (configured in `tsconfig.json` and `package.json` Jest `moduleNameMapper`).
- **IDs**: generated with `src/utils/id.ts` (`generateId()`), not UUIDs.
- **Dates**: always stored and passed as ISO strings; `date-fns` is used for all date arithmetic.
- **Booleans in SQLite**: stored as `0`/`1` integers, converted in `rowToTask()`.
- **JSON fields in SQLite**: `tags`, `recurrenceDays`, `chainItems` (stored in the `cycle_items` column — see Chains above), `timeSegments` are JSON-stringified arrays. `timeSegments` has a legacy code path in `parseTimeSegments()` that handles a plain string (old format).
- **Subtasks**: tasks with `parentId !== null`. Most store selectors filter with `!t.parentId` to exclude them from top-level lists.
- **Patch notes**: when a change in this PR is user-facing, add a new fragment file to `src/patchNotes/entries/` before opening the PR — one JSON file per entry, `{ "message": "...", "date": "YYYY-MM-DD" }`, named after the change (e.g. `icon-action-buttons.json`). Keep the message short and written for someone who isn't reading the diff. Don't edit `src/utils/patchNotes.ts` or `src/utils/patchNotesData.ts` directly (generated, gitignored). Skip it for internal-only changes (refactors, tests, CI, tooling).
