import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { Task, Recipe, StepTimer } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { widgetBridge } from './widgetBridge';
import { isTimedTask, timerRemaining } from './timer';
import { hasCookTimer, cookTimerRemaining, hasPrepTimer, prepTimerRemaining } from './recipeTimer';
import { isStepTimerRunning, stepTimerRemaining } from './stepTimers';
import { displayTitleFor } from './visibilityUtils';

/**
 * Drives the "running timer" Live Activity (Lock Screen + Dynamic Island) —
 * see docs/native-targets.md and targets/todo-widget/TimerLiveActivity.swift.
 * Covers a task's stopwatch/countdown (Task.timerStartedAt), a recipe's cook
 * and prep timers (Recipe.timerStartedAt/prepTimerStartedAt) and every
 * cooking step timer counting down — four independent sources of a
 * "run", each surfaced as its own activity. The step timers are the reason
 * the desired set can hold several at once from one dish: three pans is
 * three activities.
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

export type TimerRunKind = 'task' | 'cook' | 'prep' | 'step';

export interface TimerRun {
  /** How the native side tells which activities are still wanted — 'task:<id>' | 'cook:<id>' | 'prep:<id>'. */
  key: string;
  kind: TimerRunKind;
  itemId: string; // task id, recipe id for cook/prep, or step timer id
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
  stepTimers: StepTimer[],
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

  for (const timer of stepTimers) {
    if (!isStepTimerRunning(timer)) continue;
    const startedAtMs = new Date(timer.startedAt as string).getTime();
    // A step timer always has a target — it's a countdown by construction, so
    // unlike the three above there's no stopwatch case to fall through to.
    // Clamped for the reason the task branch gives: a countdown already past
    // its end would hand SwiftUI an inverted range.
    const targetEndMs = Math.max(
      startedAtMs,
      startedAtMs + stepTimerRemaining(timer, startedAtMs) * 1000,
    );
    runs.push({
      key: `step:${timer.id}`,
      kind: 'step',
      itemId: timer.id,
      // The dish on top and the step underneath, rather than the step text:
      // what a Lock Screen has room for is which pan this is, and the method
      // is on the phone the cook is about to pick up anyway.
      title: truncate(timer.recipeName || 'Cooking'),
      subtitle: timer.stepLabel,
      symbolName: 'timer',
      startedAtMs,
      targetEndMs,
    });
  }

  return runs;
}

// Through widgetBridge(), which is where not-iOS, demo mode and a build with
// no native half are all answered at once — see its note for why a Live
// Activity must never be started from seeded demo data.
function syncNativeTimerActivities(runs: TimerRun[]): void {
  const bridge = widgetBridge();
  if (!bridge) return;
  // Fire-and-forget: nothing here needs to block on the native reconcile
  // completing, and a failure must never surface anywhere in the app UI.
  bridge.syncTimerLiveActivities(JSON.stringify(runs)).catch(() => {});
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRuns: TimerRun[] = [];

function scheduleSync(runs: TimerRun[]): void {
  pendingRuns = runs;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncNativeTimerActivities(pendingRuns), DEBOUNCE_MS);
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
        useStepTimerStore.getState().timers,
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
    const unsubStepTimers = useStepTimerStore.subscribe((state, prevState) => {
      if (state.timers !== prevState.timers) sync();
    });
    const unsubSettings = useSettingsStore.subscribe((state, prevState) => {
      if (state.timerLiveActivity !== prevState.timerLiveActivity) sync();
    });

    sync();

    return () => {
      unsubTasks();
      unsubRecipes();
      unsubStepTimers();
      unsubSettings();
    };
  }, []);
}
