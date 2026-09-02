import React, { useEffect, useState } from 'react';
import { enableScreens } from 'react-native-screens';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AppLockGate } from './src/components/AppLockGate';
import { useTaskStore } from './src/store/useTaskStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { requestNotificationPermissions, isAlarmKitAvailable, requestAlarmAuthorization } from './src/utils/notifications';
import { useDailyAgendaSync } from './src/utils/dailyAgendaSync';
import { useNotificationTapSync } from './src/utils/notificationTapSync';
import { useShakeToUndo } from './src/utils/useShakeToUndo';
import { useTaskDeepLinks } from './src/utils/deepLinks';
import { useHomeScreenQuickActions } from './src/utils/quickActions';
import { useWidgetSync } from './src/utils/widgetSync';
import { useSharedRecipeLinks } from './src/hooks/useSharedRecipeLinks';
import { useStepTimerStore } from './src/store/useStepTimerStore';
import { useTimerLiveActivitySync } from './src/utils/liveActivity';
import { useTripLiveActivitySync } from './src/utils/tripLiveActivity';
import { useFocusLiveActivitySync } from './src/utils/focusLiveActivity';
import { useRemindersImportSync } from './src/utils/remindersImportSync';
import { useCalendarSync } from './src/store/useCalendarStore';
import { useWeatherSync } from './src/store/useWeatherStore';
import { useScreenTimeSync } from './src/store/useScreenTimeStore';
import { useHealthSync } from './src/store/useHealthStore';
import { useFocusShieldSync } from './src/hooks/useFocusShieldSync';
import { useSyncStore } from './src/store/useSyncStore';
import { useSyncOnForeground } from './src/utils/useSyncOnForeground';
import { runStartupSequence, runStartupStep } from './src/utils/startup';
import { expiryPasses, catchUpPasses, retentionPasses } from './src/utils/maintenancePasses';
import { useBackgroundRefresh } from './src/utils/backgroundRefresh';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { preloadAppFont } from './src/theme/AppFont';
import { View } from 'react-native';

// Held open until `AppGate` below knows which font to render in and has it
// loaded, so the first frame the user ever sees is already in the right
// typeface instead of a system-font flash that swaps a few frames later.
SplashScreen.preventAutoHideAsync().catch(() => {});

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
      <AppGate />
    </ErrorBoundary>
  );
}

/**
 * Holds the native splash screen up until the DB is open, settings are
 * loaded, and (if the user picked a bundled typeface) its faces are
 * registered — the three things `AppRoot`'s first render would otherwise
 * commit against stale/default values. `initialize tasks` and `load
 * settings` used to be the first two steps of `AppRoot`'s own startup
 * sequence below; they moved here because that sequence only ever runs
 * *after* the first paint, which is exactly the frame this is trying to
 * avoid.
 */
function AppGate() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      runStartupStep('initialize tasks', () => useTaskStore.getState().initialize());
      runStartupStep('load settings', () => useSettingsStore.getState().initialize());
      runStartupStep('load sync state', () => useSyncStore.getState().initialize());
      await preloadAppFont(useSettingsStore.getState().appFont);
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return <AppRoot />;
}

function AppRoot() {
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const backgroundRefreshEnabled = useSettingsStore(s => s.backgroundRefreshEnabled);
  const initSecrets = useSettingsStore(s => s.initializeSecrets);

  useEffect(() => {
    // Every step is isolated (see src/utils/startup.ts): these are independent
    // of one another, so one that throws costs its own step and nothing else.
    // The order is still load-bearing — the comments below say why each sits
    // where it does — runStartupSequence just refuses to let a failure halfway
    // down take the app with it.
    runStartupSequence([
      // initTasks and initSettings ran already, in AppGate above — before this
      // component even mounted — so the DB is open and settings are loaded by
      // the time any step below runs.
      // The API key, which lives in the keychain rather than the settings table.
      // Async and deliberately not awaited — nothing in the launch sequence below
      // reads it, and the first thing that does is a suggestion the user asks for
      // by tapping. It also migrates the old plaintext row on the first launch
      // after the update, which needs the DB above to exist.
      ['load API key', initSecrets],
      // The passes whose trigger is a clock rather than an edit, in the order
      // they have to run in — the same list, spread from the same module, that
      // the background refresh task runs (src/utils/maintenancePasses.ts). The
      // per-step reasoning moved there with them; what stays here is where the
      // three groups sit relative to the launch-only steps around them.
      //
      // The expiry sweep is first because it needs settings (vacationMode,
      // dayResetTime, autoRemoveExpiredTasks) loaded for real, and has to run
      // before vacation expiry can turn vacationMode back off — see #689.
      ...expiryPasses(),
      ...catchUpPasses(),
      // The purges last, after everything that can write a completion.
      ...retentionPasses(),
      // Read back any cooking step timer that was still counting down when the
      // app was last closed, and re-arm its alarm (#1712). After initSettings,
      // which opens the database this reads from; before the permission
      // request below, because rescheduling is idempotent and a permission
      // that's already granted needs no waiting on.
      ['restore cooking step timers', () => useStepTimerStore.getState().hydrate()],
      // Request notification permissions
      ['request notification permissions', requestNotificationPermissions],
      // AlarmKit has its own authorization, separate from UNUserNotificationCenter
      // above — only meaningful where the platform actually supports it.
      ['request alarm authorization', () => {
        if (isAlarmKitAvailable()) requestAlarmAuthorization();
      }],
    ]);
  }, [initSecrets]);

  // Handle `dundundun://add?title=…` deep links (e.g. from a "Hey Siri" Shortcut).
  // Runs after the init effect above, so the SQLite DB exists before any
  // incoming link tries to insert a task.
  useTaskDeepLinks();

  // Handles a Home Screen quick action (long-press the app icon → Add Task /
  // Groceries / Search / Projects). Same ordering rationale as the deep links
  // above: after the navigator has had a chance to mount. The setting is read
  // here rather than inside the hook so quickActions.ts stays free of the
  // store, and so the Groceries action is republished when it changes.
  useHomeScreenQuickActions(kitchenEnabled);

  // Pulls anything waiting in the chosen Apple Reminders list into the Inbox
  // ("Hey Siri, remind me to…"). Same ordering requirement as the deep links
  // above — the DB has to exist before an imported reminder is inserted.
  useRemindersImportSync();

  // Keeps the in-memory window of device calendar events current. Inert until
  // the calendar read is switched on and a calendar picked; there's no
  // EKEventStoreChanged bridge, so this refreshes on foreground rather than
  // subscribing to anything.
  useCalendarSync();
  // Keeps today's weather reading current, on the same three triggers —
  // inert until weatherTasks is switched on, and never requests location
  // permission itself (see getCurrentLocation).
  useWeatherSync();
  // Keeps the OS usage monitor armed against the current rules and drains
  // what it has reported. Inert until screenTimeTasks is switched on.
  useScreenTimeSync();
  // Keeps today's Health reading current, on the same three triggers. Inert
  // until healthReadEnabled is switched on, and never raises the permission
  // sheet itself — that is the Settings row's job, the line useWeatherSync
  // draws for location.
  useHealthSync();
  // Blocks the chosen apps while a focus session is actually running, and —
  // the half that matters — lifts a shield left in force by a run that
  // crashed. Inert until focusShieldEnabled is switched on.
  useFocusShieldSync();
  useSyncOnForeground();

  // Keeps the iOS Today widget's shared snapshot in sync with the task store.
  useWidgetSync();

  // Keeps the background refresh task registered against the setting — the one
  // thing the app does while it's closed. Everything it runs also runs above,
  // so a device iOS never grants a background run to loses nothing but
  // punctuality. See src/utils/backgroundRefresh.ts.
  useBackgroundRefresh(backgroundRefreshEnabled);

  // Collects recipe pages saved from another app's share sheet (targets/todo-share)
  // into the queue the Recipes screen offers. Same ordering requirement as the
  // deep links above: the queue is persisted to the settings table, so the DB
  // has to exist before the first drain writes to it.
  useSharedRecipeLinks();

  // Keeps a running task/recipe timer's Lock Screen Live Activity in sync.
  useTimerLiveActivitySync();

  // Keeps an active shopping trip's Lock Screen Live Activity in sync.
  useTripLiveActivitySync();

  // Keeps the focus session's Lock Screen Live Activity in sync.
  useFocusLiveActivitySync();

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
