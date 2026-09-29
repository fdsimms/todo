import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * One event this device holds under a calendar server's id: its local id
 * (what expo-calendar calls the event's `id`), whether it is all-day, and the
 * local id of the calendar it sits in, null when EventKit gave none.
 */
export interface ExternalEventMatch {
  id: string;
  allDay: boolean;
  calendarId: string | null;
}

interface TodoEventKitBridgeNativeModule {
  isAvailable(): boolean;
  externalIdentifiers(localIds: string[]): Promise<Record<string, string>>;
  eventsWithExternalIdentifier(externalId: string): Promise<unknown>;
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

/**
 * Every event this device holds under the calendar server's id `externalId`.
 * Several can match (a copy in another calendar, see the native doc comment),
 * so choosing one is the caller's job. Empty when nothing matches, and when
 * the module is missing, the call fails, or the build predates this function.
 */
export async function eventsWithExternalIdentifier(externalId: string): Promise<ExternalEventMatch[]> {
  if (!nativeModule || !externalId || typeof nativeModule.eventsWithExternalIdentifier !== 'function') return [];
  try {
    const result = await nativeModule.eventsWithExternalIdentifier(externalId);
    if (!Array.isArray(result)) return [];
    const matches: ExternalEventMatch[] = [];
    for (const raw of result) {
      if (!raw || typeof raw !== 'object') continue;
      const { id, allDay, calendarId } = raw as Record<string, unknown>;
      if (typeof id !== 'string' || !id) continue;
      matches.push({
        id,
        allDay: allDay === true,
        calendarId: typeof calendarId === 'string' && calendarId ? calendarId : null,
      });
    }
    return matches;
  } catch (error) {
    console.warn('[todo-eventkit-bridge] native lookup failed; treating it as no match', error);
    return [];
  }
}
