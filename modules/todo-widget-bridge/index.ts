import { requireNativeModule } from 'expo-modules-core';

interface TodoWidgetBridgeNativeModule {
  // Returns Bool rather than Void deliberately — see TodoWidgetBridgeModule.swift.
  writeSnapshot(jsonString: string): Promise<boolean>;
  drainPendingCompletions(): Promise<string[]>;
  // Titles queued by AddTaskIntent (the Action Button, Siri, Shortcuts and
  // Spotlight) — see modules/todo-widget-bridge/ios/AddTaskIntent.swift.
  // Read-and-clear, same as drainPendingCompletions.
  drainPendingAddTasks(): Promise<string[]>;
  // Recipe page URLs captured by the share extension (targets/todo-share).
  // Read-and-clear, same as drainPendingCompletions — see
  // src/utils/sharedRecipeLinks.ts.
  drainSharedLinks(): Promise<string[]>;
  // The catalog rows MarkDisposedIntent's entity query matches a spoken item
  // name against — see src/utils/pantryIndex.ts. Written for an extension to
  // read rather than to hand it work, which is why it's separate from the
  // widget snapshot above.
  writePantryIndex(jsonString: string): Promise<boolean>;
  // Disposals queued by MarkDisposedIntent ("mark bananas as used up"). A JSON
  // string rather than an array because each entry is a record; read-and-clear,
  // same as the drains above — see src/utils/widgetSync.ts.
  drainPendingDisposals(): Promise<string>;
  // See src/utils/liveActivity.ts for the JSON shape (TimerRun[]) and the
  // reconciliation this drives.
  syncTimerLiveActivities(jsonString: string): Promise<boolean>;
  // See src/utils/tripLiveActivity.ts for the JSON shape (TripRun) and the
  // reconciliation this drives. Empty string means "no trip wanted".
  syncTripLiveActivity(jsonString: string): Promise<boolean>;
  // See src/utils/focusLiveActivity.ts for the JSON shape (FocusRun) and the
  // reconciliation this drives. Empty string means "no session wanted".
  syncFocusLiveActivity(jsonString: string): Promise<boolean>;
}

const TodoWidgetBridge = requireNativeModule<TodoWidgetBridgeNativeModule>('TodoWidgetBridge');

export function writeWidgetSnapshot(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writeSnapshot(jsonString);
}

export function drainPendingWidgetCompletions(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingCompletions();
}

export function drainPendingAddTasks(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingAddTasks();
}

export function drainSharedLinks(): Promise<string[]> {
  return TodoWidgetBridge.drainSharedLinks();
}

export function writePantryIndex(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writePantryIndex(jsonString);
}

export function drainPendingDisposals(): Promise<string> {
  return TodoWidgetBridge.drainPendingDisposals();
}

export function syncTimerLiveActivities(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncTimerLiveActivities(jsonString);
}

export function syncTripLiveActivity(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncTripLiveActivity(jsonString);
}

export function syncFocusLiveActivity(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncFocusLiveActivity(jsonString);
}
