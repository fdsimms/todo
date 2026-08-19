import { requireNativeModule } from 'expo-modules-core';

interface TodoWidgetBridgeNativeModule {
  // Returns Bool rather than Void deliberately — see TodoWidgetBridgeModule.swift.
  writeSnapshot(jsonString: string): Promise<boolean>;
  drainPendingCompletions(): Promise<string[]>;
  // The Share extension's queue of shared recipe page addresses — see
  // src/utils/sharedRecipeImport.ts.
  drainSharedRecipeUrls(): Promise<string[]>;
  // See src/utils/liveActivity.ts for the JSON shape (TimerRun[]) and the
  // reconciliation this drives.
  syncTimerLiveActivities(jsonString: string): Promise<boolean>;
  drainPendingTimerStops(): Promise<string[]>;
  // See src/utils/tripLiveActivity.ts for the JSON shape (TripRun) and the
  // reconciliation this drives. Empty string means "no trip wanted".
  syncTripLiveActivity(jsonString: string): Promise<boolean>;
}

const TodoWidgetBridge = requireNativeModule<TodoWidgetBridgeNativeModule>('TodoWidgetBridge');

export function writeWidgetSnapshot(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writeSnapshot(jsonString);
}

export function drainPendingWidgetCompletions(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingCompletions();
}

export function drainSharedRecipeUrls(): Promise<string[]> {
  return TodoWidgetBridge.drainSharedRecipeUrls();
}

export function syncTimerLiveActivities(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncTimerLiveActivities(jsonString);
}

export function drainPendingTimerStops(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingTimerStops();
}

export function syncTripLiveActivity(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncTripLiveActivity(jsonString);
}
