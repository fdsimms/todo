import { requireNativeModule } from 'expo-modules-core';

interface TodoWidgetBridgeNativeModule {
  // Returns Bool rather than Void deliberately — see TodoWidgetBridgeModule.swift.
  writeSnapshot(jsonString: string): Promise<boolean>;
  drainPendingCompletions(): Promise<string[]>;
  // When each queued completion was tapped, id -> ISO 8601. Read-and-clear.
  drainPendingCompletionTimes(): Promise<Record<string, string>>;
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
  // Taps the widget applied without opening the app: CompleteTaskQuietlyIntent
  // and CheckGroceryItemIntent (targets/todo-widget/WidgetQuietIntents.swift).
  // A JSON string of records, read-and-clear — see src/utils/widgetQuietTaps.ts.
  drainQuietTaps(): Promise<string>;
  // See src/utils/liveActivity.ts for the JSON shape (TimerRun[]) and the
  // reconciliation this drives.
  syncTimerLiveActivities(jsonString: string): Promise<boolean>;
  // See src/utils/tripLiveActivity.ts for the JSON shape (TripRun) and the
  // reconciliation this drives. Empty string means "no trip wanted".
  syncTripLiveActivity(jsonString: string): Promise<boolean>;
  // See src/utils/focusLiveActivity.ts for the JSON shape (FocusRun) and the
  // reconciliation this drives. Empty string means "no session wanted".
  syncFocusLiveActivity(jsonString: string): Promise<boolean>;
  // The Apple Watch's copy of the widget snapshot (WidgetSnapshot JSON, built
  // with WATCH_LIMITS). Sent on over WatchConnectivity by WatchSession.swift;
  // a no-op without a paired watch that has the app.
  writeWatchSnapshot(jsonString: string): Promise<boolean>;
  // Fired when a watch tap or dictated task has just joined the queues the
  // drains above read, so a running app can drain now.
  addListener(eventName: 'onWatchQueuedWork', listener: () => void): { remove(): void };
  // Puts quiet taps (QuietTap[] JSON) back at the front of their queue, for a
  // drain that ran with nobody there to hand them to — see tapsToRequeue in
  // src/utils/widgetQuietTaps.ts.
  requeueQuietTaps(jsonString: string): Promise<boolean>;
}

const TodoWidgetBridge = requireNativeModule<TodoWidgetBridgeNativeModule>('TodoWidgetBridge');

export function writeWidgetSnapshot(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writeSnapshot(jsonString);
}

export function drainPendingWidgetCompletions(): Promise<string[]> {
  return TodoWidgetBridge.drainPendingCompletions();
}

export function drainPendingWidgetCompletionTimes(): Promise<Record<string, string>> {
  return TodoWidgetBridge.drainPendingCompletionTimes();
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

export function drainQuietWidgetTaps(): Promise<string> {
  return TodoWidgetBridge.drainQuietTaps();
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

export function writeWatchSnapshot(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writeWatchSnapshot(jsonString);
}

export function addWatchQueuedWorkListener(listener: () => void): { remove(): void } {
  return TodoWidgetBridge.addListener('onWatchQueuedWork', listener);
}

export function requeueQuietTaps(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.requeueQuietTaps(jsonString);
}
