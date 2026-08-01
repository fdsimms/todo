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
import { useShakeToUndo } from './src/utils/useShakeToUndo';
import { useTaskDeepLinks } from './src/utils/deepLinks';
import { useWidgetSync } from './src/utils/widgetSync';
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

  useEffect(() => {
    // initTasks calls initDatabase() which creates all tables first
    initTasks();
    // Then load settings from the now-initialized DB
    initSettings();
    // Request notification permissions
    requestNotificationPermissions();
  }, [initTasks, initSettings]);

  // Handle `dundundun://add?title=…` deep links (e.g. from a "Hey Siri" Shortcut).
  // Runs after the init effect above, so the SQLite DB exists before any
  // incoming link tries to insert a task.
  useTaskDeepLinks();

  // Keeps the iOS Today widget's shared snapshot in sync with the task store.
  useWidgetSync();

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
