import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface TodoEventKitBridgeNativeModule {
  isAvailable(): boolean;
  externalIdentifiers(localIds: string[]): Promise<Record<string, string>>;
}

// requireNativeModule throws when the module isn't linked (Android, web,
// Expo Go, a build from before this module existed), so every entry point
// degrades to "no external ids" rather than throwing.
let nativeModule: TodoEventKitBridgeNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoEventKitBridgeNativeModule>('TodoEventKitBridge');
  } catch {
    nativeModule = null;
  }
}

export function isEventKitBridgeAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isAvailable() === true;
  } catch {
    return false;
  }
}

/**
 * Each local EventKit id mapped to the calendar server's id for the same
 * event. Ids that don't resolve are left out; an empty map when the module is
 * missing or the call fails.
 */
export async function externalIdentifiers(localIds: string[]): Promise<Record<string, string>> {
  if (!nativeModule || localIds.length === 0) return {};
  try {
    const result = await nativeModule.externalIdentifiers(localIds);
    return result && typeof result === 'object' ? result : {};
  } catch (error) {
    console.warn('[todo-eventkit-bridge] native call failed; falling back to local ids', error);
    return {};
  }
}
