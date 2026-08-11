import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Task, Recipe } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { isTimedTask, timerRemaining } from './timer';
import { hasCookTimer, cookTimerRemaining, hasPrepTimer, prepTimerRemaining } from './recipeTimer';
import { displayTitleFor } from './visibilityUtils';

/**
 * Drives the "running timer" Live Activity (Lock Screen + Dynamic Island) —
 * see docs/native-targets.md and targets/todo-widget/TimerLiveActivity.swift.
 * Covers a task's stopwatch/countdown (Task.timerStartedAt) and a recipe's
 * cook and prep timers (Recipe.timerStartedAt/prepTimerStartedAt) — three
 * independent sources of a "run", each surfaced as its own activity.
 *
 * A run is fully described by its start time and, for a countdown, the clock
 * time it ends at — both fixed the moment the timer starts (or resumes from a
 * pause), never updated after. SwiftUI's `Text(timerInterval:)`/
 * `Text(_:style:.timer)` then tick on their own with zero further pushes from
 * here, so the only JS-side job is telling the native side which runs
 * currently exist. Pausing, stopping, discarding, resetting or (for a task)
 * completing a timer removes it from the desired set below, which ends its
 * activity; resuming starts a fresh one with a freshly computed end time
 * (accounting for whatever was already banked) rather than updating one in
 * place — there's never a live activity whose duration needs to change under it.
 */

const TITLE_MAX = 60;
const DEBOUNCE_MS = 300;

function truncate(title: string): string {
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

export type TimerRunKind = 'task' | 'cook' | 'prep';

export interface TimerRun {
  /** How the native side tells which activities are still wanted — 'task:<id>' | 'cook:<id>' | 'prep:<id>'. */
  key: string;
  kind: TimerRunKind;
  itemId: string; // task id, or recipe id for cook/prep
  title: string;
  subtitle: string;
  symbolName: string;
  startedAtMs: number;
  targetEndMs: number | null; // null = counts up with no target (a plain stopwatch)
}

/**
 * Pure. Every task/recipe with a run in flight, or an empty array when the
 * setting is off — the caller is then a single JSON.stringify away from the
 * native reconciliation call, and every rule here is unit-testable under the
 * node env.
 */
export function buildTimerRuns(
  tasks: Task[],
  recipes: Recipe[],
  opts: { enabled: boolean },
): TimerRun[] {
  if (!opts.enabled) return [];
  const runs: TimerRun[] = [];

  for (const task of tasks) {
    // Archived and completed both leave timerStartedAt set on their own (see
    // useTaskStore.ts) — neither belongs on the Lock Screen.
    if (task.timerStartedAt === null || task.completed || task.archived) continue;
    const startedAtMs = new Date(task.timerStartedAt).getTime();
    // Clamped to never precede startedAtMs: a countdown that was already
    // overdue the moment it (re)started would otherwise hand SwiftUI's
    // Text(timerInterval:) an inverted range, which crashes the extension.
    const targetEndMs = isTimedTask(task)
      ? Math.max(startedAtMs, startedAtMs + timerRemaining(task, startedAtMs) * 1000)
      : null;
    runs.push({
      key: `task:${task.id}`,
      kind: 'task',
      itemId: task.id,
      title: truncate(displayTitleFor(task)),
      subtitle: '',
      symbolName: 'timer',
      startedAtMs,
      targetEndMs,
    });
  }

  for (const recipe of recipes) {
    if (recipe.timerStartedAt !== null) {
      const startedAtMs = new Date(recipe.timerStartedAt).getTime();
      const targetEndMs = hasCookTimer(recipe)
        ? Math.max(startedAtMs, startedAtMs + cookTimerRemaining(recipe, startedAtMs) * 1000)
        : null;
      runs.push({
        key: `cook:${recipe.id}`,
        kind: 'cook',
        itemId: recipe.id,
        title: truncate(recipe.name),
        subtitle: 'Cooking',
        symbolName: 'flame.fill',
        startedAtMs,
        targetEndMs,
      });
    }
    if (recipe.prepTimerStartedAt !== null) {
      const startedAtMs = new Date(recipe.prepTimerStartedAt).getTime();
      const targetEndMs = hasPrepTimer(recipe)
        ? Math.max(startedAtMs, startedAtMs + prepTimerRemaining(recipe, startedAtMs) * 1000)
        : null;
      runs.push({
        key: `prep:${recipe.id}`,
        kind: 'prep',
        itemId: recipe.id,
        title: truncate(recipe.name),
        subtitle: 'Prep',
        symbolName: 'fork.knife',
        startedAtMs,
        targetEndMs,
      });
    }
  }

  return runs;
}

// Lazily required, same shape as writeToNativeBridge in widgetSync.ts, so
// importing this module never crashes in Expo Go or on Android, where the
// local `todo-widget-bridge` native module doesn't exist.
function syncNativeTimerActivities(runs: TimerRun[]): void {
  if (Platform.OS !== 'ios') return;
  try {
    const { syncTimerLiveActivities } = require('todo-widget-bridge') as {
      syncTimerLiveActivities: (jsonString: string) => Promise<boolean>;
    };
    // Fire-and-forget: nothing here needs to block on the native reconcile
    // completing, and a failure must never surface anywhere in the app UI.
    syncTimerLiveActivities(JSON.stringify(runs)).catch(() => {});
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRuns: TimerRun[] = [];

function scheduleSync(runs: TimerRun[]): void {
  pendingRuns = runs;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncNativeTimerActivities(pendingRuns), DEBOUNCE_MS);
}

// The cooking Live Activity's Done button has no task to complete, so it logs
// the elapsed time instead — the same outcome as tapping Stop in the app (see
// stopCookTimer/stopPrepTimer). Queued the same way the widget's checkbox
// queues a completion (see modules/todo-widget-bridge and
// processPendingWidgetCompletions in widgetSync.ts): the widget extension
// process can't reach the recipe store, so StopCookingTimerIntent just writes
// a key ('cook:<id>' / 'prep:<id>') and opens the app to apply it for real. A
// task's Done button reuses CompleteTaskIntent and the existing completion
// queue instead — see useWidgetCompletionStore — since completing the task is
// exactly the reuse the timer trigger was meant to keep.
async function processPendingTimerStops(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const { drainPendingTimerStops } = require('todo-widget-bridge') as {
      drainPendingTimerStops: () => Promise<string[]>;
    };
    const keys = await drainPendingTimerStops();
    for (const key of keys) {
      if (key.startsWith('cook:')) useRecipeStore.getState().stopCookTimer(key.slice('cook:'.length));
      else if (key.startsWith('prep:')) useRecipeStore.getState().stopPrepTimer(key.slice('prep:'.length));
    }
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
}

// Keeps the Live Activity for every running task/recipe timer in sync.
// Subscribes to the task and recipe stores' array references rather than
// threading a call through every action that can start, pause, stop, discard,
// reset or complete a timer — same rationale as useWidgetSync in
// widgetSync.ts, and it means a task completing mid-timer (which clears
// timerStartedAt as part of the same update) ends its activity for free.
export function useTimerLiveActivitySync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => {
      const enabled = useSettingsStore.getState().timerLiveActivity;
      const runs = buildTimerRuns(
        useTaskStore.getState().tasks,
        useRecipeStore.getState().recipes,
        { enabled },
      );
      scheduleSync(runs);
    };

    const unsubTasks = useTaskStore.subscribe((state, prevState) => {
      if (state.tasks !== prevState.tasks) sync();
    });
    const unsubRecipes = useRecipeStore.subscribe((state, prevState) => {
      if (state.recipes !== prevState.recipes) sync();
    });
    const unsubSettings = useSettingsStore.subscribe((state, prevState) => {
      if (state.timerLiveActivity !== prevState.timerLiveActivity) sync();
    });

    // Applies a cooking Live Activity's Done tap queued while the app was
    // backgrounded or closed, then reconciles either way — same two-step as
    // processPendingWidgetCompletions/writeSnapshotNow in widgetSync.ts.
    processPendingTimerStops().finally(sync);

    // Tapping a cooking Live Activity's Done button opens the app
    // (StopCookingTimerIntent.openAppWhenRun) to apply its queued stop, but if
    // the app was already running in the background this effect doesn't
    // remount — only a fresh 'active' AppState transition tells us to drain
    // again. drainPendingTimerStops() is safe to call with nothing queued.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') processPendingTimerStops().finally(sync);
    });

    return () => {
      unsubTasks();
      unsubRecipes();
      unsubSettings();
      subscription.remove();
    };
  }, []);
}
