# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PR workflow

Once a change is complete and verified (`npx tsc --noEmit && npm test` green, feature manually
exercised where applicable), open a PR automatically — don't wait to be asked. Skip only when
there's a concrete reason (work is incomplete, checks are red, or the user said to hold off);
say why instead of opening one silently.

Don't subscribe to PR activity and don't schedule follow-up check-ins after opening a PR unless
the user explicitly asks for that. Just open the PR and stop.

## Commands

```bash
npm install          # dependencies; node_modules isn't checked in, so a fresh clone needs
                     # this before tsc or jest will run at all
npx expo start       # start dev server (scan QR with Expo Go)
npx tsc --noEmit     # typecheck — ~10s
npm test             # all 28 suites, 992 tests — ~4s, just run the whole thing
npm run test:watch   # watch mode
npx jest src/__tests__/dateUtils.test.ts  # single file, if you want the shorter output
```

**The verification loop is `npx tsc --noEmit && npm test`** — together they're under fifteen
seconds, so there's no reason to skip either or to narrow to a single test file. Both are green
on `main`; if either is red, it's you. Don't run `npx expo export` locally to check your work —
it's the slowest thing CI does and only catches bundle-time breakage (a bad import path, a
missing asset, a native config change), so run it only when you changed one of those. CI runs
`npm test` and `npx expo export --platform ios` on every PR.

There is no ESLint or Prettier config. Match the style of the file you're in; don't reformat
untouched lines.

## Finding your way around

Start from this table instead of searching. Most work lands in one of these files:

| Changing… | Start at |
|---|---|
| what appears on Today / Later / Unscheduled / Inbox | `src/utils/visibilityUtils.ts` + the selectors in `useTaskStore` |
| any task create/complete/defer/delete | `src/store/useTaskStore.ts` |
| the task edit sheet | `src/components/TaskEditor.tsx` |
| a task row — swipes, checkbox, expansion | `src/components/TaskItem.tsx` |
| quick-add text parsing (`"pay rent tmrw 5p #home"`) | `src/utils/parseTaskInput.ts`, `parseNaturalDate.ts` |
| date math, recurrence | `src/utils/dateUtils.ts` |
| a task falling on several dates | `seriesId` in `src/store/useTaskStore.ts` (`applyTaskDates`) — see Series below |
| a column, migration, or row↔object mapping | `src/db/database.ts` (`initDatabase`, `rowToTask`) |
| any model's shape | `src/types/index.ts` — one file, every type |
| colors, spacing, animation | `src/theme/index.ts`, `src/theme/ThemeContext.tsx` |
| bulk selection | `src/hooks/useTaskSelection.ts` + `src/components/BulkActionBar.tsx` |
| reminders | `src/utils/notifications.ts` |
| what the widget shows | `src/utils/widgetSync.ts` → `modules/todo-widget-bridge` |

**Read narrowly.** Seven files are over 1,000 lines — `useTaskStore.test.ts` (2.6k),
`TaskEditor.tsx` (2.3k), `TodayScreen.tsx` (2.1k), `QuickAddModal.tsx` (1.6k),
`useTaskStore.ts` (1.5k), `TaskItem.tsx` (1.5k), `TemplateItemEditor.tsx` (1.3k). Grep for the
symbol and read the surrounding range; reading any of them end to end costs more context than
the rest of the task will.

**Tests mirror source 1:1** — `src/utils/foo.ts` → `src/__tests__/foo.test.ts`, same for
stores; that's where a new test goes. Only pure logic is tested (`src/utils`, `src/store`,
`src/db`): Jest runs in the `node` environment with
no React renderer installed, so there are no component or screen tests. Don't add a renderer to
cover a UI change — verify those by reasoning about the code, and say so plainly rather than
implying you ran them.

## Working style

**Delegate a search, not an edit.** A subagent earns its round trip when the question is a wide
sweep and you only want the conclusion — "every call site of `groupRosterOf`", "which screens
mount `PaintSelectionProvider`", "where does `dayResetTime` get read". When you already know the
file from the table above, just grep. Never hand off the writing: one agent making the whole
diff is what keeps it coherent.

**Say the sequence before a change that spans layers.** Anything touching db + store + UI
should be planned in a sentence or two first, because the constraint almost always lives
downstream: the schema and the visibility rules decide what the UI is allowed to do, not the
other way round.

**Stay in scope.** Fix what was asked, in the pattern the surrounding file already uses.
Adjacent code that looks improvable isn't the task; mention it instead of rewriting it.

**This file is the answer.** The conventions below are settled decisions with the reasoning
attached — the "don't do X" notes exist because X was tried. Don't re-derive them from the
code, and don't re-open them without a reason the note doesn't already cover.

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

All database calls are synchronous (expo-sqlite `runSync`/`getAllSync`). There is no backend, and every
piece of user data lives in a local SQLite file on device. The one network call in the app is
`src/services/aiSuggestions.ts`, which posts task titles/notes straight to `api.anthropic.com` using a
user-supplied API key; every feature it powers is inert until the user pastes one into Settings.

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

### Series (`seriesId`) — one task on several dates

A task the user gave more than one date ("walk the neighbour's dog on the 10th and the 15th") is **N real rows sharing a `seriesId`**, each an ordinary one-off with its own `dueDate` and `recurrenceType: 'none'`. It is deliberately not one row holding a list of dates: `dueDate`/`completedAt`/`streakDate` are singular in every visibility, completion and Logbook path, and Later renders real `Task` rows (`laterSections`), so materialising them is the only way all the dates actually appear there. Projected "ghost" rows were the alternative and would have needed a second, non-completable, non-selectable row type through `TaskItem`/`TodayScreen`/`useTaskSelection`.

**Never reuse `previousOccurrenceId` to link them.** That's the backward completion chain, and `uncompleteTask` deletes whichever row points at the one being uncompleted — un-ticking the 10th would delete the 15th.

- **One entry point**: `applyTaskDates(taskId, dates, repeat?)` creates a series around a task, reconciles an existing one, or dissolves it back to a plain task when the set drops to one date. `addTaskSeries` is the create-from-scratch path. Reconciling never touches completed rows — a date that already happened is history, not schedule.
- **Repeat is optional and separate from recurrence**: `seriesMonthDays` (empty = happens once) holds day-of-month anchors, `seriesRepeatMonths` the interval. The next set is inserted by `completeTask` only once *every* date in the current one is done, so finishing the 10th doesn't conjure a third row while the 15th is outstanding. `getNextSeriesDates()` rebuilds from the stored day numbers rather than shifting the current dates, so a 31st clamped to the 28th for February comes back as the 31st in March. The interval field isn't exposed in the editor yet — the UI ships a monthly on/off toggle.
- **Editing** is scoped like a recurrence: `updateTask(..., {scope: 'series'})` fans `CONTENT_FIELDS` out to the set's *later* incomplete dates, re-anchoring `reminderTime` onto each date's own day (it's an absolute instant, and a set shares an hour, not a moment).
- **Counting**: `groupRoster()` collapses a series to one entry, same as it does recurrence tombstones — otherwise a stack holding a 2-date series reads as 2 members. `getRepeatedInstances()` skips series rows so a deliberate schedule isn't reported as an ad-hoc repeat.

### Chains

Chain items (`chainItems[]` / `chainIndex`, shown in the editor collocated with Repeat since the two are easy to conflate) are a singly-linked list of steps, independent of recurrence: completing a chained task always advances `chainIndex` and immediately spawns the next task with no `dueDate`, ending after the last item. Repeat changes only what happens at that last item — instead of ending, `chainIndex` wraps to `0` and the whole chain repeats on the recurrence's schedule. See the `spawnsNext`/`atChainEnd` logic in `completeTask()` (`src/store/useTaskStore.ts`). `rowToTask()` maps the legacy `cycle_enabled`/`cycle_index`/`cycle_items` SQLite columns to the `chain*` fields on `Task`.

### Stacks (`TaskGroup`)

"Stack" is the user-facing name; the code says `TaskGroup` / `group` throughout (table `task_groups`, `useTaskGroupStore`, `TaskGroupHeader`/`TaskGroupEditor`). A stack is a lightweight, stable *label* that several independently-scheduled tasks hang off — deliberately not a `Task`, so it can never be "not due yet" and desync from its members. Membership is `Task.groupId`.

**A stack's membership is a set of task *series*, not of task rows.** This is the one thing to get right. Because `groupId` rides along on the `...effective` spread in `completeTask()`, a completed occurrence keeps its `groupId` forever *and* so does the fresh row it spawns — so the raw child rows grow by one per completion, without bound. Never count, cascade over, or list `groupChildrenOf()`; use **`groupRosterOf()`** (store) / **`groupRoster()`** (`src/utils/visibilityUtils.ts`), which collapses those rows back to one entry per series. `groupChildrenOf()` is only for the rare "all history too" case, like re-filing rows when the stack is deleted.

Two counts exist and they mean different things, so keep them labelled: the roster is *membership* ("8 tasks", shown in the editor), and `isRelevantToGroupToday` filters that to *today's work* ("3/8 today", the badge on the Today row). A member that isn't due today is still a member.

A stack has no derived completion state of its own. `TaskGroup.completedAt` is a "user dismissed this for today" stamp, read only via `isGroupDismissedToday()` / `isGroupHiddenToday()` — it self-expires at the day rollover, and hiding additionally requires every member due today to still be done, so a stack that regains live work un-hides itself. **Don't add code that clears the stamp on some event**; that was the previous design and it needed four call sites and still missed one.

Cascades (`completeGroup`, `deferGroup`, `pinGroup`, `deleteGroup`) are roster-scoped so they can't mutate completed history. `deleteGroup({cascade:true})` deletes the live members and merely unfiles the past occurrences — deleting a stack must not erase its Logbook and Stats history.

### Navigation

`src/navigation/AppNavigator.tsx` uses a bottom tab bar with 4 visible tabs (Today, Search, Projects, More). The remaining screens (Categories, Tags, Templates, Logbook, Stats, Archived) are registered as hidden tabs and reached via `SideMenuDrawer`, which overlays the full screen and is opened by tapping "More" or by edge-swipe from the left.

Today, Later, Unscheduled and Inbox are **not** separate screens — they're four `viewMode` sub-views of `TodayScreen`, switched by the pill row under its header, and they share one set of screen state (selection mode, expanded row, quick-add, editor). They're disjoint lenses over the same tasks (`isUnscheduledTask()` excludes inbox tasks, `isTaskVisible()` excludes both), each backed by its own store selector. Keep it that way when adding a fifth: Inbox used to be its own route, and every switch into it had to hand the destination over as a navigation param, which painted a frame of the *previous* sub-view before the param landed. A segmented control shouldn't navigate.

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
- `PaintSelectionProvider` (`src/components/PaintSelection.tsx`) — wraps a task list so that, while bulk selecting, a drag down the checkbox column "paints" a run of rows instead of needing a tap each. Screens get it by spreading `paintProps` from `useTaskSelection` and passing `scrollEnabled={!painting}` to the list; rows register themselves from inside `TaskItem`, so nothing else has to change. The touch is claimed **on touch-down in the capture phase** within `PAINT_GUTTER_WIDTH` of the leading edge — a native scroll can't be taken back once it starts dragging, so deciding later would let the list scroll out from under the paint. That's why a drag started right on the checkboxes can't scroll (the deliberate trade), and why every other pixel of the row scrolls exactly as before. Hit-testing math and its tests live in `src/utils/paintSelect.ts` / `paintSelect.test.ts`.
- `src/utils/haptics.ts` — semantic haptics (`tap`, `success`, `warning`, `error`, `impactLight/Medium/Heavy`). Never import `expo-haptics` directly; pick by meaning so intensities stay consistent.
- `src/utils/layoutAnimation.ts` — `animateLayout()` immediately before a state change that inserts/removes list rows (complete, delete, add, selection-mode toggle). **Never call it on a drag-reorder commit path** (`ReorderableList.onReorder`, `DraggableFlatList.onDragEnd`) — those drive their own row animations.
- **Accessibility on icon-only controls isn't a missing primitive, it's an adoption gap** — `PressableScale` already supplies `accessibilityRole="button"`, and every icon-only `TouchableOpacity` (drag handles, delete X's, calendar day cells, month-nav chevrons) needs an explicit `accessibilityLabel` alongside it, following `TaskItem`'s style (e.g. `` `Reorder subtask ${sub.title}` ``). Hand-rolled on/off controls (a `View` toggle knob inside a `Touchable`, not a real `Switch`) need `accessibilityRole="switch"` + `accessibilityState={{ checked }}` too — see the vacation-pause and archive toggles in `TaskEditor`/`ProjectEditor`.

**Editors are progressive disclosure.** `TaskEditor`, `TemplateItemEditor`, `TaskGroupEditor`, `ProjectEditor` and `TemplateEditor` all follow the same shape: title/notes, then cards under uppercase `groupLabel` headers (Schedule → Organize → Priority & effort → Subtasks → More), rarely-changed rows last. Nothing renders its picker expanded by default — every pill grid lives inside a `CollapsibleField` that shows only its current value until tapped, and picking a single-choice value collapses the section again (`closeField`). Inline controls hung off an `EditorRow` (time-of-day pills, time window, link picker) render only while that row is expanded. When adding a field, give it a `hint` that says what it does in one line: that hint is the only in-app documentation these options have.

**List rows** use the iOS inset-grouped card treatment app-wide — match the styling in `TaskItem.itemWrapper` (Search/Logbook/Tags/Categories/Projects rows follow the same pattern). Section headers are uppercase `font.xs` semibold `textTertiary` with `letterSpacing: 0.8`.

### Drag and drop — handle with care

`src/components/ReorderableList.tsx` (+ math in `src/utils/reorder.ts`, tests in `reorder.test.ts`) uses JS-driven row animations and a floating drag overlay by deliberate design — see the comments in that file before changing render order, the animation driver, or the PanResponder lifecycle. Safe to touch: overlay styling, autoscroll params, durations, and haptics via `onHoverChange`. The subtask lists in `TaskEditor` and `TaskItem` (`src/components/SortableList.tsx`) follow the same rule: styling only.

**A `SortableList` rendered inside a scrollable must turn that scrollable off for the duration of a drag** — pass `onDragStateChange` and wire it to the container's `scrollEnabled` (see `TaskGroupEditor`, or `draggingStackChild` in `TodayScreen`). Without it the drag doesn't happen at all: a native scroll view only stands down for a JS responder that is one of its **ancestors** (`_shouldDisableScrollInteraction` walks `superview`, not the subtree), and `SortableList`'s responder is a descendant — so the scroll claims the touch on the first finger move and the row is put straight back down. `ReorderableList` is immune because it owns the scroll view it drags inside of and sets `scrollEnabled` itself. Still unwired: the inline subtask list in `TaskItem`, which would need the flag plumbed up to each screen that renders it.

Both lists fire the drag-lift haptic themselves (`startDrag`), so callers must not add their own.

### Database schema / migrations

`initDatabase()` in `src/db/database.ts` creates tables and runs a list of `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch — they fail silently if the column already exists. When adding a new column, append it to the migrations array rather than modifying the `CREATE TABLE` statement.

Tags and categories are stored as JSON arrays in each task row (`tags TEXT`, `category TEXT`). Tags are additionally tracked in a `tag_registry` key in the `settings` table, so a tag that exists but is currently unused doesn't disappear. Categories used to work the same way, but now live in their own `categories` table (they carry schedule/vacation fields a string list can't hold) — the `category_registry` setting is legacy, read only by the one-time migration in `initDatabase()` that backfills that table.

### iOS native extension targets (widgets, and future Watch/Live Activity targets)

The Today widget (`targets/todo-widget/`) is injected at prebuild time by custom config plugins rather than a checked-in `ios/` folder — `plugins/withAppGroup.js` (App Group entitlement on the main app) and `plugins/withWidgetExtension.js` (the WidgetKit extension as a whole new Xcode target, built via the raw `xcode` npm package).

**Before adding or changing a native target — Watch app, Live Activity, share extension — read `docs/native-targets.md`.** It lists the six non-obvious requirements this one cost a build cycle each to discover (the EAS `appExtensions` declaration, `TargetAttributes` signing, two outright bugs in the `xcode` package, Info.plist placeholder keys, the bridge module's podspec, the App Group path convention). Nothing else in the repo will tell you about them, and each one fails late — at archive or at submission, not at build.

Two fixes that look unrelated to the widget but are load-bearing for *any* second native target existing at all — don't revert them as dead code:
- `enableScreens(false)` near the top of `App.tsx` — works around a `react-native-screens` crash (`RNSTabBarController`) that only reproduces in production builds once the app has more than one native target to build/sign.
- `ios.buildReactNativeFromSource: true` in the `expo-build-properties` plugin config (`app.json`), plus `patches/react-native+0.81.4.patch` (applied via `patch-package` on `postinstall`) — RN 0.81 downloads a prebuilt Core binary by default, which bypasses the patch entirely; the patch itself fixes an RN bug where an `NSException` thrown inside a native module call gets rethrown across a dispatch-queue boundary instead of converted to a JS error, crashing the app. Both were required together — the patch alone has zero effect without also forcing a from-source build.

`enableScreens(false)` has a side effect worth knowing before reaching for `freezeOnBlur` on a tab screen: it forces `@react-navigation`'s `ScreenFallback` → `ResourceSavingView` path instead of the native `react-native-screens` implementation, and `ResourceSavingView` never forwards `freezeOnBlur` — it only moves blurred children `FAR_FAR_AWAY`. So a blurred tab screen stays mounted and keeps re-rendering on every store change; `freezeOnBlur` is inert in this app, and there's no escape hatch for it while `enableScreens` stays off.

## Key conventions

- **Path alias**: `@/` maps to `src/` (configured in `tsconfig.json` and `package.json` Jest `moduleNameMapper`).
- **IDs**: generated with `src/utils/id.ts` (`generateId()`), not UUIDs.
- **Dates**: always stored and passed as ISO strings; `date-fns` is used for all date arithmetic.
- **Booleans in SQLite**: stored as `0`/`1` integers, converted in `rowToTask()`.
- **JSON fields in SQLite**: `tags`, `recurrenceDays`, `chainItems` (stored in the `cycle_items` column — see Chains above), `timeSegments` are JSON-stringified arrays. `timeSegments` has a legacy code path in `parseTimeSegments()` that handles a plain string (old format).
- **Subtasks**: tasks with `parentId !== null`. Most store selectors filter with `!t.parentId` to exclude them from top-level lists.
- **Patch notes**: when a change in this PR is user-facing, add a new fragment file to `src/patchNotes/entries/` before opening the PR — one JSON file per entry, `{ "message": "...", "date": "YYYY-MM-DD" }`, named after the change (e.g. `icon-action-buttons.json`). Keep the message short and written for someone who isn't reading the diff. Don't edit `src/utils/patchNotes.ts` or `src/utils/patchNotesData.ts` directly (generated, gitignored). Skip it for internal-only changes (refactors, tests, CI, tooling).
