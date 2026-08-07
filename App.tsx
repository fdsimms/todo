import React, { useEffect } from 'react';
import { enableScreens } from 'react-native-screens';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useTaskStore } from './src/store/useTaskStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { requestNotificationPermissions } from './src/utils/notifications';
import { useDailyAgendaSync } from './src/utils/dailyAgendaSync';
import { useShakeToUndo } from './src/utils/useShakeToUndo';
import { useTaskDeepLinks } from './src/utils/deepLinks';
import { useWidgetSync } from './src/utils/widgetSync';
import { useRemindersImportSync } from './src/utils/remindersImportSync';
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
  useShakeToUndo();
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
    </View>
  );
}

export default function App() {
  const initTasks = useTaskStore(s => s.initialize);
  const initSettings = useSettingsStore(s => s.initialize);
  const sweepExpiredTasks = useTaskStore(s => s.sweepExpiredTasks);
  const checkVacationExpiry = useTaskStore(s => s.checkVacationExpiry);
  const rolloverQuotas = useTaskStore(s => s.rolloverQuotas);
  const dripStalledProjects = useTaskStore(s => s.dripStalledProjects);
  const purgeOldCompletedTasks = useTaskStore(s => s.purgeOldCompletedTasks);

  useEffect(() => {
    // initTasks calls initDatabase() which creates all tables first
    initTasks();
    // Then load settings from the now-initialized DB
    initSettings();
    // Sweep expired tasks now that settings (vacationMode, dayResetTime,
    // autoRemoveExpiredTasks) are loaded for real, before vacation expiry
    // can turn vacationMode back off — see issue #689.
    sweepExpiredTasks();
    // Turn vacation mode back off if its end date already passed while the
    // app was closed
    checkVacationExpiry();
    // Close out quota tasks whose day ended unfinished while the app was
    // closed, so a day you fell short on is logged as a partial instead of
    // sitting overdue — also needs real settings (dayResetTime) loaded first.
    rolloverQuotas();
    // Let projects the user opted into auto-scheduling date their own next
    // task if they've run dry. After rolloverQuotas, which can complete and
    // spawn members and so change what a project counts as scheduled; and
    // after initSettings, since "quiet" is measured in logical days.
    dripStalledProjects();
    // Enforce the completed-task retention window, if the user set one. Last
    // of the maintenance passes on purpose: it only ever deletes rows old
    // enough to be out of every other pass's reach, and running it after
    // rolloverQuotas means a completion that pass just wrote is judged on the
    // same footing as any other.
    purgeOldCompletedTasks();
    // Request notification permissions
    requestNotificationPermissions();
  }, [initTasks, initSettings, sweepExpiredTasks, checkVacationExpiry, rolloverQuotas, dripStalledProjects, purgeOldCompletedTasks]);

  // Handle `dundundun://add?title=…` deep links (e.g. from a "Hey Siri" Shortcut).
  // Runs after the init effect above, so the SQLite DB exists before any
  // incoming link tries to insert a task.
  useTaskDeepLinks();

  // Pulls anything waiting in the chosen Apple Reminders list into the Inbox
  // ("Hey Siri, remind me to…"). Same ordering requirement as the deep links
  // above — the DB has to exist before an imported reminder is inserted.
  useRemindersImportSync();

  // Keeps the iOS Today widget's shared snapshot in sync with the task store.
  useWidgetSync();

  // Keeps the pending daily agenda's count matching the tasks it describes.
  useDailyAgendaSync();

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AppContent />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
