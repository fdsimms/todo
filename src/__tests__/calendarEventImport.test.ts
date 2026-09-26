import { draftFromExtractedEvent, eventImportCreateFields } from '../utils/calendarEventImport';
import type { ExtractedCalendarEvent } from '../services/aiSuggestions';

function makeEvent(overrides: Partial<ExtractedCalendarEvent> = {}): ExtractedCalendarEvent {
  return {
    title: 'Dentist appointment',
    date: '2026-09-28',
    time: '08:15',
    location: '156 William Street',
    notes: '646-962-3681',
    ...overrides,
  };
}

describe('draftFromExtractedEvent', () => {
  it('carries the title, notes, and location straight through', () => {
    const draft = draftFromExtractedEvent(makeEvent());
    expect(draft.title).toBe('Dentist appointment');
    expect(draft.notes).toBe('646-962-3681');
    expect(draft.location).toBe('156 William Street');
  });

  it('sets dueDate to noon on the read date', () => {
    const draft = draftFromExtractedEvent(makeEvent());
    expect(draft.dueDate).not.toBeNull();
    expect(draft.dueDate!.getFullYear()).toBe(2026);
    expect(draft.dueDate!.getMonth()).toBe(8); // September, 0-indexed
    expect(draft.dueDate!.getDate()).toBe(28);
    expect(draft.dueDate!.getHours()).toBe(12);
    expect(draft.dueDate!.getMinutes()).toBe(0);
  });

  it('sets reminderTime to the exact date and time when both are given', () => {
    const draft = draftFromExtractedEvent(makeEvent());
    expect(draft.reminderTime).not.toBeNull();
    expect(draft.reminderTime!.getFullYear()).toBe(2026);
    expect(draft.reminderTime!.getMonth()).toBe(8);
    expect(draft.reminderTime!.getDate()).toBe(28);
    expect(draft.reminderTime!.getHours()).toBe(8);
    expect(draft.reminderTime!.getMinutes()).toBe(15);
  });

  it('leaves reminderTime null when no time was read, but still sets dueDate', () => {
    const draft = draftFromExtractedEvent(makeEvent({ time: null }));
    expect(draft.reminderTime).toBeNull();
    expect(draft.dueDate).not.toBeNull();
  });

  it('leaves both dueDate and reminderTime null when no date was read', () => {
    const draft = draftFromExtractedEvent(makeEvent({ date: null, time: null }));
    expect(draft.dueDate).toBeNull();
    expect(draft.reminderTime).toBeNull();
  });

  // A time with no date is nonsensical (nothing to anchor it to) — the
  // extraction service shouldn't produce this, but the mapping stays honest
  // about it rather than inventing a date to hang the time on.
  it('leaves reminderTime null when a time is given but no date', () => {
    const draft = draftFromExtractedEvent(makeEvent({ date: null, time: '08:15' }));
    expect(draft.reminderTime).toBeNull();
    expect(draft.dueDate).toBeNull();
  });

  it('maps an empty location to null', () => {
    const draft = draftFromExtractedEvent(makeEvent({ location: '' }));
    expect(draft.location).toBeNull();
  });

  it('rejects a malformed date string rather than misreading it', () => {
    const draft = draftFromExtractedEvent(makeEvent({ date: 'not-a-date' }));
    expect(draft.dueDate).toBeNull();
  });
});

describe('eventImportCreateFields', () => {
  it('returns null when no date was read, leaving the task fallback as the only path', () => {
    expect(eventImportCreateFields(makeEvent({ date: null }))).toBeNull();
  });

  it('builds a timed, one-hour span with an alarm at the start when a time was read', () => {
    const fields = eventImportCreateFields(makeEvent())!;
    expect(fields.allDay).toBe(false);
    expect(fields.start.getFullYear()).toBe(2026);
    expect(fields.start.getMonth()).toBe(8); // September, 0-indexed
    expect(fields.start.getDate()).toBe(28);
    expect(fields.start.getHours()).toBe(8);
    expect(fields.start.getMinutes()).toBe(15);
    expect(fields.end.getTime() - fields.start.getTime()).toBe(60 * 60 * 1000);
    expect(fields.alarms).toEqual([{ relativeOffset: 0 }]);
  });

  it('spans the whole day and sets no alarm when no time was read', () => {
    const fields = eventImportCreateFields(makeEvent({ time: null }))!;
    expect(fields.allDay).toBe(true);
    expect(fields.start.getHours()).toBe(0);
    expect(fields.start.getMinutes()).toBe(0);
    expect(fields.end.getTime() - fields.start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(fields.alarms).toBeUndefined();
  });

  it('carries the title, notes, and location straight through', () => {
    const fields = eventImportCreateFields(makeEvent())!;
    expect(fields.title).toBe('Dentist appointment');
    expect(fields.notes).toBe('646-962-3681');
    expect(fields.location).toBe('156 William Street');
  });

  it('maps an empty location and empty notes to undefined', () => {
    const fields = eventImportCreateFields(makeEvent({ location: '', notes: '' }))!;
    expect(fields.location).toBeUndefined();
    expect(fields.notes).toBeUndefined();
  });
});
