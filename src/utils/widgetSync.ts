import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { RecurrenceType, Priority, Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { resetToToday } from '../navigation/navigationRef';

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
    title: task.title,
    priority: task.priority,
    pinned: task.pinned,
    dueDate: task.dueDate,
    category: task.category,
    streakCount: task.streakCount,
    recurrenceType: task.recurrenceType,
  };
}

// Lazily required so importing this module never crashes in Expo Go or on
// Android, where the local `todo-widget-bridge` native module doesn't exist.
function writeToNativeBridge(jsonString: string): void {
  if (Platform.OS !== 'ios') return;
  try {
    const { writeWidgetSnapshot } = require('todo-widget-bridge') as {
      writeWidgetSnapshot: (jsonString: string) => Promise<boolean>;
    };
    // Fire-and-forget: nothing here needs to block on the native write
    // completing. Swallowing a rejection here is intentional — a failed
    // widget refresh should never surface anywhere in the app UI.
    writeWidgetSnapshot(jsonString).catch(() => {});
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
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
  if (Platform.OS !== 'ios') return;
  try {
    const { drainPendingWidgetCompletions } = require('todo-widget-bridge') as {
      drainPendingWidgetCompletions: () => Promise<string[]>;
    };
    const ids = await drainPendingWidgetCompletions();
    if (ids.length === 0) return;
    useWidgetCompletionStore.getState().enqueue(ids);
    resetToToday();
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
}

function writeSnapshotNow(): void {
  if (Platform.OS !== 'ios') return;
  const { visibleTasks, pinnedTasks } = useTaskStore.getState();
  const snapshot: WidgetSnapshot = {
    updatedAt: new Date().toISOString(),
    visibleTasks: visibleTasks().slice(0, MAX_VISIBLE_TASKS).map(toWidgetTask),
    pinnedTasks: pinnedTasks().slice(0, MAX_PINNED_TASKS).map(toWidgetTask),
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
    // applied here also trigger the debounced write above like any other
    // mutation would — no separate write path needed for the drain itself,
    // just an initial one below in case there was nothing to drain.
    processPendingWidgetCompletions().finally(() => {
      // Deferred rather than called synchronously during mount — avoids
      // making the very first native module call while the app (and its
      // native module registry) is still mid-launch.
      scheduleSnapshotWrite();
    });

    // Tapping a checkbox in the widget (CompleteTaskIntent, in
    // TodoTodayWidget.swift) opens the app to apply queued completions, but
    // if the app was already running in the background this effect doesn't
    // remount — only a fresh 'active' AppState transition tells us to drain
    // again. drainPendingCompletions() is safe to call with nothing queued.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        processPendingWidgetCompletions().finally(scheduleSnapshotWrite);
      }
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
