import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { resetToKitchen, resetToToday, resetToWorkouts } from '../navigation/navigationRef';
import { buildWidgetSnapshot, WATCH_CAPS, type SnapshotInput } from './widgetSnapshot';
import { completedOnDay } from './allClear';
import { getDayStart, getLogicalDayKey } from './dateUtils';
import { beginVisibleAtPass, getVisibleAt } from './visibilityUtils';
import { parseQuietTaps, planQuietTaps, tapsToRequeue } from './widgetQuietTaps';
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

// Dreams said to Siri or the Action Button (LogDreamIntent): written into the
// dream log, filed under the day they were said. Silent on arrival, like the
// task capture: no navigation, so the journal lock stays closed. Saying one
// also makes today's "write down a dream" reminder read ready, as saving it in
// the sheet does; the tick stays the person's. Written through the store's own
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
      useJournalStore.getState().addEntry('dream', dream.text, dream.at ?? undefined);
    }
    haptics.success();
  } catch {
    // A build predating drainPendingDreams — no-op.
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
    );
    const handedOver: Record<string, string> = {};
    for (const action of plan) {
      switch (action.type) {
        case 'complete':
          useTaskStore.getState().completeTask(action.id, { completedAt: action.at });
          break;
        case 'logUnit':
          useTaskStore.getState().logQuotaUnit(action.id);
          break;
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
      }
    }
    const ids = Object.keys(handedOver);
    if (ids.length > 0) {
      if (handOff === 'requeue') {
        await bridge.requeueQuietTaps(JSON.stringify(tapsToRequeue(taps, new Set(ids))));
      } else {
        useWidgetCompletionStore.getState().enqueue(ids, handedOver);
      }
    }
  } catch {
    // A build predating drainQuietTaps — no-op.
  }
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
  };

  writeToNativeBridge(JSON.stringify(buildWidgetSnapshot(input)));

  // The Apple Watch reads the same snapshot with room for a whole shopping
  // list (see WATCH_CAPS). Same moment and the same gate as the widget's
  // write, so the two never describe different states; the native half drops
  // it when there's no paired watch with the app installed.
  const bridge = widgetBridge();
  bridge?.writeWatchSnapshot(JSON.stringify(buildWidgetSnapshot({ ...input, caps: WATCH_CAPS }))).catch(() => {});

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
  debounceTimer = setTimeout(writeSnapshotNow, DEBOUNCE_MS);
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
        s.limitWarnPercent !== p.limitWarnPercent
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
