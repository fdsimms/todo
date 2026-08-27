import { create } from 'zustand';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  type EventReminder,
  eventReminderKey,
  pruneStaleReminders,
  reminderFromEvent,
} from '../utils/eventReminders';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { scheduleEventReminder, cancelEventReminder } from '../utils/notifications';

const SETTINGS_KEY = 'event_reminders';

function load(): Record<string, EventReminder> {
  const raw = dbGetSetting(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist(remindersByKey: Record<string, EventReminder>): void {
  dbSetSetting(SETTINGS_KEY, JSON.stringify(remindersByKey));
}

interface EventReminderState {
  remindersByKey: Record<string, EventReminder>;
  loaded: boolean;
  /**
   * Loads the persisted map and drops anything for an event that has already
   * started. Deliberately does not itself (re)schedule notifications —
   * `useTaskStore.initialize()` reads `remindersByKey` right after this and
   * folds it into the one `rescheduleAllReminders` cold-start funnel, so a
   * second scheduling pass here would just repeat that work.
   */
  initialize: () => void;
  reminderFor: (event: Pick<BusyEvent, 'id' | 'start'>) => EventReminder | undefined;
  setReminder: (event: BusyEvent, offsetMinutes: number) => void;
  clearReminder: (event: Pick<BusyEvent, 'id' | 'start'>) => void;
}

export const useEventReminderStore = create<EventReminderState>((set, get) => ({
  remindersByKey: {},
  loaded: false,

  initialize: () => {
    const pruned = pruneStaleReminders(load(), new Date());
    persist(pruned);
    set({ remindersByKey: pruned, loaded: true });
  },

  reminderFor: event => get().remindersByKey[eventReminderKey(event)],

  setReminder: (event, offsetMinutes) => {
    const reminder = reminderFromEvent(event, offsetMinutes);
    const remindersByKey = { ...get().remindersByKey, [reminder.key]: reminder };
    persist(remindersByKey);
    set({ remindersByKey });
    scheduleEventReminder(reminder);
  },

  clearReminder: event => {
    const key = eventReminderKey(event);
    if (!(key in get().remindersByKey)) return;
    const remindersByKey = { ...get().remindersByKey };
    delete remindersByKey[key];
    persist(remindersByKey);
    set({ remindersByKey });
    cancelEventReminder(key);
  },
}));
