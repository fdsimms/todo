import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { RecurrenceType, Priority, Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { resetToToday } from '../navigation/navigationRef';
import { displayTitleFor } from './visibilityUtils';
import { widgetBridge } from './widgetBridge';
import { haptics } from './haptics';

const DEBOUNCE_MS = 300;
const MAX_VISIBLE_TASKS = 50;
const MAX_PINNED_TASKS = 10;

interface WidgetTask {
  id: string;
  title: string;
  priority: Priority;
  pinned: boolean;
  dueDate: string | null;
  category: string | null;
  streakCount: number;
  recurrenceType: RecurrenceType;
}

interface WidgetSnapshot {
  updatedAt: string;
  visibleTasks: WidgetTask[];
  pinnedTasks: WidgetTask[];
}

function toWidgetTask(task: Task): WidgetTask {
  return {
    id: task.id,
    title: displayTitleFor(task),
    priority: task.priority,
    pinned: task.pinned,
    dueDate: task.dueDate,
    category: task.category,
    streakCount: task.streakCount,
    recurrenceType: task.recurrenceType,
  };
}

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

// The weekly meal-plan nudge (see mealPlanNudge.ts) fires as a stack of
// seven — one bare "Sunday 08/17"-style task per day — which reads fine
// under its stack header in the app but, flattened onto the widget with no
// header or grouping to explain them, looked like seven nonsense date
// titles crowding out the real tasks around them (#1726). The widget has no
// notion of a stack to collapse them into instead, so they're left off
// entirely; the stack is still one tap away inside the app.
function isWidgetWorthy(task: Task): boolean {
  // A negative habit's only control is "I slipped", and the widget has one
  // control: a checkbox that queues a completion. That completion is refused
  // (see the polarity guard in completeTask), so shipping the row would put a
  // checkbox on the home screen that does nothing at all when tapped — and the
  // one thing it *looks* like it would do is the opposite of what the task
  // means. Until the widget can draw a shield, it doesn't carry these.
  if (task.polarity === 'negative') return false;
  return task.generatedKind !== 'mealPlanNudge';
}

function writeSnapshotNow(): void {
  if (Platform.OS !== 'ios') return;
  const { visibleTasks, pinnedTasks } = useTaskStore.getState();
  const snapshot: WidgetSnapshot = {
    updatedAt: new Date().toISOString(),
    visibleTasks: visibleTasks().filter(isWidgetWorthy).slice(0, MAX_VISIBLE_TASKS).map(toWidgetTask),
    pinnedTasks: pinnedTasks().filter(isWidgetWorthy).slice(0, MAX_PINNED_TASKS).map(toWidgetTask),
  };
  writeToNativeBridge(JSON.stringify(snapshot));
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSnapshotWrite(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(writeSnapshotNow, DEBOUNCE_MS);
}

// Keeps the iOS Today widget's data fresh. Subscribes once to the task
// store's `tasks` array reference rather than threading a sync call through
// every mutating store action — the store has ~30 of them (add/update/
// delete/complete/defer/bulk ops/group ops/subtasks/…) and any new one added
// later would otherwise silently skip the widget refresh.
export function useWidgetSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const unsubscribe = useTaskStore.subscribe((state, prevState) => {
      if (state.tasks !== prevState.tasks) scheduleSnapshotWrite();
    });
    // Subscription is registered before this resolves, so any completions
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
