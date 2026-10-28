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
  // Screenshots the share extension saved to be read for tasks — see
  // src/hooks/useSharedTaskImages.ts. Unlike drainSharedLinks these are not
  // read-and-clear: the file stays until `deleteSharedImage`, since it is the
  // only copy until a person acts on it.
  listSharedImages(): Promise<string[]>;
  readSharedImage(name: string): Promise<string | null>;
  deleteSharedImage(name: string): Promise<boolean>;
  // The catalog rows MarkDisposedIntent's entity query matches a spoken item
  // name against — see src/utils/pantryIndex.ts. Written for an extension to
  // read rather than to hand it work, which is why it's separate from the
  // widget snapshot above.
  writePantryIndex(jsonString: string): Promise<boolean>;
  // Disposals queued by MarkDisposedIntent ("mark bananas as used up"). A JSON
  // string rather than an array because each entry is a record; read-and-clear,
  // same as the drains above — see src/utils/widgetSync.ts.
  drainPendingDisposals(): Promise<string>;
  // The medications LogMedicationIntent's entity query matches a spoken name
  // against — see src/utils/medicationIndex.ts.
  writeMedicationIndex(jsonString: string): Promise<boolean>;
  // Doses queued by LogMedicationIntent ("log ibuprofen"). A JSON string of
  // records, read-and-clear — see src/utils/widgetSync.ts.
  drainPendingDoses(): Promise<string>;
  // Dreams queued by LogDreamIntent ("log a dream"). A JSON string of
  // `{ text, at }` records, read-and-clear — see src/utils/widgetSync.ts.
  drainPendingDreams(): Promise<string>;
  // Meals described by LogFoodIntent ("log food"). A JSON string of
  // `{ text, at }` records, read-and-clear — see src/utils/foodQueue.ts.
  drainPendingFoods(): Promise<string>;
  drainPendingShortcutActions(): Promise<string>;
  // Key codes queued by ToggleKeyLockIntent (the Shortcuts action a tag
  // automation runs). A JSON string of `{ code, at }` records, read-and-clear
  // — see src/utils/keyScanQueue.ts.
  drainPendingKeyScans(): Promise<string>;
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
  // See src/utils/leaveLiveActivity.ts for the JSON shape (LeaveRun) and the
  // reconciliation this drives. Empty string means "no leave-by wanted".
  syncLeaveLiveActivity(jsonString: string): Promise<boolean>;
  // See src/utils/focusLiveActivity.ts for the JSON shape (FocusRun) and the
  // reconciliation this drives. Empty string means "no session wanted".
  syncFocusLiveActivity(jsonString: string): Promise<boolean>;
  // See src/utils/workoutLiveActivity.ts for the JSON shape (WorkoutRun). The
  // one activity updated in place rather than restarted. Empty string means
  // "no workout wanted".
  syncWorkoutLiveActivity(jsonString: string): Promise<boolean>;
  // The routines StartRoutineIntent's entity query matches a spoken name
  // against — see src/utils/workoutSiri.ts.
  writeWorkoutRoutineIndex(jsonString: string): Promise<boolean>;
  // Workout starts queued by StartWorkoutIntent and StartRoutineIntent. A
  // JSON string of `{ routineId, name, at }` records, read-and-clear — see
  // src/utils/widgetSync.ts.
  drainPendingWorkoutStarts(): Promise<string>;
  // The Apple Watch's copy of the widget snapshot (WidgetSnapshot JSON, built
  // with WATCH_CAPS). Sent on over WatchConnectivity by WatchSession.swift;
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

// Whether this binary's native module has a function. The functions added
// after the first release are exported as undefined when it doesn't, which is
// what `WidgetBridge` (src/utils/widgetBridge.ts) types them optional for: a
// JS bundle run against an older native build (a dev client built before the
// function existed) skips the call rather than throwing from inside a timer.
function hasNative(name: keyof TodoWidgetBridgeNativeModule): boolean {
  return typeof (TodoWidgetBridge as unknown as Record<string, unknown>)[name] === 'function';
}

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

export function listSharedImages(): Promise<string[]> {
  return TodoWidgetBridge.listSharedImages();
}

export function readSharedImage(name: string): Promise<string | null> {
  return TodoWidgetBridge.readSharedImage(name);
}

export function deleteSharedImage(name: string): Promise<boolean> {
  return TodoWidgetBridge.deleteSharedImage(name);
}

export function writePantryIndex(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writePantryIndex(jsonString);
}

export function drainPendingDisposals(): Promise<string> {
  return TodoWidgetBridge.drainPendingDisposals();
}

export const writeMedicationIndex = hasNative('writeMedicationIndex')
  ? (jsonString: string): Promise<boolean> => TodoWidgetBridge.writeMedicationIndex(jsonString)
  : undefined;

export const drainPendingDoses = hasNative('drainPendingDoses')
  ? (): Promise<string> => TodoWidgetBridge.drainPendingDoses()
  : undefined;

export const drainPendingDreams = hasNative('drainPendingDreams')
  ? (): Promise<string> => TodoWidgetBridge.drainPendingDreams()
  : undefined;

export const drainPendingFoods = hasNative('drainPendingFoods')
  ? (): Promise<string> => TodoWidgetBridge.drainPendingFoods()
  : undefined;

export const drainPendingShortcutActions = hasNative('drainPendingShortcutActions')
  ? (): Promise<string> => TodoWidgetBridge.drainPendingShortcutActions()
  : undefined;

export const drainPendingKeyScans =hasNative('drainPendingKeyScans')
  ? (): Promise<string> => TodoWidgetBridge.drainPendingKeyScans()
  : undefined;

export function drainQuietWidgetTaps(): Promise<string> {
  return TodoWidgetBridge.drainQuietTaps();
}

export function syncTimerLiveActivities(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncTimerLiveActivities(jsonString);
}

export function syncTripLiveActivity(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncTripLiveActivity(jsonString);
}

export function syncLeaveLiveActivity(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncLeaveLiveActivity(jsonString);
}

export function syncFocusLiveActivity(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.syncFocusLiveActivity(jsonString);
}

export const syncWorkoutLiveActivity = hasNative('syncWorkoutLiveActivity')
  ? (jsonString: string): Promise<boolean> => TodoWidgetBridge.syncWorkoutLiveActivity(jsonString)
  : undefined;

export const writeWorkoutRoutineIndex = hasNative('writeWorkoutRoutineIndex')
  ? (jsonString: string): Promise<boolean> => TodoWidgetBridge.writeWorkoutRoutineIndex(jsonString)
  : undefined;

export const drainPendingWorkoutStarts = hasNative('drainPendingWorkoutStarts')
  ? (): Promise<string> => TodoWidgetBridge.drainPendingWorkoutStarts()
  : undefined;

export function writeWatchSnapshot(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.writeWatchSnapshot(jsonString);
}

export function addWatchQueuedWorkListener(listener: () => void): { remove(): void } {
  return TodoWidgetBridge.addListener('onWatchQueuedWork', listener);
}

export function requeueQuietTaps(jsonString: string): Promise<boolean> {
  return TodoWidgetBridge.requeueQuietTaps(jsonString);
}
