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
import { resetToToday } from '../navigation/navigationRef';
import { buildWidgetSnapshot } from './widgetSnapshot';
import { completedOnDay } from './allClear';
import { getLogicalDayKey } from './dateUtils';
import { kitchenInventory } from './kitchenInventory';
import { listedAnywhere } from './groceryLists';
import { widgetBridge } from './widgetBridge';
import { haptics } from './haptics';

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
// (CompleteTaskIntent, running in the separate widget extension process —
// see modules/todo-widget-bridge) to TodayScreen via useWidgetCompletionStore,
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
  try {
    const ids = await bridge.drainPendingWidgetCompletions();
    if (ids.length === 0) return;
    useWidgetCompletionStore.getState().enqueue(ids);
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
function writeSnapshotNow(): void {
  if (Platform.OS !== 'ios') return;
  const now = new Date();
  const tasks = useTaskStore.getState();
  const settings = useSettingsStore.getState();
  const grocery = useGroceryStore.getState();
  const leftovers = useLeftoverStore.getState();
  const dayResetTime = settings.dayResetTime;
  const todayKey = getLogicalDayKey(now, dayResetTime);

  const snapshot = buildWidgetSnapshot({
    now,
    visibleTasks: tasks.visibleTasks(),
    pinnedTasks: tasks.pinnedTasks(),
    allTasks: tasks.tasks,
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
  });

  writeToNativeBridge(JSON.stringify(snapshot));
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
    Promise.all([processPendingWidgetCompletions(), processPendingAddTasks()]).finally(() => {
      // Deferred rather than called synchronously during mount — avoids
      // making the very first native module call while the app (and its
      // native module registry) is still mid-launch.
      scheduleSnapshotWrite();
    });

    // Tapping a checkbox in the widget (CompleteTaskIntent, in
    // TodoTodayWidget.swift) or the Action Button (AddTaskIntent) opens the
    // app to apply what it queued, but if the app was already running in the
    // background this effect doesn't remount — only a fresh 'active'
    // AppState transition tells us to drain again. Both drains are safe to
    // call with nothing queued.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        Promise.all([processPendingWidgetCompletions(), processPendingAddTasks()]).finally(
          scheduleSnapshotWrite
        );
      }
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
