# Workouts: how it was built

Moved out of `docs/arch/workouts.md`, which holds the decisions and is the one to read before changing
anything. This is the plan the feature was built from and its status as each phase landed, kept for the
record. Nothing here is a rule a change has to follow; where a phase decided something, the decision is
in that file under "Phase N, as built".

## Status as of phase 9

**Status: phases 1 to 9 built (the data foundation, logging, analysis, programs and progression, Apple Health, the Live Activity and Siri, CSV import and export, logging on the Apple Watch, and the watch's HealthKit session with heart rate).** Phase 1 is the five tables, their sync and backup registration, the exercise library and catalog, `useWorkoutStore` and the settings. Phase 2 is the routine editor, workout mode with its rest timer, the task link (`Task.workoutRoutineId`), the Workouts switch in Settings › Feature areas, the unit and default rest under Settings › Workouts, and the MCP writes; "Phase 2, as built" below records what it decided. Phase 3 is the records, the plate math, the exercise page, the Stats section and the mood contrast; "Phase 3, as built" records what it decided. Phase 4 is programs, the four progression schemes, the warm-up ramp, the exercise editor and the program library; "Phase 4, as built" records what it decided. Phase 5 is the Health bridge's workout write, retraction and read ("Phase 5, native half") and the wiring that calls them: the write on Save, retraction, the pending write for an agent's workout, and other apps' workouts in the history ("Phase 5, as built"). Phase 6 is the workout's Live Activity and the two Siri intents ("Phase 6, as built"). Phase 8 is logging on the Apple Watch, into the workout going on the phone or on the watch alone ("Phase 8, as built"). Phase 9 is the watch's HealthKit session: heart rate and energy measured on the watch, the workout saved to Health from there, and the heart-rate card on the workout page ("Phase 9, as built"). This file records the plan and the decisions already made. The three main surfaces are mocked in `workouts-mocks/`: HTML at 390pt using the real theme tokens, in light and dark. They are a proxy for layout and hierarchy, not a render of the app.

## The Apple Watch plan


**Phase W1, logging without HealthKit:**
- a Workout page in the existing watch app with the current exercise, the target set, and weight and reps on the Digital Crown with Done Set;
- the live session reaches the watch in the existing `WATCH_CAPS` snapshot;
- sets come back as a new tap kind `set` on the quiet-tap queue, deduped by a set id generated on the watch;
- a watch-first session (phone in the locker) needs the routine on the watch, and that is the hard part.

**Phase W2, `HKWorkoutSession` on the watch (built in phase 9):** heart rate, measured energy, the app staying in front on the wrist, and the workout ring. It needed the HealthKit entitlement on the watch target, new share and read types, and its own review under `health-data.md` ("Heart rate during a workout"), which keeps HRV ruled out (resting heart rate was let in later for a display-only list on the Blood pressure screen).

## Phases

Each phase ships its own demo seed, patch note, MCP slice and regenerated docs.

| Phase | What | Suggested model, effort | Issue |
|---|---|---|---|
| 0 | This doc, plus HTML mocks of workout mode, exercise detail and the routine editor in both themes | sonnet, low | the PR that added this file |
| 1 | Data foundation: types, 5 tables, sync, backup, natural keys, store, exercise library, units and plate settings, Feature-areas switch, nav entry, demo seed. A bare Workouts screen | opus, high | #3851 |
| 2 | Logging: routine editor, workout mode, rest timer (step-timer generalisation), finish → completes the linked task, `Task.workoutRoutineId` with template parity. Built | opus, xhigh | #3852 |
| 3 | Analysis: PRs, estimated 1RM, plate math, exercise detail charts, Stats section, mood contrast. Built | sonnet, high | #3853 |
| 4 | Programs: multi-week programs, rotation, the four progression schemes, deload proposals, built-in program library. Built | opus, high | #3854 |
| 5 | Health: HKWorkout write with retraction, read workouts from other apps (native; expect build cycles). Built | opus, high | #3855 |
| 6 | Live Activity kind and Siri intents (native). Built | sonnet, high | #3856 |
| 7 | Strong/Hevy CSV import and CSV export. Built | sonnet, medium | #3857 |
| 8 | Watch W1: logging over WatchConnectivity, into the phone's workout or on the watch alone (native). Built | opus, xhigh | #3858 |
| 9 | Watch W2: `HKWorkoutSession`, heart rate, energy, heart-rate zones on the workout page (native, after a Health review). Built | opus, xhigh | #3859 |
