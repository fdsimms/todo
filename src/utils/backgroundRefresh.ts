/**
 * The one thing this app does while it is closed.
 *
 * Until this existed, every decision the app made happened because someone
 * opened it (#2287): a weather rule couldn't add its sunscreen task in the
 * morning unless you happened to open the app in the morning, a pace run
 * stopped nudging after its sixth pending notification, and the home-screen
 * widget showed whatever was true the last time the app was foregrounded.
 *
 * ## It is a top-up, not a guarantee, and that is load-bearing
 *
 * iOS decides when a `BGProcessingTask` runs, from usage patterns, battery and
 * charge state, and **it can decide never** — a user who force-quits the app is
 * one of several ways it simply doesn't fire. So nothing here may be the only
 * place a piece of work happens. Every pass this runs still runs at launch (see
 * `maintenancePasses.ts`) and on foreground (`TodayScreen`), and all of them are
 * idempotent by construction: they were written for a launch sequence that runs
 * on every cold start, so running one an extra time is a no-op by design rather
 * than by luck. Treat that as the constraint on anything added here — a pass
 * that would be *wrong* to run twice is a pass that cannot go in this list.
 *
 * The scheduling reality is worth knowing before expecting much: expo's plugin
 * registers this under `UIBackgroundModes: ['processing']`, so this is a
 * `BGProcessingTask` rather than an app refresh. iOS typically runs those
 * overnight while charging, not every fifteen minutes. That suits the day-roll
 * work well (the generators for the new day are done before you wake up) and
 * suits a two-hourly nudge top-up much less, which is why #2203 is still open
 * with its own routes rather than closed by this.
 *
 * ## Demo mode
 *
 * One check, at the top, and it is enough — but only because of *how* demo mode
 * works. The flag is in-memory and deliberately never persisted
 * (`useDemoStore`), so the two cases are: a cold background launch, where demo
 * mode is off and the real database is open, which is safe by construction; and
 * a run inside a live process that is mid-demo, where the SQLite handle points
 * at the scratch file and `isDemoModeActive()` is true because it is the same JS
 * context. The second is the only hazard and this is the guard for it. Without
 * it the generators would write invented rows into a database about to be thrown
 * away, and — worse — the widget snapshot and the notification queue would be
 * rebuilt from fiction, which outlives the demo.
 *
 * ## What it deliberately does not do
 *
 * - **No weather read.** Refreshing the forecast needs a location read, and the
 *   app's `NSLocationWhenInUseUsageDescription` says in as many words that it
 *   "only reads your location once a day when this is turned on, and never in
 *   the background". Doing it here would break a promise made in the permission
 *   sheet. `checkWeatherTasks` still runs and still refuses a snapshot that
 *   isn't today's, so it is a no-op here rather than a wrong answer.
 * - **No deletes.** `expiryPasses` and `retentionPasses` are launch-only — see
 *   the note in `maintenancePasses.ts` for why.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';
import { runStartupSequence, runStartupStep } from './startup';
import { catchUpPasses, rebuildNotificationQueue } from './maintenancePasses';
import { writeWidgetSnapshotNow } from './widgetSync';

/**
 * Namespaced to this app rather than reusing expo's own permitted identifier
 * (`com.expo.modules.backgroundtask.processing`, which its config plugin puts in
 * the Info.plist). That one names the *native* task expo registers with
 * `BGTaskScheduler`; this names a JS task inside it, and every registered task
 * shares that single native slot.
 */
export const BACKGROUND_REFRESH_TASK = 'dundundun-background-refresh';

/**
 * How long iOS is asked to wait between runs, in minutes. The floor the API
 * accepts is 15 and the default is 720; this asks for four hours because the
 * work is a day-roll and a queue top-up rather than anything urgent, and asking
 * for less than the system will grant only spends battery being refused.
 */
export const BACKGROUND_REFRESH_INTERVAL_MINUTES = 4 * 60;

/** What a run did, for the tests and for the log line below. */
export type BackgroundRefreshOutcome =
  | { ran: false; reason: 'demo' }
  | { ran: true; failed: string[] };

/**
 * The whole background run, as a plain function so it can be tested without
 * going near `TaskManager`.
 *
 * Synchronous throughout, like every other data path in this app: `expo-sqlite`
 * is `runSync`/`getAllSync`, so there is nothing to await and no window for iOS
 * to expire the task in the middle of a half-finished write.
 */
export function runBackgroundRefresh(): BackgroundRefreshOutcome {
  if (isDemoModeActive()) return { ran: false, reason: 'demo' };

  // A cold background launch has no React tree, so `AppGate`'s two init steps
  // have not run and the database is not open. A warm one (the process is alive,
  // merely backgrounded) has both already, and must not be re-initialized:
  // `initialize()` reloads every store from disk, which would throw away
  // whatever the user was in the middle of when they switched away.
  //
  // Outside the sequence below, and the one step here that *does* short-circuit,
  // because it is the only one the others depend on: the launch sequence's steps
  // are independent of each other, which is what makes isolating them the right
  // answer there, but a pass that runs against a database that failed to open
  // just throws too. Bailing reports one useful failure instead of nineteen
  // identical ones.
  const opened = runStartupStep('initialize stores', () => {
    if (useSettingsStore.getState().initialized) return;
    // Same order as AppGate: tasks first (it opens the database and fans out
    // to every other store), then settings.
    useTaskStore.getState().initialize();
    useSettingsStore.getState().initialize();
  });
  if (!opened) return { ran: true, failed: ['initialize stores'] };

  const failed = runStartupSequence([
    ...catchUpPasses(),
    // After the passes, not before: they are what writes the tasks whose
    // reminders this lays down, and a rebuild that ran first would schedule the
    // queue the app had when it went to sleep.
    ['rebuild notification queue', rebuildNotificationQueue],
    // Last, for the same reason — the snapshot should describe the list as the
    // passes above left it, not as it was.
    ['write widget snapshot', writeWidgetSnapshotNow],
  ]);

  return { ran: true, failed };
}

// Registered at module scope, which is what makes a *cold* background launch
// work at all: iOS starts the app with no UI, the bundle evaluates, and this is
// what has to already exist by the time the native task looks for its handler.
// A `defineTask` call inside a component would never run.
// `async` only because TaskManager's executor type demands a promise. The work
// itself is synchronous (expo-sqlite is runSync throughout), which is what
// makes it safe against iOS expiring the task: there is no await for it to be
// interrupted at, so a run either completes or never starts.
TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () => {
  try {
    const outcome = runBackgroundRefresh();
    // A pass that threw was already isolated and logged by name
    // (runStartupSequence); the run as a whole still succeeded, and reporting
    // failure would only make iOS less willing to run the next one.
    if (outcome.ran && outcome.failed.length > 0) {
      console.error('Background refresh finished with failed steps', outcome.failed);
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('Background refresh failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Keeps the registration matching the setting.
 *
 * Registering is persistent on iOS — it survives relaunches — so this has to
 * unregister as well as register, or switching the setting off would leave the
 * task running until the app was reinstalled.
 */
export function useBackgroundRefresh(enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    (async () => {
      try {
        const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK);
        if (cancelled) return;
        if (enabled && !registered) {
          await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
            minimumInterval: BACKGROUND_REFRESH_INTERVAL_MINUTES,
          });
        } else if (!enabled && registered) {
          await BackgroundTask.unregisterTaskAsync(BACKGROUND_REFRESH_TASK);
        }
      } catch (error) {
        // A simulator, a build without the native module, or a device that has
        // background refresh switched off system-wide. None of those is worth
        // surfacing: everything this task does still happens at launch.
        console.error('Background refresh registration failed', error);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
}
