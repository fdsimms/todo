import { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { resetToKitchen, resetToMood, resetToToday, resetToWorkouts } from '../navigation/navigationRef';
import { buildWidgetSnapshot, WATCH_CAPS, type SnapshotInput, type WidgetSnapshot } from './widgetSnapshot';
import { completedOnDay } from './allClear';
import { dayKeyOf, dayKeyToDate, getDayStart, getLogicalDayKey } from './dateUtils';
import { beginVisibleAtPass, getVisibleAt, sunLocationOn } from './visibilityUtils';
import { buildWidgetCalendar, type WidgetCalendar } from './widgetCalendar';
import { buildDayBuckets, dayDetail, dayRows } from './calendarMonth';
import { parseQuietTaps, planQuietTaps, quietDeferUpdates, tapsToRequeue, workoutHandOffTaps, type QuietTap, type QuietTapWorkouts } from './widgetQuietTaps';
import type { Task } from '../types';
import { addDays } from 'date-fns/addDays';
import { useCalendarStore } from '../store/useCalendarStore';
import { useHiddenEventsStore } from '../store/useHiddenEventsStore';
import { hiddenEventKey } from './hiddenEvents';
import type { BusyEvent } from './calendarBusy';
import { kitchenInventory } from './kitchenInventory';
import { listedAnywhere } from './groceryLists';
import { buildPantryIndex, parseQueuedDisposals, planQueuedDisposals } from './pantryIndex';
import { widgetBridge } from './widgetBridge';
import { useMedicationStore } from '../store/useMedicationStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { foodLogTotals } from './foodLog';
import { buildMedicationIndex, parseQueuedDoses, resolveQueuedDoseName } from './medicationIndex';
import { repeatDose } from './medicationLog';
import { defaultUsualDose, prefsFor } from './medicationSettings';
import { recordDose } from './doseRecording';
import { haptics } from './haptics';
import { parseQueuedDreams } from './dreamQueue';
import { parseQueuedFoods } from './foodQueue';
import { parseShortcutActions } from './shortcutQueue';
import { useMoodStore } from '../store/useMoodStore';
import { addWaterAt } from './searchActionRun';
import { glassMl } from './searchActions';
import { openScreenByName } from '../navigation/openScreen';
import { usePendingEstimateStore } from '../store/usePendingEstimateStore';
import { keyCodeToken, parseQueuedKeyScans } from './keyScanQueue';
import { alertKeyScanResult } from './keyScanAlert';
import { applyKeyScan } from './releaseBlocks';
import type { KeyScanResult } from '../store/useNfcKeyStore';
import { useJournalStore } from '../store/useJournalStore';
import { isProjectLocked } from '../store/useProjectLockStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { buildRoutineIndex, parseQueuedWorkoutStarts, resolveQueuedWorkoutStart } from './workoutSiri';
import { startWorkout } from './startWorkout';
import { requestDismissAllSheets } from './sheetModal';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useWatchHealthStore } from '../store/useWatchHealthStore';
import { watchWorkoutTapTiming } from './watchHealthWorkout';
import { workoutHealthWriteOn } from './healthWorkoutSync';
import { weightScale } from './dumbbellLoad';
import { catalogExercise } from './exerciseCatalog';
import { WATCH_RECENT_DAYS, buildWatchWorkout, todaysWatchWorkout, type WatchWorkoutSnapshot } from './watchWorkout';
import { tickSet } from './workoutTick';
import { applyProposal } from './workoutProposalApply';
import { REST_NUDGE_FORWARD_SECONDS } from './stepTimers';
import type { PlannedRoutineSet } from '../store/useWorkoutStore';
import type { RestTimer, WorkoutSet } from '../types';

const DEBOUNCE_MS = 300;

// Through widgetBridge(), which answers not-iOS, demo mode and a build with no
// native half in one call. The demo gate is checked here rather than in the
// debounce below on purpose: it's the latest possible moment, so a write
// scheduled a moment before demo mode was entered still doesn't land.
function writeToNativeBridge(jsonString: string): void {
  const bridge = widgetBridge();
  if (!bridge) return;
  // Fire-and-forget: nothing here needs to block on the native write
  // completing. Swallowing a rejection here is intentional — a failed
  // widget refresh should never surface anywhere in the app UI.
  bridge.writeWidgetSnapshot(jsonString).catch(() => {});
}

// Hands off task completions queued by the widget's checkbox
// (CompleteTaskIntent, in modules/todo-widget-bridge — it compiles into the
// app target as well as the widget's, which is what lets it bring the app
// forward at all) to TodayScreen via useWidgetCompletionStore,
// which plays the same complete animation a normal in-app tap gets before
// actually calling completeTask() (see TaskItem's autoComplete prop) — the
// widget can only optimistically mark a task checked; it has no access to the
// JS logic for recurrence, streaks, or chains, so the real completion only
// happens once the app is foregrounded. Tapping the checkbox now opens the
// app (CompleteTaskIntent.openAppWhenRun), so this also jumps to Today so the
// animation is actually visible.
async function processPendingWidgetCompletions(): Promise<void> {
  // widgetBridge() is null in demo mode, and a *drain* is the half of this
  // that would actually lose something: the queue holds real taps made on the
  // real widget, and consuming them into the throwaway demo database completes
  // ids that aren't in it. The tap would silently do nothing, with nothing left
  // to retry from. Skipped, the queue keeps them for the next foreground after
  // the demo ends.
  const bridge = widgetBridge();
  if (!bridge) return;
  // Its own try: a binary predating the times file throws here, and that must
  // not also cost the ids. They then just complete as of now, as they used to.
  let tappedAt: Record<string, string> = {};
  try {
    tappedAt = await bridge.drainPendingWidgetCompletionTimes();
  } catch {
    // A build predating drainPendingCompletionTimes.
  }
  try {
    const ids = await bridge.drainPendingWidgetCompletions();
    if (ids.length === 0) return;
    useWidgetCompletionStore.getState().enqueue(ids, tappedAt);
    resetToToday();
  } catch {
    // A build predating drainPendingCompletions — no-op.
  }
}

// Hands off task titles queued by AddTaskIntent (the Action Button / Siri /
// Shortcuts entry point — see modules/todo-widget-bridge/ios/AddTaskIntent.swift)
// to the real addTask(), the same drain-on-launch/foreground shape
// processPendingWidgetCompletions uses above and for the same reason: the
// intent runs before the RN JS environment is guaranteed to be up, so it can
// only stash the dictated title. Deliberately silent on arrival — no
// navigation — mirroring handleIncomingUrl's "silent capture" for
// `dundundun://add?title=…` in deepLinks.ts, which this is the hardware-
// button equivalent of.
async function processPendingAddTasks(): Promise<void> {
  // Same demo-mode reasoning as processPendingWidgetCompletions: a drain is
  // the half that would lose something, so a dictated title queued while demo
  // mode is on just waits for the next real foreground instead.
  const bridge = widgetBridge();
  if (!bridge) return;
  try {
    const titles = await bridge.drainPendingAddTasks();
    if (titles.length === 0) return;
    const { addTask } = useTaskStore.getState();
    for (const title of titles) addTask({ title });
    haptics.success();
  } catch {
    // A build predating drainPendingAddTasks — no-op.
  }
}

// Applies what MarkDisposedIntent queued — "mark bananas as used up", said to
// Siri. Same drain-on-launch/foreground shape as the two above, and the same
// demo-mode reasoning: a drain is the half that would lose something, so a
// sentence said while demo mode is on waits for the next real foreground.
//
// **The pair of store calls is the in-app flow composed, not a shortcut around
// it.** Marking a row out and saying how it went are two steps in the app too:
// the ✕ on a pantry row calls `markOutOfMany` with no outcome, and the banner
// it raises is what calls `recordDisposal`. Running them in that order here
// gets the box's cleared expiry/frozen/opened stamps, the dropped "Use up X"
// task and the undo entry from the first, and the counter, the spoiled stamp
// and the shelf-life offer from the second — with `markOutOfMany`'s undo
// snapshot taken ahead of both, so one undo still restores the row whole.
//
// Which rows get the pair, and which are skipped (a name with no row, a row
// already out of it, a row said twice), is `planQueuedDisposals`' decision,
// read against the catalog once before anything is written.
async function processPendingDisposals(): Promise<void> {
  const bridge = widgetBridge();
  if (!bridge) return;
  try {
    const queued = parseQueuedDisposals(await bridge.drainPendingDisposals());
    const { items, markOutOfMany, recordDisposal } = useGroceryStore.getState();
    const plan = planQueuedDisposals(queued, items);
    if (plan.length === 0) return;
    for (const { itemId, outcome } of plan) {
      markOutOfMany([itemId], undefined);
      recordDisposal(itemId, outcome);
    }
    haptics.success();
    // Silent otherwise, mirroring processPendingAddTasks: the row is already
    // correct and there is nothing to look at. The exception is the shelf-life
    // offer, which `recordDisposal` raises for a repeatedly-wasted item and
    // which only `KitchenScreen` and `GroceryItemSheet` mount — left where the
    // app happened to be, it would be a question asked into an empty room.
    if (useGroceryStore.getState().disposalOffer) resetToKitchen();
  } catch {
    // A build predating drainPendingDisposals — no-op.
  }
}

// Records what LogMedicationIntent queued ("log ibuprofen", said to Siri).
// The same drain shape and demo-mode reasoning as processPendingDisposals.
// Each dose repeats the last one recorded for that medication, the way the
// Medications screen's quick button does, at the moment Siri was asked, and
// goes through `recordDose` so the "OK again" notification moves and a supply
// that just ran low offers a refill. No limit question: the person already
// asked for it, and asking again after the fact can't un-take a dose.
async function processPendingDoses(): Promise<void> {
  const bridge = widgetBridge();
  // Optional on the bridge: a binary built before the intent has no drain.
  if (!bridge?.drainPendingDoses) return;
  try {
    const queued = parseQueuedDoses(await bridge.drainPendingDoses());
    if (queued.length === 0) return;
    for (const dose of queued) {
      const { logs, registered, settings } = useMedicationStore.getState();
      const name = resolveQueuedDoseName(dose, logs, registered);
      recordDose({ ...repeatDose(logs, name, defaultUsualDose(prefsFor(settings, name))), at: dose.at ?? undefined });
    }
    haptics.success();
  } catch {
    // A build predating drainPendingDoses — no-op.
  }
}

// Dreams and journal entries said to Siri or the Action Button (LogDreamIntent,
// LogJournalIntent): written into the log each one names, filed under the day
// they were said. Silent on arrival, like the task capture: no navigation, so
// the journal lock stays closed. Saying one also makes today's reminder for that
// log read ready, as saving it in the sheet does; the tick stays the person's. Written through the store's own
// addEntry, which refuses blank text, so a malformed record costs nothing.
async function processPendingDreams(): Promise<void> {
  const bridge = widgetBridge();
  // Optional on the bridge: a binary built before the intent has no drain.
  if (!bridge?.drainPendingDreams) return;
  try {
    const queued = parseQueuedDreams(await bridge.drainPendingDreams());
    if (queued.length === 0) return;
    const journal = useJournalStore.getState();
    // The store loads with the task store at startup; a drain that beats it
    // would otherwise sort the new row into an empty list.
    if (!journal.initialized) journal.initialize();
    for (const dream of queued) {
      useJournalStore.getState().addEntry(dream.kind, dream.text, dream.at ?? undefined);
    }
    haptics.success();
  } catch {
    // A build predating drainPendingDreams — no-op.
  }
}

// Meals said to Siri or the Action Button (LogFoodIntent): handed to the offline
// meal queue, which estimates each one and leaves it on the Food log screen for
// a person to confirm. Nothing is logged here, since a figure the app made up
// and stored unconfirmed is what that queue exists to prevent
// (`utils/estimateQueue.ts`). The moment Siri was asked travels with the meal, so
// confirming at bedtime still files it under the lunch it was. Silent on
// arrival except when the queue is full, because a meal dropped with nothing
// said is the one outcome an input may not have.
async function processPendingFoods(): Promise<void> {
  const bridge = widgetBridge();
  // Optional on the bridge: a binary built before the intent has no drain.
  if (!bridge?.drainPendingFoods) return;
  try {
    const queued = parseQueuedFoods(await bridge.drainPendingFoods());
    if (queued.length === 0) return;
    const store = usePendingEstimateStore.getState();
    // Loaded with the task store at startup; a drain that beats it would
    // otherwise sort the new row into an empty list.
    if (!store.initialized) store.initialize();
    let dropped = 0;
    for (const food of queued) {
      const result = usePendingEstimateStore.getState().enqueue({
        description: food.text,
        slot: null,
        at: food.at ?? new Date(),
        context: [],
      });
      if (result === 'full') dropped += 1;
    }
    if (dropped > 0) {
      Alert.alert(
        "Couldn’t save the meal",
        'The list of meals waiting to be logged is full. Log or remove one on the Food log screen, then say it again.',
      );
    } else {
      haptics.success();
    }
    // Estimate now if there is a connection; a failure that waiting can fix
    // leaves the meal waiting for "Try now" on the Food log screen.
    void usePendingEstimateStore.getState().drain();
  } catch {
    // A build predating drainPendingFoods — no-op.
  }
}

// Log Water, Log Mood, Add to Grocery List and Open Screen, from the Shortcuts
// app or Siri (ShortcutActionIntents.swift). Each writes through the path its
// own screen uses: water onto the day's one row (the stepper's), a mood
// through the store's addLog, an item through addByName. Water and a mood file
// under the moment they were asked. A mood with no level opens the mood log to
// pick one, and Open Screen goes to the last screen asked for, through the same
// reachability check a link gets.
async function processPendingShortcutActions(): Promise<void> {
  const bridge = widgetBridge();
  // Optional on the bridge: a binary built before the intents has no drain.
  if (!bridge?.drainPendingShortcutActions) return;
  try {
    const queued = parseShortcutActions(await bridge.drainPendingShortcutActions());
    if (queued.length === 0) return;
    let wrote = false;
    let openMoodLog = false;
    let screen: string | null = null;
    for (const action of queued) {
      switch (action.kind) {
        case 'water': {
          const foodLog = useFoodLogStore.getState();
          if (!foodLog.initialized) foodLog.initialize();
          addWaterAt(action.glasses * glassMl(useSettingsStore.getState().waterUnit), action.at ?? new Date());
          wrote = true;
          break;
        }
        case 'mood': {
          if (action.mood === null) { openMoodLog = true; break; }
          const mood = useMoodStore.getState();
          if (!mood.initialized) mood.initialize();
          if (useMoodStore.getState().addLog(action.mood, [], null, action.at ?? undefined)) wrote = true;
          break;
        }
        case 'grocery': {
          // Named rather than left to the default, per the rule for a caller
          // that isn't a person on the grocery screen: the list the screen has
          // open, which a trip switches to its away list.
          const grocery = useGroceryStore.getState();
          grocery.addByName(action.item, undefined, undefined, { registerUndo: false, listId: grocery.activeListId });
          wrote = true;
          break;
        }
        case 'open':
          screen = action.screen;
          break;
      }
    }
    if (wrote) haptics.success();
    if (openMoodLog) resetToMood(true);
    else if (screen) openScreenByName(screen);
  } catch {
    // A build predating drainPendingShortcutActions — no-op.
  }
}

// Key codes run from Shortcuts (ToggleKeyLockIntent), the route for a plain NFC
// tag. Each goes through `applyKeyScan('link', …)`, the call a tapped link tag
// makes, so a code is matched against the enrolled link keys and nothing else
// decides anything here: an unknown or malformed code gets the same single
// "not recognized". The result is spoken once, for the last code, since the
// person ran one action and a queue of several only means the app was closed
// for a while. Like every drain it waits for a real foreground in demo mode,
// and `widgetBridge()` is what returns null there.
async function processPendingKeyScans(): Promise<void> {
  const bridge = widgetBridge();
  // Optional on the bridge: a binary built before the intent has no drain.
  if (!bridge?.drainPendingKeyScans) return;
  try {
    const queued = parseQueuedKeyScans(await bridge.drainPendingKeyScans());
    if (queued.length === 0) return;
    let last: KeyScanResult | null = null;
    for (const scan of queued) {
      last = applyKeyScan('link', keyCodeToken(scan.code));
    }
    if (last) {
      alertKeyScanResult(last, {
        title: 'Key code not recognized',
        message: 'This code isn’t one of your key tags. Copy it again from the key’s row on the Screen Time screen.',
      });
    }
  } catch {
    // A build predating drainPendingKeyScans — no-op.
  }
}

// "Start my workout" and "Start Push A" (StartWorkoutIntent and
// StartRoutineIntent). The same drain shape and demo-mode reasoning as the
// others: widgetBridge() is null in demo mode, so a start said then waits for
// the next real foreground rather than starting a workout in the throwaway
// database. Only the newest entry acts (`resolveQueuedWorkoutStart`): several
// queued starts must not start several workouts.
//
// Unlike the silent captures above, this one lands somewhere: the person asked
// to start a workout and the app came forward for it. So any sheet left open
// is asked to close first, the way an incoming link's destination is, or
// workout mode would wait behind it unseen.
async function processPendingWorkoutStarts(): Promise<void> {
  const bridge = widgetBridge();
  // Optional on the bridge: a binary built before the intents has no drain.
  if (!bridge?.drainPendingWorkoutStarts) return;
  // Read before draining: the drain deletes the file, so a store that hasn't
  // loaded yet would cost the start rather than delay it.
  if (!useWorkoutStore.getState().initialized) return;
  try {
    const queued = parseQueuedWorkoutStarts(await bridge.drainPendingWorkoutStarts());
    if (queued.length === 0) return;
    const workouts = useWorkoutStore.getState();
    const plan = resolveQueuedWorkoutStart(queued, {
      workoutsEnabled: useSettingsStore.getState().workoutsEnabled,
      live: workouts.liveSession(),
      routines: workouts.routines,
      programs: workouts.programs,
      currentProgramId: useSettingsStore.getState().currentProgramId,
      sessions: workouts.sessions,
      todayTasks: useTaskStore.getState().visibleTasks(),
      now: new Date(),
    });
    if (plan.kind === 'none') return;
    requestDismissAllSheets();
    if (plan.kind === 'showLive') useWorkoutModeStore.getState().show();
    else if (plan.kind === 'start') startWorkout(plan.input);
    else resetToWorkouts();
  } catch {
    // A build predating drainPendingWorkoutStarts — no-op.
  }
}

// The routines StartRoutineIntent can hear (workoutSiri.ts), on its own
// debounce for the medication index's reason. Empty while the Workouts area is
// off. Skipped before the store has loaded, since an empty file then reads as
// "you have no routines", and skipped when nothing changed, because each write
// also asks Siri to read the list again.
let routineIndexTimer: ReturnType<typeof setTimeout> | null = null;
let lastRoutineIndex: string | null = null;

function scheduleRoutineIndexWrite(): void {
  if (routineIndexTimer) clearTimeout(routineIndexTimer);
  routineIndexTimer = setTimeout(() => {
    const workouts = useWorkoutStore.getState();
    if (!workouts.initialized) return;
    const bridge = widgetBridge();
    if (!bridge?.writeWorkoutRoutineIndex) return;
    const json = JSON.stringify(buildRoutineIndex(workouts.routines, useSettingsStore.getState().workoutsEnabled));
    if (json === lastRoutineIndex) return;
    lastRoutineIndex = json;
    bridge.writeWorkoutRoutineIndex(json).catch(() => { lastRoutineIndex = null; });
  }, DEBOUNCE_MS);
}

// The medications LogMedicationIntent can hear (medicationIndex.ts). Its own
// debounce rather than riding the widget snapshot's: a dose changes nothing on
// a home screen, and the snapshot write reloads every widget timeline. Skipped
// before the store has loaded, for the reason the pantry index is: an empty
// file reads as "you take nothing" until the next dose.
let medicationIndexTimer: ReturnType<typeof setTimeout> | null = null;

// Written only when it changed, since each write also has Siri read the
// shortcuts' names again (see the routine index below); the first write of a
// launch always goes, so a name added under an older build is heard too.
let lastMedicationIndex: string | null = null;

function scheduleMedicationIndexWrite(): void {
  if (medicationIndexTimer) clearTimeout(medicationIndexTimer);
  medicationIndexTimer = setTimeout(() => {
    const meds = useMedicationStore.getState();
    if (!meds.initialized) return;
    const bridge = widgetBridge();
    if (!bridge?.writeMedicationIndex) return;
    const json = JSON.stringify(buildMedicationIndex(meds.logs, meds.archived, meds.registered));
    if (json === lastMedicationIndex) return;
    lastMedicationIndex = json;
    bridge.writeMedicationIndex(json).catch(() => { lastMedicationIndex = null; });
  }, DEBOUNCE_MS);
}

// Applies the taps the widget handled without opening the app (see
// widgetQuietTaps.ts for which those are and why). Silent, unlike the
// completion drain above: there is no animation to show and nothing to
// navigate to, because the person tapping it is already somewhere else.
//
// A tap that needs a person after all (the task gained a question since the
// snapshot was written) is handed to useWidgetCompletionStore, the opening
// intent's path, and Today runs it the next time a row for it mounts. It
// navigates nowhere: the app came forward for some other reason.
//
// Grocery ticks name their list, and are written to that list rather than to
// whichever one the app has open (CLAUDE.md, "A caller that isn't a person
// looking at the grocery screen passes listId explicitly").
//
// `handOff` is where a tap that needs the app goes. 'app' is the Today screen,
// through useWidgetCompletionStore, which is right with a person in front of
// it. 'requeue' is back onto the queue, for a drain run with nobody looking (a
// watch tap that woke the app in the background): that store lives in memory,
// and a process iOS ends before anyone opens the app would take the tap with
// it. See tapsToRequeue.
async function processQuietWidgetTaps(handOff: 'app' | 'requeue' = 'app'): Promise<void> {
  // Same demo-mode reasoning as the drains above: a drain consumes real taps.
  const bridge = widgetBridge();
  if (!bridge) return;
  try {
    const taps = parseQuietTaps(await bridge.drainQuietWidgetTaps());
    if (taps.length === 0) return;
    const { dayResetTime, mealLogPrompt } = useSettingsStore.getState();
    const todayKey = getLogicalDayKey(new Date(), dayResetTime);
    const plan = planQuietTaps(
      taps,
      useTaskStore.getState().tasks,
      useGroceryStore.getState().listEntries,
      mealLogPrompt,
      iso => getLogicalDayKey(new Date(iso), dayResetTime) === todayKey,
      quietTapWorkouts(),
      exerciseId => weightScale(catalogExercise(useWorkoutStore.getState().exercises, exerciseId), useSettingsStore.getState().dumbbellEntry),
    );
    // A cold launch woken by the watch has no React tree, so nothing has read
    // the step timers back yet: a rest started over an unread stack would be
    // written over every timer still counting down (a recipe's included).
    if (plan.some(a => a.type === 'tickWorkoutSet' || a.type === 'nudgeRest' || a.type === 'skipRest' || a.type === 'finishWorkout')) {
      useStepTimerStore.getState().hydrate();
    }
    const handedOver: Record<string, string> = {};
    // Health taps left for a drain in front (see 'watchHealthWorkout' below).
    const forFront: QuietTap[] = [];
    for (const action of plan) {
      switch (action.type) {
        case 'complete':
          useTaskStore.getState().completeTask(action.id, {
            completedAt: action.at,
            ...(action.deliverableValue !== undefined ? { deliverableValue: action.deliverableValue } : {}),
          });
          break;
        case 'logUnit':
          useTaskStore.getState().logQuotaUnit(action.id);
          break;
        case 'deferTask': {
          const task = useTaskStore.getState().tasks.find(t => t.id === action.id);
          if (task) {
            useTaskStore.getState().updateTask(action.id, quietDeferUpdates(task, dayResetTime), { markSeenOnBecomeVisible: true });
          }
          break;
        }
        case 'checkGrocery':
          useGroceryStore.getState().setCheckedMany([action.itemId], true, { listId: action.listId });
          break;
        case 'chooseOption': {
          // Ticking an option is how the app makes the choice (toggleChecked),
          // so this is the same pair, scoped to the list the tap was made on.
          const grocery = useGroceryStore.getState();
          grocery.setCheckedMany([action.itemId], true, { listId: action.listId });
          grocery.resolveChoice(action.itemId, { listId: action.listId });
          break;
        }
        case 'addGrocery':
          useGroceryStore.getState().addByName(action.title, undefined, undefined, { listId: action.listId });
          break;
        case 'handToApp':
          handedOver[action.id] = action.at;
          break;
        // The Apple Watch's workout (watchWorkout.ts). A set is ticked with
        // the numbers and at the moment it was done, through the same tickSet
        // workout mode and the Lock Screen use.
        case 'tickWorkoutSet':
          tickSet(action.sessionId, action.setId, new Date(action.at), action.values);
          break;
        case 'nudgeRest': {
          const rest = sessionRest(action.sessionId, action.restId);
          if (rest) useStepTimerStore.getState().addTime(rest.id, REST_NUDGE_FORWARD_SECONDS);
          break;
        }
        case 'skipRest': {
          const rest = sessionRest(action.sessionId, action.restId);
          if (rest) useStepTimerStore.getState().remove(rest.id);
          break;
        }
        case 'finishWorkout': {
          useWorkoutStore.getState().finishSession(action.sessionId, { endedAt: action.at, deferHealthWrite: handOff === 'requeue' });
          // WorkoutModeHost drops a finished workout's rest, but it is a
          // component, and this can run with no screen at all.
          useStepTimerStore.getState().removeRestsOutside(useWorkoutStore.getState().liveSession()?.id ?? null);
          break;
        }
        case 'addWatchSession':
          useWorkoutStore.getState().addWatchSession(action.workout, { deferHealthWrite: handOff === 'requeue' });
          break;
        // The watch's HealthKit session (phase 9): it is measuring a session,
        // it saved one's workout, or it retracted one the phone asked about.
        case 'watchMeasuring':
          useWorkoutStore.getState().markWatchMeasuring(action.sessionId, action.on);
          break;
        case 'watchHealthWorkout': {
          // One that needs the phone's own HealthKit (retracting the phone's
          // copy, or writing one at times the watch's no longer has) waits for
          // a drain in front, since a drain with nobody looking may well be
          // running locked (`watchWorkoutTapTiming`); everything else applies here.
          const row = useWorkoutStore.getState().sessions.find(x => x.id === action.sessionId);
          if (handOff === 'requeue' && watchWorkoutTapTiming(row, action.workoutId, action.span) === 'front') {
            forFront.push({
              kind: 'healthWorkout', id: action.sessionId, sessionId: action.sessionId, listId: null,
              at: new Date().toISOString(), healthWorkoutId: action.workoutId,
              ...(action.span ? { workoutStart: action.span.start, workoutEnd: action.span.end } : {}),
            });
            break;
          }
          useWorkoutStore.getState().recordWatchHealthWorkout(action.sessionId, action.workoutId, action.span);
          break;
        }
        case 'watchHealthRetracted':
          useWatchHealthStore.getState().retracted(action.workoutId);
          break;
        // What the watch adds to the phone's workout, each through the store
        // action workout mode itself uses, with the watch's ids where it made
        // some, so the watch settles what it drew by them.
        case 'noteWorkoutSet':
          useWorkoutStore.getState().noteExerciseOfSet(action.sessionId, action.setId, action.note);
          break;
        case 'addWorkoutSet':
          useWorkoutStore.getState().addPlannedSet(action.sessionId, action.exerciseId, { id: action.setId });
          break;
        case 'addWorkoutExercise':
          useWorkoutStore.getState().addSessionExercise(action.sessionId, action.exerciseId, { ids: action.setIds });
          break;
        case 'moveWorkoutExercise':
          useWorkoutStore.getState().moveSessionExercise(action.sessionId, action.exerciseId, action.direction);
          break;
        case 'supersetWorkoutExercise':
          if (action.partnerId) useWorkoutStore.getState().joinSessionSuperset(action.sessionId, action.exerciseId, action.partnerId);
          else useWorkoutStore.getState().leaveSessionSuperset(action.sessionId, action.exerciseId);
          break;
        case 'useWorkoutSuggestion':
          applyProposal(action.sessionId, action.exerciseId, {
            ...(action.warmupIdPrefix ? { warmupId: (i: number) => `${action.warmupIdPrefix}-w${i}` } : {}),
          });
          break;
      }
    }
    const ids = Object.keys(handedOver);
    if (ids.length > 0 || forFront.length > 0) {
      if (handOff === 'requeue') {
        const requeue = [...tapsToRequeue(taps, new Set(ids)), ...workoutHandOffTaps(plan), ...forFront];
        await bridge.requeueQuietTaps(JSON.stringify(requeue));
      } else {
        useWidgetCompletionStore.getState().enqueue(ids, handedOver);
      }
    }
  } catch {
    // A build predating drainQuietTaps — no-op.
  }
}

/**
 * The workouts a drain judges the watch's workout taps against
 * (`planQuietTaps`). Opens the workout store if nothing has: the taps it
 * would otherwise drop are deleted with the queue file.
 */
function quietTapWorkouts(): QuietTapWorkouts {
  let workouts = useWorkoutStore.getState();
  if (!workouts.initialized) {
    workouts.initialize();
    workouts = useWorkoutStore.getState();
  }
  const live = workouts.liveSession();
  return {
    live: live ? { id: live.id, taskId: live.taskId, sets: workouts.setsBySession[live.id] ?? workouts.loadSets(live.id) } : null,
    sessionIds: new Set(workouts.sessions.map(s => s.id)),
  };
}

/** The live session's rest, and only the one named when a tap names one. */
function sessionRest(sessionId: string, restId: string | null): RestTimer | null {
  return useStepTimerStore.getState().restFor(sessionId, restId);
}

/**
 * The two queues the Apple Watch feeds (quiet taps and dictated tasks), applied
 * now. For backgroundRefresh.ts's watch handler, which runs whether or not the
 * app has a screen; `handOff` is 'requeue' whenever the app isn't in front.
 */
export async function drainWatchQueues(handOff: 'app' | 'requeue'): Promise<void> {
  await Promise.all([processQuietWidgetTaps(handOff), processPendingAddTasks()]);
}

/**
 * Exported for the background refresh task, which has no store subscription to
 * ride and needs the snapshot rewritten once, synchronously, at the end of its
 * run — the debounced path below is for a live app where writes arrive in
 * bursts. Everything that makes a write safe is already inside it:
 * `widgetBridge()` answers not-iOS, demo mode and a build with no native half
 * in one call.
 */
export function writeWidgetSnapshotNow(): void {
  writeSnapshotNow();
}

/**
 * Reads every store the snapshot draws on and hands the lot to the builder.
 *
 * **A store that reports `initialized: false` contributes null, not an empty
 * section**, and the two mean different things on the widget: null is "open
 * the app", an empty list is "nothing to buy". A cold *background* launch has
 * them all, because `useTaskStore.initialize()` fans out to the grocery, meal
 * plan, leftover and recipe stores (see its own comment, and the order
 * `runBackgroundRefresh` relies on) — so this guard is about a build or a test
 * that never opened the database at all rather than about the background pass.
 */
/**
 * The calendar read for the widget's meeting line, or null when there isn't a
 * trustworthy one: reading off, or a read that hasn't succeeded (which is
 * always the case in a background run). Events hidden from Today stay off the
 * widget too, which is Today on the home screen.
 */
function widgetEvents(calendarReadEnabled: boolean): readonly BusyEvent[] | null {
  if (!calendarReadEnabled) return null;
  const { events, loaded } = useCalendarStore.getState();
  if (!loaded) return null;
  const hidden = useHiddenEventsStore.getState().hiddenByKey;
  return events.filter(e => !(hiddenEventKey(e) in hidden));
}

/**
 * Every task on Later, with the moment it reaches Today (an on-pace target's
 * next unit included — `getVisibleAt` already answers that). The pass is pinned
 * to the snapshot's own `now`: a task with no moment to give comes back as
 * `now`, and the builder drops exactly those, which a pass reading its own
 * clock a millisecond later would let through as "surfacing any moment".
 */
function widgetUpcoming(deferred: readonly Task[], now: Date): { task: Task; visibleAt: Date }[] {
  const pass = { ...beginVisibleAtPass(), now };
  return deferred.map(task => ({ task, visibleAt: getVisibleAt(task, pass) }));
}

/**
 * The Calendar widget's today and tomorrow, or null while the calendar isn't
 * read at all (the widget says so rather than drawing two empty days).
 *
 * The day rows come from the same buckets the Calendar screen builds, so a
 * task the screen lists on a day is the one the widget does. The calendars
 * are the ones the store reads, vacation filter included, so the widget's own
 * EventKit read can't show a calendar the app has put away.
 */
function widgetCalendar(allTasks: readonly Task[], now: Date): WidgetCalendar | null {
  const settings = useSettingsStore.getState();
  if (!settings.calendarReadEnabled) return null;
  const { dayResetTime, calendarIds, vacationMode, vacationHiddenCalendarIds } = settings;
  const todayStart = getDayStart(now, dayResetTime);
  const starts = [todayStart, addDays(todayStart, 1)];
  const keys = starts.map(dayKeyOf);
  const buckets = buildDayBuckets([...allTasks], {
    from: dayKeyToDate(keys[0]),
    to: dayKeyToDate(keys[keys.length - 1]),
    dayResetTime,
    projecting: false,
    projectFrom: dayKeyToDate(keys[0]),
  });
  const taskById = new Map(allTasks.map(t => [t.id, t]));
  const calendar = useCalendarStore.getState();
  return buildWidgetCalendar({
    days: starts.map((start, i) => ({
      key: keys[i],
      start,
      end: addDays(start, 1),
      tasks: dayRows(dayDetail(buckets.get(keys[i]), taskById)),
      sunLocation: sunLocationOn(start),
    })),
    events: widgetEvents(true),
    calendarIds: vacationMode ? calendarIds.filter(id => !vacationHiddenCalendarIds.includes(id)) : calendarIds,
    calendarsById: calendar.calendarsById,
    hidden: Object.values(useHiddenEventsStore.getState().hiddenByKey)
      .map(h => ({ id: h.eventId, start: h.eventStart })),
  });
}

// The pantry index as last written (see the end of writeSnapshotNow).
let lastPantryIndex: string | null = null;

const notLocked = (t: Task) => !isProjectLocked(t.projectId);

function writeSnapshotNow(): void {
  if (Platform.OS !== 'ios') return;
  const now = new Date();
  const tasks = useTaskStore.getState();
  const settings = useSettingsStore.getState();
  const grocery = useGroceryStore.getState();
  const medications = useMedicationStore.getState();
  const foodLog = useFoodLogStore.getState();
  const leftovers = useLeftoverStore.getState();
  const dayResetTime = settings.dayResetTime;
  const todayKey = getLogicalDayKey(now, dayResetTime);

  const input: SnapshotInput = {
    now,
    // A widget can't ask for Face ID, so a locked project stays off it even
    // while the app is unlocked.
    visibleTasks: tasks.visibleTasks().filter(notLocked),
    pinnedTasks: tasks.pinnedTasks().filter(notLocked),
    allTasks: tasks.tasks.filter(notLocked),
    categories: useCategoryStore.getState().categories.map(c => c.name),
    dayResetTime,
    doneToday: completedOnDay(tasks.tasks, todayKey, dayResetTime).length,
    grocery: grocery.initialized
      ? {
          lists: grocery.lists,
          listEntries: grocery.listEntries,
          items: grocery.items,
          activeListId: grocery.activeListId,
          shops: grocery.shops,
          tripShopId: grocery.tripShopId,
          tripStartedAt: grocery.tripStartedAt,
        }
      : null,
    // entriesForDayLive rather than a filter over `entries`: that array is a
    // single range-scoped window shared with MealPlanScreen, and a today the
    // user has paged away from is simply not in it — a bare filter would read
    // "nothing planned" and the widget would say so (see selectTodayMealEntries).
    meals: useMealPlanStore.getState().entriesForDayLive(todayKey),
    recipes: useRecipeStore.getState().recipes,
    // The one genuinely expensive derivation here, so it rides the same debounce
    // as everything else rather than being recomputed per store event.
    kitchen:
      grocery.initialized && leftovers.initialized
        ? kitchenInventory(
            grocery.items,
            leftovers.leftovers,
            now,
            grocery.itemProducts,
            listedAnywhere(grocery.listEntries)
          )
        : null,
    events: widgetEvents(settings.calendarReadEnabled),
    medications: medications.initialized
      ? { logs: medications.logs, archived: medications.archived }
      : null,
    // Read fresh for today rather than from the Food log's window, which holds
    // whatever day that screen last showed.
    limits: foodLog.initialized
      ? {
          totals: foodLogTotals(foodLog.recentEntries(todayKey, todayKey)).total,
          targets: settings.nutritionTargets,
          limits: settings.nutritionLimits,
          warnPercent: settings.limitWarnPercent,
        }
      : null,
    dayEnd: addDays(getDayStart(now, dayResetTime), 1),
    upcoming: widgetUpcoming(tasks.deferredTasks().filter(notLocked), now),
    mealLogPrompt: settings.mealLogPrompt,
    calendar: widgetCalendar(tasks.tasks.filter(notLocked), now),
  };

  writeToNativeBridge(JSON.stringify(buildWidgetSnapshot(input)));

  // The Apple Watch reads the same snapshot with room for a whole shopping
  // list (see WATCH_CAPS), plus its workout section. Same moment and the same
  // gate as the widget's write, so the two never describe different states;
  // the native half drops it when there's no paired watch with the app
  // installed.
  const bridge = widgetBridge();
  // The watch has no calendar widget, so its copy leaves that section out.
  lastWatchBase = buildWidgetSnapshot({ ...input, caps: WATCH_CAPS, calendar: null });
  writeWatchCopy(lastWatchBase, false);

  // Rides the same debounce and the same store read rather than taking a
  // subscription of its own: every write that could change the index is a
  // grocery write, and this function is already woken by all of them.
  //
  // **Skipped entirely while the grocery store is uninitialized**, which is the
  // one case where writing would be worse than not writing: `items` is empty
  // before the load, and an empty index is indistinguishable from an empty
  // catalog — Siri would answer "I don't have that" for everything the user
  // owns until the next grocery write happened to land. The snapshot above
  // handles the same gap by contributing null for a section it can't speak
  // for; a file has no null, so it keeps the last true one.
  //
  // Written only when it changed, as the medication index is: each write has
  // Siri read the shortcuts' names again, and the snapshot runs on every
  // grocery change.
  if (grocery.initialized && bridge) {
    const json = JSON.stringify(buildPantryIndex(grocery.items));
    if (json !== lastPantryIndex) {
      lastPantryIndex = json;
      bridge.writePantryIndex(json).catch(() => { lastPantryIndex = null; });
    }
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSnapshotWrite(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    writeSnapshotNow();
  }, DEBOUNCE_MS);
}

// ==== The Apple Watch's workout ====
//
// The watch's copy carries a workout section the widget's doesn't
// (watchWorkout.ts). A workout changes far more often than the rest of the
// snapshot (every set, every weight stepped on the phone, every rest), and a
// full write reloads every widget timeline on the home screen. So a change
// that only moves the workout rewrites the watch's copy alone: the rest of it
// as the last full write built it, with a fresh workout section.

/** The watch's copy as the last full write built it, without its workout section. */
let lastWatchBase: WidgetSnapshot | null = null;
/** The last watch-only payload sent, so an unchanged one isn't sent again. */
let lastWatchOnly: string | null = null;
let watchWorkoutTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * What the workout section reads from the database (the routine plans, each
 * exercise's history for its suggestion, the exercises logged lately and last
 * time's sets of each), read once per state of what they depend on: the
 * sessions, any set of a session other than the one in progress, the
 * routines, the exercises, and the plates and unit a load is rounded to.
 *
 * The live session's own sets are left out on purpose: none of these reads
 * counts them (a suggestion and last time both pass over the workout in
 * progress, and an exercise already in it can't be added again), and they
 * change on every weight stepped, which would read it all again each time.
 */
interface WorkoutReads {
  deps: readonly unknown[];
  plans: Map<string, PlannedRoutineSet[]>;
  history: Map<string, WorkoutSet[]>;
  lastTime: Map<string, WorkoutSet[]>;
  recentIds: string[] | null;
}
let workoutReads: WorkoutReads | null = null;

function currentWorkoutReads(): WorkoutReads {
  const workouts = useWorkoutStore.getState();
  const settings = useSettingsStore.getState();
  const liveId = workouts.liveSession()?.id ?? null;
  const otherSets = Object.entries(workouts.setsBySession).filter(([id]) => id !== liveId).map(([, sets]) => sets);
  const deps = [workouts.sessions, workouts.routines, workouts.exercises, settings.workoutUnit, settings.dumbbellEntry, settings.plateInventory, ...otherSets];
  if (!workoutReads || workoutReads.deps.length !== deps.length || workoutReads.deps.some((d, i) => d !== deps[i])) {
    workoutReads = { deps, plans: new Map(), history: new Map(), lastTime: new Map(), recentIds: null };
  }
  return workoutReads;
}

function cachedRead<T>(map: Map<string, T>, key: string, read: () => T): T {
  if (!map.has(key)) map.set(key, read());
  return map.get(key)!;
}

function plannedFor(routineId: string): PlannedRoutineSet[] {
  return cachedRead(currentWorkoutReads().plans, routineId, () => useWorkoutStore.getState().plannedSetsForRoutine(routineId, null));
}

function historyFor(exerciseId: string): WorkoutSet[] {
  return cachedRead(currentWorkoutReads().history, exerciseId, () => useWorkoutStore.getState().exerciseHistory(exerciseId));
}

/**
 * The exercises with a set done in the last `WATCH_RECENT_DAYS`, each with
 * last time's sets as adding it to the workout in progress (or to none) would
 * read them (`lastTimeFor`, `addSessionExercise`'s own source).
 */
function recentFor(liveId: string | null): { exerciseId: string; lastTime: WorkoutSet[] }[] {
  const reads = currentWorkoutReads();
  if (!reads.recentIds) {
    const since = Date.now() - WATCH_RECENT_DAYS * 86_400_000;
    const ids = new Set<string>();
    for (const set of useWorkoutStore.getState().allSets()) {
      if (set.completedAt !== null && Date.parse(set.completedAt) >= since) ids.add(set.exerciseId);
    }
    reads.recentIds = [...ids];
  }
  return reads.recentIds.map(exerciseId => ({
    exerciseId,
    lastTime: cachedRead(reads.lastTime, `${liveId ?? ''}\u0000${exerciseId}`, () => useWorkoutStore.getState().lastTimeFor(exerciseId, liveId)),
  }));
}

/** The watch's workout section now, or null while the store hasn't loaded or the area is off. */
function watchWorkoutSection(): WatchWorkoutSnapshot | null {
  const workouts = useWorkoutStore.getState();
  if (!workouts.initialized) return null;
  const settings = useSettingsStore.getState();
  const live = workouts.liveSession();
  // Through restFor, which reads the timers back first: a cold launch in the
  // background that ticked nothing (so the drain never hydrated them) would
  // otherwise send no rest, and the watch's countdown would vanish.
  const rest = live ? useStepTimerStore.getState().restFor(live.id) : null;
  return buildWatchWorkout({
    workoutsEnabled: settings.workoutsEnabled,
    healthWrite: workoutHealthWriteOn(),
    watchRequests: useWatchHealthStore.getState().requests,
    now: new Date(),
    unit: settings.workoutUnit,
    dumbbellEntry: settings.dumbbellEntry,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    exercises: workouts.exercises,
    defaultRestSeconds: settings.defaultRestSeconds,
    live: live
      ? {
          session: live,
          sets: workouts.setsBySession[live.id] ?? [],
          routine: live.routineId ? workouts.routines.find(r => r.id === live.routineId) ?? null : null,
          rest,
        }
      : null,
    routines: workouts.routines,
    programs: workouts.programs,
    sessions: workouts.sessions,
    plateInventory: settings.plateInventory,
    todays: live
      ? null
      : todaysWatchWorkout({
          routines: workouts.routines,
          programs: workouts.programs,
          currentProgramId: settings.currentProgramId,
          sessions: workouts.sessions,
          todayTasks: useTaskStore.getState().visibleTasks(),
        }),
    planFor: plannedFor,
    historyFor,
    recent: settings.workoutsEnabled ? recentFor(live?.id ?? null) : [],
  });
}

/**
 * Sends the watch its copy: `base` with the workout section as it is now.
 * Through widgetBridge(), so demo mode sends nothing. A watch-only write that
 * would send what the last one sent is skipped; a full write always goes,
 * since it is also what tells the watch its taps have been applied.
 */
function writeWatchCopy(base: WidgetSnapshot, watchOnly: boolean): void {
  const bridge = widgetBridge();
  if (!bridge) return;
  const json = JSON.stringify({ ...base, workout: watchWorkoutSection() });
  if (watchOnly && json === lastWatchOnly) return;
  lastWatchOnly = json;
  bridge.writeWatchSnapshot(json).catch(() => {});
}

function scheduleWatchWorkoutWrite(): void {
  if (Platform.OS !== 'ios') return;
  if (watchWorkoutTimer) clearTimeout(watchWorkoutTimer);
  watchWorkoutTimer = setTimeout(() => {
    watchWorkoutTimer = null;
    // A full write already on its way carries the workout too, and a
    // watch-only one ahead of it would tell the watch its other taps were
    // applied before the snapshot showing them had been written.
    if (debounceTimer) return;
    if (lastWatchBase) writeWatchCopy(lastWatchBase, true);
    else writeSnapshotNow();
  }, DEBOUNCE_MS);
}

// Keeps the iOS widgets' data fresh. Subscribes to the *identity* of each
// store slice the snapshot reads rather than threading a sync call through
// every mutating store action — the task store alone has ~30 of them
// (add/update/delete/complete/defer/bulk ops/group ops/subtasks/…) and any new
// one added later would otherwise silently skip the widget refresh. The same
// argument applies once per store, which is why this is a list rather than one
// subscription: a grocery row ticked off has to move the groceries widget, and
// nothing about it touches `tasks`.
//
// Every one of them lands on the same debounce, so a change that moves several
// stores at once (finishing a shop writes entries, items and the trip) still
// costs one write.
function subscribeToStores(): () => void {
  // The watch's workout section carries these lists; read them from the
  // database once, as the clash prompt does its own.
  useWatchHealthStore.getState().reload();
  const unsubscribers = [
    useTaskStore.subscribe((s, p) => {
      if (s.tasks !== p.tasks) scheduleSnapshotWrite();
    }),
    useCategoryStore.subscribe((s, p) => {
      if (s.categories !== p.categories) scheduleSnapshotWrite();
    }),
    useGroceryStore.subscribe((s, p) => {
      if (
        s.listEntries !== p.listEntries ||
        s.items !== p.items ||
        s.lists !== p.lists ||
        s.activeListId !== p.activeListId ||
        s.tripShopId !== p.tripShopId ||
        s.tripStartedAt !== p.tripStartedAt ||
        s.itemProducts !== p.itemProducts
      ) {
        scheduleSnapshotWrite();
      }
    }),
    useLeftoverStore.subscribe((s, p) => {
      if (s.leftovers !== p.leftovers) scheduleSnapshotWrite();
    }),
    useMealPlanStore.subscribe((s, p) => {
      if (s.entries !== p.entries) scheduleSnapshotWrite();
    }),
    useRecipeStore.subscribe((s, p) => {
      if (s.recipes !== p.recipes) scheduleSnapshotWrite();
    }),
    useCalendarStore.subscribe((s, p) => {
      if (s.events !== p.events || s.loaded !== p.loaded) scheduleSnapshotWrite();
    }),
    useHiddenEventsStore.subscribe((s, p) => {
      if (s.hiddenByKey !== p.hiddenByKey) scheduleSnapshotWrite();
    }),
    // The Limits widget: a logged, revised or deleted entry, and the targets
    // and limits it is read against.
    useFoodLogStore.subscribe((s, p) => {
      if (s.totalCount !== p.totalCount || s.entries !== p.entries || s.initialized !== p.initialized) {
        scheduleSnapshotWrite();
      }
    }),
    useSettingsStore.subscribe((s, p) => {
      if (
        s.nutritionTargets !== p.nutritionTargets ||
        s.nutritionLimits !== p.nutritionLimits ||
        s.limitWarnPercent !== p.limitWarnPercent ||
        // The Calendar widget reads these calendars itself.
        s.calendarReadEnabled !== p.calendarReadEnabled ||
        s.calendarIds !== p.calendarIds
      ) {
        scheduleSnapshotWrite();
      }
    }),
    useMedicationStore.subscribe((s, p) => {
      if (s.logs !== p.logs || s.archived !== p.archived || s.registered !== p.registered || s.initialized !== p.initialized) {
        // The Medications widget reads the snapshot, Siri reads the index.
        scheduleSnapshotWrite();
        scheduleMedicationIndexWrite();
      }
    }),
    // Siri's routine list: a routine added, renamed or deleted, or the area
    // switched on or off.
    useWorkoutStore.subscribe((s, p) => {
      if (s.routines !== p.routines || s.initialized !== p.initialized) scheduleRoutineIndexWrite();
    }),
    useSettingsStore.subscribe((s, p) => {
      if (s.workoutsEnabled !== p.workoutsEnabled) scheduleRoutineIndexWrite();
    }),
    // The Apple Watch's workout section: the workout going on the phone (its
    // sets and rest), the routines and plans it can start, and the settings
    // either is read with. Today's tasks (for "From Today") ride the task
    // store's own full write above.
    useWorkoutStore.subscribe((s, p) => {
      if (
        s.sessions !== p.sessions ||
        s.setsBySession !== p.setsBySession ||
        s.routines !== p.routines ||
        s.programs !== p.programs ||
        s.exercises !== p.exercises ||
        s.initialized !== p.initialized
      ) {
        scheduleWatchWorkoutWrite();
      }
    }),
    useStepTimerStore.subscribe((s, p) => {
      if (s.timers !== p.timers) scheduleWatchWorkoutWrite();
    }),
    // What the phone asks of the watch's HealthKit session (phase 9).
    useWatchHealthStore.subscribe((s, p) => {
      if (s.requests !== p.requests) scheduleWatchWorkoutWrite();
    }),
    useSettingsStore.subscribe((s, p) => {
      if (
        s.workoutsEnabled !== p.workoutsEnabled ||
        // The three switches a workout on the watch is measured and saved under.
        s.healthWriteEnabled !== p.healthWriteEnabled ||
        s.workoutHealthWrite !== p.workoutHealthWrite ||
        s.workoutUnit !== p.workoutUnit ||
        s.dumbbellEntry !== p.dumbbellEntry ||
        s.defaultRestSeconds !== p.defaultRestSeconds ||
        s.plateInventory !== p.plateInventory ||
        s.quietHoursStart !== p.quietHoursStart ||
        s.quietHoursEnd !== p.quietHoursEnd
      ) {
        scheduleWatchWorkoutWrite();
      }
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

export function useWidgetSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const unsubscribe = subscribeToStores();
    // Subscriptions are registered before this resolves, so any completions
    // (or additions — see processPendingAddTasks) applied here also trigger
    // the debounced write above like any other mutation would — no separate
    // write path needed for the drain itself, just an initial one below in
    // case there was nothing to drain.
    Promise.all([
      processPendingWidgetCompletions(),
      processPendingAddTasks(),
      processPendingDisposals(),
      processPendingDoses(),
      processPendingDreams(),
      processPendingFoods(),
      processPendingShortcutActions(),
      processPendingKeyScans(),
      processPendingWorkoutStarts(),
      processQuietWidgetTaps(),
    ]).finally(() => {
      // Deferred rather than called synchronously during mount — avoids
      // making the very first native module call while the app (and its
      // native module registry) is still mid-launch.
      scheduleSnapshotWrite();
      scheduleMedicationIndexWrite();
      scheduleRoutineIndexWrite();
    });

    // Tapping a checkbox in the widget (CompleteTaskIntent, in
    // TodoTodayWidget.swift), the Action Button (AddTaskIntent) or saying a
    // disposal to Siri (MarkDisposedIntent) opens the app to apply what it
    // queued, but if the app was already running in the background this effect
    // doesn't remount — only a fresh 'active' AppState transition tells us to
    // drain again. All three drains are safe to call with nothing queued.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        Promise.all([
          processPendingWidgetCompletions(),
          processPendingAddTasks(),
          processPendingDisposals(),
          processPendingDoses(),
          processPendingDreams(),
          processPendingFoods(),
          processPendingShortcutActions(),
          processPendingKeyScans(),
          processPendingWorkoutStarts(),
          processQuietWidgetTaps(),
        ]).finally(scheduleSnapshotWrite);
      }
    });

    // A tap from the Apple Watch is applied by backgroundRefresh.ts's watch
    // handler, registered when that module loads rather than here, because it
    // has to run with no React tree too (a watch tap that woke the app).

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
