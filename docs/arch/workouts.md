# Workouts: a full strength-training tracker

**Status: phase 1 built (the data foundation), the rest planned.** The five tables, their sync and backup registration, the exercise library and catalog, `useWorkoutStore`, the settings and a bare Workouts screen exist; logging, analysis, programs and everything native are still the plan below. The Workouts switch exists (`workoutsEnabled`, off by default) but has no row in Settings yet: phase 2 adds the row together with logging, so nobody finds a switch that opens an area with nothing to do in it. Demo mode turns it on. This file records the plan and the decisions already made. The three main surfaces are mocked in `workouts-mocks/`: HTML at 390pt using the real theme tokens, in light and dark. They are a proxy for layout and hierarchy, not a render of the app.

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
- **Task link**: a new `Task.workoutRoutineId` or `Task.workoutProgramId` field, like `medicationName`. It triggers `templateItemParity`, `taskDraftFieldCoverage` and the MCP `taskFieldCoverage` tests, which is intended: a template can seed "Push day, Mon/Thu".
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
- `workoutProgression.ts`: given the history for an exercise and its rule, propose the next session's targets:
  - **double:** hit the top of the rep range on every working set, then add an increment;
  - **linear:** add an increment after a success, and after N failures propose a 10% deload;
  - **percent:** sets taken from a training max, and the training max is bumped at the end of a cycle;
  - **rpe:** adjust the load from the last top set's RPE.

  It returns a proposal plus its reason ("Last time 3x10 at 60 kg, so try 62.5"), and it rounds to loads you can make with your plates.
- `plateMath.ts`: load, bar and plate inventory give the plates per side. It also builds warm-up ramps.
- `workoutRecords.ts`: PR detection and estimated 1RM (Epley, only from sets of 10 reps or fewer, always labelled "estimated"). Best set, rep PRs at each rep count, and volume per session, exercise and muscle per week. Memoized per set array, the way `openTasksOf` is cached.
- `workoutSession.ts`: the live session's cursor rules (current exercise and set, superset alternation, "copy last set", what finishing writes). It is shaped like `cookMode.ts` and `focusPlan.ts`.
- `workoutCsv.ts`: imports Strong and Hevy CSV exports and exports a CSV of your own. Exercise names are matched like `ingredientCatalogMatch.ts`, with a review sheet for anything unmatched.

### Store

`src/store/useWorkoutStore.ts` (built in phase 1, without the task link):
- it holds exercises, routines, programs and sessions, with sets loaded per session or exercise on demand;
- its actions are `startSession`, `logSet`, `editSet`, `deleteSet`, `reorderExercises`, `finishSession`, `discardSession`, plus CRUD for routines, programs and custom exercises;
- `finishSession` completes the linked task through `completeTask`, never the reverse. Ticking the task off without a session does not invent a session. (Phase 2: the task link and its completion come with `Task.workoutRoutineId`.)
- a custom exercise is never removed, only archived, because sets logged on another device never arrive over iCloud and can't be counted from here; an archived custom exercise keeps its name (the database's unique `name_key`); deleting a built-in's row puts the library's back. Deleting a session deletes its sets in the same transaction.

### Rest timer

- **Mechanism.** Generalise the step timers rather than building a fourth timer. They are the only timers that run to the second, have +1 min and restart, ring through quiet hours via AlarmKit and survive backgrounding. Today `StepTimer` is tied to recipes (`recipeId`, `stepId`), so it becomes a subject union, `{ kind: 'recipe', recipeId, stepId } | { kind: 'rest', sessionId, exerciseId }`. The store, alarm and Live Activity plumbing are reused.
- **Behaviour.** Logging a set starts the rest for that exercise automatically. When the rest ends it chimes and counts up, and the cursor stays put.
- **Quiet hours.** The subject decides whether quiet hours apply: `rest` respects them and `recipe` keeps ringing through. One store with two policies, not two stores.

### UI (each piece mocked before it is built)

**Screens:**
- **Workouts**: history list, calendar dots on the month grid, and a "Start" for the next routine in the active program.
- **Exercise detail**: estimated 1RM and best-set line chart (the `WeightChart` shape), volume bars, PR table and history.
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

## Phases

Each phase ships its own demo seed, patch note, MCP slice and regenerated docs.

| Phase | What | Suggested model, effort | Issue |
|---|---|---|---|
| 0 | This doc, plus HTML mocks of workout mode, exercise detail and the routine editor in both themes | sonnet, low | the PR that added this file |
| 1 | Data foundation: types, 5 tables, sync, backup, natural keys, store, exercise library, units and plate settings, Feature-areas switch, nav entry, demo seed. A bare Workouts screen | opus, high | #3851 |
| 2 | Logging: routine editor, workout mode, rest timer (step-timer generalisation), finish → completes the linked task, `Task.workoutRoutineId` with template parity | opus, xhigh | #3852 |
| 3 | Analysis: PRs, estimated 1RM, plate math, exercise detail charts, Stats section, mood contrast | sonnet, high | #3853 |
| 4 | Programs: multi-week programs, rotation, the four progression schemes, deload proposals, built-in program library | opus, high | #3854 |
| 5 | Health: HKWorkout write with retraction, read workouts from other apps (native; expect build cycles) | opus, high | #3855 |
| 6 | Live Activity kind and Siri intents (native) | sonnet, high | #3856 |
| 7 | Strong/Hevy CSV import and CSV export | sonnet, medium | #3857 |
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
