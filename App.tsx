import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { useTaskStore } from './src/store/useTaskStore';
import { useSettingsStore } from './src/store/useSettingsStore';

export default function App() {
  const initTasks = useTaskStore(s => s.initialize);
  const initSettings = useSettingsStore(s => s.initialize);

  useEffect(() => {
    // initTasks calls initDatabase() which creates all tables first
    initTasks();
    // Then load settings from the now-initialized DB
    initSettings();
  }, [initTasks, initSettings]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
