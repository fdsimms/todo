import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { RecurrenceType, Priority, Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';

const DEBOUNCE_MS = 300;
const MAX_VISIBLE_TASKS = 50;
const MAX_FOCUSED_TASKS = 10;

interface WidgetTask {
  id: string;
  title: string;
  priority: Priority;
  focused: boolean;
  dueDate: string | null;
  category: string | null;
  streakCount: number;
  recurrenceType: RecurrenceType;
}

interface WidgetSnapshot {
  updatedAt: string;
  visibleTasks: WidgetTask[];
  focusedTasks: WidgetTask[];
}

function toWidgetTask(task: Task): WidgetTask {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    focused: task.focused,
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
      writeWidgetSnapshot: (jsonString: string) => Promise<void>;
    };
    // Fire-and-forget: nothing here needs to block on the native write
    // completing. Swallowing a rejection here is intentional — a failed
    // widget refresh should never surface anywhere in the app UI.
    writeWidgetSnapshot(jsonString).catch(() => {});
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
}

function writeSnapshotNow(): void {
  if (Platform.OS !== 'ios') return;
  const { visibleTasks, focusedTasks } = useTaskStore.getState();
  const snapshot: WidgetSnapshot = {
    updatedAt: new Date().toISOString(),
    visibleTasks: visibleTasks().slice(0, MAX_VISIBLE_TASKS).map(toWidgetTask),
    focusedTasks: focusedTasks().slice(0, MAX_FOCUSED_TASKS).map(toWidgetTask),
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
    // Deferred rather than called synchronously during mount — avoids
    // making the very first native module call while the app (and its
    // native module registry) is still mid-launch.
    scheduleSnapshotWrite();
    const unsubscribe = useTaskStore.subscribe((state, prevState) => {
      if (state.tasks !== prevState.tasks) scheduleSnapshotWrite();
    });
    return unsubscribe;
  }, []);
}
