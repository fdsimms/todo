import type { BusyEvent } from '../utils/calendarBusy';
import { setEventLocationDirect } from '../utils/calendarSync';
import { eventDetailEntries, withEventDetailsSkipped, type EventDetailEntry } from '../utils/eventDetailTasks';
import { placeLocationText, type PlaceResult } from '../utils/places';
import { isDemoModeActive } from '../utils/demoState';
import { markGeneratedReady } from './generatedTaskSync';
import { useCalendarStore } from './useCalendarStore';
import { useEventPeopleStore } from './useEventPeopleStore';
import { usePersonStore } from './usePersonStore';
import { useSettingsStore } from './useSettingsStore';
import { useTaskStore } from './useTaskStore';

/**
 * What the event details task's Add and Skip do, and the read of the events
 * its check makes: the same `eventDetailEntries` over the same stores the
 * row's panel subscribes to, so the title's count and the list agree.
 */

/** The events with something left to add, as the stores stand now. */
export function readEventDetailEntries(now: Date = new Date()): EventDetailEntry[] {
  // The panel's demo refusal, for its reason (EventDetailsPanel.tsx).
  if (isDemoModeActive()) return [];
  const people = usePersonStore.getState().people.filter(p => !p.archived);
  return eventDetailEntries(
    useCalendarStore.getState().events,
    people,
    useEventPeopleStore.getState().peopleFor,
    useSettingsStore.getState().eventDetailsSkipped,
    now,
  );
}

/**
 * After an answer: with nothing left to ask, the row is marked ready, which
 * completes it here since the person did it in the app (`markGeneratedReady`).
 * Otherwise the check runs again so the title's count follows.
 */
function settle(taskId: string): void {
  const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
  if (!task || task.completed) return;
  if (readEventDetailEntries().length === 0) markGeneratedReady(task);
  else useTaskStore.getState().checkEventDetailsTasks();
}

/** Links one person to the event (the app's own link, never an attendee). */
export function addEventDetailPerson(event: BusyEvent, personId: string, taskId: string): void {
  const store = useEventPeopleStore.getState();
  const linked = store.peopleFor(event);
  if (!linked.includes(personId)) store.setPeople(event, [...linked, personId]);
  settle(taskId);
}

/**
 * Writes the place into the event's location: the Apple Maps match when one
 * was shown (its name and address, and its pin), else the words the title
 * used. Resolves false when nothing was written (no access, demo mode, the
 * event gone), so the row can leave its button as it was.
 */
export async function addEventDetailPlace(
  event: BusyEvent,
  text: string,
  match: PlaceResult | null,
  taskId: string,
): Promise<boolean> {
  const location = match ? placeLocationText(match) : text;
  const id = await setEventLocationDirect(event.id, location, match, event.start);
  if (!id) return false;
  // EventKit can hand back a new id for an occurrence it detached to edit, and
  // the people links are keyed by it: carry them over, the edit card's move.
  if (id !== event.id) {
    const store = useEventPeopleStore.getState();
    const linked = store.peopleFor(event);
    if (linked.length > 0) {
      store.setPeople(event, []);
      store.setPeople({ ...event, id }, linked);
    }
  }
  await useCalendarStore.getState().refresh();
  settle(taskId);
  return true;
}

/** Stops the task asking about this occurrence. */
export function skipEventDetails(event: BusyEvent, taskId: string): void {
  const settings = useSettingsStore.getState();
  settings.setEventDetailsSkipped(withEventDetailsSkipped(settings.eventDetailsSkipped, event));
  settle(taskId);
}
