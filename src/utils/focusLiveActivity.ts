import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { FocusSession, Task } from '../types';
import { useFocusStore } from '../store/useFocusStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { currentFocusStep, isFocusSessionFinished } from './focusPlan';
import { formatStopwatch } from './effort';
import { displayTitleFor } from './visibilityUtils';
import { widgetBridge } from './widgetBridge';

/**
 * Drives the "focus session" Live Activity (Lock Screen + Dynamic Island) —
 * see docs/arch/focus-sessions.md and targets/todo-widget/FocusLiveActivity.swift.
 * The third of the three (liveActivity.ts for a running timer, tripLiveActivity.ts
 * for a shopping trip), and shaped like the trip one: there is only ever one
 * session, so the native side reconciles against zero-or-one activities rather
 * than a keyed set.
 *
 * **The payload is a pure function of the stored session** — never of the
 * clock. A step's end is `stepStartedAt + (its minutes - what's already
 * banked)`, which is fixed the moment the step's clock starts, so SwiftUI's
 * `Text(timerInterval:)` counts it down on its own with no pushes from here.
 * That matters more than it does for a timer run: this syncs on every task
 * write, and a payload that read `Date.now()` would differ every time, tearing
 * the activity down and starting a new one on each keystroke in the task list
 * behind it.
 *
 * Nothing is ever updated in place, same rule the other two activities keep.
 * Advancing, pausing, resuming, extending a step, or pruning a task out of the
 * plan all end the current activity and start a fresh one — which is exactly
 * what `key` is for below.
 *
 * The two states the activity draws are the two the session sheet draws, and
 * the split is `staleDate`: the native side hands ActivityKit the step's own
 * end as the stale date, so `context.isStale` flips to true at the moment the
 * step runs out with nothing pushed to it. Before that the activity counts
 * down and its button pauses; after, it counts *up* as an over-run and the
 * button moves to the next step. That's the feature's central rule (a step
 * that reaches zero does not advance — see the arch doc) rendered on the Lock
 * Screen rather than only inside the app.
 */

const TITLE_MAX = 60;
const DEBOUNCE_MS = 300;

export interface FocusRun {
  /**
   * Identity of this exact rendering: the whole payload, JSON-encoded.
   *
   * The native side keeps the live activity when the key it already has
   * matches and restarts it when it doesn't, so the key has to cover every
   * field that's drawn — a hand-listed subset is the kind that silently stops
   * covering a field added next to it. Encoding the payload itself can't go
   * stale that way, and it's never parsed: it's compared, as one opaque
   * string.
   */
  key: string;
  /** The task being worked on, or 'Break' / 'Long break'. */
  title: string;
  /** 'Step 3 of 9'. */
  subtitle: string;
  symbolName: string;
  /** When the current step's clock started. Unused while paused. */
  startedAtMs: number;
  /** When the step runs out. Clamped to never precede startedAtMs. */
  targetEndMs: number;
  paused: boolean;
  /** The frozen figure shown instead of a countdown while paused. */
  pausedRemaining: string;
  /** The button before the step runs out: 'Pause' / 'Resume'. */
  primaryLabel: string;
  primaryUrl: string;
  /** The button once it has: 'Next task' / 'Start break' / 'Finish'. */
  advanceLabel: string;
  advanceUrl: string;
}

function truncate(title: string): string {
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/**
 * Pure. The running session's Live Activity payload, or null when there's
 * nothing to show.
 *
 * Null covers the four ways there's no run: the setting is off, no session
 * exists, the plan has been worked through (the summary is an in-app screen —
 * a Live Activity describes a run in flight), and the session whose steps have
 * all been pruned away.
 */
export function buildFocusRun(
  session: FocusSession | null,
  tasks: readonly Task[],
  opts: { enabled: boolean },
): FocusRun | null {
  if (!opts.enabled || session === null || isFocusSessionFinished(session)) return null;
  const step = currentFocusStep(session);
  if (step === null) return null;

  const task = step.taskId === null ? undefined : tasks.find(t => t.id === step.taskId);
  const isRest = step.kind === 'rest';
  // 'Focusing' matches FocusBar's own fallback for a work step whose task has
  // gone from the list — a state syncWithTasks closes on the next write, but
  // the strip and this must say something in the meantime.
  const title = isRest
    ? (step.long ? 'Long break' : 'Break')
    : task
      ? truncate(displayTitleFor(task))
      : 'Focusing';

  // Everything below is derived from stored fields only — see the header for
  // why reading the clock here would restart the activity on every sync.
  //
  // A paused step has no start instant at all (`stepStartedAt` is null, which
  // is what paused *means* here), so both dates fall back to the session's own
  // start. Nothing draws them in that state — `pausedRemaining` is what the
  // paused activity shows — but they still have to be some fixed value, since
  // they're part of the key.
  const paused = session.stepStartedAt === null;
  const startedAtMs = Date.parse(paused ? session.startedAt : (session.stepStartedAt as string));
  const remainingSeconds = step.minutes * 60 - Math.max(0, session.stepElapsedSeconds);
  // Clamped like buildTimerRuns': a step resumed after it had already run out
  // would otherwise hand SwiftUI's Text(timerInterval:) an inverted range,
  // which crashes the extension rather than rendering oddly.
  const targetEndMs = Math.max(startedAtMs, startedAtMs + remainingSeconds * 1000);

  const nextStep = session.steps[session.stepIndex + 1];
  const advanceLabel = nextStep === undefined
    ? 'Finish'
    : nextStep.kind === 'rest' ? 'Start break' : 'Next task';

  const run = {
    title,
    subtitle: `Step ${session.stepIndex + 1} of ${session.steps.length}`,
    // SF Symbols, the closest pair to the hourglass/cafe glyphs FocusBar uses.
    symbolName: isRest ? 'cup.and.saucer.fill' : 'hourglass',
    startedAtMs,
    targetEndMs,
    paused,
    // Signed the way FocusBar and the session sheet sign it: a step paused
    // past its target reads '+2:07', not '0:00'.
    pausedRemaining: remainingSeconds < 0
      ? `+${formatStopwatch(-remainingSeconds)}`
      : formatStopwatch(remainingSeconds),
    primaryLabel: paused ? 'Resume' : 'Pause',
    primaryUrl: paused ? 'dundundun://focus?do=resume' : 'dundundun://focus?do=pause',
    advanceLabel,
    advanceUrl: 'dundundun://focus?do=next',
  };
  return { key: JSON.stringify(run), ...run };
}

// Through widgetBridge(), same as the other two Live Activities.
function syncNativeFocusActivity(run: FocusRun | null): void {
  const bridge = widgetBridge();
  if (!bridge) return;
  // Fire-and-forget: nothing here needs to block on the native reconcile
  // completing, and a failure must never surface anywhere in the app UI.
  bridge.syncFocusLiveActivity(run ? JSON.stringify(run) : '').catch(() => {});
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRun: FocusRun | null = null;

function scheduleSync(run: FocusRun | null): void {
  pendingRun = run;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncNativeFocusActivity(pendingRun), DEBOUNCE_MS);
}

// Keeps the focus session's Live Activity in sync with the stored session.
// Subscribed rather than threaded through advance/pause/resume/extend, same
// rationale useTimerLiveActivitySync gives — and here it also covers the
// writes the store makes on its own behalf, when syncWithTasks prunes a
// completed task's stretches out of the plan.
//
// Debounced, unlike the trip activity's sync: the task list is a dependency
// (a work step is drawn with its task's title), so this is woken by every task
// write in the app, not only by the handful that change the session.
export function useFocusLiveActivitySync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => {
      const enabled = useSettingsStore.getState().focusLiveActivity;
      scheduleSync(buildFocusRun(
        useFocusStore.getState().session,
        useTaskStore.getState().tasks,
        { enabled },
      ));
    };

    const unsubFocus = useFocusStore.subscribe((state, prevState) => {
      if (state.session !== prevState.session) sync();
    });
    const unsubTasks = useTaskStore.subscribe((state, prevState) => {
      if (state.tasks !== prevState.tasks) sync();
    });
    const unsubSettings = useSettingsStore.subscribe((state, prevState) => {
      if (state.focusLiveActivity !== prevState.focusLiveActivity) sync();
    });

    sync();

    return () => {
      unsubFocus();
      unsubTasks();
      unsubSettings();
    };
  }, []);
}
