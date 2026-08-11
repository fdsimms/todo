import React, { useEffect } from 'react';
import { enableScreens } from 'react-native-screens';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AppLockGate } from './src/components/AppLockGate';
import { useTaskStore } from './src/store/useTaskStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { useMealPlanStore } from './src/store/useMealPlanStore';
import { useLeftoverStore } from './src/store/useLeftoverStore';
import { requestNotificationPermissions, isAlarmKitAvailable, requestAlarmAuthorization } from './src/utils/notifications';
import { useDailyAgendaSync } from './src/utils/dailyAgendaSync';
import { useNotificationTapSync } from './src/utils/notificationTapSync';
import { useShakeToUndo } from './src/utils/useShakeToUndo';
import { useTaskDeepLinks } from './src/utils/deepLinks';
import { useHomeScreenQuickActions } from './src/utils/quickActions';
import { useWidgetSync } from './src/utils/widgetSync';
import { useRemindersImportSync } from './src/utils/remindersImportSync';
import { runStartupSequence } from './src/utils/startup';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { View } from 'react-native';

// Disables react-native-screens' native optimizations app-wide, called once
// before any navigator mounts. Workaround for a crash in
// -[RNSTabBarController updateTabBarAppearance] on iOS 26 production builds
// on newer Apple Silicon devices — see
// https://github.com/software-mansion/react-native-screens/issues/3940.
// react-native-screens falls back to plain React Native views for
// navigation instead of native UIViewController-backed screens; the app's
// tab bar and navigation behave identically, just without that native
// optimization layer.
enableScreens(false);

function AppContent() {
  const { isDark } = useTheme();
  const shakeToUndoEnabled = useSettingsStore(s => s.shakeToUndoEnabled);
  useShakeToUndo(shakeToUndoEnabled);
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
      {/* Inside ThemeProvider (it's a themed screen) and last, so its overlay
          sits above the navigator. */}
      <AppLockGate />
    </View>
  );
}

// The ErrorBoundary has to be *above* everything that runs at launch, which
// means App itself can hold nothing but the boundary. It used to render the
// boundary and the whole startup sequence side by side — but a boundary only
// catches what its children throw, so every one of those calls sat outside the
// one thing meant to catch them, and React answers an uncaught error by
// unmounting the root. The app got past the splash and went black, with the
// message nowhere. AppRoot is a child, so now it doesn't.
export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}

function AppRoot() {
  const initTasks = useTaskStore(s => s.initialize);
  const initSettings = useSettingsStore(s => s.initialize);
  const initSecrets = useSettingsStore(s => s.initializeSecrets);
  const sweepExpiredTasks = useTaskStore(s => s.sweepExpiredTasks);
  const checkVacationExpiry = useTaskStore(s => s.checkVacationExpiry);
  const rolloverQuotas = useTaskStore(s => s.rolloverQuotas);
  const sweepOvershootQuotas = useTaskStore(s => s.sweepOvershootQuotas);
  const dripStalledProjects = useTaskStore(s => s.dripStalledProjects);
  const checkMealPlanNudge = useTaskStore(s => s.checkMealPlanNudge);
  const purgeOldCompletedTasks = useTaskStore(s => s.purgeOldCompletedTasks);
  const purgeOldMealPlanEntries = useMealPlanStore(s => s.purgeOldEntries);
  const purgeOldLeftovers = useLeftoverStore(s => s.purgeOldLeftovers);

  useEffect(() => {
    // Every step is isolated (see src/utils/startup.ts): these are independent
    // of one another, so one that throws costs its own step and nothing else.
    // The order is still load-bearing — the comments below say why each sits
    // where it does — runStartupSequence just refuses to let a failure halfway
    // down take the app with it.
    runStartupSequence([
      // initTasks calls initDatabase() which creates all tables first
      ['initialize tasks', initTasks],
      // Then load settings from the now-initialized DB
      ['load settings', initSettings],
      // The API key, which lives in the keychain rather than the settings table.
      // Async and deliberately not awaited — nothing in the launch sequence below
      // reads it, and the first thing that does is a suggestion the user asks for
      // by tapping. It also migrates the old plaintext row on the first launch
      // after the update, which needs the DB above to exist.
      ['load API key', initSecrets],
      // Sweep expired tasks now that settings (vacationMode, dayResetTime,
      // autoRemoveExpiredTasks) are loaded for real, before vacation expiry
      // can turn vacationMode back off — see issue #689.
      ['sweep expired tasks', sweepExpiredTasks],
      // Turn vacation mode back off if its end date already passed while the
      // app was closed
      ['check vacation expiry', checkVacationExpiry],
      // Close out quota tasks whose day ended unfinished while the app was
      // closed, so a day you fell short on is logged as a partial instead of
      // sitting overdue — also needs real settings (dayResetTime) loaded first.
      ['roll over quotas', rolloverQuotas],
      // Opt-in counterpart to the pass above: an allowOvershoot task rides
      // out its whole day instead of auto-completing at target, so it needs
      // its own end-of-day close — see sweepOvershootQuotas in useTaskStore.ts.
      ['sweep overshoot quotas', sweepOvershootQuotas],
      // Let projects the user opted into auto-scheduling date their own next
      // task if they've run dry. After rolloverQuotas, which can complete and
      // spawn members and so change what a project counts as scheduled; and
      // after initSettings, since "quiet" is measured in logical days.
      ['drip stalled projects', dripStalledProjects],
      // Opt-in weekly nudge to plan the coming week's meals (#1121) — off by
      // default. After initSettings, since it reads mealPlanNudge* and
      // weekStartsOn, and after initTasks, whose fan-out creates the meal
      // plan tables it queries directly.
      ['check meal plan nudge', checkMealPlanNudge],
      // Enforce the completed-task retention window, if the user set one. Last
      // of the maintenance passes on purpose: it only ever deletes rows old
      // enough to be out of every other pass's reach, and running it after
      // rolloverQuotas means a completion that pass just wrote is judged on the
      // same footing as any other.
      ['purge old completed tasks', purgeOldCompletedTasks],
      // The meal plan's own horizon, alongside it rather than inside it: these
      // are per-event rows on a fixed 180-day window, deliberately not wired to
      // completedRetentionDays — that setting is a promise about the Logbook,
      // and "keep completions forever" must not also mean four years of dinners.
      ['purge old meal plan entries', purgeOldMealPlanEntries],
      // And the fridge's, which only ever takes rows the user already closed
      // out — a container nobody said they finished survives this however old
      // it is, because that is exactly the one the nudge exists to surface.
      ['purge old leftovers', purgeOldLeftovers],
      // Request notification permissions
      ['request notification permissions', requestNotificationPermissions],
      // AlarmKit has its own authorization, separate from UNUserNotificationCenter
      // above — only meaningful where the platform actually supports it.
      ['request alarm authorization', () => {
        if (isAlarmKitAvailable()) requestAlarmAuthorization();
      }],
    ]);
  }, [initTasks, initSettings, initSecrets, sweepExpiredTasks, checkVacationExpiry, rolloverQuotas, sweepOvershootQuotas, dripStalledProjects, checkMealPlanNudge, purgeOldCompletedTasks, purgeOldMealPlanEntries, purgeOldLeftovers]);

  // Handle `dundundun://add?title=…` deep links (e.g. from a "Hey Siri" Shortcut).
  // Runs after the init effect above, so the SQLite DB exists before any
  // incoming link tries to insert a task.
  useTaskDeepLinks();

  // Handles a Home Screen quick action (long-press the app icon → Add Task /
  // Groceries / Search / Projects). Same ordering rationale as the deep links
  // above: after the navigator has had a chance to mount.
  useHomeScreenQuickActions();

  // Pulls anything waiting in the chosen Apple Reminders list into the Inbox
  // ("Hey Siri, remind me to…"). Same ordering requirement as the deep links
  // above — the DB has to exist before an imported reminder is inserted.
  useRemindersImportSync();

  // Keeps the iOS Today widget's shared snapshot in sync with the task store.
  useWidgetSync();

  // Keeps the pending daily agenda's count matching the tasks it describes.
  useDailyAgendaSync();

  // Navigates to Today when a reminder/alarm notification is tapped.
  useNotificationTapSync();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
