import { dbGetSetting, dbSetSetting } from '../db/database';

/**
 * What a new quick-add event starts with: the calendar, the alert and the
 * Busy/Free choice the last one was saved with. Quick add saves an event
 * without Apple's form, so these are the answers the form's rows used to ask
 * for, remembered rather than asked each time.
 *
 * **One JSON setting, device-local.** It holds a calendar id, which names a
 * record on one phone, so the key is left out of sync's allowlist and listed in
 * `DEVICE_ID_SETTING_KEYS` (`backup.ts`) for the same reason as
 * `deadlineCalendarId`. A calendar that has since gone is handled where it is
 * used: `saveEventDirect` falls back to the default calendar.
 */
export const QUICK_EVENT_DEFAULTS_KEY = 'quickEventDefaults';

export type EventAvailability = 'busy' | 'free';

export interface QuickEventDefaults {
  /** Null until one has been used: the device's default calendar answers. */
  calendarId: string | null;
  /** Minutes before the start, 0 for at the start, null for no alert. */
  alertMinutes: number | null;
  availability: EventAvailability;
}

export const INITIAL_QUICK_EVENT_DEFAULTS: QuickEventDefaults = {
  calendarId: null,
  alertMinutes: null,
  availability: 'busy',
};

/** Tolerant of a missing, hand-edited or older stored value: any field that doesn't read falls back. */
export function parseQuickEventDefaults(raw: string | null | undefined): QuickEventDefaults {
  if (!raw) return INITIAL_QUICK_EVENT_DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof QuickEventDefaults, unknown>>;
    return {
      calendarId: typeof v.calendarId === 'string' && v.calendarId ? v.calendarId : null,
      alertMinutes:
        typeof v.alertMinutes === 'number' && Number.isFinite(v.alertMinutes) && v.alertMinutes >= 0
          ? v.alertMinutes
          : null,
      availability: v.availability === 'free' ? 'free' : 'busy',
    };
  } catch {
    return INITIAL_QUICK_EVENT_DEFAULTS;
  }
}

export function readQuickEventDefaults(): QuickEventDefaults {
  return parseQuickEventDefaults(dbGetSetting(QUICK_EVENT_DEFAULTS_KEY));
}

export function writeQuickEventDefaults(defaults: QuickEventDefaults): void {
  dbSetSetting(QUICK_EVENT_DEFAULTS_KEY, JSON.stringify(defaults));
}
