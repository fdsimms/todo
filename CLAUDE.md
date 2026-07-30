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

Chain items (`chainItems[]` / `chainIndex`, shown in the editor collocated with Repeat since the two are easy to conflate) are a singly-linked list of steps, independent of recurrence: completing a chained task always advances `chainIndex` and immediately spawns the next task with no `dueDate`, ending after the last item. Repeat changes only what happens at that last item — instead of ending, `chainIndex` wraps to `0` and the whole chain repeats on the recurrence's schedule. See the `spawnsNext`/`atChainEnd` logic in `completeTask()` (`src/store/useTaskStore.ts`). The SQLite columns are still named `cycle_enabled`/`cycle_index`/`cycle_items` (renaming them would require a data migration for existing installs); `rowToTask()` maps them to the `chain*` fields on `Task`.

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

**Shared primitives** (use these instead of hand-rolling):

- `ScreenHeader` (`src/components/ScreenHeader.tsx`) — every screen's large-title header: title, optional subtitle/overline, 34pt icon actions with badges/active tint/loading, or custom `right` content.
- `PressableScale` (`src/components/PressableScale.tsx`) — standard press feedback (spring scale + opacity dip) for buttons, chips, FABs, icon buttons. Full-width list rows keep `TouchableOpacity` with `interaction.activeOpacity` — scaling a full row looks wrong.
- `EmptyState` (`src/components/EmptyState.tsx`) — every empty list: tinted icon circle + title + subtitle + optional CTA, animates in on mount.
- `src/utils/haptics.ts` — semantic haptics (`tap`, `success`, `warning`, `error`, `impactLight/Medium/Heavy`). Never import `expo-haptics` directly; pick by meaning so intensities stay consistent.
- `src/utils/layoutAnimation.ts` — `animateLayout()` immediately before a state change that inserts/removes list rows (complete, delete, add, selection-mode toggle). **Never call it on a drag-reorder commit path** (`ReorderableList.onReorder`, `DraggableFlatList.onDragEnd`) — those drive their own row animations.

**List rows** use the iOS inset-grouped card treatment app-wide: `backgroundColor: bgSecondary`, `marginHorizontal: spacing.md`, `marginVertical: 2`, `borderRadius: radius.md` (see `TaskItem.itemWrapper`; Search/Logbook/Tags/Categories/Projects rows match it). Section headers are uppercase `font.xs` semibold `textTertiary` with `letterSpacing: 0.8`.

### Drag and drop — handle with care

`src/components/ReorderableList.tsx` (+ math in `src/utils/reorder.ts`, tests in `reorder.test.ts`) is deliberately built so rows are plain flow-layout views with **no transforms at rest**; the dragged row becomes an invisible placeholder under a floating overlay. Row offset animations are **JS-driven (`useNativeDriver: false`) by design** — native-driven values orphan on the commit render. Do not change the render order of rows, the animation driver, or the PanResponder lifecycle, and don't add gestures that compete with it. Safe to touch: overlay styling (shadow/scale/radius), autoscroll params, durations, and haptics via the `onHoverChange` prop. FocusScreen uses `react-native-draggable-flatlist` and TaskEditor uses `SortableList` — same rule: styling only.

### Database schema / migrations

`initDatabase()` in `src/db/database.ts` creates tables and runs a list of `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch — they fail silently if the column already exists. When adding a new column, append it to the migrations array rather than modifying the `CREATE TABLE` statement.

Tags and categories are stored as JSON arrays in each task row (`tags TEXT`, `category TEXT`) AND in a registry (`tag_registry` / `category_registry` keys in the `settings` table). The registry tracks tags/categories that exist even if no task currently uses them.

## Key conventions

- **Path alias**: `@/` maps to `src/` (configured in `tsconfig.json` and `package.json` Jest `moduleNameMapper`).
- **IDs**: generated with `src/utils/id.ts` (`generateId()`), not UUIDs.
- **Dates**: always stored and passed as ISO strings; `date-fns` is used for all date arithmetic.
- **Booleans in SQLite**: stored as `0`/`1` integers, converted in `rowToTask()`.
- **JSON fields in SQLite**: `tags`, `recurrenceDays`, `chainItems` (stored in the `cycle_items` column — see Chains above), `timeSegments` are JSON-stringified arrays. `timeSegments` has a legacy code path in `parseTimeSegments()` that handles a plain string (old format).
- **Subtasks**: tasks with `parentId !== null`. Most store selectors filter with `!t.parentId` to exclude them from top-level lists.
- **Patch notes**: when a change in this PR is user-facing, add an entry to the top of `patchNotes` in `src/utils/patchNotes.ts` before opening the PR (short, written for someone who isn't reading the diff). Skip it for internal-only changes (refactors, tests, CI, tooling).
