import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { useTaskStore } from './src/store/useTaskStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { useProjectStore } from './src/store/useProjectStore';
import { requestNotificationPermissions } from './src/utils/notifications';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

function AppContent() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
    </>
  );
}

export default function App() {
  const initTasks = useTaskStore(s => s.initialize);
  const initSettings = useSettingsStore(s => s.initialize);
  const initProjects = useProjectStore(s => s.initialize);

  useEffect(() => {
    // initTasks calls initDatabase() which creates all tables first
    initTasks();
    // Then load settings and projects from the now-initialized DB
    initSettings();
    initProjects();
    // Request notification permissions
    requestNotificationPermissions();
  }, [initTasks, initSettings, initProjects]);

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
