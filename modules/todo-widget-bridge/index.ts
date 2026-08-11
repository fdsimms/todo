import { requireNativeModule } from 'expo-modules-core';

interface TodoWidgetBridgeNativeModule {
  // Returns Bool rather than Void deliberately — see TodoWidgetBridgeModule.swift.
  writeSnapshot(jsonString: string): Promise<boolean>;
  drainPendingCompletions(): Promise<string[]>;
  // See src/utils/liveActivity.ts for the JSON shape (TimerRun[]) and the
  // reconciliation this drives.
  syncTimerLiveActivities(jsonString: string): Promise<boolean>;
  drainPendingTimerStops(): Promise<string[]>;
}

const TodoWidgetBridge = requireNativeModule<TodoWidgetBridgeNativeModule>('TodoWidgetBridge');

export function writeWidgetSnapshot(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writeSnapshot(jsonString);
}

export function drainPendingWidgetCompletions(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingCompletions();
}

export function syncTimerLiveActivities(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncTimerLiveActivities(jsonString);
}

export function drainPendingTimerStops(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingTimerStops();
}
