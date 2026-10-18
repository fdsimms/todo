# Workouts: a full strength-training tracker

**Status: phases 1, 2 and 3 built (the data foundation, logging, and analysis), the rest planned.** Phase 1 is the five tables, their sync and backup registration, the exercise library and catalog, `useWorkoutStore` and the settings. Phase 2 is the routine editor, workout mode with its rest timer, the task link (`Task.workoutRoutineId`), the Workouts switch in Settings › Feature areas, the unit and default rest under Settings › Apple Health › Workouts, and the MCP writes; "Phase 2, as built" below records what it decided. Phase 3 is the records, the plate math, the exercise page, the Stats section and the mood contrast; "Phase 3, as built" records what it decided. Programs and everything native are still the plan. This file records the plan and the decisions already made. The three main surfaces are mocked in `workouts-mocks/`: HTML at 390pt using the real theme tokens, in light and dark. They are a proxy for layout and hierarchy, not a render of the app.

This feature is a gym logger with the depth of a dedicated app. It includes an exercise library, routines and multi-week programs with progression, set-by-set logging, a rest timer, PRs and charts, Apple Health, Live Activity, Siri and Apple Watch logging. Cloning Strong or Hevy is not the goal. The goal is to be good enough at the gym that the integration (the schedule, the food log, mood, rewards, Claude over MCP) is reason enough to keep it all in one app.

## What the repo already decides

1. **A logged set is a statement, not a reading.** `health-data.md` forbids keeping a copy of Health *readings* ("There is no table, and there must not be one"), but entries the person writes (food log, mood, doses) are stored. Sets typed in the app are entries, so they get tables. Workouts *other apps* wrote to Health (a run) are readings: queried on demand, never stored.
2. **Nothing derives anything from a body weight.** The weight rule rules out BMI, "trending" and any `HealthRuleMetric` on weight. So there are no bodyweight-relative standards ("1.5x bodyweight bench"), no Wilks/DOTS, and no automatic bodyweight term in pull-up volume. A dedicated app has these; this one deliberately won't.
3. **Absent stays absent.** A session with no measured energy writes no energy to Health. Calories are never estimated from sets.
4. **Writes to Health happen on a person's tap and are retractable.** That is the food-log pattern: its own switch, sample ids kept (`healthSampleIds`), and `deleteHealthSamples` on delete or edit.
5. **The app proposes; the person confirms.** This applies to `energyBudget.ts` and the AI estimates, and it applies to progression: the next weight is a suggestion, never written into a plan unasked.
6. **Derived, never stored.** The coin balance is a ledger sum. PRs, estimated 1RMs and "which routine is next" in a program are all computed from session history, never kept as their own fields.
7. **Only a person moves coins.** Finishing a session completes its linked task (a person's action), and that earns coins. Sets earn nothing ("Subtasks earn nothing, or splitting a task would be the way to earn more"). PRs earn nothing.
8. **A step that runs out waits.** This comes from `focus-sessions.md`: a finished rest timer chimes and counts up, and never advances the workout by itself.
9. **Adding a Health read type costs existing installs a re-ask.** There is no re-prompt, so the person has to tap ask again in Health settings.
10. **Every tap-driven sheet that holds a drag is `fullScreen`.** Workout mode reorders exercises mid-session, so it is `fullScreen` like `EditorSheet` and `CookModeSheet`.

## Options considered

| Option | Verdict |
|---|---|
| Workouts as tasks only (each exercise a subtask) | Rejected. Subtasks have no sets, weights or history per exercise, and they'd bloat the task table by about 25 rows per session. |
| **Separate workout records, linked to a scheduled task** | **Chosen.** The task owns *when* (recurrence, a 3-per-week quota, vacation, streaks, coins). The session owns *what happened*. |
| Health as the store for sets | Rejected. HealthKit has no per-set weight and reps model. |
| Exercise library as synced rows | Rejected. Hundreds of rows on every device, and updating the library would mean a migration. |
| **Library in code, custom exercises and overrides as rows** | **Chosen.** Stable ids (`lib:barbell-bench-press`), and it updates with the app. |
| Routine items as a child table | Rejected for v1. A routine is edited as a unit (the `saved_meals.items` precedent), so a JSON column is enough. |
| **Sets as a child table** | **Chosen.** Sets are appended one at a time from the phone and the watch, so they need row-level sync and dedupe by id. |

## Decided for this feature

- **Sessions and sets are part of the health record.** `workout_sessions` and `workout_sets` join `HEALTH_SYNC_TABLES`, so iCloud never receives them, and a sync server receives them only once the person turns on `syncServerHealthLogs`. The reason is the one written on that list: App Review guideline 5.1.3(ii) says an app "may not store personal health information in iCloud", and this app takes the strict reading for logs the person typed in. A workout log is a record of what a body did. Once phase 9 attaches heart rate and energy from HealthKit, it is plainly covered. Routines, programs and custom exercises stay ordinary synced data, because they are plans rather than records (the same reason `saved_meals` isn't withheld). The cost is that workout history doesn't cross devices for someone with no sync server.
- **Rest timers respect quiet hours.** This is the opposite of recipe step timers, which ring through. Inside quiet hours the alarm is not scheduled, and the in-app haptic still fires when the timer ends with the app in front. That is how the task timer's `scheduleTimerAlarm` already behaves.
- **The watch goes all the way to a HealthKit workout session** (phases 8 and 9). Phase 9 starts with a written review against `health-data.md` before any code.

## The design

### Data model

The new types go in `src/types/index.ts`, and the tables go in `initDatabase` with indexes in the migrations array.

- **`exercises`** (custom exercises and overrides of built-in ones): `id`, `name`, `kind` (`weight_reps | bodyweight_reps | assisted_reps | duration | distance | weight_distance`), `primaryMuscles` and `secondaryMuscles` (JSON), `equipment`, `barKg` (nullable), `notes`, `archived`, `isCustom`. An override row reuses the built-in's id, so renaming "Bench press" to "Flat bench" is one row.
- **`workout_routines`**: `id`, `name`, `notes`, `programId` (nullable), `sortOrder`, and `items` (JSON). Each item holds `{ exerciseId, supersetKey?, restSeconds, progression, targets: [{ kind: warmup|working|drop|amrap, repsMin, repsMax, weightKg?, pctOfTm?, rpe? }] }`.
- **`workout_programs`**: `id`, `name`, `weeks`, `rotation` (an ordered list of routine ids), `scheme` (`double | linear | percent | rpe`), `trainingMaxes` (JSON, per exercise), `startedAt`, `archived`. The program's current week and next routine are derived from its sessions.
- **`workout_sessions`**: `id`, `routineId?`, `programId?`, `taskId?` (the occurrence it completed), `title`, `startedAt`, `endedAt` (null while live), `notes`, `effort` (1 to 10, typed), `healthWorkoutId?`, `healthWritePending`.
- **`workout_sets`**: `id`, `sessionId`, `exerciseId`, `position`, `setIndex`, `kind`, `weightKg?`, `reps?`, `durationSeconds?`, `distanceM?`, `rpe?`, `completedAt?`, `supersetKey?`, `note?`. Indexes are `(session_id)` and `(exercise_id, completed_at)`. Weight is always stored in kg, and the unit is display only, like `waterUnit`.
- **Task link**: `Task.workoutRoutineId` (built in phase 2), like `logSavedMealId`; a `workoutProgramId` waits for programs (phase 4). A template does not seed it: like a saved meal, a routine is a row of this person's own, which a template shared with somebody else (or run before the routine synced) would name and not find (`templateItemParity.test.ts`, "names a workout routine outside the template"). The MCP writes and reads it (`create_task`/`update_task`, `get_task`'s `workout`).
- **Settings** (the `settings` table, added to `SYNCED_SETTING_KEYS`): `workoutUnit`, `plateInventory` (bar weights, plates and counts), `defaultRestSeconds`, `workoutHealthWrite`.

**Registration.** Each table also needs:
- an entry in `SYNC_TRACKED_TABLES` and in `BACKUP_TABLES` (the schema-completeness tests in `database.test.ts` fail until it has both);
- a `NATURAL_KEYS` rule for custom exercise names, so two devices that both create "Cable fly" offline fold into one, with `REFERENCES` from `workout_sets.exercise_id` and the routine items;
- a place on the `useTaskStore.initialize` reload list, which is how sync, demo mode and restore reach a store. No test checks this.

**Privacy class.** `workout_sessions` and `workout_sets` go in `HEALTH_SYNC_TABLES` (see "Decided for this feature"). Nothing tests membership of that list, so phase 1 adds a test that pins it. The sync settings copy ("Whether the mood, medication and food logs go to the sync server") names workouts too.

### Logic modules (pure, tested 1:1)

New files in `src/utils/`, each with its test in `src/__tests__/`. The first three are built; the rest are planned.

- `src/utils/exerciseLibrary.ts` (built): about 200 built-in exercises (name, kind, muscles, equipment, a short text cue), with ids written out rather than derived, since an id is forever. No images or video in v1.
- `src/utils/exerciseCatalog.ts` (built): merges the library with the custom rows, plus search (the substring scoring task search uses, without its scattered-letters fallback, which matched half the library) and muscle and equipment filters. An override row contributes only the name, notes, bar weight and archived flag; what the movement is stays the library's.
- `src/utils/workoutData.ts` (built): the closed vocabularies, their labels, the resolve-or-shrug readers every row mapper uses, and the rest and plate settings' defaults and parsers.
- `workoutProgression.ts` (phase 4): given the history for an exercise and its rule, propose the next session's targets:
  - **double:** hit the top of the rep range on every working set, then add an increment;
  - **linear:** add an increment after a success, and after N failures propose a 10% deload;
  - **percent:** sets taken from a training max, and the training max is bumped at the end of a cycle;
  - **rpe:** adjust the load from the last top set's RPE.

  It returns a proposal plus its reason ("Last time 3x10 at 60 kg, so try 62.5"), and it rounds to loads you can make with your plates.
- `src/utils/plateMath.ts` (built): load, bar and plate inventory give the plates per side. It also builds warm-up ramps.
- `src/utils/workoutRecords.ts` (built): PR detection and estimated 1RM (Epley, only from sets of 10 reps or fewer, always labelled "estimated"). Best set, rep PRs at each rep count, and volume per session, exercise and muscle per week. Memoized per set array, the way `openTasksOf` is cached.
- `src/utils/workoutSession.ts` (built): the live session's rules, shaped like `cookMode.ts` and `focusPlan.ts`: the walking order with supersets alternated round by round (`walkOrder`, `nextSet`), where a logged set leaves the screen and whether it rests (`afterLog`), a routine's planned sets (`plannedSetsFor`), last time's sets and their match to this time's (`previousSets`, `matchPrevious`), "Add set" and "Same as last set" (`copyLastSet`, `valuesFromLastDone`), what finishing drops (`finishPlan`) and the summary (`sessionSummary`).
- `src/utils/workoutRoutine.ts` (built): the routine editor's edits (`withWorkingSets`, `withReps`, `withWarmups`, `withTargetWeight`, `withProgression`), supersets as runs of neighbours (`supersetRoles`, `joinPrevious`, `leaveSuperset`, `normalizeSupersets`) and the summary lines.
- `src/utils/workoutTask.ts` (built): what finishing a workout does to the task it was started from (`workoutTaskEffect`).
- `src/utils/workoutCsv.ts` (built, phase 7): reads Strong and Hevy CSV exports, matches their exercise names to the catalog, plans an idempotent import and writes the person's own log as a CSV. See "Phase 7, as built".

### Store

`src/store/useWorkoutStore.ts` (built in phase 1; phase 2 added laying a routine out, `addSessionExercise`, `addPlannedSet`, `lastTimeFor`, `addFinishedSession`, `replaceSets` and the task link):
- it holds exercises, routines, programs and sessions, with sets loaded per session or exercise on demand;
- its actions are `startSession`, `logSet`, `editSet`, `deleteSet`, `reorderExercises`, `finishSession`, `discardSession`, plus CRUD for routines, programs and custom exercises;
- `finishSession` answers the linked task through the task store, never the reverse: `completeTask`, or `logQuotaUnit` for a target below its count (`workoutTaskEffect`). Ticking the task off without a session does not invent a session.
- a custom exercise is never removed, only archived, because sets logged on another device never arrive over iCloud and can't be counted from here; an archived custom exercise keeps its name (the database's unique `name_key`); deleting a built-in's row puts the library's back. Deleting a session deletes its sets in the same transaction.

### Rest timer

- **Mechanism.** Generalise the step timers rather than building a fourth timer. They are the only timers that run to the second, have +1 min and restart, ring through quiet hours via AlarmKit and survive backgrounding. `StepTimer` is now a subject union (built): `RecipeStepTimer` (`kind: 'recipe'`, `recipeId`, `stepId`) and `RestTimer` (`kind: 'rest'`, `sessionId`, `exerciseId`). The store, alarm and Live Activity plumbing are reused.
- **Behaviour.** Logging a set starts the rest for that exercise automatically. When the rest ends it chimes and counts up, and the cursor stays put.
- **Quiet hours.** The subject decides whether quiet hours apply: `rest` respects them and `recipe` keeps ringing through. One store with two policies, not two stores.

### UI (each piece mocked before it is built)

**Screens:**
- **Workouts**: history list, calendar dots on the month grid, and a "Start" for the next routine in the active program.
- **Exercise detail** (built as a sheet in phase 3, see below): estimated 1RM, best-set and volume line chart (the `WeightChart` shape), PR table and history.
- **Routine editor**: an `EditorSheet`-based list of exercises with drag reorder, per-set targets and a progression picker.
- **Program editor and library**: generic built-ins (5x5 linear, Push/Pull/Legs, Upper/Lower, a 4-week percentage wave). They avoid trademarked program names.

**Workout mode** is a `fullScreen` sheet modelled on `CookModeSheet`:
- the screen stays awake;
- one exercise card at a time, with sets as rows, `CountStepper` for weight and reps, and a plate line ("20 + 10 + 2.5 per side");
- you tap a set's check to log it, and the rest timer starts in the footer;
- a "finish" summary shows PRs hit and offers "Write to Health".

**Stats** gains a WORKOUTS section: sessions per week, sets per muscle per week and recent PRs.

**Mood** gains one more `ContrastBars` pair: mood on training days vs rest days, under the mood-log rules (at least 3 days on each side, association not cause). It counts only the app's own sessions, because a day with no Health workout is ambiguous.

### Health (native)

- **Write.** A finished session becomes an `HKWorkout` (`.traditionalStrengthTraining`). Energy is attached only if a watch workout session measured it. The UUID is kept in `healthWorkoutId`, and deleting or editing the session retracts and rewrites it, like `reviseEntry`. This adds a `'workout'` write kind with its own switch, extends the combined authorization request (share and read together, per the revocation note in the bridge), and updates the plist strings.
- **Read.** Workouts from other apps appear in the Workouts history as "From Health", queried per window and never stored. This is a new read type, so existing installs have to re-ask.
- `activeEnergyBoost` stays as it is. A watch session's energy reaches it through Health, so nothing is counted twice.

### Live Activity and Siri (native)

- **Live Activity.** A new `Workout` kind shows the current exercise, "set 3 of 4" and the rest countdown. Its buttons are deep links (`dundundun://workout?do=set-done|rest+30|skip-rest`), the way Focus does it. Every existing kind has an empty `ContentState` and is restarted on each change. Restarting on every set may flicker, so this kind may be the first to use `ContentState` updates.
- **Siri.** "Start my workout" and "Start Push A" use a routine `AppEntity` resolved against an App Group index (the `pantryIndex.ts` pattern). Logging sets by voice is out of scope.

### Apple Watch (native, the largest piece)

**Phase W1, logging without HealthKit:**
- a Workout page in the existing watch app with the current exercise, the target set, and weight and reps on the Digital Crown with Done Set;
- the live session reaches the watch in the existing `WATCH_CAPS` snapshot;
- sets come back as a new tap kind `set` on the quiet-tap queue, deduped by a set id generated on the watch;
- a watch-first session (phone in the locker) needs the routine on the watch, and that is the hard part.

**Phase W2, `HKWorkoutSession` on the watch:** heart rate, measured energy, the app staying in front on the wrist, and the workout ring. This needs the HealthKit entitlement on the watch target, new share and read types, and its own review under `health-data.md`, which has so far turned away heart-rate reads (resting heart rate and HRV specifically).

### MCP

Each phase ships its own slice of the MCP server:
- **reads:** `list_exercises`, `list_workouts` (sessions with sets), `exercise_history` (PRs, estimated 1RM trend, last session);
- **writes:** `save_routine`, `save_program`, `log_workout` (after the fact), `update_workout`, `delete_workout`, each with a `withAgentLedger` wrapper and `COUNTERPARTS` entries;
- **text:** the rules in `instructions.ts` (kg on the wire; a progression is a proposal; never fabricate a session);
- **adoption:** `ADOPTION_CHECKS` entries.

Because sessions and sets are health-record tables, the MCP server sees workout history only on a phone that sends health logs to the sync server. Routines and programs reach it either way, so Claude can build a plan for someone who hasn't shared their history. `get_overview`'s `healthLogs` counts gain a `workouts` entry.

This is the strongest differentiator: "build me a 4-day upper/lower around my Tuesday commitments" becomes four `save_routine` calls, a `save_program` and recurring tasks, all in one replica.

### Gating and navigation

- A new **Workouts** switch in Feature areas, beside kitchen and rewards. It is off by default, since a big area nobody asked for is clutter.
- Simple mode hides the area through a `SimpleFeatureId` with `contentScreen`.
- Workouts joins the Health hub (`HEALTH_HUB`), so `navHubs.test.ts`'s 15-row pin isn't broken by a new top-level row. Its sub-screens are sheets and stack routes. The screen can be picked as a tab through `tabRoutes`.

### What it deliberately does not do

- Bodyweight-relative standards, Wilks/DOTS, or a body-fat estimate (the weight rule).
- Calories estimated from lifting.
- Social features, coaches or shared feeds (there is no backend). A routine can still be shared as a file through the share sheet.
- Exercise videos or images in v1, because of asset size and licensing.
- Auto-advancing a session, or auto-applying a progression.

## Phase 2, as built

What phase 2 settled that the plan above left open. Files: `RoutineEditorSheet.tsx`, `WorkoutModeSheet.tsx`, `WorkoutModeHost.tsx` and `ExercisePickerSheet.tsx` in `src/components/`, `useStartWorkout.ts` and `useRestTimer.ts` in `src/hooks/`, `useWorkoutModeStore.ts`, and the three utils above. The routine editor and workout mode follow the approved mocks; the Workouts screen's routine list, the exercise picker, the finish summary and the task row's button were mocked in the PR.

- **Planned sets are rows with no `completedAt`.** Starting from a routine lays its sets out as rows (`startSession`), so they can be shown, edited and checked one at a time; finishing deletes the ones never checked, because a plan nobody carried out records nothing. A set's numbers come from the routine's target weight, else from last time's matching set; reps from last time, else the top of the range. Neither is a progression: nothing here moves a load on.
- **PREVIOUS matches by kind**: the nth warm-up against last time's nth warm-up, the nth working set against the nth working set, so adding a warm-up doesn't shift every row onto the wrong one.
- **A logged set is the only thing that moves the screen.** On its own, an exercise keeps its card and the set starts the rest. In a superset the card turns to the partner with no rest, and the set that closes the round starts it (the mock's "rest after the pair"). A finished exercise keeps its card; moving on is a tap.
- **A rest is one timer at a time**, a `RestTimer` in `useStepTimerStore` beside the recipe step timers (the subject union). Logging the next set replaces it. It is a plain notification that quiet hours suppress, never an AlarmKit alarm: a full-screen alarm to dismiss after every set is the wrong weight for a rest. `useRestChime`, mounted once in `WorkoutModeHost`, buzzes when it ends with the app in front, whatever screen is showing. It never moves the workout on.
- **The rest's Live Activity rides the step timer's** from JS alone: key `rest:<id>`, kind `rest`, the session title over "Rest after set 2 of …". Its Done is the existing `stopTimer` link, which for a `rest:` key skips the rest. No Swift changed; phase 6 builds the workout's own activity.
- **A rest outlives nothing.** `WorkoutModeHost` drops every rest whose session is no longer live (`removeRestsOutside`), however it ended (finished, discarded, deleted on another device), so the workout store never reaches into the timers and stays loadable by the MCP server.
- **Finishing answers the task the way its checkbox would** (`workoutTaskEffect`): complete it, log one unit on a target below its count ("3 a week"), ask its question first (the host queues it once workout mode closes, the answer-first rule), or leave it alone (already done, not due, a rotation that asks which member) and say so on the summary.
- **Leaving is not ending.** End asks: Close keeps the session live (the Workouts screen shows it as In progress with Resume), Discard deletes it. One session at a time: starting another while one is live offers to open it.
- **Weights step in the shown unit** by 2.5 kg or 5 lb, through `CountStepper`'s new `places` (decimal keyboard, a typed 82.75 kept to the quarter), converted at the stepper (`weightToDisplay`, `weightFromDisplay`, kept to three places of a kilogram so 135 lb reads back as 135).
- **The progression is a stored choice** on each routine item, and the editor says the app doesn't suggest weights from it yet. Warm-ups are a count (a stepper, not the mock's "2, ramped", since a ramp needs phase 3's plate math).
- **The finish screen** shows time, exercises, sets and each exercise's heaviest set, takes effort (1 to 10, optional) and notes, and says what saving drops and what it does to the task. Per-set notes are on the open set's row.
- **Settings.** The Workouts switch is in Feature areas beside kitchen and rewards. The unit and the default rest are a Workouts section under Apple Health, shown while the area is on.
- **Not built in phase 2:** reordering exercises inside a live session (the store has `reorderExercises`; workout mode has no drag yet), a floating bar for a live session on every screen (the Workouts screen's card is the way back), and the plate line and suggestion card in the mock (phases 3 and 4).

## Phase 3, as built

What phase 3 settled that the plan above left open. Files: `src/utils/workoutRecords.ts`, `workoutRecordText.ts` (the words a record is shown as), `plateMath.ts` and `exerciseChart.ts` (where the chart's points and breaks fall) in `src/utils/`; `ExerciseDetailSheet.tsx`, `ExerciseProgressChart.tsx`, `PlateLine.tsx` and `WorkoutStatsCards.tsx` in `src/components/`; `useWorkoutStats.ts` in `src/hooks/`; `trainingDayMoodContrast` in `moodInsights.ts`; `exercise_history` in `mcp/src/workoutTools.ts`. `src/__bench__/workoutRecords.bench.ts` times it over a year of sets (about 30 ms cold in Node for every exercise, nothing warm). The exercise page, the Stats section and the mood row were mocked before they were built (the exercise page is `workouts-mocks/exercise-detail.png`).

**The records, and what makes one:**
- **Nothing is stored.** `analyzeExercise` walks one exercise's sets oldest to newest and returns its chart points, its standing bests and every record any session broke. `analyzeAll` does it for every exercise at once (Stats). Both are memoized per array of sets, the way `openTasksOf` is per task array, and the key is the array's identity: the store never mutates one.
- **A set counts when it was done and isn't a warm-up** (`countsForRecords`). Drop sets and AMRAP sets are working sets. A planned set has no `completedAt` and counts for nothing.
- **A session is judged as a whole against everything before it.** Three improving sets are one record at the best figure, not three events. A record is announced only where there is something earlier to beat, so a first session, or a rep count nobody had done, sets no record.
- **The estimated 1RM is Epley from a set of 10 reps or fewer** (`E1RM_MAX_REPS`), rounded to 0.1 kg, and a single is the weight itself. Every label that shows it says "estimated"; the MCP field is `estimatedKg` with a note.
- **"Best set at N reps" is the heaviest set of N or more reps.** A heavier set of ten retires the best of eight, since it dominates it. A rep count is listed, and announced, only while the set holding it has exactly N reps (up to `REP_RECORD_MAX`, 12), or one set would read as eight records.
- **Other kinds have the same two readings in their own unit.** A bodyweight or assisted exercise ranks by reps and its volume is its reps, **never reps times a body weight**; an assisted set's weight is the help, so it is never multiplied either. A hold ranks by its longest set and sums seconds, a distance by its farthest and sums metres, a carry by its heaviest load and sums metres. Only weight and reps has an estimated 1RM (`metricsFor`).
- **Muscles credit a primary muscle 1 set and a secondary 0.5** (`SECONDARY_MUSCLE_WEIGHT`), the common fractional-set convention, once per set (a muscle listed as both counts as primary). Weekly volume in kilograms is summed only for weight and reps, since volumes in other units don't add. Weeks start on the person's `weekStartsOn`, and a session's day is its logical day (`dayResetTime`), never a cut of `toISOString()`.
- **Stats counts finished workouts only** (`useWorkoutStats`): a session in progress can still have its sets unchecked, so none of the bars, muscle sets or records read it.

**The exercise page is a sheet, not a route.** It opens from the Exercises list and from the exercise's name in workout mode, and workout mode is a full-screen modal, where a pushed route would sit behind it. A sheet nests inside that modal the way the exercise picker does and closing it leaves the workout where it was. The chart's x axis is the calendar (a layoff is a gap, not a squeeze), the line breaks after `CHART_GAP_DAYS` (21) with no session, the y axis is never anchored at zero (`chartDomain`, for `WeightChart`'s reason), and only the latest record's dot is `colors.done`. "New" marks a record set in the last `NEW_RECORD_DAYS` (14) days. The Edit button in the mock is not built: there is no exercise editor yet.

**Plates.** `plateLoad` searches in hundredths of the unit shown, so a 135 lb target on 45 lb plates is exact (kilograms would miss by a few thousandths); the count of a plate is both sides together, a single plate of a size can't go on both. It returns the fewest plates that make the closest loadable weight, the lighter on a tie, and `exact: false` when that isn't the target, which the line says in words ("Closest load: 82.5 kg"). The line shows for barbell exercises only (`equipment === 'barbell'`), on the open set, from the exercise's own `barKg` else the inventory's heaviest bar. An inventory still equal to the metric default, read in pounds, is shown as the pound default (`effectivePlateInventory`): a pound lifter told "20 kg bar" would be told something false. `warmupRamp` (40, 60, 80 percent, rounded to loadable weights) is built and tested but nothing shows it yet: warm-up sets are still a count in the routine editor, and writing a ramp into a session is a proposal the person hasn't been offered.

**The finish summary** lists the records the workout set, per exercise, capped at three by notability (`summarizeRecords`: estimated 1RM, heaviest weight, best set, rep counts low to high, volume), each with what it beat ("was 80 kg").

**Mood on training days** (`trainingDayMoodContrast`) counts only the app's own finished sessions: a day with no Health workout is ambiguous (nothing recorded and a refused read are one answer), so Health's are never read. A rest day is a day with a mood logged **on or after the first logged workout**: before it the person wasn't using the workout log, and every day would read as a rest day. Both mood-log gates apply (`MIN_PAIRED_DAYS` counted from the first workout, `MIN_CONTRAST_DAYS` each side), a day with no mood is neither side, and the caption says it doesn't show cause and effect.

**Not built in phase 3:** warm-up ramp suggestions in the UI (above), an exercise editor, a session detail page behind a history row, and plates for equipment other than a barbell (EZ and trap bars are plate-loaded too, and are left out because the brief named barbells).

## Phase 7, as built

Files: `src/utils/workoutCsv.ts` (pure), `importSessions` in `useWorkoutStore`, `WorkoutImportSheet.tsx`, and the Workouts screen's "…" menu. It reuses `pickBackupFile` (the document picker) and `CsvExportSheet` with `writeExportFile`/`shareCsvFile` (the mood and food log exports). No native dependency and no network call. Nothing was added to the MCP server: the file is on the person's phone, and the sessions an import adds are read through the existing workout tools.

- **Headers, never positions.** Strong has four layouts and Hevy one, and a header is matched case-insensitively with punctuation ignored (`Weight (kg)`, `weight_kg`), an optional column that is missing reads as empty and an extra one is ignored. Strong S1 (iOS, comma, 12 columns, no unit column anywhere), S2 (Android, semicolon, `Weight Unit` of `lbs` or blank for kg, `Distance Unit` of `mi.` or `km`, text quoted with the inner quotes **not** doubled, a `Workout Duration`), S3 (semicolon, every cell quoted, units in the headers: `Duration (sec)`, `Weight (kg)`, `Distance (meters)`) and S4 (S2 without RPE or a workout duration). Hevy is `title, start_time, end_time, description, exercise_title, superset_id, exercise_notes, set_index, set_type, weight_kg|weight_lbs, reps, distance_km|distance_miles, duration_seconds, rpe`. A comma decimal (`82,5`) is read only in a semicolon file; in a comma file a comma inside a number is a thousands separator. The CSV reader is lenient about a quote that isn't followed by a delimiter or line end inside a quoted field, because S2 doesn't double them.
- **Kilograms at the edge.** Pounds and miles are converted while reading, so nothing past `parseWorkoutCsv` knows the file's unit. A file with weights and no unit anywhere (S1) is read in the person's own unit and says so (`unitAssumed`); the review sheet then asks, and re-reads on the answer. S1's distance has no unit either, so it follows that answer (kilograms means kilometers, pounds means miles), and a file with a distance and no weight asks too. A unit's trailing period is stripped (`mi.`).
- **Dates are local wall-clock times, built from their parts.** Neither app writes a zone. Strong is `yyyy-MM-dd HH:mm:ss`, or a 12-hour `2025-01-30 12:34:56 pm` (the space before am/pm may be a no-break or narrow no-break space, any case). Hevy is day first (`26 Feb 2024, 08:00`, zero-padded or not) or month first and 12-hour (`Oct 1, 2026, 8:28 PM`). A value that carries `Z` or an offset is honored as that instant. An unknown or impossible date (`3/4/2024`, Feb 31, 25:00) is a skipped row, never a guess; a time inside a DST gap is accepted and lands on the shifted instant, since the person really wrote it.
- **Set markers.** Strong's `W`, `D` and `F` and Hevy's `warmup`, `dropset` and `failure` map to warm-up, drop and amrap (to failure). A rest-timer row, and a set with no weight, reps, time or distance, are skipped. A Strong `Note` row is an exercise note: the model keeps notes on sets, so its text goes on that exercise's first set in the workout (ahead of the set's own note) and the row is not a set. The sheet counts and names every reason a row was left out (`describeSkipped`): rest timers, empty sets, unreadable dates, rows with no exercise, and notes with nothing to attach to. A weight of 0 is no load, not a weight of zero. Hevy's sets are ordered by `set_index`; Strong's by the rows.
- **Idempotent with no new column.** An imported session's id is a hash of the source and the file's own date text (`importSessionId`), not the instant it computes to and not the title, so the same file read in another time zone, or re-exported after a rename, names the same ids. A session already in the log is skipped too when it started at the same time (`ExistingIndex`), whatever it is called: to the second, or to the minute for Hevy, which writes no seconds. That is what keeps the app's own export from doubling every workout, since the export truncates to whole seconds while a session keeps its milliseconds. The store checks again when it writes, so a plan made before a sync landed can't double a workout.
- **Only an exact name or the same words in any order is decided by the app** (`matchExerciseName`): the exact name key (archived exercises included, since a custom name is unique even archived), then the same words with the equipment in brackets counted as words ("Bench Press (Barbell)" is "Barbell bench press"). Everything fuzzier is a `suggest`, never an auto-match: a name one letter out once its words are joined ("Back Squat" against "Hack squat") or sharing most of its words ("Decline Bench Press (Smith Machine)" against "Smith machine bench press") is usually a different exercise, and the answer is about to become history. Nothing is remembered between imports: only what the person confirms on the sheet is written, and the matching is the same each time.
- **The review sheet shows every name, not only the unmatched ones.** The auto-matched names are listed with a Change button. A name with only a suggestion sits under "Needs a choice" with its closest match shown and a "Use this" button (and "Use all suggestions" for several), so confirming is one tap; the suggestion is not applied until it is tapped. Unmatched names each need a choice (Match opens `ExercisePickerSheet`, Create, Skip) before Import enables, with Create all and Skip all for a long list. Only workouts not already in the log count toward the names that need a decision. A created exercise takes the file's own spelling, the kind its sets imply (`inferExerciseKind`) and the equipment its words name (`guessEquipment`), with no muscles; it is editable like any custom exercise.
- **One transaction.** `importSessions` writes the custom exercises, sessions and sets in one `dbTransaction`, then updates state. The exercise picker is rendered inside the sheet's own Modal (two sibling sheets can't both present), and Cancel and the swipe-down go through `confirmDiscard` once any choice is staged.
- **Demo mode.** The import is not gated: it writes to the demo database like any other change there and goes with it. It touches nothing outside SQLite.
- **Export** (`workoutExportCsv`): finished workouts only, oldest first, one row per set done, in Strong's columns so the file opens as it is and `parseWorkoutCsv` reads it back. Weights are in the unit shown with the unit in the header (`Weight (lb)`), distance is meters, and Set Order counts non-warm-up sets from 1 with W, D or F in place of a number. Nothing is derived (no volume, no estimated 1RM). The range picker is `CsvExportSheet`.

## Phases

Each phase ships its own demo seed, patch note, MCP slice and regenerated docs.

| Phase | What | Suggested model, effort | Issue |
|---|---|---|---|
| 0 | This doc, plus HTML mocks of workout mode, exercise detail and the routine editor in both themes | sonnet, low | the PR that added this file |
| 1 | Data foundation: types, 5 tables, sync, backup, natural keys, store, exercise library, units and plate settings, Feature-areas switch, nav entry, demo seed. A bare Workouts screen | opus, high | #3851 |
| 2 | Logging: routine editor, workout mode, rest timer (step-timer generalisation), finish → completes the linked task, `Task.workoutRoutineId` with template parity. Built | opus, xhigh | #3852 |
| 3 | Analysis: PRs, estimated 1RM, plate math, exercise detail charts, Stats section, mood contrast. Built | sonnet, high | #3853 |
| 4 | Programs: multi-week programs, rotation, the four progression schemes, deload proposals, built-in program library | opus, high | #3854 |
| 5 | Health: HKWorkout write with retraction, read workouts from other apps (native; expect build cycles) | opus, high | #3855 |
| 6 | Live Activity kind and Siri intents (native) | sonnet, high | #3856 |
| 7 | Strong/Hevy CSV import and CSV export. Built | sonnet, medium | #3857 |
| 8 | Watch W1: logging over WatchConnectivity (native) | opus, xhigh | #3858 |
| 9 | Watch W2: `HKWorkoutSession`, heart rate, energy (native, needs a Health review first) | opus, xhigh | #3859 |

Phases 1 to 4 and 7 are JS-only and verifiable in the sandbox with tests. Phases 5, 6, 8 and 9 compile only on EAS, so each signature should be checked against Apple's JSON docs before it is written, and each phase should be expected to cost more than one build.

## Risks and open questions

- **A rest that ends in quiet hours makes no sound with the app closed.** That is the decision above. If it bites at a 6 AM session, the fix is to make the setting per subject, not to flip the default.
- **Heart rate is a new kind of read.** `health-data.md` has so far turned away resting heart rate and HRV. Heart rate during a session the person started is a narrower claim, but phase 9 owes that doc a section saying why it's different before any code.
- **Live Activity churn.** Restarting the activity on every set may flicker or hit the system's update budget. This is the first kind that might need `ContentState`.
- **Watch-first sessions.** Putting the routine and the suggested loads on the watch so you can train without the phone is the hardest part of W1. A phone-tethered W1 is much smaller.
- **Exercise library source.** Writing roughly 250 entries in-house is the safe option. An open dataset (free-exercise-db is the obvious candidate) needs its licence checked before any of it ships.
- **Size.** About 25 sets per session at 4 sessions a week is roughly 5,000 rows a year. That's fine for SQLite, but PR and volume rollups should be memoized and benchmarked in `src/__bench__` like the Today selectors.
- **Retention.** `purgeOldCompletedTasks` can delete the task a session completed. `taskId` is a resolve-or-shrug pointer, and sessions are never purged by the task retention window.
- **Footprint.** The medication area alone appears in 66 files. Expect this area to touch around 70 existing files and add around 50. Most of that is registration the schema, MCP and parity tests demand, so it fails loudly rather than silently, except the reload list, the demo seed, the MCP instructions and the docs, which nothing checks.
