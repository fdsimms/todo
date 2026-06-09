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

Cycle items (`cycleItems[]` / `cycleIndex`) rotate the task's sub-title on each recurrence.

### Navigation

`src/navigation/AppNavigator.tsx` uses a bottom tab bar with only 3 visible tabs (Today, Search, More). The remaining screens (Later, Tags, Categories, Logbook, Stats) are registered as hidden tabs and reached via `SideMenuDrawer`, which overlays the full screen and is opened by tapping "More" or by edge-swipe from the left.

### Theme

`src/theme/index.ts` exports design tokens (`spacing`, `radius`, `font`, `border`, `animation`, etc.) and two color palettes (`darkColors`, `lightColors`). Components consume colors via `useColors()` from `src/theme/ThemeContext.tsx` — never reference a raw hex directly. The top-level `colors` export is kept only for non-themed static uses.

### Database schema / migrations

`initDatabase()` in `src/db/database.ts` creates tables and runs a list of `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch — they fail silently if the column already exists. When adding a new column, append it to the migrations array rather than modifying the `CREATE TABLE` statement.

Tags and categories are stored as JSON arrays in each task row (`tags TEXT`, `category TEXT`) AND in a registry (`tag_registry` / `category_registry` keys in the `settings` table). The registry tracks tags/categories that exist even if no task currently uses them.

## Key conventions

- **Path alias**: `@/` maps to `src/` (configured in `tsconfig.json` and `package.json` Jest `moduleNameMapper`).
- **IDs**: generated with `src/utils/id.ts` (`generateId()`), not UUIDs.
- **Dates**: always stored and passed as ISO strings; `date-fns` is used for all date arithmetic.
- **Booleans in SQLite**: stored as `0`/`1` integers, converted in `rowToTask()`.
- **JSON fields in SQLite**: `tags`, `recurrenceDays`, `cycleItems`, `timeSegments` are JSON-stringified arrays. `timeSegments` has a legacy code path in `parseTimeSegments()` that handles a plain string (old format).
- **Subtasks**: tasks with `parentId !== null`. Most store selectors filter with `!t.parentId` to exclude them from top-level lists.
