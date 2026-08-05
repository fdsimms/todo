import { requireNativeModule } from 'expo-modules-core';

interface TodoWidgetBridgeNativeModule {
  // Returns Bool rather than Void deliberately — see TodoWidgetBridgeModule.swift.
  writeSnapshot(jsonString: string): Promise<boolean>;
  drainPendingCompletions(): Promise<string[]>;
  liveActivitiesEnabled(): Promise<boolean>;
  startLinkLiveActivity(
    taskId: string,
    title: string,
    subtitle: string,
    symbolName: string,
    streakCount: number,
    staleAfterSeconds: number,
  ): Promise<boolean>;
  endLinkLiveActivities(): Promise<boolean>;
}

const TodoWidgetBridge = requireNativeModule<TodoWidgetBridgeNativeModule>('TodoWidgetBridge');

export function writeWidgetSnapshot(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writeSnapshot(jsonString);
}

export function drainPendingWidgetCompletions(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingCompletions();
}

export function liveActivitiesEnabled(): Promise<boolean> {
  return TodoWidgetBridge.liveActivitiesEnabled();
}

export function startLinkLiveActivity(
  taskId: string,
  title: string,
  subtitle: string,
  symbolName: string,
  streakCount: number,
  staleAfterSeconds: number,
): Promise<boolean> {
  return TodoWidgetBridge.startLinkLiveActivity(taskId, title, subtitle, symbolName, streakCount, staleAfterSeconds);
}

export function endLinkLiveActivities(): Promise<boolean> {
  return TodoWidgetBridge.endLinkLiveActivities();
}
